/**
 * Shared payment-voucher (سند قبض / سند صرف) domain layer.
 *
 * CustomerPayments and SupplierPayments were near-identical mirrors of the same
 * accounting flow. This module holds the single source of truth for:
 *  - fetching vouchers + flagging refund vouchers (linked to returns)
 *  - the posting flow (journal entry + lines + status/posted_number + balance)
 *  - cancelling a posted voucher (unlink allocations, reverse JV, recalc)
 *  - deleting a draft voucher
 *  - filtering the list in memory
 *
 * The only differences between the two kinds live in PAYMENT_VOUCHER_CONFIG.
 */
import { supabase } from "@/integrations/supabase/client";
import { createJournalEntry } from "@/lib/journal-writer";
import { ACCOUNT_CODES } from "@/lib/constants";
import { getNextPostedNumber } from "@/lib/posted-number-utils";
import { recalculateEntityBalance, recalculateInvoicePaidAmount } from "@/lib/entity-balance";

export type PaymentVoucherKind = "customer" | "supplier";

export interface PaymentVoucherConfig {
  /** Vouchers table. */
  table: "customer_payments" | "supplier_payments";
  /** Entity FK column on the vouchers table. */
  entityField: "customer_id" | "supplier_id";
  /** Lookup table for the entity (customers / suppliers). */
  entityTable: "customers" | "suppliers";
  /** Invoice allocation table (many-to-many reconciliation). */
  allocationsTable: "customer_payment_allocations" | "supplier_payment_allocations";
  /** Return allocation table (refund linkage). */
  returnAllocationsTable: "sales_return_payment_allocations" | "purchase_return_payment_allocations";
  /** Embedded relation alias used when selecting the entity name. */
  entityRelation: string;
  /** Chart-of-accounts code of the AR / AP control account. */
  entityAccountCode: string;
  /** Invoice side used when recalculating paid_amount. */
  invoiceKind: "sales" | "purchase";
  /** Settings key holding the display prefix. */
  prefixSetting: "customer_payment_prefix" | "supplier_payment_prefix";
  /** Fallback prefix when settings are unavailable. */
  defaultPrefix: string;
  /** Arabic label used in the journal entry description. */
  voucherLabel: string;
  /** Arabic description of the counterparty movement. */
  entityLabel: string;
  /** RPC that atomically overwrites a posted voucher. */
  editRpc: "edit_customer_payment" | "edit_supplier_payment";
  /** Error thrown when the control accounts are missing. */
  missingAccountsError: string;
  /**
   * On a receipt (customer) cash/bank is debited and AR credited.
   * On a payment (supplier) AP is debited and cash/bank credited.
   */
  entityAccountSide: "debit" | "credit";
}

export const PAYMENT_VOUCHER_CONFIG: Record<PaymentVoucherKind, PaymentVoucherConfig> = {
  customer: {
    table: "customer_payments",
    entityField: "customer_id",
    entityTable: "customers",
    allocationsTable: "customer_payment_allocations",
    returnAllocationsTable: "sales_return_payment_allocations",
    entityRelation: "customers:customer_id(name)",
    entityAccountCode: ACCOUNT_CODES.CUSTOMERS,
    invoiceKind: "sales",
    prefixSetting: "customer_payment_prefix",
    defaultPrefix: "CPY-",
    voucherLabel: "سند قبض",
    entityLabel: "تحصيل من عميل",
    editRpc: "edit_customer_payment",
    missingAccountsError: "تأكد من وجود حسابات العملاء والصندوق/البنك",
    entityAccountSide: "credit",
  },
  supplier: {
    table: "supplier_payments",
    entityField: "supplier_id",
    entityTable: "suppliers",
    allocationsTable: "supplier_payment_allocations",
    returnAllocationsTable: "purchase_return_payment_allocations",
    entityRelation: "suppliers:supplier_id(name)",
    entityAccountCode: ACCOUNT_CODES.SUPPLIERS,
    invoiceKind: "purchase",
    prefixSetting: "supplier_payment_prefix",
    defaultPrefix: "SPY-",
    voucherLabel: "سند صرف",
    entityLabel: "سداد لمورد",
    editRpc: "edit_supplier_payment",
    missingAccountsError: "تأكد من وجود حسابات الموردين والصندوق/البنك",
    entityAccountSide: "debit",
  },
};

