import { round2 } from "@/lib/utils";
import { BALANCE_TOLERANCE } from "@/lib/constants";
import {
  summarizeMovements,
  type InventoryMovementRow,
} from "@/lib/inventory-metrics";


/**
 * ─────────────────────────────────────────────────────────────
 *  reconciliation.ts — قواعد صحّة البيانات (منطق نقي قابل للاختبار)
 * ─────────────────────────────────────────────────────────────
 *  كل قاعدة تُعيد نتيجة موحّدة: سليم / انحراف + الصفوف المسبّبة.
 *  الشاشة تعرض فقط — لا تحسب.
 */

export type CheckSeverity = "ok" | "info" | "warning" | "error" | "unavailable";

export interface CheckIssue {
  /** معرّف السجل المسبّب (منتج، قيد، عميل...) */
  id: string;
  /** وصف قصير للسجل (كود + اسم / رقم القيد) */
  label: string;
  /** القيمة المتوقعة */
  expected: number | string;
  /** القيمة الفعلية */
  actual: number | string;
  /** الفرق (رقمي فقط) */
  diff?: number;
  /** مسار لفتح المستند المسبّب */
  link?: string;
  /** تفسير منشأ الفرق (يظهر تحت اسم السجل) */
  note?: string;
  /** كيف تُنسَّق الأرقام في العرض */
  unit?: "currency" | "qty" | "text";
}

export interface CheckResult {
  key: string;
  title: string;
  /** ما يعنيه الانحراف عمليًا */
  meaning: string;
  /** المعادلة/القاعدة المستخدمة بصيغة مقروءة */
  formula?: string;
  /** الإجراء المقترح عند وجود انحراف */
  action?: string;
  severity: CheckSeverity;
  /** عدد السجلات التي فُحصت */
  checked: number;
  issues: CheckIssue[];
  /** سبب تعذّر تنفيذ الفحص (عند severity = unavailable) */
  unavailableReason?: string;
}

const withIssues = (

  base: Omit<CheckResult, "severity" | "issues">,
  issues: CheckIssue[],
  severity: CheckSeverity = "error",
): CheckResult => ({
  ...base,
  severity: issues.length > 0 ? severity : "ok",
  issues,
});

/* ─── 1) كمية المنتج = مجموع حركات المخزون ─── */

export interface ProductQtyRow {
  id: string;
  code: string;
  name: string;
  quantity_on_hand: number | string | null;
  purchase_price?: number | string | null;
  is_active?: boolean | null;
}

export function checkProductQuantities(
  products: ProductQtyRow[],
  movements: InventoryMovementRow[],
  tolerance = BALANCE_TOLERANCE,
): CheckResult {
  const summaries = summarizeMovements(movements);
  const issues: CheckIssue[] = [];

  // نستثني المنتجات غير النشطة التي لا كمية لها ولا حركات — لا معنى لفحصها
  const scoped = products.filter((p) => {
    const hasMoves = summaries.has(p.id);
    const qty = Number(p.quantity_on_hand ?? 0);
    if (p.is_active === false && !hasMoves && Math.abs(qty) <= tolerance) return false;
    return true;
  });

  for (const p of scoped) {
    const summary = summaries.get(p.id);
    const expected = round2(summary?.quantity ?? 0);
    const actual = round2(Number(p.quantity_on_hand ?? 0));
    const diff = round2(actual - expected);
    if (Math.abs(diff) > tolerance) {
      const note = !summary
        ? "كمية في بطاقة المنتج بدون أي حركة مخزون — تحتاج حركة/تسوية مقابلة"
        : Math.abs(actual) <= tolerance
          ? "حركات مخزون بدون كمية في بطاقة المنتج — الكمية لم تُحدَّث"
          : "الكمية المخزّنة لا تساوي صافي الحركات — ترحيل ناقص أو تعديل يدوي";
      issues.push({
        id: p.id,
        label: `[${p.code}] ${p.name}`,
        expected,
        actual,
        diff,
        note,
        unit: "qty",
        link: `/products/${p.id}`,
      });
    }
  }

  return withIssues(
    {
      key: "product_quantities",
      title: "كمية المنتجات مطابقة لحركات المخزون",
      meaning:
        "الكمية المتاحة في بطاقة المنتج يجب أن تساوي صافي حركات المخزون. أي فرق يعني كمية غير مبرّرة بمستند.",
      formula: "الكمية المتوقعة = Σ (الوارد − المنصرف) من حركات المخزون",
      action: "افتح بطاقة المنتج وأنشئ تسوية مخزون بالفرق، أو أعد ترحيل المستند الناقص.",
      checked: scoped.length,
    },
    issues,
  );
}

