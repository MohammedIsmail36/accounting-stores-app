import React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ConfirmDialogProps {
  /** وضع مُتحكَّم: مرّر open + onOpenChange. اتركهما فارغين مع trigger للوضع غير المتحكَّم */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** عنصر يفتح الحوار (يُلفّ بـ AlertDialogTrigger asChild) */
  trigger?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** محتوى إضافي داخل جسم الحوار (سبب الإلغاء، تحذير محاسبي، تفاصيل...) */
  children?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** زر تأكيد بنمط الحذف/الإلغاء */
  destructive?: boolean;
  /** حالة انتظار: يعطّل الأزرار ويظهر مؤشر تحميل */
  loading?: boolean;
  /** تعطيل زر التأكيد (تحقق غير مكتمل) */
  confirmDisabled?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * حوار التأكيد الموحّد لكل عمليات الحذف / الإلغاء / الترحيل / إعادة المسودة.
 * يحل محل بناء AlertDialog يدوياً في كل شاشة.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  confirmText = "تأكيد",
  cancelText = "إلغاء",
  destructive = false,
  loading = false,
  confirmDisabled = false,
  onConfirm,
}: ConfirmDialogProps) {
  const controlled = open !== undefined;

  return (
    <AlertDialog
      {...(controlled
        ? { open, onOpenChange: (o: boolean) => !loading && onOpenChange?.(o) }
        : {})}
    >
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent dir="rtl">

        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>

        {children}

        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel disabled={loading}>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void onConfirm();
            }}
            disabled={loading || confirmDisabled}
            className={cn(
              destructive &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
          >
            {loading && <Loader2 className="h-4 w-4 ml-1 animate-spin" />}
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
