import { notify } from "@/lib/notify";
import React, { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/contexts/SettingsContext";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  ArrowUpRight,
  ArrowDownRight,
  CalendarIcon,
  X,
  Banknote,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface CashFlowRow {
  label: string;
  amount: number;
}

const formatNumber = (val: number) =>
  Math.abs(val).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function CashFlowStatement() {
  const { settings, formatCurrency, currency } = useSettings();
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  const [customerPayments, setCustomerPayments] = useState(0);
  const [supplierPayments, setSupplierPayments] = useState(0);
  const [expenses, setExpenses] = useState(0);
  const [expensesByType, setExpensesByType] = useState<CashFlowRow[]>([]);
  const [customerPaymentsByMethod, setCustomerPaymentsByMethod] = useState<
    CashFlowRow[]
  >([]);
  const [supplierPaymentsByMethod, setSupplierPaymentsByMethod] = useState<
    CashFlowRow[]
  >([]);

  const fetchData = async () => {
    setLoading(true);

    const fromStr = dateFrom ? format(dateFrom, "yyyy-MM-dd") : null;
    const toStr = dateTo ? format(dateTo, "yyyy-MM-dd") : null;

    // Fetch customer payments (cash inflow)
    let cpQuery = (supabase.from("customer_payments") as any)
      .select("amount, payment_method")
      .eq("status", "posted");
    if (fromStr) cpQuery = cpQuery.gte("payment_date", fromStr);
    if (toStr) cpQuery = cpQuery.lte("payment_date", toStr);

    // Fetch supplier payments (cash outflow)
    let spQuery = (supabase.from("supplier_payments") as any)
      .select("amount, payment_method")
      .eq("status", "posted");
    if (fromStr) spQuery = spQuery.gte("payment_date", fromStr);
    if (toStr) spQuery = spQuery.lte("payment_date", toStr);

    // Fetch expenses (cash outflow)
    let expQuery = (supabase.from("expenses") as any)
      .select("amount, expense_type_id, expense_types(name)")
      .eq("status", "posted");
    if (fromStr) expQuery = expQuery.gte("expense_date", fromStr);
    if (toStr) expQuery = expQuery.lte("expense_date", toStr);

    const [cpRes, spRes, expRes] = await Promise.all([
      cpQuery,
      spQuery,
      expQuery,
    ]);

    if (cpRes.error || spRes.error || expRes.error) {
      notify.error("خطأ", "فشل في تحميل بيانات التدفقات النقدية");
    }

    const cpData = cpRes.data || [];
    const spData = spRes.data || [];
    const expData = expRes.data || [];

    // Totals
    const totalCP = cpData.reduce(
      (s: number, r: any) => s + Number(r.amount),
      0,
    );
    const totalSP = spData.reduce(
      (s: number, r: any) => s + Number(r.amount),
      0,
    );
    const totalExp = expData.reduce(
      (s: number, r: any) => s + Number(r.amount),
      0,
    );

    setCustomerPayments(totalCP);
    setSupplierPayments(totalSP);
    setExpenses(totalExp);

    // Breakdown by payment method
    const PAYMENT_METHODS: Record<string, string> = {
      cash: "نقدي",
      bank_transfer: "تحويل بنكي",
      check: "شيك",
      credit_card: "بطاقة ائتمان",
    };

    const cpByMethod = new Map<string, number>();
    cpData.forEach((r: any) => {
      const method =
        PAYMENT_METHODS[r.payment_method] || r.payment_method || "أخرى";
      cpByMethod.set(method, (cpByMethod.get(method) || 0) + Number(r.amount));
    });
    setCustomerPaymentsByMethod(
      Array.from(cpByMethod.entries())
        .map(([label, amount]) => ({ label, amount }))
        .sort((a, b) => b.amount - a.amount),
    );

    const spByMethod = new Map<string, number>();
    spData.forEach((r: any) => {
      const method =
        PAYMENT_METHODS[r.payment_method] || r.payment_method || "أخرى";
      spByMethod.set(method, (spByMethod.get(method) || 0) + Number(r.amount));
    });
    setSupplierPaymentsByMethod(
      Array.from(spByMethod.entries())
        .map(([label, amount]) => ({ label, amount }))
        .sort((a, b) => b.amount - a.amount),
    );

    // Breakdown expenses by type
    const expByType = new Map<string, number>();
    expData.forEach((r: any) => {
      const typeName = r.expense_types?.name || "غير مصنف";
      expByType.set(
        typeName,
        (expByType.get(typeName) || 0) + Number(r.amount),
      );
    });
    setExpensesByType(
      Array.from(expByType.entries())
        .map(([label, amount]) => ({ label, amount }))
        .sort((a, b) => b.amount - a.amount),
    );

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const netCashFlow = customerPayments - supplierPayments - expenses;
  const totalOutflow = supplierPayments + expenses;

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={Banknote}
        title="قائمة التدفقات النقدية"
        description="ملخص الأموال الواردة والصادرة خلال الفترة المحددة"
      />

      {/* Date filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">من تاريخ</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-44 justify-start text-right",
                      !dateFrom && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="ml-2 h-4 w-4" />
                    {dateFrom ? format(dateFrom, "yyyy-MM-dd") : "اختر التاريخ"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateFrom}
                    onSelect={setDateFrom}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">إلى تاريخ</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-44 justify-start text-right",
                      !dateTo && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="ml-2 h-4 w-4" />
                    {dateTo ? format(dateTo, "yyyy-MM-dd") : "اختر التاريخ"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={setDateTo}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <Button onClick={fetchData} disabled={loading}>
              عرض التقرير
            </Button>
            {(dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setDateFrom(undefined);
                  setDateTo(undefined);
                }}
                aria-label="مسح التاريخ"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <ArrowUpRight className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      إجمالي الوارد
                    </p>
                    <p className="text-xl font-bold text-emerald-600">
                      {formatNumber(customerPayments)} {currency}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                    <ArrowDownRight className="w-5 h-5 text-destructive" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      إجمالي الصادر
                    </p>
                    <p className="text-xl font-bold text-destructive">
                      {formatNumber(totalOutflow)} {currency}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card
              className={
                netCashFlow >= 0
                  ? "border-emerald-200"
                  : "border-destructive/40"
              }
            >
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center ${netCashFlow >= 0 ? "bg-emerald-500/10" : "bg-destructive/10"}`}
                  >
                    {netCashFlow >= 0 ? (
                      <TrendingUp className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-destructive" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      صافي التدفق النقدي
                    </p>
                    <p
                      className={`text-xl font-bold ${netCashFlow >= 0 ? "text-emerald-600" : "text-destructive"}`}
                    >
                      {netCashFlow < 0 ? "-" : ""}
                      {formatNumber(netCashFlow)} {currency}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Detail Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Inflows */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowUpRight className="w-4 h-4 text-emerald-600" />
                  تفاصيل الوارد (تحصيلات العملاء)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {customerPaymentsByMethod.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    لا توجد تحصيلات في هذه الفترة
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>طريقة الدفع</TableHead>
                        <TableHead className="text-end">المبلغ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customerPaymentsByMethod.map((row) => (
                        <TableRow key={row.label}>
                          <TableCell>{row.label}</TableCell>
                          <TableCell className="text-end font-mono">
                            {formatNumber(row.amount)} {currency}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold border-t-2">
                        <TableCell>الإجمالي</TableCell>
                        <TableCell className="text-end font-mono text-emerald-600">
                          {formatNumber(customerPayments)} {currency}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Outflows - Supplier Payments */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowDownRight className="w-4 h-4 text-destructive" />
                  تفاصيل الصادر (مدفوعات الموردين)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {supplierPaymentsByMethod.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    لا توجد مدفوعات في هذه الفترة
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>طريقة الدفع</TableHead>
                        <TableHead className="text-end">المبلغ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {supplierPaymentsByMethod.map((row) => (
                        <TableRow key={row.label}>
                          <TableCell>{row.label}</TableCell>
                          <TableCell className="text-end font-mono">
                            {formatNumber(row.amount)} {currency}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold border-t-2">
                        <TableCell>الإجمالي</TableCell>
                        <TableCell className="text-end font-mono text-destructive">
                          {formatNumber(supplierPayments)} {currency}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Outflows - Expenses */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowDownRight className="w-4 h-4 text-destructive" />
                  تفاصيل المصروفات
                </CardTitle>
              </CardHeader>
              <CardContent>
                {expensesByType.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    لا توجد مصروفات في هذه الفترة
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>نوع المصروف</TableHead>
                        <TableHead className="text-end">المبلغ</TableHead>
                        <TableHead className="text-end">النسبة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expensesByType.map((row) => (
                        <TableRow key={row.label}>
                          <TableCell>{row.label}</TableCell>
                          <TableCell className="text-end font-mono">
                            {formatNumber(row.amount)} {currency}
                          </TableCell>
                          <TableCell className="text-end font-mono text-muted-foreground">
                            {totalOutflow > 0
                              ? ((row.amount / totalOutflow) * 100).toFixed(1)
                              : "0.0"}
                            %
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold border-t-2">
                        <TableCell>الإجمالي</TableCell>
                        <TableCell className="text-end font-mono text-destructive">
                          {formatNumber(expenses)} {currency}
                        </TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
