import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  inventoryRepairNumber,
  parseInventoryRepairCommandResult,
  type InventoryRepairDetail,
} from "@/lib/inventory-reconciliation-repair";
import { notify } from "@/lib/notify";

interface SubmitInventoryRepairDraftDialogProps {
  repair: InventoryRepairDetail;
  itemsCount: number;
}

export function SubmitInventoryRepairDraftDialog({
  repair,
  itemsCount,
}: SubmitInventoryRepairDraftDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setRequestId(crypto.randomUUID());
  }, [open]);

  async function submitDraft() {
    if (repair.status !== "draft") {
      notify.error("تعذر إرسال المسودة", "لم تعد المعالجة في حالة مسودة.");
      return;
    }
    if (!requestId || itemsCount === 0) {
      notify.error("تعذر إرسال المسودة", "المسودة لا تحتوي بنودًا صالحة للمراجعة.");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("submit_inventory_reconciliation_repair" as never, {
        p_id: repair.id,
        p_expected_version: repair.version,
        p_request_id: requestId,
      } as never);
      if (error) throw error;
      const result = parseInventoryRepairCommandResult(data);
      if (result.status !== "ready_for_review") {
        throw new Error("لم تنتقل المعالجة إلى حالة انتظار المراجعة");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory-reconciliation-repair", repair.id] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-reconciliation-repairs"] }),
      ]);
      notify.success("تم إرسال المسودة للمراجعة", "توقّف تعديلها ولم تُعتمد أو تُنفذ.");
      setOpen(false);
    } catch (error) {
      notify.dbError("تعذر إرسال مسودة المعالجة", error, "بقيت المسودة دون تغيير. حدّث الصفحة ثم أعد المحاولة.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      trigger={(
        <Button disabled={itemsCount === 0}>
          <Send className="ml-2 h-4 w-4" />
          إرسال للمراجعة
        </Button>
      )}
      title={`إرسال ${inventoryRepairNumber(repair.repairNumber)} للمراجعة؟`}
      description="بعد الإرسال لن يمكن تعديل العنوان أو السبب أو البنود. هذه الخطوة لا تعتمد المعالجة ولا تنفذ أي أثر مخزني أو محاسبي."
      confirmText="إرسال للمراجعة فقط"
      loading={submitting}
      confirmDisabled={!requestId || itemsCount === 0}
      onConfirm={submitDraft}
    />
  );
}
