import { supabase } from "@/integrations/supabase/client";
import { getNextPostedNumber } from "@/lib/posted-number-utils";
import { round2 } from "@/lib/utils";

/**
 * ─────────────────────────────────────────────────────────────
 *  journal-writer.ts — البوابة الوحيدة لكتابة القيود المحاسبية
 * ─────────────────────────────────────────────────────────────
 *  لا تُكتب `journal_entries` / `journal_entry_lines` مباشرة من أي شاشة.
 *  كل الكتابة تمر من هنا، وهي تستدعي دوال قاعدة البيانات
 *  (`create_journal_entry` / `replace_journal_entry_lines`) التي تكتب
 *  الرأس والسطور في معاملة واحدة وترفض أي قيد:
 *   - بأقل من سطرين
 *   - غير متوازن
 *   - بسطر صفري / سالب / مدين ودائن معًا
 *   - بحساب غير موجود
 *  فلا يمكن أن ينشأ قيد فارغ أو غير متوازن مهما كان مسار الاستدعاء.
 */

export interface JournalLineInput {
  account_id: string;
  debit: number;
  credit: number;
  description?: string | null;
}

export interface CreateJournalEntryInput {
  entryDate: string;
  description: string;
  lines: JournalLineInput[];
  /** `posted` افتراضيًا */
  status?: "draft" | "posted" | "cancelled";
  /** يُحسب تلقائيًا عند الترحيل إن لم يُمرّر */
  postedNumber?: number | null;
  entryType?: string;
}

function normalizeLines(lines: JournalLineInput[]): JournalLineInput[] {
  return lines
    .map((l) => ({
      account_id: l.account_id,
      debit: round2(Number(l.debit || 0)),
      credit: round2(Number(l.credit || 0)),
      description: l.description ?? null,
    }))
    .filter((l) => l.debit > 0 || l.credit > 0);
}

/** التحقق المحلي (رسالة أسرع للمستخدم) — الحماية الحقيقية في قاعدة البيانات */
export function validateJournalLines(lines: JournalLineInput[]): string | null {
  const clean = normalizeLines(lines);
  if (clean.length < 2) return "القيد يجب أن يحتوي سطرين على الأقل";
  if (clean.some((l) => !l.account_id)) return "كل سطر يجب أن يكون مرتبطًا بحساب";
  if (clean.some((l) => l.debit > 0 && l.credit > 0))
    return "سطر القيد لا يمكن أن يكون مدينًا ودائنًا في نفس الوقت";
  const debit = round2(clean.reduce((s, l) => s + l.debit, 0));
  const credit = round2(clean.reduce((s, l) => s + l.credit, 0));
  if (debit !== credit) return `القيد غير متوازن: مدين ${debit} ودائن ${credit}`;
  if (debit <= 0) return "إجمالي القيد يجب أن يكون أكبر من صفر";
  return null;
}

/** إجمالي القيد (مدين = دائن) */
export function journalTotal(lines: JournalLineInput[]): number {
  return round2(normalizeLines(lines).reduce((s, l) => s + l.debit, 0));
}

/** إنشاء قيد كامل (رأس + سطور) في معاملة واحدة. يرفع خطأ عربيًا واضحًا عند الفشل. */
export async function createJournalEntry(
  input: CreateJournalEntryInput,
): Promise<string> {
  const lines = normalizeLines(input.lines);
  const localError = validateJournalLines(lines);
  if (localError) throw new Error(localError);

  const status = input.status ?? "posted";
  const postedNumber =
    input.postedNumber !== undefined
      ? input.postedNumber
      : status === "posted"
        ? await getNextPostedNumber("journal_entries")
        : null;

  const { data, error } = await (supabase.rpc as any)("create_journal_entry", {
    p_entry_date: input.entryDate,
    p_description: input.description,
    p_lines: lines,
    p_status: status,
    p_posted_number: postedNumber,
    p_entry_type: input.entryType ?? "regular",
  });
  if (error) throw error;
  return data as string;
}

/** إعادة بناء سطور قيد قائم (مسار إعادة الترحيل) — نفس القيد لا يُحذف ولا يُفرَّغ. */
export async function replaceJournalEntryLines(
  entryId: string,
  lines: JournalLineInput[],
  opts?: { entryDate?: string; description?: string; status?: "draft" | "posted" },
): Promise<void> {
  const clean = normalizeLines(lines);
  const localError = validateJournalLines(clean);
  if (localError) throw new Error(localError);

  const { error } = await (supabase.rpc as any)("replace_journal_entry_lines", {
    p_entry_id: entryId,
    p_lines: clean,
    p_entry_date: opts?.entryDate ?? null,
    p_description: opts?.description ?? null,
    p_status: opts?.status ?? null,
  });
  if (error) throw error;
}

/** بناء سطور القيد العكسي من سطور قيد قائم (تبديل المدين والدائن) */
export function reverseLines(
  lines: { account_id: string; debit: number | string; credit: number | string; description?: string | null }[],
  descriptionPrefix = "عكس - ",
): JournalLineInput[] {
  return lines.map((l) => ({
    account_id: l.account_id,
    debit: round2(Number(l.credit || 0)),
    credit: round2(Number(l.debit || 0)),
    description: `${descriptionPrefix}${l.description ?? ""}`.trim(),
  }));
}

/**
 * إنشاء قيد عكسي لقيد قائم: يُقرأ الأصل ثم تُقلب سطوره.
 * يرفع خطأ إذا كان القيد الأصلي بلا سطور (بدل إنشاء قيد فارغ كما في السابق).
 */
export async function createReverseJournalEntry(opts: {
  sourceEntryId: string;
  description: string;
  entryDate: string;
  /** بادئة وصف السطر العكسي */
  linePrefix?: string;
  /** استخدام وصف القيد بدل وصف السطر الأصلي */
  useEntryDescriptionForLines?: boolean;
  entryType?: string;
}): Promise<string> {
  const { data: origLines, error } = await supabase
    .from("journal_entry_lines")
    .select("account_id, debit, credit, description")
    .eq("journal_entry_id", opts.sourceEntryId);
  if (error) throw error;
  if (!origLines || origLines.length === 0) {
    throw new Error("القيد الأصلي لا يحتوي سطورًا — لا يمكن إنشاء قيد عكسي");
  }

  const lines = reverseLines(origLines as any, opts.linePrefix ?? "عكس - ").map((l) =>
    opts.useEntryDescriptionForLines ? { ...l, description: opts.description } : l,
  );

  return createJournalEntry({
    entryDate: opts.entryDate,
    description: opts.description,
    lines,
    status: "posted",
    entryType: opts.entryType ?? "reversal",
  });
}
