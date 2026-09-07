import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  DEFAULT_ACCOUNTS,
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_NAME,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_COMPANY_NAME,
  SYSTEM_CODES,
} from "../_shared/system-defaults.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const results: string[] = [];

    // ── Auth guard: allow bootstrap when no users exist; otherwise require admin ──
    const { data: allUsers } = await supabase.auth.admin.listUsers();
    const userCount = allUsers?.users?.length ?? 0;
    if (userCount > 0) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "غير مصرح" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const callerClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
      if (callerError || !caller) {
        return new Response(JSON.stringify({ error: "جلسة غير صالحة" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: roleData } = await supabase
        .from("user_roles").select("role").eq("user_id", caller.id).eq("role", "admin").maybeSingle();
      if (!roleData) {
        return new Response(JSON.stringify({ error: "صلاحيات غير كافية — يتطلب دور المدير" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Require DEFAULT_ADMIN_PASSWORD to be configured
    if (!DEFAULT_ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: "يجب ضبط DEFAULT_ADMIN_PASSWORD كـ secret قبل التشغيل" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // ── 1. إنشاء حساب المدير ──
    let adminId: string | null = null;
    const { data: existingUsers, error: listErr } = await supabase.auth.admin.listUsers();
    if (listErr) {
      results.push(`❌ خطأ في جلب المستخدمين: ${listErr.message}`);
    } else {
      const existingAdmin = existingUsers?.users?.find((u: any) => u.email === DEFAULT_ADMIN_EMAIL);
      if (existingAdmin) {
        adminId = existingAdmin.id;
        // إعادة ضبط كلمة المرور إلى الافتراضية لضمان إمكانية الدخول بعد التصفير
        const { error: updateErr } = await supabase.auth.admin.updateUserById(existingAdmin.id, {
          password: DEFAULT_ADMIN_PASSWORD,
          email_confirm: true,
        });
        results.push(updateErr
          ? `❌ خطأ في تحديث كلمة مرور المدير: ${updateErr.message}`
          : `✅ تم تحديث كلمة مرور المدير إلى الافتراضية`);
      } else {
        const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
          email: DEFAULT_ADMIN_EMAIL,
          password: DEFAULT_ADMIN_PASSWORD,
          email_confirm: true,
          user_metadata: { full_name: DEFAULT_ADMIN_NAME },
        });
        if (createErr) {
          results.push(`❌ خطأ في إنشاء حساب المدير: ${createErr.message}`);
        } else if (newUser?.user) {
          adminId = newUser.user.id;
          results.push(`✅ تم إنشاء حساب المدير: ${DEFAULT_ADMIN_EMAIL}`);
        }
      }
    }

    // إسناد الدور وإنشاء/تحديث الملف الشخصي مباشرة بدون RPC خارجي
    if (adminId) {
      const { error: roleErr } = await supabase
        .from("user_roles")
        .upsert({ user_id: adminId, role: "admin" }, { onConflict: "user_id,role" });
      results.push(roleErr ? `❌ خطأ في إسناد الدور: ${roleErr.message}` : "✅ تم إسناد دور المدير");

      const { error: profErr } = await supabase
        .from("profiles")
        .upsert({ id: adminId, full_name: DEFAULT_ADMIN_NAME }, { onConflict: "id" });
      results.push(profErr ? `❌ خطأ في إنشاء الملف الشخصي: ${profErr.message}` : "✅ تم إنشاء/تحديث الملف الشخصي");
    }

    // ── 2. شجرة الحسابات (تخطي الموجود) ──
    const { data: existingAccounts } = await supabase.from("accounts").select("code, id");
    const existingCodes = new Set((existingAccounts || []).map((a: any) => a.code));
    const codeToId: Record<string, string> = {};
    (existingAccounts || []).forEach((a: any) => { codeToId[a.code] = a.id; });

    let accountsAdded = 0;
    for (const acc of DEFAULT_ACCOUNTS) {
      if (existingCodes.has(acc.code)) continue;
      const parent_id = acc.parent_code ? codeToId[acc.parent_code] || null : null;
      const { data: inserted, error } = await supabase
        .from("accounts")
        .insert({
          code: acc.code,
          name: acc.name,
          account_type: acc.account_type,
          is_parent: acc.is_parent,
          is_system: SYSTEM_CODES.includes(acc.code),
          parent_id,
        })
        .select("id")
        .single();
      if (inserted) {
        codeToId[acc.code] = inserted.id;
        accountsAdded++;
      }
      if (error) results.push(`❌ خطأ في حساب ${acc.code}: ${error.message}`);
    }
    results.push(accountsAdded > 0 ? `✅ تم إضافة ${accountsAdded} حساب جديد` : "ℹ️ شجرة الحسابات موجودة مسبقاً");

    // Self-heal: ensure is_system flag matches SYSTEM_CODES for any pre-existing rows
    const { data: healedRows } = await supabase
      .from("accounts")
      .update({ is_system: true })
      .in("code", SYSTEM_CODES)
      .eq("is_system", false)
      .select("code");
    if (healedRows && healedRows.length > 0) {
      results.push(`🔧 تم استعادة صفة "حساب نظام" لـ ${healedRows.length} حساب`);
    }

    // ── 3. إعدادات الشركة (تخطي إذا موجودة) ──
    const { data: existingSettings } = await supabase.from("company_settings").select("id").limit(1);
    if (existingSettings && existingSettings.length > 0) {
      results.push("ℹ️ إعدادات الشركة موجودة مسبقاً");
    } else {
      const { error: settingsErr } = await supabase
        .from("company_settings")
        .insert({ company_name: DEFAULT_COMPANY_NAME });
      results.push(settingsErr ? `❌ خطأ في إنشاء الإعدادات: ${settingsErr.message}` : "✅ تم إنشاء إعدادات الشركة");
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
