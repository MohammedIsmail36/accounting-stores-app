import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { generateEntityCode } from "@/lib/code-generation";
import { Loader2, Truck } from "lucide-react";
import { notify } from "@/lib/notify";

export interface QuickAddedSupplier {
  id: string;
  code: string;
  name: string;
  balance?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onCreated: (supplier: QuickAddedSupplier) => void;
}

export function QuickAddSupplierDialog({
  open,
  onOpenChange,
  initialName = "",
  onCreated,
}: Props) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset on open
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setName(initialName);
      setPhone("");
    }
    onOpenChange(next);
  };

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      notify.error("تنبيه", "يرجى إدخال اسم المورد");
      return;
    }
    setSaving(true);
    try {
      const code = await generateEntityCode("suppliers", "SUPP-");
      const { data, error } = await (supabase.from("suppliers") as any)
        .insert({
          code,
          name: trimmed,
          phone: phone.trim() || null,
          is_active: true,
          balance: 0,
        })
        .select("id, code, name, balance")
        .single();
      if (error) throw error;
      notify.success("تمت الإضافة", `تم إنشاء المورد ${data.name}`);
      onCreated(data as QuickAddedSupplier);
      onOpenChange(false);
    } catch (error: any) {
      notify.error("خطأ", error.message || "تعذر إنشاء المورد");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            إضافة مورد جديد
          </DialogTitle>
          <DialogDescription>
            أدخل البيانات الأساسية فقط. يمكن استكمال باقي التفاصيل لاحقاً من شاشة الموردين.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>
              اسم المورد <span className="text-red-500">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: شركة الإمداد المتحدة"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>رقم الهاتف</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="اختياري"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            سيتم توليد كود المورد تلقائياً.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
            حفظ واختيار
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default QuickAddSupplierDialog;
