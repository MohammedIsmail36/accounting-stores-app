import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/contexts/SettingsContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePickerInput } from "@/components/DatePickerInput";
import { LookupCombobox } from "@/components/LookupCombobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormFieldError } from "@/components/FormFieldError";
import { Save, CheckCircle, Loader2, Info } from "lucide-react";
import { postExpense } from "@/lib/expense-posting";
import { formatSupabaseError } from "@/lib/format-error";
import { notify } from "@/lib/notify";

interface ExpenseType {
  id: string;
  name: string;
  account_id: string;
  is_active: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expenseId?: string | null;
  /** When reverting a posted expense back to draft, reuse same numbers on re-post */
  reusePostedNum?: number | null;
  onSuccess?: () => void;
}

export function ExpenseFormDialog({
  open,
  onOpenChange,
  expenseId,
  reusePostedNum,
  onSuccess,
}: Props) {
  const { settings, formatCurrency } = useSettings();
  const isEdit = !!expenseId;

  const [expenseTypes, setExpenseTypes] = useState<ExpenseType[]>([]);
  const [expenseTypeId, setExpenseTypeId] = useState("");
  const [amount, setAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [expenseDate, setExpenseDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Track loaded expense status/JE so we can clean up on edit-then-repost
  const [existingStatus, setExistingStatus] = useState<string>("draft");
  const [existingJeId, setExistingJeId] = useState<string | null>(null);
  const [existingPostedNum, setExistingPostedNum] = useState<number | null>(null);

  // Reset / load when dialog opens (await both fetches in parallel to avoid races)
  useEffect(() => {
    if (!open) return;
    setFieldErrors({});
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (expenseId) {
          // Fetch expense + types in parallel; THEN apply state.
          const [typesRes, expRes] = await Promise.all([
            (supabase.from("expense_types") as any)
              .select("id, name, account_id, is_active")
              .order("name"),
            (supabase.from("expenses") as any)
              .select("*")
              .eq("id", expenseId)
              .single(),
          ]);
          if (cancelled) return;
          const allTypes: ExpenseType[] = (typesRes.data as any[]) || [];
          const exp: any = expRes.data;
          if (exp) {
            // If the expense's type is inactive (or somehow missing from list),
            // splice it in so the combobox can display it.
            const has = allTypes.some((t) => t.id === exp.expense_type_id);
            let merged = allTypes;
            if (!has && exp.expense_type_id) {
              // Fetch the missing type by id (may be inactive)
              const { data: missing } = await (
                supabase.from("expense_types") as any
              )
                .select("id, name, account_id, is_active")
                .eq("id", exp.expense_type_id)
                .maybeSingle();
              if (missing) merged = [...allTypes, missing as ExpenseType];
            }
            setExpenseTypes(merged);
            setExpenseTypeId(exp.expense_type_id);
            setAmount(Number(exp.amount) || 0);
            setPaymentMethod(exp.payment_method);
            setExpenseDate(exp.expense_date);
            setDescription(exp.description || "");
            setExistingStatus(exp.status || "draft");
            setExistingJeId(exp.journal_entry_id || null);
            setExistingPostedNum(exp.posted_number ?? null);
          } else {
            setExpenseTypes(allTypes);
          }
        } else {
          // New expense: only active types
          const { data } = await (supabase.from("expense_types") as any)
            .select("id, name, account_id, is_active")
            .eq("is_active", true)
            .order("name");
          if (cancelled) return;
          setExpenseTypes((data as ExpenseType[]) || []);
          setExpenseTypeId("");
          setAmount(0);
          setPaymentMethod("cash");
          setExpenseDate(new Date().toISOString().split("T")[0]);
          setDescription("");
          setExistingStatus("draft");
          setExistingJeId(null);
          setExistingPostedNum(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, expenseId]);

  const selectedType = useMemo(
    () => expenseTypes.find((t) => t.id === expenseTypeId),
    [expenseTypes, expenseTypeId],
  );

  // Combobox items: mark inactive ones with a suffix
  const comboItems = useMemo(
    () =>
      expenseTypes.map((t) => ({
        id: t.id,
        name: t.is_active ? t.name : `${t.name} (غير نشط)`,
      })),
    [expenseTypes],
  );

  function validate() {
    const errors: Record<string, string> = {};
    if (!expenseTypeId) errors.expenseType = "يرجى اختيار نوع المصروف";
    else if (selectedType && !selectedType.is_active) {
      errors.expenseType = "نوع المصروف غير نشط — يرجى اختيار نوع آخر";
    } else if (selectedType && !selectedType.account_id) {
      errors.expenseType = "نوع المصروف لا يحتوي على حساب محاسبي مرتبط";
    }
    if (amount <= 0) errors.amount = "يرجى إدخال مبلغ صحيح";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      notify.error("تنبيه", Object.values(errors)[0]);
      return false;
    }
    return true;
  }

  function checkLockDate(): boolean {
    if (
      settings?.locked_until_date &&
      expenseDate <= settings.locked_until_date
    ) {
      notify.error("خطأ", `لا يمكن تسجيل/تعديل مصروف بتاريخ ${expenseDate} — الفترة مقفلة حتى ${settings.locked_until_date}`);
      return false;
    }
    return true;
  }

  async function handleSaveDraft() {
    if (saving) return;
    if (!validate()) return;
    setSaving(true);
    try {
      const payload: any = {
        expense_type_id: expenseTypeId,
        amount,
        payment_method: paymentMethod,
        expense_date: expenseDate,
        description: description.trim() || null,
        status: "draft",
      };
      if (isEdit) {
        const { error } = await (supabase.from("expenses") as any)
          .update(payload)
          .eq("id", expenseId);
        if (error) throw error;
        notify.success("تم التحديث", "تم تحديث المسودة بنجاح");
      } else {
        const { error } = await (supabase.from("expenses") as any).insert(
          payload,
        );
        if (error) throw error;
        notify.success("تم الحفظ", "تم حفظ المصروف كمسودة");
      }
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      notify.error("خطأ", formatSupabaseError(error));
    }
    setSaving(false);
  }

  async function handleSaveAndPost() {
    if (saving) return;
    if (!validate()) return;
    if (!checkLockDate()) return;
    setSaving(true);
    try {
      // Persist current form first (insert if new, update if edit)
      let targetId = expenseId as string | null;
      const basePayload: any = {
        expense_type_id: expenseTypeId,
        amount,
        payment_method: paymentMethod,
        expense_date: expenseDate,
        description: description.trim() || null,
      };
      if (isEdit && targetId) {
        const { error } = await (supabase.from("expenses") as any)
          .update(basePayload)
          .eq("id", targetId);
        if (error) throw error;
      } else {
        const { data, error } = await (supabase.from("expenses") as any)
          .insert({ ...basePayload, status: "draft" })
          .select("id")
          .single();
        if (error) throw error;
        targetId = (data as any).id;
      }

      // Reuse the existing journal entry whenever one is linked (posted or reset-to-draft)
      const reuseJe = isEdit && !!existingJeId;

      const { displayNumber } = await postExpense({
        expenseId: targetId!,
        expenseTypeId,
        expenseTypeName: selectedType!.name,
        accountId: selectedType!.account_id,
        amount,
        paymentMethod,
        expenseDate,
        description,
        reusePostedNumber: reusePostedNum ?? existingPostedNum ?? null,
        expensePrefix: (settings as any)?.expense_prefix || "EXP-",
        oldJournalEntryId: reuseJe ? existingJeId : null,
      });

      notify.success("تم الترحيل", `تم تسجيل المصروف ${displayNumber} بنجاح`);
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      notify.error("خطأ", formatSupabaseError(error));
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"
        dir="rtl"
      >
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "تعديل مصروف" : "إضافة مصروف جديد"}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {isEdit && existingStatus === "posted" && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  هذا المصروف مرحّل بالفعل. للتعديل استخدم زر "إعادة لمسودة" من
                  القائمة أولاً.
                </span>
              </div>
            )}
            {selectedType && !selectedType.is_active && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  نوع المصروف الحالي غير نشط. لا يمكن إعادة الترحيل قبل اختيار
                  نوع نشط.
                </span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label>
                  نوع المصروف <span className="text-red-500">*</span>
                </Label>
                <div className="mt-1">
                  <LookupCombobox
                    items={comboItems}
                    value={expenseTypeId}
                    onValueChange={(v) => {
                      setExpenseTypeId(v);
                      setFieldErrors((e) => {
                        const { expenseType, ...rest } = e;
                        return rest;
                      });
                    }}
                    placeholder="اختر نوع المصروف..."
                    searchPlaceholder="ابحث..."
                    error={!!fieldErrors.expenseType}
                  />
                </div>
                <FormFieldError message={fieldErrors.expenseType} />
              </div>
              <div>
                <Label>
                  المبلغ <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount || ""}
                  onChange={(e) => {
                    setAmount(parseFloat(e.target.value) || 0);
                    setFieldErrors((er) => {
                      const { amount, ...rest } = er;
                      return rest;
                    });
                  }}
                  className="mt-1"
                  placeholder="0.00"
                  error={!!fieldErrors.amount}
                />
                <FormFieldError message={fieldErrors.amount} />
              </div>
              <div>
                <Label>طريقة الدفع</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">نقدي</SelectItem>
                    <SelectItem value="bank">تحويل بنكي</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label>التاريخ</Label>
                <div className="mt-1">
                  <DatePickerInput
                    value={expenseDate}
                    onChange={setExpenseDate}
                  />
                </div>
              </div>
              <div className="sm:col-span-2">
                <Label>البيان</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="وصف المصروف..."
                  className="mt-1 min-h-[70px]"
                />
              </div>
            </div>

            {amount > 0 && (
              <div className="rounded-lg bg-muted/50 p-3 space-y-1">
                <p className="text-xs text-muted-foreground">
                  ملخص القيد المحاسبي عند الترحيل:
                </p>
                <div className="flex justify-between text-sm">
                  <span>
                    مدين:{" "}
                    {selectedType?.name || "حساب المصروف"}
                  </span>
                  <span className="font-semibold">
                    {formatCurrency(amount)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>
                    دائن: {paymentMethod === "cash" ? "الصندوق" : "البنك"}
                  </span>
                  <span className="font-semibold">
                    {formatCurrency(amount)}
                  </span>
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2 flex-wrap">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                إلغاء
              </Button>
              <Button
                variant="secondary"
                onClick={handleSaveDraft}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 ml-2" />
                )}
                حفظ كمسودة
              </Button>
              <Button onClick={handleSaveAndPost} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 ml-2" />
                )}
                حفظ وترحيل
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ExpenseFormDialog;
