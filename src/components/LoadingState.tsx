import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingStateProps {
  /** page: يشغل الشاشة كاملة • block: داخل بطاقة/قسم • inline: بجوار نص */
  variant?: "page" | "block" | "inline";
  label?: string;
  className?: string;
}

/**
 * مؤشر التحميل الموحّد — يحل محل صيغ animate-spin المتفرقة.
 */
export function LoadingState({
  variant = "block",
  label,
  className,
}: LoadingStateProps) {
  if (variant === "inline") {
    return <Loader2 className={cn("h-4 w-4 animate-spin", className)} />;
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2",
        variant === "page" ? "min-h-[60vh]" : "py-10",
        className,
      )}
    >
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      {label && <p className="text-sm text-muted-foreground">{label}</p>}
    </div>
  );
}
