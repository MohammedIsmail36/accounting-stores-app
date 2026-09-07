import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { AccountCombobox } from "@/components/AccountCombobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Trash2, Receipt, CheckCircle2, XCircle, Tags } from "lucide-react";
import { notify } from "@/lib/notify";

interface Account {
  id: string;
  code: string;
  name: string;
  account_type: string;
}
interface ExpenseType {
  id: string;
  name: string;
  account_id: string;
  is_active: boolean;
  created_at: string;
  account_name?: string;
  account_code?: string;
}

export default function ExpenseTypes() {
  const [types, setTypes] = useState<ExpenseType[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ExpenseType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseType | null>(null);

  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    setLoading(true);
    const [typesRes, accRes] = await Promise.all([
      supabase
        .from("expense_types" as any)
        .select("*, accounts:account_id(code, name)")
        .order("created_at", { ascending: false }),
      supabase
        .from("accounts")
        .select("id, code, name, account_type")
        .eq("is_active", true)
        .eq("is_parent", false)
        .order("code"),
    ]);
    const mapped = ((typesRes.data as any) || []).map((t: any) => ({
      ...t,
      account_name: t.accounts?.name,
      account_code: t.accounts?.code,
    }));
    setTypes(mapped);
    setAccounts(accRes.data || []);
    setLoading(false);
  }

  function resetForm() {
    setName("");
    setAccountId("");
    setIsActive(true);
    setEditTarget(null);
  }

  function openEdit(t: ExpenseType) {
    setEditTarget(t);
    setName(t.name);
    setAccountId(t.account_id);
    setIsActive(t.is_active);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!name.trim() || !accountId) {
      notify.error("تنبيه", "يرجى إدخال اسم النوع واختيار الحساب");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        account_id: accountId,
        is_active: isActive,
      };
      if (editTarget) {
        const { error } = await (supabase.from("expense_types" as any) as any).update(payload).eq("id", editTarget.id);
        if (error) throw error;
        notify.success("تم التحديث", "تم تحديث نوع المصروف بنجاح");
      } else {
        const { error } = await (supabase.from("expense_types" as any) as any).insert(payload);
        if (error) throw error;
        notify.success("تم الحفظ", "تم إضافة نوع المصروف بنجاح");
      }
      setDialogOpen(false);
      resetForm();
      fetchAll();
    } catch (error: any) {
      notify.error("خطأ", error.message);
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const { count } = await (supabase.from("expenses" as any) as any)
        .select("id", { count: "exact", head: true })
        .eq("expense_type_id", deleteTarget.id);
      if (count && count > 0) {
        notify.error("لا يمكن الحذف", "يوجد مصروفات مرتبطة بهذا النوع");
        setDeleteTarget(null);
        return;
      }
      const { error } = await (supabase.from("expense_types" as any) as any).delete().eq("id", deleteTarget.id);
      if (error) throw error;
      notify.success("تم الحذف", "تم حذف نوع المصروف");
      setDeleteTarget(null);
      fetchAll();
    } catch (error: any) {
      notify.error("خطأ", error.message);
    }
  }

  const activeCount = types.filter((t) => t.is_active).length;

  const statCards = [
    {
      label: "إجمالي الأنواع",
      value: types.length,
      icon: Tags,
      iconBg: "bg-blue-100 dark:bg-blue-500/20",
      iconColor: "text-blue-600 dark:text-blue-400",
    },
    {
      label: "أنواع نشطة",
      value: activeCount,
      icon: CheckCircle2,
      iconBg: "bg-green-100 dark:bg-green-500/20",
      iconColor: "text-green-600 dark:text-green-400",
    },
    {
      label: "أنواع غير نشطة",
      value: types.length - activeCount,
      icon: XCircle,
      iconBg: "bg-red-100 dark:bg-red-500/20",
      iconColor: "text-red-600 dark:text-red-400",
    },
  ];

  const columns: ColumnDef<ExpenseType>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="نوع المصروف" />,
      cell: ({ row }) => <span className="text-sm font-bold text-foreground">{row.original.name}</span>,
    },
    {
      accessorKey: "account_code",
      header: ({ column }) => <DataTableColumnHeader column={column} title="الحساب المرتبط" />,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground font-mono">
          {row.original.account_code} - {row.original.account_name}
        </span>
      ),
    },
    {
      accessorKey: "is_active",
      header: ({ column }) => <DataTableColumnHeader column={column} title="الحالة" />,
      cell: ({ row }) => {
        const active = row.original.is_active;
        return (
          <Badge
            variant="secondary"
            className={active ? "bg-green-500/10 text-green-600 border-green-500/20" : "bg-muted text-muted-foreground"}
          >
            {active ? "نشط" : "غير نشط"}
          </Badge>
        );
      },
    },
    {
      id: "actions",
      header: "إجراءات",
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="تعديل نوع المصروف"
            className="h-8 w-8"
            onClick={() => openEdit(row.original)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="حذف نوع المصروف"
            className="h-8 w-8 text-destructive"
            onClick={() => setDeleteTarget(row.original)}
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
        icon={Receipt}
        title="أنواع المصروفات"
        description="إدارة أنواع المصروفات وربطها بالحسابات"
        actions={
          <Button
            className="gap-2 shadow-md shadow-primary/20 font-bold"
            onClick={() => {
              resetForm();
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            إضافة نوع
          </Button>
        }
      />

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {statCards.map(({ label, value, icon: Icon, iconBg, iconColor }) => (
          <div key={label} className="bg-card p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
            <div className={`p-3 rounded-full ${iconBg}`}>
              <Icon className={`h-5 w-5 ${iconColor}`} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xl font-black text-foreground">{value.toLocaleString("en-US")}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Data Table */}
      <DataTable
        compactRows
        columns={columns}
        data={types}
        searchPlaceholder="بحث بنوع المصروف..."
        isLoading={loading}
        emptyMessage="لا توجد أنواع مصروفات"
      />

      {/* Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editTarget ? "تعديل نوع المصروف" : "إضافة نوع مصروف"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>اسم النوع *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: إيجار"
                className="mt-1"
              />
            </div>
            <div>
              <Label>الحساب المرتبط *</Label>
              <div className="mt-1">
                <AccountCombobox
                  accounts={accounts}
                  value={accountId}
                  onValueChange={setAccountId}
                  placeholder="اختر الحساب..."
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                إذا لم يكن الحساب موجوداً، أنشئه من شجرة الحسابات أولاً
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <Label>نشط</Label>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setDialogOpen(false);
                  resetForm();
                }}
              >
                إلغاء
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "جاري الحفظ..." : "حفظ"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Alert */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف نوع المصروف"
        description={`هل أنت متأكد من حذف "${deleteTarget?.name ?? ""}"؟`}
        confirmText="حذف"
        destructive
        onConfirm={handleDelete}
      />

    </div>
  );
}
