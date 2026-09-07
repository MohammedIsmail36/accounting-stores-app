import { useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ReportPurposeBarProps {
  /** ماذا توفره الشاشة */
  what: string;
  /** القرار الذي تخدمه */
  decision: string;
  /** أساس الحساب */
  basis: string;
  /** ملاحظة إضافية (مثل مكان ضبط المعايير) */
  note?: string;
  className?: string;
}

/**
 * شريط تعريفي موحّد أعلى شاشات التقارير: ما تقدمه الشاشة، القرار الذي تخدمه، وأساس الحساب.
 */
export function ReportPurposeBar({
  what,
  decision,
  basis,
  note,
  className,
}: ReportPurposeBarProps) {
  const [open, setOpen] = useState(true);

  return (
    <Card className={cn("rounded-xl border-r-4 border-r-primary/60 bg-muted/30", className)}>
      <CardContent className="p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-2 text-right"
        >
          <Info className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold">الغرض من هذه الشاشة</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground mr-auto transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
        {open && (
          <div className="mt-2 grid gap-2 md:grid-cols-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">ماذا توفّر</div>
              <p className="text-foreground/90">{what}</p>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">القرار الذي تخدمه</div>
              <p className="text-foreground/90">{decision}</p>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">أساس الحساب</div>
              <p className="text-foreground/90">{basis}</p>
            </div>
            {note && (
              <p className="md:col-span-3 text-xs text-muted-foreground border-t border-border/50 pt-2">
                {note}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
