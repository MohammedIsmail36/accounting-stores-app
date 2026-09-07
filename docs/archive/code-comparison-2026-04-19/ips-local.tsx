import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getNextPostedNumber } from "@/lib/posted-number-utils";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePickerInput } from "@/components/DatePickerInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  CreditCard,
  Plus,
  Link2,
  Unlink,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  recalculateEntityBalance,
  recalculateInvoicePaidAmount,
} from "@/lib/entity-balance";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface Allocation {
  id: string;
  payment_id: string;
  allocated_amount: number;
  payment_number: number;
  payment_date: string;
  payment_amount: number;
  payment_method: string;
  reference: string | null;
}

interface AvailablePayment {
  id: string;
  payment_number: number;
  payment_date: string;
  amount: number;
  payment_method: string;
  reference: string | null;
  total_allocated: number;
  remaining: number;
}

interface Props {
  type: "sales" | "purchase" | "sales_return" | "purchase_return";
  invoiceId: string;
  entityId: string;
  entityName: string;
  invoiceTotal: number;
  invoiceNumber: number | null;
  onPaymentAdded: () => void;
  refreshKey?: number;
}

const ACCOUNT_CODES = {
  CUSTOMERS: "1103",
  SUPPLIERS: "2101",
  CASH: "1101",
  BANK: "1102",
};

const methodLabels: Record<string, string> = {
  cash: "نقدي",
  bank: "تحويل بنكي",
  check: "شيك",
};

