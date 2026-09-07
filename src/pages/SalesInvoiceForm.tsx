import React, { useState, useEffect } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/PageSkeleton";
import { PageHeader } from "@/components/PageHeader";
import { formatDisplayNumber } from "@/lib/posted-number-utils";
import { useLineItems } from "@/hooks/use-line-items";
import { round2, cn } from "@/lib/utils";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useDocumentFormState } from "@/hooks/use-document-form";
import { mapLoadedLineItems } from "@/lib/document-items-mapping";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { FormFieldError } from "@/components/FormFieldError";
import { SectionHeader } from "@/components/SectionHeader";
import { calcInvoiceTotals } from "@/lib/invoice-totals";
import { buildLineItemPayloads } from "@/lib/invoice-items";

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
  User,
  FileText,
  ListChecks,
  CreditCard,
  Eye,
  StickyNote,
  ArrowLeftRight,
  Loader2,
  Gift,
  Undo2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { ConfirmDialog } from "@/components/ConfirmDialog";

import InvoicePaymentSection from "@/components/InvoicePaymentSection";
import OutstandingCreditsSection from "@/components/OutstandingCreditsSection";
import { QuickAddCustomerDialog } from "@/components/QuickAddCustomerDialog";
import {
  ProductWithBrand,
  productsToLookupItems,
} from "@/lib/product-utils";
import {
  hydrateSalesDocumentItems,
  normalizeSalesProductCatalog,
} from "@/lib/sales-product-catalog";
import { notify } from "@/lib/notify";
import { invokeDocumentRpc, deleteDraftDocument } from "@/lib/document-actions";
import { canCancelPostedSalesDocument } from "@/lib/role-access";

interface Customer {
  id: string;
  code: string;
  name: string;
  balance?: number;
  loyalty_points?: number;
  loyalty_enabled?: boolean;
}
type Product = ProductWithBrand & {
  selling_price: number;
  quantity_on_hand: number;
};
interface InvoiceItem {
  id?: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
}