/* ─── 2) قيمة المخزون الدفترية = التقييم الرسمي بـ WAC ─── */

export interface InventoryValueCheck extends CheckResult {
  ledgerValue: number | null;
  computedValue: number | null;
}

/**
 * مقارنة رصيد حساب المخزون (1104) مع قيمة التقييم القادمة من دالة
 * `get_inventory_valuation` — نفس مصدر تقرير تقييم المخزون.
 * إن تعذّر قراءة أي من الطرفين لا يُعلن انحراف إطلاقًا (لا مقارنة مع صفر وهمي).
 */
export function checkInventoryValue(input: {
  computedValue: number | null | undefined;
  ledgerBalance: number | null | undefined;
  productsChecked: number;
  /** ما دون هذا الحد يُعدّ مطابقًا */
  tolerance?: number;
  /** ما دون هذا الحد يُعدّ تحذيرًا وليس انحرافًا حرجًا */
  warnTolerance?: number;
}): InventoryValueCheck {
  const { productsChecked } = input;
  const tolerance = input.tolerance ?? 1;
  const warnTolerance = input.warnTolerance ?? 1000;

  const base = {
    key: "inventory_value",
    title: "قيمة المخزون الدفترية مطابقة للتقييم بـ WAC",
    meaning:
      "رصيد حساب المخزون في دفتر الأستاذ يجب أن يساوي قيمة التقييم بمتوسط التكلفة المرجّح لكل الأصناف.",
    formula:
      "المتوقع = قيمة التقييم من get_inventory_valuation • الفعلي = مدين − دائن لحساب 1104 من القيود المرحّلة",
    action:
      "راجع شاشة مطابقة المخزون: الفرق عادةً تسوية مخزون بلا قيد، أو قيد مخزون يدوي بلا حركة.",
    checked: productsChecked,
  };

  const computed =
    input.computedValue === null || input.computedValue === undefined
      ? null
      : round2(input.computedValue);
  const ledger =
    input.ledgerBalance === null || input.ledgerBalance === undefined
      ? null
      : round2(input.ledgerBalance);

  if (computed === null || ledger === null) {
    return {
      ...base,
      severity: "unavailable",
      issues: [],
      unavailableReason:
        computed === null && ledger === null
          ? "تعذّر قراءة قيمة التقييم ورصيد حساب المخزون — لم تُنفَّذ المقارنة."
          : computed === null
            ? "تعذّر قراءة قيمة التقييم (get_inventory_valuation) — لم تُنفَّذ المقارنة."
            : "تعذّر قراءة رصيد حساب المخزون 1104 — لم تُنفَّذ المقارنة.",
      ledgerValue: ledger,
      computedValue: computed,
    };
  }

  const diff = round2(ledger - computed);
  const isIssue = Math.abs(diff) > tolerance;
  const issues: CheckIssue[] = isIssue
    ? [
        {
          id: "inventory_account",
          label: "حساب المخزون (1104)",
          expected: computed,
          actual: ledger,
          diff,
          unit: "currency",
          note:
            Math.abs(diff) <= warnTolerance
              ? "فرق محدود — يُراجع كتسوية تكلفة أو تقريب"
              : "فرق كبير — يوجد قيد مخزون بلا حركة أو حركة بلا قيد",
          link: "/reports/inventory-reconciliation",
        },
      ]
    : [];

  return {
    ...base,
    severity: !isIssue ? "ok" : Math.abs(diff) <= warnTolerance ? "warning" : "error",
    issues,
    ledgerValue: ledger,
    computedValue: computed,
  };
}

/* ─── 2ب) توازن ميزان المراجعة (إجمالي مدين = إجمالي دائن) ─── */

