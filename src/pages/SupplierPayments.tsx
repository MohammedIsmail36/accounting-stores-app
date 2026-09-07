import React, { useState, useEffect, useMemo } from "react";
import { StatusFilterSelect } from "@/components/FilterBar";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import { formatDisplayNumber } from "@/lib/posted-number-utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePickerInput } from "@/components/DatePickerInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { LookupCombobox } from "@/components/LookupCombobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, CreditCard, X, Trash2, CheckCircle, XCircle, Pencil, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Loader2 } from "lucide-react";
import { ExportMenu } from "@/components/ExportMenu";
import { FormFieldError } from "@/components/FormFieldError";
import { useSettings } from "@/contexts/SettingsContext";
import { INVOICE_STATUS_LABELS } from "@/lib/constants";
import { notify } from "@/lib/notify";
import {
  fetchPaymentVoucherData,
  filterPaymentVouchers,
  hasPaymentVoucherFilters,
  savePaymentVoucherDraft,
  postPaymentVoucher,
  updatePostedPaymentVoucher,
  cancelPaymentVoucher,
  deletePaymentVoucher,
  getPostedVoucherEditBlockReason,
} from "@/lib/payment-voucher";

interface Supplier {
  id: string;
  code: string;
  name: string;
  balance?: number;
}
interface Payment {
  id: string;
  payment_number: number;
  posted_number: number | null;
  supplier_id: string;
  supplier_name?: string;
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

export default function SupplierPayments() {
  const { role } = useAuth();
  const { settings, formatCurrency: fmtCurrency } = useSettings();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [methodFilter, setMethodFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [supplierId, setSupplierId] = useState("");
  const [amount, setAmount] = useState(0);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [editTarget, setEditTarget] = useState<Payment | null>(null);
  const [editingPosted, setEditingPosted] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Payment | null>(null);
  const [postTarget, setPostTarget] = useState<Payment | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Payment | null>(null);
  const [editPostedTarget, setEditPostedTarget] = useState<Payment | null>(null);

  const canEdit = role === "admin" || role === "accountant";

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    setLoading(true);
    const { entities, vouchers } = await fetchPaymentVoucherData("supplier");
    setSuppliers(entities as Supplier[]);
    setPayments(vouchers.map((p) => ({ ...(p as any), supplier_name: p.entity_name })) as Payment[]);
    setLoading(false);
  }

  const filtered = useMemo(
    () => filterPaymentVouchers(payments, { methodFilter, statusFilter, dateFrom, dateTo }),
    [payments, methodFilter, statusFilter, dateFrom, dateTo],
  );

  const hasFilters = hasPaymentVoucherFilters({ methodFilter, statusFilter, dateFrom, dateTo });
  const clearFilters = () => {
    setMethodFilter("all");
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  function openEditDialog(p: Payment) {
    setEditTarget(p);
    setSupplierId(p.supplier_id);
    setAmount(p.amount);
    setPaymentDate(p.payment_date);
    setPaymentMethod(p.payment_method);
    setReference(p.reference || "");
    setNotes(p.notes || "");
    setDialogOpen(true);
  }

  /** Validates the form and returns true when it is ready to be submitted. */
  function validateForm() {
    const errors: Record<string, string> = {};
    if (!supplierId) errors.supplier = "يرجى اختيار المورد";
    if (amount <= 0) errors.amount = "يرجى إدخال مبلغ صحيح";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  /** Runs a voucher mutation with unified saving state + error reporting. */
  async function runVoucherAction(action: () => Promise<void>) {
    if (saving) return;
    setSaving(true);
    try {
      await action();
      fetchAll();
    } catch (error: any) {
      notify.error("خطأ", error.message);
    } finally {
      setSaving(false);
    }
  }

  // Save as DRAFT (no journal entry, no balance update)
  async function handleSaveDraft() {
    if (!validateForm()) return;
    await runVoucherAction(async () => {
      await savePaymentVoucherDraft({
        kind: "supplier",
        id: editTarget?.id,
        entityId: supplierId,
        date: paymentDate,
        amount,
        method: paymentMethod,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      });
      notify.success(editTarget ? "تم التحديث" : "تم الحفظ", editTarget ? "تم تحديث المسودة بنجاح" : "تم حفظ الدفعة كمسودة");
      setDialogOpen(false);
      resetForm();
    });
  }

  // Save and POST directly
  async function handleSubmitPosted() {
    if (!validateForm()) return;
    await runVoucherAction(async () => {
      if (editTarget && editingPosted) {
        await updatePostedPaymentVoucher({
          kind: "supplier",
          id: editTarget.id,
          entityId: supplierId,
          previousEntityId: editTarget.supplier_id,
          date: paymentDate,
          amount,
          method: paymentMethod,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        });
        notify.success("تم التحديث", "تم تعديل السند بنفس رقم السند ورقم القيد");
      } else {
        if (editTarget) {
          // Draft edit → persist changes then post the same row
          await savePaymentVoucherDraft({
            kind: "supplier",
            id: editTarget.id,
            entityId: supplierId,
            date: paymentDate,
            amount,
            method: paymentMethod,
            reference: reference.trim() || null,
            notes: notes.trim() || null,
          });
        }
        await postVoucher({
          entityId: supplierId,
          date: paymentDate,
          amount,
          method: paymentMethod,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
          existingPaymentId: editTarget?.id,
        });
        notify.success("تم التسجيل", "تم تسجيل السداد بنجاح");
      }
      setDialogOpen(false);
      resetForm();
    });
  }

  /** Thin wrapper injecting settings + resolved supplier name into the shared post flow. */
  async function postVoucher(args: {
    entityId: string;
    date: string;
    amount: number;
    method: string;
    reference: string | null;
    notes: string | null;
    existingPaymentId?: string;
  }) {
    await postPaymentVoucher({
      kind: "supplier",
      ...args,
      entityName: suppliers.find((s) => s.id === args.entityId)?.name || "",
      prefix: settings?.supplier_payment_prefix,
      lockedUntilDate: settings?.locked_until_date,
    });
  }

  // Post a draft payment
  async function handlePostDraft() {
    if (!postTarget) return;
    const target = postTarget;
    await runVoucherAction(async () => {
      await postVoucher({
        entityId: target.supplier_id,
        date: target.payment_date,
        amount: target.amount,
        method: target.payment_method,
        reference: target.reference,
        notes: target.notes,
        existingPaymentId: target.id,
      });
      notify.success("تم الترحيل", `تم ترحيل الدفعة #${target.payment_number}`);
      setPostTarget(null);
    });
  }

  // Delete a draft payment
  async function handleDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    await runVoucherAction(async () => {
      await deletePaymentVoucher("supplier", target.id);
      notify.success("تم الحذف", `تم حذف الدفعة #${target.payment_number}`);
      setDeleteTarget(null);
    });
  }

  // Cancel a posted payment (reverse journal + restore balance)
  async function handleCancel() {
    if (!cancelTarget) return;
    const target = cancelTarget;
    await runVoucherAction(async () => {
      await cancelPaymentVoucher("supplier", {
        id: target.id,
        journal_entry_id: target.journal_entry_id,
        entityId: target.supplier_id,
      });
      notify.success(
        "تم الإلغاء",
        `تم إلغاء الدفعة #${target.payment_number} وعكس القيد المحاسبي وفك جميع التخصيصات`,
      );
      setCancelTarget(null);
    });
  }

  // Convert a posted payment back to an editable form while preserving
  // the original posted_number and journal posted_number (handled by the RPC).
  function handleConfirmEditPosted() {
    if (!editPostedTarget) return;
    const target = editPostedTarget;
    const blockReason = getPostedVoucherEditBlockReason(target, settings?.locked_until_date);
    if (blockReason) {
      notify.error("غير مسموح", blockReason);
      setEditPostedTarget(null);
      return;
    }
    // Just open the dialog with the posted payment's data. No DB writes here.
    setEditTarget(target);
    setEditingPosted(true);
    setSupplierId(target.supplier_id);
    setAmount(target.amount);
    setPaymentDate(target.payment_date);
    setPaymentMethod(target.payment_method);
    setReference(target.reference || "");
    setNotes(target.notes || "");
    setEditPostedTarget(null);
    setDialogOpen(true);
  }

  function resetForm() {
    setEditTarget(null);
    setEditingPosted(false);
    setSupplierId("");
    setAmount(0);
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setPaymentMethod("cash");
    setReference("");
    setNotes("");
  }


  const prefix = settings?.supplier_payment_prefix || "SPY-";

  const columns: ColumnDef<Payment, any>[] = [
    {
      accessorKey: "payment_number",
      header: ({ column }) => <DataTableColumnHeader column={column} title="الرقم" />,
      cell: ({ row }) => (
        <span className="font-mono">
          {formatDisplayNumber(prefix, row.original.posted_number, row.original.payment_number, row.original.status)}
        </span>
      ),
    },
    {
      accessorKey: "payment_date",
      header: ({ column }) => <DataTableColumnHeader column={column} title="التاريخ" />,
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.payment_date}</span>,
    },
    {
      accessorKey: "supplier_name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="المورد" />,
      cell: ({ row }) => <span className="font-medium">{row.original.supplier_name || "—"}</span>,
    },
    {
      accessorKey: "amount",
      header: ({ column }) => <DataTableColumnHeader column={column} title="المبلغ" />,
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
        <Badge variant="outline">{methodLabels[row.original.payment_method] || row.original.payment_method}</Badge>
      ),
    },

    {
      accessorKey: "reference",
      meta: { hideOnMobile: true },
      header: "المرجع",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.reference || "—"}</span>,
    },

