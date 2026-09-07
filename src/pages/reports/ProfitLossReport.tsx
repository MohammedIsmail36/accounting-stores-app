import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/contexts/SettingsContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Minus, FileSpreadsheet, FileText } from "lucide-react";
import { exportToExcel } from "@/lib/excel-export";
import { exportReportPdf } from "@/lib/report-pdf";
import { format, startOfMonth, endOfMonth, subMonths, subYears, parseISO } from "date-fns";
import { ar } from "date-fns/locale";
import {
  REPORT_ENTRY_STATUSES,
  isClosingDescription,
} from "@/lib/report-period";
import { notify } from "@/lib/notify";


interface AccountLine {
  account_id: string;
  account_code: string;
  account_name: string;
  months: Record<string, number>; // "2026-01" => amount
  total: number;
  prevYearTotal: number;
}

interface MonthColumn {
  key: string; // "2026-01"
  label: string; // "يناير 2026"
}

interface ReportJournalLine {
  id: string;
  account_id: string;
  debit: number;
  credit: number;
  journal_entries: {
    entry_date: string;
    status: string;
    description: string | null;
  };
}

// PostgREST encodes `in` filters in the URL. Keep account batches short, and
// page the result so the report remains correct beyond the API's row limit.
const ACCOUNT_ID_BATCH_SIZE = 40;
const QUERY_PAGE_SIZE = 1_000;

