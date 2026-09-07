import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Upload,
  Ruler,
  Tag,
  Factory,
  CheckCircle2,
  XCircle,
  LucideIcon,
} from "lucide-react";
import { LookupImportDialog } from "@/components/LookupImportDialog";
import { ExportMenu } from "@/components/ExportMenu";
import { useSettings } from "@/contexts/SettingsContext";
import { notify } from "@/lib/notify";

interface LookupConfig {
  table: string;
  fkColumn: string;
  title: string;
  singularTitle: string;
  description: string;
  icon: LucideIcon;
  extraFields?: { key: string; label: string; placeholder: string }[];
}

const configs: Record<string, LookupConfig> = {
  categories: {
    table: "product_categories",
    fkColumn: "category_id",
    title: "التصنيفات",
    singularTitle: "تصنيف",
    description: "إدارة تصنيفات المنتجات وتنظيمها في مجموعات.",
    icon: Tag,
    extraFields: [
      {
        key: "description",
        label: "الوصف",
        placeholder: "وصف التصنيف (اختياري)",
      },
    ],
  },
  units: {
    table: "product_units",
    fkColumn: "unit_id",
    title: "وحدات القياس",
    singularTitle: "وحدة قياس",
    description: "إدارة وحدات القياس المستخدمة في المنتجات والفواتير.",
    icon: Ruler,
    extraFields: [
      { key: "symbol", label: "الرمز", placeholder: "مثل: كجم، م، قطعة" },
    ],
  },
  brands: {
    table: "product_brands",
    fkColumn: "brand_id",
    title: "الماركات / المصنعين",
    singularTitle: "ماركة",
    description: "إدارة الماركات والمصنعين المرتبطين بالمنتجات.",
    icon: Factory,
    extraFields: [
      { key: "country", label: "بلد المنشأ", placeholder: "مثل: مصر، الصين" },
    ],
  },
};

