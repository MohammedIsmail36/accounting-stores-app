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

// الجداول التي تحتوي على عمود created_by يرتبط بـ auth.users
const TABLES_WITH_CREATED_BY = [
  "journal_entries",
  "sales_invoices",
  "purchase_invoices",
  "sales_returns",
  "purchase_returns",
  "customer_payments",
  "supplier_payments",
  "expenses",
  "inventory_adjustments",
  "inventory_movements",
];

// ترتيب الحذف: الأبناء أولاً لتجنب أخطاء FK
const ALL_TABLES_TRUNCATE = [
  "sales_invoice_return_settlements",
  "purchase_invoice_return_settlements",
  "sales_return_payment_allocations",
  "purchase_return_payment_allocations",
  "customer_payment_allocations",
  "supplier_payment_allocations",
  "inventory_adjustment_items",
  "inventory_movements",
  "sales_return_items",
  "purchase_return_items",
  "sales_invoice_items",
  "purchase_invoice_items",
  "customer_payments",
  "supplier_payments",
  "inventory_adjustments",
  "sales_returns",
  "purchase_returns",
  "sales_invoices",
  "purchase_invoices",
  "journal_entry_lines",
  "journal_entries",
  "product_images",
  "products",
  "customers",
  "suppliers",
  "product_categories",
  "product_brands",
  "product_units",
  "expenses",
  "expense_types",
  "accounts",
  "company_settings",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth: only authenticated admins may wipe and reset the database ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "غير مصرح" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller) {
      return new Response(JSON.stringify({ error: "جلسة غير صالحة" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "صلاحيات غير كافية — يتطلب دور المدير" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: string[] = [];

    // ── Step 1: إزالة مراجع created_by لتجنب أخطاء FK عند حذف المستخدمين ──
    for (const table of TABLES_WITH_CREATED_BY) {
      const { error } = await supabase
        .from(table)
        .update({ created_by: null })
        .not("created_by", "is", null);
      if (error) {
        results.push(`⚠️ خطأ في تنظيف created_by من ${table}: ${error.message}`);
      }
    }
    results.push("✅ تم تنظيف مراجع المستخدمين من جميع الجداول");

    // ── Step 2: حذف بيانات جميع الجداول ──
    for (const table of ALL_TABLES_TRUNCATE) {
      const { error } = await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) {
        results.push(`❌ خطأ في حذف ${table}: ${error.message}`);
      } else {
        results.push(`🗑️ تم حذف بيانات ${table}`);
      }
    }

    // ── Step 3: حذف أدوار المستخدمين والملفات الشخصية ──
    const { error: rolesErr } = await supabase
      .from("user_roles")
      .delete()
      .neq("user_id", "00000000-0000-0000-0000-000000000000");
    results.push(rolesErr ? `❌ خطأ في حذف الأدوار: ${rolesErr.message}` : "🗑️ تم حذف أدوار المستخدمين");

    const { error: profilesErr } = await supabase
      .from("profiles")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    results.push(profilesErr ? `❌ خطأ في حذف الملفات الشخصية: ${profilesErr.message}` : "🗑️ تم حذف الملفات الشخصية");

    // ── Step 4: حذف جميع مستخدمي Auth ──
    const { data: allUsers, error: listErr } = await supabase.auth.admin.listUsers();
    if (listErr) {
      results.push(`❌ خطأ في جلب المستخدمين: ${listErr.message}`);
    } else if (allUsers?.users?.length) {
      let deletedCount = 0;
      for (const user of allUsers.users) {
        const { error: delErr } = await supabase.auth.admin.deleteUser(user.id);
        if (delErr) {
          results.push(`❌ خطأ في حذف المستخدم ${user.email}: ${delErr.message}`);
        } else {
          deletedCount++;
        }
      }
      results.push(`🗑️ تم حذف ${deletedCount} من أصل ${allUsers.users.length} مستخدم`);
    } else {
      results.push("ℹ️ لا يوجد مستخدمون لحذفهم");
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // ── Step 5: إعادة إنشاء حساب المدير ──
    if (!DEFAULT_ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: "يجب ضبط DEFAULT_ADMIN_PASSWORD كـ secret قبل إعادة البناء" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email: DEFAULT_ADMIN_EMAIL,
      password: DEFAULT_ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: DEFAULT_ADMIN_NAME },
    });

    if (createErr) {
      results.push(`❌ خطأ في إنشاء حساب المدير: ${createErr.message}`);
    } else if (newUser?.user) {
      const adminId = newUser.user.id;
      results.push(`✅ تم إنشاء حساب المدير: ${DEFAULT_ADMIN_EMAIL}`);

      // إسناد دور admin مباشرة بدون RPC خارجي
      const { error: roleErr } = await supabase
        .from("user_roles")
        .upsert({ user_id: adminId, role: "admin" }, { onConflict: "user_id,role" });
      results.push(roleErr ? `❌ خطأ في إسناد الدور: ${roleErr.message}` : "✅ تم إسناد دور المدير");

      // إنشاء/تحديث الملف الشخصي
      const { error: profErr } = await supabase
        .from("profiles")
        .upsert({ id: adminId, full_name: DEFAULT_ADMIN_NAME }, { onConflict: "id" });
      results.push(profErr ? `❌ خطأ في الملف الشخصي: ${profErr.message}` : "✅ تم إنشاء/تحديث الملف الشخصي للمدير");
    }

    // ── Step 6: إعادة إنشاء شجرة الحسابات ──
    const codeToId: Record<string, string> = {};
    let accountsCount = 0;
    for (const acc of DEFAULT_ACCOUNTS) {
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
        accountsCount++;
      }
      if (error) results.push(`❌ خطأ في حساب ${acc.code}: ${error.message}`);
    }
    results.push(`✅ تم إضافة ${accountsCount} حساب في شجرة الحسابات`);

    // Self-heal: ensure is_system flag matches SYSTEM_CODES
    const { data: healedRows } = await supabase
      .from("accounts")
      .update({ is_system: true })
      .in("code", SYSTEM_CODES)
      .eq("is_system", false)
      .select("code");
    if (healedRows && healedRows.length > 0) {
      results.push(`🔧 تم استعادة صفة "حساب نظام" لـ ${healedRows.length} حساب`);
    }

    // ── Step 7: إعادة إنشاء إعدادات الشركة ──
    const { error: settingsErr } = await supabase
      .from("company_settings")
      .insert({ company_name: DEFAULT_COMPANY_NAME });
    results.push(settingsErr ? `❌ خطأ في إنشاء الإعدادات: ${settingsErr.message}` : "✅ تم إنشاء إعدادات الشركة");

    results.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    results.push("✅ تم تصفير قاعدة البيانات وإعادة البناء بنجاح");
    results.push(`📧 بريد المدير: ${DEFAULT_ADMIN_EMAIL}`);
    results.push(`🔐 يُرجى استخدام كلمة المرور المُكوّنة في إعدادات النظام وتغييرها فور الدخول`);

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
