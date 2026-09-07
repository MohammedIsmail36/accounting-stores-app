import React, { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Textarea } from "@/components/ui/textarea";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  Search,
  Filter,
  ChevronLeft,
  ChevronDown,
  FolderOpen,
  FileText,
  TrendingUp,
  TrendingDown,
  Wallet,
  DollarSign,
  Receipt,
  X,
  Shield,
} from "lucide-react";
import { ExportMenu } from "@/components/ExportMenu";
import { useSettings } from "@/contexts/SettingsContext";

type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

interface Account {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  parent_id: string | null;
  is_parent: boolean;
  description: string | null;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
}

const typeLabels: Record<AccountType, string> = {
  asset: "أصول",
  liability: "خصوم",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  expense: "مصروفات",
};

const typeIcons: Record<AccountType, typeof Wallet> = {
  asset: Wallet,
  liability: Receipt,
  equity: DollarSign,
  revenue: TrendingUp,
  expense: TrendingDown,
};

const typeColors: Record<AccountType, string> = {
  asset: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  liability: "bg-red-500/10 text-red-600 border-red-500/20",
  equity: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  revenue: "bg-green-500/10 text-green-600 border-green-500/20",
  expense: "bg-orange-500/10 text-orange-600 border-orange-500/20",
};

export default function Accounts() {
  const { role } = useAuth();
  const { settings } = useSettings();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<AccountType | "all">("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<AccountType>("asset");
  const [formParentId, setFormParentId] = useState<string>("none");
  const [formDescription, setFormDescription] = useState("");
  const [formIsParent, setFormIsParent] = useState(false);
  const [saving, setSaving] = useState(false);

  const canEdit = role === "admin" || role === "accountant";
  const canDelete = role === "admin";

  const fetchAccounts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("accounts")
      .select("*")
      .eq("is_active", true)
      .order("code");

    if (error) {
      toast({
        title: "خطأ",
        description: "فشل في جلب الحسابات",
        variant: "destructive",
      });
    } else {
      setAccounts(data as Account[]);
      // Expand top-level by default
      const topLevel = new Set(
        (data as Account[]).filter((a) => !a.parent_id).map((a) => a.id),
      );
      setExpandedIds(topLevel);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  // Build tree structure
  const accountTree = useMemo(() => {
    const map = new Map<string | null, Account[]>();
    accounts.forEach((a) => {
      const parentKey = a.parent_id || "root";
      if (!map.has(parentKey)) map.set(parentKey, []);
      map.get(parentKey)!.push(a);
    });
    return map;
  }, [accounts]);

  const parentAccounts = useMemo(
    () => accounts.filter((a) => a.is_parent),
    [accounts],
  );

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: accounts.length,
      asset: 0,
      liability: 0,
      equity: 0,
      revenue: 0,
      expense: 0,
    };
    accounts.forEach((a) => counts[a.account_type]++);
    return counts;
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    if (!searchQuery && typeFilter === "all") return null; // use tree view
    return accounts.filter((a) => {
      const matchesSearch =
        !searchQuery ||
        a.name.includes(searchQuery) ||
        a.code.includes(searchQuery);
      const matchesType = typeFilter === "all" || a.account_type === typeFilter;
      return matchesSearch && matchesType;
    });
  }, [accounts, searchQuery, typeFilter]);

  const openAddDialog = (parentId?: string) => {
    setEditingAccount(null);
    setFormCode("");
    setFormName("");
    setFormType(
      parentId
        ? accounts.find((a) => a.id === parentId)?.account_type || "asset"
        : "asset",
    );
    setFormParentId(parentId || "none");
    setFormDescription("");
    setFormIsParent(false);
    setDialogOpen(true);
  };

  const openEditDialog = (account: Account) => {
    setEditingAccount(account);
    setFormCode(account.code);
    setFormName(account.name);
    setFormType(account.account_type);
    setFormParentId(account.parent_id || "none");
    setFormDescription(account.description || "");
    setFormIsParent(account.is_parent);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formCode.trim() || !formName.trim()) return;
    setSaving(true);

    const payload = {
      code: formCode.trim(),
      name: formName.trim(),
      account_type: formType,
      parent_id: formParentId === "none" ? null : formParentId,
      description: formDescription.trim() || null,
      is_parent: formIsParent,
    };

    if (editingAccount) {
      const { error } = await supabase
        .from("accounts")
        .update(payload)
        .eq("id", editingAccount.id);
      if (error) {
        toast({
          title: "خطأ",
          description: error.message.includes("duplicate")
            ? "رمز الحساب مستخدم بالفعل"
            : "فشل في تحديث الحساب",
          variant: "destructive",
        });
      } else {
        toast({ title: "تم التحديث", description: "تم تعديل الحساب بنجاح" });
        setDialogOpen(false);
        fetchAccounts();
      }
    } else {
      const { error } = await supabase.from("accounts").insert(payload);
      if (error) {
        toast({
          title: "خطأ",
          description: error.message.includes("duplicate")
            ? "رمز الحساب مستخدم بالفعل"
            : "فشل في إضافة الحساب",
          variant: "destructive",
        });
      } else {
        toast({ title: "تمت الإضافة", description: "تم إضافة الحساب بنجاح" });
        setDialogOpen(false);
        fetchAccounts();
      }
    }
    setSaving(false);
  };

  const handleDelete = async (account: Account) => {
    if (account.is_system) {
      toast({
        title: "تنبيه",
        description: "هذا حساب نظام أساسي ولا يمكن حذفه",
        variant: "destructive",
      });
      return;
    }
    const children = accountTree.get(account.id);
    if (children && children.length > 0) {
      // Check if any child has journal entries
      const childIds = children.map((c) => c.id);
      const { count: childEntriesCount } = await supabase
        .from("journal_entry_lines")
        .select("id", { count: "exact", head: true })
        .in("account_id", childIds);
      if (childEntriesCount && childEntriesCount > 0) {
        toast({
          title: "تنبيه",
          description:
            "لا يمكن حذف حساب رئيسي مرتبط بحسابات فرعية لها قيود محاسبية",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "تنبيه",
        description: "لا يمكن حذف حساب يحتوي على حسابات فرعية",
        variant: "destructive",
      });
      return;
    }

    // Check if this account has journal entries
    const { count: entriesCount } = await supabase
      .from("journal_entry_lines")
      .select("id", { count: "exact", head: true })
      .eq("account_id", account.id);
    if (entriesCount && entriesCount > 0) {
      toast({
        title: "تنبيه",
        description: `لا يمكن حذف الحساب "${account.name}" لأنه مرتبط بقيود محاسبية (${entriesCount} قيد). يمكنك تعطيله بدلاً من ذلك.`,
        variant: "destructive",
      });
      return;
    }

    const { error } = await supabase
      .from("accounts")
      .delete()
      .eq("id", account.id);
    if (error) {
      toast({
        title: "خطأ",
        description: "فشل في حذف الحساب",
        variant: "destructive",
      });
    } else {
      toast({ title: "تم الحذف", description: "تم حذف الحساب بنجاح" });
      fetchAccounts();
    }
  };

  const exportData = useMemo(
    () => ({
      filenamePrefix: "شجرة-الحسابات",
      sheetName: "الحسابات",
      pdfTitle: "شجرة الحسابات",
      headers: ["الرمز", "الاسم", "النوع", "حساب رئيسي", "الوصف"],
      rows: (filteredAccounts || accounts).map((a) => [
        a.code,
        a.name,
        typeLabels[a.account_type],
        a.is_parent ? "نعم" : "لا",
        a.description || "",
      ]),
      settings,
    }),
    [filteredAccounts, accounts, settings],
  );

  const renderTreeRow = (
    account: Account,
    depth: number = 0,
  ): React.ReactNode => {
    const children = accountTree.get(account.id) || [];
    const isExpanded = expandedIds.has(account.id);
    const hasChildren = children.length > 0;
    const TypeIcon = typeIcons[account.account_type];

    return (
      <React.Fragment key={account.id}>
        <TableRow className="group hover:bg-muted/30 transition-colors">
          <TableCell>
            <div
              className="flex items-center gap-2"
              style={{ paddingRight: `${depth * 24}px` }}
            >
              {hasChildren || account.is_parent ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  aria-label={
                    isExpanded ? "طي الحسابات الفرعية" : "عرض الحسابات الفرعية"
                  }
                  onClick={() => toggleExpand(account.id)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronLeft className="h-4 w-4" />
                  )}
                </Button>
              ) : (
                <span className="w-6 shrink-0" />
              )}
              {account.is_parent ? (
                <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className="font-mono text-sm text-muted-foreground">
                {account.code}
              </span>
            </div>
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-2">
              <span
                className={`font-medium ${account.is_parent ? "text-foreground" : "text-foreground/80"}`}
              >
                {account.name}
              </span>
              {account.is_system && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 h-5 border-primary/30 text-primary gap-1"
                >
                  <Shield className="h-3 w-3" />
                  نظام
                </Badge>
              )}
            </div>
          </TableCell>
          <TableCell>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${typeColors[account.account_type]}`}
            >
              <TypeIcon className="h-3 w-3" />
              {typeLabels[account.account_type]}
            </span>
          </TableCell>
          <TableCell className="text-muted-foreground text-sm">
            {account.description || "—"}
          </TableCell>
          <TableCell className="text-center">
            <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="تعديل الحساب"
                  className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                  onClick={() => openEditDialog(account)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {canEdit && account.is_parent && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="إضافة حساب فرعي"
                  className="h-8 w-8 text-muted-foreground hover:text-green-600 hover:bg-green-500/10"
                  onClick={() => openAddDialog(account.id)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
              {canDelete && !hasChildren && !account.is_system && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="حذف الحساب"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent dir="rtl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
                      <AlertDialogDescription>
                        هل أنت متأكد من حذف الحساب "{account.name}" (
                        {account.code})؟
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-row-reverse gap-2">
                      <AlertDialogAction
                        onClick={() => handleDelete(account)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        حذف
                      </AlertDialogAction>
                      <AlertDialogCancel>إلغاء</AlertDialogCancel>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </TableCell>
        </TableRow>
        {isExpanded && children.map((child) => renderTreeRow(child, depth + 1))}
      </React.Fragment>
    );
  };

  const rootAccounts = accountTree.get("root") || [];

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={BookOpen}
        title="شجرة الحسابات"
        description={`${accounts.length} حساب في الدليل`}
        actions={
          canEdit ? (
            <Button className="gap-2" onClick={() => openAddDialog()}>
              <Plus className="h-4 w-4" />
              إضافة حساب
            </Button>
          ) : undefined
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          {
            key: "all" as const,
            label: "الكل",
            icon: BookOpen,
            color: "bg-foreground/5 text-foreground",
          },
          {
            key: "asset" as const,
            label: "أصول",
            icon: Wallet,
            color: "bg-blue-500/10 text-blue-600",
          },
          {
            key: "liability" as const,
            label: "خصوم",
            icon: Receipt,
            color: "bg-red-500/10 text-red-600",
          },
          {
            key: "equity" as const,
            label: "حقوق ملكية",
            icon: DollarSign,
            color: "bg-purple-500/10 text-purple-600",
          },
          {
            key: "revenue" as const,
            label: "إيرادات",
            icon: TrendingUp,
            color: "bg-green-500/10 text-green-600",
          },
          {
            key: "expense" as const,
            label: "مصروفات",
            icon: TrendingDown,
            color: "bg-orange-500/10 text-orange-600",
          },
        ].map(({ key, label, icon: Icon, color }) => (
          <button
            key={key}
            onClick={() => setTypeFilter(key === "all" ? "all" : key)}
            className={`rounded-xl border p-3 text-right transition-all hover:shadow-md ${
              typeFilter === key
                ? "ring-2 ring-primary border-primary"
                : "border-border"
            } bg-card`}
          >
            <div className="flex items-center justify-between mb-1">
              <div
                className={`h-7 w-7 rounded-lg flex items-center justify-center ${color}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>
              <span className="text-xl font-bold text-foreground">
                {typeCounts[key]}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{label}</p>
          </button>
        ))}
      </div>

      {/* Search & Filters Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="البحث بالرمز أو الاسم..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-9 h-9 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="مسح البحث"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as AccountType | "all")}
        >
          <SelectTrigger className="w-40 h-9 text-sm">
            <SelectValue placeholder="تصفية بالنوع" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">جميع الأنواع</SelectItem>
            <SelectItem value="asset">أصول ({typeCounts.asset})</SelectItem>
            <SelectItem value="liability">
              خصوم ({typeCounts.liability})
            </SelectItem>
            <SelectItem value="equity">
              حقوق ملكية ({typeCounts.equity})
            </SelectItem>
            <SelectItem value="revenue">
              إيرادات ({typeCounts.revenue})
            </SelectItem>
            <SelectItem value="expense">
              مصروفات ({typeCounts.expense})
            </SelectItem>
          </SelectContent>
        </Select>
        {(searchQuery || typeFilter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchQuery("");
              setTypeFilter("all");
            }}
            className="h-9 gap-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            مسح الفلاتر
          </Button>
        )}
        <div className="mr-auto">
          <ExportMenu config={exportData} disabled={loading} />
        </div>
      </div>

      {/* Accounts Table */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/30 py-4">
          <CardTitle className="text-base font-semibold flex items-center justify-between">
            <span>دليل الحسابات</span>
            <Badge variant="secondary" className="font-normal">
              {filteredAccounts ? filteredAccounts.length : accounts.length}{" "}
              حساب
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : (filteredAccounts
              ? filteredAccounts.length
              : rootAccounts.length) === 0 ? (
            <div className="text-center py-12 space-y-2">
              <BookOpen className="h-10 w-10 text-muted-foreground/40 mx-auto" />
              <p className="text-muted-foreground">لا توجد حسابات مطابقة</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableHead className="text-right font-semibold w-48">
                      الرمز
                    </TableHead>
                    <TableHead className="text-right font-semibold">
                      اسم الحساب
                    </TableHead>
                    <TableHead className="text-right font-semibold w-32">
                      النوع
                    </TableHead>
                    <TableHead className="text-right font-semibold">
                      الوصف
                    </TableHead>
                    <TableHead className="text-center font-semibold w-32">
                      إجراءات
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAccounts
                    ? filteredAccounts.map((a) => {
                        const TypeIcon = typeIcons[a.account_type];
                        return (
                          <TableRow
                            key={a.id}
                            className="group hover:bg-muted/30 transition-colors"
                          >
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {a.is_parent ? (
                                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <FileText className="h-4 w-4 text-muted-foreground" />
                                )}
                                <span className="font-mono text-sm text-muted-foreground">
                                  {a.code}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="font-medium">
                              {a.name}
                            </TableCell>
                            <TableCell>
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${typeColors[a.account_type]}`}
                              >
                                <TypeIcon className="h-3 w-3" />
                                {typeLabels[a.account_type]}
                              </span>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {a.description || "—"}
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {canEdit && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="تعديل الحساب الفرعي"
                                    className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                                    onClick={() => openEditDialog(a)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                )}
                                {canDelete &&
                                  !accountTree.get(a.id)?.length && (
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          aria-label="حذف الحساب الفرعي"
                                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent dir="rtl">
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>
                                            تأكيد الحذف
                                          </AlertDialogTitle>
                                          <AlertDialogDescription>
                                            هل أنت متأكد من حذف "{a.name}" (
                                            {a.code})؟
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter className="flex-row-reverse gap-2">
                                          <AlertDialogAction
                                            onClick={() => handleDelete(a)}
                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                          >
                                            حذف
                                          </AlertDialogAction>
                                          <AlertDialogCancel>
                                            إلغاء
                                          </AlertDialogCancel>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    : rootAccounts.map((a) => renderTreeRow(a, 0))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingAccount ? "تعديل الحساب" : "إضافة حساب جديد"}
            </DialogTitle>
            <DialogDescription>
              {editingAccount
                ? "قم بتعديل بيانات الحساب"
                : "أدخل بيانات الحساب الجديد"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="formCode">رمز الحساب</Label>
                <Input
                  id="formCode"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value)}
                  placeholder="مثال: 1101"
                  required
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="formName">اسم الحساب</Label>
                <Input
                  id="formName"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="أدخل اسم الحساب"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>نوع الحساب</Label>
                <Select
                  value={formType}
                  onValueChange={(v) => setFormType(v as AccountType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asset">أصول</SelectItem>
                    <SelectItem value="liability">خصوم</SelectItem>
                    <SelectItem value="equity">حقوق ملكية</SelectItem>
                    <SelectItem value="revenue">إيرادات</SelectItem>
                    <SelectItem value="expense">مصروفات</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>الحساب الرئيسي</Label>
                <Select value={formParentId} onValueChange={setFormParentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="بدون (حساب رئيسي)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون (حساب رئيسي)</SelectItem>
                    {parentAccounts
                      .filter(
                        (a) => !editingAccount || a.id !== editingAccount.id,
                      )
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.code} - {a.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="formIsParent"
                checked={formIsParent}
                onChange={(e) => setFormIsParent(e.target.checked)}
                className="rounded border-border"
              />
              <Label htmlFor="formIsParent" className="cursor-pointer">
                حساب رئيسي (يحتوي على حسابات فرعية)
              </Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="formDescription">الوصف (اختياري)</Label>
              <Textarea
                id="formDescription"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="وصف مختصر للحساب"
                rows={2}
              />
            </div>
            <DialogFooter className="flex-row-reverse gap-2 pt-2">
              <Button
                onClick={handleSave}
                disabled={saving || !formCode.trim() || !formName.trim()}
                className="gap-2"
              >
                {saving
                  ? "جارٍ الحفظ..."
                  : editingAccount
                    ? "حفظ التعديل"
                    : "إضافة الحساب"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
