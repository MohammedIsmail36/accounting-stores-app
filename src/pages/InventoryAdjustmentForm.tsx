import React, { useState, useEffect } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { createJournalEntry, createReverseJournalEntry } from "@/lib/journal-writer";
import { getNextPostedNumber } from "@/lib/posted-number-utils";
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
import { Badge } from "@/components/ui/badge";
import { LookupCombobox } from "@/components/LookupCombobox";
import {
  ProductWithBrand,
  productsToLookupItems,
  formatProductName,
  formatProductDisplay,
  PRODUCT_SELECT_FIELDS,
} from "@/lib/product-utils";
import { ACCOUNT_CODES } from "@/lib/constants";
import {
  Plus,
  X,
  Save,
  CheckCircle,
  Pencil,
  Trash2,
  ClipboardCheck,
  ListChecks,
  StickyNote,
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
}

export default function InventoryAdjustmentForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const { settings, formatCurrency } = useSettings();
  const isNew = !id;
  const canEdit = role === "admin" || role === "accountant";

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const [adjustmentNumber, setAdjustmentNumber] = useState<number | null>(null);
  const [adjustmentDate, setAdjustmentDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("draft");
  const [items, setItems] = useState<AdjustmentItem[]>([]);
  const [editMode, setEditMode] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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
                  )
                : "",
              system_quantity: Number(it.system_quantity),
              actual_quantity: Number(it.actual_quantity),
              difference: Number(it.difference),
              unit_cost: Number(it.unit_cost),
              total_cost: Number(it.total_cost),
              notes: it.notes || "",
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
      product_name: formatProductName(product),
      system_quantity: product.quantity_on_hand,
      actual_quantity: product.quantity_on_hand,
      difference: 0,
      unit_cost: cost,
      total_cost: 0,
    };
    setItems(updated);
  }

  function handleActualQtyChange(idx: number, val: number) {
    const updated = [...items];
    const diff = val - updated[idx].system_quantity;
    updated[idx].actual_quantity = val;
    updated[idx].difference = diff;
    updated[idx].total_cost = Math.abs(diff) * updated[idx].unit_cost;
    setItems(updated);
  }

  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }

  const totalGain = items
    .filter((i) => i.difference > 0)
    .reduce((s, i) => s + i.total_cost, 0);
  const totalLoss = items
    .filter((i) => i.difference < 0)
    .reduce((s, i) => s + i.total_cost, 0);
  const netDifference = totalGain - totalLoss;

  async function handleSave() {
    if (saving) return;
    const errors: Record<string, string> = {};
    if (items.length === 0) errors.items = "أضف منتج واحد على الأقل";
    if (items.some((i) => !i.product_id)) errors.items = "اختر المنتج لكل بند";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      notify.error("تنبيه", Object.values(errors)[0]);
      return;
    }

    setSaving(true);
    try {
      let adjId = id;
      if (isNew) {
        const { data, error } = await (
          supabase.from("inventory_adjustments") as any
        )
          .insert({
            adjustment_date: adjustmentDate,
            description,
            created_by: user?.id,
          })
          .select()
          .single();
        if (error) throw error;
        adjId = data.id;
      } else {
        await (supabase.from("inventory_adjustments") as any)
          .update({ adjustment_date: adjustmentDate, description })
          .eq("id", adjId);
        await (supabase.from("inventory_adjustment_items") as any)
          .delete()
          .eq("adjustment_id", adjId);
      }

      const rows = items.map((i) => ({
        adjustment_id: adjId,
        product_id: i.product_id,
        system_quantity: i.system_quantity,
        actual_quantity: i.actual_quantity,
        difference: i.difference,
        unit_cost: i.unit_cost,
        total_cost: i.total_cost,
        notes: i.notes || null,
      }));

      const { error: itemsErr } = await (
        supabase.from("inventory_adjustment_items") as any
      ).insert(rows);
      if (itemsErr) throw itemsErr;

      notify.success("تم حفظ التسوية بنجاح");
      setIsDirty(false); navGuard.allowNext();
      navigate(`/inventory-adjustments/${adjId}`);
    } catch (e: any) {
      notify.error("خطأ في الحفظ", e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDraft() {
    if (!id || saving) return;
    setSaving(true);
    try {
      await (supabase.from("inventory_adjustment_items") as any)
        .delete()
        .eq("adjustment_id", id);
      await (supabase.from("inventory_adjustments") as any)
        .delete()
        .eq("id", id);
      notify.success("تم حذف التسوية بنجاح");
      setIsDirty(false); navGuard.allowNext();
      navigate("/inventory-adjustments");
    } catch {
      notify.error("خطأ في الحذف");
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove() {
    if (!id || saving) return;
    const zeroDiffCount = items.filter(
      (i) => i.product_id && i.difference === 0,
    ).length;
    if (zeroDiffCount > 0) {
      notify.error("لا يمكن اعتماد التسوية", `يوجد ${zeroDiffCount} بند بفرق صفر. احذفها أو عدّل الكميات الفعلية قبل الاعتماد.`);
      return;
    }
    if (
      settings?.locked_until_date &&
      adjustmentDate <= settings.locked_until_date
    ) {
      notify.error("الفترة مقفلة", `لا يمكن اعتماد تسوية بتاريخ ${adjustmentDate} — الفترة مقفلة حتى ${settings.locked_until_date}`);
      return;
    }
    setSaving(true);
    try {
      // 1. Fetch accounts
      const { data: invAccount } = await supabase
        .from("accounts")
        .select("id")
        .eq("code", ACCOUNT_CODES.INVENTORY)
        .single();
      if (!invAccount)
        throw new Error(
          "حساب المخزون غير موجود - تأكد من وجود حساب بكود " +
            ACCOUNT_CODES.INVENTORY,
        );

      // Post NET only: single-sided JV based on net difference (surplus or shortage).
      // Inventory movements below remain per-product for detailed audit.
      const netAbs = Math.abs(netDifference);
      const lines: {
        account_id: string;
        debit: number;
        credit: number;
        description: string;
      }[] = [];

      if (netDifference < 0) {
        // Net shortage → 5201 Dr / 1104 Cr
        let lossAccount: { id: string } | null = null;
        const { data } = await supabase
          .from("accounts")
          .select("id")
          .eq("code", ACCOUNT_CODES.INVENTORY_ADJUSTMENT_LOSS)
          .single();
        lossAccount = data;
        if (!lossAccount) {
          const { data: created } = await supabase
            .from("accounts")
            .insert({
              code: ACCOUNT_CODES.INVENTORY_ADJUSTMENT_LOSS,
              name: "عجز المخزون",
              account_type: "expense",
              description: "خسائر ناتجة عن عجز الجرد",
            })
            .select()
            .single();
          lossAccount = created;
        }
        if (!lossAccount) throw new Error("تعذر إنشاء حساب عجز المخزون");
        lines.push({
          account_id: lossAccount.id,
          debit: netAbs,
          credit: 0,
          description: `تسوية مخزون ADJ-${adjustmentNumber} — صافي عجز`,
        });
        lines.push({
          account_id: invAccount.id,
          debit: 0,
          credit: netAbs,
          description: `تسوية مخزون ADJ-${adjustmentNumber} — تخفيض مخزون (صافي عجز)`,
        });
      } else if (netDifference > 0) {
        // Net surplus → 1104 Dr / 4201 Cr
        let gainAccount: { id: string } | null = null;
        const { data } = await supabase
          .from("accounts")
          .select("id")
          .eq("code", ACCOUNT_CODES.INVENTORY_ADJUSTMENT_GAIN)
          .single();
        gainAccount = data;
        if (!gainAccount) {
          const { data: created } = await supabase
            .from("accounts")
            .insert({
              code: ACCOUNT_CODES.INVENTORY_ADJUSTMENT_GAIN,
              name: "فائض المخزون",
              account_type: "revenue",
              description: "أرباح ناتجة عن فائض الجرد",
            })
            .select()
            .single();
          gainAccount = created;
        }
        if (!gainAccount) throw new Error("تعذر إنشاء حساب فائض المخزون");
        lines.push({
          account_id: invAccount.id,
          debit: netAbs,
          credit: 0,
          description: `تسوية مخزون ADJ-${adjustmentNumber} — زيادة مخزون (صافي فائض)`,
        });
        lines.push({
          account_id: gainAccount.id,
          debit: 0,
          credit: netAbs,
          description: `تسوية مخزون ADJ-${adjustmentNumber} — صافي فائض`,
        });
      }
      // netDifference === 0 → no JV lines; inventory movements still recorded per product.

      // 3. Create journal entry through the single journal gateway
      let journalEntryId: string | null = null;
      if (lines.length > 0) {
        journalEntryId = await createJournalEntry({
          entryDate: adjustmentDate,
          description: `تسوية مخزون - جرد رقم ADJ-${adjustmentNumber}`,
          status: "posted",
          lines,
        });
      }

      // 4. Create inventory movements and update product quantities (atomic)
      // Pre-validate: ensure no product goes negative
      for (const item of items) {
        if (item.difference === 0) continue;
        if (item.difference < 0) {
          const { data: freshProd } = await supabase
            .from("products")
            .select("quantity_on_hand")
            .eq("id", item.product_id)
            .single();
          if (
            freshProd &&
            Number(freshProd.quantity_on_hand) + item.difference < 0
          ) {
            throw new Error(
              `الكمية بعد التسوية ستكون سالبة للمنتج: ${item.product_name}`,
            );
          }
        }
      }

      const adjustedProducts: { product_id: string; delta: number }[] = [];
      try {
        for (const item of items) {
          if (item.difference === 0) continue;

          // Atomic quantity update via RPC (prevents race conditions)
          const { error: qtyErr } = await (supabase.rpc as any)(
            "adjust_product_quantity",
            {
              p_product_id: item.product_id,
              p_delta: item.difference,
            },
          );
          if (qtyErr) throw qtyErr;
          adjustedProducts.push({
            product_id: item.product_id,
            delta: item.difference,
          });

          const { error: movErr } = await (
            supabase.from("inventory_movements") as any
          ).insert({
            product_id: item.product_id,
            movement_type: "adjustment",
            quantity: item.difference,
            unit_cost: item.unit_cost,
            total_cost: item.total_cost,
            movement_date: adjustmentDate,
            reference_id: id,
            reference_type: "adjustment",
            notes: `تسوية جرد ADJ-${adjustmentNumber} - ${item.difference > 0 ? "فائض" : "عجز"}: ${Math.abs(item.difference)} وحدة`,
            created_by: user?.id,
          });
          if (movErr) throw movErr;
        }
      } catch (itemError) {
        // Rollback: reverse all successfully adjusted quantities
        let rollbackFailed = false;
        for (const adj of adjustedProducts) {
          try {
            const { error } = await (supabase.rpc as any)(
              "adjust_product_quantity",
              {
                p_product_id: adj.product_id,
                p_delta: -adj.delta,
              },
            );
            if (error) throw error;
          } catch (e: any) {
            console.error("فشل التراجع عن كمية المنتج:", e);
            rollbackFailed = true;
          }
        }
        // Delete any movements created for this adjustment
        try {
          const { error } = await (supabase.from("inventory_movements") as any)
            .delete()
            .eq("reference_id", id)
            .eq("reference_type", "adjustment");
          if (error) throw error;
        } catch (e: any) {
          console.error("فشل حذف حركات المخزون:", e);
          rollbackFailed = true;
        }
        // Delete journal entry if created
        if (journalEntryId) {
          try {
            const { error } = await supabase
              .from("journal_entry_lines")
              .delete()
              .eq("journal_entry_id", journalEntryId);
            if (error) throw error;
          } catch (e: any) {
            console.error("فشل حذف سطور القيد:", e);
            rollbackFailed = true;
          }
          try {
            const { error } = await (supabase.from("journal_entries") as any)
              .delete()
              .eq("id", journalEntryId);
            if (error) throw error;
          } catch (e: any) {
            console.error("فشل حذف القيد:", e);
            rollbackFailed = true;
          }
        }
        if (rollbackFailed) {
          throw new Error(
            "فشل الاعتماد وفشل التراجع — يرجى مراجعة البيانات يدوياً",
          );
        }
        throw itemError;
      }

      // 5. Update adjustment status
      await (supabase.from("inventory_adjustments") as any)
        .update({ status: "approved", journal_entry_id: journalEntryId })
        .eq("id", id);

      setStatus("approved");
      setEditMode(false);
      notify.success("تم اعتماد التسوية وتسجيل القيود بنجاح");
    } catch (e: any) {
      notify.error("خطأ في الاعتماد", e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelApproved() {
    if (!id) return;
    setSaving(true);
    try {
      // 1. Reverse inventory quantities atomically via RPC
      for (const item of items) {
        if (item.difference === 0) continue;

        const { error: qtyErr } = await (supabase.rpc as any)(
          "adjust_product_quantity",
          {
            p_product_id: item.product_id,
            p_delta: -item.difference, // reverse the difference
          },
        );
        if (qtyErr) throw qtyErr;
      }

      // 2. Delete inventory movements for this adjustment (handle both possible reference_type values)
      const { error: delErr1 } = await (
        supabase.from("inventory_movements") as any
      )
        .delete()
        .eq("reference_id", id)
        .eq("reference_type", "adjustment");
      if (delErr1) console.warn("Delete adjustment movements error:", delErr1);

      // Also try with "inventory_adjustment" reference_type (legacy data)
      const { error: delErr2 } = await (
        supabase.from("inventory_movements") as any
      )
        .delete()
        .eq("reference_id", id)
        .eq("reference_type", "inventory_adjustment");
      if (delErr2)
        console.warn("Delete inventory_adjustment movements error:", delErr2);

      // 3. Create REVERSE journal entry (not just cancel the original)
      const { data: adj } = await (
        supabase.from("inventory_adjustments") as any
      )
        .select("journal_entry_id")
        .eq("id", id)
        .single();

      if (adj?.journal_entry_id) {
        await createReverseJournalEntry({
          sourceEntryId: adj.journal_entry_id,
          entryDate: new Date().toISOString().split("T")[0],
          description: `عكس تسوية مخزون - جرد رقم ADJ-${adjustmentNumber}`,
        });
      }

      // 4. Update adjustment status to cancelled
      await (supabase.from("inventory_adjustments") as any)
        .update({ status: "cancelled" })
        .eq("id", id);

      setStatus("cancelled");
      setEditMode(false);
      notify.success("تم إلغاء التسوية بنجاح", "تم استعادة كميات المخزون وتسجيل قيد عكسي");
    } catch (e: any) {
      notify.error("خطأ في إلغاء التسوية", e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton variant="form" />;

  const zeroDiffCount = items.filter(
    (i) => i.product_id && i.difference === 0,
  ).length;
  const hasZeroDiff = zeroDiffCount > 0;
  function removeZeroDiffItems() {
    setItems((prev) => prev.filter((i) => !i.product_id || i.difference !== 0));
  }

  const isDraft = status === "draft";
  const isApproved = status === "approved";
  const isCancelled = status === "cancelled";
  const isEditable = editMode && isDraft && canEdit;
  const statusLabels: Record<string, string> = {
    draft: "مسودة",
    approved: "معتمد",
    cancelled: "ملغي",
  };
  const statusVariants: Record<
    string,
    "secondary" | "default" | "destructive"
  > = { draft: "secondary", approved: "default", cancelled: "destructive" };

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
          {!isNew && adjustmentNumber && (
            <span className="text-sm font-semibold text-muted-foreground border border-border px-3 py-1 rounded-lg bg-muted/50 font-mono tabular-nums">
              ADJ-{adjustmentNumber}
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
                filenamePrefix: `inventory-adjustment-ADJ-${adjustmentNumber ?? ""}`,
                sheetName: `تسوية ADJ-${adjustmentNumber ?? ""}`,
                pdfTitle: `تسوية مخزون ADJ-${adjustmentNumber ?? ""}`,
                pdfOrientation: "landscape",
                headers: [
                  "#",
                  "كود المنتج",
                  "المنتج",
                  "كمية النظام",
                  "الكمية الفعلية",
                  "الفرق",
                  "متوسط التكلفة",
                  "إجمالي الفرق",
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
                  it.notes || "—",
                ]),
                summaryCards: [
                  { label: "التاريخ", value: adjustmentDate },
                  { label: "الحالة", value: statusLabels[status] || status },
                  { label: "عدد البنود", value: String(items.length) },
                  { label: "إجمالي العجز", value: formatCurrency(totalLoss) },
                  { label: "إجمالي الفائض", value: formatCurrency(totalGain) },
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
              trigger={
                <Button
                  size="sm"
                  disabled={saving || items.length === 0 || hasZeroDiff}
                  title={
                    hasZeroDiff
                      ? `لا يمكن الاعتماد — يوجد ${zeroDiffCount} بند بفرق صفر`
                      : undefined
                  }
                  className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-5"
                >
                  <CheckCircle className="h-4 w-4" />
                  اعتماد التسوية
                </Button>
              }
              title="اعتماد التسوية"
              description="سيتم تسجيل القيود المحاسبية وتحديث كميات المخزون. لا يمكن التراجع عن هذه العملية."
              confirmText="اعتماد"
              onConfirm={handleApprove}
            >
              {(totalLoss > 0 || totalGain > 0) && (
                <div className="text-sm">
                  {totalLoss > 0 && (
                    <div className="text-destructive font-semibold">
                      عجز: {formatCurrency(totalLoss)}
                    </div>
                  )}
                  {totalGain > 0 && (
                    <div className="text-green-600 mt-1 font-semibold">
                      فائض: {formatCurrency(totalGain)}
                    </div>
                  )}
                </div>
              )}
            </ConfirmDialog>
          )}

          {!isNew && isApproved && role === "admin" && (
            <ConfirmDialog
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
              title="إلغاء التسوية المعتمدة"
              description="سيتم استعادة كميات المخزون إلى ما قبل التسوية وإلغاء القيود المحاسبية المرتبطة. هل أنت متأكد؟"
              confirmText="إلغاء التسوية"
              cancelText="تراجع"
              destructive
              onConfirm={handleCancelApproved}
            />
          )}

        </>}
      />

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
            className="w-full text-right border-collapse"
            style={{ tableLayout: "fixed" }}
          >
            <colgroup>
              <col style={{ width: "3%" }} />
              <col style={{ width: "28%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "13%" }} />
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
                  إجمالي الفرق
                </th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-xs text-center">
                  ملاحظات
                </th>
                {isEditable && <th className="py-2 px-2" />}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={isEditable ? 9 : 8}>
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
                            ),
                          )}
                          placeholder="اختر المنتج"
                        />
                      ) : (
                        <span
                          className="font-medium text-sm block truncate"
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
                              ? "فرق صفر — لن يُقبل عند الاعتماد"
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
                        <Input
                          value={item.notes}
                          onChange={(e) => {
                            const u = [...items];
                            u[i].notes = e.target.value;
                            setItems(u);
                          }}
                          onKeyDown={(e) => handleLastFieldKeyDown(e, i, "notes")}
                          className="text-xs bg-muted/30 border-border rounded-md h-8 w-full"
                          placeholder="ملاحظة..."
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground truncate block">
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

      {/* ── Notes + Summary: Side by side ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Notes */}
        <div className="bg-card p-6 rounded-2xl border shadow-sm flex flex-col">
          <div className="mb-4">
            <SectionHeader icon={StickyNote} title="ملاحظات" />
          </div>
          <div className="flex-1 space-y-2">
            <Label className="text-sm font-medium text-muted-foreground">
              ملاحظات حول عملية الجرد
            </Label>
            {isEditable ? (
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full h-32 px-4 py-3 bg-muted/30 border border-border rounded-xl text-sm transition-all resize-none focus:ring-2 focus:ring-ring focus:border-ring"
                placeholder="أدخل أي ملاحظات إضافية هنا..."
              />
            ) : (
              <div className="h-32 px-4 py-3 bg-muted/30 border rounded-xl text-sm text-muted-foreground">
                {description || "لا توجد ملاحظات"}
              </div>
            )}
          </div>
        </div>

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
                  إجمالي العجز
                </span>
              </div>
            )}
            {totalGain > 0 && (
              <div className="flex justify-between items-center py-2.5 border-b border-border/50">
                <span className="font-mono tabular-nums text-sm font-medium text-green-700 dark:text-green-400">
                  {formatCurrency(totalGain)}
                </span>
                <span className="text-sm text-muted-foreground">
                  إجمالي الفائض
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
                  ? "صافي فائض"
                  : netDifference < 0
                    ? "صافي عجز"
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
