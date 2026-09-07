import React, { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  getNextPostedNumber,
  formatDisplayNumber,
} from "@/lib/posted-number-utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePickerInput } from "@/components/DatePickerInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { LookupCombobox } from "@/components/LookupCombobox";
import { FormFieldError } from "@/components/FormFieldError";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "@/hooks/use-toast";
import {
  Plus,
  CreditCard,
  X,
  Trash2,
  CheckCircle,
  XCircle,
  Pencil,
  ArrowDownLeft,
  ArrowUpRight,
  Loader2,
} from "lucide-react";
import { ExportMenu } from "@/components/ExportMenu";
import { useSettings } from "@/contexts/SettingsContext";
import {
  ACCOUNT_CODES,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_COLORS,
} from "@/lib/constants";
import {
  recalculateEntityBalance,
  recalculateInvoicePaidAmount,
} from "@/lib/entity-balance";

interface Customer {
  id: string;
  code: string;
  name: string;
  balance?: number;
}
interface Payment {
  id: string;
  payment_number: number;
  posted_number: number | null;
  customer_id: string;
  customer_name?: string;
  payment_date: string;
  amount: number;
  payment_method: string;
  reference: string | null;
  notes: string | null;
  status: string;
  journal_entry_id: string | null;
  isRefund?: boolean;
}

const methodLabels: Record<string, string> = {
  cash: "نقدي",
  bank: "تحويل بنكي",
  check: "شيك",
};
const statusLabels = INVOICE_STATUS_LABELS;
const statusVariants = INVOICE_STATUS_COLORS;