export function checkTrialBalance(
  totalDebit: number | null | undefined,
  totalCredit: number | null | undefined,
  tolerance = BALANCE_TOLERANCE,
): CheckResult {
  const base = {
    key: "trial_balance",
    title: "ميزان المراجعة متوازن",
    meaning: "مجموع المدين لكل الحسابات يجب أن يساوي مجموع الدائن في القيود المرحّلة.",
    formula: "Σ مدين (كل الحسابات) = Σ دائن (كل الحسابات) — القيود المرحّلة فقط",
    action: "افتح دفتر اليومية وابحث عن قيد غير متوازن أو قيد بسطور ناقصة.",
    checked: 1,
  };

  if (
    totalDebit === null ||
    totalDebit === undefined ||
    totalCredit === null ||
    totalCredit === undefined
  ) {
    return {
      ...base,
      severity: "unavailable",
      issues: [],
      unavailableReason: "تعذّر قراءة إجماليات الأرصدة — لم تُنفَّذ المقارنة.",
    };
  }

  const debit = round2(totalDebit);
  const credit = round2(totalCredit);
  const diff = round2(debit - credit);

  return withIssues(
    base,
    Math.abs(diff) > tolerance
      ? [
          {
            id: "trial_balance",
            label: "إجمالي دفتر الأستاذ",
            expected: credit,
            actual: debit,
            diff,
            unit: "currency",
            note: "فرق بين إجمالي المدين والدائن في القيود المرحّلة",
            link: "/journal",
          },
        ]
      : [],
  );
}


/* ─── 3) توازن القيود (رأس القيد وسطوره) ─── */

export interface JournalEntryRow {
  id: string;
  entry_number: number | string | null;
  posted_number?: number | string | null;
  total_debit: number | string | null;
  total_credit: number | string | null;
  status?: string | null;
}

export interface JournalLineRow {
  journal_entry_id: string;
  debit: number | string | null;
  credit: number | string | null;
}

const entryLabel = (e: JournalEntryRow) =>
  `قيد #${e.posted_number ?? e.entry_number ?? "—"}`;

export function checkJournalBalance(
  entries: JournalEntryRow[],
  lines: JournalLineRow[],
  tolerance = BALANCE_TOLERANCE,
): CheckResult {
  const perEntry = new Map<string, { debit: number; credit: number }>();
  for (const l of lines) {
    const cur = perEntry.get(l.journal_entry_id) ?? { debit: 0, credit: 0 };
    cur.debit += Number(l.debit ?? 0);
    cur.credit += Number(l.credit ?? 0);
    perEntry.set(l.journal_entry_id, cur);
  }

  const issues: CheckIssue[] = [];
  for (const e of entries) {
    const sums = perEntry.get(e.id) ?? { debit: 0, credit: 0 };
    const debit = round2(sums.debit);
    const credit = round2(sums.credit);
    const headDebit = round2(Number(e.total_debit ?? 0));
    const headCredit = round2(Number(e.total_credit ?? 0));

    // (أ) سطور غير متوازنة
    if (Math.abs(debit - credit) > tolerance) {
      issues.push({
        id: e.id,
        label: `${entryLabel(e)} — سطور غير متوازنة`,
        expected: debit,
        actual: credit,
        diff: round2(debit - credit),
        link: `/journal/${e.id}`,
      });
      continue;
    }

    // (ب) رأس القيد لا يطابق مجموع السطور
    if (
      Math.abs(headDebit - debit) > tolerance ||
      Math.abs(headCredit - credit) > tolerance
    ) {
      const debitMismatch = Math.abs(headDebit - debit) > tolerance;
      const expected = debitMismatch ? debit : credit;
      const actual = debitMismatch ? headDebit : headCredit;
      issues.push({
        id: e.id,
        label: `${entryLabel(e)} — الإجمالي لا يطابق السطور`,
        expected,
        actual,
        diff: round2(actual - expected),
        unit: "currency",
        note: debitMismatch
          ? "إجمالي المدين المخزن في رأس القيد لا يساوي مجموع السطور"
          : "إجمالي الدائن المخزن في رأس القيد لا يساوي مجموع السطور",
        link: `/journal/${e.id}`,
      });
    }
  }

  return withIssues(
    {
      key: "journal_balance",
      title: "توازن القيود المحاسبية",
      meaning:
        "كل قيد يجب أن يكون مجموع مدينه = مجموع دائنه، وأن يطابق إجمالي الرأس مجموع السطور.",
      checked: entries.length,
    },
    issues,
  );
}

/* ─── 4) القيود بلا سطور ─── */