export interface PaymentVoucherRow {
  id: string;
  payment_number: number;
  posted_number: number | null;
  payment_date: string;
  amount: number;
  payment_method: string;
  reference: string | null;
  notes: string | null;
  status: string;
  journal_entry_id: string | null;
  /** Resolved entity display name. */
  entity_name?: string;
  /** True when the voucher is linked to a return (refund). */
  isRefund?: boolean;
  [key: string]: unknown;
}

export interface PaymentVoucherFilters {
  methodFilter: string;
  statusFilter: string;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_PAYMENT_VOUCHER_FILTERS: PaymentVoucherFilters = {
  methodFilter: "all",
  statusFilter: "all",
  dateFrom: "",
  dateTo: "",
};

/** In-memory list filtering shared by both voucher pages. */
export function filterPaymentVouchers<T extends { payment_method: string; status: string; payment_date: string }>(
  rows: T[],
  filters: PaymentVoucherFilters,
): T[] {
  const { methodFilter, statusFilter, dateFrom, dateTo } = filters;
  return rows.filter((row) => {
    if (methodFilter !== "all" && row.payment_method !== methodFilter) return false;
    if (statusFilter !== "all" && row.status !== statusFilter) return false;
    if (dateFrom && row.payment_date < dateFrom) return false;
    if (dateTo && row.payment_date > dateTo) return false;
    return true;
  });
}

export function hasPaymentVoucherFilters(filters: PaymentVoucherFilters): boolean {
  return (
    filters.methodFilter !== "all" ||
    filters.statusFilter !== "all" ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo)
  );
}

export interface PaymentEntityOption {
  id: string;
  code: string;
  name: string;
  balance?: number;
}

/**
 * Loads active entities + all vouchers (paged) and flags refund vouchers.
 */
export async function fetchPaymentVoucherData(kind: PaymentVoucherKind): Promise<{
  entities: PaymentEntityOption[];
  vouchers: PaymentVoucherRow[];
}> {
  const cfg = PAYMENT_VOUCHER_CONFIG[kind];
  const { fetchAllPaged } = await import("@/lib/paged-fetch");
  const [entityRes, rows] = await Promise.all([
    (supabase.from(cfg.entityTable as any) as any)
      .select("id, code, name, balance")
      .eq("is_active", true)
      .order("name"),
    fetchAllPaged<any>(
      () =>
        (supabase.from(cfg.table) as any)
          .select(`*, ${cfg.entityRelation}`, { count: "exact" })
          .order("payment_number", { ascending: false }),
      { batchSize: 500, maxRows: 50000 },
    ),
  ]);

  const raw = (rows || []).map((p: any) => ({
    ...p,
    entity_name: p[cfg.entityTable]?.name,
  }));

  const postedIds = raw.filter((p: any) => p.status === "posted").map((p: any) => p.id);
  let refundIds = new Set<string>();
  if (postedIds.length > 0) {
    const { data: returnAllocs } = await (supabase.from(cfg.returnAllocationsTable as any) as any)
      .select("payment_id")
      .in("payment_id", postedIds);
    refundIds = new Set((returnAllocs || []).map((a: any) => String(a.payment_id)));
  }

  return {
    entities: (entityRes.data || []) as PaymentEntityOption[],
    vouchers: raw.map((p: any) => ({ ...p, isRefund: refundIds.has(p.id) })) as PaymentVoucherRow[],
  };
}

export interface PostPaymentVoucherInput {
  kind: PaymentVoucherKind;
  entityId: string;
  entityName: string;
  date: string;
  amount: number;
  method: string;
  reference: string | null;
  notes: string | null;
  /** When set, the existing draft row is posted instead of inserting a new one. */
  existingPaymentId?: string;
  /** Display prefix (from settings). */
  prefix?: string | null;
  /** Period lock date (from settings). */
  lockedUntilDate?: string | null;
}

