import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { InventoryJournalPlanPreview } from "@/components/inventory-reconciliation/InventoryJournalPlanPreview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  buildInventoryRepairDraftItem,
  canPrepareInventoryRepairDraft,
  inventoryRepairClassificationLabel,
  inventoryJournalPlanReasonLabel,
  inventoryRepairTypeLabel,
  parseInventoryRepairCommandResult,
  parseInventoryJournalPlan,
  type InventoryJournalPlan,
} from "@/lib/inventory-reconciliation-repair";
import { notify } from "@/lib/notify";
import type {
  InventoryReconciliationDiagnostic,
  InventoryReconciliationRow,
} from "@/lib/inventory-reconciliation-diagnostic";

interface CreateInventoryRepairDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: InventoryReconciliationRow | null;
  rowLabel: string;
  diagnostic: InventoryReconciliationDiagnostic | null;
}

export function CreateInventoryRepairDialog({
  open,
  onOpenChange,
  row,
  rowLabel,
  diagnostic,
}: CreateInventoryRepairDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [explanation, setExplanation] = useState("");
  const [requestId, setRequestId] = useState("");
  const [saving, setSaving] = useState(false);
  const [accountingDate, setAccountingDate] = useState("");
  const [journalPlan, setJournalPlan] = useState<InventoryJournalPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");

  useEffect(() => {
    if (!open || !row) return;
    setTitle(`معالجة ${rowLabel}`.slice(0, 120));
    setExplanation("");
    setRequestId(crypto.randomUUID());
    setAccountingDate("");
    setJournalPlan(null);
    setPlanError("");
  }, [open, row, rowLabel]);

  const repairItem = row && canPrepareInventoryRepairDraft(row)
    ? buildInventoryRepairDraftItem(row)
    : null;
  const repairType = repairItem?.repair_type ?? "";
  const requiresJournalPlan = repairType === "create_missing_inventory_journal"
    && row?.kind === "source";
  const journalPlanReady = !requiresJournalPlan
    || (journalPlan?.eligible === true && journalPlan.reasonCode === "READY");

  useEffect(() => {
    if (!open || !requiresJournalPlan || !row || row.kind !== "source") return;
    let active = true;
    setPlanLoading(true);
    setPlanError("");
    void supabase.rpc("get_inventory_reconciliation_journal_plan" as never, {
      p_source_type: row.sourceType,
      p_source_id: row.sourceId,
      p_accounting_date: accountingDate || null,
    } as never).then(({ data, error }) => {
      if (!active) return;
      if (error) throw error;
      setJournalPlan(parseInventoryJournalPlan(data));
    }).catch((error: unknown) => {
      if (!active) return;
      setJournalPlan(null);
      setPlanError(error instanceof Error ? error.message : "تعذر قراءة خطة القيد من الخادم");
    }).finally(() => {
      if (active) setPlanLoading(false);
    });
    return () => { active = false; };
  }, [accountingDate, open, requiresJournalPlan, row]);

  async function createDraft() {
    const trimmedTitle = title.trim();
    const trimmedExplanation = explanation.trim();
    if (!row || !diagnostic || !repairItem || !requestId) {
      notify.error("تعذر إنشاء المسودة", "بيانات التشخيص غير مكتملة؛ حدّث الصفحة وحاول مرة أخرى.");
      return;
    }
    if (!trimmedTitle) {
      notify.error("العنوان مطلوب", "أدخل عنوانًا واضحًا لمسودة المعالجة.");
      return;
    }
    if (!trimmedExplanation) {
      notify.error("سبب المعالجة مطلوب", "اشرح سبب إعداد المسودة وما الذي يحتاج إلى مراجعة.");
      return;
    }
    if (!journalPlanReady) {
      notify.error("خطة القيد غير جاهزة", "راجع سبب رفض الخطة أو اختر تاريخًا محاسبيًا مفتوحًا أولًا.");
      return;
    }

    const draftItem = requiresJournalPlan
      ? {
        ...repairItem,
        proposed_state: accountingDate ? { accounting_date: accountingDate } : {},
      }
      : repairItem;

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("create_inventory_reconciliation_repair" as never, {
        p_title: trimmedTitle,
        p_explanation: trimmedExplanation,
        p_diagnostic_fingerprint: diagnostic.fingerprint,
        p_diagnostic_snapshot_at: diagnostic.snapshotAt,
        p_source_scope: diagnostic.sourceScope,
        p_items: [draftItem],
        p_request_id: requestId,
      } as never);
      if (error) throw error;
      const result = parseInventoryRepairCommandResult(data);
      await queryClient.invalidateQueries({ queryKey: ["inventory-reconciliation-repairs"] });
      notify.success("تم إنشاء المسودة", "سُجلت المسودة فقط دون أي تعديل على المخزون أو القيود.");
      onOpenChange(false);
      navigate(`/reports/inventory-reconciliation/repairs/${result.id}`);
    } catch (error) {
      notify.dbError("تعذر إنشاء مسودة المعالجة", error, "لم تُنشأ المسودة. حدّث التشخيص وحاول مرة أخرى.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            إعداد مسودة معالجة
          </DialogTitle>
          <DialogDescription>
            ستُسجل مسودة للمراجعة فقط. لن يتغير المنتج أو المستند أو القيد في هذه الخطوة.
          </DialogDescription>
        </DialogHeader>

        {row && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="font-medium">{rowLabel}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              التشخيص: {inventoryRepairClassificationLabel[row.classification] ?? row.classification}
              {repairType ? ` • المقترح: ${inventoryRepairTypeLabel[repairType] ?? repairType}` : ""}
            </div>
          </div>
        )}

        {requiresJournalPlan && (
          <div className="space-y-3">
            {planLoading && (
              <div className="flex items-center gap-2 rounded-md border px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                جارٍ بناء خطة القيد من المستند والحركات…
              </div>
            )}
            {planError && (
              <Alert variant="destructive">
                <AlertTitle>تعذر قراءة خطة القيد</AlertTitle>
                <AlertDescription>{planError}</AlertDescription>
              </Alert>
            )}
            {journalPlan?.reasonCode === "ACCOUNTING_DATE_REQUIRED" && (
              <div className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                <Label htmlFor="repair-accounting-date">التاريخ المحاسبي في فترة مفتوحة</Label>
                <Input
                  id="repair-accounting-date"
                  type="date"
                  value={accountingDate}
                  onChange={(event) => setAccountingDate(event.target.value)}
                  disabled={saving || planLoading}
                />
                <p className="text-xs text-muted-foreground">
                  {inventoryJournalPlanReasonLabel.ACCOUNTING_DATE_REQUIRED}
                </p>
              </div>
            )}
            {journalPlan && journalPlan.reasonCode !== "ACCOUNTING_DATE_REQUIRED" && (
              <InventoryJournalPlanPreview plan={journalPlan} sourceLabel={rowLabel} />
            )}
          </div>
        )}

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="repair-title">عنوان المسودة</Label>
            <Input
              id="repair-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              disabled={saving}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="repair-explanation">سبب المعالجة</Label>
            <Textarea
              id="repair-explanation"
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              placeholder="مثال: فرق تقريب ظاهر في المستند ويحتاج مراجعة قبل اعتماد المعالجة."
              rows={4}
              maxLength={1000}
              disabled={saving}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>إلغاء</Button>
          <Button
            onClick={() => void createDraft()}
            disabled={saving || planLoading || !journalPlanReady || !title.trim() || !explanation.trim()}
          >
            {saving && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
            إنشاء المسودة فقط
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
