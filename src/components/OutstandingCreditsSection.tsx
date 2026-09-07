import { notify } from "@/lib/notify";
import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { recalculateInvoicePaidAmount } from "@/lib/entity-balance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ConfirmDialog";

import {
  ReceiptText,
  Check,
  Unlink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface OutstandingReturn {
  id: string;
  return_number: number;
  posted_number: number | null;
  return_date: string;
  total: number;
  settled_total: number;
  remaining: number;
}

interface ExistingSettlement {
  id: string;
  return_id: string;
  return_number: number;
  posted_number: number | null;
  return_date: string;
  return_total: number;
  settled_amount: number;
}

interface Props {
  type: "sales" | "purchase";
  invoiceId: string;
  entityId: string;
  invoiceTotal: number;
  onSettlementChanged: () => void;
}

export default function OutstandingCreditsSection({
  type,
  invoiceId,
  entityId,
  invoiceTotal,
  onSettlementChanged,
}: Props) {
  const [outstandingReturns, setOutstandingReturns] = useState<
    OutstandingReturn[]
  >([]);
  const [existingSettlements, setExistingSettlements] = useState<
    ExistingSettlement[]
  >([]);
  const [applyAmounts, setApplyAmounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [settlementTotal, setSettlementTotal] = useState(0);
  const [paymentAllocTotal, setPaymentAllocTotal] = useState(0);
  const [availableOpen, setAvailableOpen] = useState(false);

  const isSales = type === "sales";
  const returnsTable = isSales ? "sales_returns" : "purchase_returns";
  const settlementTable = isSales
    ? "sales_invoice_return_settlements"
    : "purchase_invoice_return_settlements";
  const entityIdCol = isSales ? "customer_id" : "supplier_id";
  const allocTable = isSales
    ? "customer_payment_allocations"
    : "supplier_payment_allocations";

  useEffect(() => {
    fetchData();
  }, [invoiceId, entityId]);

  async function fetchData() {
    setLoading(true);

    const { data: payAllocs } = await supabase
      .from(allocTable as any)
      .select("allocated_amount")
      .eq("invoice_id", invoiceId);
    const payAllocSum = (payAllocs || []).reduce(
      (s: number, a: any) => s + Number(a.allocated_amount),
      0,
    );
    setPaymentAllocTotal(payAllocSum);

    const { data: settlements } = await supabase
      .from(settlementTable as any)
      .select("id, return_id, settled_amount")
      .eq("invoice_id", invoiceId);

    let enrichedSettlements: ExistingSettlement[] = [];
    const settledReturnIds = new Set<string>();
    let totalSettled = 0;

    if (settlements && settlements.length > 0) {
      const returnIds = settlements.map((s: any) => s.return_id);
      const { data: returns } = await supabase
        .from(returnsTable as any)
        .select("id, return_number, posted_number, return_date, total")
        .in("id", returnIds);

      const returnMap = new Map((returns || []).map((r: any) => [r.id, r]));
      enrichedSettlements = settlements.map((s: any) => {
        const r = returnMap.get(s.return_id) || {};
        settledReturnIds.add(s.return_id);
        totalSettled += s.settled_amount;
        return {
          id: s.id,
          return_id: s.return_id,
          return_number: (r as any).return_number || 0,
          posted_number: (r as any).posted_number || null,
          return_date: (r as any).return_date || "",
          return_total: (r as any).total || 0,
          settled_amount: s.settled_amount,
        };
      });
    }

    setSettlementTotal(totalSettled);

    const { data: allReturns } = await supabase
      .from(returnsTable as any)
      .select("id, return_number, posted_number, return_date, total")
      .eq(entityIdCol, entityId)
      .eq("status", "posted")
      .order("return_date");

    let outstanding: OutstandingReturn[] = [];
    if (allReturns && allReturns.length > 0) {
      const allReturnIds = allReturns.map((r: any) => r.id);
      const { data: allSettlements } = await supabase
        .from(settlementTable as any)
        .select("return_id, settled_amount")
        .in("return_id", allReturnIds);
      const returnAllocTable = isSales
        ? "sales_return_payment_allocations"
        : "purchase_return_payment_allocations";
      const { data: returnPayAllocs } = await supabase
        .from(returnAllocTable as any)
        .select("return_id, allocated_amount")
        .in("return_id", allReturnIds);

      const settledByReturn = new Map<string, number>();
      (allSettlements || []).forEach((s: any) => {
        settledByReturn.set(
          s.return_id,
          (settledByReturn.get(s.return_id) || 0) + s.settled_amount,
        );
      });
      (returnPayAllocs || []).forEach((a: any) => {
        settledByReturn.set(
          a.return_id,
          (settledByReturn.get(a.return_id) || 0) + a.allocated_amount,
        );
      });

      outstanding = allReturns
        .map((r: any) => ({
          id: r.id,
          return_number: r.return_number,
          posted_number: r.posted_number,
          return_date: r.return_date,
          total: r.total,
          settled_total: settledByReturn.get(r.id) || 0,
          remaining: r.total - (settledByReturn.get(r.id) || 0),
        }))
        .filter(
          (r: OutstandingReturn) =>
            r.remaining > 0.01 && !settledReturnIds.has(r.id),
        );
    }

    setExistingSettlements(enrichedSettlements);
    setOutstandingReturns(outstanding);
    setLoading(false);
  }

  const invoiceRemaining = invoiceTotal - paymentAllocTotal - settlementTotal;

  async function applyReturn(ret: OutstandingReturn) {
    const amount =
      applyAmounts[ret.id] ??
      Math.min(ret.remaining, Math.max(invoiceRemaining, 0));
    const maxAmount = Math.min(ret.remaining, Math.max(invoiceRemaining, 0));
    if (amount <= 0 || amount > maxAmount + 0.01) {
      notify.error("تنبيه", `المبلغ يجب أن يكون بين 0.01 و ${maxAmount.toFixed(2)}`);
      return;
    }
    try {
      await supabase.from(settlementTable as any).insert({
        invoice_id: invoiceId,
        return_id: ret.id,
        settled_amount: amount,
      });
      await recalculateInvoicePaidAmount(type, invoiceId);
      notify.success("تم التسوية", `تم تطبيق ${amount.toFixed(2)} من المرتجع #${ret.posted_number || ret.return_number}`);
      setApplyAmounts({});
      fetchData();
      onSettlementChanged();
    } catch (error: any) {
      notify.error("خطأ", error.message);
    }
  }

  async function removeSettlement(settlement: ExistingSettlement) {
    try {
      await supabase.from(settlementTable as any).delete().eq("id", settlement.id);
      await recalculateInvoicePaidAmount(type, invoiceId);
      notify.success("تم إلغاء التسوية");
      fetchData();
      onSettlementChanged();
    } catch (error: any) {
      notify.error("خطأ", error.message);
    }
  }

  if (loading) return null;
  if (outstandingReturns.length === 0 && existingSettlements.length === 0)
    return null;

  const prefix = isSales ? "SRN-" : "PRN-";
  const fmt = (v: number) =>
    v.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <div className="rounded-lg border border-dashed border-primary/30 overflow-hidden">
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ReceiptText className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">
              {isSales ? "أرصدة دائنة (مرتجعات)" : "أرصدة مدينة (مرتجعات)"}
            </span>
          </div>
          {settlementTotal > 0 && (
            <Badge variant="secondary" className="font-mono text-xs">
              مسوى: {fmt(settlementTotal)}
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          {isSales
            ? "مرتجعات يمكن تطبيقها كتسوية بدلاً من سند دفع"
            : "مرتجعات يمكن تطبيقها كتسوية بدلاً من سند دفع"}
        </p>
      </div>

      {/* Existing settlements */}
      {existingSettlements.length > 0 && (
        <div className="border-t divide-y">
          {existingSettlements.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between px-4 py-2.5 text-xs hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono font-medium">
                  {prefix}
                  {s.posted_number || s.return_number}
                </span>
                <span className="text-muted-foreground">{s.return_date}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold text-primary">
                  {fmt(s.settled_amount)}
                </span>
                <ConfirmDialog
                  trigger={
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                      aria-label="إلغاء التسوية"
                    >
                      <Unlink className="h-3 w-3" />
                    </Button>
                  }
                  title="إلغاء التسوية"
                  description={`هل تريد إلغاء تسوية ${fmt(s.settled_amount)} من المرتجع #${s.posted_number || s.return_number}؟`}
                  confirmText="إلغاء التسوية"
                  destructive
                  onConfirm={() => removeSettlement(s)}
                />

              </div>
            </div>
          ))}
        </div>
      )}

      {/* Available returns to apply */}
      {outstandingReturns.length > 0 && invoiceRemaining > 0.01 && (
        <Collapsible open={availableOpen} onOpenChange={setAvailableOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-center gap-1.5 py-2 border-t text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors">
              {availableOpen ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {availableOpen
                ? "إخفاء المرتجعات المتاحة"
                : `عرض ${outstandingReturns.length} مرتجع متاح للتسوية`}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t p-3 space-y-2">
              {outstandingReturns.map((r) => {
                const maxAmount = Math.min(
                  r.remaining,
                  Math.max(invoiceRemaining, 0),
                );
                const currentVal = applyAmounts[r.id] ?? maxAmount;
                return (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium">
                          {prefix}
                          {r.posted_number || r.return_number}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {r.return_date} · متاح:{" "}
                        <span className="font-mono text-primary">
                          {fmt(r.remaining)}
                        </span>
                      </div>
                    </div>
                    <Input
                      type="number"
                      min={0.01}
                      max={maxAmount}
                      step="0.01"
                      value={currentVal}
                      onChange={(e) =>
                        setApplyAmounts({
                          ...applyAmounts,
                          [r.id]: +e.target.value,
                        })
                      }
                      className="font-mono h-8 w-24 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => applyReturn(r)}
                      className="text-xs h-8 px-3 gap-1"
                    >
                      <Check className="h-3 w-3" />
                      تطبيق
                    </Button>
                  </div>
                );
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
