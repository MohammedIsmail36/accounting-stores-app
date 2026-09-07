import React, { useState, useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { createJournalEntry } from "@/lib/journal-writer";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { ColumnDef, PaginationState } from "@tanstack/react-table";
import { Plus, Pencil, Trash2, Truck, X, FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ExportMenu } from "@/components/ExportMenu";
import { useSettings } from "@/contexts/SettingsContext";
import { getNextPostedNumber } from "@/lib/posted-number-utils";
import { generateEntityCode } from "@/lib/code-generation";
import { ACCOUNT_CODES } from "@/lib/constants";
import { round2 } from "@/lib/utils";
import { usePagedQuery, useDebouncedValue } from "@/hooks/use-paged-query";
import { useQueryClient } from "@tanstack/react-query";
import { formatSupabaseError } from "@/lib/format-error";
import { notify } from "@/lib/notify";

interface Supplier {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_number: string | null;
  contact_person: string | null;
  notes: string | null;
  balance: number;
  is_active: boolean;
  created_at: string;
}

const PAGE_SIZE = 20;

export default function Suppliers() {
  const { role } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  });
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [balanceFilter, setBalanceFilter] = useState("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<Supplier | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    phone: "",
    email: "",
    address: "",
    tax_number: "",
    contact_person: "",
    notes: "",
    opening_balance: "",
  });
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);

  const canEdit = role === "admin" || role === "accountant";

  React.useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [debouncedSearch, balanceFilter]);

  const queryKey = [
    "suppliers",
    pagination.pageIndex,
    pagination.pageSize,
    debouncedSearch,
    balanceFilter,
  ] as const;

  const { data: pageData, isLoading } = usePagedQuery<Supplier>(
    queryKey,
    async () => {
      const from = pagination.pageIndex * pagination.pageSize;
      const to = from + pagination.pageSize - 1;
      let q = (supabase.from("suppliers" as any) as any)
        .select("*", { count: "exact" })
        .eq("is_active", true);

      if (debouncedSearch.trim()) {
        const term = `%${debouncedSearch.trim()}%`;
        q = q.or(`name.ilike.${term},code.ilike.${term},phone.ilike.${term}`);
      }
      if (balanceFilter === "has_balance") q = q.gt("balance", 0);
      if (balanceFilter === "no_balance") q = q.lte("balance", 0);

      const { data, error, count } = await q.order("code").range(from, to);
      if (error) throw error;
      return { rows: (data as Supplier[]) || [], totalCount: count || 0 };
    },
  );

  const rows = pageData?.rows ?? [];
  const totalCount = pageData?.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pagination.pageSize));

  const hasFilters = balanceFilter !== "all" || search !== "";
  const clearFilters = () => {
    setBalanceFilter("all");
    setSearch("");
  };

  function refetchAll() {
    queryClient.invalidateQueries({ queryKey: ["suppliers"] });
  }

  async function fetchAllForExport(
    onProgress?: (loaded: number, total: number) => void
  ): Promise<Supplier[]> {
    const { fetchAllPaged } = await import("@/lib/paged-fetch");
    return await fetchAllPaged<Supplier>(
      () => {
        let q = (supabase.from("suppliers" as any) as any)
          .select("*", { count: "exact" })
          .eq("is_active", true);
        if (debouncedSearch.trim()) {
          const term = `%${debouncedSearch.trim()}%`;
          q = q.or(`name.ilike.${term},code.ilike.${term},phone.ilike.${term}`);
        }
        if (balanceFilter === "has_balance") q = q.gt("balance", 0);
        if (balanceFilter === "no_balance") q = q.lte("balance", 0);
        return q.order("code");
      },
      { batchSize: 500, maxRows: 9999, onProgress }
    );
  }

  const [exportRows, setExportRows] = useState<Supplier[] | null>(null);
  React.useEffect(() => {
    setExportRows(null);
  }, [debouncedSearch, balanceFilter]);
  const exportRowsResolved = useMemo(
    () => exportRows ?? rows,
    [exportRows, rows],
  );

  async function openAdd() {
    setEditItem(null);
    const nextCode = await generateEntityCode("suppliers", "SUPP-");
    setForm({
      code: nextCode,
      name: "",
      phone: "",
      email: "",
      address: "",
      tax_number: "",
      contact_person: "",
      notes: "",
      opening_balance: "",
    });
    setDialogOpen(true);
  }

  function openEdit(s: Supplier) {
    setEditItem(s);
    setForm({
      code: s.code,
      name: s.name,
      phone: s.phone || "",
      email: s.email || "",
      address: s.address || "",
      tax_number: s.tax_number || "",
      contact_person: s.contact_person || "",
      notes: s.notes || "",
      opening_balance: "",
    });
    setDialogOpen(true);
  }

  async function createOpeningBalanceJournalEntry(
    entityId: string,
    entityName: string,
    amount: number,
  ) {
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, code")
      .in("code", [ACCOUNT_CODES.SUPPLIERS, ACCOUNT_CODES.EQUITY]);
    const suppliersAcc = accounts?.find(
      (a) => a.code === ACCOUNT_CODES.SUPPLIERS,
    );
    const equityAcc = accounts?.find((a) => a.code === ACCOUNT_CODES.EQUITY);
    if (!suppliersAcc || !equityAcc)
      throw new Error("تأكد من وجود حسابات الموردين ورأس المال");

    const roundedAmount = round2(amount);
    const desc = `رصيد افتتاحي - مورد: ${entityName}`;
    // Supplier opening balance: Debit Equity (3101), Credit Suppliers (2101)
    await createJournalEntry({
      entryDate: new Date().toISOString().split("T")[0],
      description: desc,
      status: "posted",
      lines: [
        { account_id: equityAcc.id, debit: roundedAmount, credit: 0, description: desc },
        { account_id: suppliersAcc.id, debit: 0, credit: roundedAmount, description: desc },
      ],
    });

    // Update supplier balance
    await (supabase.from("suppliers" as any) as any)
      .update({ balance: roundedAmount })
      .eq("id", entityId);
  }

  async function handleSave() {
    if (!form.code.trim() || !form.name.trim()) {
      notify.error("تنبيه", "يرجى إدخال الكود والاسم");
      return;
    }
    setSaving(true);
    const payload: any = {
      code: form.code.trim(),
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      tax_number: form.tax_number.trim() || null,
      contact_person: form.contact_person.trim() || null,
      notes: form.notes.trim() || null,
    };
    const openingBalance = parseFloat(form.opening_balance) || 0;
    try {
      if (editItem) {
        const { error } = await (supabase.from("suppliers" as any) as any)
          .update(payload)
          .eq("id", editItem.id);
        if (error) throw error;
        notify.success("تم التحديث", "تم تعديل بيانات المورد");
      } else {
        const insertPayload = { ...payload, opening_balance: openingBalance };
        const { data: newSupplier, error } = await (
          supabase.from("suppliers" as any) as any
        )
          .insert(insertPayload)
          .select("id")
          .single();
        if (error) throw error;
        if (openingBalance > 0) {
          await createOpeningBalanceJournalEntry(
            newSupplier.id,
            form.name.trim(),
            openingBalance,
          );
        }
        notify.success("تمت الإضافة", "تم إضافة المورد بنجاح");
      }
      setDialogOpen(false);
      refetchAll();
    } catch (error: any) {
      notify.error("خطأ", formatSupabaseError(error));
    }
    setSaving(false);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { count } = await (supabase.from("purchase_invoices" as any) as any)
      .select("id", { count: "exact", head: true })
      .eq("supplier_id", deleteTarget.id);
    if (count && count > 0) {
      notify.error("لا يمكن الحذف", `المورد مرتبط بـ ${count} فاتورة شراء`);
      setDeleteTarget(null);
      return;
    }
    const { error } = await (supabase.from("suppliers" as any) as any)
      .delete()
      .eq("id", deleteTarget.id);
    if (error) {
      notify.error("خطأ", formatSupabaseError(error));
      setDeleteTarget(null);
      return;
    }
    notify.success("تم الحذف", "تم حذف المورد");
    setDeleteTarget(null);
    refetchAll();
  }

  const columns: ColumnDef<Supplier, any>[] = [
    {
      accessorKey: "code",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="الكود" />
      ),
      cell: ({ row }) => (
        <span className="font-mono text-sm">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="الاسم" />
      ),
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "phone",
      meta: { hideOnMobile: true },
      header: "الهاتف",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.phone || "—"}
        </span>
      ),
    },
    {
      accessorKey: "email",
      meta: { hideOnMobile: true },
      header: "البريد",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.email || "—"}
        </span>
      ),
    },
    {
      accessorKey: "balance",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="الرصيد" />
      ),
      cell: ({ row }) => (
        <Badge variant={row.original.balance > 0 ? "destructive" : "secondary"}>
          {round2(row.original.balance).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </Badge>
      ),
    },
    ...(canEdit
      ? [
          {
            id: "actions" as const,
            header: "إجراءات" as const,
            enableHiding: false,
            cell: ({ row }: any) => (
              <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="كشف حساب"
                  onClick={() =>
                    navigate(`/supplier-statement/${row.original.id}`)
                  }
                >
                  <FileText className="h-3.5 w-3.5 text-primary" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="تعديل المورد"
                  onClick={() => openEdit(row.original)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="حذف المورد"
                  onClick={() => setDeleteTarget(row.original)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ),
          } as ColumnDef<Supplier, any>,
        ]
      : []),
  ];

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={Truck}
        title="الموردين"
        description={`${totalCount} مورد`}
        actions={
          canEdit ? (
            <Button onClick={openAdd} className="gap-2">
              <Plus className="h-4 w-4" />
              إضافة مورد
            </Button>
          ) : undefined
        }
      />

      <DataTable
        compactRows
        columns={columns}
        data={rows}
        searchPlaceholder="بحث بالاسم أو الكود أو الهاتف..."
        isLoading={isLoading}
        emptyMessage="لا يوجد موردين"
        manualPagination
        pageCount={pageCount}
        totalRows={totalCount}
        pagination={pagination}
        onPaginationChange={setPagination}
        globalFilter={search}
        onGlobalFilterChange={(v) => setSearch(typeof v === "string" ? v : "")}
        toolbarContent={
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={balanceFilter} onValueChange={setBalanceFilter}>
              <SelectTrigger className="w-36 h-9 text-sm">
                <SelectValue placeholder="الرصيد" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الموردين</SelectItem>
                <SelectItem value="has_balance">عليه رصيد</SelectItem>
                <SelectItem value="no_balance">بدون رصيد</SelectItem>
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
            <ExportMenu
              onOpen={async (onProgress) => {
                const all = await fetchAllForExport(onProgress);
                setExportRows(all);
              }}
              config={{
                filenamePrefix: "الموردين",
                sheetName: "الموردين",
                pdfTitle: "قائمة الموردين",
                headers: ["الكود", "الاسم", "الهاتف", "البريد", "الرصيد"],
                rows: exportRowsResolved.map((s) => [
                  s.code,
                  s.name,
                  s.phone || "",
                  s.email || "",
                  round2(Number(s.balance)).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                  }),
                ]),
                settings,
              }}
              disabled={isLoading}
            />
          </div>
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editItem ? "تعديل مورد" : "إضافة مورد جديد"}
            </DialogTitle>
            <DialogDescription>أدخل بيانات المورد</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>الكود *</Label>
                <Input
                  value={form.code}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, code: e.target.value }))
                  }
                  placeholder="SUPP-001"
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>الاسم *</Label>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, name: e.target.value }))
                  }
                  placeholder="اسم المورد"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>الهاتف</Label>
                <Input
                  value={form.phone}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, phone: e.target.value }))
                  }
                  placeholder="رقم الهاتف"
                />
              </div>
              <div className="space-y-2">
                <Label>البريد الإلكتروني</Label>
                <Input
                  value={form.email}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, email: e.target.value }))
                  }
                  placeholder="email@example.com"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>الرقم الضريبي</Label>
                <Input
                  value={form.tax_number}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, tax_number: e.target.value }))
                  }
                  placeholder="الرقم الضريبي"
                />
              </div>
              <div className="space-y-2">
                <Label>جهة الاتصال</Label>
                <Input
                  value={form.contact_person}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, contact_person: e.target.value }))
                  }
                  placeholder="اسم المسؤول"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>العنوان</Label>
              <Input
                value={form.address}
                onChange={(e) =>
                  setForm((p) => ({ ...p, address: e.target.value }))
                }
                placeholder="العنوان"
              />
            </div>
            {!editItem && (
              <div className="space-y-2">
                <Label>الرصيد الافتتاحي</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.opening_balance}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, opening_balance: e.target.value }))
                  }
                  placeholder="0.00"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  سيتم إنشاء قيد افتتاحي تلقائياً إذا كان المبلغ أكبر من صفر
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>ملاحظات</Label>
              <Textarea
                value={form.notes}
                onChange={(e) =>
                  setForm((p) => ({ ...p, notes: e.target.value }))
                }
                placeholder="ملاحظات (اختياري)"
                rows={2}
              />
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

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف المورد"
        description={`هل أنت متأكد من حذف المورد "${deleteTarget?.name ?? ""}"؟ لا يمكن التراجع عن هذا الإجراء.`}
        confirmText="حذف"
        destructive
        onConfirm={confirmDelete}
      />

    </div>
  );
}
