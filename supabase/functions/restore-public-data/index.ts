import postgres from "npm:postgres@3";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const RESTORE_BUCKET = "restore-backups";
const RESTORE_FILE = "public_data_clean.sql.gz";
const PRESERVE_TABLES = ["profiles", "user_roles"];

interface FkConstraint {
  conname: string;
  schema_name: string;
  table_name: string;
  def: string;
}

async function readSqlFromStorage(
  supabase: ReturnType<typeof createClient>
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(RESTORE_BUCKET)
    .download(RESTORE_FILE);

  if (error) throw new Error(`Storage download failed: ${error.message}`);
  if (!data) throw new Error("Storage returned empty file");

  if (RESTORE_FILE.endsWith(".gz")) {
    const stream = data.stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  }

  return await data.text();
}

async function getAllForeignKeys(sql: postgres.Sql): Promise<FkConstraint[]> {
  const rows = await sql<FkConstraint[]>`
    SELECT
      con.conname AS conname,
      n.nspname AS schema_name,
      c.relname AS table_name,
      pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.contype = 'f'
      AND n.nspname = 'public'
    ORDER BY c.relname, con.conname;
  `;
  return rows;
}

async function executeCopyBlock(
  sql: postgres.Sql,
  copyLine: string,
  dataLines: string[]
): Promise<void> {
  const copySql = copyLine.replace(/FROM stdin;?\s*$/, "FROM STDIN");
  const writable = await sql.unsafe(copySql).writable();

  await new Promise<void>((resolve, reject) => {
    writable.on("error", reject);

    const data = dataLines.join("");
    const chunkSize = 64 * 1024;
    let pending = 0;
    let nextIndex = 0;

    const writeNext = () => {
      if (nextIndex >= data.length && pending === 0) {
        writable.end(resolve);
        return;
      }
      while (nextIndex < data.length) {
        const end = Math.min(nextIndex + chunkSize, data.length);
        const chunk = data.slice(nextIndex, end);
        nextIndex = end;
        pending++;
        writable.write(chunk, (err: any) => {
          pending--;
          if (err) {
            reject(err);
            return;
          }
          writeNext();
        });
        if (pending >= 4) {
          break;
        }
      }
    };

    writeNext();
  });
}

async function parseAndExecuteSql(
  sql: postgres.Sql,
  sqlText: string,
  onProgress: (msg: string) => void
): Promise<void> {
  const lines = sqlText.split("\n");
  let normalBuffer: string[] = [];
  let copyLine: string | null = null;
  let copyDataLines: string[] = [];
  let inCopy = false;
  let copyCount = 0;
  let statementCount = 0;

  const flushNormal = async () => {
    if (normalBuffer.length === 0) return;
    const stmt = normalBuffer.join("\n").trim();
    normalBuffer = [];
    if (!stmt) return;
    try {
      await sql.unsafe(stmt);
      statementCount++;
    } catch (e: any) {
      throw new Error(
        `SQL execution failed at statement #${statementCount}: ${e.message}\n${stmt.slice(0, 300)}`
      );
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    if (inCopy) {
      if (line === "\\.") {
        copyCount++;
        await executeCopyBlock(sql, copyLine!, copyDataLines);
        copyLine = null;
        copyDataLines = [];
        inCopy = false;
        onProgress(`Loaded ${copyCount} COPY blocks`);
      } else {
        copyDataLines.push(rawLine + "\n");
      }
      continue;
    }

    if (line.startsWith("COPY ")) {
      await flushNormal();
      copyLine = line;
      inCopy = true;
      continue;
    }

    normalBuffer.push(rawLine);
    if (line.trim().endsWith(";")) {
      await flushNormal();
    }
  }

  await flushNormal();
  onProgress(
    `Executed ${statementCount} statements and ${copyCount} COPY blocks`
  );
}

async function createAdminUser(
  supabase: ReturnType<typeof createClient>
): Promise<{ id: string; email: string }> {
  const password = Deno.env.get("DEFAULT_ADMIN_PASSWORD") || "ChangeMe123!";
  const email = "admin@system.com";
  const fullName = "مدير النظام";

  // Remove existing user with the same email to avoid conflicts
  try {
    const { data, error } = await supabase.auth.admin.listUsers({
      perPage: 100,
      page: 1,
    });
    if (!error && data?.users) {
      const existing = data.users.find((u) => u.email === email);
      if (existing?.id) {
        await supabase.auth.admin.deleteUser(existing.id);
      }
    }
  } catch {
    // ignore lookup/delete errors
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, email_verified: true },
    app_metadata: { provider: "email", providers: ["email"] },
  });

  if (error) throw new Error(`Failed to create admin user: ${error.message}`);
  if (!data.user) throw new Error("Admin user creation returned no user");

  const userId = data.user.id;

  await supabase.from("profiles").upsert({
    id: userId,
    full_name: fullName,
  });

  await supabase.from("user_roles").upsert({
    user_id: userId,
    role: "admin",
  });

  return { id: userId, email };
}