export function checkOrphanEntries(
  entries: JournalEntryRow[],
  lines: JournalLineRow[],
): CheckResult {
  const withLines = new Set(lines.map((l) => l.journal_entry_id));
  const issues: CheckIssue[] = entries
    .filter((e) => !withLines.has(e.id))
    .map((e) => ({
      id: e.id,
      label: entryLabel(e),
      expected: "سطر واحد على الأقل",
      actual: "لا سطور",
      link: `/journal/${e.id}`,
    }));

  return withIssues(
    {
      key: "orphan_entries",
      title: "لا توجد قيود بلا سطور",
      meaning: "قيد بلا سطور لا أثر له محاسبيًا ويجب حذفه أو استكماله.",
      checked: entries.length,
    },
    issues,
  );
}

/* ─── 5) تسلسل أرقام النشر (posted_number) ─── */

export interface PostedNumberRow {
  id: string;
  posted_number: number | string | null;
  status?: string | null;
}

/**
 * تُمرَّر كل الصفوف (مرحّلة وملغاة ومسودات سبق ترحيلها) لأن الرقم يبقى
 * مستهلكًا بعد الإلغاء أو الإرجاع لمسودة — وهذه حالة مشروعة لا انحراف.
 */
export function checkPostedNumberSequence(
  rows: PostedNumberRow[],
  label: string,
): CheckResult {
  const numbers = rows
    .map((r) => ({ id: r.id, n: Number(r.posted_number ?? 0), status: r.status ?? null }))
    .filter((r) => r.n > 0)
    .sort((a, b) => a.n - b.n);

  const holders = new Map<number, PostedNumberRow[]>();
  for (const r of numbers) {
    const list = holders.get(r.n) ?? [];
    list.push({ id: r.id, posted_number: r.n, status: r.status });
    holders.set(r.n, list);
  }

  const duplicates: CheckIssue[] = [];
  const gaps: CheckIssue[] = [];

  for (const [n, list] of holders) {
    if (list.length > 1) {
      duplicates.push({
        id: list[0].id,
        label: `${label} — رقم مكرر ${n}`,
        expected: "رقم فريد",
        actual: `${list.length} مستندات بنفس الرقم`,
        unit: "text",
        note: "ترقيم مزدوج فعلي — يجب تصحيح أحد المستندين",
      });
    }
  }

  for (let i = 1; i < numbers.length; i += 1) {
    const prev = numbers[i - 1].n;
    const n = numbers[i].n;
    if (n <= prev) continue;
    const missing: number[] = [];
    for (let m = prev + 1; m < n; m += 1) {
      if (!holders.has(m)) missing.push(m);
    }
    if (missing.length > 0) {
      gaps.push({
        id: numbers[i].id,
        label: `${label} — أرقام غير مستخدمة`,
        expected: missing.length === 1 ? missing[0] : `${missing[0]}–${missing[missing.length - 1]}`,
        actual: n,
        diff: missing.length,
        unit: "text",
        note: "الأرقام غير محتجزة بأي مستند (ملغى أو مسودة) — للعلم فقط ولا تعني خطأً محاسبيًا",
      });
    }
  }

  const issues = [...duplicates, ...gaps];
  const base = {
    key: `posted_sequence_${label}`,
    title: `تسلسل أرقام ${label}`,
    meaning:
      "أرقام النشر يجب أن تكون فريدة. الأرقام المستهلكة بمستند ملغى أو مُرجَع لمسودة لا تُعدّ انحرافًا.",
    formula: "تكرار = رقمان لمستندين مختلفين • فراغ = رقم لا يحتجزه أي مستند (معلومة فقط)",
    action: "التكرار يُصحَّح بإعادة ترحيل أحد المستندين. الفراغ لا يحتاج إجراء.",
    checked: numbers.length,
  };

  return {
    ...base,
    severity:
      duplicates.length > 0 ? "error" : gaps.length > 0 ? "info" : "ok",
    issues,
  };
}

/* ─── 6) رصيد الجهة (عميل/مورد) = رصيده في دفتر الأستاذ ─── */

export interface EntityBalanceRow {
  id: string;
  code: string;
  name: string;
  balance: number | string | null;
}

