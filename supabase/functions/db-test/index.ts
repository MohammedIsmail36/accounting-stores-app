import postgres from "npm:postgres@3";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const dbUrl = Deno.env.get("SUPABASE_DB_URL") || Deno.env.get("DATABASE_URL") || "not-set";
    let result: any = {};

    if (dbUrl && dbUrl !== "not-set") {
      try {
        const sql = postgres(dbUrl, { max: 1, timeout: 10 });

        await sql`CREATE TEMP TABLE tmp_copy (id int, name text)`;

        const writable = await sql`COPY tmp_copy FROM STDIN`.writable();
        writable.write("1\tAlice\n");
        writable.write("2\tBob\n");
        await new Promise<void>((resolve, reject) => {
          writable.end((err: any) => (err ? reject(err) : resolve()));
        });

        const rows = await sql`SELECT * FROM tmp_copy ORDER BY id`;

        await sql.end();

        result = { copy_rows: rows };
      } catch (e) {
        result = { error: e.message, stack: e.stack?.split("\n")?.slice(0, 5) };
      }
    } else {
      result = { error: "DB URL not set" };
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
