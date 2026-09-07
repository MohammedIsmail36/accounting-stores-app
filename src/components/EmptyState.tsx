import React from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  /** زر إجراء اختياري */
  action?: React.ReactNode;
  className?: string;
  /** حجم مضغوط للاستخدام داخل البطاقات */
  compact?: boolean;
}

/**
 * حالة الفراغ الموحّدة (لغير جداول DataTable التي تستخدم emptyMessage).
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "py-6 gap-2" : "py-12 gap-3",
        className,
      )}
    >
      <div
        className={cn(
          "rounded-2xl bg-muted flex items-center justify-center",
          compact ? "w-10 h-10" : "w-14 h-14",
        )}
      >
        <Icon className={cn("text-muted-foreground", compact ? "h-5 w-5" : "h-6 w-6")} />
      </div>
      <p className={cn("font-medium text-foreground", compact ? "text-sm" : "text-base")}>
        {title}
      </p>
      {description && (
        <p className="text-xs text-muted-foreground max-w-sm">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