export default function CustomerPayments() {
  const { role } = useAuth();
  const { settings, formatCurrency: fmtCurrency } = useSettings();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [methodFilter, setMethodFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState(0);
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Edit mode
  const [editTarget, setEditTarget] = useState<Payment | null>(null);

  // Confirmation dialogs
  const [deleteTarget, setDeleteTarget] = useState<Payment | null>(null);
  const [postTarget, setPostTarget] = useState<Payment | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Payment | null>(null);

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    setLoading(true);
    const [custRes, payRes] = await Promise.all([
      (supabase.from("customers" as any) as any)
        .select("id, code, name, balance")
        .eq("is_active", true)
        .order("name"),
      (supabase.from("customer_payments" as any) as any)
        .select("*, customers:customer_id(name)")
        .order("payment_number", { ascending: false }),
    ]);
    setCustomers(custRes.data || []);
    const rawPayments = (payRes.data || []).map((p: any) => ({
      ...p,
      customer_name: p.customers?.name,
    }));

    // Identify refund payments (linked to sales returns)
    const postedIds = rawPayments
      .filter((p: any) => p.status === "posted")
      .map((p: any) => p.id);
    let refundIds = new Set<string>();
    if (postedIds.length > 0) {
      const { data: returnAllocs } = await supabase
        .from("sales_return_payment_allocations")
        .select("payment_id")
        .in("payment_id", postedIds);
      refundIds = new Set((returnAllocs || []).map((a: any) => a.payment_id));
    }
    setPayments(
      rawPayments.map((p: any) => ({ ...p, isRefund: refundIds.has(p.id) })),
    );
    setLoading(false);
  }

  const filtered = useMemo(() => {
    return payments.filter((p) => {
      if (methodFilter !== "all" && p.payment_method !== methodFilter)
        return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (dateFrom && p.payment_date < dateFrom) return false;
      if (dateTo && p.payment_date > dateTo) return false;
      return true;
    });
  }, [payments, methodFilter, statusFilter, dateFrom, dateTo]);

  const hasFilters =
    methodFilter !== "all" || statusFilter !== "all" || dateFrom || dateTo;
  const clearFilters = () => {
    setMethodFilter("all");
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  function openEditDialog(p: Payment) {
    setEditTarget(p);
    setCustomerId(p.customer_id);
    setAmount(p.amount);
    setPaymentDate(p.payment_date);
    setPaymentMethod(p.payment_method);
    setReference(p.reference || "");
    setNotes(p.notes || "");
    setDialogOpen(true);
  }

  // Save as DRAFT (no journal entry, no balance update)
  async function handleSaveDraft() {
    if (saving) return;
    const errors: Record<string, string> = {};
    if (!customerId) errors.customer = "يرجى اختيار العميل";
    if (amount <= 0) errors.amount = "يرجى إدخال المبلغ";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast({
        title: "تنبيه",
        description: Object.values(errors)[0],
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const data = {
        customer_id: customerId,
        payment_date: paymentDate,
        amount,
        payment_method: paymentMethod,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        status: "draft",
      };
      if (editTarget) {
        await (supabase.from("customer_payments" as any) as any)
          .update(data)
          .eq("id", editTarget.id);
        toast({ title: "تم التحديث", description: "تم تحديث المسودة بنجاح" });
      } else {
        await (supabase.from("customer_payments" as any) as any).insert(data);
        toast({ title: "تم الحفظ", description: "تم حفظ الدفعة كمسودة" });
      }
      setDialogOpen(false);
      resetForm();
      fetchAll();
    } catch (error: any) {
      toast({
        title: "خطأ",
        description: error.message,
        variant: "destructive",
      });
    }
    setSaving(false);
  }

  // Save and POST directly
  async function handleSubmitPosted() {
    if (saving) return;
    const errors: Record<string, string> = {};
    if (!customerId) errors.customer = "يرجى اختيار العميل";
    if (amount <= 0) errors.amount = "يرجى إدخال مبلغ صحيح";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast({
        title: "تنبيه",
        description: Object.values(errors)[0],
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      if (editTarget) {
        // First update the existing draft with new values
        await (supabase.from("customer_payments" as any) as any)
          .update({
            customer_id: customerId,
            payment_date: paymentDate,
            amount,
            payment_method: paymentMethod,
            reference: reference.trim() || null,
            notes: notes.trim() || null,
          })
          .eq("id", editTarget.id);
        // Then post the existing record (update status + create journal)
        await postPaymentLogic(
          customerId,
          paymentDate,
          amount,
          paymentMethod,
          reference.trim() || null,
          notes.trim() || null,
          editTarget.id,
        );
      } else {
        await postPaymentLogic(
          customerId,
          paymentDate,
          amount,
          paymentMethod,
          reference.trim() || null,
          notes.trim() || null,
        );
      }
      toast({ title: "تم التسجيل", description: "تم تسجيل السداد بنجاح" });
      setDialogOpen(false);
      resetForm();
      fetchAll();
    } catch (error: any) {
      toast({
        title: "خطأ",
        description: error.message,
        variant: "destructive",
      });
    }
    setSaving(false);
  }

  // Core post logic - creates journal entry + updates balance
  async function postPaymentLogic(
    custId: string,
    date: string,
    amt: number,
    method: string,
    ref: string | null,
    note: string | null,
    existingPaymentId?: string,
  ) {
    if (settings?.locked_until_date && date <= settings.locked_until_date) {
      throw new Error(
        `لا يمكن تسجيل دفعة بتاريخ ${date} — الفترة مقفلة حتى ${settings.locked_until_date}`,
      );
    }
    const accountCode =
      method === "cash" ? ACCOUNT_CODES.CASH : ACCOUNT_CODES.BANK;
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, code")
      .in("code", [ACCOUNT_CODES.CUSTOMERS, accountCode]);
    const customersAcc = accounts?.find(
      (a) => a.code === ACCOUNT_CODES.CUSTOMERS,
    );
    const cashBankAcc = accounts?.find((a) => a.code === accountCode);
    if (!customersAcc || !cashBankAcc)
      throw new Error("تأكد من وجود حسابات العملاء والصندوق/البنك");

    const paymentPostedNum = existingPaymentId
      ? await getNextPostedNumber("customer_payments")
      : await getNextPostedNumber("customer_payments");
    const cpPrefix = settings?.customer_payment_prefix || "CPY-";
    const displayPayNum = `${cpPrefix}${String(paymentPostedNum).padStart(4, "0")}`;
    const customerName = customers.find((c) => c.id === custId)?.name || "";
    const desc = `تحصيل من عميل ${customerName} - سند ${displayPayNum}`;

    const jePostedNum = await getNextPostedNumber("journal_entries");
    const { data: je, error: jeError } = await supabase
      .from("journal_entries")
      .insert({
        description: desc,
        entry_date: date,
        total_debit: amt,
        total_credit: amt,
        status: "posted",
        posted_number: jePostedNum,
      } as any)
      .select("id")
      .single();
    if (jeError) throw jeError;

    await supabase.from("journal_entry_lines").insert([
      {
        journal_entry_id: je.id,
        account_id: cashBankAcc.id,
        debit: amt,
        credit: 0,
        description: desc,
      },
      {
        journal_entry_id: je.id,
        account_id: customersAcc.id,
        debit: 0,
        credit: amt,
        description: desc,
      },
    ] as any);

    if (existingPaymentId) {
      await (supabase.from("customer_payments" as any) as any)
        .update({
          status: "posted",
          journal_entry_id: je.id,
          posted_number: paymentPostedNum,
        })
        .eq("id", existingPaymentId);
    } else {
      await (supabase.from("customer_payments" as any) as any).insert({
        customer_id: custId,
        payment_date: date,
        amount: amt,
        payment_method: method,
        reference: ref,
        notes: note,
        journal_entry_id: je.id,
        status: "posted",
        posted_number: paymentPostedNum,
      });
    }

    await recalculateEntityBalance("customer", custId);
  }

  // Post a draft payment
  async function handlePostDraft() {
    if (!postTarget || saving) return;
    setSaving(true);
    try {
      await postPaymentLogic(
        postTarget.customer_id,
        postTarget.payment_date,
        postTarget.amount,
        postTarget.payment_method,
        postTarget.reference,
        postTarget.notes,
        postTarget.id,
      );
      toast({
        title: "تم الترحيل",
        description: `تم ترحيل الدفعة #${postTarget.payment_number}`,
      });
      setPostTarget(null);
      fetchAll();
    } catch (error: any) {
      toast({
        title: "خطأ",
        description: error.message,
        variant: "destructive",
      });
    }
    setSaving(false);
  }

  // Delete a draft payment
  async function handleDelete() {
    if (!deleteTarget || saving) return;
    setSaving(true);
    try {
      await (supabase.from("customer_payments" as any) as any)
        .delete()
        .eq("id", deleteTarget.id);
      toast({
        title: "تم الحذف",
        description: `تم حذف الدفعة #${deleteTarget.payment_number}`,
      });
      setDeleteTarget(null);
      fetchAll();
    } catch (error: any) {
      toast({
        title: "خطأ",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  // Cancel a posted payment (reverse journal + restore balance)
  async function handleCancel() {
    if (!cancelTarget || saving) return;
    setSaving(true);
    try {
      // 1. Get all allocations for this payment to update related invoices
      const { data: allocations } = await (
        supabase.from("customer_payment_allocations" as any) as any
      )
        .select("id, invoice_id, allocated_amount")
        .eq("payment_id", cancelTarget.id);

      // 2. Delete all allocations for this payment
      if (allocations && allocations.length > 0) {
        await (supabase.from("customer_payment_allocations" as any) as any)
          .delete()
          .eq("payment_id", cancelTarget.id);

        const affectedInvoiceIds = (allocations || [])
          .map((a: any) => String(a.invoice_id))
          .filter(
            (v: string, i: number, arr: string[]) => arr.indexOf(v) === i,
          );
        for (const invoiceId of affectedInvoiceIds) {
          await recalculateInvoicePaidAmount("sales", invoiceId);
        }
      }

      // 4. Reverse journal entry status to cancelled
      if (cancelTarget.journal_entry_id) {
        const { error: jeError } = await (
          supabase.from("journal_entries") as any
        )
          .update({ status: "cancelled" })
          .eq("id", cancelTarget.journal_entry_id);
        if (jeError)
          throw new Error(
            "فشل في تحديث حالة القيد المحاسبي: " + jeError.message,
          );
      }

      await recalculateEntityBalance("customer", cancelTarget.customer_id);

      // 6. Update payment status
      await (supabase.from("customer_payments" as any) as any)
        .update({ status: "cancelled" })
        .eq("id", cancelTarget.id);

      toast({
        title: "تم الإلغاء",
        description: `تم إلغاء الدفعة #${cancelTarget.payment_number} وعكس القيد المحاسبي وفك جميع التخصيصات`,
      });
      setCancelTarget(null);
      fetchAll();
    } catch (error: any) {
      toast({
        title: "خطأ",
        description: error.message,
        variant: "destructive",
      });
    }
    setSaving(false);
  }

  function resetForm() {
    setEditTarget(null);
    setCustomerId("");
    setAmount(0);
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setPaymentMethod("cash");
    setReference("");
    setNotes("");
  }

  const prefix = settings?.customer_payment_prefix || "CPY-";

  const columns: ColumnDef<Payment, any>[] = [
    {
      accessorKey: "payment_number",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="#" />
      ),
      cell: ({ row }) => (
        <span className="font-mono">
          {formatDisplayNumber(
            prefix,
            row.original.posted_number,
            row.original.payment_number,
            row.original.status,
          )}
        </span>
      ),
    },
    {
      id: "type",
      header: "النوع",
      cell: ({ row }) => {
        const isRefund = row.original.isRefund;
        return (
          <Badge
            variant={isRefund ? "destructive" : "default"}
            className="gap-1"
          >
            {isRefund ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownLeft className="h-3 w-3" />
            )}
            {isRefund ? "رد مبلغ" : "تحصيل"}
          </Badge>
        );
      },
    },
    {
      accessorKey: "customer_name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="العميل" />
      ),
      cell: ({ row }) => (
        <span className="font-medium">{row.original.customer_name || "—"}</span>
      ),
    },
    {
      accessorKey: "payment_date",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="التاريخ" />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.payment_date}
        </span>
      ),
    },
    {
      accessorKey: "amount",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="المبلغ" />
      ),
      cell: ({ row }) => (
        <span className="font-mono font-semibold">
          {row.original.amount.toLocaleString("en-US", {
            minimumFractionDigits: 2,
          })}
        </span>
      ),
    },
    {
      accessorKey: "payment_method",
      meta: { hideOnMobile: true },
      header: "طريقة الدفع",
      cell: ({ row }) => (
        <Badge variant="outline">
          {methodLabels[row.original.payment_method] ||
            row.original.payment_method}
        </Badge>
      ),
    },
    {
      accessorKey: "status",
      header: "الحالة",
      cell: ({ row }) => (
        <Badge variant={statusVariants[row.original.status] as any}>
          {statusLabels[row.original.status] || row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: "reference",
      meta: { hideOnMobile: true },
      header: "المرجع",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.reference || "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="flex items-center gap-1">
            {p.status === "draft" && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEditDialog(p)}
                  className="gap-1 text-xs h-7 px-2"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  تعديل
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPostTarget(p)}
                  className="gap-1 text-xs h-7 px-2"
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  ترحيل
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteTarget(p)}
                  className="gap-1 text-xs h-7 px-2 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  حذف
                </Button>
              </>
            )}
            {p.status === "posted" && role === "admin" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCancelTarget(p)}
                className="gap-1 text-xs h-7 px-2 text-destructive hover:text-destructive"
              >
                <XCircle className="h-3.5 w-3.5" />
                إلغاء
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={CreditCard}
        title="مدفوعات العملاء"
        description={`${payments.length} عملية`}
        actions={
          <Button className="gap-2" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            تسجيل سداد
          </Button>
        }
      />
      <Dialog
          open={dialogOpen}
          onOpenChange={(v) => {
            setDialogOpen(v);
            if (!v) resetForm();
          }}
        >
          <DialogContent className="max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle>
                {editTarget
                  ? `تعديل الدفعة #${editTarget.payment_number}`
                  : "تسجيل سداد عميل"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>
                  العميل <span className="text-red-500">*</span>
                </Label>
                <LookupCombobox
                  items={customers}
                  value={customerId}
                  onValueChange={(v) => {
                    setCustomerId(v);
                    setFieldErrors((e) => {
                      const { customer, ...rest } = e;
                      return rest;
                    });
                  }}
                  placeholder="اختر العميل"
                  error={!!fieldErrors.customer}
                />
                <FormFieldError message={fieldErrors.customer} />
                {customerId && (
                  <p className="text-xs text-muted-foreground">
                    الرصيد:{" "}
                    {customers
                      .find((c) => c.id === customerId)
                      ?.balance?.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                      })}{" "}
                    EGP
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>
                  المبلغ <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => {
                    setAmount(+e.target.value);
                    setFieldErrors((er) => {
                      const { amount, ...rest } = er;
                      return rest;
                    });
                  }}
                  className="font-mono"
                  error={!!fieldErrors.amount}
                />
                <FormFieldError message={fieldErrors.amount} />
              </div>
              <div className="space-y-2">
                <Label>التاريخ</Label>
                <DatePickerInput
                  value={paymentDate}
                  onChange={setPaymentDate}
                  placeholder="اختر التاريخ"
                />
              </div>
              <div className="space-y-2">
                <Label>طريقة الدفع</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">نقدي</SelectItem>
                    <SelectItem value="bank">تحويل بنكي</SelectItem>
                    <SelectItem value="check">شيك</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>مرجع</Label>
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="رقم إيصال أو شيك"
                />
              </div>
              <div className="space-y-2">
                <Label>ملاحظات</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleSaveDraft}
                  disabled={saving}
                  variant="outline"
                  className="flex-1"
                >
                  {saving && <Loader2 className="h-4 w-4 ml-1 animate-spin" />}
                  {saving
                    ? "جاري الحفظ..."
                    : editTarget
                      ? "تحديث المسودة"
                      : "حفظ كمسودة"}
                </Button>
                <Button
                  onClick={handleSubmitPosted}
                  disabled={saving}
                  className="flex-1"
                >
                  {saving && <Loader2 className="h-4 w-4 ml-1 animate-spin" />}
                  {saving
                    ? "جاري الحفظ..."
                    : editTarget
                      ? "تحديث وترحيل"
                      : "حفظ وترحيل"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder="بحث..."
        isLoading={loading}
        emptyMessage="لا توجد مدفوعات"
        toolbarContent={
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={methodFilter} onValueChange={setMethodFilter}>
              <SelectTrigger className="w-36 h-9 text-sm">
                <SelectValue placeholder="طريقة الدفع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الطرق</SelectItem>
                <SelectItem value="cash">نقدي</SelectItem>
                <SelectItem value="bank">تحويل بنكي</SelectItem>
                <SelectItem value="check">شيك</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 h-9 text-sm">
                <SelectValue placeholder="الحالة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="draft">مسودة</SelectItem>
                <SelectItem value="posted">مرحّل</SelectItem>
                <SelectItem value="cancelled">ملغي</SelectItem>
              </SelectContent>
            </Select>
            <DatePickerInput
              value={dateFrom}
              onChange={setDateFrom}
              placeholder="من تاريخ"
              className="w-[150px] h-9 text-sm"
            />
            <DatePickerInput
              value={dateTo}
              onChange={setDateTo}
              placeholder="إلى تاريخ"
              className="w-[150px] h-9 text-sm"
            />
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-9 gap-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
                مسح الفلاتر
              </Button>
            )}
            <ExportMenu
              config={{
                filenamePrefix: "مدفوعات-العملاء",
                sheetName: "مدفوعات العملاء",
                pdfTitle: "مدفوعات العملاء",
                headers: [
                  "#",
                  "العميل",
                  "التاريخ",
                  "المبلغ",
                  "الطريقة",
                  "الحالة",
                ],
                rows: filtered.map((p) => [
                  p.payment_number,
                  p.customer_name || "—",
                  p.payment_date,
                  fmtCurrency(p.amount),
                  methodLabels[p.payment_method] || p.payment_method,
                  statusLabels[p.status] || p.status,
                ]),
                settings,
                pdfOrientation: "landscape",
              }}
              disabled={loading}
            />
          </div>
        }
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              حذف الدفعة #{deleteTarget?.payment_number}
            </AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذه الدفعة؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Post confirmation */}
      <AlertDialog open={!!postTarget} onOpenChange={() => setPostTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              ترحيل الدفعة #{postTarget?.payment_number}
            </AlertDialogTitle>
            <AlertDialogDescription>
              سيتم إنشاء قيد محاسبي وتحديث رصيد العميل بمبلغ{" "}
              {postTarget?.amount.toLocaleString("en-US", {
                minimumFractionDigits: 2,
              })}
              . هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handlePostDraft}>
              ترحيل
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel confirmation */}
      <AlertDialog
        open={!!cancelTarget}
        onOpenChange={() => setCancelTarget(null)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              إلغاء الدفعة #{cancelTarget?.payment_number}
            </AlertDialogTitle>
            <AlertDialogDescription>
              سيتم إلغاء القيد المحاسبي وإعادة رصيد العميل بمبلغ{" "}
              {cancelTarget?.amount.toLocaleString("en-US", {
                minimumFractionDigits: 2,
              })}
              . هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              تأكيد الإلغاء
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