export function checkEntityBalances(
  entities: EntityBalanceRow[],
  ledgerBalances: Map<string, number>,
  kind: "customer" | "supplier",
  tolerance = BALANCE_TOLERANCE,
  details?: Map<string, EntityBalanceBreakdown>,
): CheckResult {
  const issues: CheckIssue[] = [];
  const basePath = kind === "customer" ? "/customers" : "/suppliers";

  for (const e of entities) {
    const expected = round2(ledgerBalances.get(e.id) ?? 0);
    const actual = round2(Number(e.balance ?? 0));
    const diff = round2(actual - expected);
    if (Math.abs(diff) > tolerance) {
      const d = details?.get(e.id);
      issues.push({
        id: e.id,
        label: `[${e.code}] ${e.name}`,
        expected,
        actual,
        diff,
        unit: "currency",
        note: d
          ? `افتتاحي ${d.opening} + فواتير ${d.invoices} − مرتجعات ${d.returns} − سدادات ${d.payments} + استردادات ${d.refunds}`
          : undefined,
        link: basePath,
      });
    }
  }

  return withIssues(
    {
      key: `entity_balances_${kind}`,
      title:
        kind === "customer"
          ? "أرصدة العملاء مطابقة لدفتر الأستاذ"
          : "أرصدة الموردين مطابقة لدفتر الأستاذ",
      meaning:
        "الرصيد المخزّن في بطاقة الجهة يجب أن يساوي صافي حركتها في حساب الذمم — أي فرق يعني ترحيلًا ناقصًا.",
      formula:
        "المتوقع = الافتتاحي + الفواتير المرحّلة − المرتجعات المرحّلة − السدادات + استردادات المرتجعات",
      action: "افتح كشف حساب الجهة وأعد احتساب الرصيد من زر إعادة الحساب في بطاقتها.",
      checked: entities.length,
    },
    issues,
  );
}

/* ─── 7) ربط المستندات المرحّلة بقيودها ─── */

export interface LinkedDocRow {
  id: string;
  label: string;
  journal_entry_id?: string | null;
  status?: string | null;
  link?: string;
}

/** مستند مرحّل بلا قيد = أثر محاسبي مفقود */
export function checkDocumentsHaveJournal(
  docs: LinkedDocRow[],
  label: string,
): CheckResult {
  const posted = docs.filter((d) => (d.status ?? "posted") === "posted");
  const issues: CheckIssue[] = posted
    .filter((d) => !d.journal_entry_id)
    .map((d) => ({
      id: d.id,
      label: d.label,
      expected: "قيد مرتبط",
      actual: "بلا قيد",
      unit: "text" as const,
      note: "مستند مرحّل بلا قيد محاسبي — الأثر في دفتر الأستاذ مفقود",
      link: d.link,
    }));

  return withIssues(
    {
      key: `docs_journal_${label}`,
      title: `ربط ${label} المرحّلة بقيودها`,
      meaning: "كل مستند مرحّل يجب أن يكون له قيد محاسبي مرتبط.",
      formula: "الحالة = مرحّل ⇒ journal_entry_id غير فارغ",
      action: "أعِد المستند لمسودة ثم رحّله من جديد لإنشاء القيد.",
      checked: posted.length,
    },
    issues,
  );
}

/* ─── 8) حركات مخزون بلا مستند مصدر ─── */

export interface MovementSourceRow {
  id: string;
  product_label?: string | null;
  reference_id?: string | null;
  reference_type?: string | null;
  movement_type?: string | null;
  movement_date?: string | null;
}

export function checkMovementsHaveSource(rows: MovementSourceRow[]): CheckResult {
  const issues: CheckIssue[] = rows
    .filter((m) => !m.reference_id && m.movement_type !== "opening_balance")
    .map((m) => ({
      id: m.id,
      label: m.product_label || `حركة ${m.movement_type ?? ""}`,
      expected: "مستند مصدر",
      actual: "بلا مرجع",
      unit: "text" as const,
      note: `حركة بتاريخ ${m.movement_date ?? "—"} غير مرتبطة بفاتورة أو تسوية`,
      link: "/reports/inventory-movements",
    }));

  return withIssues(
    {
      key: "movements_source",
      title: "حركات المخزون مرتبطة بمستند مصدر",
      meaning:
        "كل حركة مخزون (غير الرصيد الافتتاحي) يجب أن تنشأ من فاتورة أو مرتجع أو تسوية.",
      formula: "reference_id غير فارغ لكل حركة ما لم تكن رصيدًا افتتاحيًا",
      action: "احذف الحركة اليدوية وأنشئ تسوية مخزون رسمية بدلًا منها.",
      checked: rows.length,
    },
    issues,
    "warning",
  );
}


/* ─── ملخّص عام ─── */

export interface ReconciliationSummary {
  total: number;
  passed: number;
  warnings: number;
  errors: number;
  /** فحوص تعذّر تنفيذها (لا تُحسب انحرافًا) */
  unavailable: number;
  /** ملاحظات للعلم فقط */
  info: number;
  totalIssues: number;
  /** سليم تمامًا؟ */
  healthy: boolean;
}

