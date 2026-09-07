import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Users,
  Trash2,
  UserPlus,
  Download,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Pencil,
  X,
} from "lucide-react";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/constants";
import { notify } from "@/lib/notify";

type AppRole = "admin" | "accountant" | "sales";

interface UserWithRole {
  user_id: string;
  full_name: string;
  role: AppRole;
  created_at: string;
}

const roleIcons: Record<AppRole, typeof Shield> = {
  admin: ShieldAlert,
  accountant: ShieldCheck,
  sales: Shield,
};

export default function UserManagement() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState<AppRole | "all">("all");

  // Add user dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("sales");
  const [addLoading, setAddLoading] = useState(false);

  // Edit name dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editUserId, setEditUserId] = useState("");
  const [editFullName, setEditFullName] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    const { data: roles, error: rolesError } = await supabase
      .from("user_roles")
      .select("user_id, role, created_at");

    if (rolesError) {
      notify.error("خطأ", "فشل في جلب بيانات المستخدمين");
      setLoading(false);
      return;
    }

    const userIds = roles.map((r) => r.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);

    const profileMap = new Map(
      profiles?.map((p) => [p.id, p.full_name || "بدون اسم"]) ?? [],
    );

    setUsers(
      roles.map((r) => ({
        user_id: r.user_id,
        full_name: profileMap.get(r.user_id) || "بدون اسم",
        role: r.role as AppRole,
        created_at: r.created_at,
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    if (roleFilter === "all") return users;
    return users.filter((u) => u.role === roleFilter);
  }, [users, roleFilter]);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: users.length,
      admin: 0,
      accountant: 0,
      sales: 0,
    };
    users.forEach((u) => counts[u.role]++);
    return counts;
  }, [users]);

  const handleRoleChange = async (userId: string, newRole: AppRole) => {
    if (userId === user?.id) {
      notify.error("تنبيه", "لا يمكنك تغيير دورك بنفسك");
      return;
    }
    const { error } = await supabase
      .from("user_roles")
      .update({ role: newRole })
      .eq("user_id", userId);
    if (error) {
      notify.error("خطأ", "فشل في تحديث الدور");
      return;
    }
    notify.success("تم التحديث", "تم تغيير دور المستخدم بنجاح");
    setUsers((prev) =>
      prev.map((u) => (u.user_id === userId ? { ...u, role: newRole } : u)),
    );
  };

  const handleDeleteUser = async (userId: string) => {
    if (userId === user?.id) {
      notify.error("تنبيه", "لا يمكنك حذف حسابك بنفسك");
      return;
    }
    const { error: roleError } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId);
    if (roleError) {
      notify.error("خطأ", "فشل في حذف دور المستخدم");
      return;
    }
    const { error: profileError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", userId);
    if (profileError) {
      console.error("Failed to delete profile:", profileError);
      notify.error("تم حذف الدور", "لكن فشل حذف الملف الشخصي");
    } else {
      notify.success("تم الحذف", "تم حذف المستخدم بنجاح");
    }
    setUsers((prev) => prev.filter((u) => u.user_id !== userId));
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      notify.error("خطأ", "كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    setAddLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("create-user", {
        body: {
          email: newEmail,
          password: newPassword,
          full_name: newFullName,
          role: newRole,
        },
      });
      if (res.error)
        throw new Error(res.error.message || "فشل في إنشاء المستخدم");
      if (res.data?.error) throw new Error(res.data.error);
      notify.success("تم إنشاء الحساب", "تم إنشاء حساب المستخدم وتفعيله بنجاح.");
      setAddDialogOpen(false);
      setNewEmail("");
      setNewPassword("");
      setNewFullName("");
      setNewRole("sales");
      setTimeout(() => fetchUsers(), 1000);
    } catch (error: any) {
      notify.error("خطأ", error.message);
    } finally {
      setAddLoading(false);
    }
  };

  const handleEditName = async () => {
    if (!editFullName.trim()) return;
    setEditLoading(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: editFullName.trim() })
      .eq("id", editUserId);
    if (error) {
      notify.error("خطأ", "فشل في تحديث الاسم");
    } else {
      notify.success("تم التحديث", "تم تغيير اسم المستخدم بنجاح");
      setUsers((prev) =>
        prev.map((u) =>
          u.user_id === editUserId
            ? { ...u, full_name: editFullName.trim() }
            : u,
        ),
      );
      setEditDialogOpen(false);
    }
    setEditLoading(false);
  };

  const handleExport = () => {
    const headers = ["الاسم", "الدور", "تاريخ الإنشاء"];
    const rows = filteredUsers.map((u) => [
      u.full_name,
      ROLE_LABELS[u.role],
      new Date(u.created_at).toLocaleDateString("en-GB"),
    ]);
    const csvContent =
      "\uFEFF" + [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "المستخدمين.csv";
    link.click();
    URL.revokeObjectURL(url);
    notify.success("تم التصدير", "تم تصدير قائمة المستخدمين بنجاح");
  };

  const columns: ColumnDef<UserWithRole, any>[] = [
    {
      accessorKey: "full_name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="المستخدم" />
      ),
      cell: ({ row }) => {
        const u = row.original;
        return (
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
              {u.full_name.charAt(0)}
            </div>
            <div>
              <p className="font-medium text-foreground">
                {u.full_name}
                {u.user_id === user?.id && (
                  <Badge
                    variant="outline"
                    className="mr-2 text-xs align-middle"
                  >
                    أنت
                  </Badge>
                )}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "role",
      header: "الدور",
      cell: ({ row }) => {
        const u = row.original;
        const RoleIcon = roleIcons[u.role];
        return (
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${ROLE_COLORS[u.role]}`}
          >
            <RoleIcon className="h-3 w-3" />
            {ROLE_LABELS[u.role]}
          </span>
        );
      },
      filterFn: (row, id, value) =>
        value === "all" || row.getValue(id) === value,
    },
    {
      id: "change_role",
      header: "تغيير الدور",
      cell: ({ row }) => {
        const u = row.original;
        return (
          <Select
            value={u.role}
            onValueChange={(val) => handleRoleChange(u.user_id, val as AppRole)}
            disabled={u.user_id === user?.id}
          >
            <SelectTrigger className="w-36 h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">مدير</SelectItem>
              <SelectItem value="accountant">محاسب</SelectItem>
              <SelectItem value="sales">موظف مبيعات</SelectItem>
            </SelectContent>
          </Select>
        );
      },
    },
    {
      accessorKey: "created_at",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="تاريخ الانضمام" />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {new Date(row.original.created_at).toLocaleDateString("en-GB")}
        </span>
      ),
    },
    {
      id: "actions",
      header: "إجراءات",
      cell: ({ row }) => {
        const u = row.original;
        return (
          <div className="flex items-center justify-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
              onClick={(e) => {
                e.stopPropagation();
                setEditUserId(u.user_id);
                setEditFullName(u.full_name);
                setEditDialogOpen(true);
              }}
              aria-label="تعديل المستخدم"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            {u.user_id !== user?.id && (
              <ConfirmDialog
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="حذف المستخدم"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                }
                title="تأكيد الحذف"
                description={`هل أنت متأكد من حذف المستخدم "${u.full_name}"؟ لا يمكن التراجع عن هذا الإجراء.`}
                confirmText="حذف"
                destructive
                onConfirm={() => handleDeleteUser(u.user_id)}
              />

            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={Users}
        title="إدارة المستخدمين"
        description={`${users.length} مستخدم مسجّل`}
        actions={
          <Button className="gap-2" onClick={() => setAddDialogOpen(true)}>
            <UserPlus className="h-4 w-4" />
            إضافة مستخدم
          </Button>
        }
      />
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogContent dir="rtl" className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>إضافة مستخدم جديد</DialogTitle>
              <DialogDescription>
                أدخل بيانات المستخدم الجديد لإنشاء حساب له
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAddUser} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newFullName">الاسم الكامل</Label>
                <Input
                  id="newFullName"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  placeholder="أدخل الاسم الكامل"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newEmail">البريد الإلكتروني</Label>
                <Input
                  id="newEmail"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="example@mail.com"
                  required
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">كلمة المرور</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="6 أحرف على الأقل"
                  required
                  minLength={6}
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>الدور</Label>
                <Select
                  value={newRole}
                  onValueChange={(v) => setNewRole(v as AppRole)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">مدير</SelectItem>
                    <SelectItem value="accountant">محاسب</SelectItem>
                    <SelectItem value="sales">موظف مبيعات</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter className="flex-row-reverse gap-2 pt-2">
                <Button type="submit" disabled={addLoading} className="gap-2">
                  {addLoading ? "جارٍ الإنشاء..." : "إنشاء الحساب"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            key: "all" as const,
            label: "الكل",
            icon: Users,
            color: "bg-foreground/5 text-foreground",
          },
          {
            key: "admin" as const,
            label: "مدراء",
            icon: ShieldAlert,
            color: "bg-primary/10 text-primary",
          },
          {
            key: "accountant" as const,
            label: "محاسبين",
            icon: ShieldCheck,
            color: "bg-accent text-accent-foreground",
          },
          {
            key: "sales" as const,
            label: "مبيعات",
            icon: Shield,
            color: "bg-muted text-muted-foreground",
          },
        ].map(({ key, label, icon: Icon, color }) => (
          <button
            key={key}
            onClick={() => setRoleFilter(key === "all" ? "all" : key)}
            className={`rounded-xl border p-4 text-right transition-all hover:shadow-md ${
              roleFilter === key
                ? "ring-2 ring-primary border-primary"
                : "border-border"
            } bg-card`}
          >
            <div className="flex items-center justify-between mb-2">
              <div
                className={`h-8 w-8 rounded-lg flex items-center justify-center ${color}`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span className="text-2xl font-bold text-foreground">
                {roleCounts[key]}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{label}</p>
          </button>
        ))}
      </div>

      {/* DataTable */}
      <DataTable
        columns={columns}
        data={filteredUsers}
        searchPlaceholder="البحث بالاسم..."
        isLoading={loading}
        emptyMessage="لا توجد نتائج مطابقة"
        pageSize={10}
        toolbarContent={
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={roleFilter}
              onValueChange={(v) => setRoleFilter(v as AppRole | "all")}
            >
              <SelectTrigger className="w-36 h-9 text-sm">
                <SelectValue placeholder="الدور" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأدوار</SelectItem>
                <SelectItem value="admin">مدير</SelectItem>
                <SelectItem value="accountant">محاسب</SelectItem>
                <SelectItem value="sales">موظف مبيعات</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              className="gap-2 h-9"
            >
              <Download className="h-4 w-4" />
              تصدير
            </Button>
            {roleFilter !== "all" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRoleFilter("all")}
                className="h-9 gap-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
                مسح الفلاتر
              </Button>
            )}
          </div>
        }
      />

      {/* Edit Name Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>تعديل اسم المستخدم</DialogTitle>
            <DialogDescription>أدخل الاسم الجديد للمستخدم</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editFullName">الاسم الكامل</Label>
              <Input
                id="editFullName"
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                placeholder="أدخل الاسم الكامل"
                required
              />
            </div>
            <DialogFooter className="flex-row-reverse gap-2 pt-2">
              <Button
                onClick={handleEditName}
                disabled={editLoading || !editFullName.trim()}
                className="gap-2"
              >
                {editLoading ? "جارٍ الحفظ..." : "حفظ التعديل"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
