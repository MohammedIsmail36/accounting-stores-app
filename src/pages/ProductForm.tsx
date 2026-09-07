import { notify } from "@/lib/notify";
import React, { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { createJournalEntry } from "@/lib/journal-writer";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigationGuard } from "@/hooks/use-navigation-guard";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { FormFieldError } from "@/components/FormFieldError";
import { PageSkeleton } from "@/components/PageSkeleton";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LookupCombobox } from "@/components/LookupCombobox";
import { CategoryTreeSelect } from "@/components/CategoryTreeSelect";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { ACCOUNT_CODES } from "@/lib/constants";
import { calcMargin } from "@/lib/margin-utils";
import { deleteStorageFile, deleteStorageFiles } from "@/lib/storage-cleanup";
import {
  generateEntityCode,
  generateProductBarcode,
} from "@/lib/code-generation";
import { useSettings } from "@/contexts/SettingsContext";
import {
  Save,
  Plus,
  ImagePlus,
  X,
  Image as ImageIcon,
  Loader2,
  Package,
} from "lucide-react";

interface LookupItem {
  id: string;
  name: string;
}
interface CategoryItem {
  id: string;
  name: string;
  parent_id?: string | null;
}

export default function ProductForm() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const returnTo = (location.state as any)?.returnTo || "";
  const goBackToList = () => navigate(`/products${returnTo}`);
  const { id } = useParams();
  const isEdit = !!id;
  const { settings } = useSettings();

  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [units, setUnits] = useState<LookupItem[]>([]);
  const [brands, setBrands] = useState<LookupItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const navGuard = useNavigationGuard(isDirty);

  // Quick-add dialogs
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [addUnitOpen, setAddUnitOpen] = useState(false);
  const [addBrandOpen, setAddBrandOpen] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newCategoryParentId, setNewCategoryParentId] = useState("");

  // Form fields
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [barcode, setBarcode] = useState("");
  const [barcodeLabel, setBarcodeLabel] = useState("");
  const [barcodePrice, setBarcodePrice] = useState<string>("");
  const [purchasePrice, setPurchasePrice] = useState(0);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [quantity, setQuantity] = useState(0);
  const [minStock, setMinStock] = useState(0);
  const [mainImageUrl, setMainImageUrl] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [galleryImages, setGalleryImages] = useState<
    { id?: string; image_url: string }[]
  >([]);
  const [uploadingMain, setUploadingMain] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);

  useEffect(() => {
    fetchLookups();
    if (isEdit) fetchProduct();
  }, [id]);

  // Auto-generate SKU code for new products
  useEffect(() => {
    if (isEdit) return;
    const prefix = settings?.product_code_prefix || "PRD-";
    generateEntityCode("products", prefix).then((generated) => {
      setCode((prev) => prev || generated);
    });
  }, [isEdit, settings?.product_code_prefix]);

  const fetchLookups = async () => {
    const [catRes, unitRes, brandRes] = await Promise.all([
      (supabase.from("product_categories") as any)
        .select("id, name, parent_id")
        .eq("is_active", true)
        .order("name"),
      (supabase.from("product_units") as any)
        .select("id, name")
        .eq("is_active", true)
        .order("name"),
      (supabase.from("product_brands") as any)
        .select("id, name")
        .eq("is_active", true)
        .order("name"),
    ]);
    setCategories(catRes.data || []);
    setUnits(unitRes.data || []);
    setBrands(brandRes.data || []);
  };

  const fetchProduct = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", id!)
      .single();
    if (error || !data) {
      notify.error("خطأ", "لم يتم العثور على المنتج");
      goBackToList();
      return;
    }
    setCode(data.code);
    setName(data.name);
    setDescription(data.description || "");
    setCategoryId(data.category_id || "");
    setUnitId(data.unit_id || "");
    setBrandId(data.brand_id || "");
    setModelNumber(data.model_number || "");
    setBarcode(data.barcode || "");
    setBarcodeLabel((data as any).barcode_label || "");
    setBarcodePrice(
      (data as any).barcode_price != null ? String((data as any).barcode_price) : "",
    );
    setPurchasePrice(data.purchase_price);
    setSellingPrice(data.selling_price);
    setQuantity(data.quantity_on_hand);
    setMinStock(data.min_stock_level);
    setMainImageUrl(data.main_image_url || null);
    setIsActive(data.is_active ?? true);

    const { data: imgs } = await (supabase.from("product_images") as any)
      .select("*")
      .eq("product_id", id!)
      .order("sort_order");
    setGalleryImages(
      (imgs || []).map((i: any) => ({ id: i.id, image_url: i.image_url })),
    );
    setLoading(false);
  };

  const uploadImage = async (
    file: File,
    path: string,
  ): Promise<string | null> => {
    const ext = file.name.split(".").pop();
    const filePath = `${path}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("product-images")
      .upload(filePath, file);
    if (error) {
      notify.error("خطأ", "فشل رفع الصورة");
      return null;
    }
    const { data } = supabase.storage
      .from("product-images")
      .getPublicUrl(filePath);
    return data.publicUrl;
  };

  const handleMainImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingMain(true);
    const oldUrl = mainImageUrl;
    const url = await uploadImage(file, "main");
    if (url) {
      setMainImageUrl(url);
      // Remove previous main image from storage after successful replacement
      if (oldUrl && oldUrl !== url) await deleteStorageFile(oldUrl);
    }
    setUploadingMain(false);
  };

  const handleGalleryImages = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = e.target.files;
    if (!files) return;
    setUploadingGallery(true);
    const newImages: { image_url: string }[] = [];
    for (const file of Array.from(files)) {
      const url = await uploadImage(file, "gallery");
      if (url) newImages.push({ image_url: url });
    }
    setGalleryImages((prev) => [...prev, ...newImages]);
    setUploadingGallery(false);
  };

  const removeGalleryImage = (index: number) => {
    setGalleryImages((prev) => {
      const removed = prev[index];
      if (removed?.image_url) {
        // fire-and-forget storage cleanup
        void deleteStorageFile(removed.image_url);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSave = async () => {
    if (saving) return;
    const errors: Record<string, string> = {};
    if (!code.trim()) errors.code = "يرجى إدخال رمز التخزين";
    if (!name.trim()) errors.name = "يرجى إدخال اسم المنتج";
    if (sellingPrice < 0 || purchasePrice < 0)
      errors.price = "لا يمكن أن تكون الأسعار سالبة";
    if (quantity < 0) errors.quantity = "لا يمكن أن تكون الكمية سالبة";
    if (!isEdit && quantity > 0 && (!purchasePrice || purchasePrice <= 0))
      errors.quantity = "يجب إدخال سعر الشراء عند تسجيل كمية افتتاحية (لضمان توازن المخزون مع الحسابات)";

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      notify.error("تنبيه", Object.values(errors)[0]);
      return;
    }
    setSaving(true);

    // Auto-generate barcode if empty (new or edit)
    let finalBarcode = barcode.trim() || null;
    if (!finalBarcode) {
      try {
        finalBarcode = await generateProductBarcode();
      } catch {
        // If barcode generation fails, proceed without it
        finalBarcode = null;
      }
    }

    const payload: any = {
      code: code.trim(),
      name: name.trim(),
      description: description.trim() || null,
      category_id: categoryId || null,
      unit_id: unitId || null,
      brand_id: brandId || null,
      model_number: modelNumber.trim() || null,
      barcode: finalBarcode,
      barcode_label: barcodeLabel.trim() || null,
      barcode_price:
        barcodePrice.trim() === "" ? null : Number(barcodePrice) || null,
      purchase_price: purchasePrice,
      selling_price: sellingPrice,
      quantity_on_hand: isEdit ? undefined : quantity,
      min_stock_level: minStock,
      main_image_url: mainImageUrl,
      ...(isEdit ? { is_active: isActive } : {}),
    };

    try {
      let productId = id;
      if (isEdit) {
        const { error } = await supabase
          .from("products")
          .update(payload as any)
          .eq("id", id!);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("products")
          .insert(payload as any)
          .select("id")
          .single();
        if (error) throw error;
        productId = data.id;

        if (quantity > 0 && purchasePrice > 0 && productId) {
          const totalCost = quantity * purchasePrice;
          try {
            const { data: accounts } = await supabase
              .from("accounts")
              .select("id, code")
              .in("code", [ACCOUNT_CODES.INVENTORY, ACCOUNT_CODES.EQUITY]);
            const inventoryAcc = accounts?.find(
              (a) => a.code === ACCOUNT_CODES.INVENTORY,
            );
            const capitalAcc = accounts?.find(
              (a) => a.code === ACCOUNT_CODES.EQUITY,
            );

            if (inventoryAcc && capitalAcc) {
              const obDesc = `رصيد افتتاحي مخزون - ${name.trim()}`;
              await createJournalEntry({
                entryDate: new Date().toISOString().split("T")[0],
                description: `رصيد افتتاحي - منتج ${name.trim()}`,
                status: "posted",
                lines: [
                  { account_id: inventoryAcc.id, debit: totalCost, credit: 0, description: obDesc },
                  { account_id: capitalAcc.id, debit: 0, credit: totalCost, description: obDesc },
                ],
              });
            }

            const { error: movError } = await (
              supabase.from("inventory_movements") as any
            ).insert({
              product_id: productId,
              movement_type: "opening_balance",
              quantity: quantity,
              unit_cost: purchasePrice,
              total_cost: totalCost,
              reference_type: "opening_balance",
              movement_date: new Date().toISOString().split("T")[0],
            });
            if (movError) throw movError;
          } catch (openingBalanceError) {
            // Rollback: delete the product + any uploaded images from storage
            await deleteStorageFiles([
              mainImageUrl,
              ...galleryImages.map((g) => g.image_url),
            ]);
            await supabase.from("products").delete().eq("id", productId!);
            throw openingBalanceError;
          }
        }
      }

      if (productId) {
        if (isEdit) {
          // Diff old gallery vs current to remove orphaned files from storage
          const { data: oldImgs } = await (supabase.from("product_images") as any)
            .select("image_url")
            .eq("product_id", productId);
          const currentUrls = new Set(galleryImages.map((g) => g.image_url));
          const orphanUrls = (oldImgs || [])
            .map((r: any) => r.image_url as string)
            .filter((u: string) => !currentUrls.has(u));
          if (orphanUrls.length > 0) await deleteStorageFiles(orphanUrls);

          await (supabase.from("product_images") as any)
            .delete()
            .eq("product_id", productId);
        }
        if (galleryImages.length > 0) {
          const rows = galleryImages.map((img, i) => ({
            product_id: productId!,
            image_url: img.image_url,
            sort_order: i,
          }));
          await (supabase.from("product_images") as any).insert(rows);
        }
      }


      notify.success(isEdit ? "تم التحديث" : "تمت الإضافة", isEdit ? "تم تعديل المنتج بنجاح" : "تم إضافة المنتج بنجاح");
      setIsDirty(false); navGuard.allowNext();
      queryClient.invalidateQueries({ queryKey: ["products-list"] });
      queryClient.invalidateQueries({ queryKey: ["products-summary"] });
      queryClient.invalidateQueries({ queryKey: ["products-usage"] });
      goBackToList();
    } catch (error: any) {
      let msg = error.message;
      if (error.message?.includes("يوجد صنف بنفس الماركة ونفس رقم الموديل")) {
        msg = error.message;
      } else if (error.message?.includes("duplicate")) {
        msg = error.message.includes("barcode")
          ? "الباركود موجود مسبقاً"
          : "كود المنتج موجود مسبقاً";
      }
      notify.error("خطأ", msg);
    } finally {
      setSaving(false);
    }
  };

  const handleQuickAdd = async (
    table: string,
    setter: React.Dispatch<React.SetStateAction<LookupItem[]>>,
    setSelected: (id: string) => void,
  ) => {
    if (!newItemName.trim()) return;
    const { data, error } = await (supabase.from(table as any) as any)
      .insert({ name: newItemName.trim() })
      .select("id, name")
      .single();
    if (error) {
      notify.error("خطأ", error.message.includes("duplicate")
          ? "الاسم موجود مسبقاً"
          : error.message);
      return;
    }
    const item = data as LookupItem;
    setter((prev) =>
      [...prev, item].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setSelected(item.id);
    setNewItemName("");
    setAddUnitOpen(false);
    setAddBrandOpen(false);
  };

  const handleQuickAddCategory = async () => {
    if (!newItemName.trim()) return;
    const payload: any = {
      name: newItemName.trim(),
      parent_id: newCategoryParentId || null,
    };
    const { data, error } = await (supabase.from("product_categories") as any)
      .insert(payload)
      .select("id, name, parent_id")
      .single();
    if (error) {
      notify.error("خطأ", error.message.includes("duplicate")
          ? "الاسم موجود مسبقاً"
          : error.message);
      return;
    }
    const item = data as CategoryItem;
    setCategories((prev) => [...prev, item]);
    setCategoryId(item.id);
    setNewItemName("");
    setNewCategoryParentId("");
    setAddCategoryOpen(false);
  };

  if (loading) return <PageSkeleton variant="form" />;

  return (
    <div
      className="space-y-6 max-w-7xl mx-auto"
      dir="rtl"
      onInput={() => !isDirty && setIsDirty(true)}
    >
      <PageHeader
        icon={Package}
        title={isEdit ? "تعديل منتج" : "إضافة منتج جديد"}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => goBackToList()}
              className="border-primary text-primary hover:bg-primary/5 rounded-xl px-6"
            >
              إلغاء
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="gap-2 rounded-xl px-6 shadow-lg shadow-primary/20"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "جاري الحفظ..." : isEdit ? "تحديث المنتج" : "حفظ المنتج"}
            </Button>
          </>
        }
      />

      {/* Main Form Card - Two Column Layout */}
      <div className="bg-card rounded-xl shadow-sm border border-border p-6 lg:p-8 flex flex-col lg:flex-row gap-8 lg:gap-10">
        {/* RIGHT COLUMN: Images */}
        <div className="lg:w-1/3 flex flex-col gap-5">
          <h3 className="text-lg font-bold text-foreground border-b border-border pb-3 flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-primary" />
            صور المنتج
          </h3>

          {/* Main Image */}
          {mainImageUrl ? (
            <div className="relative w-full aspect-square rounded-xl overflow-hidden border border-border">
              <img
                src={mainImageUrl}
                alt="Main"
                className="w-full h-full object-contain bg-white"
              />
              <Button
                variant="destructive"
                size="icon"
                aria-label="حذف الصورة الرئيسية"
                className="absolute top-2 left-2 h-8 w-8 rounded-full"
                onClick={() => {
                  const old = mainImageUrl;
                  setMainImageUrl(null);
                  if (old) void deleteStorageFile(old);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <label className="w-full aspect-square bg-muted/30 border-2 border-dashed border-muted-foreground/30 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-all group">
              <div className="text-center p-6 group-hover:scale-105 transition-transform">
                <ImagePlus className="h-12 w-12 text-muted-foreground/40 group-hover:text-primary mx-auto mb-3" />
                <p className="text-muted-foreground font-medium text-sm">
                  {uploadingMain ? "جاري الرفع..." : "اسحب الصورة الرئيسية هنا"}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-2">
                  أو انقر لاختيار ملف
                </p>
              </div>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleMainImage}
                disabled={uploadingMain}
              />
            </label>
          )}

          {/* Gallery Thumbnails */}
          <div className="grid grid-cols-3 gap-3">
            {galleryImages.map((img, i) => (
              <div
                key={i}
                className="relative aspect-square rounded-lg overflow-hidden border border-border"
              >
                <img
                  src={img.image_url}
                  alt={`Gallery ${i}`}
                  className="w-full h-full object-contain bg-white"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  aria-label="حذف صورة المعرض"
                  className="absolute top-0 left-0 h-5 w-5 rounded-full"
                  onClick={() => removeGalleryImage(i)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {/* Add gallery slot */}
            <label className="aspect-square bg-muted/30 border border-border rounded-lg flex items-center justify-center cursor-pointer hover:border-primary transition-colors">
              {uploadingGallery ? (
                <span className="text-[10px] text-muted-foreground">
                  جاري...
                </span>
              ) : (
                <Plus className="h-5 w-5 text-muted-foreground" />
              )}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleGalleryImages}
                disabled={uploadingGallery}
              />
            </label>
          </div>

          <p className="text-xs text-muted-foreground/60">
            توصية: استخدم صوراً مربعة بخلفية بيضاء بدقة لا تقل عن 800×800 بكسل.
          </p>
        </div>

        {/* LEFT COLUMN: Form Fields */}
        <div className="flex-1 space-y-8">
          {/* SECTION: Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-foreground border-b border-border pb-3">
              المعلومات الأساسية
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Label className="text-sm font-medium text-foreground/80 mb-1.5 block">
                  اسم المنتج <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setFieldErrors((er) => {
                      const { name, ...rest } = er;
                      return rest;
                    });
                  }}
                  placeholder="مثال: سماعات سوني اللاسلكية WH-1000XM5"
                  className="bg-muted/30"
                  error={!!fieldErrors.name}
                />
                <FormFieldError message={fieldErrors.name} />
              </div>
              <div>
                <Label className="text-sm font-medium text-foreground/80 mb-1.5 block">
                  رقم موديل المصنع
                </Label>
                <Input
                  value={modelNumber}
                  onChange={(e) => setModelNumber(e.target.value)}
                  placeholder="مثال: SNY-XM5-BLK"
                  className="font-mono bg-muted/30"
                />
              </div>
              <div>
                <Label className="text-sm font-medium text-foreground/80 mb-1.5 block">
                  الباركود
                </Label>
                <Input
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="000000000000"
                  className="font-mono bg-muted/30"
                />
              </div>
              <div>
                <Label className="text-sm font-medium text-foreground/80 mb-1.5 block">
                  رمز التخزين (SKU) <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setFieldErrors((er) => {
                      const { code, ...rest } = er;
                      return rest;
                    });
                  }}
                  placeholder="PRD-2024-X1"
                  className="font-mono bg-muted/30"
                  error={!!fieldErrors.code}
                />
                <FormFieldError message={fieldErrors.code} />
              </div>
              <div className="md:col-span-2">
                <Label className="text-sm font-medium text-foreground/80 mb-1.5 block">
                  وصف المنتج
                </Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="اكتب تفاصيل ومواصفات المنتج هنا..."
                  rows={4}
                  className="bg-muted/30"
                />
              </div>
            </div>
          </div>

          {/* SECTION: Classification */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-foreground border-b border-border pb-3">
              التصنيف والتفاصيل
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium text-foreground/80 mb-1.5 block">
                  التصنيف
                </Label>
                <div className="flex gap-2">
                  <CategoryTreeSelect
                    categories={categories}
                    value={categoryId}
                    onValueChange={setCategoryId}
                    placeholder="اختر التصنيف"
                    className="flex-1"
                  />
                  <Button
                    size="icon"
                    aria-label="إضافة تصنيف جديد"
                    onClick={() => {
                      setNewItemName("");
                      setAddCategoryOpen(true);
                    }}
                    className="shrink-0 rounded-lg"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium text-foreground/80 mb-1.5 block">
                  وحدة القياس
                </Label>
                <div className="flex gap-2">
                  <LookupCombobox
                    items={units}
                    value={unitId}
                    onValueChange={setUnitId}
                    placeholder="اختر الوحدة"
                    className="flex-1"
                  />
                  <Button
                    size="icon"
                    aria-label="إضافة وحدة جديدة"
                    onClick={() => {
                      setNewItemName("");
                      setAddUnitOpen(true);
                    }}
                    className="shrink-0 rounded-lg"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium text-foreground/80 mb-1.5 block">
                  الماركة المصنعة
                </Label>
                <div className="flex gap-2">
                  <LookupCombobox
                    items={brands}
                    value={brandId}
                    onValueChange={setBrandId}
                    placeholder="اختر الماركة"
                    className="flex-1"
                  />
                  <Button
                    size="icon"
                    aria-label="إضافة ماركة جديدة"
                    onClick={() => {
                      setNewItemName("");
                      setAddBrandOpen(true);
                    }}
                    className="shrink-0 rounded-lg"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION: Pricing & Inventory */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-foreground border-b border-border pb-3">
              التسعير والمخزون
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-sm font-medium text-foreground/80 mb-1.5 block">
                  سعر الشراء
                </Label>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={purchasePrice || ""}
                    onChange={(e) =>
                      setPurchasePrice(parseFloat(e.target.value) || 0)
                    }
                    className="font-mono bg-muted/30 pl-10"
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    EGP
                  </span>
                </div>
              </div>
              <div>
                <Label className="text-sm font-bold text-primary mb-1.5 block">
                  سعر البيع
                </Label>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={sellingPrice || ""}
                    onChange={(e) =>
                      setSellingPrice(parseFloat(e.target.value) || 0)
                    }
                    className="font-mono border-primary/30 bg-primary/5 pl-10"
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-primary/60 font-bold">
                    EGP
                  </span>
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium text-foreground/80 mb-1.5 block">
                  الكمية الافتتاحية
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={quantity || ""}
                  onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
                  className="font-mono bg-muted/30"
                  disabled={isEdit}
                />
                {isEdit && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    تُحدّث تلقائياً من العمليات
                  </p>
                )}
              </div>
              <div>
                <Label className="text-sm font-medium text-foreground/80 mb-1.5 block">
                  حد إعادة الطلب
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={minStock || ""}
                  onChange={(e) => setMinStock(parseFloat(e.target.value) || 0)}
                  className="font-mono bg-muted/30"
                />
              </div>
            </div>

            {/* Profit Margin Bar */}
            {sellingPrice > 0 && purchasePrice > 0 && (() => {
              const { profit, marginPct, markupPct } = calcMargin(
                sellingPrice,
                purchasePrice,
              );
              return (
                <div className="rounded-xl border border-primary/15 bg-accent/40 p-3 mt-2">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    {/* Profit amount */}
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-primary font-bold text-sm">%</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[11px] text-muted-foreground leading-tight">
                          الربح / وحدة
                        </span>
                        <strong className="text-primary font-mono text-sm leading-tight">
                          {profit.toLocaleString("en-US", { minimumFractionDigits: 2 })} EGP
                        </strong>
                      </div>
                    </div>

                    <div className="h-8 w-px bg-border" />

                    {/* Profit margin */}
                    <div
                      className="flex flex-col"
                      title="هامش الربح = الربح ÷ سعر البيع"
                    >
                      <span className="text-[11px] text-muted-foreground leading-tight">
                        هامش الربح
                      </span>
                      <strong className="text-foreground font-mono text-sm leading-tight">
                        {marginPct.toFixed(1)}%
                      </strong>
                    </div>

                    <div className="h-8 w-px bg-border" />

                    {/* Markup */}
                    <div
                      className="flex flex-col"
                      title="Markup = الربح ÷ التكلفة"
                    >
                      <span className="text-[11px] text-muted-foreground leading-tight">
                        نسبة الربح على التكلفة (Markup)
                      </span>
                      <strong className="text-muted-foreground font-mono text-sm leading-tight">
                        {markupPct.toFixed(1)}%
                      </strong>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* SECTION: Barcode Label Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-foreground border-b border-border pb-3">
              إعدادات ملصق الباركود
            </h3>
            <p className="text-xs text-muted-foreground -mt-2">
              هذه الحقول تُستخدم فقط عند طباعة ملصق الباركود ولا تؤثر على سعر البيع أو المحاسبة.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-sm font-medium text-foreground/80">
                    مسمى الباركود
                  </Label>
                  <button
                    type="button"
                    onClick={() => {
                      const brandName = brands.find((b) => b.id === brandId)?.name || "";
                      const firstWords = name.trim().split(/\s+/).slice(0, 2).join(" ");
                      const parts = [firstWords, brandName].filter(Boolean).join(" ");
                      const suffix = modelNumber.trim();
                      setBarcodeLabel(
                        suffix ? `${parts} - ${suffix}` : parts,
                      );
                    }}
                    className="text-[11px] text-primary hover:underline font-medium"
                  >
                    اقتراح تلقائي
                  </button>
                </div>
                <Input
                  value={barcodeLabel}
                  onChange={(e) => setBarcodeLabel(e.target.value)}
                  placeholder="مثال: قميص فورسيزون - 280"
                  className="bg-muted/30"
                  maxLength={120}
                />
              </div>
              <div>
                <Label className="text-sm font-medium text-foreground/80 mb-1.5 block">
                  سعر الباركود
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={barcodePrice}
                  onChange={(e) => setBarcodePrice(e.target.value)}
                  placeholder="اتركه فارغاً لاستخدام سعر البيع"
                  className="font-mono bg-muted/30"
                />
              </div>
            </div>
          </div>

          {/* Product Active Status - Edit mode only */}
          {isEdit && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-foreground border-b border-border pb-3">
                حالة المنتج
              </h3>
              <div className="flex items-center justify-between bg-muted/30 rounded-xl p-4">
                <div>
                  <Label className="text-sm font-medium text-foreground">
                    تفعيل المنتج
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    المنتجات غير النشطة لا تظهر في قوائم البيع أو الشراء أو
                    التقارير
                  </p>
                </div>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Action Bar */}
      <div className="flex lg:hidden gap-3 pb-6">
        <Button
          variant="outline"
          onClick={() => goBackToList()}
          className="flex-1 py-6 border-primary text-primary rounded-xl font-bold"
        >
          إلغاء
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-6 rounded-xl font-bold shadow-lg shadow-primary/30"
        >
          {saving ? "جاري الحفظ..." : isEdit ? "تحديث المنتج" : "حفظ المنتج"}
        </Button>
      </div>

      {/* Quick-add category dialog */}
      <Dialog open={addCategoryOpen} onOpenChange={setAddCategoryOpen}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>إضافة تصنيف جديد</DialogTitle>
            <DialogDescription>
              أدخل الاسم واختر التصنيف الأب (اختياري)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm">اسم التصنيف *</Label>
              <Input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="اسم التصنيف"
                onKeyDown={(e) => e.key === "Enter" && handleQuickAddCategory()}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">التصنيف الأب (اختياري)</Label>
              <CategoryTreeSelect
                categories={categories}
                value={newCategoryParentId}
                onValueChange={setNewCategoryParentId}
                placeholder="بدون - تصنيف رئيسي"
                className="w-full"
              />
            </div>
          </div>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button onClick={handleQuickAddCategory}>إضافة</Button>
            <Button variant="outline" onClick={() => setAddCategoryOpen(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick-add unit & brand dialogs */}
      {[
        {
          open: addUnitOpen,
          setOpen: setAddUnitOpen,
          title: "إضافة وحدة قياس جديدة",
          table: "product_units",
          setter: setUnits,
          setSelected: setUnitId,
        },
        {
          open: addBrandOpen,
          setOpen: setAddBrandOpen,
          title: "إضافة ماركة جديدة",
          table: "product_brands",
          setter: setBrands,
          setSelected: setBrandId,
        },
      ].map(({ open, setOpen, title, table, setter, setSelected }) => (
        <Dialog key={table} open={open} onOpenChange={setOpen}>
          <DialogContent dir="rtl" className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>أدخل الاسم ثم اضغط إضافة</DialogDescription>
            </DialogHeader>
            <Input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="الاسم"
              onKeyDown={(e) =>
                e.key === "Enter" && handleQuickAdd(table, setter, setSelected)
              }
            />
            <DialogFooter className="flex-row-reverse gap-2">
              <Button
                onClick={() => handleQuickAdd(table, setter, setSelected)}
              >
                إضافة
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>
                إلغاء
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ))}
      <UnsavedChangesDialog
        open={navGuard.isBlocked}
        onStay={navGuard.cancel}
        onLeave={navGuard.confirm}
      />
    </div>
  );
}
