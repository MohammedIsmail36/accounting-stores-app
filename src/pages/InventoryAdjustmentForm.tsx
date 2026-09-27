import React, { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { postInventoryAdjustmentAtomic, reverseInventoryAdjustmentAtomic } from "@/lib/inventory-adjustment-atomic";
import { saveInventoryAdjustmentDraft } from "@/lib/inventory-adjustment-draft";
import { deleteInventoryAdjustmentDraft } from "@/lib/inventory-adjustment-delete";
import { upsertSavedInventoryAdjustmentInCache, removeDeletedInventoryAdjustmentFromCache } from "@/lib/inventory-adjustment-cache";
import { formatInventoryAdjustmentNumber } from "@/lib/inventory-adjustment-number";
import {
  INVENTORY_ADJUSTMENT_REASONS,
  inventoryAdjustmentReasonLabel,
  inventoryAdjustmentReasonNeedsSourceReference,
  isInventoryAdjustmentReasonCode,
  type InventoryAdjustmentReasonCode,
} from "@/lib/inventory-adjustment-reasons";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useNavigationGuard } from "@/hooks/use-navigation-guard";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { FormFieldError } from "@/components/FormFieldError";
import { PageSkeleton } from "@/components/PageSkeleton";
import { ExportMenu } from "@/components/ExportMenu";
import { SectionHeader } from "@/components/SectionHeader";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/NumberInput";
import { DatePickerInput } from "@/components/DatePickerInput";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { LookupCombobox } from "@/components/LookupCombobox";
import {
  ProductWithBrand,
  productsToLookupItems,
  formatProductName,
  formatProductDisplay,
  PRODUCT_SELECT_FIELDS,
} from "@/lib/product-utils";
import {
  calculateLegacyAdjustmentLine,
  summarizeLegacyAdjustment,
} from "@/lib/inventory-adjustment-legacy";
import { buildInventoryAdjustmentPreview } from "@/lib/inventory-adjustment-preview";
import { DOCUMENT_STATUS_LABELS } from "@/lib/constants";
import {
  Plus,
  X,
  Save,
  CheckCircle,
  Pencil,
  Trash2,
  ClipboardCheck,
  ListChecks,
  CreditCard,
  Ban,
  Loader2,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { notify } from "@/lib/notify";


type Product = ProductWithBrand & { quantity_on_hand: number };

interface AdjustmentItem {
  id?: string;
  product_id: string;
  product_name: string;
  system_quantity: number;
  actual_quantity: number;
  difference: number;
  unit_cost: number;
  total_cost: number;
  notes: string;
  reason_code: InventoryAdjustmentReasonCode | "";
  reason_reference: string;
}

export default function InventoryAdjustmentForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { role } = useAuth();
  const { settings, formatCurrency } = useSettings();
  const isNew = !id;
  const canEdit = role === "admin" || role === "accountant";

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const [adjustmentNumber, setAdjustmentNumber] = useState<number | null>(null);
  const [postedNumber, setPostedNumber] = useState<number | null>(null);
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string | null>(null);
  const [adjustmentDate, setAdjustmentDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("draft");
  const [items, setItems] = useState<AdjustmentItem[]>([]);
  const [editMode, setEditMode] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [approveOpen, setApproveOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  const postRequestId = useRef<string | null>(null);
  const reverseRequestId = useRef<string | null>(null);

  const navGuard = useNavigationGuard(isDirty);

  useEffect(() => {
    loadData();
  }, [id]);

  async function loadData() {
    const { data: prodData } = await supabase
      .from("products")
      .select(PRODUCT_SELECT_FIELDS)
      .eq("is_active", true)
      .order("name");
    setProducts(prodData || []);

    if (id) {
      const { data: adj } = await (
        supabase.from("inventory_adjustments") as any
      )
        .select("*")
        .eq("id", id)
        .single();
      if (adj) {
        setAdjustmentNumber(adj.adjustment_number);
        setPostedNumber(adj.posted_number ?? null);
        setLoadedUpdatedAt(adj.updated_at);
        setAdjustmentDate(adj.adjustment_date);
        setDescription(adj.description || "");
        setStatus(adj.status);
        setEditMode(adj.status === "draft");

        const { data: adjItems } = await (
          supabase.from("inventory_adjustment_items") as any
        )
          .select("*, products(code, name, model_number, product_brands(name))")
          .eq("adjustment_id", id);
        if (adjItems) {
          setItems(
            adjItems.map((it: any) => ({
              id: it.id,
              product_id: it.product_id,
              product_name: it.products
                ? formatProductDisplay(
                    it.products.name,
                    it.products.product_brands?.name,
                    it.products.model_number,
                    it.products.code,
                  )
                : "",
              system_quantity: Number(it.system_quantity),
              actual_quantity: Number(it.actual_quantity),
              difference: Number(it.difference),
              unit_cost: Number(it.unit_cost),
              total_cost: Number(it.total_cost),
              notes: it.notes || "",
              reason_code: isInventoryAdjustmentReasonCode(it.reason_code) ? it.reason_code : "",
              reason_reference: it.reason_reference || "",
            })),
          );
        }
      }
      setLoading(false);
    } else {
      setLoading(false);
    }
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        product_id: "",
        product_name: "",
        system_quantity: 0,
        actual_quantity: 0,
        difference: 0,
        unit_cost: 0,
        total_cost: 0,
        notes: "",
        reason_code: "",
        reason_reference: "",
      },
    ]);
    // Auto-open the product combobox in the newly added row (matches invoice UX)
    setTimeout(() => {
      const rows = document.querySelectorAll("[data-adj-row]");
      const lastRow = rows[rows.length - 1];
      const comboBtn = lastRow?.querySelector(
        "[role='combobox']",
      ) as HTMLButtonElement | null;
      comboBtn?.click();
    }, 50);
  }

  function handleLastFieldKeyDown(
    e: React.KeyboardEvent,
    rowIndex: number,
    field: "qty" | "notes",
  ) {
    if (rowIndex !== items.length - 1) return;
    // Actual quantity: only Enter adds a new row. Tab keeps default (moves to notes).
    // Notes: both Enter and Tab add a new row.
    const shouldAdd =
      field === "notes"
        ? e.key === "Enter" || e.key === "Tab"
        : e.key === "Enter";
    if (!shouldAdd) return;
    if (!items[rowIndex]?.product_id) return;
    e.preventDefault();
    addItem();
  }

  async function handleProductSelect(idx: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    const { data: avgPrice } = await supabase.rpc("get_avg_purchase_price", {
      _product_id: productId,
    });
    const avgCost = Number(avgPrice) || 0;
    const cost = avgCost > 0 ? avgCost : (product as any).purchase_price || 0;

    const updated = [...items];
    updated[idx] = {
      ...updated[idx],
      product_id: productId,
      product_name: formatProductName(product, { withCode: true }),
      system_quantity: product.quantity_on_hand,
      actual_quantity: product.quantity_on_hand,
      difference: 0,
      unit_cost: cost,
      total_cost: 0,
      notes: "",
      reason_code: "",
      reason_reference: "",
    };
    setItems(updated);
  }

  function handleActualQtyChange(idx: number, val: number) {
    const updated = [...items];
    const { difference, totalCost } = calculateLegacyAdjustmentLine(
      updated[idx].system_quantity,
      val,
      updated[idx].unit_cost,
    );
    updated[idx].actual_quantity = val;
    updated[idx].difference = difference;
    updated[idx].total_cost = totalCost;
    if (difference === 0) {
      updated[idx].reason_code = "";
      updated[idx].reason_reference = "";
    }
    setItems(updated);
  }

  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }

  const {
    totalGain,
    totalLoss,
    netDifference,
    zeroDifferenceProductCount,
  } = summarizeLegacyAdjustment(items);

  async function handleSave() {
    if (saving) return;
    const errors: Record<string, string> = {};
    const productIds = items.filter((item) => item.product_id).map((item) => item.product_id);
    if (items.length === 0) errors.items = "أضف منتجًا واحدًا على الأقل";
    else if (items.some((item) => !item.product_id)) errors.items = "اختر المنتج لكل بند";
    else if (new Set(productIds).size !== productIds.length) errors.items = "لا تكرر المنتج نفسه في التسوية";
    else if (items.some((item) => !Number.isFinite(item.system_quantity)
      || !Number.isFinite(item.actual_quantity) || !Number.isFinite(item.unit_cost)
      || item.actual_quantity < 0 || item.unit_cost < 0)) {
      errors.items = "راجع الكميات والتكلفة في البنود";
    }
    else if (items.some((item) => item.difference !== 0 && (
      !isInventoryAdjustmentReasonCode(item.reason_code)
      || !item.notes.trim()
      || (inventoryAdjustmentReasonNeedsSourceReference(item.reason_code as InventoryAdjustmentReasonCode)
        && !item.reason_reference.trim())
    ))) errors.items = "حدد سببًا واكتب شرحًا لكل فرق، ومرجع المستند عند تصحيح خطأ سابق";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      notify.error("تنبيه", Object.values(errors)[0]);
      return;
    }

    setSaving(true);
    try {
      const result = await saveInventoryAdjustmentDraft({
        id: id ?? null,
        expectedUpdatedAt: id ? loadedUpdatedAt : null,
        date: adjustmentDate,
        description,
        items: items.map((item) => ({
          product_id: item.product_id,
          system_quantity: item.system_quantity,
          actual_quantity: item.actual_quantity,
          unit_cost: item.unit_cost,
          notes: item.notes,
          reason_code: item.reason_code || null,
          reason_reference: item.reason_reference.trim() || null,
        })),
      });
      setAdjustmentNumber(result.adjustment_number);
      setLoadedUpdatedAt(result.updated_at);
      upsertSavedInventoryAdjustmentInCache(queryClient, {
        id: result.adjustment_id,
        adjustmentNumber: result.adjustment_number,
        updatedAt: result.updated_at,
        adjustmentDate,
        description,
      });
      notify.success("تم حفظ المسودة وبنودها معًا");
      setIsDirty(false); navGuard.allowNext();
      navigate(`/inventory-adjustments/${result.adjustment_id}`);
    } catch (error: any) {
      notify.error("لم تُحفظ المسودة", error?.message || "تحقق من المسودة قبل المحاولة مجددًا");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDraft() {
    if (!id || !loadedUpdatedAt || saving) return;
    setSaving(true);
    try {
      await deleteInventoryAdjustmentDraft(id, loadedUpdatedAt);
      removeDeletedInventoryAdjustmentFromCache(queryClient, id);
      notify.success("تم حذف التسوية بنجاح");
      setIsDirty(false); navGuard.allowNext();
      navigate("/inventory-adjustments");
    } catch (error: any) {
      notify.error("لم تُحذف المسودة", error?.message || "حدّث الصفحة وتحقق من حالة التسوية");
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove() {
    if (!id || saving) return;
    if (isDirty) {
      notify.error("احفظ المسودة أولًا", "احفظ تغييرات البنود قبل ترحيل التسوية");
      return;
    }
    if (items.length === 0 || items.some((item) => !item.product_id)) {
      notify.error("بنود غير مكتملة", "أضف منتجًا واحدًا على الأقل لكل بند");
      return;
    }
    if (items.some((item) => item.difference !== 0 && (
      !isInventoryAdjustmentReasonCode(item.reason_code)
      || !item.notes.trim()
      || (item.reason_code === "prior_entry_error" && !item.reason_reference.trim())
    ))) {
      notify.error("سبب الفرق مطلوب", "حدد سببًا واكتب شرحًا ومرجعًا عند الحاجة لكل بند ذي فرق");
      return;
    }
    if (settings?.locked_until_date && adjustmentDate <= settings.locked_until_date) {
      notify.error("الفترة مقفلة", "لا يمكن ترحيل تسوية بتاريخ ضمن فترة مقفلة");
      return;
    }

    setSaving(true);
    try {
      const requestId = postRequestId.current ?? crypto.randomUUID();
      postRequestId.current = requestId;
      const result = await postInventoryAdjustmentAtomic(id, requestId);
      setStatus(result.status);
      setEditMode(false);
      setApproveOpen(false);
      postRequestId.current = null;
      await loadData();
      notify.success(result.repeated
        ? "هذه التسوية مرحّلة بالفعل؛ لم تُنشأ حركة أو قيود مكررة"
        : "رُحّلت التسوية والحركات والقيد في عملية واحدة");
    } catch (error: any) {
      notify.error("لم تُرحّل التسوية", error?.message || "تحقق من السجل قبل إعادة المحاولة");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelApproved() {
    if (!id || saving || status !== "posted") return;
    if (!reverseReason.trim()) {
      notify.error("سبب الإلغاء مطلوب");
      return;
    }
    setSaving(true);
    try {
      const requestId = reverseRequestId.current ?? crypto.randomUUID();
      reverseRequestId.current = requestId;
      const result = await reverseInventoryAdjustmentAtomic(id, requestId, reverseReason);
      setStatus(result.status);
      setEditMode(false);
      setReverseOpen(false);
      setReverseReason("");
      reverseRequestId.current = null;
      await loadData();
      notify.success(result.repeated
        ? "هذه التسوية ملغاة بالفعل؛ لم يُنشأ أثر مكرر"
        : "أُلغيت التسوية بحركة وقيد عكسيين دون حذف الأصل");
    } catch (error: any) {
      notify.error("لم تُلغَ التسوية", error?.message || "تحقق من السجل قبل إعادة المحاولة");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton variant="form" />;

  const zeroDiffCount = zeroDifferenceProductCount;
  const hasZeroDiff = zeroDiffCount > 0;
  const missingReasonCount = items.filter(
    (item) => item.product_id && item.difference !== 0 && (
      !isInventoryAdjustmentReasonCode(item.reason_code)
      || !item.notes.trim()
      || (item.reason_code === "prior_entry_error" && !item.reason_reference.trim())
    ),
  ).length;
  const postingPreview = buildInventoryAdjustmentPreview(items);
  const estimatedSurplus = postingPreview
    .filter((line) => line.kind === "surplus")
    .reduce((sum, line) => sum + line.estimatedValue, 0);
  const estimatedShortage = postingPreview
    .filter((line) => line.kind === "shortage")
    .reduce((sum, line) => sum + line.estimatedValue, 0);

  function removeZeroDiffItems() {
    setItems((prev) => prev.filter((i) => !i.product_id || i.difference !== 0));
  }

  const isDraft = status === "draft";
  const isPosted = status === "posted";
  const displayNumber = adjustmentNumber === null
    ? null
    : formatInventoryAdjustmentNumber(status, adjustmentNumber, postedNumber);
  const isEditable = editMode && isDraft && canEdit;
  const statusLabels = DOCUMENT_STATUS_LABELS.adjustment;
  const statusVariants: Record<
    string,
    "secondary" | "default" | "destructive"
  > = { draft: "secondary", approved: "default", posted: "default", cancelled: "destructive" };

  return (
    <div
      className="space-y-6"
      dir="rtl"
      onInput={() => !isDirty && setIsDirty(true)}
    >
      <PageHeader
        icon={ClipboardCheck}
        title={isNew ? "إنشاء تسوية مخزون" : "تسوية مخزون"}
        description="مقارنة الكميات الفعلية بكميات النظام وتسجيل الفروقات"
        badge={<>
          {!isNew && displayNumber && (
            <span className="text-sm font-semibold text-muted-foreground border border-border px-3 py-1 rounded-lg bg-muted/50 font-mono tabular-nums">
              {displayNumber}
            </span>
          )}
          {!isNew && (
            <Badge
              variant={statusVariants[status] || "secondary"}
              className="text-xs px-3 py-1"
            >
              {statusLabels[status] || status}
            </Badge>
          )}
        </>}
        actions={<>
          {!isNew && items.length > 0 && (
            <ExportMenu
              config={{
                filenamePrefix: `inventory-adjustment-${displayNumber ?? "new"}`,
                sheetName: `تسوية ${displayNumber ?? "جديدة"}`,
                pdfTitle: `تسوية مخزون ${displayNumber ?? "جديدة"}`,
                pdfOrientation: "landscape",
                headers: [
                  "#",
                  "كود المنتج",
                  "المنتج",
                  "كمية النظام",
                  "الكمية الفعلية",
                  "الفرق",
                  "متوسط التكلفة",
                  isDraft ? "القيمة التقديرية للفرق" : "قيمة الفرق المسجلة",
                  "سبب الفرق",
                  "مرجع السبب",
                  "ملاحظات",
                ],
                rows: items.map((it, i) => [
                  i + 1,
                  products.find((p) => p.id === it.product_id)?.code || "—",
                  it.product_name,
                  it.system_quantity,
                  it.actual_quantity,
                  (it.difference > 0 ? "+" : "") + it.difference,
                  Number(it.unit_cost).toFixed(2),
                  Number(it.total_cost).toFixed(2),
                  inventoryAdjustmentReasonLabel(it.reason_code) || "—",
                  it.reason_reference || "—",
                  it.notes || "—",
                ]),
                summaryCards: [
                  { label: "التاريخ", value: adjustmentDate },
                  { label: "الحالة", value: statusLabels[status] || status },
                  { label: "عدد البنود", value: String(items.length) },
                  { label: isDraft ? "إجمالي العجز التقديري" : "إجمالي العجز", value: formatCurrency(totalLoss) },
                  { label: isDraft ? "إجمالي الفائض التقديري" : "إجمالي الفائض", value: formatCurrency(totalGain) },
                  {
                    label: "الصافي",
                    value:
                      (netDifference > 0 ? "+" : netDifference < 0 ? "-" : "") +
                      formatCurrency(Math.abs(netDifference)),
                  },
                ],
                settings,
              }}
            />
          )}
          {!isNew && isDraft && role === "admin" && (
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
              title="حذف التسوية"
              description="هل أنت متأكد من حذف هذه التسوية؟ لا يمكن التراجع عن هذا الإجراء."
              confirmText="حذف"
              destructive
              onConfirm={handleDeleteDraft}
            />
          )}

          {!isNew && isDraft && canEdit && !editMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditMode(true)}
              className="gap-1.5"
            >
              <Pencil className="h-4 w-4" />
              تعديل
            </Button>
          )}
          {isEditable && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="gap-1.5"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "جاري الحفظ..." : "حفظ مسودة"}
            </Button>
          )}
          {!isNew && isDraft && canEdit && (
            <ConfirmDialog
              open={approveOpen}
              onOpenChange={setApproveOpen}
              trigger={
                <Button
                  size="sm"
                  disabled={saving || items.length === 0}
                  title={
                    isDirty ? "احفظ المسودة قبل الترحيل"
                      : missingReasonCount > 0 ? "حدد سببًا واكتب شرحًا لكل بند غير مطابق"
                      : undefined
                  }
                  className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-5"
                >
                  <CheckCircle className="h-4 w-4" />
                  ترحيل التسوية
                </Button>
              }
              title="ترحيل التسوية"
              description="ستُراجع كميات المنتجات والتكلفة والفترة داخل قاعدة البيانات، ثم تُحفظ الحركات والقيد والحالة معًا أو لا يُحفظ شيء. يمكن للمدير عكسها لاحقًا بحركة وقيد عكسيين."
              confirmText="ترحيل الآن"
              loading={saving}
              confirmDisabled={isDirty || missingReasonCount > 0}
              onConfirm={handleApprove}
            >
              <div className="space-y-3 text-sm">
                {isDirty && <p className="text-destructive">احفظ تعديلات المسودة قبل الترحيل.</p>}
                {missingReasonCount > 0 && (
                  <p className="text-destructive">حدد السبب واكتب الشرح في {missingReasonCount} من البنود ثم احفظ المسودة.</p>
                )}
                <div className="rounded-lg border border-border">
                  <p className="border-b bg-muted/30 px-3 py-2 font-semibold">معاينة أثر الكمية والقيمة التقديرية</p>
                  <div className="max-h-52 divide-y overflow-y-auto">
                    {postingPreview.map((line) => (
                      <div key={line.productId} className="space-y-1 px-3 py-2">
                        <p className="truncate font-medium" title={line.productName}>{line.productName}</p>
                        <p className="font-mono text-xs tabular-nums text-muted-foreground">
                          الكمية: {line.beforeQuantity.toLocaleString("en-US")} ← {line.afterQuantity.toLocaleString("en-US")}
                          {" · "}الفرق: {line.difference > 0 ? "+" : ""}{line.difference.toLocaleString("en-US")}
                        </p>
                        {line.kind === "matched" ? (
                          <p className="text-xs text-muted-foreground">مطابق؛ لا حركة ولا قيد لهذا البند.</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            القيمة التقديرية: {formatCurrency(line.estimatedValue)}
                            {" · "}مدين {line.debitAccount} / دائن {line.creditAccount}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 border-t bg-muted/20 px-3 py-2 text-xs">
                    <span>فائض تقديري: {formatCurrency(estimatedSurplus)}</span>
                    <span>عجز تقديري: {formatCurrency(estimatedShortage)}</span>
                  </div>
                </div>
                <p className="text-muted-foreground">
                  هذه القيم تقديرية من المسودة؛ يعيد الخادم احتساب تكلفة الحركات والتحقق من الرصيد
                  عند الترحيل، وقد تختلف القيمة النهائية. إذا تغيرت الكمية يرفض العملية كاملة.
                </p>
              </div>
            </ConfirmDialog>
          )}

          {!isNew && isPosted && role === "admin" && (
            <ConfirmDialog
              open={reverseOpen}
              onOpenChange={setReverseOpen}
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
                >
                  <Ban className="h-4 w-4" />
                  إلغاء التسوية
                </Button>
              }
              title="عكس التسوية المرحّلة"
              description="ستُنشأ حركة مخزون وقيد عكسيان، مع الاحتفاظ بالحركة والقيد الأصليين للتدقيق. قد يُرفض العكس إذا تغيرت البيانات أو لم تعد الكمية كافية."
              confirmText="إلغاء التسوية"
              cancelText="تراجع"
              destructive
              loading={saving}
              confirmDisabled={!reverseReason.trim()}
              onConfirm={handleCancelApproved}
            >
              <div className="space-y-2">
                <Label htmlFor="inventory-adjustment-reverse-reason">سبب الإلغاء</Label>
                <Input
                  id="inventory-adjustment-reverse-reason"
                  value={reverseReason}
                  onChange={(event) => setReverseReason(event.target.value)}
                  placeholder="اكتب سببًا واضحًا يُحفظ في سجل العملية"
                />
              </div>
            </ConfirmDialog>
          )}

        </>}
      />

      {isDraft && displayNumber && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{displayNumber} رقم مسودة مؤقت.</span>{" "}
          يُمنح رقم ADJ الرسمي عند نجاح الترحيل فقط؛ حذف المسودة لا يستهلك رقمًا رسميًا.
        </div>
      )}

      {/* ── Adjustment Details Card ── */}
      <div className="bg-card p-6 rounded-2xl border shadow-sm">
        <div className="mb-5">
          <SectionHeader icon={ClipboardCheck} title="بيانات التسوية" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-muted-foreground">
              تاريخ التسوية
            </Label>
            {isEditable ? (
              <DatePickerInput
                value={adjustmentDate}
                onChange={setAdjustmentDate}
                placeholder="اختر التاريخ"
              />
            ) : (
              <div className="h-10 px-4 flex items-center rounded-xl border bg-muted/30 text-sm font-mono tabular-nums">
                {adjustmentDate}
              </div>
            )}
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label className="text-sm font-medium text-muted-foreground">
              وصف عملية الجرد
            </Label>
            {isEditable ? (
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="مثال: جرد شهر مارس 2026"
                className="rounded-xl"
              />
            ) : (
              <div className="h-10 px-4 flex items-center rounded-xl border bg-muted/30 text-sm">
                {description || "—"}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Items Table Card ── */}
      <div
        className={cn(
          "bg-card rounded-2xl border shadow-sm overflow-hidden",
          fieldErrors.items && "border-red-500",
        )}
      >
        {/* Card Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <SectionHeader icon={ListChecks} title="بنود التسوية" />
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
          <table
            className="w-full min-w-[1280px] text-right border-collapse"
            style={{ tableLayout: "fixed" }}
          >
            <colgroup>
              <col style={{ width: "4%" }} />
              <col style={{ width: "26%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "12%" }} />
              {isEditable && <col style={{ width: "3%" }} />}
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="py-2 px-3 font-medium text-muted-foreground text-xs text-center">
                  #
                </th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-xs">
                  المنتج
                </th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-xs text-center">
                  كمية النظام
                </th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-xs text-center">
                  الكمية الفعلية
                </th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-xs text-center">
                  الفرق
                </th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-xs text-center">
                  متوسط التكلفة
                </th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-xs text-center">
                  {isDraft ? "قيمة الفرق التقديرية" : "قيمة الفرق المسجلة"}
                </th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-xs text-center">
                  سبب الفرق
                </th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-xs">
                  ملاحظات البند
                </th>
                {isEditable && <th className="py-2 px-2" />}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={isEditable ? 10 : 9}>
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                        <ListChecks className="h-5 w-5 text-muted-foreground/40" />
                      </div>
                      <p className="text-sm font-medium text-muted-foreground">
                        لا توجد بنود بعد
                      </p>
                      {isEditable && (
                        <p className="text-xs text-muted-foreground/50">
                          اضغط «إضافة منتج» للبدء
                        </p>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item, i) => (
                  <tr
                    key={i}
                    data-adj-row
                    className="group border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors duration-100"
                  >
                    <td className="py-2 px-3 text-center">
                      <span className="text-xs font-medium text-muted-foreground/40 tabular-nums">
                        {i + 1}
                      </span>
                    </td>

                    <td className="py-2 px-3 min-w-0">
                      {isEditable ? (
                        <LookupCombobox
                          value={item.product_id}
                          onValueChange={(val) => handleProductSelect(i, val)}
                          items={productsToLookupItems(
                            products.filter(
                              (p) =>
                                p.id === item.product_id ||
                                !items.some(
                                  (other, oi) =>
                                    oi !== i && other.product_id === p.id,
                                ),
                            ), false, true,
                          )}
                          placeholder="اختر المنتج"
                        />
                      ) : (
                        <span
                          className="font-medium text-sm block line-clamp-2 break-words"
                          title={item.product_name}
                        >
                          {item.product_name}
                        </span>
                      )}
                    </td>

                    <td className="py-2 px-3 text-center">
                      <span className="font-mono tabular-nums text-sm">
                        {item.system_quantity.toLocaleString("en-US")}
                      </span>
                    </td>

                    <td className="py-2 px-3">
                      {isEditable ? (
                        <NumberInput
                          min={0}
                          value={item.actual_quantity}
                          onValueChange={(v) => handleActualQtyChange(i, v)}
                          onKeyDown={(e) => handleLastFieldKeyDown(e, i, "qty")}
                          title={
                            item.product_id && item.difference === 0
                              ? "فرق صفر — يُحفظ للمراجعة دون حركة أو قيد"
                              : undefined
                          }
                          className={cn(
                            "font-mono tabular-nums text-center rounded-md h-8 w-full",
                            item.product_id && item.difference === 0
                              ? "bg-amber-50 dark:bg-amber-950/30 border-amber-400 dark:border-amber-600"
                              : "bg-muted/30 border-border",
                          )}
                        />
                      ) : (
                        <span className="font-mono tabular-nums text-sm block text-center">
                          {item.actual_quantity.toLocaleString("en-US")}
                        </span>
                      )}
                    </td>

                    <td className="py-2 px-3 text-center">
                      <span
                        className={`font-mono tabular-nums text-sm font-bold ${
                          item.difference > 0
                            ? "text-green-700 dark:text-green-400"
                            : item.difference < 0
                              ? "text-destructive"
                              : "text-muted-foreground"
                        }`}
                      >
                        {item.difference > 0 ? "+" : ""}
                        {item.difference.toLocaleString("en-US")}
                      </span>
                    </td>

                    <td className="py-2 px-3 text-center">
                      <span className="font-mono tabular-nums text-sm text-muted-foreground">
                        {formatCurrency(item.unit_cost)}
                      </span>
                    </td>

                    <td className="py-2 px-3 text-center">
                      <span
                        className={`font-mono tabular-nums text-sm font-semibold ${
                          item.difference !== 0
                            ? item.difference > 0
                              ? "text-green-700 dark:text-green-400"
                              : "text-destructive"
                            : ""
                        }`}
                      >
                        {formatCurrency(item.total_cost)}
                      </span>
                    </td>

                    <td className="py-2 px-3">
                      {isEditable ? (
                        <div className="space-y-1">
                          <Select
                            value={item.reason_code}
                            onValueChange={(value) => {
                              const u = [...items];
                              u[i].reason_code = value as InventoryAdjustmentReasonCode;
                              if (value !== "prior_entry_error") u[i].reason_reference = "";
                              setItems(u);
                            }}
                            disabled={item.difference === 0}
                          >
                            <SelectTrigger className="h-8 w-full text-xs" aria-label="سبب فرق المخزون">
                              <SelectValue placeholder="اختر السبب" />
                            </SelectTrigger>
                            <SelectContent>
                              {INVENTORY_ADJUSTMENT_REASONS.map((reason) => (
                                <SelectItem key={reason.code} value={reason.code}>{reason.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {item.reason_code === "prior_entry_error" && (
                            <Input
                              value={item.reason_reference}
                              onChange={(e) => {
                                const u = [...items];
                                u[i].reason_reference = e.target.value;
                                setItems(u);
                              }}
                              className="h-8 text-xs"
                              placeholder="مرجع المستند الأصلي"
                              aria-label="مرجع سبب الفرق"
                            />
                          )}
                        </div>
                      ) : (
                        <div className="space-y-0.5 text-xs text-muted-foreground">
                          <span className="block font-medium text-foreground">
                            {inventoryAdjustmentReasonLabel(item.reason_code)
                              ?? (item.difference !== 0 ? "سبب قديم غير مصنف" : "—")}
                          </span>
                          {item.reason_reference && <span className="block truncate" title={item.reason_reference}>{item.reason_reference}</span>}
                        </div>
                      )}
                    </td>

                    <td className="py-2 px-3">
                      {isEditable ? (
                        <Input
                          value={item.notes}
                          onChange={(e) => {
                            const u = [...items];
                            u[i].notes = e.target.value;
                            setItems(u);
                          }}
                          onKeyDown={(e) => handleLastFieldKeyDown(e, i, "notes")}
                          className="text-xs bg-muted/30 border-border rounded-md h-8 w-full"
                          placeholder={item.difference === 0 ? "ملاحظة اختيارية" : "شرح الفرق (مطلوب)"}
                          aria-label="ملاحظات البند"
                        />
                      ) : (
                        <span className="block truncate text-xs text-muted-foreground" title={item.notes || undefined}>
                          {item.notes || "—"}
                        </span>
                      )}
                    </td>

                    {isEditable && (
                      <td className="py-2 px-2">
                        <button
                          onClick={() => removeItem(i)}
                          className="p-1 rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all"
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

        {/* Table Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/10 flex-wrap gap-3">
          {isEditable ? (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={addItem}
                className="flex items-center gap-2 text-sm font-semibold text-primary hover:bg-primary/5 px-3 py-1.5 rounded-lg transition-all"
              >
                <Plus className="h-4 w-4" />
                إضافة منتج
              </button>
              {hasZeroDiff && (
                <button
                  onClick={removeZeroDiffItems}
                  className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 hover:bg-amber-100 px-2.5 py-1.5 rounded-lg transition-all"
                  title="حذف كل البنود ذات الفرق صفر"
                >
                  <X className="h-3.5 w-3.5" />
                  حذف البنود بدون فرق ({zeroDiffCount})
                </button>
              )}
            </div>
          ) : (
            <div />
          )}

          {items.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 bg-muted border border-border/60 px-3 py-1.5 rounded-lg">
                <span className="text-xs text-muted-foreground">المنتجات</span>
                <span className="text-xs font-mono font-semibold tabular-nums text-foreground">
                  {
                    new Set(
                      items
                        .filter((i) => i.product_id)
                        .map((i) => i.product_id),
                    ).size
                  }
                </span>
              </div>
              <div className="w-px h-4 bg-border/60" />
              {totalLoss > 0 && (
                <div className="flex items-center gap-1.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-1.5 rounded-lg">
                  <span className="text-xs text-destructive">عجز</span>
                  <span className="text-xs font-mono font-semibold tabular-nums text-destructive">
                    {formatCurrency(totalLoss)}
                  </span>
                </div>
              )}
              {totalGain > 0 && (
                <div className="flex items-center gap-1.5 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 px-3 py-1.5 rounded-lg">
                  <span className="text-xs text-green-700 dark:text-green-400">
                    فائض
                  </span>
                  <span className="text-xs font-mono font-semibold tabular-nums text-green-700 dark:text-green-400">
                    {formatCurrency(totalGain)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ملخص واحد؛ لا نكرر وصف المستند في حقل ملاحظات آخر */}
      <div className="grid grid-cols-1 gap-6">
        {/* Summary */}
        <div className="bg-card p-6 rounded-2xl border shadow-sm flex flex-col justify-between">
          <div className="mb-4">
            <SectionHeader icon={CreditCard} title="ملخص التسوية" />
          </div>
          <div className="space-y-1 mt-2">
            {totalLoss > 0 && (
              <div className="flex justify-between items-center py-2.5 border-b border-border/50">
                <span className="font-mono tabular-nums text-sm font-medium text-destructive">
                  {formatCurrency(totalLoss)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {isDraft ? "إجمالي العجز التقديري" : "إجمالي العجز"}
                </span>
              </div>
            )}
            {totalGain > 0 && (
              <div className="flex justify-between items-center py-2.5 border-b border-border/50">
                <span className="font-mono tabular-nums text-sm font-medium text-green-700 dark:text-green-400">
                  {formatCurrency(totalGain)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {isDraft ? "إجمالي الفائض التقديري" : "إجمالي الفائض"}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center pt-4">
              <span
                className={`text-2xl font-black font-mono tabular-nums ${
                  netDifference > 0
                    ? "text-green-700 dark:text-green-400"
                    : netDifference < 0
                      ? "text-destructive"
                      : "text-primary"
                }`}
              >
                {netDifference > 0 ? "+" : ""}
                {formatCurrency(Math.abs(netDifference))}
              </span>
              <span className="text-base font-bold text-foreground">
                {netDifference > 0
                  ? (isDraft ? "صافي فائض تقديري" : "صافي فائض")
                  : netDifference < 0
                    ? (isDraft ? "صافي عجز تقديري" : "صافي عجز")
                    : "متوازن"}
              </span>
            </div>
          </div>
        </div>
      </div>
      <UnsavedChangesDialog
        open={navGuard.isBlocked}
        onStay={navGuard.cancel}
        onLeave={navGuard.confirm}
      />
    </div>
  );
}
