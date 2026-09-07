import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Link2, ExternalLink, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface Settlement {
  id: string;
  invoice_id: string;
  invoice_number: number;
  posted_number: number | null;
  invoice_date: string;
  invoice_total: number;
  settled_amount: number;
}

interface Props {
  type: "sales" | "purchase";
  returnId: string;
  returnTotal: number;
}

export default function ReturnSettlementsView({ type, returnId, returnTotal }: Props) {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [paymentAllocTotal, setPaymentAllocTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const isSales = type === "sales";
  const settlementTable = isSales ? "sales_invoice_return_settlements" : "purchase_invoice_return_settlements";
  const invoiceTable = isSales ? "sales_invoices" : "purchase_invoices";
  const payAllocTable = isSales ? "sales_return_payment_allocations" : "purchase_return_payment_allocations";
  const invoicePrefix = isSales ? "INV-" : "PINV-";
  const invoiceRoute = isSales ? "/sales" : "/purchases";

  useEffect(() => {
    fetchSettlements();
  }, [returnId]);

  async function fetchSettlements() {
    setLoading(true);
    const [{ data: settlementsData }, { data: payAllocs }] = await Promise.all([
      supabase
        .from(settlementTable as any)
        .select("id, invoice_id, settled_amount")
        .eq("return_id", returnId),
      supabase
        .from(payAllocTable as any)
        .select("allocated_amount")
        .eq("return_id", returnId),
    ]);

    const payTotal = (payAllocs || []).reduce((s: number, a: any) => s + Number(a.allocated_amount), 0);
    setPaymentAllocTotal(payTotal);

    if (!settlementsData || settlementsData.length === 0) {
      setSettlements([]);
      setLoading(false);
      return;
    }

    const invoiceIds = settlementsData.map((s: any) => s.invoice_id);
    const { data: invoices } = await supabase
      .from(invoiceTable as any)
      .select("id, invoice_number, posted_number, invoice_date, total")
      .in("id", invoiceIds);

    const invoiceMap = new Map((invoices || []).map((inv: any) => [inv.id, inv]));
    const enriched: Settlement[] = settlementsData.map((s: any) => {
      const inv = invoiceMap.get(s.invoice_id) || ({} as any);
      return {
        id: s.id,
        invoice_id: s.invoice_id,
        invoice_number: inv.invoice_number || 0,
        posted_number: inv.posted_number || null,
        invoice_date: inv.invoice_date || "",
        invoice_total: inv.total || 0,
        settled_amount: s.settled_amount,
      };
    });

    setSettlements(enriched);
    setLoading(false);
  }

  if (loading || settlements.length === 0) return null;

  const totalSettled = settlements.reduce((s, r) => s + r.settled_amount, 0);
  const totalCovered = totalSettled + paymentAllocTotal;
  const remaining = returnTotal - totalCovered;
  const percentage = returnTotal > 0 ? Math.min((totalCovered / returnTotal) * 100, 100) : 0;
  const isFullySettled = remaining <= 0.01;
  const fmt = (v: number) =>
    v.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <div className="rounded-lg border border-dashed border-primary/30 overflow-hidden">
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">تسويات على فواتير</span>
            {isFullySettled && (
              <div className="flex items-center gap-1 text-xs text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>مسوّى بالكامل</span>
              </div>
            )}
          </div>
          <Badge variant="secondary" className="font-mono text-xs">
            {fmt(totalSettled)}
          </Badge>
        </div>

        {/* Progress */}
        <div className="space-y-1.5">
          <Progress value={percentage} className="h-1.5" />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              تسويات: <span className="font-mono text-primary font-medium">{fmt(totalSettled)}</span>
              {paymentAllocTotal > 0 && (
                <>
                  {" "}
                  + مدفوعات: <span className="font-mono text-primary font-medium">{fmt(paymentAllocTotal)}</span>
                </>
              )}
            </span>
            <span>
              من <span className="font-mono text-foreground font-medium">{fmt(returnTotal)}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Settlement items */}
      <div className="border-t divide-y">
        {settlements.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between px-4 py-2.5 text-xs hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="font-mono font-medium">
                {invoicePrefix}
                {s.posted_number || s.invoice_number}
              </span>
              <span className="text-muted-foreground">{s.invoice_date}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono font-semibold text-primary">{fmt(s.settled_amount)}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => navigate(`${invoiceRoute}/${s.invoice_id}`)}
                aria-label="فتح الفاتورة"
              >
                <ExternalLink className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