export default function ProfitLossReport() {
  const { formatCurrency, settings } = useSettings();
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [revenueLines, setRevenueLines] = useState<AccountLine[]>([]);
  const [expenseLines, setExpenseLines] = useState<AccountLine[]>([]);

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => current - i);
  }, []);

  const monthColumns: MonthColumn[] = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const date = new Date(year, i, 1);
      return {
        key: format(date, "yyyy-MM"),
        label: format(date, "MMMM", { locale: ar }),
      };
    });
  }, [year]);

  useEffect(() => {
    fetchData();
  }, [year]);

  const fetchData = async () => {
    setLoading(true);

    const currentYearStart = `${year}-01-01`;
    const currentYearEnd = `${year}-12-31`;
    const prevYearStart = `${year - 1}-01-01`;
    const prevYearEnd = `${year - 1}-12-31`;

    // Fetch accounts (revenue & expense, non-parent)
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, code, name, account_type")
      .eq("is_active", true)
      .eq("is_parent", false)
      .in("account_type", ["revenue", "expense"])
      .order("code");

    if (!accounts?.length) {
      setRevenueLines([]);
      setExpenseLines([]);
      setLoading(false);
      return;
    }

    const accountIds = accounts.map((a) => a.id);

    // Fetch only lines whose entries are in the report period. Joining here
    // avoids a second `journal_entries?id=in.(...)` request containing hundreds
    // of UUIDs, which exceeds the production reverse proxy's URL limit.
    const lines: ReportJournalLine[] = [];
    for (let i = 0; i < accountIds.length; i += ACCOUNT_ID_BATCH_SIZE) {
      const accountIdBatch = accountIds.slice(i, i + ACCOUNT_ID_BATCH_SIZE);

      for (let from = 0; ; from += QUERY_PAGE_SIZE) {
        const { data: page, error } = await supabase
          .from("journal_entry_lines")
          .select(
            "id, account_id, debit, credit, journal_entries!inner(entry_date, status, description)",
          )
          .in("account_id", accountIdBatch)
          .in("journal_entries.status", [...REPORT_ENTRY_STATUSES])
          .gte("journal_entries.entry_date", prevYearStart)
          .lte("journal_entries.entry_date", currentYearEnd)
          .order("id", { ascending: true })
          .range(from, from + QUERY_PAGE_SIZE - 1);

        if (error) {
          notify.error("تعذر تحميل قائمة الأرباح والخسائر", error.message);
          setRevenueLines([]);
          setExpenseLines([]);
          setLoading(false);
          return;
        }

        if (page) lines.push(...page);
        if (!page || page.length < QUERY_PAGE_SIZE) break;
      }
    }

    if (!lines.length) {
      setRevenueLines([]);
      setExpenseLines([]);
      setLoading(false);
      return;
    }


    // Build account data
    const accountMap = new Map<string, { months: Record<string, number>; prevYearTotal: number }>();

    accounts.forEach((a) => {
      accountMap.set(a.id, { months: {}, prevYearTotal: 0 });
    });

    lines.forEach((l) => {
      const entry = l.journal_entries;
      const entryDate = entry?.entry_date;
      // استثناء قيود الإقفال السنوي حتى لا تُصفّر نتائج ديسمبر
      if (!entryDate || isClosingDescription(entry.description)) return;

      const acc = accountMap.get(l.account_id);
      if (!acc) return;

      const accType = accounts.find((a) => a.id === l.account_id)?.account_type;
      // Revenue: credit increases, debit decreases
      // Expense: debit increases, credit decreases
      const amount =
        accType === "revenue"
          ? Number(l.credit) - Number(l.debit)
          : Number(l.debit) - Number(l.credit);

      const monthKey = entryDate.substring(0, 7); // "2026-01"
      const entryYear = parseInt(entryDate.substring(0, 4));

      if (entryYear === year) {
        acc.months[monthKey] = (acc.months[monthKey] || 0) + amount;
      } else if (entryYear === year - 1) {
        acc.prevYearTotal += amount;
      }
    });

    const buildLines = (type: string): AccountLine[] =>
      accounts
        .filter((a) => a.account_type === type)
        .map((a) => {
          const data = accountMap.get(a.id)!;
          const total = Object.values(data.months).reduce((s, v) => s + v, 0);
          return {
            account_id: a.id,
            account_code: a.code,
            account_name: a.name,
            months: data.months,
            total,
            prevYearTotal: data.prevYearTotal,
          };
        })
        .filter((l) => l.total !== 0 || l.prevYearTotal !== 0);

    setRevenueLines(buildLines("revenue"));
    setExpenseLines(buildLines("expense"));
    setLoading(false);
  };

  const totalRevenue = revenueLines.reduce((s, l) => s + l.total, 0);
  const totalExpenses = expenseLines.reduce((s, l) => s + l.total, 0);
  const netProfit = totalRevenue - totalExpenses;
  const prevRevenue = revenueLines.reduce((s, l) => s + l.prevYearTotal, 0);
  const prevExpenses = expenseLines.reduce((s, l) => s + l.prevYearTotal, 0);
  const prevNetProfit = prevRevenue - prevExpenses;

  const revenueByMonth = monthColumns.map((m) =>
    revenueLines.reduce((s, l) => s + (l.months[m.key] || 0), 0)
  );
  const expenseByMonth = monthColumns.map((m) =>
    expenseLines.reduce((s, l) => s + (l.months[m.key] || 0), 0)
  );
  const profitByMonth = revenueByMonth.map((r, i) => r - expenseByMonth[i]);

  const changePercent = (current: number, prev: number) => {
    if (prev === 0) return current > 0 ? 100 : current < 0 ? -100 : 0;
    return ((current - prev) / Math.abs(prev)) * 100;
  };

  const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  const TrendIcon = ({ value }: { value: number }) => {
    if (value > 0) return <TrendingUp className="w-4 h-4 text-success inline" />;
    if (value < 0) return <TrendingDown className="w-4 h-4 text-destructive inline" />;
    return <Minus className="w-4 h-4 text-muted-foreground inline" />;
  };

  const fmt = (n: number) => formatCurrency(Math.abs(n));

  const handleExcelExport = () => {
    const headers = ["الرمز", "الحساب", ...monthColumns.map((m) => m.label), `إجمالي ${year}`, `إجمالي ${year - 1}`, "التغيير %"];
    const rows: any[][] = [];

    rows.push(["", "═══ الإيرادات ═══", ...monthColumns.map(() => ""), "", "", ""]);
    revenueLines.forEach((l) => {
      rows.push([
        l.account_code,
        l.account_name,
        ...monthColumns.map((m) => l.months[m.key] || 0),
        l.total,
        l.prevYearTotal,
        changePercent(l.total, l.prevYearTotal).toFixed(1) + "%",
      ]);
    });
    rows.push(["", "إجمالي الإيرادات", ...revenueByMonth, totalRevenue, prevRevenue, changePercent(totalRevenue, prevRevenue).toFixed(1) + "%"]);

    rows.push(["", "", ...monthColumns.map(() => ""), "", "", ""]);
    rows.push(["", "═══ المصروفات ═══", ...monthColumns.map(() => ""), "", "", ""]);
    expenseLines.forEach((l) => {
      rows.push([
        l.account_code,
        l.account_name,
        ...monthColumns.map((m) => l.months[m.key] || 0),
        l.total,
        l.prevYearTotal,
        changePercent(l.total, l.prevYearTotal).toFixed(1) + "%",
      ]);
    });
    rows.push(["", "إجمالي المصروفات", ...expenseByMonth, totalExpenses, prevExpenses, changePercent(totalExpenses, prevExpenses).toFixed(1) + "%"]);

    rows.push(["", "", ...monthColumns.map(() => ""), "", "", ""]);
    rows.push(["", "صافي الربح / الخسارة", ...profitByMonth, netProfit, prevNetProfit, changePercent(netProfit, prevNetProfit).toFixed(1) + "%"]);

    exportToExcel({ filename: `تقرير-الأرباح-والخسائر-${year}`, sheetName: "الأرباح والخسائر", headers, rows });
  };

  const handlePdfExport = async () => {
    const fmtN = (n: number) => Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const headers = ["الرمز", "الحساب", `إجمالي ${year}`, `إجمالي ${year - 1}`, "التغيير %"];
    const rows: any[][] = [];

    rows.push(["", "── الإيرادات ──", "", "", ""]);
    revenueLines.forEach((l) =>
      rows.push([l.account_code, l.account_name, fmtN(l.total), fmtN(l.prevYearTotal), changePercent(l.total, l.prevYearTotal).toFixed(1) + "%"])
    );
    rows.push(["", "إجمالي الإيرادات", fmtN(totalRevenue), fmtN(prevRevenue), changePercent(totalRevenue, prevRevenue).toFixed(1) + "%"]);
    rows.push(["", "", "", "", ""]);
    rows.push(["", "── المصروفات ──", "", "", ""]);
    expenseLines.forEach((l) =>
      rows.push([l.account_code, l.account_name, fmtN(l.total), fmtN(l.prevYearTotal), changePercent(l.total, l.prevYearTotal).toFixed(1) + "%"])
    );
    rows.push(["", "إجمالي المصروفات", fmtN(totalExpenses), fmtN(prevExpenses), changePercent(totalExpenses, prevExpenses).toFixed(1) + "%"]);
    rows.push(["", "", "", "", ""]);
    rows.push(["", "صافي الربح / الخسارة", fmtN(netProfit), fmtN(prevNetProfit), changePercent(netProfit, prevNetProfit).toFixed(1) + "%"]);

    await exportReportPdf({
      title: `تقرير الأرباح والخسائر - ${year}`,
      settings: settings!,
      headers,
      rows,
      summaryCards: [
        { label: "إجمالي الإيرادات", value: fmtN(totalRevenue) },
        { label: "إجمالي المصروفات", value: fmtN(totalExpenses) },
        { label: "صافي الربح", value: fmtN(netProfit) },
        { label: "هامش الربح", value: profitMargin.toFixed(1) + "%" },
      ],
      filename: `تقرير-الأرباح-والخسائر-${year}`,
      orientation: "portrait",
    });
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-36 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleExcelExport}>
          <FileSpreadsheet className="w-4 h-4 ml-2" />
          Excel
        </Button>
        <Button variant="outline" size="sm" onClick={handlePdfExport}>
          <FileText className="w-4 h-4 ml-2" />
          PDF
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">إجمالي الإيرادات</p>
            <p className="text-lg font-bold text-success">{fmt(totalRevenue)}</p>
            <div className="flex items-center justify-center gap-1 mt-1">
              <TrendIcon value={changePercent(totalRevenue, prevRevenue)} />
              <span className="text-[11px] text-muted-foreground">
                {changePercent(totalRevenue, prevRevenue).toFixed(1)}% عن {year - 1}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">إجمالي المصروفات</p>
            <p className="text-lg font-bold text-destructive">{fmt(totalExpenses)}</p>
            <div className="flex items-center justify-center gap-1 mt-1">
              <TrendIcon value={-changePercent(totalExpenses, prevExpenses)} />
              <span className="text-[11px] text-muted-foreground">
                {changePercent(totalExpenses, prevExpenses).toFixed(1)}% عن {year - 1}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">صافي الربح / الخسارة</p>
            <p className={`text-lg font-bold ${netProfit >= 0 ? "text-success" : "text-destructive"}`}>
              {fmt(netProfit)}
              <span className="text-xs mr-1">{netProfit >= 0 ? "ربح" : "خسارة"}</span>
            </p>
            <div className="flex items-center justify-center gap-1 mt-1">
              <TrendIcon value={changePercent(netProfit, prevNetProfit)} />
              <span className="text-[11px] text-muted-foreground">
                {changePercent(netProfit, prevNetProfit).toFixed(1)}% عن {year - 1}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">هامش الربح</p>
            <p className={`text-lg font-bold ${profitMargin >= 0 ? "text-success" : "text-destructive"}`}>
              {profitMargin.toFixed(1)}%
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">من إجمالي الإيرادات</p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Comparison Table */}
      <Card className="border-border/60 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">المقارنة الشهرية</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-xs sticky right-0 bg-muted/30 z-10 min-w-[100px]">البند</TableHead>
                  {monthColumns.map((m) => (
                    <TableHead key={m.key} className="text-xs text-center min-w-[90px]">
                      {m.label}
                    </TableHead>
                  ))}
                  <TableHead className="text-xs text-center min-w-[100px] font-bold">الإجمالي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-success/5">
                  <TableCell className="text-sm font-bold sticky right-0 bg-success/5 z-10">الإيرادات</TableCell>
                  {revenueByMonth.map((v, i) => (
                    <TableCell key={i} className="text-sm text-center">
                      {v > 0 ? formatCurrency(v) : "-"}
                    </TableCell>
                  ))}
                  <TableCell className="text-sm text-center font-bold text-success">{formatCurrency(totalRevenue)}</TableCell>
                </TableRow>
                <TableRow className="bg-destructive/5">
                  <TableCell className="text-sm font-bold sticky right-0 bg-destructive/5 z-10">المصروفات</TableCell>
                  {expenseByMonth.map((v, i) => (
                    <TableCell key={i} className="text-sm text-center">
                      {v > 0 ? formatCurrency(v) : "-"}
                    </TableCell>
                  ))}
                  <TableCell className="text-sm text-center font-bold text-destructive">{formatCurrency(totalExpenses)}</TableCell>
                </TableRow>
                <TableRow className="bg-muted/40 font-bold">
                  <TableCell className="text-sm font-bold sticky right-0 bg-muted/40 z-10">صافي الربح</TableCell>
                  {profitByMonth.map((v, i) => (
                    <TableCell key={i} className={`text-sm text-center font-bold ${v >= 0 ? "text-success" : "text-destructive"}`}>
                      {formatCurrency(Math.abs(v))}
                    </TableCell>
                  ))}
                  <TableCell className={`text-sm text-center font-bold ${netProfit >= 0 ? "text-success" : "text-destructive"}`}>
                    {formatCurrency(Math.abs(netProfit))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Revenue Accounts */}
      <Card className="border-border/60 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Badge variant="outline" className="bg-success/10 text-success border-success/30">الإيرادات</Badge>
            المقارنة السنوية التفصيلية
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {revenueLines.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">لا توجد إيرادات مسجلة</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-xs">الرمز</TableHead>
                  <TableHead className="text-xs">الحساب</TableHead>
                  <TableHead className="text-xs text-center">{year}</TableHead>
                  <TableHead className="text-xs text-center">{year - 1}</TableHead>
                  <TableHead className="text-xs text-center">التغيير</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revenueLines.map((l) => {
                  const change = changePercent(l.total, l.prevYearTotal);
                  return (
                    <TableRow key={l.account_id}>
                      <TableCell className="font-mono text-xs">{l.account_code}</TableCell>
                      <TableCell className="text-sm">{l.account_name}</TableCell>
                      <TableCell className="text-sm text-center">{formatCurrency(l.total)}</TableCell>
                      <TableCell className="text-sm text-center text-muted-foreground">{formatCurrency(l.prevYearTotal)}</TableCell>
                      <TableCell className="text-center">
                        <span className={`text-xs font-medium ${change >= 0 ? "text-success" : "text-destructive"}`}>
                          <TrendIcon value={change} /> {Math.abs(change).toFixed(1)}%
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-success/5 font-bold">
                  <TableCell colSpan={2} className="text-sm">إجمالي الإيرادات</TableCell>
                  <TableCell className="text-sm text-center font-bold text-success">{formatCurrency(totalRevenue)}</TableCell>
                  <TableCell className="text-sm text-center text-muted-foreground">{formatCurrency(prevRevenue)}</TableCell>
                  <TableCell className="text-center">
                    <span className={`text-xs font-bold ${changePercent(totalRevenue, prevRevenue) >= 0 ? "text-success" : "text-destructive"}`}>
                      {changePercent(totalRevenue, prevRevenue).toFixed(1)}%
                    </span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detailed Expense Accounts */}
      <Card className="border-border/60 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">المصروفات</Badge>
            المقارنة السنوية التفصيلية
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {expenseLines.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">لا توجد مصروفات مسجلة</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-xs">الرمز</TableHead>
                  <TableHead className="text-xs">الحساب</TableHead>
                  <TableHead className="text-xs text-center">{year}</TableHead>
                  <TableHead className="text-xs text-center">{year - 1}</TableHead>
                  <TableHead className="text-xs text-center">التغيير</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenseLines.map((l) => {
                  const change = changePercent(l.total, l.prevYearTotal);
                  return (
                    <TableRow key={l.account_id}>
                      <TableCell className="font-mono text-xs">{l.account_code}</TableCell>
                      <TableCell className="text-sm">{l.account_name}</TableCell>
                      <TableCell className="text-sm text-center">{formatCurrency(l.total)}</TableCell>
                      <TableCell className="text-sm text-center text-muted-foreground">{formatCurrency(l.prevYearTotal)}</TableCell>
                      <TableCell className="text-center">
                        <span className={`text-xs font-medium ${change <= 0 ? "text-success" : "text-destructive"}`}>
                          <TrendIcon value={-change} /> {Math.abs(change).toFixed(1)}%
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-destructive/5 font-bold">
                  <TableCell colSpan={2} className="text-sm">إجمالي المصروفات</TableCell>
                  <TableCell className="text-sm text-center font-bold text-destructive">{formatCurrency(totalExpenses)}</TableCell>
                  <TableCell className="text-sm text-center text-muted-foreground">{formatCurrency(prevExpenses)}</TableCell>
                  <TableCell className="text-center">
                    <span className={`text-xs font-bold ${changePercent(totalExpenses, prevExpenses) <= 0 ? "text-success" : "text-destructive"}`}>
                      {changePercent(totalExpenses, prevExpenses).toFixed(1)}%
                    </span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Net Summary */}
      <Card className={`border-2 shadow-none ${netProfit >= 0 ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"}`}>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">صافي الربح / الخسارة لعام {year}</p>
              <p className={`text-2xl font-bold mt-1 ${netProfit >= 0 ? "text-success" : "text-destructive"}`}>
                {fmt(netProfit)}
                <Badge variant="outline" className="mr-2 text-xs">
                  {netProfit >= 0 ? "ربح صافي" : "خسارة صافية"}
                </Badge>
              </p>
            </div>
            <div className="text-left">
              <p className="text-xs text-muted-foreground">مقارنة بعام {year - 1}</p>
              <p className="text-lg text-muted-foreground">{fmt(prevNetProfit)}</p>
              <div className="flex items-center gap-1 mt-1">
                <TrendIcon value={changePercent(netProfit, prevNetProfit)} />
                <span className={`text-sm font-medium ${changePercent(netProfit, prevNetProfit) >= 0 ? "text-success" : "text-destructive"}`}>
                  {Math.abs(changePercent(netProfit, prevNetProfit)).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