async function authorizeRequest(
  req: Request,
  supabaseUrl: string,
  serviceClient: ReturnType<typeof createClient>
): Promise<{ authorized: boolean; error?: string }> {
  const authHeader = req.headers.get("Authorization");
  const body = await req.json().catch(() => ({}));
  const secretKey = body?.secret_key || "";

  const expectedSecret =
    Deno.env.get("RESTORE_SECRET_KEY") ||
    Deno.env.get("DEFAULT_ADMIN_PASSWORD") ||
    "";

  // Secret key grants full restore permission (used when roles are empty or untrusted)
  if (expectedSecret && secretKey === expectedSecret) {
    return { authorized: true };
  }

  // Check admin auth
  if (authHeader) {
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const callerClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await callerClient.auth.getUser();
    if (!error && data?.user) {
      const { data: role } = await callerClient
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (role) {
        return { authorized: true };
      }
    }
  }

  return { authorized: false, error: "Admin authorization required" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const dbUrl = Deno.env.get("SUPABASE_DB_URL") || Deno.env.get("DATABASE_URL");

    if (!supabaseUrl || !serviceRoleKey || !dbUrl) {
      throw new Error(
        "Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL"
      );
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authz = await authorizeRequest(req, supabaseUrl, serviceClient);
    if (!authz.authorized) {
      return new Response(
        JSON.stringify({ error: authz.error, logs }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    log("Downloading SQL backup from storage...");
    const sqlText = await readSqlFromStorage(serviceClient);
    log(`Downloaded ${sqlText.length} bytes`);

    const sql = postgres(dbUrl, {
      max: 1,
      timeout: 120,
      connect_timeout: 60,
    });

    try {
      await sql.begin(async (tx) => {
        await tx`SET session_replication_role = replica`;
        log("Disabled triggers (session_replication_role = replica)");

        const fks = await getAllForeignKeys(tx);
        log(`Found ${fks.length} foreign keys to drop`);
        for (const fk of fks) {
          await tx.unsafe(
            `ALTER TABLE "public"."${fk.table_name}" DROP CONSTRAINT "${fk.conname}"`
          );
        }
        log("Dropped foreign keys");

        const tables = await tx<{ table_name: string }[]>`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
          ORDER BY table_name;
        `;
        const tableNames = tables
          .map((t) => t.table_name)
          .filter((n) => !PRESERVE_TABLES.includes(n));
        const tableList = tableNames.map((n) => `"public"."${n}"`).join(", ");
        await tx.unsafe(`TRUNCATE TABLE ${tableList} CASCADE`);
        log(`Truncated ${tableNames.length} public tables`);

        const sequences = await tx<{ seq: string; table_name: string; col: string }[]>`
          SELECT
            pg_get_serial_sequence(format('%I.%I', table_schema, table_name), column_name) AS seq,
            table_name,
            column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND column_default LIKE 'nextval%'
        `;
        for (const s of sequences) {
          if (s.seq) {
            await tx.unsafe(`SELECT setval('${s.seq}', 1, false)`);
          }
        }
        log(`Reset ${sequences.length} sequences`);

        log("Executing SQL dump...");
        await parseAndExecuteSql(tx, sqlText, log);

        for (const t of tableNames) {
          const cols = await tx<{ column_name: string }[]>`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ${t}
              AND column_name = 'created_by'
          `;
          if (cols.length > 0) {
            await tx.unsafe(`UPDATE "public"."${t}" SET created_by = NULL`);
          }
        }
        log("Cleared created_by references");

        // Dump sets search_path to ''; reset it so unqualified FK references work
        await tx`SET search_path = public`;

        for (const fk of fks) {
          await tx.unsafe(
            `ALTER TABLE "public"."${fk.table_name}" ADD CONSTRAINT "${fk.conname}" ${fk.def}`
          );
        }
        log("Re-added foreign keys");

        await tx`SET session_replication_role = origin`;
      });

      log("Database transaction committed successfully");
    } finally {
      await sql.end();
    }

    log("Preserved existing users, profiles and roles");

    return new Response(
      JSON.stringify({
        success: true,
        logs,
        note:
          "Public data restored from backup. Existing auth users, profiles and roles were preserved; created_by references were cleared.",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error(err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message,
        logs,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
