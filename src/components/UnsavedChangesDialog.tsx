import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface UnsavedChangesDialogProps {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
  onSaveAndLeave?: () => void | Promise<void>;
  saving?: boolean;
}

/**
 * مربع حوار تأكيد لمنع فقدان التغييرات غير المحفوظة عند التنقل الداخلي.
 */
export function UnsavedChangesDialog({
  open,
  onStay,
  onLeave,
  onSaveAndLeave,
  saving,
}: UnsavedChangesDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onStay()}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>لديك تغييرات غير محفوظة</AlertDialogTitle>
          <AlertDialogDescription>
            إذا غادرت الصفحة الآن، ستفقد جميع التغييرات التي أجريتها. ماذا تريد أن تفعل؟
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel onClick={onStay} disabled={saving}>
            البقاء في الصفحة
          </AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={onLeave}
            disabled={saving}
          >
            مغادرة بدون حفظ
          </Button>
          {onSaveAndLeave && (
            <AlertDialogAction onClick={onSaveAndLeave} disabled={saving}>
              {saving ? "جاري الحفظ..." : "حفظ ومتابعة"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
