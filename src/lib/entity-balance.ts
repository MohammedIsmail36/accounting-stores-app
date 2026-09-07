import { supabase } from "@/integrations/supabase/client";
import { round2 } from "@/lib/utils";

type EntityType = "customer" | "supplier";
type InvoiceType = "sales" | "purchase";

const toNumber = (value: unknown) => Number(value || 0);

export async function recalculateEntityBalance(
  entityType: EntityType,
  entityId: string,
): Promise<number> {
  const isCustomer = entityType === "customer";

  const invoiceTable: "sales_invoices" | "purchase_invoices" =
    isCustomer ? "sales_invoices" : "purchase_invoices";
  const returnTable: "sales_returns" | "purchase_returns" =
    isCustomer ? "sales_returns" : "purchase_returns";
  const paymentTable: "customer_payments" | "supplier_payments" =
    isCustomer ? "customer_payments" : "supplier_payments";
  const returnPaymentAllocTable:
    | "sales_return_payment_allocations"
    | "purchase_return_payment_allocations" = isCustomer
    ? "sales_return_payment_allocations"
    : "purchase_return_payment_allocations";
  const entityTable: "customers" | "suppliers" = isCustomer
    ? "customers"
    : "suppliers";
  const entityIdCol = isCustomer ? "customer_id" : "supplier_id";

  const [
    { data: invoices },
    { data: returns },
    { data: payments },
    { data: entityRow },
  ] = await Promise.all([
    (supabase.from(invoiceTable) as any)
      .select("total")
      .eq(entityIdCol, entityId)
      .eq("status", "posted"),
    (supabase.from(returnTable) as any)
      .select("total")
      .eq(entityIdCol, entityId)
      .eq("status", "posted"),
    (supabase.from(paymentTable) as any)
      .select("id, amount")
      .eq(entityIdCol, entityId)
      .eq("status", "posted"),
    (supabase.from(entityTable) as any)
      .select("opening_balance")
      .eq("id", entityId)
      .maybeSingle(),
  ]);

  const openingBalance = toNumber((entityRow as any)?.opening_balance);

  const postedInvoiceTotal = (invoices || []).reduce(
    (sum: number, row: any) => sum + toNumber(row.total),
    0,
  );
  const postedReturnTotal = (returns || []).reduce(
    (sum: number, row: any) => sum + toNumber(row.total),
    0,
  );

  let normalPayments = 0;
  let refundPayments = 0;

  if (payments && payments.length > 0) {
    const paymentIds = payments.map((p: any) => p.id);
    const { data: returnAllocs } = await supabase
      .from(returnPaymentAllocTable)
      .select("payment_id, allocated_amount")
      .in("payment_id", paymentIds);

    const allocatedByPayment = new Map<string, number>();
    (returnAllocs || []).forEach((a: any) => {
      const paymentId = String(a.payment_id);
      allocatedByPayment.set(
        paymentId,
        (allocatedByPayment.get(paymentId) || 0) + toNumber(a.allocated_amount),
      );
    });

    for (const payment of payments) {
      const paymentId = String((payment as any).id);
      const amount = toNumber((payment as any).amount);
      const returnAllocated = Math.min(
        amount,
        Math.max(0, toNumber(allocatedByPayment.get(paymentId))),
      );
      normalPayments += amount - returnAllocated;
      refundPayments += returnAllocated;
    }
  }

  const calculatedBalance = round2(
    openingBalance +
      postedInvoiceTotal -
      postedReturnTotal -
      normalPayments +
      refundPayments,
  );

  await supabase
    .from(entityTable)
    .update({ balance: calculatedBalance })
    .eq("id", entityId);

  return calculatedBalance;
}

export async function recalculateInvoicePaidAmount(
  invoiceType: InvoiceType,
  invoiceId: string,
): Promise<number> {
  const isSales = invoiceType === "sales";
  const invoiceTable: "sales_invoices" | "purchase_invoices" =
    isSales ? "sales_invoices" : "purchase_invoices";
  const paymentAllocTable:
    | "customer_payment_allocations"
    | "supplier_payment_allocations" = isSales
    ? "customer_payment_allocations"
    : "supplier_payment_allocations";
  const settlementTable:
    | "sales_invoice_return_settlements"
    | "purchase_invoice_return_settlements" = isSales
    ? "sales_invoice_return_settlements"
    : "purchase_invoice_return_settlements";

  const [{ data: paymentAllocs }, { data: settlements }] = await Promise.all([
    supabase
      .from(paymentAllocTable)
      .select("allocated_amount")
      .eq("invoice_id", invoiceId),
    supabase
      .from(settlementTable)
      .select("settled_amount")
      .eq("invoice_id", invoiceId),
  ]);

  const paymentTotal = (paymentAllocs || []).reduce(
    (sum: number, row: any) => sum + toNumber(row.allocated_amount),
    0,
  );
  const settlementTotal = (settlements || []).reduce(
    (sum: number, row: any) => sum + toNumber(row.settled_amount),
    0,
  );
  const paidAmount = round2(paymentTotal + settlementTotal);

  await supabase
    .from(invoiceTable)
    .update({ paid_amount: paidAmount })
    .eq("id", invoiceId);

  return paidAmount;
}