    {
      accessorKey: "status",
      header: "الحالة",
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} />
      ),
    },

    {
      id: "type",
      header: "النوع",
      cell: ({ row }) => {
        const isRefund = row.original.isRefund;
        return (
          <Badge variant={isRefund ? "default" : "destructive"} className="gap-1">
            {isRefund ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
            {isRefund ? "قبض" : "صرف"}
          </Badge>
        );
      },
    },

    {
      id: "actions",
      header: "الإجراء",
      cell: ({ row }) => {
        const p = row.original;
        if (!canEdit) return null;
        return (
          <div className="flex items-center gap-1">
            {p.status === "draft" && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openEditDialog(p)}
                  className="h-7 w-7"
                  title="تعديل"
                  aria-label="تعديل"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPostTarget(p)} className="gap-1 text-xs h-7 px-2">
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
              <>
                {!p.isRefund && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditPostedTarget(p)}
                    className="h-7 w-7"
                    title="تعديل مع الحفاظ على نفس رقم السند والقيد"
                    aria-label="تعديل السند المُرحَّل"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCancelTarget(p)}
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  title="إلغاء السند"
                  aria-label="إلغاء السند"
                >
                  <XCircle className="h-3.5 w-3.5" />
                </Button>
              </>
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
        title="مدفوعات الموردين"
        description={`${payments.length} عملية`}
        actions={
          canEdit ? (
            <Button className="gap-2" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              تسجيل سداد
            </Button>
          ) : undefined
        }
      />
      {canEdit && (
        <Dialog
          open={dialogOpen}
          onOpenChange={(v) => {
            setDialogOpen(v);
            if (!v) resetForm();
          }}
        >
          <DialogContent className="max-w-md" dir="rtl">
            <DialogHeader dir="rtl">
              <DialogTitle>{editingPosted && editTarget ? `تعديل السند المُرحَّل ${prefix}${String(editTarget.posted_number ?? 0).padStart(4, "0")}` : editTarget ? `تعديل الدفعة #${editTarget.payment_number}` : "تسجيل سداد مورد"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>
                  المورد <span className="text-red-500">*</span>
                </Label>
                <LookupCombobox
                  items={suppliers}
                  value={supplierId}
                  onValueChange={(v) => {
                    setSupplierId(v);
                    setFieldErrors((e) => {
                      const { supplier, ...rest } = e;
                      return rest;
                    });
                  }}
                  placeholder="اختر المورد"
                  error={!!fieldErrors.supplier}
                />
                <FormFieldError message={fieldErrors.supplier} />
                {supplierId && (
                  <p className="text-xs text-muted-foreground">
                    الرصيد:{" "}
                    {suppliers
                      .find((s) => s.id === supplierId)
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
                    setFieldErrors((err) => {
                      const { amount, ...rest } = err;
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
                <DatePickerInput value={paymentDate} onChange={setPaymentDate} placeholder="اختر التاريخ" />
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
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
              <div className="flex gap-2">
                {!editingPosted && (
                  <Button onClick={handleSaveDraft} disabled={saving} variant="outline" className="flex-1">
                    {saving && <Loader2 className="h-4 w-4 ml-1 animate-spin" />}
                    {saving ? "جاري الحفظ..." : editTarget ? "تحديث المسودة" : "حفظ كمسودة"}
                  </Button>
                )}
                <Button onClick={handleSubmitPosted} disabled={saving} className="flex-1">
                  {saving && <Loader2 className="h-4 w-4 ml-1 animate-spin" />}
                  {saving ? "جاري الحفظ..." : editingPosted ? "حفظ التعديل" : editTarget ? "تحديث وترحيل" : "حفظ وترحيل"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <DataTable
        compactRows
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
            <StatusFilterSelect value={statusFilter} onChange={setStatusFilter} className="w-36 h-9 text-sm" />
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
                filenamePrefix: "مدفوعات-الموردين",
                sheetName: "مدفوعات الموردين",
                pdfTitle: "مدفوعات الموردين",
                headers: ["#", "المورد", "التاريخ", "المبلغ", "الطريقة", "الحالة"],
                rows: filtered.map((p) => [
                  p.payment_number,
                  p.supplier_name || "—",
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
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title={`حذف الدفعة #${deleteTarget?.payment_number ?? ""}`}
        description="هل أنت متأكد من حذف هذه الدفعة؟ لا يمكن التراجع عن هذا الإجراء."
        confirmText="حذف"
        destructive
        onConfirm={handleDelete}
      />

      {/* Post confirmation */}
      <ConfirmDialog
        open={!!postTarget}
        onOpenChange={() => setPostTarget(null)}
        title={`ترحيل الدفعة #${postTarget?.payment_number ?? ""}`}
        description={
          <>
            سيتم إنشاء قيد محاسبي وتحديث رصيد المورد بمبلغ{" "}
            {postTarget?.amount.toLocaleString("en-US", {
              minimumFractionDigits: 2,
            })}
            . هل تريد المتابعة؟
          </>
        }
        confirmText="ترحيل"
        onConfirm={handlePostDraft}
      />

      {/* Cancel confirmation */}
      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={() => setCancelTarget(null)}
        title={`إلغاء الدفعة #${cancelTarget?.payment_number ?? ""}`}
        description={
          <>
            سيتم إلغاء القيد المحاسبي وإعادة رصيد المورد بمبلغ{" "}
            {cancelTarget?.amount.toLocaleString("en-US", {
              minimumFractionDigits: 2,
            })}
            . هل تريد المتابعة؟
          </>
        }
        confirmText="تأكيد الإلغاء"
        destructive
        onConfirm={handleCancel}
      />

      {/* Edit posted payment confirmation */}
      <ConfirmDialog
        open={!!editPostedTarget}
        onOpenChange={() => setEditPostedTarget(null)}
        title={`تعديل سند مُرحّل #${editPostedTarget?.posted_number ?? editPostedTarget?.payment_number ?? ""}`}
        description={
          <>
            سيتم فتح نموذج التعديل مباشرة، وعند الحفظ ستتم إعادة الكتابة فوق نفس السند وقيده المحاسبي كعملية واحدة —{" "}
            <strong>بنفس رقم السند ورقم القيد</strong> ({prefix}
            {String(editPostedTarget?.posted_number ?? 0).padStart(4, "0")}).
            <br />
            لن يتم استهلاك أي رقم جديد من التسلسل، ولن يظهر قيد إضافي في اليومية.
          </>
        }
        confirmText="متابعة"
        onConfirm={handleConfirmEditPosted}
      />

    </div>
  );
}