/**
 * Creates the journal entry + lines, marks the voucher posted and recalculates
 * the entity balance. Throws with an Arabic message on any guard violation.
 */
export async function postPaymentVoucher(input: PostPaymentVoucherInput): Promise<{ postedNumber: number }> {
  const cfg = PAYMENT_VOUCHER_CONFIG[input.kind];
  const { entityId, date, amount, method, reference, notes } = input;

  if (input.lockedUntilDate && date <= input.lockedUntilDate) {
    throw new Error(`لا يمكن تسجيل دفعة بتاريخ ${date} — الفترة مقفلة حتى ${input.lockedUntilDate}`);
  }

  const cashBankCode = method === "cash" ? ACCOUNT_CODES.CASH : ACCOUNT_CODES.BANK;
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, code")
    .in("code", [cfg.entityAccountCode, cashBankCode]);
  const entityAcc = accounts?.find((a) => a.code === cfg.entityAccountCode);
  const cashBankAcc = accounts?.find((a) => a.code === cashBankCode);
  if (!entityAcc || !cashBankAcc) throw new Error(cfg.missingAccountsError);

  const postedNumber = await getNextPostedNumber(cfg.table);
  const prefix = input.prefix || cfg.defaultPrefix;
  const displayNumber = `${prefix}${String(postedNumber).padStart(4, "0")}`;
  const desc = `${cfg.voucherLabel} رقم ${displayNumber} - ${cfg.entityLabel} ${input.entityName}`.trim();

  const debitAccountId = cfg.entityAccountSide === "debit" ? entityAcc.id : cashBankAcc.id;
  const creditAccountId = cfg.entityAccountSide === "debit" ? cashBankAcc.id : entityAcc.id;

  const jeId = await createJournalEntry({
    entryDate: date,
    description: desc,
    status: "posted",
    lines: [
      { account_id: debitAccountId, debit: amount, credit: 0, description: desc },
      { account_id: creditAccountId, debit: 0, credit: amount, description: desc },
    ],
  });

  if (input.existingPaymentId) {
    await (supabase.from(cfg.table as any) as any)
      .update({ status: "posted", journal_entry_id: jeId, posted_number: postedNumber })
      .eq("id", input.existingPaymentId);
  } else {
    await (supabase.from(cfg.table as any) as any).insert({
      [cfg.entityField]: entityId,
      payment_date: date,
      amount,
      payment_method: method,
      reference,
      notes,
      journal_entry_id: jeId,
      status: "posted",
      posted_number: postedNumber,
    });
  }

  await recalculateEntityBalance(input.kind, entityId);
  return { postedNumber };
}

/**
 * Cancels a posted voucher: unlinks invoice/return allocations, cancels the
 * journal entry, flips the status to cancelled BEFORE recalculating (balance
 * math only counts posted vouchers), then recalculates invoices + balance.
 */
export async function cancelPaymentVoucher(
  kind: PaymentVoucherKind,
  voucher: { id: string; journal_entry_id: string | null; entityId: string },
): Promise<void> {
  const cfg = PAYMENT_VOUCHER_CONFIG[kind];

  const { data: allocations } = await (supabase.from(cfg.allocationsTable as any) as any)
    .select("id, invoice_id, allocated_amount")
    .eq("payment_id", voucher.id);

  if (allocations && allocations.length > 0) {
    await (supabase.from(cfg.allocationsTable as any) as any).delete().eq("payment_id", voucher.id);
  }

  await (supabase.from(cfg.returnAllocationsTable as any) as any).delete().eq("payment_id", voucher.id);

  if (voucher.journal_entry_id) {
    const { error: jeError } = await (supabase.from("journal_entries") as any)
      .update({ status: "cancelled" })
      .eq("id", voucher.journal_entry_id);
    if (jeError) throw new Error("فشل في تحديث حالة القيد المحاسبي: " + jeError.message);
  }

  await (supabase.from(cfg.table as any) as any).update({ status: "cancelled" }).eq("id", voucher.id);

  if (allocations && allocations.length > 0) {
    const affectedInvoiceIds = Array.from(
      new Set<string>((allocations || []).map((a: any) => String(a.invoice_id))),
    );
    for (const invoiceId of affectedInvoiceIds) {
      await recalculateInvoicePaidAmount(cfg.invoiceKind, invoiceId);
    }
  }

  await recalculateEntityBalance(kind, voucher.entityId);
}

