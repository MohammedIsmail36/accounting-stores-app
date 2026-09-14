import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil } from "lucide-react";
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
  buildInventoryRepairUpdateItem,
  inventoryRepairNumber,
  parseInventoryRepairCommandResult,
  type InventoryRepairDetail,
  type InventoryRepairItem,
} from "@/lib/inventory-reconciliation-repair";
import { notify } from "@/lib/notify";

interface EditInventoryRepairDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repair: InventoryRepairDetail;
  items: InventoryRepairItem[];
}

export function EditInventoryRepairDraftDialog({
  open,
  onOpenChange,
  repair,
  items,
}: EditInventoryRepairDraftDialogProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(repair.title);
  const [explanation, setExplanation] = useState(repair.explanation);
  const [requestId, setRequestId] = useState("");
  const [saving, setSaving] = useState(false);
  const hasChanges = title.trim() !== repair.title || explanation.trim() !== repair.explanation;

  useEffect(() => {
    if (!open) return;
    setTitle(repair.title);
    setExplanation(repair.explanation);
    setRequestId(crypto.randomUUID());
  }, [open, repair.title, repair.explanation]);

  async function saveDraft() {
    const trimmedTitle = title.trim();
    const trimmedExplanation = explanation.trim();
    if (repair.status !== "draft") {
      notify.error("تعذر تعديل المسودة", "لم تعد المعالجة في حالة مسودة.");
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
    if (!hasChanges) {
      notify.error("لا توجد تعديلات", "غيّر العنوان أو سبب المعالجة قبل الحفظ.");
      return;
    }
    if (!requestId || items.length === 0) {
      notify.error("تعذر تعديل المسودة", "بيانات المسودة غير مكتملة؛ حدّث الصفحة وحاول مرة أخرى.");
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("update_inventory_reconciliation_repair" as never, {
        p_id: repair.id,
        p_title: trimmedTitle,
        p_explanation: trimmedExplanation,
        p_items: items.map(buildInventoryRepairUpdateItem),
        p_expected_version: repair.version,
        p_request_id: requestId,
      } as never);
      if (error) throw error;
      const result = parseInventoryRepairCommandResult(data);
      if (result.status !== "draft") throw new Error("لم تعد المعالجة في حالة مسودة");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory-reconciliation-repair", repair.id] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-reconciliation-repairs"] }),
      ]);
      notify.success("تم تحديث المسودة", "حُفظ العنوان والسبب دون إرسال أو اعتماد أو تنفيذ.");
      onOpenChange(false);
    } catch (error) {
      notify.dbError("تعذر تعديل مسودة المعالجة", error, "لم تتغير المسودة. حدّث الصفحة ثم أعد المحاولة.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" />
            تعديل {inventoryRepairNumber(repair.repairNumber)}
          </DialogTitle>
          <DialogDescription>
            يُعدل العنوان وسبب المعالجة فقط، وتبقى البنود كما هي. لن تُرسل المسودة أو تُعتمد أو تُنفذ.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          البنود المثبتة في المسودة: <span className="font-semibold tabular-nums">{items.length}</span>
        </div>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="edit-repair-title">عنوان المسودة</Label>
            <Input
              id="edit-repair-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              disabled={saving}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-repair-explanation">سبب المعالجة</Label>
            <Textarea
              id="edit-repair-explanation"
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              rows={4}
              maxLength={1000}
              disabled={saving}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>إلغاء</Button>
          <Button onClick={() => void saveDraft()} disabled={saving || !title.trim() || !explanation.trim() || !hasChanges || items.length === 0}>
            {saving && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
            حفظ تعديل المسودة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
