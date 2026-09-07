import { Badge } from "@/components/ui/badge";
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_VARIANTS,
  type DocumentStatusKind,
} from "@/lib/constants";

interface StatusBadgeProps {
  status: string | null | undefined;
  /** نوع المستند — يحدد التسميات المستخدمة (فاتورة/تسوية/قيد) */
  kind?: DocumentStatusKind;
  className?: string;
}

/**
 * شريحة الحالة الموحّدة — تقرأ التسميات والألوان من lib/constants فقط.
 */
export function StatusBadge({ status, kind = "invoice", className }: StatusBadgeProps) {
  const key = status || "";
  const label = DOCUMENT_STATUS_LABELS[kind][key] || key || "—";
  const variant = DOCUMENT_STATUS_VARIANTS[key] || "secondary";

  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
