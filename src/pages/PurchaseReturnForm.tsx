import React, { useState, useEffect } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import { getNextPostedNumber, formatDisplayNumber } from "@/lib/posted-number-utils";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { createJournalEntry, createReverseJournalEntry } from "@/lib/journal-writer";
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
import { useLineItems } from "@/hooks/use-line-items";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/NumberInput";
import { DatePickerInput } from "@/components/DatePickerInput";
import { Label } from "@/components/ui/label";
import { LookupCombobox } from "@/components/LookupCombobox";
import {
  Plus,
  X,
  Save,
  CheckCircle,
  Trash2,
  Ban,
  Printer,
  Truck,
  FileText,
  ListChecks,
  CreditCard,
  StickyNote,
  ArrowLeftRight,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { exportInvoicePdf } from "@/lib/pdf-arabic";
import { ConfirmDialog } from "@/components/ConfirmDialog";

import InvoicePaymentSection from "@/components/InvoicePaymentSection";
import ReturnSettlementsView from "@/components/ReturnSettlementsView";
import { recalculateEntityBalance } from "@/lib/entity-balance";

import {
  ProductWithBrand,
  productsToLookupItems,
  PRODUCT_SELECT_FIELDS_BASIC,
} from "@/lib/product-utils";
import { ACCOUNT_CODES } from "@/lib/constants";
import { notify } from "@/lib/notify";
import { deleteDraftDocument } from "@/lib/document-actions";

interface Supplier {
  id: string;
  code: string;
  name: string;
  balance?: number;
}
type Product = ProductWithBrand & {
  purchase_price: number;
  quantity_on_hand: number;
  selling_price?: number;
};
interface ReturnItem {
  id?: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
}

export default function PurchaseReturnForm() {
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

  const [returnNumber, setReturnNumber] = useState<number | null>(null);
  const [postedNumber, setPostedNumber] = useState<number | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");
  const [status, setStatus] = useState("draft");
  const { items, setItems, addItem, removeItem, updateItem, handleLastFieldKeyDown } = useLineItems<ReturnItem>(
    { priceField: "purchase_price" },
    products,
  );
  const [editMode, setEditMode] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});


  useEffect(() => {
    loadData();
  }, [id]);

  async function loadData() {
    const [supRes, prodRes] = await Promise.all([
      (supabase.from("suppliers") as any).select("id, code, name, phone, balance").eq("is_active", true).order("name"),
      supabase
        .from("products")
        .select("id, code, name, purchase_price, quantity_on_hand, model_number, brand_id, product_brands(name)")
        .eq("is_active", true)
        .order("name"),
    ]);
    setSuppliers(supRes.data || []);
    setProducts(prodRes.data || []);

    if (id) {
      const { data: ret } = await (supabase.from("purchase_returns") as any)
        .select("*, suppliers:supplier_id(name)")
        .eq("id", id)
        .single();
      if (ret) {
        setReturnNumber(ret.return_number);
        setPostedNumber(ret.posted_number || null);
        setSupplierId(ret.supplier_id || "");
        setSupplierName(ret.suppliers?.name || "");
        setReturnDate(ret.return_date);
        setNotes(ret.notes || "");
        setReference(ret.reference || "");
        setStatus(ret.status);
        setEditMode(ret.status === "draft");

        const { data: itemsData } = await (supabase.from("purchase_return_items") as any)
          .select("*, products:product_id(name, code, model_number, product_brands(name))")
          .eq("return_id", id)
          .order("sort_order", { ascending: true });
        setItems(mapLoadedLineItems<ReturnItem>(itemsData));
      }
      setLoading(false);
    } else {
      setEditMode(true);
      setLoading(false);
    }
  }

  const { subtotal, afterDiscount, taxAmount, grandTotal } = calcInvoiceTotals({
    items,
    showTax,
    taxRate,
  });

  async function handleSave(opts?: { silent?: boolean; skipReload?: boolean }): Promise<boolean> {
    if (saving) return false;
    const errors: Record<string, string> = {};
    // Draft is permissive: allow saving partial work.
    // Strict validation runs on Post.
    if (items.some((i) => i.product_id && i.quantity <= 0)) errors.items = "يجب أن تكون الكمية أكبر من صفر لكل بند";
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
      const payload: any = {
        supplier_id: supplierId || null,
        return_date: returnDate,
        subtotal,
        discount: 0,
        tax: taxAmount,
        total: grandTotal,
        notes: notes.trim() || null,
        reference: reference.trim() || null,
        status: "draft",
      };

      const draftSavedMsg = droppedEmpty > 0 ? `تم الحفظ مع تجاهل ${droppedEmpty} سطر فارغ` : undefined;

      if (isNew) {
        const { data: ret, error } = await (supabase.from("purchase_returns") as any)
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        const rows = buildLineItemRows(validItems, {
          parentKey: "return_id",
          parentId: ret.id,
          reduction: payload.discount || 0,
        });

        if (rows.length > 0) {
          await (supabase.from("purchase_return_items") as any).insert(rows);
        }
        if (!opts?.silent) {
          notify.success("تمت الإضافة", draftSavedMsg || "تم إنشاء مرتجع الشراء كمسودة");
        }
        markClean();
        navigate(`/purchase-returns/${ret.id}`);
      } else {
        await (supabase.from("purchase_returns") as any).update(payload).eq("id", id);
        await (supabase.from("purchase_return_items") as any).delete().eq("return_id", id);
        const rows = buildLineItemRows(validItems, {
          parentKey: "return_id",
          parentId: id!,
          reduction: payload.discount || 0,
        });

        if (rows.length > 0) {
          await (supabase.from("purchase_return_items") as any).insert(rows);
        }
        if (!opts?.silent) {
          notify.success("تم التحديث", draftSavedMsg || "تم تحديث مرتجع الشراء");
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

  async function postReturn() {
    if (
      !ensurePeriodUnlocked(
        returnDate,
        (lockedUntil) => `لا يمكن ترحيل مرتجع بتاريخ ${returnDate} — الفترة مقفلة حتى ${lockedUntil}`,
      )
    )
      return;
    // Persist any unsaved edits before posting
    if (isDirty && id) {
      const saved = await handleSave({ silent: true, skipReload: true });
      if (!saved) {
        notify.error("تعذر الترحيل", "فشل حفظ التعديلات غير المحفوظة — لم تتم عملية الترحيل");
        return;
      }
    }
    setSaving(true);
    try {
      // Validate: cannot return more than available stock AND total purchased from supplier
      for (const item of items) {
        if (!item.product_id) continue;
        const { data: prod } = await supabase
          .from("products")
          .select("quantity_on_hand, name")
          .eq("id", item.product_id)
          .single();
        if (prod && item.quantity > prod.quantity_on_hand) {
          notify.error("تنبيه", `لا يمكن إرجاع كمية (${item.quantity}) من الصنف (${item.product_name}) أكبر من الكمية المتاحة في المخزون (${prod.quantity_on_hand})`);
          return;
        }
        // Validate against total purchased quantity from this supplier
        const { data: purchasedItems } = await (supabase.from("purchase_invoice_items") as any)
          .select("quantity, invoice_id")
          .eq("product_id", item.product_id);
        if (purchasedItems) {
          const invoiceIds = [...new Set(purchasedItems.map((pi: any) => pi.invoice_id))] as string[];
          const { data: postedInvs } = invoiceIds.length
            ? await (supabase.from("purchase_invoices") as any)
                .select("id")
                .in("id", invoiceIds)
                .eq("status", "posted")
                .eq("supplier_id", supplierId)
            : { data: [] };
          const postedIds = new Set((postedInvs || []).map((i: any) => i.id));
          const totalPurchased = purchasedItems
            .filter((pi: any) => postedIds.has(pi.invoice_id))
            .reduce((s: number, pi: any) => s + Number(pi.quantity), 0);
          // Also check already returned quantity
          const { data: returnedItems } = await (supabase.from("purchase_return_items") as any)
            .select("quantity, return_id")
            .eq("product_id", item.product_id);
          let totalReturned = 0;
          if (returnedItems?.length) {
            const retIds = [...new Set(returnedItems.map((ri: any) => ri.return_id))] as string[];
            const { data: postedRets } = await (supabase.from("purchase_returns") as any)
              .select("id")
              .in("id", retIds)
              .eq("status", "posted")
              .eq("supplier_id", supplierId);
            const postedRetIds = new Set((postedRets || []).map((r: any) => r.id));
            totalReturned = returnedItems
              .filter((ri: any) => postedRetIds.has(ri.return_id))
              .reduce((s: number, ri: any) => s + Number(ri.quantity), 0);
          }
          const maxReturnable = totalPurchased - totalReturned;
          if (item.quantity > maxReturnable) {
            notify.error("تنبيه", `لا يمكن إرجاع كمية (${item.quantity}) من الصنف (${item.product_name}) — إجمالي المشتراة من هذا المورد (${totalPurchased}) والمرتجعة سابقاً (${totalReturned})`);
            return;
          }
        }
      }

      const { data: accounts } = await supabase
        .from("accounts")
        .select("id, code")
        .in("code", [
          ACCOUNT_CODES.INVENTORY,
          ACCOUNT_CODES.SUPPLIERS,
          ACCOUNT_CODES.INPUT_VAT,
          ACCOUNT_CODES.PURCHASE_RETURN_PRICE_VARIANCE,
        ]);
      const inventoryAcc = accounts?.find((a) => a.code === ACCOUNT_CODES.INVENTORY);
      const supplierAcc = accounts?.find((a) => a.code === ACCOUNT_CODES.SUPPLIERS);
      const inputVatAcc = accounts?.find((a) => a.code === ACCOUNT_CODES.INPUT_VAT);
      const ppvAcc = accounts?.find((a) => a.code === ACCOUNT_CODES.PURCHASE_RETURN_PRICE_VARIANCE);
      if (!inventoryAcc || !supplierAcc) {
        notify.error("خطأ", "تأكد من وجود حسابات المخزون والموردين");
        return;
      }

      // Compute WAC-based inventory credit per item (use current WAC, not invoice price).
      // Policy: Purchase returns credit inventory at current WAC × qty.
      // Any difference vs invoice price is recorded as Purchase Price Variance (5103).
      let inventoryCreditWac = 0;
      const itemWacList: { product_id: string; wac: number; qty: number }[] = [];
      for (const item of items) {
        if (!item.product_id) continue;
        const { data: wacData } = await (supabase as any).rpc("get_avg_purchase_price", {
          _product_id: item.product_id,
        });
        const wac = Number(wacData) || 0;
        inventoryCreditWac += wac * item.quantity;
        itemWacList.push({ product_id: item.product_id, wac, qty: item.quantity });
      }
      inventoryCreditWac = Math.round(inventoryCreditWac * 100) / 100;

      const nextPostedNum = await getNextPostedNumber("purchase_returns");
      const retPrefix = settings?.purchase_return_prefix || "PRN-";
      const displayRetNum = `${retPrefix}${String(nextPostedNum).padStart(4, "0")}`;

      const netCost = grandTotal - taxAmount;
      // Variance = invoice net cost − WAC inventory credit.
      // > 0: invoice price higher than WAC → expense (debit PPV)
      // < 0: invoice price lower than WAC → gain (credit PPV)
      const variance = Math.round((netCost - inventoryCreditWac) * 100) / 100;

      const jeLines: any[] = [
        {
          account_id: supplierAcc.id,
          debit: grandTotal,
          credit: 0,
          description: `مرتجع شراء - ${displayRetNum}`,
        },
        {
          account_id: inventoryAcc.id,
          debit: 0,
          credit: inventoryCreditWac,
          description: `خصم مخزون مرتجع (WAC) - ${displayRetNum}`,
        },
      ];
      if (Math.abs(variance) > 0.01 && ppvAcc) {
        if (variance > 0) {
          jeLines.push({
            account_id: ppvAcc.id,
            debit: 0,
            credit: variance,
            description: `فرق سعر مرتجع (أعلى من WAC) - ${displayRetNum}`,
          });
        } else {
          jeLines.push({
            account_id: ppvAcc.id,
            debit: -variance,
            credit: 0,
            description: `فرق سعر مرتجع (أقل من WAC) - ${displayRetNum}`,
          });
        }
      }
      if (taxAmount > 0 && inputVatAcc) {
        jeLines.push({
          account_id: inputVatAcc.id,
          debit: 0,
          credit: taxAmount,
          description: `عكس ضريبة مدخلات - ${displayRetNum}`,
        });
      }
      const jeId = await createJournalEntry({
        entryDate: returnDate,
        description: `مرتجع شراء رقم ${displayRetNum}`,
        lines: jeLines,
        status: "posted",
      });

      await (supabase.from("purchase_returns") as any)
        .update({
          status: "posted",
          journal_entry_id: jeId,
          posted_number: nextPostedNum,
        })
        .eq("id", id);

      for (const item of items) {
        if (!item.product_id) continue;
        const wacEntry = itemWacList.find((w) => w.product_id === item.product_id);
        const wac = wacEntry?.wac ?? item.unit_price;
        const totalWac = Math.round(wac * item.quantity * 100) / 100;
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
        await (supabase.from("inventory_movements") as any).insert({
          product_id: item.product_id,
          movement_type: "purchase_return",
          quantity: item.quantity,
          unit_cost: wac,
          total_cost: totalWac,
          reference_id: id,
          reference_type: "purchase_return",
          movement_date: returnDate,
        });
      }

      await recalculateEntityBalance("supplier", supplierId);

      notify.success("تم الترحيل", "تم ترحيل مرتجع الشراء");
      markClean();
      loadData();
    } catch (error: any) {
      notify.error("خطأ", error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelPosted() {
    if (saving) return;
    await runAction(async () => {
      const { data: ret } = await (supabase.from("purchase_returns") as any)
        .select("journal_entry_id, posted_number, return_number")
        .eq("id", id)
        .single();

      // Reverse inventory
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
              quantity_on_hand: prod.quantity_on_hand + item.quantity,
            } as any)
            .eq("id", item.product_id);
        }
        await (supabase.from("inventory_movements") as any)
          .delete()
          .eq("reference_id", id)
          .eq("product_id", item.product_id);
      }

      await (supabase.from("purchase_returns") as any).update({ status: "cancelled" }).eq("id", id);
      await recalculateEntityBalance("supplier", supplierId);

      // Create reverse journal entry
      if (ret?.journal_entry_id) {
        await createReverseJournalEntry({
          sourceEntryId: ret.journal_entry_id,
          entryDate: new Date().toISOString().split("T")[0],
          description: `عكس مرتجع شراء رقم ${formatDisplayNumber(settings?.purchase_return_prefix || "PRN-", ret?.posted_number, ret?.return_number || 0, "posted")}`,
        });
      }

      // status already set to cancelled above
      notify.success("تم الإلغاء", "تم إلغاء المرتجع وعكس القيد المحاسبي وإرجاع المخزون");
      markClean();
      loadData();
    });
  }

  async function handleDeleteDraft() {
    if (saving) return;
    await runAction(async () => {
      await deleteDraftDocument({
        itemsTable: "purchase_return_items",
        parentTable: "purchase_returns",
        parentKey: "return_id",
        id: id!,
      });
      notify.success("تم الحذف", "تم حذف المرتجع");
      markClean();
      navigate("/purchase-returns");
    });
  }

  async function handlePrint() {
    await exportInvoicePdf({
      type: "purchase_return",
      number: postedNumber
        ? formatDisplayNumber(settings?.purchase_return_prefix || "PRN-", postedNumber, returnNumber || 0, status)
        : returnNumber || "جديد",
      date: returnDate,
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
    ? formatDisplayNumber(settings?.purchase_return_prefix || "PRN-", postedNumber, returnNumber || 0, status)
    : null;

  const totalDiscount = items.reduce((s, i) => s + i.discount, 0);

  return (
    <div className="space-y-6" dir="rtl" onInput={() => isEditable && markDirty()}>
      <PageHeader
        icon={RotateCcw}
        title={isNew ? "مرتجع شراء جديد" : "مرتجع شراء"}
        description="إدارة وتوثيق مرتجعات المشتريات بدقة وسهولة"
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
                title="حذف المرتجع"
                description="هل أنت متأكد من حذف هذا المرتجع؟"
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
                title="إلغاء المرتجع المرحّل"
                description="سيتم عكس القيد المحاسبي وإرجاع الكميات للمخزون وتعديل رصيد المورد."
                confirmText="إلغاء المرتجع"
                cancelText="تراجع"
                destructive
                onConfirm={handleCancelPosted}
              />
            )}

            {!isNew && (
              <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5">
                <Printer className="h-4 w-4" />
                طباعة
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
                onClick={postReturn}
                disabled={saving}
                className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-5"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                {saving ? "جاري الترحيل..." : "ترحيل المرتجع"}
              </Button>
            )}
          </>
        }
      />

      {/* ── Entity Details Card ── */}
      <div className="bg-card p-6 rounded-2xl border shadow-sm">
        <div className="mb-5">
          <SectionHeader icon={Truck} title="بيانات المرتجع" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-muted-foreground">
              اسم المورد <span className="text-red-500">*</span>
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
                  setFieldErrors((e) => {
                    const { supplier, ...rest } = e;
                    return rest;
                  });
                }}
                placeholder="اختر المورد"
                error={!!fieldErrors.supplier}
              />
            ) : (
              <div className="h-10 px-4 flex items-center rounded-xl border bg-muted/30 text-sm font-medium">
                {supplierName || suppliers.find((s) => s.id === supplierId)?.name || "—"}
              </div>
            )}
            <FormFieldError message={fieldErrors.supplier} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-muted-foreground">تاريخ المرتجع</Label>
            {isEditable ? (
              <DatePickerInput
                value={returnDate}
                onChange={(v) => {
                  setReturnDate(v);
                  setIsDirty(true);
                }}
                placeholder="اختر التاريخ"
              />
            ) : (
              <div className="h-10 px-4 flex items-center rounded-xl border bg-muted/30 text-sm font-mono tabular-nums">
                {returnDate}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-muted-foreground">رقم المرجع</Label>
            {isEditable ? (
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="رقم مرجعي (اختياري)"
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
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <SectionHeader icon={ListChecks} title="بنود المرتجع" />
            {items.length > 0 && (
              <span className="text-xs font-medium text-muted-foreground bg-muted border border-border/60 px-2.5 py-0.5 rounded-full tabular-nums">
                {items.length} {items.length === 1 ? "بند" : "بنود"}
              </span>
            )}
            <FormFieldError message={fieldErrors.items} />
          </div>
        </div>
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
                            className="font-mono tabular-nums text-center bg-muted/30 border-border rounded-md h-8 w-full"
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
                  {items.filter((i) => i.product_id).length}
                </span>
              </div>
              <div className="flex items-center gap-1.5 bg-muted border border-border/60 px-3 py-1.5 rounded-lg">
                <span className="text-xs text-muted-foreground">الوحدات</span>
                <span className="text-xs font-mono font-semibold tabular-nums text-foreground">
                  {items.reduce((s, i) => s + i.quantity, 0)}
                </span>
              </div>
              <div className="w-px h-4 bg-border/60" />
              {showDiscount && totalDiscount > 0 && (
                <div className="flex items-center gap-1.5 bg-muted border border-border/60 px-3 py-1.5 rounded-lg">
                  <span className="text-xs text-muted-foreground">إجمالي الخصم</span>
                  <span className="text-xs font-mono font-semibold tabular-nums text-green-600 dark:text-green-400">
                    -{formatCurrency(totalDiscount)}
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

      {/* ── Notes + Summary ── */}
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
        <div className="bg-card p-6 rounded-2xl border shadow-sm flex flex-col">
          <div className="mb-4">
            <SectionHeader icon={CreditCard} title="ملخص المرتجع" />
          </div>
          <div className="space-y-1 mt-2">
            <div className="flex justify-between items-center py-2.5 border-b border-border/50">
              <span className="font-mono tabular-nums text-sm font-medium">{formatCurrency(subtotal)}</span>
              <span className="text-sm text-muted-foreground">المجموع قبل الضريبة</span>
            </div>
            {showDiscount && totalDiscount > 0 && (
              <div className="flex justify-between items-center py-2.5 border-b border-border/50">
                <span className="font-mono tabular-nums text-sm font-medium text-green-600 dark:text-green-400">
                  -{formatCurrency(totalDiscount)}
                </span>
                <span className="text-sm text-muted-foreground">إجمالي الخصومات</span>
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
      {!isNew && status === "posted" && id && (
        <div className="bg-card p-6 rounded-2xl border shadow-sm">
          <div className="mb-5">
            <SectionHeader icon={ArrowLeftRight} title="العمليات المرتبطة" />
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <InvoicePaymentSection
                type="purchase_return"
                invoiceId={id}
                entityId={supplierId}
                entityName={supplierName || suppliers.find((s) => s.id === supplierId)?.name || ""}
                invoiceTotal={grandTotal}
                invoiceDisplayNumber={displayNumber || ""}
                onPaymentAdded={loadData}
              />
            </div>
            <div className="flex-1">
              <ReturnSettlementsView type="purchase" returnId={id} returnTotal={grandTotal} />
            </div>
          </div>
        </div>
      )}

      <UnsavedChangesDialog open={navGuard.isBlocked} onStay={navGuard.cancel} onLeave={navGuard.confirm} />
    </div>
  );
}