export default function LookupManagement() {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const config = configs[type || ""];

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [formName, setFormName] = useState("");
  const [formExtras, setFormExtras] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleteProductCount, setDeleteProductCount] = useState<number | null>(
    null,
  );
  const [statusFilter, setStatusFilter] = useState("all");
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (config) fetchItems();
  }, [type]);

  useEffect(() => {
    if (deleteTarget && config) {
      (async () => {
        const { count } = await (supabase.from("products") as any)
          .select("id", { count: "exact", head: true })
          .eq(config.fkColumn, deleteTarget.id);
        setDeleteProductCount(count ?? 0);
      })();
    } else {
      setDeleteProductCount(null);
    }
  }, [deleteTarget]);

  const filteredItems = useMemo(() => {
    if (statusFilter === "all") return items;
    return items.filter((i) =>
      statusFilter === "active" ? i.is_active : !i.is_active,
    );
  }, [items, statusFilter]);

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((i) => i.is_active).length;
    const inactive = items.filter((i) => !i.is_active).length;
    return { total, active, inactive };
  }, [items]);

  if (!config)
    return (
      <div className="p-12 text-center text-muted-foreground" dir="rtl">
        صفحة غير موجودة
      </div>
    );

  const PageIcon = config.icon;

  async function fetchItems() {
    setLoading(true);
    const { data } = await (supabase.from(config.table as any) as any)
      .select("*")
      .order("name");
    setItems(data || []);
    setLoading(false);
  }

  function openAdd() {
    setEditItem(null);
    setFormName("");
    setFormExtras({});
    setDialogOpen(true);
  }

  function openEdit(item: any) {
    setEditItem(item);
    setFormName(item.name);
    const extras: Record<string, string> = {};
    config.extraFields?.forEach((f) => {
      extras[f.key] = item[f.key] || "";
    });
    setFormExtras(extras);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!formName.trim()) {
      notify.error("تنبيه", "يرجى إدخال الاسم");
      return;
    }
    const duplicate = items.find(
      (item) =>
        item.name.trim().toLowerCase() === formName.trim().toLowerCase() &&
        (!editItem || item.id !== editItem.id),
    );
    if (duplicate) {
      notify.error("تنبيه", `يوجد ${config.singularTitle} بنفس الاسم: "${duplicate.name}"`);
      return;
    }
    setSaving(true);
    const payload: any = { name: formName.trim() };
    config.extraFields?.forEach((f) => {
      payload[f.key] = formExtras[f.key]?.trim() || null;
    });

    try {
      if (editItem) {
        const { error } = await (supabase.from(config.table as any) as any)
          .update(payload)
          .eq("id", editItem.id);
        if (error) throw error;
        notify.success("تم التحديث", `تم تعديل ${config.singularTitle} بنجاح`);
      } else {
        const { error } = await (
          supabase.from(config.table as any) as any
        ).insert(payload);
        if (error) throw error;
        notify.success("تمت الإضافة", `تم إضافة ${config.singularTitle} بنجاح`);
      }
      setDialogOpen(false);
      fetchItems();
    } catch (error: any) {
      const msg = error.message?.includes("duplicate")
        ? "الاسم موجود مسبقاً"
        : error.message;
      notify.error("خطأ", msg);
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const { count } = await (supabase.from("products") as any)
        .select("id", { count: "exact", head: true })
        .eq(config.fkColumn, deleteTarget.id);
      if (count && count > 0) {
        notify.error("لا يمكن الحذف", `هذا ${config.singularTitle} مرتبط بـ ${count} منتج. قم بتعطيله بدلاً من حذفه.`);
        setDeleteDialogOpen(false);
        return;
      }
      const { error } = await (supabase.from(config.table as any) as any)
        .delete()
        .eq("id", deleteTarget.id);
      if (error) throw error;
      notify.success("تم الحذف", `تم حذف ${config.singularTitle} نهائياً`);
      setDeleteDialogOpen(false);
      fetchItems();
    } catch (error: any) {
      notify.error("خطأ", error.message);
    }
  }

  async function toggleActive(item: any) {
    const { error } = await (supabase.from(config.table as any) as any)
      .update({ is_active: !item.is_active })
      .eq("id", item.id);
    if (error) {
      notify.error("خطأ", "فشل في تغيير الحالة");
      return;
    }
    fetchItems();
  }

  const hasFilters = statusFilter !== "all";
  const clearFilters = () => setStatusFilter("all");

  const statCards = [
    {
      label: `إجمالي ${config.title}`,
      value: stats.total,
      icon: PageIcon,
      iconBg: "bg-blue-100 dark:bg-blue-500/20",
      iconColor: "text-blue-600 dark:text-blue-400",
    },
    {
      label: "نشط",
      value: stats.active,
      icon: CheckCircle2,
      iconBg: "bg-green-100 dark:bg-green-500/20",
      iconColor: "text-green-600 dark:text-green-400",
    },
    {
      label: "معطل",
      value: stats.inactive,
      icon: XCircle,
      iconBg: "bg-red-100 dark:bg-red-500/20",
      iconColor: "text-red-600 dark:text-red-400",
    },
  ];

  const columns: ColumnDef<any, any>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="الاسم" />
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center border border-border">
            <PageIcon className="h-4 w-4 text-muted-foreground" />
          </div>
          <span className="font-bold text-sm text-foreground">
            {row.original.name}
          </span>
        </div>
      ),
    },
    ...((config.extraFields?.map((f) => ({
      accessorKey: f.key,
      header: f.label,
      cell: ({ row }: any) => (
        <span className="text-sm text-muted-foreground">
          {row.original[f.key] || "—"}
        </span>
      ),
    })) || []) as ColumnDef<any, any>[]),
    {
      id: "status",
      header: "الحالة",
      cell: ({ row }) => (
        <div onClick={(e) => e.stopPropagation()}>
          {row.original.is_active ? (
            <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400">
              نشط
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-destructive/10 text-destructive">
              معطل
            </span>
          )}
        </div>
      ),
    },
    {
      id: "toggle",
      header: "تفعيل",
      cell: ({ row }) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={row.original.is_active}
            onCheckedChange={() => toggleActive(row.original)}
          />
        </div>
      ),
    },
    {
      id: "actions",
      header: "الإجراءات",
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="تعديل العنصر"
            className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/5"
            onClick={() => openEdit(row.original)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="حذف العنصر"
            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/5"
            onClick={() => {
              setDeleteTarget(row.original);
              setDeleteDialogOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={PageIcon}
        title={config.title}
        description={config.description}
        actions={
          <>
            <Button
              variant="outline"
              className="gap-2 shadow-sm"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="h-4 w-4" />
              استيراد Excel
            </Button>
            <ExportMenu
              config={{
                filenamePrefix: config.title,
                sheetName: config.title,
                pdfTitle: config.title,
                headers: [
                  "الاسم",
                  ...((config.extraFields?.map((f) => f.label)) || []),
                  "الحالة",
                ],
                rows: items.map((i) => [
                  i.name,
                  ...((config.extraFields?.map((f) => i[f.key] || "")) || []),
                  i.is_active ? "نشط" : "معطل",
                ]),
                settings,
              }}
              disabled={loading}
            />
            <Button
              onClick={openAdd}
              className="gap-2 shadow-md shadow-primary/20 font-bold"
            >
              <Plus className="h-4 w-4" />
              إضافة {config.singularTitle}
            </Button>
          </>
        }
      />

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {statCards.map(({ label, value, icon: Icon, iconBg, iconColor }) => (
          <div
            key={label}
            className="bg-card p-4 rounded-xl border border-border shadow-sm flex items-center gap-4"
          >
            <div className={`p-3 rounded-full ${iconBg}`}>
              <Icon className={`h-5 w-5 ${iconColor}`} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xl font-black text-foreground">
                {value.toLocaleString("en-US")}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={filteredItems}
        searchPlaceholder={`بحث في ${config.title}...`}
        isLoading={loading}
        emptyMessage="لا توجد بيانات"
        toolbarContent={
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40 bg-card border-border">
                <SelectValue placeholder="الحالة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل ({items.length})</SelectItem>
                <SelectItem value="active">نشط ({stats.active})</SelectItem>
                <SelectItem value="inactive">
                  معطل ({stats.inactive})
                </SelectItem>
              </SelectContent>
            </Select>
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
          </div>
        }
      />

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editItem
                ? `تعديل ${config.singularTitle}`
                : `إضافة ${config.singularTitle}`}
            </DialogTitle>
            <DialogDescription>أدخل البيانات ثم اضغط حفظ</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>الاسم *</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="الاسم"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>
            {config.extraFields?.map((f) => (
              <div key={f.key} className="space-y-2">
                <Label>{f.label}</Label>
                <Input
                  value={formExtras[f.key] || ""}
                  onChange={(e) =>
                    setFormExtras((prev) => ({
                      ...prev,
                      [f.key]: e.target.value,
                    }))
                  }
                  placeholder={f.placeholder}
                />
              </div>
            ))}
          </div>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "جاري الحفظ..." : "حفظ"}
            </Button>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) {
            setDeleteTarget(null);
            setDeleteProductCount(null);
          }
        }}
      >
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تأكيد الحذف النهائي</DialogTitle>
            <DialogDescription>
              سيتم حذف "{deleteTarget?.name}" نهائياً ولا يمكن التراجع.
              {deleteProductCount !== null && deleteProductCount > 0 && (
                <span className="block mt-2 text-destructive font-medium">
                  ⚠ هذا {config.singularTitle} مرتبط بـ {deleteProductCount}{" "}
                  منتج. قم بتعطيله بدلاً من حذفه.
                </span>
              )}
              {deleteProductCount !== null && deleteProductCount === 0 && (
                <span className="block mt-2">
                  لا يوجد منتجات مرتبطة بهذا {config.singularTitle}.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteProductCount === null || deleteProductCount > 0}
            >
              حذف نهائي
            </Button>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              تراجع
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      {(type === "categories" || type === "brands" || type === "units") && (
        <LookupImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          type={type as "categories" | "brands" | "units"}
          onImportComplete={fetchItems}
        />
      )}
    </div>
  );
}
