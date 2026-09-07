import React, { useState, useEffect } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { useLineItems } from "@/hooks/use-line-items";
import { round2, cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { getNextPostedNumber, formatDisplayNumber } from "@/lib/posted-number-utils";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { createReverseJournalEntry } from "@/lib/journal-writer";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useDocumentFormState } from "@/hooks/use-document-form";
import { mapLoadedLineItems } from "@/lib/document-items-mapping";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { FormFieldError } from "@/components/FormFieldError";
import { PageSkeleton } from "@/components/PageSkeleton";
import { SectionHeader } from "@/components/SectionHeader";
import { calcInvoiceTotals } from "@/lib/invoice-totals";
import { buildLineItemRows } from "@/lib/invoice-items";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/NumberInput";
import { DatePickerInput } from "@/components/DatePickerInput";
import { Label } from "@/components/ui/label";
import { LookupCombobox } from "@/components/LookupCombobox";
import { exportInvoicePdf } from "@/lib/pdf-arabic";
import {
  Plus,
  X,
  Save,
  CheckCircle,
  Printer,
  Pencil,
  Trash2,
  Ban,
  Truck,
  FileText,
  ShoppingCart,
  ListChecks,
  CreditCard,
  StickyNote,
  ArrowLeftRight,
  Loader2,
  Undo2,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

import InvoicePaymentSection from "@/components/InvoicePaymentSection";
import OutstandingCreditsSection from "@/components/OutstandingCreditsSection";
import { recalculateEntityBalance } from "@/lib/entity-balance";
import { QuickAddSupplierDialog } from "@/components/QuickAddSupplierDialog";

import {
  ProductWithBrand,
  productsToLookupItems,
  PRODUCT_SELECT_FIELDS_BASIC,
} from "@/lib/product-utils";
import { ACCOUNT_CODES } from "@/lib/constants";
import { notify } from "@/lib/notify";
import { invokeDocumentRpc, deleteDraftDocument } from "@/lib/document-actions";

interface Supplier {
  id: string;
  code: string;
  name: string;
  balance?: number;
}
type Product = ProductWithBrand & { purchase_price: number };
interface InvoiceItem {
  id?: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
}

export default function PurchaseInvoiceForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { settings, formatCurrency } = useSettings();
  const isNew = !id;
  const canEdit = role === "admin" || role === "accountant";

  const showTax = settings?.enable_tax ?? false;
  const showDiscount = settings?.show_discount_on_invoice ?? true;
  const taxRate = settings?.tax_rate ?? 0;

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const {
    saving,
    setSaving,
    isDirty,
    setIsDirty,
    markDirty,
    markClean,
    navGuard,
    runAction,
    ensurePeriodUnlocked,
  } =
    useDocumentFormState({ lockedUntilDate: settings?.locked_until_date });
  const [paymentSectionRefreshKey, setPaymentSectionRefreshKey] = useState(0);

  const [invoiceNumber, setInvoiceNumber] = useState<number | null>(null);
  const [postedNumber, setPostedNumber] = useState<number | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");
  const [status, setStatus] = useState("draft");
  const { items, setItems, addItem, removeItem, updateItem, handleLastFieldKeyDown } = useLineItems<InvoiceItem>(
    { priceField: "purchase_price" },
    products,
  );
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  const [editMode, setEditMode] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddInitialName, setQuickAddInitialName] = useState("");

  useEffect(() => {
    loadData();
  }, [id]);

  async function loadData() {
    const [supRes, prodRes] = await Promise.all([
      (supabase.from("suppliers" as any) as any).select("id, code, name, phone, balance").eq("is_active", true).order("name"),
      supabase.from("products").select(PRODUCT_SELECT_FIELDS_BASIC).eq("is_active", true).order("name"),
    ]);
    setSuppliers(supRes.data || []);
    setProducts(prodRes.data || []);

    if (id) {
      const { data: inv } = await (supabase.from("purchase_invoices" as any) as any)
        .select("*, suppliers:supplier_id(name)")
        .eq("id", id)
        .single();
      if (inv) {
        setInvoiceNumber(inv.invoice_number);
        setPostedNumber(inv.posted_number || null);
        setSupplierId(inv.supplier_id || "");
        setSupplierName(inv.suppliers?.name || "");
        setInvoiceDate(inv.invoice_date);
        setNotes(inv.notes || "");
        setReference(inv.reference || "");
        setStatus(inv.status);
        setEditMode(inv.status === "draft");
        setInvoiceDiscount(Number(inv.discount) || 0);

        const { data: itemsData } = await (supabase.from("purchase_invoice_items" as any) as any)
          .select("*, products:product_id(name, code, model_number, product_brands(name))")
          .eq("invoice_id", id)
          .order("sort_order", { ascending: true });
        setItems(mapLoadedLineItems<InvoiceItem>(itemsData));
      }
      setLoading(false);
    } else {
      setEditMode(true);
      setLoading(false);
    }
  }

  async function handleSettlementChanged() {
    await loadData();
    setPaymentSectionRefreshKey((current) => current + 1);
  }

  const { subtotal, hasLineDiscount, hasInvoiceDiscount, discountMode, afterDiscount, taxAmount, grandTotal } =
    calcInvoiceTotals({ items, invoiceDiscount, showTax, taxRate });

  async function handleSave(opts?: { silent?: boolean; skipReload?: boolean }): Promise<boolean> {
    if (saving) return false;
    const errors: Record<string, string> = {};
    // Draft is permissive: keep partial work even without a supplier or items.
    // Strict validation runs on Post (postInvoice / DB function).
    if (items.some((i) => i.product_id && i.quantity <= 0)) errors.items = "يجب أن تكون الكمية أكبر من صفر";
    if (items.some((i) => i.unit_price < 0)) errors.items = "لا يمكن أن يكون السعر سالباً";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      notify.error("تنبيه", Object.values(errors)[0]);
      return false;
    }
    setSaving(true);
    try {
      // Drop empty placeholder rows (no product) — keep user data intact
      const validItems = items.filter((i) => i.product_id);
      const droppedEmpty = items.length - validItems.length;
      if (droppedEmpty > 0) {
        setItems(validItems as any);
      }
      // Block creating brand-new empty invoices (no supplier AND no items)
      if (isNew && !supplierId && validItems.length === 0) {
        notify.error("تنبيه", "لا يمكن حفظ فاتورة فارغة - أضف موردًا أو بنودًا أولاً");
        setSaving(false);
        return false;
      }
      // الخصم العام (إن وُجد) يُوزّع تناسبيًا على net_total لضمان دقة تكلفة الشراء
      const invoiceLevelReduction = discountMode === "invoice" ? invoiceDiscount : 0;


      const payload: any = {
        supplier_id: supplierId || null,
        invoice_date: invoiceDate,
        subtotal,
        discount: invoiceDiscount,
        tax: taxAmount,
        total: grandTotal,
        notes: notes.trim() || null,
        reference: reference.trim() || null,
        status: "draft",
      };

      const draftSavedMsg = droppedEmpty > 0 ? `تم الحفظ مع تجاهل ${droppedEmpty} سطر فارغ` : undefined;

      if (isNew) {
        const { data: inv, error } = await (supabase.from("purchase_invoices" as any) as any)
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        const rows = buildLineItemRows(validItems, {
          parentKey: "invoice_id",
          parentId: inv.id,
          reduction: invoiceLevelReduction,
          base: subtotal,
        });

        if (rows.length > 0) {
          await (supabase.from("purchase_invoice_items" as any) as any).insert(rows);
        }
        if (!opts?.silent) {
          notify.success("تمت الإضافة", draftSavedMsg || "تم إنشاء فاتورة الشراء كمسودة");
        }
        markClean();
        navigate(`/purchases/${inv.id}`);
      } else {
        const { error } = await (supabase.from("purchase_invoices" as any) as any).update(payload).eq("id", id);
        if (error) throw error;
        await (supabase.from("purchase_invoice_items" as any) as any).delete().eq("invoice_id", id);
        const rows = buildLineItemRows(validItems, {
          parentKey: "invoice_id",
          parentId: id!,
          reduction: invoiceLevelReduction,
          base: subtotal,
        });

        if (rows.length > 0) {
          await (supabase.from("purchase_invoice_items" as any) as any).insert(rows);
        }
        if (!opts?.silent) {
          notify.success("تم التحديث", draftSavedMsg || "تم تحديث فاتورة الشراء");
        }
        markClean();
        if (!opts?.skipReload) loadData();
      }
    } catch (error: any) {
      notify.error("خطأ", error.message);
      setSaving(false);
      return false;
    }
    setSaving(false);
    return true;
  }

  async function postInvoice() {
    if (saving) return;
    // Strict pre-post validation
    if (!supplierId) {
      notify.error("تنبيه", "يرجى اختيار المورد قبل الترحيل");
      setFieldErrors((e) => ({ ...e, supplier: "يرجى اختيار المورد" }));
      return;
    }
    if (items.length === 0 || items.some((i) => !i.product_id)) {
      notify.error("تنبيه", "يجب إضافة بنود الفاتورة واختيار منتج لكل بند قبل الترحيل");
      return;
    }
    if (
      !ensurePeriodUnlocked(
        invoiceDate,
        (lockedUntil) => `لا يمكن ترحيل فاتورة بتاريخ ${invoiceDate} — الفترة مقفلة حتى ${lockedUntil}`,
      )
    )
      return;
    // Persist any unsaved edits (e.g. invoice-level discount) before posting
    if (isDirty && id) {
      const saved = await handleSave({ silent: true, skipReload: true });
      if (!saved) {
        notify.error("تعذر الترحيل", "فشل حفظ التعديلات غير المحفوظة — لم تتم عملية الترحيل");
        return;
      }
    }
    setSaving(true);
    try {
      const res = await invokeDocumentRpc("post_purchase_invoice", { p_invoice_id: id });
      if (!res.success) {
        notify.error("خطأ", res.error || "حدث خطأ أثناء الترحيل");
        return;
      }

      await recalculateEntityBalance("supplier", supplierId);

      notify.success("تم الترحيل", "تم ترحيل فاتورة الشراء وتوليد القيد المحاسبي وتحديث المخزون");
      markClean();
      loadData();
    } catch (error: any) {
      notify.error("خطأ", error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDraft() {
    if (saving) return;
    await runAction(async () => {
      await deleteDraftDocument({
        itemsTable: "purchase_invoice_items",
        parentTable: "purchase_invoices",
        parentKey: "invoice_id",
        id: id!,
      });
      notify.success("تم الحذف", "تم حذف فاتورة الشراء المسودة");
      markClean();
      navigate("/purchases");
    });
  }

  async function handleResetToDraft() {
    if (saving || !id) return;
    await runAction(async () => {
      const res = await invokeDocumentRpc("unpost_purchase_invoice", { p_invoice_id: id });
      if (!res.success) {
        notify.error(res.isException ? "خطأ" : "غير مسموح", res.error || "تعذر إعادة التعيين");
        return;
      }
      if (supplierId) await recalculateEntityBalance("supplier", supplierId);
      notify.success("تم إعادة التعيين كمسودة", "أصبحت الفاتورة قابلة للتعديل، والقيد المحاسبي أصبح مسودة ولن يظهر في التقارير");
      markClean();
      window.location.reload();
    });
  }

  async function handleCancelPosted() {
    if (saving) return;
    await runAction(async () => {
      const { data: inv } = await (supabase.from("purchase_invoices" as any) as any)
        .select("journal_entry_id, posted_number, invoice_number")
        .eq("id", id)
        .single();

      for (const item of items) {
        if (!item.product_id) continue;
        const { data: prod } = await supabase
          .from("products")
          .select("quantity_on_hand")
          .eq("id", item.product_id)
          .single();
        if (prod) {
          await supabase
            .from("products")
            .update({
              quantity_on_hand: prod.quantity_on_hand - item.quantity,
            } as any)
            .eq("id", item.product_id);
        }
        await (supabase.from("inventory_movements" as any) as any)
          .delete()
          .eq("reference_id", id)
          .eq("product_id", item.product_id);
      }

      await (supabase.from("purchase_invoices" as any) as any).update({ status: "cancelled" }).eq("id", id);
      await recalculateEntityBalance("supplier", supplierId);

      if (inv?.journal_entry_id) {
        await createReverseJournalEntry({
          sourceEntryId: inv.journal_entry_id,
          entryDate: new Date().toISOString().split("T")[0],
          description: `عكس فاتورة شراء رقم ${formatDisplayNumber(settings?.purchase_invoice_prefix || "PUR-", inv?.posted_number, inv?.invoice_number || 0, "posted")}`,
        });
      }

      // status already set to cancelled above
      notify.success("تم الإلغاء", "تم إلغاء الفاتورة وعكس القيد المحاسبي وإرجاع الكميات");
      markClean();
      loadData();
    });
  }

  async function handlePrint() {
    await exportInvoicePdf({
      type: "purchase_invoice",
      number: invoiceNumber
        ? formatDisplayNumber(
            settings?.purchase_invoice_prefix || "PUR-",
            postedNumber,
            invoiceNumber,
            status,
          )
        : "جديدة",
      date: invoiceDate,
      partyName: supplierName || suppliers.find((s) => s.id === supplierId)?.name || "—",
      partyLabel: "المورد",
      reference: reference || undefined,
      notes: notes || undefined,
      items: items.map((i) => ({
        name: i.product_name,
        quantity: i.quantity,
        unitPrice: i.unit_price,
        discount: i.discount,
        total: i.total,
      })),
      subtotal,
      discountTotal: items.reduce((s, i) => s + i.discount, 0),
      invoiceDiscount: invoiceDiscount > 0 ? invoiceDiscount : undefined,
      taxAmount,
      taxRate,
      grandTotal,
      showTax,
      showDiscount,
      settings,
      status,
    });
  }

  if (loading) return <PageSkeleton variant="form" />;

  const isDraft = status === "draft";
  const isEditable = editMode && isDraft && canEdit;
  const colCount = 4 + (showDiscount ? 1 : 0) + (isEditable ? 1 : 0);

  const displayNumber = !isNew
    ? formatDisplayNumber(settings?.purchase_invoice_prefix || "PUR-", postedNumber, invoiceNumber || 0, status)
    : null;

  const totalDiscount = items.reduce((s, i) => s + i.discount, 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto" dir="rtl" onInput={() => isEditable && markDirty()}>
      <PageHeader
        icon={ShoppingCart}
        title={isNew ? "إنشاء فاتورة مشتريات" : "فاتورة مشتريات"}
        badge={
          <>
            {displayNumber && (
              <span className="text-sm font-semibold text-muted-foreground border border-border px-3 py-1 rounded-lg bg-muted/50 font-mono tabular-nums">
                {displayNumber}
              </span>
            )}
            {!isNew && (
              <StatusBadge status={status} className="text-xs px-3 py-1" />
            )}
          </>
        }
        actions={
          <>
            {!isNew && isDraft && canEdit && (
              <ConfirmDialog
                trigger={
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    حذف
                  </Button>
                }
                title="حذف الفاتورة المسودة"
                description="هل أنت متأكد من حذف هذه الفاتورة؟"
                confirmText="حذف"
                destructive
                onConfirm={handleDeleteDraft}
              />
            )}
            {!isNew && status === "posted" && canEdit && (
              <ConfirmDialog
                trigger={
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
                  >
                    <Ban className="h-4 w-4" />
                    إلغاء
                  </Button>
                }
                title="إلغاء الفاتورة المرحّلة"
                description="سيتم عكس القيد المحاسبي وإرجاع الكميات للمخزون وتعديل رصيد المورد."
                confirmText="إلغاء الفاتورة"
                cancelText="تراجع"
                destructive
                onConfirm={handleCancelPosted}
              />
            )}

            {!isNew && status === "posted" && role === "admin" && (
              <ConfirmDialog
                trigger={
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Undo2 className="h-4 w-4" />
                    إعادة كمسودة
                  </Button>
                }
                title="إعادة تعيين الفاتورة كمسودة"
                description="ستعود الفاتورة لحالة المسودة ليمكن تعديلها، ويتحول قيدها المحاسبي إلى مسودة (يخرج من التقارير دون حذفه)، وتُسحب كميات الفاتورة من المخزون. يظل رقم الفاتورة كما هو ويُعاد استخدام نفس القيد عند الترحيل مرة أخرى. غير مسموح إن وُجد سداد أو مرتجع مرتبط بالفاتورة."
                cancelText="تراجع"
                onConfirm={handleResetToDraft}
              />
            )}

            {!isNew && (
              <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5">
                <Printer className="h-4 w-4" />
                طباعة
              </Button>
            )}
            {!isNew && isDraft && canEdit && !editMode && (
              <Button variant="outline" size="sm" onClick={() => setEditMode(true)} className="gap-1.5">
                <Pencil className="h-4 w-4" />
                تعديل
              </Button>
            )}
            {isEditable && (
              <Button variant="outline" size="sm" onClick={() => handleSave()} disabled={saving} className="gap-1.5">
                <Save className="h-4 w-4" />
                {saving ? "جاري الحفظ..." : "حفظ مسودة"}
              </Button>
            )}
            {!isNew && isDraft && canEdit && (
              <Button
                size="sm"
                onClick={postInvoice}
                disabled={saving}
                className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-5"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                {saving ? "جاري الترحيل..." : "إصدار الفاتورة"}
              </Button>
            )}
          </>
        }
      />

      {/* ── Supplier Details Card ── */}
      <div className="bg-card p-6 rounded-2xl border shadow-sm">
        <div className="mb-5">
          <SectionHeader icon={Truck} title="بيانات الفاتورة" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-muted-foreground">
              اسم المورد{" "}
              {status === "draft" ? (
                <span className="text-xs text-muted-foreground">(اختياري للمسودة — مطلوب عند الترحيل)</span>
              ) : (
                <span className="text-red-500">*</span>
              )}
            </Label>
            {isEditable ? (
              <LookupCombobox
                items={suppliers.map((s: any) => ({
                  id: s.id,
                  name: s.name,
                  label: `${s.code || ""} - ${s.name || ""}`,
                  searchKeywords: [s.code, s.phone].filter(Boolean).join(" "),
                  searchFields: { code: s.code || "", name: s.name || "", phone: s.phone || "" },
                }))}
                value={supplierId}
                onValueChange={(v) => {
                  setSupplierId(v);
                  setIsDirty(true);
                  setFieldErrors((e) => {
                    const { supplier, ...rest } = e;
                    return rest;
                  });
                }}
                placeholder="اختر مورد أو أضف جديداً"
                error={!!fieldErrors.supplier}
                onAddNew={(searchText) => {
                  setQuickAddInitialName(searchText);
                  setQuickAddOpen(true);
                }}
                addNewLabel="إضافة مورد جديد"
              />
            ) : (
              <div className="h-10 px-4 flex items-center rounded-xl border bg-muted/30 text-sm font-medium">
                {supplierName || suppliers.find((s) => s.id === supplierId)?.name || "—"}
              </div>
            )}
            <FormFieldError message={fieldErrors.supplier} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-muted-foreground">تاريخ الإصدار</Label>
            {isEditable ? (
              <DatePickerInput
                value={invoiceDate}
                onChange={(v) => {
                  setInvoiceDate(v);
                  setIsDirty(true);
                }}
                placeholder="اختر التاريخ"
              />
            ) : (
              <div className="h-10 px-4 flex items-center rounded-xl border bg-muted/30 text-sm font-mono tabular-nums">
                {invoiceDate}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-muted-foreground">رقم المرجع</Label>
            {isEditable ? (
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="أدخل رقم المرجع"
                className="rounded-xl"
              />
            ) : (
              <div className="h-10 px-4 flex items-center rounded-xl border bg-muted/30 text-sm">
                {reference || "—"}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Items Table Card ── */}
      <div
        className={cn("bg-card rounded-2xl border shadow-sm overflow-hidden", fieldErrors.items && "border-red-500")}
      >
        {/* Card Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <SectionHeader icon={ListChecks} title="بنود الفاتورة" />
            {items.length > 0 && (
              <span className="text-xs font-medium text-muted-foreground bg-muted border border-border/60 px-2.5 py-0.5 rounded-full tabular-nums">
                {items.length} {items.length === 1 ? "بند" : "بنود"}
              </span>
            )}
            <FormFieldError message={fieldErrors.items} />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "4%" }} />
              <col style={{ width: showDiscount ? "38%" : "48%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "18%" }} />
              {showDiscount && <col style={{ width: "14%" }} />}
              <col style={{ width: "18%" }} />
              {isEditable && <col style={{ width: "4%" }} />}
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="py-1 px-3 font-medium text-muted-foreground text-xs text-center">#</th>
                <th className="py-1 px-3 font-medium text-muted-foreground text-xs">البند</th>
                <th className="py-1 px-3 font-medium text-muted-foreground text-xs text-center">الكمية</th>
                <th className="py-1 px-3 font-medium text-muted-foreground text-xs text-center">سعر الوحدة</th>
                {showDiscount && (
                  <th className="py-1 px-3 font-medium text-muted-foreground text-xs text-center">الخصم</th>
                )}
                <th className="py-1 px-3 font-medium text-muted-foreground text-xs text-center">المجموع</th>
                {isEditable && <th className="py-1 px-2" />}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={colCount}>
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                        <ListChecks className="h-5 w-5 text-muted-foreground/40" />
                      </div>
                      <p className="text-sm font-medium text-muted-foreground">لا توجد بنود بعد</p>
                      {isEditable && <p className="text-xs text-muted-foreground/50">اضغط «إضافة بند جديد» للبدء</p>}
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item, i) => (
                  <tr
                    key={i}
                    data-invoice-row={i}
                    className="group border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors duration-100"
                  >
                    <td className="py-1 px-3 text-center">
                      <span className="text-xs font-medium text-muted-foreground/40 tabular-nums">{i + 1}</span>
                    </td>
                    <td className="py-1 px-3 min-w-0">
                      {isEditable ? (
                        <LookupCombobox
                          items={productsToLookupItems(products, false, true)}
                          value={item.product_id}
                          onValueChange={(v) => updateItem(i, "product_id", v)}
                          placeholder="اختر المنتج"
                        />
                      ) : (
                        <span className="font-medium text-sm block truncate" title={item.product_name}>
                          {item.product_name}
                        </span>
                      )}
                    </td>
                    <td className="py-1 px-3">
                      {isEditable ? (
                        <NumberInput
                          min={1}
                          value={item.quantity}
                          onValueChange={(v) => updateItem(i, "quantity", v)}
                          className="font-mono tabular-nums text-center bg-muted/30 border-border rounded-md h-8 w-full"
                        />
                      ) : (
                        <span className="font-mono tabular-nums text-sm block text-center">{item.quantity}</span>
                      )}
                    </td>
                    <td className="py-1 px-3 text-center">
                      {isEditable ? (
                        <NumberInput
                          min={0}
                          value={item.unit_price}
                          onValueChange={(v) => updateItem(i, "unit_price", v)}
                          onKeyDown={!showDiscount ? (e) => handleLastFieldKeyDown(e, i) : undefined}
                          className="font-mono tabular-nums text-center bg-muted/30 border-border rounded-md h-8 w-full"
                        />
                      ) : (
                        <span className="font-mono tabular-nums text-sm text-muted-foreground">
                          {item.unit_price.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                          })}
                        </span>
                      )}
                    </td>
                    {showDiscount && (
                      <td className="py-1 px-3 text-center">
                        {isEditable ? (
                          <NumberInput
                            min={0}
                            value={item.discount}
                            onValueChange={(v) => updateItem(i, "discount", v)}
                            onKeyDown={(e) => handleLastFieldKeyDown(e, i)}
                            disabled={discountMode === "invoice"}
                            className="font-mono tabular-nums text-center bg-muted/30 border-border rounded-md h-8 w-full disabled:opacity-40"
                          />
                        ) : item.discount > 0 ? (
                          <span className="inline-flex items-center text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/40 px-2 py-0.5 rounded-full border border-green-200 dark:border-green-800 font-mono tabular-nums">
                            -
                            {item.discount.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                            })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/30 text-sm">—</span>
                        )}
                      </td>
                    )}
                    <td className="py-1 px-3 text-center w-full">
                      <span className="font-mono tabular-nums font-semibold text-sm text-foreground">
                        {formatCurrency(item.total)}
                      </span>
                    </td>
                    {isEditable && (
                      <td className="py-1 px-2">
                        <button
                          onClick={() => removeItem(i)}
                          className="p-1 rounded-md text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-all opacity-0 group-hover:opacity-100"
                          aria-label="حذف البند"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer: Add button + mini totals chips */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/10 flex-wrap gap-3">
          {isEditable ? (
            <button
              onClick={addItem}
              className="flex items-center gap-2 text-sm font-semibold text-primary hover:bg-primary/5 px-3 py-1.5 rounded-lg transition-all"
            >
              <Plus className="h-4 w-4" />
              إضافة بند جديد
            </button>
          ) : (
            <div />
          )}

          {items.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 bg-muted border border-border/60 px-3 py-1.5 rounded-lg">
                <span className="text-xs text-muted-foreground">المنتجات</span>
                <span className="text-xs font-mono font-semibold tabular-nums text-foreground">
                  {new Set(items.filter((i) => i.product_id).map((i) => i.product_id)).size}
                </span>
              </div>
              <div className="flex items-center gap-1.5 bg-muted border border-border/60 px-3 py-1.5 rounded-lg">
                <span className="text-xs text-muted-foreground">الوحدات</span>
                <span className="text-xs font-mono font-semibold tabular-nums text-foreground">
                  {items.reduce((s, i) => s + i.quantity, 0)}
                </span>
              </div>
              <div className="w-px h-4 bg-border/60" />
              {showDiscount && (totalDiscount > 0 || invoiceDiscount > 0) && (
                <div className="flex items-center gap-1.5 bg-muted border border-border/60 px-3 py-1.5 rounded-lg">
                  <span className="text-xs text-muted-foreground">
                    {discountMode === "invoice" ? "خصم الفاتورة" : "خصم السطور"}
                  </span>
                  <span className="text-xs font-mono font-semibold tabular-nums text-green-600 dark:text-green-400">
                    -{formatCurrency(discountMode === "invoice" ? invoiceDiscount : totalDiscount)}
                  </span>
                </div>
              )}
              {showTax && (
                <div className="flex items-center gap-1.5 bg-muted border border-border/60 px-3 py-1.5 rounded-lg">
                  <span className="text-xs text-muted-foreground">الضريبة {taxRate}%</span>
                  <span className="text-xs font-mono font-semibold tabular-nums text-foreground">
                    {formatCurrency(taxAmount)}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1.5 bg-primary/5 border border-primary/20 px-3 py-1.5 rounded-lg">
                <span className="text-xs text-primary/70 font-medium">الإجمالي</span>
                <span className="text-xs font-mono font-bold tabular-nums text-primary">
                  {formatCurrency(grandTotal)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Notes + Summary: Side by side ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card p-6 rounded-2xl border shadow-sm flex flex-col">
          <div className="mb-4">
            <SectionHeader icon={StickyNote} title="ملاحظات داخلية" />
          </div>
          <div className="flex-1 space-y-2">
            <Label className="text-sm font-medium text-muted-foreground">ملاحظات داخلية (لا تظهر في الطباعة)</Label>
            {isEditable ? (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full h-32 px-4 py-3 bg-muted/30 border border-border rounded-xl text-sm transition-all resize-none focus:ring-2 focus:ring-ring focus:border-ring"
                placeholder="أدخل أي ملاحظات إضافية هنا..."
              />
            ) : (
              <div className="h-32 px-4 py-3 bg-muted/30 border rounded-xl text-sm text-muted-foreground">
                {notes || "لا توجد ملاحظات"}
              </div>
            )}
          </div>
        </div>

        <div className="bg-card p-6 rounded-2xl border shadow-sm flex flex-col justify-between">
          <div className="mb-4">
            <SectionHeader icon={CreditCard} title="ملخص الفاتورة" />
          </div>
          <div className="space-y-1 mt-2">
            <div className="flex justify-between items-center py-2.5 border-b border-border/50">
              <span className="font-mono tabular-nums text-sm font-medium">{formatCurrency(subtotal)}</span>
              <span className="text-sm text-muted-foreground">المجموع الفرعي</span>
            </div>
            {/* Line discounts display */}
            {showDiscount && discountMode === "line" && totalDiscount > 0 && (
              <div className="flex justify-between items-center py-2.5 border-b border-border/50">
                <span className="font-mono tabular-nums text-sm font-medium text-green-600 dark:text-green-400">
                  -{formatCurrency(totalDiscount)}
                </span>
                <span className="text-sm text-muted-foreground">خصم السطور</span>
              </div>
            )}
            {/* Invoice-level discount input */}
            {showDiscount && isEditable && (
              <div className="flex justify-between items-center py-2.5 border-b border-border/50 gap-3">
                <div className="flex items-center gap-2">
                  <NumberInput
                    min={0}
                    value={invoiceDiscount || ""}
                    onValueChange={(v) => {
                      setInvoiceDiscount(round2(v || 0));
                      setIsDirty(true);
                    }}
                    disabled={discountMode === "line"}
                    placeholder="0.00"
                    className="font-mono tabular-nums text-center w-28 h-8 rounded-md disabled:opacity-40"
                  />
                  {invoiceDiscount > 0 && subtotal > 0 && (
                    <span className="text-xs text-muted-foreground font-mono tabular-nums">
                      ({((invoiceDiscount / subtotal) * 100).toFixed(1)}%)
                    </span>
                  )}
                </div>
                <span className="text-sm text-muted-foreground whitespace-nowrap">خصم الفاتورة</span>
              </div>
            )}
            {/* Invoice discount display (non-edit mode) */}
            {showDiscount && !isEditable && invoiceDiscount > 0 && (
              <div className="flex justify-between items-center py-2.5 border-b border-border/50">
                <span className="font-mono tabular-nums text-sm font-medium text-green-600 dark:text-green-400">
                  -{formatCurrency(invoiceDiscount)}
                  {subtotal > 0 && (
                    <span className="text-xs text-muted-foreground mr-1">
                      ({((invoiceDiscount / subtotal) * 100).toFixed(1)}%)
                    </span>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">خصم الفاتورة</span>
              </div>
            )}
            {showTax && (
              <div className="flex justify-between items-center py-2.5 border-b border-border/50">
                <span className="font-mono tabular-nums text-sm font-medium">{formatCurrency(taxAmount)}</span>
                <span className="text-sm text-muted-foreground">ضريبة القيمة المضافة ({taxRate}%)</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-4">
              <span className="text-2xl font-black text-primary font-mono tabular-nums">
                {formatCurrency(grandTotal)}
              </span>
              <span className="text-base font-bold text-foreground">الإجمالي الكلي</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Related Operations ── */}
      {!isNew && status === "posted" && id && supplierId && (
        <div className="bg-card p-6 rounded-2xl border shadow-sm">
          <div className="mb-5">
            <SectionHeader icon={ArrowLeftRight} title="العمليات المرتبطة" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <InvoicePaymentSection
                type="purchase"
                invoiceId={id}
                entityId={supplierId}
                entityName={supplierName || suppliers.find((s) => s.id === supplierId)?.name || ""}
                invoiceTotal={grandTotal}
                invoiceDisplayNumber={displayNumber || ""}
                onPaymentAdded={loadData}
                refreshKey={paymentSectionRefreshKey}
              />
            </div>
            <div className="space-y-4">
              <OutstandingCreditsSection
                type="purchase"
                invoiceId={id}
                entityId={supplierId}
                invoiceTotal={grandTotal}
                onSettlementChanged={handleSettlementChanged}
              />
            </div>
          </div>
        </div>
      )}
      <UnsavedChangesDialog open={navGuard.isBlocked} onStay={navGuard.cancel} onLeave={navGuard.confirm} />
      <QuickAddSupplierDialog
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        initialName={quickAddInitialName}
        onCreated={(s) => {
          setSuppliers((prev) => [...prev, s].sort((a, b) => a.name.localeCompare(b.name, "ar")));
          setSupplierId(s.id);
          setSupplierName(s.name);
          setIsDirty(true);
          setFieldErrors((e) => {
            const { supplier, ...rest } = e;
            return rest;
          });
        }}
      />
    </div>
  );
}
