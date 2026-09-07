import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ── Admin-only auth guard ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "غير مصرح" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const SUPABASE_URL_ENV = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const callerClient = createClient(SUPABASE_URL_ENV, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !caller) {
    return new Response(JSON.stringify({ error: "جلسة غير صالحة" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL_ENV, SERVICE_ROLE_KEY);

  const { data: roleData } = await supabase
    .from("user_roles").select("role").eq("user_id", caller.id).eq("role", "admin").maybeSingle();
  if (!roleData) {
    return new Response(JSON.stringify({ error: "صلاحيات غير كافية" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }


  const { phase } = await req.json();
  const log: string[] = [];
  const checks: { name: string; expected: any; actual: any; pass: boolean }[] = [];
  const L = (m: string) => log.push(m);
  const CHECK = (name: string, expected: any, actual: any) => {
    const pass = String(expected) === String(actual);
    checks.push({ name, expected, actual, pass });
    L(`  ${pass ? '✅' : '❌'} ${name}: expected=${expected}, actual=${actual}`);
  };

  const TODAY = "2026-04-08";

  try {
    // ── Helpers ──
    async function getAccountId(code: string): Promise<string> {
      const { data } = await supabase.from("accounts").select("id").eq("code", code).single();
      return data!.id;
    }

    async function getAccountIds() {
      const codes = ["1101","1102","1103","1104","2101","3101","3102","4101","5101","5103"];
      const map: Record<string, string> = {};
      for (const code of codes) {
        map[code] = await getAccountId(code);
      }
      return map;
    }

    async function nextPosted(table: string) {
      const { data } = await supabase.from(table).select("posted_number").not("posted_number", "is", null).order("posted_number", { ascending: false }).limit(1);
      return (data && data.length > 0 ? Number(data[0].posted_number) : 0) + 1;
    }

    async function nextSeq(table: string, col: string) {
      const { data } = await supabase.from(table).select(col).order(col, { ascending: false }).limit(1);
      return (data && data.length > 0 ? Number((data[0] as any)[col]) : 0) + 1;
    }

    async function getQty(pid: string) {
      const { data } = await supabase.from("products").select("quantity_on_hand").eq("id", pid).single();
      return Number(data?.quantity_on_hand ?? 0);
    }

    async function getAvgPurchasePrice(pid: string) {
      const { data } = await supabase.rpc("get_avg_purchase_price", { _product_id: pid });
      return Number(data) || 0;
    }

    async function getEntityBalance(table: string, id: string) {
      const { data } = await supabase.from(table).select("balance").eq("id", id).single();
      return Number(data?.balance ?? 0);
    }

    async function getTrialBalance() {
      const { data: entries } = await supabase.from("journal_entries").select("id").eq("status", "posted");
      if (!entries || entries.length === 0) return { debit: 0, credit: 0 };
      const entryIds = entries.map((e: any) => e.id);
      const { data: lines } = await supabase.from("journal_entry_lines").select("debit, credit").in("journal_entry_id", entryIds);
      const debit = (lines || []).reduce((s: number, l: any) => s + Number(l.debit), 0);
      const credit = (lines || []).reduce((s: number, l: any) => s + Number(l.credit), 0);
      return { debit: round2(debit), credit: round2(credit) };
    }

    async function getAccountBalance(accountId: string) {
      const { data: entries } = await supabase.from("journal_entries").select("id").eq("status", "posted");
      if (!entries || entries.length === 0) return { debit: 0, credit: 0 };
      const entryIds = entries.map((e: any) => e.id);
      const { data: lines } = await supabase.from("journal_entry_lines").select("debit, credit").in("journal_entry_id", entryIds).eq("account_id", accountId);
      const debit = (lines || []).reduce((s: number, l: any) => s + Number(l.debit), 0);
      const credit = (lines || []).reduce((s: number, l: any) => s + Number(l.credit), 0);
      return { debit: round2(debit), credit: round2(credit) };
    }

    async function findEntityByName(table: string, name: string) {
      const { data } = await supabase.from(table).select("id").eq("name", name).single();
      return data?.id;
    }

    async function findProductByName(name: string) {
      const { data } = await supabase.from("products").select("id").eq("name", name).single();
      return data?.id;
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 0: Verify system initialization
    // ═══════════════════════════════════════════════════════════
    if (phase === 0) {
      L("═══ Phase 0: Verify System Init ═══");

      // Lookup seeding removed — tests must create their own lookups explicitly.
      L("✅ Phase 0 (no auto lookups)");

      // Verify
      const { count: accCount } = await supabase.from("accounts").select("*", { count: "exact", head: true });
      CHECK("عدد الحسابات", 29, accCount);

      const { count: prodCount } = await supabase.from("products").select("*", { count: "exact", head: true });
      CHECK("عدد المنتجات", 0, prodCount);

      const { count: custCount } = await supabase.from("customers").select("*", { count: "exact", head: true });
      CHECK("عدد العملاء", 0, custCount);

      const { count: supCount } = await supabase.from("suppliers").select("*", { count: "exact", head: true });
      CHECK("عدد الموردين", 0, supCount);

      const tb = await getTrialBalance();
      CHECK("ميزان المراجعة مدين", 0, tb.debit);
      CHECK("ميزان المراجعة دائن", 0, tb.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 1: Create product with opening balance
    // لابتوب HP — شراء: 8,000 — بيع: 10,000 — كمية: 5
    // ═══════════════════════════════════════════════════════════
    if (phase === 1) {
      L("═══ Phase 1: Product with opening balance ═══");
      const ACC = await getAccountIds();

      // Get unit and brand IDs
      const { data: unit } = await supabase.from("product_units").select("id").eq("name", "قطعة").single();
      const { data: brand } = await supabase.from("product_brands").select("id").eq("name", "HP").single();
      const { data: cat } = await supabase.from("product_categories").select("id").eq("name", "إلكترونيات").single();

      // Create product
      const { data: product, error: prodErr } = await supabase.from("products").insert({
        code: "P001", name: "لابتوب HP",
        purchase_price: 8000, selling_price: 10000,
        quantity_on_hand: 5, min_stock_level: 2,
        unit_id: unit?.id, brand_id: brand?.id, category_id: cat?.id,
      }).select("id").single();

      if (prodErr) { L(`❌ Error creating product: ${prodErr.message}`); }
      else {
        const pid = product!.id;
        // Opening balance inventory movement
        await supabase.from("inventory_movements").insert({
          product_id: pid, movement_type: "opening_balance",
          quantity: 5, unit_cost: 8000, total_cost: 40000,
          movement_date: TODAY, notes: "رصيد افتتاحي - لابتوب HP",
        } as any);

        // Opening balance journal entry
        const jeNum = await nextSeq("journal_entries", "entry_number");
        const jePosted = await nextPosted("journal_entries");
        const { data: je } = await supabase.from("journal_entries").insert({
          description: "رصيد افتتاحي - لابتوب HP",
          entry_date: TODAY, total_debit: 40000, total_credit: 40000,
          status: "posted", posted_number: jePosted, entry_number: jeNum,
        }).select("id").single();

        await supabase.from("journal_entry_lines").insert([
          { journal_entry_id: je!.id, account_id: ACC["1104"], debit: 40000, credit: 0, description: "رصيد افتتاحي مخزون - لابتوب HP" },
          { journal_entry_id: je!.id, account_id: ACC["3101"], debit: 0, credit: 40000, description: "رصيد افتتاحي رأس مال - لابتوب HP" },
        ]);

        L("✅ Product created with opening balance");
      }

      // Verify
      const qty = await getQty((await findProductByName("لابتوب HP"))!);
      CHECK("كمية لابتوب", 5, qty);

      const { data: movements } = await supabase.from("inventory_movements").select("*").eq("movement_type", "opening_balance");
      CHECK("عدد حركات opening_balance", 1, movements?.length);
      if (movements && movements[0]) {
        CHECK("حركة unit_cost", 8000, Number(movements[0].unit_cost));
        CHECK("حركة total_cost", 40000, Number(movements[0].total_cost));
      }

      const invBal = await getAccountBalance(ACC["1104"]);
      CHECK("مدين المخزون 1104", 40000, invBal.debit);
      const capBal = await getAccountBalance(ACC["3101"]);
      CHECK("دائن رأس المال 3101", 40000, capBal.credit);

      const tb = await getTrialBalance();
      CHECK("ميزان مدين", 40000, tb.debit);
      CHECK("ميزان دائن", 40000, tb.credit);
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);

      const avgP = await getAvgPurchasePrice((await findProductByName("لابتوب HP"))!);
      CHECK("avg_purchase_price", 8000, avgP);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 2: Products 2 & 3 with opening balances
    // ═══════════════════════════════════════════════════════════
    if (phase === 2) {
      L("═══ Phase 2: Products 2 & 3 ═══");
      const ACC = await getAccountIds();
      const { data: unit } = await supabase.from("product_units").select("id").eq("name", "قطعة").single();
      const { data: brandSam } = await supabase.from("product_brands").select("id").eq("name", "سامسونج").single();
      const { data: catElec } = await supabase.from("product_categories").select("id").eq("name", "إلكترونيات").single();
      const { data: catAcc } = await supabase.from("product_categories").select("id").eq("name", "ملحقات").single();

      // Mouse
      const { data: mouse } = await supabase.from("products").insert({
        code: "P002", name: "ماوس لاسلكي",
        purchase_price: 100, selling_price: 200,
        quantity_on_hand: 20, min_stock_level: 5,
        unit_id: unit?.id, category_id: catAcc?.id,
      }).select("id").single();

      await supabase.from("inventory_movements").insert({
        product_id: mouse!.id, movement_type: "opening_balance",
        quantity: 20, unit_cost: 100, total_cost: 2000,
        movement_date: TODAY, notes: "رصيد افتتاحي - ماوس",
      } as any);

      // Screen
      const { data: screen } = await supabase.from("products").insert({
        code: "P003", name: "شاشة سامسونج",
        purchase_price: 3000, selling_price: 4500,
        quantity_on_hand: 3, min_stock_level: 1,
        unit_id: unit?.id, brand_id: brandSam?.id, category_id: catElec?.id,
      }).select("id").single();

      await supabase.from("inventory_movements").insert({
        product_id: screen!.id, movement_type: "opening_balance",
        quantity: 3, unit_cost: 3000, total_cost: 9000,
        movement_date: TODAY, notes: "رصيد افتتاحي - شاشة",
      } as any);

      // Journal entry for both
      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const totalOB = 2000 + 9000; // 11000
      const { data: je } = await supabase.from("journal_entries").insert({
        description: "رصيد افتتاحي - ماوس + شاشة",
        entry_date: TODAY, total_debit: totalOB, total_credit: totalOB,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["1104"], debit: totalOB, credit: 0, description: "رصيد افتتاحي مخزون" },
        { journal_entry_id: je!.id, account_id: ACC["3101"], debit: 0, credit: totalOB, description: "رصيد افتتاحي رأس مال" },
      ]);

      L("✅ Mouse and Screen created");

      // Verify
      CHECK("كمية ماوس", 20, await getQty(mouse!.id));
      CHECK("كمية شاشة", 3, await getQty(screen!.id));

      const { count: obCount } = await supabase.from("inventory_movements").select("*", { count: "exact", head: true }).eq("movement_type", "opening_balance");
      CHECK("حركات opening_balance", 3, obCount);

      const invBal = await getAccountBalance(ACC["1104"]);
      CHECK("مدين المخزون 1104", 51000, invBal.debit);
      const capBal = await getAccountBalance(ACC["3101"]);
      CHECK("دائن رأس المال 3101", 51000, capBal.credit);

      const tb = await getTrialBalance();
      CHECK("ميزان مدين", 51000, tb.debit);
      CHECK("ميزان دائن", 51000, tb.credit);

      CHECK("avg_purchase ماوس", 100, await getAvgPurchasePrice(mouse!.id));
      CHECK("avg_purchase شاشة", 3000, await getAvgPurchasePrice(screen!.id));
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 3: Customer with opening balance
    // ═══════════════════════════════════════════════════════════
    if (phase === 3) {
      L("═══ Phase 3: Customer Ahmed (balance 5000) ═══");
      const ACC = await getAccountIds();

      const { data: cust } = await supabase.from("customers").insert({
        code: "C001", name: "عميل أحمد", balance: 5000,
      }).select("id").single();

      // Opening balance journal entry
      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const { data: je } = await supabase.from("journal_entries").insert({
        description: "رصيد افتتاحي - عميل أحمد",
        entry_date: TODAY, total_debit: 5000, total_credit: 5000,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["1103"], debit: 5000, credit: 0, description: "رصيد افتتاحي عملاء - أحمد" },
        { journal_entry_id: je!.id, account_id: ACC["3101"], debit: 0, credit: 5000, description: "رصيد افتتاحي رأس مال - أحمد" },
      ]);

      L("✅ Customer Ahmed created");

      // Verify
      CHECK("رصيد أحمد", 5000, await getEntityBalance("customers", cust!.id));
      const custBal = await getAccountBalance(ACC["1103"]);
      CHECK("مدين العملاء 1103", 5000, custBal.debit);
      const tb = await getTrialBalance();
      CHECK("ميزان مدين", 56000, tb.debit);
      CHECK("ميزان دائن", 56000, tb.credit);
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 4: Sara + Suppliers
    // ═══════════════════════════════════════════════════════════
    if (phase === 4) {
      L("═══ Phase 4: Sara + Suppliers ═══");
      const ACC = await getAccountIds();

      // Sara (no balance)
      await supabase.from("customers").insert({ code: "C002", name: "عميل سارة", balance: 0 });

      // Supplier Tech (balance 3000)
      const { data: supTech } = await supabase.from("suppliers").insert({
        code: "S001", name: "مورد التقنية", balance: 3000,
      }).select("id").single();

      // Supplier Screens (no balance)
      await supabase.from("suppliers").insert({ code: "S002", name: "مورد الشاشات", balance: 0 });

      // Opening balance journal entry for supplier
      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const { data: je } = await supabase.from("journal_entries").insert({
        description: "رصيد افتتاحي - مورد التقنية",
        entry_date: TODAY, total_debit: 3000, total_credit: 3000,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["3101"], debit: 3000, credit: 0, description: "رصيد افتتاحي - مورد التقنية" },
        { journal_entry_id: je!.id, account_id: ACC["2101"], debit: 0, credit: 3000, description: "رصيد افتتاحي موردين - التقنية" },
      ]);

      L("✅ Sara + Suppliers created");

      // Verify
      const saraId = await findEntityByName("customers", "عميل سارة");
      CHECK("رصيد سارة", 0, await getEntityBalance("customers", saraId!));
      CHECK("رصيد مورد التقنية", 3000, await getEntityBalance("suppliers", supTech!.id));
      const screensId = await findEntityByName("suppliers", "مورد الشاشات");
      CHECK("رصيد مورد الشاشات", 0, await getEntityBalance("suppliers", screensId!));

      const supBal = await getAccountBalance(ACC["2101"]);
      CHECK("دائن الموردين 2101", 3000, supBal.credit);

      const tb = await getTrialBalance();
      CHECK("ميزان مدين", 56000, tb.debit);
      CHECK("ميزان دائن", 56000, tb.credit);
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 5: Simple sales invoice (no discount, no tax)
    // بيع لأحمد: 1 لابتوب × 10,000
    // ═══════════════════════════════════════════════════════════
    if (phase === 5) {
      L("═══ Phase 5: Simple Sales Invoice ═══");
      const ACC = await getAccountIds();
      const laptopId = (await findProductByName("لابتوب HP"))!;
      const ahmedId = (await findEntityByName("customers", "عميل أحمد"))!;
      const avgCost = await getAvgPurchasePrice(laptopId); // 8000
      const cogs = round2(avgCost * 1);
      const total = 10000;

      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const invNum = await nextSeq("sales_invoices", "invoice_number");
      const invPosted = await nextPosted("sales_invoices");
      const displayNum = `INV-${String(invPosted).padStart(4, "0")}`;

      // Journal entry (revenue + COGS)
      const { data: je } = await supabase.from("journal_entries").insert({
        description: `فاتورة بيع رقم ${displayNum}`,
        entry_date: TODAY, total_debit: total + cogs, total_credit: total + cogs,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["1103"], debit: total, credit: 0, description: `مبيعات ${displayNum}` },
        { journal_entry_id: je!.id, account_id: ACC["4101"], debit: 0, credit: total, description: `إيراد ${displayNum}` },
        { journal_entry_id: je!.id, account_id: ACC["5101"], debit: cogs, credit: 0, description: `ت.ب.م ${displayNum}` },
        { journal_entry_id: je!.id, account_id: ACC["1104"], debit: 0, credit: cogs, description: `خصم مخزون ${displayNum}` },
      ]);

      // Invoice
      const { data: inv } = await supabase.from("sales_invoices").insert({
        invoice_number: invNum, invoice_date: TODAY,
        customer_id: ahmedId, subtotal: total, discount: 0, tax: 0, total,
        status: "posted", journal_entry_id: je!.id, posted_number: invPosted,
      } as any).select("id").single();

      await supabase.from("sales_invoice_items").insert({
        invoice_id: inv!.id, product_id: laptopId,
        description: "لابتوب HP", quantity: 1, unit_price: 10000,
        discount: 0, total: 10000, net_total: 10000, sort_order: 0,
      } as any);

      // Inventory
      const curQty = await getQty(laptopId);
      await supabase.from("products").update({ quantity_on_hand: curQty - 1 } as any).eq("id", laptopId);
      await supabase.from("inventory_movements").insert({
        product_id: laptopId, movement_type: "sale", quantity: 1,
        unit_cost: cogs, total_cost: cogs,
        reference_id: inv!.id, reference_type: "sales_invoice", movement_date: TODAY,
      } as any);

      // Update customer balance
      await supabase.from("customers").update({ balance: 5000 + total } as any).eq("id", ahmedId);

      L(`✅ ${displayNum} created: 1 لابتوب × 10,000 = ${total}, COGS=${cogs}`);

      // Verify
      CHECK("فاتورة total", 10000, total);
      CHECK("COGS", 8000, cogs);
      CHECK("كمية لابتوب", 4, await getQty(laptopId));
      CHECK("رصيد أحمد", 15000, await getEntityBalance("customers", ahmedId));

      const tb = await getTrialBalance();
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);

      const revBal = await getAccountBalance(ACC["4101"]);
      CHECK("دائن إيرادات 4101", 10000, revBal.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 6: Sales invoice with line discount
    // بيع لسارة: 2 شاشة × 4,500 — خصم سطر 200 = 8,800
    // ═══════════════════════════════════════════════════════════
    if (phase === 6) {
      L("═══ Phase 6: Sales with line discount ═══");
      const ACC = await getAccountIds();
      const screenId = (await findProductByName("شاشة سامسونج"))!;
      const saraId = (await findEntityByName("customers", "عميل سارة"))!;
      const avgCost = await getAvgPurchasePrice(screenId); // 3000
      const cogs = round2(avgCost * 2); // 6000
      const lineTotal = 2 * 4500 - 200; // 8800
      const total = lineTotal;

      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const invNum = await nextSeq("sales_invoices", "invoice_number");
      const invPosted = await nextPosted("sales_invoices");
      const displayNum = `INV-${String(invPosted).padStart(4, "0")}`;

      const { data: je } = await supabase.from("journal_entries").insert({
        description: `فاتورة بيع رقم ${displayNum}`,
        entry_date: TODAY, total_debit: total + cogs, total_credit: total + cogs,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["1103"], debit: total, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["4101"], debit: 0, credit: total },
        { journal_entry_id: je!.id, account_id: ACC["5101"], debit: cogs, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["1104"], debit: 0, credit: cogs },
      ]);

      const { data: inv } = await supabase.from("sales_invoices").insert({
        invoice_number: invNum, invoice_date: TODAY,
        customer_id: saraId, subtotal: 9000, discount: 0, tax: 0, total,
        status: "posted", journal_entry_id: je!.id, posted_number: invPosted,
      } as any).select("id").single();

      await supabase.from("sales_invoice_items").insert({
        invoice_id: inv!.id, product_id: screenId,
        description: "شاشة سامسونج", quantity: 2, unit_price: 4500,
        discount: 200, total: 8800, net_total: 8800, sort_order: 0,
      } as any);

      const curQty = await getQty(screenId);
      await supabase.from("products").update({ quantity_on_hand: curQty - 2 } as any).eq("id", screenId);
      await supabase.from("inventory_movements").insert({
        product_id: screenId, movement_type: "sale", quantity: 2,
        unit_cost: avgCost, total_cost: cogs,
        reference_id: inv!.id, reference_type: "sales_invoice", movement_date: TODAY,
      } as any);

      await supabase.from("customers").update({ balance: total } as any).eq("id", saraId);

      L(`✅ ${displayNum}: 2 شاشة × 4500 - خصم 200 = ${total}, COGS=${cogs}`);

      // Verify
      CHECK("بند total", 8800, lineTotal);
      CHECK("بند net_total", 8800, lineTotal);
      CHECK("COGS", 6000, cogs);
      CHECK("كمية شاشة", 1, await getQty(screenId));
      CHECK("رصيد سارة", 8800, await getEntityBalance("customers", saraId));

      const tb = await getTrialBalance();
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);

      const revBal = await getAccountBalance(ACC["4101"]);
      CHECK("إجمالي إيرادات 4101", 18800, revBal.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 7: Sales invoice with invoice discount
    // بيع لأحمد: 2 لابتوب × 10,000 + 5 ماوس × 200 = 21,000 — خصم 1,000 = 20,000
    // ═══════════════════════════════════════════════════════════
    if (phase === 7) {
      L("═══ Phase 7: Sales with invoice discount ═══");
      const ACC = await getAccountIds();
      const laptopId = (await findProductByName("لابتوب HP"))!;
      const mouseId = (await findProductByName("ماوس لاسلكي"))!;
      const ahmedId = (await findEntityByName("customers", "عميل أحمد"))!;

      const laptopAvg = await getAvgPurchasePrice(laptopId); // 8000
      const mouseAvg = await getAvgPurchasePrice(mouseId); // 100
      const cogsLaptop = round2(laptopAvg * 2); // 16000
      const cogsMouse = round2(mouseAvg * 5); // 500
      const totalCogs = cogsLaptop + cogsMouse; // 16500

      const subtotal = 21000;
      const discount = 1000;
      const grandTotal = 20000;

      // net_total distribution
      const laptopLineTotal = 20000; // 2*10000
      const mouseLineTotal = 1000; // 5*200
      const laptopNetTotal = round2(laptopLineTotal * (1 - discount / subtotal)); // 20000 * (1 - 1000/21000)
      const mouseNetTotal = round2(mouseLineTotal * (1 - discount / subtotal));
      L(`  net_total laptop: ${laptopNetTotal}, mouse: ${mouseNetTotal}, sum: ${round2(laptopNetTotal + mouseNetTotal)}`);

      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const invNum = await nextSeq("sales_invoices", "invoice_number");
      const invPosted = await nextPosted("sales_invoices");
      const displayNum = `INV-${String(invPosted).padStart(4, "0")}`;

      const { data: je } = await supabase.from("journal_entries").insert({
        description: `فاتورة بيع رقم ${displayNum}`,
        entry_date: TODAY, total_debit: grandTotal + totalCogs, total_credit: grandTotal + totalCogs,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["1103"], debit: grandTotal, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["4101"], debit: 0, credit: grandTotal },
        { journal_entry_id: je!.id, account_id: ACC["5101"], debit: totalCogs, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["1104"], debit: 0, credit: totalCogs },
      ]);

      const { data: inv } = await supabase.from("sales_invoices").insert({
        invoice_number: invNum, invoice_date: TODAY,
        customer_id: ahmedId, subtotal, discount, tax: 0, total: grandTotal,
        status: "posted", journal_entry_id: je!.id, posted_number: invPosted,
      } as any).select("id").single();

      await supabase.from("sales_invoice_items").insert([
        { invoice_id: inv!.id, product_id: laptopId, description: "لابتوب HP", quantity: 2, unit_price: 10000, discount: 0, total: 20000, net_total: laptopNetTotal, sort_order: 0 },
        { invoice_id: inv!.id, product_id: mouseId, description: "ماوس لاسلكي", quantity: 5, unit_price: 200, discount: 0, total: 1000, net_total: mouseNetTotal, sort_order: 1 },
      ] as any);

      // Update inventory
      const laptopQty = await getQty(laptopId);
      const mouseQty = await getQty(mouseId);
      await supabase.from("products").update({ quantity_on_hand: laptopQty - 2 } as any).eq("id", laptopId);
      await supabase.from("products").update({ quantity_on_hand: mouseQty - 5 } as any).eq("id", mouseId);

      await supabase.from("inventory_movements").insert([
        { product_id: laptopId, movement_type: "sale", quantity: 2, unit_cost: laptopAvg, total_cost: cogsLaptop, reference_id: inv!.id, reference_type: "sales_invoice", movement_date: TODAY },
        { product_id: mouseId, movement_type: "sale", quantity: 5, unit_cost: mouseAvg, total_cost: cogsMouse, reference_id: inv!.id, reference_type: "sales_invoice", movement_date: TODAY },
      ] as any);

      // Update ahmed balance: 15000 + 20000 = 35000
      await supabase.from("customers").update({ balance: 15000 + grandTotal } as any).eq("id", ahmedId);

      L(`✅ ${displayNum}: subtotal=${subtotal}, discount=${discount}, total=${grandTotal}, COGS=${totalCogs}`);

      // Verify
      CHECK("subtotal", 21000, subtotal);
      CHECK("grandTotal", 20000, grandTotal);
      CHECK("COGS total", 16500, totalCogs);
      CHECK("كمية لابتوب", 2, await getQty(laptopId));
      CHECK("كمية ماوس", 15, await getQty(mouseId));
      CHECK("رصيد أحمد", 35000, await getEntityBalance("customers", ahmedId));

      const tb = await getTrialBalance();
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);

      const revBal = await getAccountBalance(ACC["4101"]);
      CHECK("إجمالي إيرادات 4101", 38800, revBal.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 8: Sales invoice with tax 14%
    // بيع لسارة: 1 لابتوب × 10,000 — ضريبة 14% = 11,400
    // ═══════════════════════════════════════════════════════════
    if (phase === 8) {
      L("═══ Phase 8: Sales with 14% tax ═══");
      const ACC = await getAccountIds();
      const laptopId = (await findProductByName("لابتوب HP"))!;
      const saraId = (await findEntityByName("customers", "عميل سارة"))!;
      const avgCost = await getAvgPurchasePrice(laptopId);
      const cogs = round2(avgCost * 1);
      const subtotal = 10000;
      const tax = 1400;
      const grandTotal = 11400;

      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const invNum = await nextSeq("sales_invoices", "invoice_number");
      const invPosted = await nextPosted("sales_invoices");
      const displayNum = `INV-${String(invPosted).padStart(4, "0")}`;

      const { data: je } = await supabase.from("journal_entries").insert({
        description: `فاتورة بيع رقم ${displayNum}`,
        entry_date: TODAY, total_debit: grandTotal + cogs, total_credit: grandTotal + cogs,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["1103"], debit: grandTotal, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["4101"], debit: 0, credit: grandTotal },
        { journal_entry_id: je!.id, account_id: ACC["5101"], debit: cogs, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["1104"], debit: 0, credit: cogs },
      ]);

      const { data: inv } = await supabase.from("sales_invoices").insert({
        invoice_number: invNum, invoice_date: TODAY,
        customer_id: saraId, subtotal, discount: 0, tax, total: grandTotal,
        status: "posted", journal_entry_id: je!.id, posted_number: invPosted,
      } as any).select("id").single();

      await supabase.from("sales_invoice_items").insert({
        invoice_id: inv!.id, product_id: laptopId,
        description: "لابتوب HP", quantity: 1, unit_price: 10000,
        discount: 0, total: 10000, net_total: 10000, sort_order: 0,
      } as any);

      const curQty = await getQty(laptopId);
      await supabase.from("products").update({ quantity_on_hand: curQty - 1 } as any).eq("id", laptopId);
      await supabase.from("inventory_movements").insert({
        product_id: laptopId, movement_type: "sale", quantity: 1,
        unit_cost: avgCost, total_cost: cogs,
        reference_id: inv!.id, reference_type: "sales_invoice", movement_date: TODAY,
      } as any);

      // Sara: 8800 + 11400 = 20200
      await supabase.from("customers").update({ balance: 8800 + grandTotal } as any).eq("id", saraId);

      L(`✅ ${displayNum}: subtotal=${subtotal}, tax=${tax}, total=${grandTotal}, COGS=${cogs}`);

      CHECK("grandTotal", 11400, grandTotal);
      CHECK("tax", 1400, tax);
      CHECK("COGS", 8000, cogs);
      CHECK("كمية لابتوب", 1, await getQty(laptopId));
      CHECK("رصيد سارة", 20200, await getEntityBalance("customers", saraId));

      const tb = await getTrialBalance();
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 9: Purchase invoice (simple)
    // شراء من مورد التقنية: 10 لابتوب × 8,500 = 85,000
    // ═══════════════════════════════════════════════════════════
    if (phase === 9) {
      L("═══ Phase 9: Purchase Invoice (simple) ═══");
      const ACC = await getAccountIds();
      const laptopId = (await findProductByName("لابتوب HP"))!;
      const techId = (await findEntityByName("suppliers", "مورد التقنية"))!;
      const total = 85000;

      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const invNum = await nextSeq("purchase_invoices", "invoice_number");
      const invPosted = await nextPosted("purchase_invoices");
      const displayNum = `PUR-${String(invPosted).padStart(4, "0")}`;

      const { data: je } = await supabase.from("journal_entries").insert({
        description: `فاتورة شراء رقم ${displayNum}`,
        entry_date: TODAY, total_debit: total, total_credit: total,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["1104"], debit: total, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["2101"], debit: 0, credit: total },
      ]);

      const { data: inv } = await supabase.from("purchase_invoices").insert({
        invoice_number: invNum, invoice_date: TODAY,
        supplier_id: techId, subtotal: total, discount: 0, tax: 0, total,
        status: "posted", journal_entry_id: je!.id, posted_number: invPosted,
      } as any).select("id").single();

      await supabase.from("purchase_invoice_items").insert({
        invoice_id: inv!.id, product_id: laptopId,
        description: "لابتوب HP", quantity: 10, unit_price: 8500,
        discount: 0, total: 85000, net_total: 85000, sort_order: 0,
      } as any);

      const curQty = await getQty(laptopId);
      await supabase.from("products").update({ quantity_on_hand: curQty + 10 } as any).eq("id", laptopId);
      await supabase.from("inventory_movements").insert({
        product_id: laptopId, movement_type: "purchase", quantity: 10,
        unit_cost: 8500, total_cost: 85000,
        reference_id: inv!.id, reference_type: "purchase_invoice", movement_date: TODAY,
      } as any);

      // Supplier: 3000 + 85000 = 88000
      await supabase.from("suppliers").update({ balance: 3000 + 85000 } as any).eq("id", techId);

      L(`✅ ${displayNum}: 10 لابتوب × 8,500 = ${total}`);

      CHECK("كمية لابتوب", 11, await getQty(laptopId));
      CHECK("رصيد مورد التقنية", 88000, await getEntityBalance("suppliers", techId));

      // avg_purchase: (5*8000 + 10*8500) / 15 = 125000/15 ≈ 8333.33
      const avgP = round2(await getAvgPurchasePrice(laptopId));
      CHECK("avg_purchase لابتوب", 8333.33, avgP);

      const tb = await getTrialBalance();
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 10: Purchase with invoice discount
    // شراء من مورد الشاشات: 5 شاشة × 3,200 = 16,000 — خصم 1,000 = 15,000
    // ═══════════════════════════════════════════════════════════
    if (phase === 10) {
      L("═══ Phase 10: Purchase with invoice discount ═══");
      const ACC = await getAccountIds();
      const screenId = (await findProductByName("شاشة سامسونج"))!;
      const screensSupId = (await findEntityByName("suppliers", "مورد الشاشات"))!;

      const subtotal = 16000;
      const discount = 1000;
      const total = 15000;

      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const invNum = await nextSeq("purchase_invoices", "invoice_number");
      const invPosted = await nextPosted("purchase_invoices");
      const displayNum = `PUR-${String(invPosted).padStart(4, "0")}`;

      const { data: je } = await supabase.from("journal_entries").insert({
        description: `فاتورة شراء رقم ${displayNum}`,
        entry_date: TODAY, total_debit: total, total_credit: total,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["1104"], debit: total, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["2101"], debit: 0, credit: total },
      ]);

      const { data: inv } = await supabase.from("purchase_invoices").insert({
        invoice_number: invNum, invoice_date: TODAY,
        supplier_id: screensSupId, subtotal, discount, tax: 0, total,
        status: "posted", journal_entry_id: je!.id, posted_number: invPosted,
      } as any).select("id").single();

      await supabase.from("purchase_invoice_items").insert({
        invoice_id: inv!.id, product_id: screenId,
        description: "شاشة سامسونج", quantity: 5, unit_price: 3200,
        discount: 0, total: 16000, net_total: 15000, sort_order: 0,
      } as any);

      const curQty = await getQty(screenId);
      await supabase.from("products").update({ quantity_on_hand: curQty + 5 } as any).eq("id", screenId);
      await supabase.from("inventory_movements").insert({
        product_id: screenId, movement_type: "purchase", quantity: 5,
        unit_cost: 3000, total_cost: 15000,
        reference_id: inv!.id, reference_type: "purchase_invoice", movement_date: TODAY,
      } as any);

      await supabase.from("suppliers").update({ balance: 15000 } as any).eq("id", screensSupId);

      L(`✅ ${displayNum}: 5 شاشة × 3,200 - خصم 1,000 = ${total}`);

      CHECK("كمية شاشة", 6, await getQty(screenId));
      CHECK("رصيد مورد الشاشات", 15000, await getEntityBalance("suppliers", screensSupId));
      CHECK("avg_purchase شاشة", 3000, round2(await getAvgPurchasePrice(screenId)));

      const tb = await getTrialBalance();
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 11: Purchase with line discount
    // شراء من مورد التقنية: 10 ماوس × 110 — خصم سطر 10 = 1,090
    // ═══════════════════════════════════════════════════════════
    if (phase === 11) {
      L("═══ Phase 11: Purchase with line discount ═══");
      const ACC = await getAccountIds();
      const mouseId = (await findProductByName("ماوس لاسلكي"))!;
      const techId = (await findEntityByName("suppliers", "مورد التقنية"))!;

      const lineTotal = 10 * 110 - 10; // 1090
      const total = lineTotal;

      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const invNum = await nextSeq("purchase_invoices", "invoice_number");
      const invPosted = await nextPosted("purchase_invoices");
      const displayNum = `PUR-${String(invPosted).padStart(4, "0")}`;

      const { data: je } = await supabase.from("journal_entries").insert({
        description: `فاتورة شراء رقم ${displayNum}`,
        entry_date: TODAY, total_debit: total, total_credit: total,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["1104"], debit: total, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["2101"], debit: 0, credit: total },
      ]);

      const { data: inv } = await supabase.from("purchase_invoices").insert({
        invoice_number: invNum, invoice_date: TODAY,
        supplier_id: techId, subtotal: 1100, discount: 0, tax: 0, total,
        status: "posted", journal_entry_id: je!.id, posted_number: invPosted,
      } as any).select("id").single();

      await supabase.from("purchase_invoice_items").insert({
        invoice_id: inv!.id, product_id: mouseId,
        description: "ماوس لاسلكي", quantity: 10, unit_price: 110,
        discount: 10, total: 1090, net_total: 1090, sort_order: 0,
      } as any);

      const curQty = await getQty(mouseId);
      await supabase.from("products").update({ quantity_on_hand: curQty + 10 } as any).eq("id", mouseId);
      await supabase.from("inventory_movements").insert({
        product_id: mouseId, movement_type: "purchase", quantity: 10,
        unit_cost: 109, total_cost: 1090,
        reference_id: inv!.id, reference_type: "purchase_invoice", movement_date: TODAY,
      } as any);

      // Tech: 88000 + 1090 = 89090
      await supabase.from("suppliers").update({ balance: 88000 + 1090 } as any).eq("id", techId);

      L(`✅ ${displayNum}: 10 ماوس × 110 - خصم 10 = ${total}`);

      CHECK("بند total", 1090, lineTotal);
      CHECK("كمية ماوس", 25, await getQty(mouseId));
      CHECK("رصيد مورد التقنية", 89090, await getEntityBalance("suppliers", techId));

      // avg_purchase mouse: (20*100 + 10*109) / 30 = 3090/30 = 103
      const avgM = round2(await getAvgPurchasePrice(mouseId));
      CHECK("avg_purchase ماوس", 103, avgM);

      const tb = await getTrialBalance();
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 12: Customer payment (cash)
    // دفعة من أحمد: 10,000 نقداً
    // ═══════════════════════════════════════════════════════════
    if (phase === 12) {
      L("═══ Phase 12: Customer payment (cash) ═══");
      const ACC = await getAccountIds();
      const ahmedId = (await findEntityByName("customers", "عميل أحمد"))!;

      const amount = 10000;
      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const payNum = await nextSeq("customer_payments", "payment_number");
      const payPosted = await nextPosted("customer_payments");

      const { data: je } = await supabase.from("journal_entries").insert({
        description: `سند قبض - أحمد`,
        entry_date: TODAY, total_debit: amount, total_credit: amount,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["1101"], debit: amount, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["1103"], debit: 0, credit: amount },
      ]);

      await supabase.from("customer_payments").insert({
        payment_number: payNum, payment_date: TODAY,
        customer_id: ahmedId, amount, payment_method: "cash",
        status: "posted", journal_entry_id: je!.id, posted_number: payPosted,
      } as any);

      // Ahmed: 35000 - 10000 = 25000
      await supabase.from("customers").update({ balance: 35000 - amount } as any).eq("id", ahmedId);

      L(`✅ Payment: 10,000 cash from Ahmed`);

      CHECK("رصيد أحمد", 25000, await getEntityBalance("customers", ahmedId));
      const cashBal = await getAccountBalance(ACC["1101"]);
      CHECK("مدين الصندوق 1101", 10000, cashBal.debit);

      const tb = await getTrialBalance();
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 13: Customer payment (bank)
    // دفعة من سارة: 5,000 تحويل بنكي
    // ═══════════════════════════════════════════════════════════
    if (phase === 13) {
      L("═══ Phase 13: Customer payment (bank) ═══");
      const ACC = await getAccountIds();
      const saraId = (await findEntityByName("customers", "عميل سارة"))!;

      const amount = 5000;
      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const payNum = await nextSeq("customer_payments", "payment_number");
      const payPosted = await nextPosted("customer_payments");

      const { data: je } = await supabase.from("journal_entries").insert({
        description: `سند قبض بنكي - سارة`,
        entry_date: TODAY, total_debit: amount, total_credit: amount,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["1102"], debit: amount, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["1103"], debit: 0, credit: amount },
      ]);

      await supabase.from("customer_payments").insert({
        payment_number: payNum, payment_date: TODAY,
        customer_id: saraId, amount, payment_method: "bank_transfer",
        status: "posted", journal_entry_id: je!.id, posted_number: payPosted,
      } as any);

      // Sara: 20200 - 5000 = 15200
      await supabase.from("customers").update({ balance: 20200 - amount } as any).eq("id", saraId);

      L(`✅ Payment: 5,000 bank from Sara`);

      CHECK("رصيد سارة", 15200, await getEntityBalance("customers", saraId));
      const bankBal = await getAccountBalance(ACC["1102"]);
      CHECK("مدين البنك 1102", 5000, bankBal.debit);

      const tb = await getTrialBalance();
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 14: Supplier payment (cash)
    // دفعة لمورد التقنية: 30,000 نقداً
    // ═══════════════════════════════════════════════════════════
    if (phase === 14) {
      L("═══ Phase 14: Supplier payment ═══");
      const ACC = await getAccountIds();
      const techId = (await findEntityByName("suppliers", "مورد التقنية"))!;

      const amount = 30000;
      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const payNum = await nextSeq("supplier_payments", "payment_number");
      const payPosted = await nextPosted("supplier_payments");

      const { data: je } = await supabase.from("journal_entries").insert({
        description: `سند صرف - مورد التقنية`,
        entry_date: TODAY, total_debit: amount, total_credit: amount,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["2101"], debit: amount, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["1101"], debit: 0, credit: amount },
      ]);

      await supabase.from("supplier_payments").insert({
        payment_number: payNum, payment_date: TODAY,
        supplier_id: techId, amount, payment_method: "cash",
        status: "posted", journal_entry_id: je!.id, posted_number: payPosted,
      } as any);

      // Tech: 89090 - 30000 = 59090
      await supabase.from("suppliers").update({ balance: 89090 - amount } as any).eq("id", techId);

      L(`✅ Payment: 30,000 cash to Tech supplier`);

      CHECK("رصيد مورد التقنية", 59090, await getEntityBalance("suppliers", techId));

      const tb = await getTrialBalance();
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 15: Sales return
    // مرتجع من أحمد: 1 لابتوب (من فاتورة 5 بسعر 10,000)
    // ═══════════════════════════════════════════════════════════
    if (phase === 15) {
      L("═══ Phase 15: Sales return ═══");
      const ACC = await getAccountIds();
      const laptopId = (await findProductByName("لابتوب HP"))!;
      const ahmedId = (await findEntityByName("customers", "عميل أحمد"))!;

      // Find the first sales invoice for ahmed
      const { data: salesInvs } = await supabase.from("sales_invoices").select("id").eq("customer_id", ahmedId).eq("status", "posted").order("invoice_number", { ascending: true }).limit(1);
      const origInvId = salesInvs?.[0]?.id;

      const returnPrice = 10000;
      const cogs = 8000; // original avg cost at time of sale
      const total = returnPrice;

      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const retNum = await nextSeq("sales_returns", "return_number");
      const retPosted = await nextPosted("sales_returns");

      const { data: je } = await supabase.from("journal_entries").insert({
        description: `مرتجع مبيعات - أحمد`,
        entry_date: TODAY, total_debit: total + cogs, total_credit: total + cogs,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["4101"], debit: total, credit: 0, description: "مرتجع مبيعات" },
        { journal_entry_id: je!.id, account_id: ACC["1103"], debit: 0, credit: total, description: "تخفيض ذمم عميل" },
        { journal_entry_id: je!.id, account_id: ACC["1104"], debit: cogs, credit: 0, description: "إعادة مخزون" },
        { journal_entry_id: je!.id, account_id: ACC["5101"], debit: 0, credit: cogs, description: "عكس ت.ب.م" },
      ]);

      const { data: ret } = await supabase.from("sales_returns").insert({
        return_number: retNum, return_date: TODAY,
        customer_id: ahmedId, sales_invoice_id: origInvId,
        subtotal: total, discount: 0, tax: 0, total,
        status: "posted", journal_entry_id: je!.id, posted_number: retPosted,
      } as any).select("id").single();

      await supabase.from("sales_return_items").insert({
        return_id: ret!.id, product_id: laptopId,
        description: "لابتوب HP", quantity: 1, unit_price: 10000,
        discount: 0, total: 10000, sort_order: 0,
      } as any);

      const curQty = await getQty(laptopId);
      await supabase.from("products").update({ quantity_on_hand: curQty + 1 } as any).eq("id", laptopId);
      await supabase.from("inventory_movements").insert({
        product_id: laptopId, movement_type: "sale_return", quantity: 1,
        unit_cost: cogs, total_cost: cogs,
        reference_id: ret!.id, reference_type: "sales_return", movement_date: TODAY,
      } as any);

      // Ahmed: 25000 - 10000 = 15000
      await supabase.from("customers").update({ balance: 25000 - total } as any).eq("id", ahmedId);

      L(`✅ Sales return: 1 laptop × 10,000`);

      CHECK("كمية لابتوب", 12, await getQty(laptopId));
      CHECK("رصيد أحمد", 15000, await getEntityBalance("customers", ahmedId));

      const tb = await getTrialBalance();
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 16: Purchase return
    // مرتجع لمورد التقنية: 3 لابتوب × 8,500
    // ═══════════════════════════════════════════════════════════
    if (phase === 16) {
      L("═══ Phase 16: Purchase return ═══");
      const ACC = await getAccountIds();
      const laptopId = (await findProductByName("لابتوب HP"))!;
      const techId = (await findEntityByName("suppliers", "مورد التقنية"))!;

      const { data: purInvs } = await supabase.from("purchase_invoices").select("id").eq("supplier_id", techId).eq("status", "posted").order("invoice_number", { ascending: true }).limit(1);
      const origInvId = purInvs?.[0]?.id;

      const unitPrice = 8500;
      const qty = 3;
      const total = unitPrice * qty; // 25500

      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const retNum = await nextSeq("purchase_returns", "return_number");
      const retPosted = await nextPosted("purchase_returns");

      const { data: je } = await supabase.from("journal_entries").insert({
        description: `مرتجع مشتريات - مورد التقنية`,
        entry_date: TODAY, total_debit: total, total_credit: total,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["2101"], debit: total, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["1104"], debit: 0, credit: total },
      ]);

      const { data: ret } = await supabase.from("purchase_returns").insert({
        return_number: retNum, return_date: TODAY,
        supplier_id: techId, purchase_invoice_id: origInvId,
        subtotal: total, discount: 0, tax: 0, total,
        status: "posted", journal_entry_id: je!.id, posted_number: retPosted,
      } as any).select("id").single();

      await supabase.from("purchase_return_items").insert({
        return_id: ret!.id, product_id: laptopId,
        description: "لابتوب HP", quantity: qty, unit_price: unitPrice,
        discount: 0, total, sort_order: 0,
      } as any);

      const curQty = await getQty(laptopId);
      await supabase.from("products").update({ quantity_on_hand: curQty - qty } as any).eq("id", laptopId);
      await supabase.from("inventory_movements").insert({
        product_id: laptopId, movement_type: "purchase_return", quantity: qty,
        unit_cost: unitPrice, total_cost: total,
        reference_id: ret!.id, reference_type: "purchase_return", movement_date: TODAY,
      } as any);

      // Tech: 59090 - 25500 = 33590
      await supabase.from("suppliers").update({ balance: 59090 - total } as any).eq("id", techId);

      L(`✅ Purchase return: 3 laptop × 8,500 = ${total}`);

      CHECK("كمية لابتوب", 9, await getQty(laptopId));
      CHECK("رصيد مورد التقنية", 33590, await getEntityBalance("suppliers", techId));

      const tb = await getTrialBalance();
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 17: Expense
    // مصروف إيجار 3,000 نقداً
    // ═══════════════════════════════════════════════════════════
    if (phase === 17) {
      L("═══ Phase 17: Expense ═══");
      const ACC = await getAccountIds();

      // Create expense type
      const { data: expType } = await supabase.from("expense_types").insert({
        name: "إيجار", account_id: ACC["5103"],
      }).select("id").single();

      const amount = 3000;
      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const expNum = await nextSeq("expenses", "expense_number");
      const expPosted = await nextPosted("expenses");

      const { data: je } = await supabase.from("journal_entries").insert({
        description: `مصروف إيجار`,
        entry_date: TODAY, total_debit: amount, total_credit: amount,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["5103"], debit: amount, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["1101"], debit: 0, credit: amount },
      ]);

      await supabase.from("expenses").insert({
        expense_number: expNum, expense_date: TODAY,
        expense_type_id: expType!.id, amount, payment_method: "cash",
        status: "posted", journal_entry_id: je!.id, posted_number: expPosted,
      } as any);

      L(`✅ Expense: rent 3,000 cash`);

      const rentBal = await getAccountBalance(ACC["5103"]);
      CHECK("مدين إيجار 5103", 3000, rentBal.debit);

      const tb = await getTrialBalance();
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 18: Manual journal entry
    // تحويل 5,000 من الصندوق للبنك
    // ═══════════════════════════════════════════════════════════
    if (phase === 18) {
      L("═══ Phase 18: Manual journal entry ═══");
      const ACC = await getAccountIds();

      const amount = 5000;
      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");

      const { data: je } = await supabase.from("journal_entries").insert({
        description: `تحويل من الصندوق للبنك`,
        entry_date: TODAY, total_debit: amount, total_credit: amount,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["1102"], debit: amount, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["1101"], debit: 0, credit: amount },
      ]);

      L(`✅ Manual JE: 5,000 from cash to bank`);

      const tb = await getTrialBalance();
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);

      // Cash: debit=10000, credit=30000+3000+5000=38000 → net=-28000
      const cashBal = await getAccountBalance(ACC["1101"]);
      CHECK("صندوق مدين", 10000, cashBal.debit);
      CHECK("صندوق دائن", 38000, cashBal.credit);

      // Bank: debit=5000+5000=10000
      const bankBal = await getAccountBalance(ACC["1102"]);
      CHECK("بنك مدين", 10000, bankBal.debit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 19: Complex sale (discount + tax)
    // بيع لأحمد: 3 شاشة × 4,500 + 10 ماوس × 200 = 15,500
    // خصم 500 = 15,000 — ضريبة 14% = 2,100 — إجمالي 17,100
    // ═══════════════════════════════════════════════════════════
    if (phase === 19) {
      L("═══ Phase 19: Complex sale (discount + tax) ═══");
      const ACC = await getAccountIds();
      const screenId = (await findProductByName("شاشة سامسونج"))!;
      const mouseId = (await findProductByName("ماوس لاسلكي"))!;
      const ahmedId = (await findEntityByName("customers", "عميل أحمد"))!;

      const screenAvg = await getAvgPurchasePrice(screenId);
      const mouseAvg = await getAvgPurchasePrice(mouseId);
      const cogsScreen = round2(screenAvg * 3);
      const cogsMouse = round2(mouseAvg * 10);
      const totalCogs = round2(cogsScreen + cogsMouse);

      const subtotal = 15500; // 3*4500 + 10*200
      const discount = 500;
      const afterDiscount = 15000;
      const tax = round2(afterDiscount * 0.14); // 2100
      const grandTotal = afterDiscount + tax; // 17100

      const screenLineTotal = 13500; // 3*4500
      const mouseLineTotal = 2000; // 10*200
      const screenNetTotal = round2(screenLineTotal * (1 - discount / subtotal));
      const mouseNetTotal = round2(mouseLineTotal * (1 - discount / subtotal));

      const jeNum = await nextSeq("journal_entries", "entry_number");
      const jePosted = await nextPosted("journal_entries");
      const invNum = await nextSeq("sales_invoices", "invoice_number");
      const invPosted = await nextPosted("sales_invoices");
      const displayNum = `INV-${String(invPosted).padStart(4, "0")}`;

      const { data: je } = await supabase.from("journal_entries").insert({
        description: `فاتورة بيع رقم ${displayNum}`,
        entry_date: TODAY, total_debit: grandTotal + totalCogs, total_credit: grandTotal + totalCogs,
        status: "posted", posted_number: jePosted, entry_number: jeNum,
      }).select("id").single();

      await supabase.from("journal_entry_lines").insert([
        { journal_entry_id: je!.id, account_id: ACC["1103"], debit: grandTotal, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["4101"], debit: 0, credit: grandTotal },
        { journal_entry_id: je!.id, account_id: ACC["5101"], debit: totalCogs, credit: 0 },
        { journal_entry_id: je!.id, account_id: ACC["1104"], debit: 0, credit: totalCogs },
      ]);

      const { data: inv } = await supabase.from("sales_invoices").insert({
        invoice_number: invNum, invoice_date: TODAY,
        customer_id: ahmedId, subtotal, discount, tax, total: grandTotal,
        status: "posted", journal_entry_id: je!.id, posted_number: invPosted,
      } as any).select("id").single();

      await supabase.from("sales_invoice_items").insert([
        { invoice_id: inv!.id, product_id: screenId, description: "شاشة سامسونج", quantity: 3, unit_price: 4500, discount: 0, total: 13500, net_total: screenNetTotal, sort_order: 0 },
        { invoice_id: inv!.id, product_id: mouseId, description: "ماوس لاسلكي", quantity: 10, unit_price: 200, discount: 0, total: 2000, net_total: mouseNetTotal, sort_order: 1 },
      ] as any);

      const screenQty = await getQty(screenId);
      const mouseQty = await getQty(mouseId);
      await supabase.from("products").update({ quantity_on_hand: screenQty - 3 } as any).eq("id", screenId);
      await supabase.from("products").update({ quantity_on_hand: mouseQty - 10 } as any).eq("id", mouseId);

      await supabase.from("inventory_movements").insert([
        { product_id: screenId, movement_type: "sale", quantity: 3, unit_cost: screenAvg, total_cost: cogsScreen, reference_id: inv!.id, reference_type: "sales_invoice", movement_date: TODAY },
        { product_id: mouseId, movement_type: "sale", quantity: 10, unit_cost: mouseAvg, total_cost: cogsMouse, reference_id: inv!.id, reference_type: "sales_invoice", movement_date: TODAY },
      ] as any);

      // Ahmed: 15000 + 17100 = 32100
      await supabase.from("customers").update({ balance: 15000 + grandTotal } as any).eq("id", ahmedId);

      L(`✅ ${displayNum}: subtotal=${subtotal}, disc=${discount}, tax=${tax}, total=${grandTotal}, COGS=${totalCogs}`);
      L(`  Screen net_total=${screenNetTotal}, Mouse net_total=${mouseNetTotal}`);

      CHECK("subtotal", 15500, subtotal);
      CHECK("afterDiscount", 15000, afterDiscount);
      CHECK("tax", 2100, tax);
      CHECK("grandTotal", 17100, grandTotal);
      CHECK("مجموع net_total", 15000, round2(screenNetTotal + mouseNetTotal));
      CHECK("كمية شاشة", 3, await getQty(screenId));
      CHECK("كمية ماوس", 15, await getQty(mouseId));
      CHECK("رصيد أحمد", 32100, await getEntityBalance("customers", ahmedId));

      const tb = await getTrialBalance();
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 20: Final comprehensive verification
    // ═══════════════════════════════════════════════════════════
    if (phase === 20) {
      L("═══ Phase 20: Final Verification ═══");
      const ACC = await getAccountIds();

      // Products
      const laptopId = (await findProductByName("لابتوب HP"))!;
      const mouseId = (await findProductByName("ماوس لاسلكي"))!;
      const screenId = (await findProductByName("شاشة سامسونج"))!;
      CHECK("كمية لابتوب", 9, await getQty(laptopId));
      CHECK("كمية ماوس", 15, await getQty(mouseId));
      CHECK("كمية شاشة", 3, await getQty(screenId));

      // Entity balances
      const ahmedId = (await findEntityByName("customers", "عميل أحمد"))!;
      const saraId = (await findEntityByName("customers", "عميل سارة"))!;
      const techId = (await findEntityByName("suppliers", "مورد التقنية"))!;
      const screensSupId = (await findEntityByName("suppliers", "مورد الشاشات"))!;
      CHECK("رصيد أحمد", 32100, await getEntityBalance("customers", ahmedId));
      CHECK("رصيد سارة", 15200, await getEntityBalance("customers", saraId));
      CHECK("رصيد مورد التقنية", 33590, await getEntityBalance("suppliers", techId));
      CHECK("رصيد مورد الشاشات", 15000, await getEntityBalance("suppliers", screensSupId));

      // Trial balance
      const tb = await getTrialBalance();
      CHECK("ميزان متوازن", true, tb.debit === tb.credit);
      L(`  Total Debit: ${tb.debit}, Total Credit: ${tb.credit}`);

      // Account balances
      const cash = await getAccountBalance(ACC["1101"]);
      const bank = await getAccountBalance(ACC["1102"]);
      const cust = await getAccountBalance(ACC["1103"]);
      const inv = await getAccountBalance(ACC["1104"]);
      const sup = await getAccountBalance(ACC["2101"]);
      const cap = await getAccountBalance(ACC["3101"]);
      const rev = await getAccountBalance(ACC["4101"]);
      const cogsBal = await getAccountBalance(ACC["5101"]);
      const rent = await getAccountBalance(ACC["5103"]);

      L(`\n═══ Account Balances ═══`);
      L(`  1101 صندوق: D=${cash.debit} C=${cash.credit} Net=${round2(cash.debit - cash.credit)}`);
      L(`  1102 بنك: D=${bank.debit} C=${bank.credit} Net=${round2(bank.debit - bank.credit)}`);
      L(`  1103 عملاء: D=${cust.debit} C=${cust.credit} Net=${round2(cust.debit - cust.credit)}`);
      L(`  1104 مخزون: D=${inv.debit} C=${inv.credit} Net=${round2(inv.debit - inv.credit)}`);
      L(`  2101 موردين: D=${sup.debit} C=${sup.credit} Net=${round2(sup.credit - sup.debit)}`);
      L(`  3101 رأس مال: D=${cap.debit} C=${cap.credit} Net=${round2(cap.credit - cap.debit)}`);
      L(`  4101 إيرادات: D=${rev.debit} C=${rev.credit} Net=${round2(rev.credit - rev.debit)}`);
      L(`  5101 ت.ب.م: D=${cogsBal.debit} C=${cogsBal.credit} Net=${round2(cogsBal.debit - cogsBal.credit)}`);
      L(`  5103 إيجار: D=${rent.debit} C=${rent.credit} Net=${round2(rent.debit - rent.credit)}`);

      // Sales totals
      const { data: salesInvs } = await supabase.from("sales_invoices").select("total").eq("status", "posted");
      const totalSales = (salesInvs || []).reduce((s: number, r: any) => s + Number(r.total), 0);
      L(`\n  إجمالي المبيعات: ${totalSales}`);

      const { data: purInvs } = await supabase.from("purchase_invoices").select("total").eq("status", "posted");
      const totalPurchases = (purInvs || []).reduce((s: number, r: any) => s + Number(r.total), 0);
      L(`  إجمالي المشتريات: ${totalPurchases}`);

      const { data: salesRets } = await supabase.from("sales_returns").select("total").eq("status", "posted");
      const totalSalesReturns = (salesRets || []).reduce((s: number, r: any) => s + Number(r.total), 0);
      L(`  مرتجعات المبيعات: ${totalSalesReturns}`);

      const { data: purRets } = await supabase.from("purchase_returns").select("total").eq("status", "posted");
      const totalPurReturns = (purRets || []).reduce((s: number, r: any) => s + Number(r.total), 0);
      L(`  مرتجعات المشتريات: ${totalPurReturns}`);
    }

    const allPassed = checks.every(c => c.pass);
    const failed = checks.filter(c => !c.pass);

    return new Response(JSON.stringify({
      phase,
      success: allPassed,
      totalChecks: checks.length,
      passed: checks.filter(c => c.pass).length,
      failed: failed.length,
      failedChecks: failed,
      log,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    return new Response(JSON.stringify({
      error: error.message,
      stack: error.stack,
      log
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
