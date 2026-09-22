import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSettings } from "@/contexts/SettingsContext";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/format";
import {
  inventoryJournalPlanModeLabel,
  inventoryJournalPlanReasonLabel,
  type InventoryJournalPlan,
} from "@/lib/inventory-reconciliation-repair";
import { cn } from "@/lib/utils";

interface InventoryJournalPlanPreviewProps {
  plan: InventoryJournalPlan;
  title?: string;
  sourceLabel?: string;
  className?: string;
}

export function InventoryJournalPlanPreview({
  plan,
  title = "خطة القيد التصحيحي",
  sourceLabel,
  className,
}: InventoryJournalPlanPreviewProps) {
  const { formatCurrency } = useSettings();
  const accountCodes = [...new Set(plan.correctionLines.map((line) => line.accountCode))].sort();
  const { data: accountNames = new Map<string, string>() } = useQuery({
    queryKey: ["inventory-journal-plan-account-names", accountCodes],
    enabled: accountCodes.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts")
        .select("code, name")
        .in("code", accountCodes);
      if (error) throw error;
      return new Map((data ?? []).map((account) => [account.code, account.name]));
    },
    staleTime: 5 * 60_000,
  });
  const totalDebit = plan.correctionLines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = plan.correctionLines.reduce((sum, line) => sum + line.credit, 0);

  return (
    <section className={cn("overflow-hidden rounded-md border", className)} dir="rtl">
      <div className="flex flex-col gap-2 border-b bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {sourceLabel && <div className="mt-0.5 text-xs text-muted-foreground">{sourceLabel}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={plan.eligible ? "secondary" : "destructive"}>
            {inventoryJournalPlanReasonLabel[plan.reasonCode] ?? plan.reasonCode}
          </Badge>
          {plan.mode && <span>{inventoryJournalPlanModeLabel[plan.mode]}</span>}
          {plan.accountingDate && <span>التاريخ: {formatDate(plan.accountingDate)}</span>}
        </div>
      </div>

      {plan.correctionLines.length > 0 ? (
        <div className="overflow-x-auto">
          <Table className="[&_th]:h-9 [&_th]:px-3 [&_td]:px-3 [&_td]:py-2">
            <TableHeader>
              <TableRow>
                <TableHead>الحساب</TableHead>
                <TableHead className="w-36 text-left">مدين</TableHead>
                <TableHead className="w-36 text-left">دائن</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.correctionLines.map((line, index) => (
                <TableRow key={`${line.accountCode}-${index}`}>
                  <TableCell>
                    <span className="font-mono" dir="ltr">{line.accountCode}</span>
                    <span className="mr-2">{accountNames.get(line.accountCode) ?? "حساب دليل الحسابات"}</span>
                  </TableCell>
                  <TableCell className="text-left tabular-nums" dir="ltr">
                    {line.debit > 0 ? formatCurrency(line.debit) : "—"}
                  </TableCell>
                  <TableCell className="text-left tabular-nums" dir="ltr">
                    {line.credit > 0 ? formatCurrency(line.credit) : "—"}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell>الإجمالي</TableCell>
                <TableCell className="text-left tabular-nums" dir="ltr">{formatCurrency(totalDebit)}</TableCell>
                <TableCell className="text-left tabular-nums" dir="ltr">{formatCurrency(totalCredit)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="px-3 py-4 text-sm text-muted-foreground">
          لا توجد سطور قيد قابلة للعرض في الخطة الحالية.
        </div>
      )}
    </section>
  );
}