export default function InvoicePaymentSection({
  type,
  invoiceId,
  entityId,
  entityName,
  invoiceTotal,
  invoiceNumber,
  onPaymentAdded,
  refreshKey = 0,
}: Props) {
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [availablePayments, setAvailablePayments] = useState<
    AvailablePayment[]
  >([]);
  const [paidAmount, setPaidAmount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkAmounts, setLinkAmounts] = useState<Record<string, number>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);

  // New payment form
  const [amount, setAmount] = useState(0);
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const isCustomerSide = type === "sales" || type === "sales_return";
  const paymentTable = isCustomerSide
    ? "customer_payments"
    : "supplier_payments";
  const isReturn = type === "sales_return" || type === "purchase_return";
  const allocationTable = isReturn
    ? type === "sales_return"
      ? "sales_return_payment_allocations"
      : "purchase_return_payment_allocations"
    : isCustomerSide
      ? "customer_payment_allocations"
      : "supplier_payment_allocations";
  const allocIdCol = isReturn ? "return_id" : "invoice_id";
  const invoiceTable =
    type === "sales"
      ? "sales_invoices"
      : type === "purchase"
        ? "purchase_invoices"
        : type === "sales_return"
          ? "sales_returns"
          : "purchase_returns";
  const entityIdCol = isCustomerSide ? "customer_id" : "supplier_id";

  useEffect(() => {
    fetchData();
  }, [invoiceId, entityId, refreshKey]);

  async function fetchData() {
    setLoading(true);

    const { data: allocData } = await supabase
      .from(allocationTable as any)
      .select("id, payment_id, allocated_amount")
      .eq(allocIdCol, invoiceId);

    let enrichedAllocations: Allocation[] = [];
    if (allocData && allocData.length > 0) {
      const paymentIds = allocData.map((a: any) => a.payment_id);
      const { data: payments } = await supabase
        .from(paymentTable as any)
        .select(
          "id, payment_number, payment_date, amount, payment_method, reference",
        )
        .in("id", paymentIds);

      const paymentMap = new Map((payments || []).map((p: any) => [p.id, p]));
      enrichedAllocations = allocData.map((a: any) => {
        const p = paymentMap.get(a.payment_id) || {};
        return {
          id: a.id,
          payment_id: a.payment_id,
          allocated_amount: a.allocated_amount,
          payment_number: (p as any).payment_number || 0,
          payment_date: (p as any).payment_date || "",
          payment_amount: (p as any).amount || 0,
          payment_method: (p as any).payment_method || "",
          reference: (p as any).reference || null,
        };
      });
    }

    const totalFromAllocations = enrichedAllocations.reduce(
      (s, a) => s + a.allocated_amount,
      0,
    );

    let totalFromSettlements = 0;
    if (!isReturn) {
      const settlementTable = isCustomerSide
        ? "sales_invoice_return_settlements"
        : "purchase_invoice_return_settlements";
      const { data: settlements } = await supabase
        .from(settlementTable as any)
        .select("settled_amount")
        .eq("invoice_id", invoiceId);
      totalFromSettlements = (settlements || []).reduce(
        (s: number, r: any) => s + Number(r.settled_amount),
        0,
      );
    } else {
      const settlementTable =
        type === "sales_return"
          ? "sales_invoice_return_settlements"
          : "purchase_invoice_return_settlements";
      const { data: settlements } = await supabase
        .from(settlementTable as any)
        .select("settled_amount")
        .eq("return_id", invoiceId);
      totalFromSettlements = (settlements || []).reduce(
        (s: number, r: any) => s + Number(r.settled_amount),
        0,
      );
    }

    const totalPaid = totalFromAllocations + totalFromSettlements;

    const { data: entityPayments } = await supabase
      .from(paymentTable as any)
      .select(
        "id, payment_number, payment_date, amount, payment_method, reference",
      )
      .eq(entityIdCol, entityId)
      .eq("status", "posted")
      .order("payment_date");

    let available: AvailablePayment[] = [];
    if (entityPayments && entityPayments.length > 0) {
      const allPaymentIds = entityPayments.map((p: any) => p.id);
      const invoiceAllocTable = isCustomerSide
        ? "customer_payment_allocations"
        : "supplier_payment_allocations";
      const { data: invoiceAllocs } = await supabase
        .from(invoiceAllocTable as any)
        .select("payment_id, allocated_amount")
        .in("payment_id", allPaymentIds);
      const returnAllocTable = isCustomerSide
        ? "sales_return_payment_allocations"
        : "purchase_return_payment_allocations";
      const { data: returnAllocs } = await supabase
        .from(returnAllocTable as any)
        .select("payment_id, allocated_amount")
        .in("payment_id", allPaymentIds);

      const allocByPayment = new Map<string, number>();
      [...(invoiceAllocs || []), ...(returnAllocs || [])].forEach((a: any) => {
        allocByPayment.set(
          a.payment_id,
          (allocByPayment.get(a.payment_id) || 0) + a.allocated_amount,
        );
      });

      available = entityPayments
        .map((p: any) => ({
          ...p,
          total_allocated: allocByPayment.get(p.id) || 0,
          remaining: p.amount - (allocByPayment.get(p.id) || 0),
        }))
        .filter((p: AvailablePayment) => p.remaining > 0);

      const thisInvoicePaymentIds = new Set(
        enrichedAllocations.map((a) => a.payment_id),
      );
      available = available.filter((p) => !thisInvoicePaymentIds.has(p.id));
    }

    setAllocations(enrichedAllocations);
    setPaidAmount(totalPaid);
    setAvailablePayments(available);

    if (!isReturn) {
      await supabase
        .from(invoiceTable as any)
        .update({ paid_amount: totalPaid })
        .eq("id", invoiceId);
    }

    setLoading(false);
  }

  const remaining = invoiceTotal - paidAmount;

  async function handleNewPayment() {
    if (amount <= 0) {
      toast({
        title: "تنبيه",
        description: "يرجى إدخال مبلغ صحيح",
        variant: "destructive",
      });
      return;
    }
    if (amount > remaining) {
      toast({
        title: "تنبيه",
        description: "المبلغ أكبر من المتبقي على الفاتورة",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const entityAccCode = isCustomerSide
        ? ACCOUNT_CODES.CUSTOMERS
        : ACCOUNT_CODES.SUPPLIERS;
      const cashBankCode =
        paymentMethod === "cash" ? ACCOUNT_CODES.CASH : ACCOUNT_CODES.BANK;
      const { data: accounts } = await supabase
        .from("accounts")
        .select("id, code")
        .in("code", [entityAccCode, cashBankCode]);
      const entityAcc = accounts?.find((a) => a.code === entityAccCode);
      const cashBankAcc = accounts?.find((a) => a.code === cashBankCode);
      if (!entityAcc || !cashBankAcc) {
        toast({
          title: "خطأ",
          description: "تأكد من وجود الحسابات المطلوبة في شجرة الحسابات",
          variant: "destructive",
        });
        setSaving(false);
        return;
      }

      const invPrefix =
        type === "sales"
          ? "INV-"
          : type === "purchase"
            ? "PUR-"
            : type === "sales_return"
              ? "SRN-"
              : "PRN-";
      const formattedInvNum = invoiceNumber
        ? `${invPrefix}${String(invoiceNumber).padStart(4, "0")}`
        : `#${invoiceId.slice(0, 8)}`;
      const desc =
        type === "sales"
          ? `تحصيل من عميل - فاتورة ${formattedInvNum}`
          : type === "purchase"
            ? `سداد لمورد - فاتورة ${formattedInvNum}`
            : type === "sales_return"
              ? `رد مبلغ لعميل - مرتجع ${formattedInvNum}`
              : `استلام مبلغ من مورد - مرتجع ${formattedInvNum}`;
      const jePostedNum = await getNextPostedNumber("journal_entries");
      const { data: je, error: jeError } = await supabase
        .from("journal_entries")
        .insert({
          description: desc,
          entry_date: paymentDate,
          total_debit: amount,
          total_credit: amount,
          status: "posted",
          posted_number: jePostedNum,
        } as any)
        .select("id")
        .single();
      if (jeError) throw jeError;

      const lines =
        type === "sales"
          ? [
              {
                journal_entry_id: je.id,
                account_id: cashBankAcc.id,
                debit: amount,
                credit: 0,
                description: desc,
              },
              {
                journal_entry_id: je.id,
                account_id: entityAcc.id,
                debit: 0,
                credit: amount,
                description: `سداد ذمم عملاء`,
              },
            ]
          : type === "purchase"
            ? [
                {
                  journal_entry_id: je.id,
                  account_id: entityAcc.id,
                  debit: amount,
                  credit: 0,
                  description: `سداد ذمم موردين`,
                },
                {
                  journal_entry_id: je.id,
                  account_id: cashBankAcc.id,
                  debit: 0,
                  credit: amount,
                  description: desc,
                },
              ]
            : type === "sales_return"
              ? [
                  {
                    journal_entry_id: je.id,
                    account_id: entityAcc.id,
                    debit: amount,
                    credit: 0,
                    description: `رد ذمم عملاء - مرتجع`,
                  },
                  {
                    journal_entry_id: je.id,
                    account_id: cashBankAcc.id,
                    debit: 0,
                    credit: amount,
                    description: desc,
                  },
                ]
              : [
                  {
                    journal_entry_id: je.id,
                    account_id: cashBankAcc.id,
                    debit: amount,
                    credit: 0,
                    description: desc,
                  },
                  {
                    journal_entry_id: je.id,
                    account_id: entityAcc.id,
                    debit: 0,
                    credit: amount,
                    description: `استلام من مورد - مرتجع`,
                  },
                ];
      await supabase.from("journal_entry_lines").insert(lines as any);

      const paymentPostedNum = await getNextPostedNumber(paymentTable);
      const paymentResult: any = await supabase
        .from(paymentTable as any)
        .insert({
          [entityIdCol]: entityId,
          payment_date: paymentDate,
          amount,
          payment_method: paymentMethod,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
          journal_entry_id: je.id,
          status: "posted",
          posted_number: paymentPostedNum,
        } as any)
        .select("id")
        .single();

      const allocPayload: any = {
        payment_id: paymentResult.data.id,
        allocated_amount: amount,
      };
      allocPayload[allocIdCol] = invoiceId;
      await supabase.from(allocationTable as any).insert(allocPayload);

      await recalculateEntityBalance(
        isCustomerSide ? "customer" : "supplier",
        entityId,
      );

      toast({ title: "تم التسجيل", description: "تم تسجيل الدفعة وتخصيصها" });
      setDialogOpen(false);
      setAmount(0);
      setReference("");
      setNotes("");
      fetchData();
      onPaymentAdded();
    } catch (error: any) {
      toast({
        title: "خطأ",
        description: error.message,
        variant: "destructive",
      });
    }
    setSaving(false);
  }

  async function linkPayment(payment: AvailablePayment, allocAmount: number) {
    const maxAlloc = Math.min(payment.remaining, remaining);
    if (allocAmount <= 0 || allocAmount > maxAlloc) {
      toast({
        title: "تنبيه",
        description: `المبلغ يجب أن يكون بين 0.01 و ${maxAlloc.toFixed(2)}`,
        variant: "destructive",
      });
      return;
    }
    try {
      const allocPayload2: any = {
        payment_id: payment.id,
        allocated_amount: allocAmount,
      };
      allocPayload2[allocIdCol] = invoiceId;
      await supabase.from(allocationTable as any).insert(allocPayload2);
      toast({
        title: "تم التخصيص",
        description: `تم تخصيص ${allocAmount.toFixed(2)} من الدفعة #${payment.payment_number}`,
      });
      setLinkAmounts({});
      fetchData();
      onPaymentAdded();
    } catch (error: any) {
      toast({
        title: "خطأ",
        description: error.message,
        variant: "destructive",
      });
    }
  }

  async function unlinkAllocation(allocation: Allocation) {
    try {
      await supabase
        .from(allocationTable as any)
        .delete()
        .eq("id", allocation.id);
      toast({ title: "تم فك التخصيص" });
      fetchData();
      onPaymentAdded();
    } catch (error: any) {
      toast({
        title: "خطأ",
        description: error.message,
        variant: "destructive",
      });
    }
  }

  if (loading) return null;

  const isPaid = remaining <= 0;
  const percentage =
    invoiceTotal > 0 ? Math.min((paidAmount / invoiceTotal) * 100, 100) : 0;

  const sectionTitle = isReturn ? "المستردات" : "المدفوعات";
  const newPaymentLabel = isReturn
    ? isCustomerSide
      ? "تسجيل رد مبلغ للعميل"
      : "تسجيل استلام مبلغ من المورد"
    : "دفعة جديدة";
  const newPaymentBtnLabel = isReturn
    ? isCustomerSide
      ? "رد مبلغ"
      : "استلام مبلغ"
    : "دفعة جديدة";
  const paidLabel = isReturn ? "المسترد" : "المدفوع";
  const remainingLabel = isReturn ? "المتبقي للاسترداد" : "المتبقي";

  const StatusIcon = isPaid
    ? CheckCircle2
    : paidAmount > 0
      ? Clock
      : AlertCircle;
  const statusColor = isPaid
    ? "text-green-600"
    : paidAmount > 0
      ? "text-amber-600"
      : "text-muted-foreground";
  const statusText = isPaid
    ? isReturn
      ? "مستردة بالكامل"
      : "مدفوعة بالكامل"
    : paidAmount > 0
      ? isReturn
        ? "مسترد جزئياً"
        : "مسدد جزئياً"
      : isReturn
        ? "غير مستردة"
        : "غير مدفوعة";

  const fmt = (v: number) =>
    v.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <Card className="overflow-hidden">
      {/* Compact header with progress */}
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">{sectionTitle}</span>
            <div className={`flex items-center gap-1 text-xs ${statusColor}`}>
              <StatusIcon className="h-3.5 w-3.5" />
              <span>{statusText}</span>
            </div>
          </div>
          {!isPaid && (
            <div className="flex gap-1.5">
              {!isReturn && availablePayments.length > 0 && (
                <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1 h-7 text-xs px-2"
                    >
                      <Link2 className="h-3 w-3" />
                      تخصيص دفعة
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg" dir="rtl">
                    <DialogHeader>
                      <DialogTitle>
                        تخصيص دفعات موجودة - {entityName}
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm bg-muted/50 p-3 rounded-lg">
                        <span>
                          الإجمالي:{" "}
                          <strong className="font-mono">
                            {fmt(invoiceTotal)}
                          </strong>
                        </span>
                        <span>
                          المتبقي:{" "}
                          <strong className="font-mono text-destructive">
                            {fmt(remaining)}
                          </strong>
                        </span>
                      </div>
                      <div className="space-y-2">
                        {availablePayments.map((p) => {
                          const maxAlloc = Math.min(p.remaining, remaining);
                          const currentVal = linkAmounts[p.id] ?? maxAlloc;
                          return (
                            <div
                              key={p.id}
                              className="flex items-center gap-3 p-2.5 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm font-medium">
                                    #{p.payment_number}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] h-5"
                                  >
                                    {methodLabels[p.payment_method] ||
                                      p.payment_method}
                                  </Badge>
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  {p.payment_date} · متاح:{" "}
                                  <span className="font-mono text-primary">
                                    {fmt(p.remaining)}
                                  </span>
                                </div>
                              </div>
                              <Input
                                type="number"
                                min={0.01}
                                max={maxAlloc}
                                step="0.01"
                                value={currentVal}
                                onChange={(e) =>
                                  setLinkAmounts({
                                    ...linkAmounts,
                                    [p.id]: +e.target.value,
                                  })
                                }
                                className="font-mono h-8 w-24"
                              />
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => linkPayment(p, currentVal)}
                                className="text-xs h-8 px-3"
                              >
                                تخصيص
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1 h-7 text-xs px-2.5">
                    <Plus className="h-3 w-3" />
                    {newPaymentBtnLabel}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md" dir="rtl">
                  <DialogHeader>
                    <DialogTitle>{newPaymentLabel}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-muted/50">
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                          الإجمالي
                        </p>
                        <p className="font-mono font-semibold text-sm">
                          {fmt(invoiceTotal)}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                          {remainingLabel}
                        </p>
                        <p className="font-mono font-semibold text-sm text-destructive">
                          {fmt(remaining)}
                        </p>
                      </div>
                    </div>
                    {isReturn && (
                      <div className="text-xs text-muted-foreground bg-accent/50 p-2.5 rounded-lg border border-accent">
                        {isCustomerSide
                          ? "💡 سيتم تسجيل رد مبلغ المرتجع للعميل"
                          : "💡 سيتم تسجيل استلام مبلغ المرتجع من المورد"}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">المبلغ *</Label>
                        <Input
                          type="number"
                          min="0"
                          max={remaining}
                          step="0.01"
                          value={amount}
                          onChange={(e) => setAmount(+e.target.value)}
                          className="font-mono h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">التاريخ</Label>
                        <DatePickerInput
                          value={paymentDate}
                          onChange={setPaymentDate}
                          placeholder="اختر التاريخ"
                          className="h-9"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">طريقة الدفع</Label>
                        <Select
                          value={paymentMethod}
                          onValueChange={setPaymentMethod}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cash">نقدي</SelectItem>
                            <SelectItem value="bank">تحويل بنكي</SelectItem>
                            <SelectItem value="check">شيك</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">مرجع</Label>
                        <Input
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                          placeholder="رقم إيصال أو شيك"
                          className="h-9"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">ملاحظات</Label>
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={2}
                        className="resize-none"
                      />
                    </div>
                    <Button
                      onClick={handleNewPayment}
                      disabled={saving}
                      className="w-full h-9"
                    >
                      {saving
                        ? "جاري الحفظ..."
                        : isReturn
                          ? isCustomerSide
                            ? "تسجيل الاسترداد"
                            : "تسجيل الاستلام"
                          : "تسجيل الدفعة"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>

        {/* Progress bar & amounts */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {paidLabel}:{" "}
              <span className="font-mono font-medium text-foreground">
                {fmt(paidAmount)}
              </span>
            </span>
            <span>
              من{" "}
              <span className="font-mono font-medium text-foreground">
                {fmt(invoiceTotal)}
              </span>
            </span>
          </div>
          <Progress value={percentage} className="h-1.5" />
          {!isPaid && remaining > 0 && (
            <div className="text-xs text-end">
              <span className="text-muted-foreground">{remainingLabel}: </span>
              <span className="font-mono font-semibold text-destructive">
                {fmt(remaining)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Collapsible details */}
      {allocations.length > 0 && (
        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-center gap-1.5 py-2 border-t text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors">
              {detailsOpen ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {detailsOpen
                ? "إخفاء التفاصيل"
                : `عرض التفاصيل (${allocations.length} ${isReturn ? "استرداد" : "دفعة"})`}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-right text-xs h-8">
                      {isReturn ? "الاسترداد" : "الدفعة"}
                    </TableHead>
                    <TableHead className="text-right text-xs h-8">
                      التاريخ
                    </TableHead>
                    <TableHead className="text-right text-xs h-8">
                      المخصص
                    </TableHead>
                    <TableHead className="text-right text-xs h-8">
                      الطريقة
                    </TableHead>
                    <TableHead className="text-right text-xs h-8 w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allocations.map((a) => (
                    <TableRow key={a.id} className="text-xs">
                      <TableCell className="font-mono py-2">
                        #{a.payment_number}
                      </TableCell>
                      <TableCell className="text-muted-foreground py-2">
                        {a.payment_date}
                      </TableCell>
                      <TableCell className="font-mono font-semibold text-primary py-2">
                        {fmt(a.allocated_amount)}
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge variant="outline" className="text-[10px] h-5">
                          {methodLabels[a.payment_method] || a.payment_method}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                              aria-label="فك التخصيص"
                            >
                              <Unlink className="h-3 w-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent dir="rtl">
                            <AlertDialogHeader>
                              <AlertDialogTitle>فك التخصيص</AlertDialogTitle>
                              <AlertDialogDescription>
                                هل تريد فك تخصيص {fmt(a.allocated_amount)} من
                                الدفعة #{a.payment_number}؟
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className="flex-row-reverse gap-2">
                              <AlertDialogCancel>إلغاء</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => unlinkAllocation(a)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                فك التخصيص
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Available payments hint */}
      {!isReturn && !isPaid && availablePayments.length > 0 && !detailsOpen && (
        <div className="border-t px-4 py-2">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Link2 className="h-3 w-3" />
            يوجد {availablePayments.length} دفعة متاحة للتخصيص بإجمالي{" "}
            {fmt(availablePayments.reduce((s, p) => s + p.remaining, 0))}
          </p>
        </div>
      )}
    </Card>
  );
}