/** Deletes a draft voucher. */
export async function deletePaymentVoucher(kind: PaymentVoucherKind, id: string): Promise<void> {
  const cfg = PAYMENT_VOUCHER_CONFIG[kind];
  const { error } = await (supabase.from(cfg.table as any) as any).delete().eq("id", id);
  if (error) throw error;
}

export interface SavePaymentVoucherDraftInput {
  kind: PaymentVoucherKind;
  id?: string;
  entityId: string;
  date: string;
  amount: number;
  method: string;
  reference: string | null;
  notes: string | null;
}

/** Inserts or updates a draft voucher (no journal entry, no balance impact). */
export async function savePaymentVoucherDraft(input: SavePaymentVoucherDraftInput): Promise<void> {
  const cfg = PAYMENT_VOUCHER_CONFIG[input.kind];
  const payload = {
    [cfg.entityField]: input.entityId,
    payment_date: input.date,
    amount: input.amount,
    payment_method: input.method,
    reference: input.reference,
    notes: input.notes,
    status: "draft",
  };
  const query = input.id
    ? (supabase.from(cfg.table as any) as any).update(payload).eq("id", input.id)
    : (supabase.from(cfg.table as any) as any).insert(payload);
  const { error } = await query;
  if (error) throw error;
}

export interface UpdatePostedVoucherInput {
  kind: PaymentVoucherKind;
  id: string;
  entityId: string;
  previousEntityId: string;
  date: string;
  amount: number;
  method: string;
  reference: string | null;
  notes: string | null;
}

/**
 * Atomically overwrites a posted voucher via RPC (preserves posted_number and
 * the journal entry number) then recalculates both the old and new entity.
 */
export async function updatePostedPaymentVoucher(input: UpdatePostedVoucherInput): Promise<void> {
  const cfg = PAYMENT_VOUCHER_CONFIG[input.kind];
  const params: Record<string, unknown> = {
    p_payment_id: input.id,
    p_payment_date: input.date,
    p_amount: input.amount,
    p_payment_method: input.method,
    p_reference: input.reference,
    p_notes: input.notes,
  };
  params[input.kind === "customer" ? "p_customer_id" : "p_supplier_id"] = input.entityId;

  const { data, error } = await (supabase as any).rpc(cfg.editRpc, params);
  if (error) throw error;

  const oldEntityId =
    (data as any)?.[input.kind === "customer" ? "old_customer_id" : "old_supplier_id"] || input.previousEntityId;
  await recalculateEntityBalance(input.kind, oldEntityId);
  if (input.entityId !== oldEntityId) {
    await recalculateEntityBalance(input.kind, input.entityId);
  }
}

/**
 * Guard for turning a posted voucher back into an editable one.
 * Returns an Arabic error message, or null when editing is allowed.
 */
export function getPostedVoucherEditBlockReason(
  voucher: { payment_date: string; isRefund?: boolean },
  lockedUntilDate?: string | null,
): string | null {
  if (lockedUntilDate && voucher.payment_date <= lockedUntilDate) {
    return `لا يمكن تعديل سند بتاريخ ${voucher.payment_date} — الفترة مقفلة حتى ${lockedUntilDate}`;
  }
  if (voucher.isRefund) {
    return "لا يمكن تعديل سند مرتبط بمرتجع. ألغِ المرتجع أولاً ثم أنشئ السند من جديد.";
  }
  return null;
}
