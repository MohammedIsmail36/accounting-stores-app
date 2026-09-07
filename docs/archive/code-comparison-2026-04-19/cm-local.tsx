import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  FolderTree,
  Folder,
  FolderOpen,
  Upload,
  Tag,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LookupImportDialog } from "@/components/LookupImportDialog";
import { ExportMenu } from "@/components/ExportMenu";
import { useSettings } from "@/contexts/SettingsContext";
import {
  buildCategoryTree,
  countDescendants,
  getFullPath,
  wouldCreateCycle,
  type CategoryNode,
} from "@/lib/category-utils";

interface Category {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  is_active: boolean;
  created_at: string;
}

type TreeNode = Category & {
  children: TreeNode[];
};

function CategoryTreeNode({
  node,
  level,
  allItems,
  onEdit,
  onDelete,
  onAddChild,
  onToggleActive,
}: {
  node: TreeNode;
  level: number;
  allItems: Category[];
  onEdit: (item: Category) => void;
  onDelete: (item: Category) => void;
  onAddChild: (parentId: string) => void;
  onToggleActive: (item: Category) => void;
}) {
  const [expanded, setExpanded] = useState(level < 1);
  const hasChildren = node.children.length > 0;
  const descendantCount = countDescendants(node);

  return (
    <div className={cn(level > 0 && "mr-4 border-r border-border/40")}>
      <div
        className={cn(
          "group flex items-center gap-3 py-2.5 px-3 rounded-md transition-all",
          "hover:bg-accent/50",
          !node.is_active && "opacity-40",
        )}
      >
        <button
          onClick={() => hasChildren && setExpanded(!expanded)}
          className={cn(
            "flex items-center justify-center w-5 h-5 rounded-sm shrink-0",
            hasChildren
              ? "text-muted-foreground hover:text-foreground cursor-pointer"
              : "text-transparent",
          )}
        >
          {hasChildren &&
            (expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            ))}
        </button>

        {hasChildren && expanded ? (
          <FolderOpen className="h-4 w-4 text-primary shrink-0" />
        ) : (
          <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground">
            {node.name}
          </span>
          {node.description && (
            <span className="text-xs text-muted-foreground mr-2 hidden sm:inline">
              {" "}
              — {node.description}
            </span>
          )}
        </div>

        {hasChildren && (
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 h-5 font-normal"
          >
            {descendantCount}
          </Badge>
        )}

        <div onClick={(e) => e.stopPropagation()}>
          {node.is_active ? (
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400">
              نشط
            </span>
          ) : (
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-destructive/10 text-destructive">
              معطل
            </span>
          )}
        </div>

        <Switch
          checked={node.is_active}
          onCheckedChange={() => onToggleActive(node)}
          className="scale-75"
          onClick={(e) => e.stopPropagation()}
        />

        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/5"
            onClick={() => onAddChild(node.id)}
            aria-label="إضافة فئة فرعية"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/5"
            aria-label="تعديل الفئة"
            onClick={() => onEdit(node)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/5"
            aria-label="حذف الفئة"
            onClick={() => onDelete(node)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {expanded && hasChildren && (
        <div className="mr-2">
          {node.children.map((child) => (
            <CategoryTreeNode
              key={child.id}
              node={child}
              level={level + 1}
              allItems={allItems}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
              onToggleActive={onToggleActive}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CategoryManagement() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<Category | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const { settings } = useSettings();

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase.from("product_categories") as any)
      .select("*")
      .order("name");
    setItems(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const tree = buildCategoryTree(items) as TreeNode[];

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((i) => i.is_active).length;
    const inactive = items.filter((i) => !i.is_active).length;
    const roots = items.filter((i) => !i.parent_id).length;
    return { total, active, inactive, roots };
  }, [items]);

  function openAdd(pId: string | null = null) {
    setEditItem(null);
    setParentId(pId);
    setFormName("");
    setFormDesc("");
    setDialogOpen(true);
  }

  function openEdit(item: Category) {
    setEditItem(item);
    setParentId(item.parent_id);
    setFormName(item.name);
    setFormDesc(item.description || "");
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!formName.trim()) {
      toast({
        title: "تنبيه",
        description: "يرجى إدخال الاسم",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    const payload: any = {
      name: formName.trim(),
      description: formDesc.trim() || null,
      parent_id: parentId || null,
    };
    try {
      if (editItem) {
        if (parentId === editItem.id) {
          toast({
            title: "خطأ",
            description: "لا يمكن تعيين التصنيف كأب لنفسه",
            variant: "destructive",
          });
          setSaving(false);
          return;
        }
        if (wouldCreateCycle(editItem.id, parentId, items)) {
          toast({
            title: "خطأ",
            description:
              "لا يمكن تعيين هذا التصنيف الأب لأنه سيؤدي إلى حلقة دائرية",
            variant: "destructive",
          });
          setSaving(false);
          return;
        }
        const { error } = await (supabase.from("product_categories") as any)
          .update(payload)
          .eq("id", editItem.id);
        if (error) throw error;
        toast({ title: "تم التحديث" });
      } else {
        const { error } = await (
          supabase.from("product_categories") as any
        ).insert(payload);
        if (error) throw error;
        toast({ title: "تمت الإضافة" });
      }
      setDialogOpen(false);
      fetchItems();
    } catch (error: any) {
      const msg = error.message?.includes("duplicate")
        ? "الاسم موجود مسبقاً"
        : error.message;
      toast({ title: "خطأ", description: msg, variant: "destructive" });
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const childCount = items.filter(
        (i) => i.parent_id === deleteTarget.id,
      ).length;
      if (childCount > 0) {
        toast({
          title: "لا يمكن الحذف",
          description: `يحتوي على ${childCount} تصنيف فرعي. احذفها أولاً.`,
          variant: "destructive",
        });
        setDeleteDialogOpen(false);
        return;
      }
      const { count } = await (supabase.from("products") as any)
        .select("id", { count: "exact", head: true })
        .eq("category_id", deleteTarget.id);
      if (count && count > 0) {
        toast({
          title: "لا يمكن الحذف",
          description: `مرتبط بـ ${count} منتج. قم بتعطيله بدلاً من حذفه.`,
          variant: "destructive",
        });
        setDeleteDialogOpen(false);
        return;
      }
      const { error } = await (supabase.from("product_categories") as any)
        .delete()
        .eq("id", deleteTarget.id);
      if (error) throw error;
      toast({ title: "تم الحذف" });
      setDeleteDialogOpen(false);
      fetchItems();
    } catch (error: any) {
      toast({
        title: "خطأ",
        description: error.message,
        variant: "destructive",
      });
    }
  }

  async function toggleActive(item: Category) {
    const { error } = await (supabase.from("product_categories") as any)
      .update({ is_active: !item.is_active })
      .eq("id", item.id);
    if (error) {
      toast({
        title: "خطأ",
        description: "فشل في تغيير حالة التصنيف",
        variant: "destructive",
      });
      return;
    }
    fetchItems();
  }

  const parentOptions = items.filter((i) =>
    editItem ? i.id !== editItem.id : true,
  );

  const statCards = [
    {
      label: "إجمالي التصنيفات",
      value: stats.total,
      icon: Tag,
      iconBg: "bg-blue-100 dark:bg-blue-500/20",
      iconColor: "text-blue-600 dark:text-blue-400",
    },
    {
      label: "تصنيفات نشطة",
      value: stats.active,
      icon: CheckCircle2,
      iconBg: "bg-green-100 dark:bg-green-500/20",
      iconColor: "text-green-600 dark:text-green-400",
    },
    {
      label: "تصنيفات معطلة",
      value: stats.inactive,
      icon: XCircle,
      iconBg: "bg-red-100 dark:bg-red-500/20",
      iconColor: "text-red-600 dark:text-red-400",
    },
    {
      label: "تصنيفات رئيسية",
      value: stats.roots,
      icon: FolderTree,
      iconBg: "bg-purple-100 dark:bg-purple-500/20",
      iconColor: "text-purple-600 dark:text-purple-400",
    },
  ];

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={Tag}
        title="إدارة التصنيفات"
        description="تنظيم المنتجات في تصنيفات هرمية متعددة المستويات."
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
                filenamePrefix: "التصنيفات",
                sheetName: "التصنيفات",
                pdfTitle: "قائمة التصنيفات",
                headers: ["الاسم", "الوصف", "التصنيف الأب", "الحالة"],
                rows: items.map((i) => [
                  i.name,
                  i.description || "",
                  i.parent_id ? getFullPath(items, i.parent_id) : "رئيسي",
                  i.is_active ? "نشط" : "معطل",
                ]),
                settings,
              }}
              disabled={loading}
            />
            <Button
              onClick={() => openAdd(null)}
              className="gap-2 shadow-md shadow-primary/20 font-bold"
            >
              <Plus className="h-4 w-4" />
              تصنيف جديد
            </Button>
          </>
        }
      />

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
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

      {/* Tree View */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
            <FolderTree className="h-10 w-10 opacity-30" />
            <p className="text-sm">لا توجد تصنيفات بعد</p>
            <Button variant="outline" size="sm" onClick={() => openAdd(null)}>
              <Plus className="h-4 w-4 ml-1" />
              أضف أول تصنيف
            </Button>
          </div>
        ) : (
          <div className="p-3">
            {tree.map((node) => (
              <CategoryTreeNode
                key={node.id}
                node={node}
                level={0}
                allItems={items}
                onEdit={openEdit}
                onDelete={(item) => {
                  setDeleteTarget(item);
                  setDeleteDialogOpen(true);
                }}
                onAddChild={(pid) => openAdd(pid)}
                onToggleActive={toggleActive}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editItem ? "تعديل تصنيف" : "إضافة تصنيف"}
            </DialogTitle>
            <DialogDescription>
              {parentId
                ? `فرعي من: ${getFullPath(items, parentId)}`
                : "تصنيف رئيسي"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">الاسم *</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="اسم التصنيف"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">الوصف</Label>
              <Input
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="اختياري"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">التصنيف الأب</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={parentId || ""}
                onChange={(e) => setParentId(e.target.value || null)}
              >
                <option value="">بدون (رئيسي)</option>
                {parentOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {getFullPath(items, p.id)}
                  </option>
                ))}
              </select>
            </div>
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

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف التصنيف</DialogTitle>
            <DialogDescription>
              سيتم حذف "{deleteTarget?.name}" نهائياً.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button variant="destructive" onClick={handleDelete}>
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

      <LookupImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        type="categories"
        onImportComplete={fetchItems}
      />
    </div>
  );
}