export function summarizeChecks(checks: CheckResult[]): ReconciliationSummary {
  const errors = checks.filter((c) => c.severity === "error").length;
  const warnings = checks.filter((c) => c.severity === "warning").length;
  const unavailable = checks.filter((c) => c.severity === "unavailable").length;
  const info = checks.filter((c) => c.severity === "info").length;
  return {
    total: checks.length,
    passed: checks.filter((c) => c.severity === "ok").length,
    warnings,
    errors,
    unavailable,
    info,
    totalIssues: checks.reduce((s, c) => s + c.issues.length, 0),
    healthy: errors === 0 && warnings === 0 && unavailable === 0,
  };
}


/* ─── الرصيد المتوقع للجهات (نفس معادلة entity-balance بشكل مجمّع) ─── */

export interface EntityDocRow {
  entity_id: string;
  total: number | string | null;
}

export interface EntityPaymentRow {
  id: string;
  entity_id: string;
  amount: number | string | null;
}

export interface ReturnAllocationRow {
  payment_id: string;
  allocated_amount: number | string | null;
}

export interface EntityBalanceBreakdown {
  opening: number;
  invoices: number;
  returns: number;
  payments: number;
  refunds: number;
  expected: number;
}

/**
 * تفصيل مكوّنات الرصيد المتوقع لكل جهة (لعرض منشأ الفرق في التشخيص).
 * الرصيد المتوقع = الافتتاحي + الفواتير المرحّلة − المرتجعات المرحّلة
 *                 − السدادات العادية + السدادات المخصّصة كاسترداد مرتجع.
 */
export function computeEntityBalanceDetails(input: {
  openingBalances: Map<string, number>;
  invoices: EntityDocRow[];
  returns: EntityDocRow[];
  payments: EntityPaymentRow[];
  returnAllocations: ReturnAllocationRow[];
}): Map<string, EntityBalanceBreakdown> {
  const out = new Map<string, EntityBalanceBreakdown>();
  const bucket = (id: string): EntityBalanceBreakdown | null => {
    if (!id) return null;
    let b = out.get(id);
    if (!b) {
      b = { opening: 0, invoices: 0, returns: 0, payments: 0, refunds: 0, expected: 0 };
      out.set(id, b);
    }
    return b;
  };

  for (const [id, v] of input.openingBalances) {
    const b = bucket(id);
    if (b) b.opening += Number(v ?? 0);
  }
  for (const r of input.invoices) {
    const b = bucket(r.entity_id);
    if (b) b.invoices += Number(r.total ?? 0);
  }
  for (const r of input.returns) {
    const b = bucket(r.entity_id);
    if (b) b.returns += Number(r.total ?? 0);
  }

  const allocByPayment = new Map<string, number>();
  for (const a of input.returnAllocations) {
    const pid = String(a.payment_id);
    allocByPayment.set(
      pid,
      (allocByPayment.get(pid) ?? 0) + Number(a.allocated_amount ?? 0),
    );
  }

  for (const p of input.payments) {
    const b = bucket(p.entity_id);
    if (!b) continue;
    const amount = Number(p.amount ?? 0);
    const refunded = Math.min(amount, Math.max(0, allocByPayment.get(String(p.id)) ?? 0));
    // السداد العادي ينقص الرصيد، والمخصّص لمرتجع (استرداد) يزيده
    b.payments += amount - refunded;
    b.refunds += refunded;
  }

  for (const [, b] of out) {
    b.opening = round2(b.opening);
    b.invoices = round2(b.invoices);
    b.returns = round2(b.returns);
    b.payments = round2(b.payments);
    b.refunds = round2(b.refunds);
    b.expected = round2(
      b.opening + b.invoices - b.returns - b.payments + b.refunds,
    );
  }

  return out;
}

/** الرصيد المتوقع لكل جهة (مبني على نفس تفصيل computeEntityBalanceDetails) */
export function computeExpectedEntityBalances(input: {
  openingBalances: Map<string, number>;
  invoices: EntityDocRow[];
  returns: EntityDocRow[];
  payments: EntityPaymentRow[];
  returnAllocations: ReturnAllocationRow[];
}): Map<string, number> {
  const details = computeEntityBalanceDetails(input);
  const out = new Map<string, number>();
  for (const [id, b] of details) out.set(id, b.expected);
  return out;
}
