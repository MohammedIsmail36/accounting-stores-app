import React, { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useParams, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { createJournalEntry, replaceJournalEntryLines } from "@/lib/journal-writer";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useNavigationGuard } from "@/hooks/use-navigation-guard";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { FormFieldError } from "@/components/FormFieldError";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/ConfirmDialog";

import { AccountCombobox } from "@/components/AccountCombobox";
import { cn } from "@/lib/utils";
import { Save, CheckCircle, Trash2, Pencil, CalendarIcon, Plus, X, Ban, BookOpen, Check, Loader2, Info } from "lucide-react";
import { getNextPostedNumber, formatDisplayNumber } from "@/lib/posted-number-utils";
import { isBalanced as checkBalanced } from "@/lib/constants";
import { notify } from "@/lib/notify";

interface Account {
  id: string;
  code: string;
  name: string;
  account_type: string;
}

interface JournalEntryLine {
  id?: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string;
}

export default function JournalEntryForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const { settings, formatCurrency } = useSettings();
  const isNew = !id;
  const canEdit = role === "admin" || role === "accountant";
  const canDelete = role === "admin";

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const [entryNumber, setEntryNumber] = useState<number | null>(null);
  const [postedNumber, setPostedNumber] = useState<number | null>(null);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split("T")[0]);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("draft");
  const [editMode, setEditMode] = useState(true);
  const [isLinked, setIsLinked] = useState(false);
  const [linkedDoc, setLinkedDoc] = useState<{ label: string; to: string | null } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const navGuard = useNavigationGuard(isDirty);

  const [lines, setLines] = useState<JournalEntryLine[]>([
    { account_id: "", debit: 0, credit: 0, description: "" },
    { account_id: "", debit: 0, credit: 0, description: "" },
  ]);

  useEffect(() => {
    loadData();
  }, [id]);

  async function loadData() {
    const { data: accs } = await supabase
      .from("accounts")
      .select("id, code, name, account_type")
      .eq("is_active", true)
      .eq("is_parent", false)
      .order("code");
    setAccounts(accs || []);

    if (id) {
      const { data: entry } = await (supabase.from("journal_entries") as any).select("*").eq("id", id).single();
      if (entry) {
        setEntryNumber(entry.entry_number);
        setPostedNumber(entry.posted_number);
        setEntryDate(entry.entry_date);
        setDescription(entry.description);
        setStatus(entry.status);
        setEditMode(entry.status === "draft");

        const { data: entryLines } = await supabase
          .from("journal_entry_lines")
          .select("*")
          .eq("journal_entry_id", id)
          .order("created_at");
        if (entryLines && entryLines.length > 0) {
          setLines(
            entryLines.map((l: any) => ({
              id: l.id,
              account_id: l.account_id,
              debit: Number(l.debit),
              credit: Number(l.credit),
              description: l.description || "",
            })),
          );
        }

        // اكتشاف المستند المصدر للقيد (قيد آلي؟)
        const sources: {
          table: string;
          label: string;
          to: (row: any) => string | null;
        }[] = [
          { table: "sales_invoices", label: "فاتورة بيع", to: (r) => `/sales/${r.id}` },
          { table: "purchase_invoices", label: "فاتورة مشتريات", to: (r) => `/purchases/${r.id}` },
          { table: "sales_returns", label: "مرتجع بيع", to: (r) => `/sales-returns/${r.id}` },
          { table: "purchase_returns", label: "مرتجع مشتريات", to: (r) => `/purchase-returns/${r.id}` },
          { table: "customer_payments", label: "سند قبض", to: () => "/customer-payments" },
          { table: "supplier_payments", label: "سند دفع", to: () => "/supplier-payments" },
          { table: "expenses", label: "سند مصروف", to: () => "/expenses" },
          {
            table: "inventory_adjustments",
            label: "تسوية مخزون",
            to: (r) => `/inventory-adjustments/${r.id}`,
          },
        ];
        const results = await Promise.all(
          sources.map((s) =>
            (supabase.from(s.table as any) as any).select("id").eq("journal_entry_id", id).limit(1),
          ),
        );
        const foundIdx = results.findIndex((r) => r.data && r.data.length > 0);
        const isSystemType = ["reversal", "closing"].includes(entry.entry_type || "");
        const isReversalEntry = isSystemType || (entry.description || "").startsWith("عكس ");

        if (foundIdx >= 0) {
          const src = sources[foundIdx];
          setLinkedDoc({ label: src.label, to: src.to(results[foundIdx].data[0]) });
        } else if (isReversalEntry) {
          setLinkedDoc({
            label: entry.entry_type === "closing" ? "قيد إقفال سنة مالية" : "قيد عكسي آلي",
            to: null,
          });
        } else {
          setLinkedDoc(null);
        }
        setIsLinked(foundIdx >= 0 || isReversalEntry);
      }
      setLoading(false);
    } else {
      setEditMode(true);
      setLoading(false);
    }
  }

  const accountMap = useMemo(() => {
    const map = new Map<string, Account>();
    accounts.forEach((a) => map.set(a.id, a));
    return map;
  }, [accounts]);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const difference = Math.abs(totalDebit - totalCredit);
  const isBalanced = totalDebit > 0 && checkBalanced(totalDebit, totalCredit);

  function addLine() {
    setLines([...lines, { account_id: "", debit: 0, credit: 0, description: "" }]);
  }

  function removeLine(index: number) {
    if (lines.length <= 2) return;
    setLines(lines.filter((_, i) => i !== index));
  }

  function updateLine(index: number, field: keyof JournalEntryLine, value: any) {
    const updated = [...lines];
    (updated[index] as any)[field] = value;
    if (field === "debit" && Number(value) > 0) updated[index].credit = 0;
    else if (field === "credit" && Number(value) > 0) updated[index].debit = 0;
    setLines(updated);
  }

  async function handleSave(asPosted: boolean = false) {
    if (saving) return;
    const errors: Record<string, string> = {};
    if (!description.trim()) errors.description = "يرجى إدخال وصف القيد";
    if (lines.some((l) => !l.account_id)) errors.lines = "يرجى اختيار الحساب لكل سطر";
    const validLines = lines.filter((l) => l.account_id && (l.debit > 0 || l.credit > 0));
    if (validLines.length < 2) errors.lines = "يجب إضافة سطرين على الأقل";
    if (!isBalanced) errors.lines = "القيد غير متوازن";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      notify.error("تنبيه", Object.values(errors)[0]);
      return;
    }
    if (settings?.locked_until_date && entryDate <= settings.locked_until_date) {
      notify.error("خطأ", `لا يمكن إنشاء قيد بتاريخ ${entryDate} — الفترة مقفلة حتى ${settings.locked_until_date}`);
      return;
    }
    setSaving(true);
    try {
      const linesPayload = validLines.map((l) => ({
        account_id: l.account_id,
        debit: l.debit,
        credit: l.credit,
        description: l.description || null,
      }));

      if (id) {
        await replaceJournalEntryLines(id, linesPayload, {
          entryDate: entryDate,
          description: description.trim(),
          status: asPosted ? "posted" : "draft",
        });
        notify.success("تم التحديث", "تم تعديل القيد بنجاح");
        setIsDirty(false);
        navGuard.allowNext();
        loadData();
      } else {
        const newId = await createJournalEntry({
          entryDate: entryDate,
          description: description.trim(),
          status: asPosted ? "posted" : "draft",
          lines: linesPayload,
        });
        notify.success("تمت الإضافة", "تم إنشاء القيد بنجاح");
        setIsDirty(false);
        navGuard.allowNext();
        navigate(`/journal/${newId}`);
      }
    } catch (error: any) {
      notify.error("خطأ", error.message || "حدث خطأ");
    }
    setSaving(false);
  }

  async function handleSavePosted() {
    if (!id || saving) return;
    const errors: Record<string, string> = {};
    if (!description.trim()) errors.description = "يرجى إدخال وصف القيد";
    if (lines.some((l) => !l.account_id)) errors.lines = "يرجى اختيار الحساب لكل سطر";
    const validLines = lines.filter((l) => l.account_id && (l.debit > 0 || l.credit > 0));
    if (validLines.length < 2) errors.lines = "يجب إضافة سطرين على الأقل";
    if (!isBalanced) errors.lines = "القيد غير متوازن";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      notify.error("تنبيه", Object.values(errors)[0]);
      return;
    }
    setSaving(true);
    try {
      const { error } = await (supabase.rpc as any)("edit_journal_entry", {
        p_entry_id: id,
        p_entry_date: entryDate,
        p_description: description.trim(),
        p_lines: validLines.map((l) => ({
          account_id: l.account_id,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description || null,
        })),
      });
      if (error) throw error;
      notify.success("تم التحديث", "تم تعديل القيد المعتمد بنجاح");
      setIsDirty(false);
      navGuard.allowNext();
      setEditMode(false);
      loadData();
    } catch (error: any) {
      notify.error("خطأ", error.message || "حدث خطأ");
    }
    setSaving(false);
  }

  async function handlePost() {

    if (!id || saving) return;
    const validLines = lines.filter((l) => l.account_id && (l.debit > 0 || l.credit > 0));
    if (validLines.length < 2) {
      notify.error("تنبيه", "يجب إضافة سطرين على الأقل");
      return;
    }
    if (!isBalanced) {
      notify.error("تنبيه", "القيد غير متوازن");
      return;
    }
    setSaving(true);
    try {
      const newPostedNumber = await getNextPostedNumber("journal_entries");
      const { error } = await (supabase.from("journal_entries") as any)
        .update({ status: "posted", posted_number: newPostedNumber })
        .eq("id", id);
      if (error) throw error;
      notify.success("تم الاعتماد", "تم اعتماد القيد بنجاح");
      loadData();
    } catch (error: any) {
      notify.error("خطأ", error.message);
    }
    setSaving(false);
  }

  const linkedBlockMessage =
    "هذا القيد مولّد من عملية في النظام — لا يمكن تعديله أو إلغاؤه هنا. عدّل المستند نفسه (إعادة كمسودة ثم إعادة الترحيل).";

  async function handleDelete() {
    if (!id || saving) return;
    if (isLinked) {
      notify.error("غير مسموح", linkedBlockMessage);
      return;
    }
    setSaving(true);
    try {
      await supabase.from("journal_entry_lines").delete().eq("journal_entry_id", id);
      await (supabase.from("journal_entries") as any).delete().eq("id", id);
      notify.success("تم الحذف", "تم حذف القيد بنجاح");
      setIsDirty(false);
      navGuard.allowNext();
      navigate("/journal");
    } catch (error: any) {
      notify.error("خطأ", error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!id || saving) return;
    if (isLinked) {
      notify.error("غير مسموح", linkedBlockMessage);
      return;
    }
    setSaving(true);
    try {
      const { error } = await (supabase.from("journal_entries") as any)
        .update({ status: "cancelled" })
        .eq("id", id);
      if (error) throw error;
      notify.success("تم الإلغاء", "تم إلغاء القيد");
      loadData();
    } catch (error: any) {
      notify.error("خطأ", error.message);
    } finally {
      setSaving(false);
    }
  }

  const prefix = (settings as any)?.journal_entry_prefix || "JV-";
  const displayNumber = entryNumber ? formatDisplayNumber(prefix, postedNumber, entryNumber, status) : "جديد";

  const statusLabels: Record<string, string> = {
    draft: "مسودة",
    posted: "معتمد",
    cancelled: "ملغي",
  };
  const statusColors: Record<string, string> = {
    draft: "secondary",
    posted: "default",
    cancelled: "destructive",
  };

  if (loading) return <PageSkeleton variant="form" />;

  const isDraft = status === "draft";
  const canEditPosted = status === "posted" && !isLinked && canEdit;
  const isEditable = editMode && canEdit && !isLinked && (isDraft || canEditPosted);


  return (
    <div className="space-y-8" dir="rtl" onInput={() => !isDirty && setIsDirty(true)}>
      <PageHeader
        icon={BookOpen}
        title={isNew ? "إنشاء قيد محاسبي جديد" : `قيد ${displayNumber}`}
        description={
          isNew ? "تسجيل المعاملات المالية يدوياً في دفتر الأستاذ العام." : `تفاصيل القيد المحاسبي ${displayNumber}`
        }
        badge={
          !isNew ? (
            <Badge variant={statusColors[status] as any} className="text-xs">
              {statusLabels[status]}
            </Badge>
          ) : undefined
        }
        actions={
          <>
            {!isNew && isDraft && canDelete && !isLinked && (
              <ConfirmDialog
                trigger={
                  <Button variant="destructive" className="gap-2">
                    <Trash2 className="h-4 w-4" />
                    حذف
                  </Button>
                }
                title="حذف القيد المسودة"
                description="هل أنت متأكد من حذف هذا القيد؟ لا يمكن التراجع عن هذا الإجراء."
                confirmText="حذف"
                destructive
                onConfirm={handleDelete}
              />
            )}
            {!isNew && status === "posted" && canEdit && !isLinked && (
              <ConfirmDialog
                trigger={
                  <Button
                    variant="outline"
                    className="gap-2 border-destructive text-destructive hover:bg-destructive/10"
                  >
                    <Ban className="h-4 w-4" />
                    إلغاء القيد
                  </Button>
                }
                title={`إلغاء القيد ${displayNumber}`}
                description='سيتم تغيير حالة القيد إلى "ملغي". هل تريد المتابعة؟'
                confirmText="تأكيد الإلغاء"
                cancelText="تراجع"
                destructive
                onConfirm={handleCancel}
              />
            )}

            {!isNew && status === "posted" && isLinked && (
              <Button
                variant="ghost"
                className="gap-2 text-muted-foreground/40 cursor-not-allowed"
                disabled
                title="قيد آلي - لا يمكن إلغاؤه يدوياً"
              >
                <Ban className="h-4 w-4" />
                إلغاء القيد
              </Button>
            )}
            {!isNew && (isDraft || canEditPosted) && canEdit && !editMode && (
              <Button variant="outline" onClick={() => setEditMode(true)} className="gap-2">
                <Pencil className="h-4 w-4" />
                تعديل
              </Button>
            )}
            {!isNew && isDraft && canEdit && !isLinked && (
              <Button
                variant="default"
                onClick={handlePost}
                disabled={!isBalanced || saving}
                className="gap-2 bg-green-600 hover:bg-green-700"
              >
                <CheckCircle className="h-4 w-4" />
                اعتماد
              </Button>
            )}
            {isEditable && isDraft && (
              <Button onClick={() => handleSave(false)} disabled={saving || !isBalanced} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? "جاري الحفظ..." : "حفظ"}
              </Button>
            )}
            {isEditable && !isDraft && (
              <>
                <Button variant="ghost" onClick={() => { setEditMode(false); loadData(); }} className="gap-2">
                  <X className="h-4 w-4" />
                  تراجع
                </Button>
                <ConfirmDialog
                  trigger={
                    <Button disabled={saving || !isBalanced} className="gap-2">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {saving ? "جاري الحفظ..." : "حفظ التعديلات"}
                    </Button>
                  }
                  title={`تعديل قيد معتمد ${displayNumber}`}
                  description="سيتم استبدال سطور القيد بالسطور الجديدة وتحديث الأرصدة فوراً، مع الاحتفاظ برقم القيد. هل تريد المتابعة؟"
                  confirmText="تأكيد التعديل"
                  cancelText="تراجع"
                  onConfirm={handleSavePosted}
                />

              </>
            )}

            {isNew && (
              <Button
                onClick={() => handleSave(true)}
                disabled={saving || !isBalanced}
                variant="outline"
                className="gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                {saving ? "جاري الحفظ..." : "حفظ واعتماد"}
              </Button>
            )}
          </>
        }
      />


      {isEditable && !isDraft && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-700">
          أنت تعدّل قيداً معتمداً — سيتم تحديث الأرصدة فوراً مع الاحتفاظ برقم القيد {displayNumber}.
        </div>
      )}

      {/* Entry Details Card */}

      <div className="bg-card rounded-2xl border border-border shadow-sm p-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Entry Number (read-only) */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">رقم القيد</label>
            <Input readOnly value={displayNumber} className="bg-muted/50 border-none font-mono text-muted-foreground" />
          </div>
          {/* Date */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">تاريخ القيد</label>
            {isEditable || isNew ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-right font-normal h-10 rounded-xl",
                      !entryDate && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="ml-2 h-4 w-4 text-muted-foreground" />
                    {entryDate || "اختر التاريخ"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={entryDate ? new Date(entryDate + "T00:00:00") : undefined}
                    onSelect={(date) => date && setEntryDate(format(date, "yyyy-MM-dd"))}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            ) : (
              <Input readOnly value={entryDate} className="bg-muted/30 border-none" />
            )}
          </div>
          {/* Description */}
          <div className="md:col-span-2 space-y-2">
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              الوصف العام للقيد <span className="text-red-500">*</span>
            </label>
            {isEditable || isNew ? (
              <Input
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setFieldErrors((er) => {
                    const { description, ...rest } = er;
                    return rest;
                  });
                }}
                placeholder="أدخل تفاصيل عامة عن هذا القيد المحاسبي..."
                className="rounded-xl"
                error={!!fieldErrors.description}
              />
            ) : (
              <Input readOnly value={description} className="bg-muted/30 border-none" />
            )}
            <FormFieldError message={fieldErrors.description} />
          </div>
        </div>
      </div>

      {/* Journal Lines Table */}
      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider w-12">
                  #
                </th>
                <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider w-1/4">
                  اسم الحساب
                </th>
                <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  البيان / الوصف
                </th>
                <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider w-44 text-center">
                  مدين (Debit)
                </th>
                <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider w-44 text-center">
                  دائن (Credit)
                </th>
                {(isEditable || isNew) && (
                  <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider w-16 text-center">
                    إجراءات
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {lines.map((line, index) => (
                <tr key={index} className="group hover:bg-muted/20 transition-colors">
                  <td className="px-6 py-2 text-sm text-muted-foreground font-medium">{index + 1}</td>
                  <td className="px-6 py-2">
                    {isEditable || isNew ? (
                      <AccountCombobox
                        accounts={accounts}
                        value={line.account_id}
                        onValueChange={(v) => updateLine(index, "account_id", v)}
                      />
                    ) : (
                      <span className="font-medium text-sm">
                        {accountMap.get(line.account_id)
                          ? `${accountMap.get(line.account_id)!.code} - ${accountMap.get(line.account_id)!.name}`
                          : line.account_id}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-2">
                    {isEditable || isNew ? (
                      <Input
                        className="h-10 rounded-xl"
                        value={line.description}
                        onChange={(e) => updateLine(index, "description", e.target.value)}
                        placeholder="بيان السطر..."
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">{line.description || "—"}</span>
                    )}
                  </td>
                  <td className="px-6 py-2">
                    {isEditable || isNew ? (
                      <Input
                        className="h-10 rounded-xl text-center font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:bg-primary/5"
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.debit || ""}
                        onChange={(e) => updateLine(index, "debit", parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                      />
                    ) : (
                      <span className="font-mono text-sm block text-center">
                        {line.debit > 0 ? formatCurrency(line.debit) : "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-2">
                    {isEditable || isNew ? (
                      <Input
                        className="h-10 rounded-xl text-center font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:bg-primary/5"
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.credit || ""}
                        onChange={(e) => updateLine(index, "credit", parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                      />
                    ) : (
                      <span className="font-mono text-sm block text-center">
                        {line.credit > 0 ? formatCurrency(line.credit) : "—"}
                      </span>
                    )}
                  </td>
                  {(isEditable || isNew) && (
                    <td className="px-6 py-2 text-center">
                      {lines.length > 2 && (
                        <button
                          onClick={() => removeLine(index)}
                          className="w-8 h-8 flex items-center justify-center text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 rounded-lg transition-all mx-auto"
                          aria-label="حذف السطر"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Add line button */}
        {(isEditable || isNew) && (
          <div className="p-6 bg-muted/10 border-t border-border">
            <button
              onClick={addLine}
              className="inline-flex items-center gap-2 text-primary font-bold hover:bg-primary/5 px-6 py-2.5 rounded-xl transition-all border border-dashed border-primary/40"
            >
              <Plus className="h-5 w-5" />
              <span className="text-sm">إضافة سطر جديد</span>
            </button>
          </div>
        )}
      </div>

      {/* Totals & Balance Bar */}
      <div className="bg-card rounded-2xl border border-border shadow-sm p-8 flex flex-col md:flex-row justify-between items-center gap-8">
        <div className="flex flex-wrap items-center gap-12">
          <div className="space-y-1">
            <p className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-widest">إجمالي المدين</p>
            <p className="text-2xl font-black text-foreground">{formatCurrency(totalDebit)}</p>
          </div>
          <div className="h-12 w-px bg-border hidden md:block" />
          <div className="space-y-1">
            <p className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-widest">إجمالي الدائن</p>
            <p className="text-2xl font-black text-foreground">{formatCurrency(totalCredit)}</p>
          </div>
          <div className="h-12 w-px bg-border hidden md:block" />
          <div className="space-y-1">
            <p className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-widest">
              الفرق (التوازن)
            </p>
            <p className={cn("text-2xl font-black", isBalanced ? "text-green-600" : "text-destructive")}>
              {formatCurrency(difference)}
            </p>
          </div>
        </div>
        {/* Balance Indicator */}
        {totalDebit > 0 &&
          (isBalanced ? (
            <div className="flex items-center gap-3 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 px-6 py-3 rounded-2xl border border-green-200 dark:border-green-800 ring-4 ring-green-50/30 dark:ring-green-950/20">
              <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white">
                <Check className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-black uppercase tracking-tight">قيد متوازن</span>
                <span className="text-[11px] opacity-80">
                  {status === "posted" ? "قيد مرحل" : "جاهز للترحيل للحسابات"}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 px-6 py-3 rounded-2xl border border-red-200 dark:border-red-800 ring-4 ring-red-50/30 dark:ring-red-950/20">
              <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center text-white">
                <X className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-black uppercase tracking-tight">قيد غير متوازن</span>
                <span className="text-[11px] opacity-80">الفرق: {formatCurrency(difference)}</span>
              </div>
            </div>
          ))}
      </div>

      {!isNew && isLinked && (
        <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3 flex flex-wrap items-center gap-3 text-muted-foreground">
          <Info className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm flex-1">
            هذا القيد مولّد تلقائياً من {linkedDoc?.label || "عملية في النظام"}. للتعديل افتح المستند الأصلي وأعده كمسودة
            ثم أعد ترحيله.
          </span>
          {linkedDoc?.to && (
            <Button variant="outline" size="sm" className="gap-2 h-8" onClick={() => navigate(linkedDoc.to!)}>
              فتح المستند
            </Button>
          )}
        </div>
      )}

      <UnsavedChangesDialog open={navGuard.isBlocked} onStay={navGuard.cancel} onLeave={navGuard.confirm} />
    </div>
  );
}