export default function SalesInvoiceForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { settings, formatCurrency } = useSettings();
  const isNew = !id;
  const canEdit = role === "admin" || role === "accountant" || role === "sales";
  const canCancelPosted = canCancelPostedSalesDocument(role);

  const showTax = settings?.enable_tax ?? false;
  const showDiscount = settings?.show_discount_on_invoice ?? true;
  const taxRate = settings?.tax_rate ?? 0;

  const [customers, setCustomers] = useState<Customer[]>([]);
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
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");
  const [status, setStatus] = useState("draft");
  const {
    items,
    setItems,
    addItem: addLineItem,
    removeItem: removeLineItem,
    updateItem: updateLineItem,
    handleLastFieldKeyDown,
  } = useLineItems<InvoiceItem>(
    { priceField: "selling_price" },
    products,
  );
  const [editMode, setEditMode] = useState(true);
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  const [loyaltyPointsRedeemed, setLoyaltyPointsRedeemed] = useState(0);
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);
  const [redeemDraft, setRedeemDraft] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddInitialName, setQuickAddInitialName] = useState("");

  function addItem() {
    addLineItem();
    markDirty();
  }

  function removeItem(index: number) {
    removeLineItem(index);
    markDirty();
  }

  function updateItem(index: number, field: string, value: unknown) {
    updateLineItem(index, field, value);
    markDirty();
  }


  useEffect(() => {
    loadData();
  }, [id]);

  async function loadData() {
    const [custRes, prodRes] = await Promise.all([
      (supabase.from("customers") as any)
        .select("id, code, name, phone, balance, loyalty_points, loyalty_enabled")
        .eq("is_active", true)
        .order("name"),
      supabase.rpc("get_sales_product_catalog"),
    ]);
    const salesCatalog = normalizeSalesProductCatalog(prodRes.data);
    setCustomers(custRes.data || []);
    setProducts(salesCatalog.filter((product) => product.is_active));
    if (prodRes.error) {
      notify.error("تعذّر تحميل المنتجات", prodRes.error.message);
    }

    if (id) {
      const { data: inv } = await (supabase.from("sales_invoices") as any)
        .select("*, customers:customer_id(name)")
        .eq("id", id)
        .single();
      if (inv) {
        setInvoiceNumber(inv.invoice_number);
        setPostedNumber(inv.posted_number || null);
        setCustomerId(inv.customer_id || "");
        setCustomerName(inv.customers?.name || "");
        setInvoiceDate(inv.invoice_date);
        setNotes(inv.notes || "");
        setReference(inv.reference || "");
        setStatus(inv.status);
        setEditMode(inv.status === "draft");
        setInvoiceDiscount(Number(inv.discount) || 0);
        setLoyaltyPointsRedeemed(Number(inv.loyalty_points_redeemed) || 0);

        const { data: itemsData } = await (supabase.from("sales_invoice_items") as any)
          .select("*")
          .eq("invoice_id", id)
          .order("sort_order", { ascending: true });
        setItems(
          mapLoadedLineItems<InvoiceItem>(
            hydrateSalesDocumentItems(itemsData, salesCatalog),
          ),
        );
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

  // ── Loyalty calculations ──
  const selectedCustomer = customers.find((c) => c.id === customerId);
  const customerLoyaltyEnabled = selectedCustomer ? selectedCustomer.loyalty_enabled !== false : true;
  const loyaltyEnabled = !!settings?.loyalty_enabled && customerLoyaltyEnabled;
  const egpPerPoint = Number(settings?.loyalty_egp_per_point) || 10;
  const pointsPerRedeem = Number(settings?.loyalty_points_per_redeem) || 100;
  const redeemValue = Number(settings?.loyalty_redeem_value) || 0;
  const pointValue = pointsPerRedeem > 0 ? redeemValue / pointsPerRedeem : 0;

  const currentCustomerPoints = customers.find((c) => c.id === customerId)?.loyalty_points || 0;
  // When editing an existing draft, the customer balance shown already excludes redeemed points only after posting.
  // For UX show: available = currentCustomerPoints (pre-post) - already redeemed on this draft.
  const availablePoints = Math.max(0, currentCustomerPoints - loyaltyPointsRedeemed);

  const loyaltyDiscount = round2(Math.min(loyaltyPointsRedeemed * pointValue, grandTotal));
  const finalGrandTotal = round2(Math.max(grandTotal - loyaltyDiscount, 0));

  const maxByInvoice = pointValue > 0 ? Math.floor(grandTotal / pointValue) : 0;
  const maxRedeemable = Math.min(currentCustomerPoints, maxByInvoice);

  // Reset redeemed points if customer changes (only for unsaved/new state)
  useEffect(() => {
    if (isNew) setLoyaltyPointsRedeemed(0);
  }, [customerId, isNew]);

  function openRedeemDialog() {
    setRedeemDraft(loyaltyPointsRedeemed || Math.min(pointsPerRedeem, maxRedeemable));
    setRedeemDialogOpen(true);
  }
  function applyRedeem() {
    const v = Math.max(0, Math.min(Math.floor(redeemDraft || 0), maxRedeemable));
    setLoyaltyPointsRedeemed(v);
    setIsDirty(true);
    setRedeemDialogOpen(false);
  }
  function clearRedeem() {
    setLoyaltyPointsRedeemed(0);
    setIsDirty(true);
    setRedeemDialogOpen(false);
  }

  async function handleSave(opts?: { silent?: boolean; skipReload?: boolean }): Promise<boolean> {
    if (saving) return false;
    const errors: Record<string, string> = {};
    // Draft is permissive: keep partial work even without a customer or items.
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
      // Block creating brand-new empty invoices (no customer AND no items)
      if (isNew && !customerId && validItems.length === 0) {
        notify.error("تنبيه", "لا يمكن حفظ فاتورة فارغة - أضف عميلاً أو بنودًا أولاً");
        setSaving(false);
        return false;
      }
      // التخفيض على مستوى الفاتورة (خصم عام + خصم نقاط الولاء) يُوزّع تناسبيًا على net_total
      const invoiceLevelReduction = (discountMode === "invoice" ? invoiceDiscount : 0) + loyaltyDiscount;


      const payload: any = {
        customer_id: customerId || null,
        invoice_date: invoiceDate,
        subtotal,
        discount: invoiceDiscount,
        tax: taxAmount,
        total: finalGrandTotal,
        loyalty_points_redeemed: loyaltyPointsRedeemed,
        loyalty_discount: loyaltyDiscount,
        notes: notes.trim() || null,
        reference: reference.trim() || null,
        status: "draft",
      };

      const draftSavedMsg = droppedEmpty > 0 ? `تم الحفظ مع تجاهل ${droppedEmpty} سطر فارغ` : undefined;

      const rows = buildLineItemPayloads(validItems, {
        reduction: invoiceLevelReduction,
        base: subtotal,
      });
      const result = await invokeDocumentRpc("save_sales_invoice_draft", {
        p_invoice_id: id || null,
        p_invoice: payload,
        p_items: rows,
      });
      if (!result.success) {
        notify.error(
          result.isException ? "خطأ" : "تعذر الحفظ",
          result.error || "تعذر حفظ مسودة فاتورة البيع",
        );
        setSaving(false);
        return false;
      }

      if (isNew) {
        const savedId = typeof result.invoice_id === "string" ? result.invoice_id : "";
        if (!savedId) throw new Error("تم حفظ الفاتورة دون إعادة معرّفها");
        if (!opts?.silent) {
          notify.success("تمت الإضافة", draftSavedMsg || "تم إنشاء فاتورة البيع كمسودة");
        }
        markClean();
        navigate(`/sales/${savedId}`);
      } else {
        if (!opts?.silent) {
          notify.success("تم التحديث", draftSavedMsg || "تم تحديث فاتورة البيع");
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
    if (!customerId) {
      notify.error("تنبيه", "يرجى اختيار العميل قبل الترحيل");
      setFieldErrors((e) => ({ ...e, customer: "يرجى اختيار العميل" }));
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
      const res = await invokeDocumentRpc("post_sales_invoice", { p_invoice_id: id });
      if (!res.success) {
        notify.error("خطأ", res.error || "حدث خطأ أثناء الترحيل");
        return;
      }

      notify.success("تم الترحيل", "تم ترحيل فاتورة البيع وتوليد القيد المحاسبي وتحديث المخزون");
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
        itemsTable: "sales_invoice_items",
        parentTable: "sales_invoices",
        parentKey: "invoice_id",
        id: id!,
      });
      notify.success("تم الحذف", "تم حذف فاتورة البيع المسودة");
      markClean();
      navigate("/sales");
    });
  }

  async function handleResetToDraft() {
    if (saving || !id) return;
    await runAction(async () => {
      const res = await invokeDocumentRpc("unpost_sales_invoice", { p_invoice_id: id });
      if (!res.success) {
        notify.error(res.isException ? "خطأ" : "غير مسموح", res.error || "تعذر إعادة التعيين");
        return;
      }
      notify.success("تم إعادة التعيين كمسودة", "أصبحت الفاتورة قابلة للتعديل، والقيد المحاسبي أصبح مسودة ولن يظهر في التقارير");
      markClean();
      window.location.reload();
    });
  }

  async function handleCancelPosted() {
    if (saving) return;
    await runAction(async () => {
      const res = await invokeDocumentRpc("cancel_sales_invoice", { p_invoice_id: id });
      if (!res.success) {
        notify.error(res.isException ? "خطأ" : "غير مسموح", res.error || "تعذر إلغاء الفاتورة");
        return;
      }

      notify.success("تم الإلغاء", "تم إلغاء الفاتورة وعكس القيد المحاسبي وإرجاع الكميات للمخزون");
      markClean();
      loadData();
    });
  }

  async function handlePrint() {
    await exportInvoicePdf({
      type: "sales_invoice",
      number: invoiceNumber
        ? formatDisplayNumber(settings?.sales_invoice_prefix || "INV-", postedNumber, invoiceNumber, status)
        : "جديدة",
      date: invoiceDate,
      partyName: customerName || customers.find((c) => c.id === customerId)?.name || "—",
      partyLabel: "العميل",
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
      discountTotal: (discountMode === "invoice" ? invoiceDiscount : totalDiscount) + loyaltyDiscount,
      taxAmount,
      taxRate,
      grandTotal: finalGrandTotal,
      showTax,
      showDiscount,
      settings,
      status,
      invoiceDiscount: discountMode === "invoice" ? invoiceDiscount : undefined,
    });
  }

  if (loading) return <PageSkeleton variant="form" />;

  const isDraft = status === "draft";
  const isEditable = editMode && isDraft && canEdit;
  const colCount = 4 + (showDiscount ? 1 : 0) + (isEditable ? 1 : 0);

  const displayNumber = !isNew
    ? formatDisplayNumber(settings?.sales_invoice_prefix || "INV-", postedNumber, invoiceNumber || 0, status)
    : null;

  const totalDiscount = items.reduce((s, i) => s + i.discount, 0);

  return (
    <div className="space-y-6" dir="rtl" onInput={() => isEditable && markDirty()}>
      <PageHeader
        icon={FileText}
        title={isNew ? "إنشاء فاتورة مبيعات" : "فاتورة مبيعات"}
        description="إدارة وتوثيق مبيعات المنشأة بدقة وسهولة"
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
                description="هل أنت متأكد من حذف هذه الفاتورة؟ لا يمكن التراجع عن هذا الإجراء."
                confirmText="حذف"
                destructive
                onConfirm={handleDeleteDraft}
              />
            )}

            {!isNew && status === "posted" && canCancelPosted && (
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
                description="سيتم عكس القيد المحاسبي وإرجاع الكميات للمخزون وتعديل رصيد العميل."
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
                description="ستعود الفاتورة لحالة المسودة ليمكن تعديلها، ويتحول قيدها المحاسبي إلى مسودة (يخرج من التقارير دون حذفه)، وتُسحب الكميات من المخزون وتُلغى نقاط الولاء المكتسبة منها. يظل رقم الفاتورة كما هو ويُعاد استخدام نفس القيد عند الترحيل مرة أخرى. غير مسموح إن وُجد سداد أو مرتجع مرتبط بالفاتورة."
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
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
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

      {/* ── Customer Details Card ── */}
      <div className="bg-card p-6 rounded-2xl border shadow-sm">
        <div className="mb-5">
          <SectionHeader icon={User} title="بيانات الفاتورة" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-muted-foreground">
              اسم العميل <span className="text-red-500">*</span>
            </Label>
            {isEditable ? (
              <LookupCombobox
                items={customers.map((c: any) => ({
                  id: c.id,
                  name: c.name,
                  label: `${c.code || ""} - ${c.name || ""}`,
                  searchKeywords: [c.code, c.phone].filter(Boolean).join(" "),
                  searchFields: { code: c.code || "", name: c.name || "", phone: c.phone || "" },
                }))}
                value={customerId}
                onValueChange={(v) => {
                  setCustomerId(v);
                  setIsDirty(true);
                  setFieldErrors((e) => {
                    const { customer, ...rest } = e;
                    return rest;
                  });
                }}
                placeholder="اختر عميل أو أضف جديداً"
                error={!!fieldErrors.customer}
                onAddNew={(searchText) => {
                  setQuickAddInitialName(searchText);
                  setQuickAddOpen(true);
                }}
                addNewLabel="إضافة عميل جديد"
              />
            ) : (
              <div className="h-10 px-4 flex items-center rounded-xl border bg-muted/30 text-sm font-medium">
                {customerName || customers.find((c) => c.id === customerId)?.name || "—"}
              </div>
            )}
            <FormFieldError message={fieldErrors.customer} />
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

      {/* ── Loyalty Card ── */}
      {loyaltyEnabled && customerId && (loyaltyPointsRedeemed > 0 || currentCustomerPoints > 0 || !isDraft) && (
        <div className="bg-gradient-to-l from-amber-50/60 to-card dark:from-amber-950/10 dark:to-card p-4 rounded-2xl border border-amber-200/70 dark:border-amber-900/30 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Gift className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="text-sm">
                <div className="font-bold text-foreground">
                  رصيد نقاط العميل: <span className="font-mono tabular-nums">{currentCustomerPoints}</span> نقطة
                  {pointValue > 0 && (
                    <span className="text-muted-foreground font-normal mr-2">
                      ≈ {formatCurrency(round2(currentCustomerPoints * pointValue))}
                    </span>
                  )}
                </div>
                {loyaltyPointsRedeemed > 0 && (
                  <div className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                    سيتم استخدام {loyaltyPointsRedeemed} نقطة (خصم {formatCurrency(loyaltyDiscount)})
                  </div>
                )}
              </div>
            </div>
            {isEditable && (
              <div className="flex items-center gap-2">
                {loyaltyPointsRedeemed > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearRedeem} className="text-xs">
                    إلغاء الاستبدال
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openRedeemDialog}
                  disabled={maxRedeemable <= 0 || grandTotal <= 0}
                  className="gap-1.5 border-amber-300 dark:border-amber-900/60 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                >
                  <Gift className="h-4 w-4" />
                  {loyaltyPointsRedeemed > 0 ? "تعديل الاستبدال" : "استخدام النقاط"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Redeem Dialog */}
      <Dialog open={redeemDialogOpen} onOpenChange={setRedeemDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-amber-600" />
              استخدام نقاط الولاء
            </DialogTitle>
            <DialogDescription>
              رصيد العميل {currentCustomerPoints} نقطة. الحد الأقصى المسموح به على هذه الفاتورة:{" "}
              <span className="font-mono">{maxRedeemable}</span> نقطة.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm">عدد النقاط المراد استخدامها</Label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={0}
                  max={maxRedeemable}
                  value={redeemDraft}
                  onChange={(e) => setRedeemDraft(parseInt(e.target.value || "0", 10) || 0)}
                  className="w-32 font-mono tabular-nums"
                />
                <Slider
                  value={[Math.min(redeemDraft, maxRedeemable)]}
                  min={0}
                  max={Math.max(maxRedeemable, 1)}
                  step={1}
                  onValueChange={(v) => setRedeemDraft(v[0] || 0)}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="p-3 bg-muted/40 rounded-lg text-sm">
              <div className="flex justify-between mb-1">
                <span className="text-muted-foreground">قيمة الخصم</span>
                <span className="font-mono font-semibold">
                  {formatCurrency(round2(Math.min(Math.max(redeemDraft, 0), maxRedeemable) * pointValue))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">الإجمالي بعد الخصم</span>
                <span className="font-mono font-semibold text-primary">
                  {formatCurrency(
                    round2(Math.max(grandTotal - Math.min(Math.max(redeemDraft, 0), maxRedeemable) * pointValue, 0)),
                  )}
                </span>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button onClick={applyRedeem}>تطبيق</Button>
            <Button variant="outline" onClick={() => setRedeemDialogOpen(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    {/* Row number */}
                    <td className="py-1 px-3 text-center">
                      <span className="text-xs font-medium text-muted-foreground/40 tabular-nums">{i + 1}</span>
                    </td>

                    {/* Product — takes all remaining width, truncates overflow */}
                    <td className="py-1 px-3 min-w-0">
                      {isEditable ? (
                        <LookupCombobox
                          items={productsToLookupItems(products, true, true)}
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

                    {/* Quantity */}
                    <td className="py-1 px-3 text-center">
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

                    {/* Unit Price */}
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
                        <span className="font-mono tabular-nums text-sm text-muted-foreground text-center">
                          {item.unit_price.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                          })}
                        </span>
                      )}
                    </td>

                    {/* Discount */}
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
                          <span className="inline-flex items-center text-xs text-center font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/40 px-2 py-0.5 rounded-full border border-green-200 dark:border-green-800 font-mono tabular-nums">
                            -
                            {item.discount.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                            })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/30 text-sm text-center">—</span>
                        )}
                      </td>
                    )}

                    {/* Tax — removed from rows, shown only in summary */}

                    {/* Total */}
                    <td className="py-1 px-3 text-center w-full">
                      <span className="font-mono tabular-nums font-semibold text-sm text-foreground bg-muted/30 block rounded-md">
                        {formatCurrency(item.total)}
                      </span>
                    </td>

                    {/* Delete button */}
                    {isEditable && (
                      <td className="py-1 px-2">
                        <button
                          onClick={() => removeItem(i)}
                          className="p-1 rounded-md text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-all opacity-0 group-hover:opacity-100"
                          aria-label="حذف البند"
                        >
                          <X className="h-3.5 w-3.5" />
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
              {/* Product count */}
              <div className="flex items-center gap-1.5 bg-muted border border-border/60 px-3 py-1.5 rounded-lg">
                <span className="text-xs text-muted-foreground">المنتجات</span>
                <span className="text-xs font-mono font-semibold tabular-nums text-foreground">
                  {new Set(items.filter((i) => i.product_id).map((i) => i.product_id)).size}
                </span>
              </div>
              {/* Total units */}
              <div className="flex items-center gap-1.5 bg-muted border border-border/60 px-3 py-1.5 rounded-lg">
                <span className="text-xs text-muted-foreground">الوحدات</span>
                <span className="text-xs font-mono font-semibold tabular-nums text-foreground">
                  {items.reduce((s, i) => s + i.quantity, 0)}
                </span>
              </div>
              {/* Separator */}
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
              {loyaltyDiscount > 0 && (
                <div className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 px-3 py-1.5 rounded-lg">
                  <Gift className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs text-amber-700 dark:text-amber-300 font-medium">ولاء</span>
                  <span className="text-xs font-mono font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                    -{formatCurrency(loyaltyDiscount)}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1.5 bg-primary/5 border border-primary/20 px-3 py-1.5 rounded-lg">
                <span className="text-xs text-primary/70 font-medium">الإجمالي</span>
                <span className="text-xs font-mono font-bold tabular-nums text-primary">
                  {formatCurrency(finalGrandTotal)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Notes + Summary: Side by side ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Notes */}
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

        {/* Summary */}
        <div className="bg-card p-6 rounded-2xl border shadow-sm flex flex-col justify-between">
          <div className="mb-4">
            <SectionHeader icon={CreditCard} title="ملخص الفاتورة" />
          </div>
          <div className="space-y-1 mt-2">
            <div className="flex justify-between items-center py-2.5 border-b border-border/50">
              <span className="font-mono tabular-nums text-sm text-center font-medium">{formatCurrency(subtotal)}</span>
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
            {loyaltyDiscount > 0 && (
              <div className="flex justify-between items-center py-2.5 border-b border-border/50">
                <span className="font-mono tabular-nums text-sm font-medium text-amber-600 dark:text-amber-400">
                  -{formatCurrency(loyaltyDiscount)}
                </span>
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Gift className="h-3.5 w-3.5" />
                  استبدال نقاط الولاء ({loyaltyPointsRedeemed})
                </span>
              </div>
            )}
            <div className="flex justify-between items-center pt-4">
              <span className="text-2xl font-black text-primary font-mono tabular-nums">
                {formatCurrency(finalGrandTotal)}
              </span>
              <span className="text-base font-bold text-foreground">الإجمالي الكلي</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Related Operations ── */}
      {!isNew && status === "posted" && id && customerId && (
        <div className="bg-card p-6 rounded-2xl border shadow-sm">
          <div className="mb-5">
            <SectionHeader icon={ArrowLeftRight} title="العمليات المرتبطة" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <InvoicePaymentSection
                type="sales"
                invoiceId={id}
                entityId={customerId}
                entityName={customerName || customers.find((c) => c.id === customerId)?.name || ""}
                invoiceTotal={finalGrandTotal}
                invoiceDisplayNumber={displayNumber || ""}
                onPaymentAdded={loadData}
                refreshKey={paymentSectionRefreshKey}
              />
            </div>
            <div className="space-y-4">
              <OutstandingCreditsSection
                type="sales"
                invoiceId={id}
                entityId={customerId}
                invoiceTotal={finalGrandTotal}
                onSettlementChanged={handleSettlementChanged}
              />
            </div>
          </div>
        </div>
      )}
      <UnsavedChangesDialog open={navGuard.isBlocked} onStay={navGuard.cancel} onLeave={navGuard.confirm} />
      <QuickAddCustomerDialog
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        initialName={quickAddInitialName}
        onCreated={(c) => {
          setCustomers((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name, "ar")));
          setCustomerId(c.id);
          setCustomerName(c.name);
          setIsDirty(true);
          setFieldErrors((e) => {
            const { customer, ...rest } = e;
            return rest;
          });
        }}
      />
    </div>
  );
}
