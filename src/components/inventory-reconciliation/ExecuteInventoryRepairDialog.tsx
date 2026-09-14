import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  canExecuteInventoryProductCardRepair,
  inventoryRepairItemLabel,
  inventoryRepairNumber,
  parseInventoryRepairCommandResult,
  type InventoryRepairDetail,
  type InventoryRepairItem,
} from "@/lib/inventory-reconciliation-repair";
import { formatNumber } from "@/lib/format";
import { notify } from "@/lib/notify";

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
  const repairNumber = inventoryRepairNumber(repair.repairNumber);
  const executable = canExecuteInventoryProductCardRepair(repair, items);
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
  }, [open]);

  if (!executable) return null;

  async function executeRepair() {
    if (!canExecuteInventoryProductCardRepair(repair, items)) {
      notify.error("تعذر تنفيذ المعالجة", "لم تعد المعالجة معتمدة أو أصبحت بنودها غير قابلة لهذا المنفذ.");
      return;
    }
    if (!requestId || !confirmationMatches) {
      notify.error("التأكيد غير مكتمل", `اكتب ${repairNumber} كما هو لتأكيد التنفيذ.`);
      return;
    }

    setExecuting(true);
    try {
      const { data, error } = await supabase.rpc("execute_inventory_reconciliation_repair" as never, {
        p_id: repair.id,
        p_expected_version: repair.version,
        p_request_id: requestId,
      } as never);
      if (error) throw error;
      const result = parseInventoryRepairCommandResult(data);
      if (result.status !== "executed") throw new Error("لم تنتقل المعالجة إلى حالة التنفيذ");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory-reconciliation-repair", repair.id] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-reconciliation-repairs"] }),
      ]);
      notify.success(
        "تم تنفيذ المعالجة",
        "أعيدت كميات بطاقات المنتجات من الحركات المسجلة دون إنشاء حركة مخزون أو قيد جديد.",
      );
      setOpen(false);
    } catch (error) {
      notify.dbError(
        "تعذر تنفيذ المعالجة",
        error,
        "لم تُنفذ المعالجة. قد تكون البطاقة أو الحركات تغيرت بعد الاعتماد؛ حدّث الصفحة وراجع التشخيص.",
      );
    } finally {
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
          تنفيذ إعادة بناء البطاقة
        </Button>
      )}
      title={`تنفيذ ${repairNumber}؟`}
      description="هذه عملية فعلية تغيّر كمية بطاقة كل منتج إلى صافي كميته المحسوبة من الحركات المسجلة. لا تنشئ حركات مخزون أو قيودًا جديدة."
      confirmText="تنفيذ المعالجة الآن"
      destructive
      loading={executing}
      confirmDisabled={!requestId || !confirmationMatches}
      onConfirm={executeRepair}
    >
      <div className="space-y-4">
        <Alert variant="destructive">
          <Wrench className="h-4 w-4" />
          <AlertTitle>تحقق نهائي قبل التنفيذ</AlertTitle>
          <AlertDescription>
            ستُفحص البطاقة وحركات المنتج مرة أخرى داخل قاعدة البيانات. إذا تغيرت منذ الاعتماد، يُرفض التنفيذ بالكامل دون أثر جزئي.
          </AlertDescription>
        </Alert>

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
