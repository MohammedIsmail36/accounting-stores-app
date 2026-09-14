import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  inventoryRepairNumber,
  parseInventoryRepairCommandResult,
  type InventoryRepairDetail,
} from "@/lib/inventory-reconciliation-repair";
import { notify } from "@/lib/notify";

interface ApproveInventoryRepairDialogProps {
  repair: InventoryRepairDetail;
  currentUserId: string;
}

export function ApproveInventoryRepairDialog({
  repair,
  currentUserId,
}: ApproveInventoryRepairDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [approving, setApproving] = useState(false);
  const separationOverrideRequired = repair.preparedBy === currentUserId;

  useEffect(() => {
    if (!open) return;
    setRequestId(crypto.randomUUID());
    setOverrideReason("");
  }, [open]);

  async function approveRepair() {
    const trimmedReason = overrideReason.trim();
    if (repair.status !== "ready_for_review") {
      notify.error("تعذر اعتماد المعالجة", "لم تعد المعالجة في حالة انتظار المراجعة.");
      return;
    }
    if (!currentUserId || !requestId) {
      notify.error("تعذر اعتماد المعالجة", "بيانات جلسة الاعتماد غير مكتملة. حدّث الصفحة.");
      return;
    }
    if (separationOverrideRequired && !trimmedReason) {
      notify.error("سبب عدم فصل المهام مطلوب", "اكتب سبب اعتمادك لمعالجة أعددتها بنفسك.");
      return;
    }

    setApproving(true);
    try {
      const { data, error } = await supabase.rpc("approve_inventory_reconciliation_repair" as never, {
        p_id: repair.id,
        p_expected_version: repair.version,
        p_separation_override_reason: separationOverrideRequired ? trimmedReason : null,
        p_request_id: requestId,
      } as never);
      if (error) throw error;
      const result = parseInventoryRepairCommandResult(data);
      if (result.status !== "approved") throw new Error("لم تنتقل المعالجة إلى حالة الاعتماد");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory-reconciliation-repair", repair.id] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-reconciliation-repairs"] }),
      ]);
      notify.success("تم اعتماد المعالجة", "سُجل الاعتماد دون تنفيذ أي أثر محاسبي أو مخزني.");
      setOpen(false);
    } catch (error) {
      notify.dbError("تعذر اعتماد المعالجة", error, "لم تتغير المعالجة. حدّث الصفحة ثم أعد المحاولة.");
    } finally {
      setApproving(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      trigger={(
        <Button>
          <ShieldCheck className="ml-2 h-4 w-4" />
          اعتماد دون تنفيذ
        </Button>
      )}
      title={`اعتماد ${inventoryRepairNumber(repair.repairNumber)}؟`}
      description="يثبت الاعتماد قرار المراجعة ويمنع تعديل المسودة، لكنه لا ينفذ أي حركة مخزون أو قيد محاسبي."
      confirmText="اعتماد فقط دون تنفيذ"
      loading={approving}
      confirmDisabled={!requestId || (separationOverrideRequired && !overrideReason.trim())}
      onConfirm={approveRepair}
    >
      {separationOverrideRequired && (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            أنت مُعدّ هذه المعالجة أيضًا. يجب توثيق سبب عدم فصل الإعداد عن الاعتماد.
          </p>
          <Label htmlFor="repair-separation-override-reason">سبب عدم فصل المهام</Label>
          <Textarea
            id="repair-separation-override-reason"
            value={overrideReason}
            onChange={(event) => setOverrideReason(event.target.value)}
            placeholder="مثال: لا يوجد مدير آخر مخوّل بالمراجعة في بيئة الاختبار"
            rows={3}
            maxLength={500}
            disabled={approving}
          />
        </div>
      )}
    </ConfirmDialog>
  );
}
