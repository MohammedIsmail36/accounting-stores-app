import { supabase } from "@/integrations/supabase/client";
import { ACCOUNT_CODES } from "@/lib/constants";
import { getNextPostedNumber } from "@/lib/posted-number-utils";
import { createJournalEntry, replaceJournalEntryLines } from "@/lib/journal-writer";

export interface PostExpenseInput {
  expenseId: string;
  expenseTypeId: string;
  expenseTypeName: string;
  /** account_id of the expense type (must be non-null) */
  accountId: string;
  amount: number;
  paymentMethod: "cash" | "bank" | string;
  expenseDate: string;
  description?: string | null;
  /** Optional. When re-posting after revert-to-draft, reuse the same posted_number */
  reusePostedNumber?: number | null;
  /** Settings prefix (default EXP-) */
  expensePrefix?: string;
  /**
   * When re-posting a record that already has a journal entry, that SAME entry is
   * reused: its lines are rebuilt and it is switched back to posted (Odoo-style).
   * The entry is never deleted, so an empty/orphan JV can no longer be created.
   */
  oldJournalEntryId?: string | null;
}

export interface PostExpenseResult {
  journalEntryId: string;
  expensePostedNumber: number;
  displayNumber: string;
}

/**
 * Centralized "post an expense" routine.
 * - Validates account_id presence
 * - Resolves cash/bank account by code
 * - Creates balanced JV (2 lines) with a deterministic description
 * - Updates the expense row with status=posted, journal_entry_id, posted_number
 *
 * Throws on any failure with a human-readable Arabic message.
 */
export async function postExpense(
  input: PostExpenseInput,
): Promise<PostExpenseResult> {
  if (!input.accountId) {
    throw new Error("نوع المصروف لا يحتوي على حساب محاسبي مرتبط");
  }
  if (!(input.amount > 0)) {
    throw new Error("المبلغ يجب أن يكون أكبر من صفر");
  }

  const accountCode =
    input.paymentMethod === "cash" ? ACCOUNT_CODES.CASH : ACCOUNT_CODES.BANK;
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, code")
    .in("code", [accountCode]);
  const cashBankAcc = accounts?.find((a) => a.code === accountCode);
  if (!cashBankAcc) {
    throw new Error("تأكد من وجود حساب الصندوق/البنك في شجرة الحسابات");
  }

  const expPostedNum =
    input.reusePostedNumber ?? (await getNextPostedNumber("expenses" as any));
  const prefix = input.expensePrefix || "EXP-";
  const displayNum = `${prefix}${String(expPostedNum).padStart(4, "0")}`;
  const desc = `سند مصروف رقم ${displayNum} - ${input.expenseTypeName}${
    input.description?.trim() ? ` - ${input.description.trim()}` : ""
  }`;

  const lines = [
    {
      account_id: input.accountId,
      debit: input.amount,
      credit: 0,
      description: desc,
    },
    {
      account_id: cashBankAcc.id,
      debit: 0,
      credit: input.amount,
      description: desc,
    },
  ];

  let jeId: string;

  if (input.oldJournalEntryId) {
    // Reuse the SAME journal entry: rebuild its lines atomically (never emptied)
    jeId = input.oldJournalEntryId;
    await replaceJournalEntryLines(jeId, lines, {
      entryDate: input.expenseDate,
      description: desc,
      status: "posted",
    });
  } else {
    jeId = await createJournalEntry({
      entryDate: input.expenseDate,
      description: desc,
      lines,
      status: "posted",
    });
  }

  const { error: updErr } = await (supabase.from("expenses" as any) as any)
    .update({
      status: "posted",
      journal_entry_id: jeId,
      posted_number: expPostedNum,
    })
    .eq("id", input.expenseId);
  if (updErr) throw updErr;

  return {
    journalEntryId: jeId,
    expensePostedNumber: expPostedNum,
    displayNumber: displayNum,
  };
}
