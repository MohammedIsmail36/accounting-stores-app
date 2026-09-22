import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InventoryJournalPlanPreview } from "@/components/inventory-reconciliation/InventoryJournalPlanPreview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  canExecuteInventoryProductCardRepair,
  canExecuteInventoryMissingJournalRepair,
  inventoryJournalPlanMatchesStoredState,
  inventoryRepairItemLabel,
  inventoryRepairNumber,
  parseInventoryRepairCommandResult,
  parseInventoryJournalPlan,
  type InventoryRepairDetail,
  type InventoryRepairItem,
  type InventoryJournalPlan,
} from "@/lib/inventory-reconciliation-repair";
import { formatNumber } from "@/lib/format";
import { notify } from "@/lib/notify";
import { createRequestTimeout } from "@/lib/request-timeout";

const EXECUTION_REQUEST_TIMEOUT_MS = 20_000;

interface ExecuteInventoryRepairDialogProps {
  repair: InventoryRepairDetail;
  items: InventoryRepairItem[];
}

export function ExecuteInventoryRepairDialog({
  repair,
  items,
}: ExecuteInventoryRepairDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [executing, setExecuting] = useState(false);
  const [liveJournalPlans, setLiveJournalPlans] = useState<Array<{
    itemId: string;
    plan: InventoryJournalPlan;
  }>>([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");
  const repairNumber = inventoryRepairNumber(repair.repairNumber);
  const productExecutable = canExecuteInventoryProductCardRepair(repair, items);
  const journalExecutable = canExecuteInventoryMissingJournalRepair(repair, items);
  const executable = productExecutable || journalExecutable;
  const confirmationMatches = confirmation.trim() === repairNumber;
  const changedItems = useMemo(() => items.map((item) => ({
    id: item.id,
    label: inventoryRepairItemLabel(item),
    before: item.beforeCardQuantity,
    after: item.proposedCardQuantity,
  })), [items]);

  useEffect(() => {
    if (!open) return;
    setRequestId(crypto.randomUUID());
    setConfirmation("");
    setLiveJournalPlans([]);
    setPlanError("");
  }, [open]);

  useEffect(() => {
    if (!open || !journalExecutable) return;
    let active = true;
    setPlanLoading(true);
    setPlanError("");
    void Promise.all(items.map(async (item) => {
      const { data, error } = await supabase.rpc("get_inventory_reconciliation_journal_plan" as never, {
        p_source_type: item.sourceType,
        p_source_id: item.sourceId,
        p_accounting_date: repair.accountingDate,
      } as never);
      if (error) throw error;
      return { itemId: item.id, plan: parseInventoryJournalPlan(data) };
    })).then((plans) => {
      if (active) setLiveJournalPlans(plans);
    }).catch((error: unknown) => {
      if (!active) return;
      setLiveJournalPlans([]);
      setPlanError(error instanceof Error ? error.message : "تعذر إعادة فحص خطة القيد");
    }).finally(() => {
      if (active) setPlanLoading(false);
    });
    return () => { active = false; };
  }, [items, journalExecutable, open, repair.accountingDate]);

  const journalPlansMatch = journalExecutable
    && liveJournalPlans.length === items.length
    && liveJournalPlans.every(({ itemId, plan }) => {
      const item = items.find((candidate) => candidate.id === itemId);
      return Boolean(item && inventoryJournalPlanMatchesStoredState(plan, item));
    });
  const executionReady = productExecutable || (journalExecutable && journalPlansMatch);

  if (!executable) return null;

  async function executeRepair() {
    const productStillExecutable = canExecuteInventoryProductCardRepair(repair, items);
    const journalStillExecutable = canExecuteInventoryMissingJournalRepair(repair, items);
    if (!productStillExecutable && !journalStillExecutable) {
      notify.error("تعذر تنفيذ المعالجة", "لم تعد المعالجة معتمدة أو أصبحت بنودها غير قابلة لهذا المنفذ.");
      return;
    }
    if (journalStillExecutable && !journalPlansMatch) {
      notify.error("تغيرت خطة القيد", "لا يمكن التنفيذ قبل تحديث التشخيص وإعادة إعداد المعالجة واعتمادها.");
      return;
    }
    if (!requestId || !confirmationMatches) {
      notify.error("التأكيد غير مكتمل", `اكتب ${repairNumber} كما هو لتأكيد التنفيذ.`);
      return;
    }

    setExecuting(true);
    const requestTimeout = createRequestTimeout(EXECUTION_REQUEST_TIMEOUT_MS);
    try {
      const { data, error } = await supabase.rpc("execute_inventory_reconciliation_repair" as never, {
        p_id: repair.id,
        p_expected_version: repair.version,
        p_request_id: requestId,
      } as never).abortSignal(requestTimeout.signal);
      if (error) throw error;
      const result = parseInventoryRepairCommandResult(data);
      if (result.status !== "executed") throw new Error("لم تنتقل المعالجة إلى حالة التنفيذ");
      setOpen(false);
      void Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["inventory-reconciliation-repair", repair.id] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-reconciliation-repairs"] }),
      ]);
      notify.success(
        "تم تنفيذ المعالجة",
        journalStillExecutable
          ? "أُنشئ القيد التصحيحي ورُحّل ذريًا دون إنشاء حركة مخزون أو تعديل القيد الأصلي."
          : "أعيدت كميات بطاقات المنتجات من الحركات المسجلة دون إنشاء حركة مخزون أو قيد جديد.",
      );
    } catch (error) {
      if (requestTimeout.didTimeout()) {
        setOpen(false);
        void Promise.allSettled([
          queryClient.invalidateQueries({ queryKey: ["inventory-reconciliation-repair", repair.id] }),
          queryClient.invalidateQueries({ queryKey: ["inventory-reconciliation-repairs"] }),
        ]);
        notify.warning(
          "انتهت مهلة الاتصال",
          "حالة التنفيذ غير مؤكدة. لا تُعد المحاولة؛ حدّث الصفحة وتحقق من حالة المعالجة أولًا.",
        );
      } else {
        notify.dbError(
          "تعذر تنفيذ المعالجة",
          error,
          "لم تُنفذ المعالجة. قد تكون البطاقة أو الحركات تغيرت بعد الاعتماد؛ حدّث الصفحة وراجع التشخيص.",
        );
      }
    } finally {
      requestTimeout.clear();
      setExecuting(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      trigger={(
        <Button variant="destructive">
          <Wrench className="ml-2 h-4 w-4" />
          {journalExecutable ? "تنفيذ القيد التصحيحي" : "تنفيذ إعادة بناء البطاقة"}
        </Button>
      )}
      title={`تنفيذ ${repairNumber}؟`}
      description={journalExecutable
        ? "هذه عملية محاسبية فعلية تنشئ قيدًا مرحّلًا جديدًا وفق الخطة الخادمية. لا تعدّل حركة المخزون أو القيد الأصلي."
        : "هذه عملية فعلية تغيّر كمية بطاقة كل منتج إلى صافي كميته المحسوبة من الحركات المسجلة. لا تنشئ حركات مخزون أو قيودًا جديدة."}
      confirmText="تنفيذ المعالجة الآن"
      destructive
      loading={executing}
      confirmDisabled={!requestId || !confirmationMatches || planLoading || !executionReady}
      onConfirm={executeRepair}
    >
      <div className="space-y-4">
        <Alert variant="destructive">
          <Wrench className="h-4 w-4" />
          <AlertTitle>تحقق نهائي قبل التنفيذ</AlertTitle>
          <AlertDescription>
            {journalExecutable
              ? "ستُعاد مقارنة المستند والحركات والخطة والبصمة داخل قاعدة البيانات. أي تغير يرفض التنفيذ بالكامل دون أثر جزئي."
              : "ستُفحص البطاقة وحركات المنتج مرة أخرى داخل قاعدة البيانات. إذا تغيرت منذ الاعتماد، يُرفض التنفيذ بالكامل دون أثر جزئي."}
          </AlertDescription>
        </Alert>

        {journalExecutable ? (
          <div className="max-h-72 space-y-3 overflow-y-auto">
            {planLoading && <div className="rounded-md border p-3 text-sm text-muted-foreground">جارٍ إعادة فحص خطة القيد…</div>}
            {planError && (
              <Alert variant="destructive">
                <AlertTitle>تعذر إعادة فحص الخطة</AlertTitle>
                <AlertDescription>{planError}</AlertDescription>
              </Alert>
            )}
            {!planLoading && !planError && !journalPlansMatch && (
              <Alert variant="destructive">
                <AlertTitle>تغيرت الخطة منذ الاعتماد</AlertTitle>
                <AlertDescription>أُوقف التنفيذ. حدّث التشخيص وأنشئ معالجة جديدة بدل استخدام اقتراح قديم.</AlertDescription>
              </Alert>
            )}
            {liveJournalPlans.map(({ itemId, plan }) => {
              const item = items.find((candidate) => candidate.id === itemId);
              return (
                <InventoryJournalPlanPreview
                  key={itemId}
                  plan={plan}
                  sourceLabel={item ? inventoryRepairItemLabel(item) : undefined}
                />
              );
            })}
          </div>
        ) : (
          <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3 text-sm">
            {changedItems.map((item) => (
              <div key={item.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium">{item.label}</span>
                <span className="tabular-nums text-muted-foreground" dir="ltr">
                  {formatNumber(item.before)} → {formatNumber(item.after)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="inventory-repair-execution-confirmation">
            اكتب <span className="font-mono" dir="ltr">{repairNumber}</span> لتأكيد التنفيذ
          </Label>
          <Input
            id="inventory-repair-execution-confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={repairNumber}
            dir="ltr"
            autoComplete="off"
            disabled={executing}
          />
        </div>
      </div>
    </ConfirmDialog>
  );
}
