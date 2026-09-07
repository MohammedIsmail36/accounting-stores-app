import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ── Admin-only auth guard ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "غير مصرح" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const callerClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !caller) {
    return new Response(JSON.stringify({ error: "جلسة غير صالحة" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: roleData } = await supabase
    .from("user_roles").select("role").eq("user_id", caller.id).eq("role", "admin").maybeSingle();
  if (!roleData) {
    return new Response(JSON.stringify({ error: "صلاحيات غير كافية" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }


  const { action, je_id } = await req.json();
  const log: string[] = [];

  try {
    if (action === "delete_orphan") {
      // Delete lines first
      const { data: lines } = await supabase.from("journal_entry_lines").delete().eq("journal_entry_id", je_id).select("id");
      log.push(`Deleted ${lines?.length || 0} lines for JE ${je_id}`);

      // Delete JE
      const { error } = await supabase.from("journal_entries").delete().eq("id", je_id);
      if (error) throw error;
      log.push(`Deleted JE ${je_id}`);
    }

    if (action === "fix_opening_posted") {
      // Give posted_number to opening balance JEs
      const orphans = [
        "e0e411cd-8c75-40b5-9211-18b02d17d501",
        "1782b847-4dd8-42a3-983f-7f9ce1e2177e",
        "9c0bb816-9207-4be4-bda7-e036ed255407",
        "aae50389-bc0b-4611-865d-8a3ec0e7734f",
        "a5f5098f-3e4e-4ee8-a64a-a46f53d8dbe4",
      ];
      // Get max posted_number
      const { data: maxP } = await supabase.from("journal_entries").select("posted_number").not("posted_number", "is", null).order("posted_number", { ascending: false }).limit(1);
      let next = (maxP && maxP.length > 0 ? Number(maxP[0].posted_number) : 0) + 1;

      for (const id of orphans) {
        await supabase.from("journal_entries").update({ posted_number: next } as any).eq("id", id);
        log.push(`Set posted_number=${next} for ${id}`);
        next++;
      }
    }

    return new Response(JSON.stringify({ success: true, log }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message, log }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
