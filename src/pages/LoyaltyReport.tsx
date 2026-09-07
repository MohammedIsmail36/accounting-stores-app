import { useEffect, useMemo, useState } from "react";
import { StatCard } from "@/components/StatCard";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DatePickerInput } from "@/components/DatePickerInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/contexts/SettingsContext";
import { useUserRole } from "@/hooks/use-user-role";
import {
  Gift,
  TrendingUp,
  TrendingDown,
  Users,
  Wallet,
  ArrowUp,
  ArrowDown,
  Settings2,
  Trophy,
  Search,
  SlidersHorizontal,
  Sparkles,
  Moon,
} from "lucide-react";
import { round2, cn } from "@/lib/utils";
import { aggregateByCustomer, aggregateTotals } from "@/lib/loyalty-aggregation";
import { ExportMenu } from "@/components/ExportMenu";
import { notify } from "@/lib/notify";
interface TxRow {
  customer_id: string;
  points: number;
  type: string;
  transaction_date: string;
}
interface CustomerLite {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  loyalty_points: number;
}

interface Row {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  earned_in_period: number;
  redeemed_in_period: number;
  net_in_period: number;
  current_balance: number;
  last_activity: string | null;
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

type PresetKey = "all" | "year" | "month" | "30d" | "custom";

export default function LoyaltyReport() {
  const { settings, formatCurrency } = useSettings();
  const { data: role } = useUserRole();
  const isAdmin = role === "admin";
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + "01";
  const firstOfYear = today.slice(0, 4) + "-01-01";
  const last30 = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();
  const ALL_TIME_FROM = "1900-01-01";

  // Default: all time
  const [preset, setPreset] = useState<PresetKey>("all");
  const [dateFrom, setDateFrom] = useState<string>(ALL_TIME_FROM);
  const [dateTo, setDateTo] = useState<string>(today);
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [customers, setCustomers] = useState<CustomerLite[]>([]);

  const pointsPerRedeem = Number(settings?.loyalty_points_per_redeem) || 100;
  const redeemValue = Number(settings?.loyalty_redeem_value) || 0;
  const pointValue = pointsPerRedeem > 0 ? redeemValue / pointsPerRedeem : 0;

  function applyPreset(p: PresetKey) {
    setPreset(p);
    if (p === "all") {
      setDateFrom(ALL_TIME_FROM);
      setDateTo(today);
    } else if (p === "year") {
      setDateFrom(firstOfYear);
      setDateTo(today);
    } else if (p === "month") {
      setDateFrom(firstOfMonth);
      setDateTo(today);
    } else if (p === "30d") {
      setDateFrom(last30);
      setDateTo(today);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  async function load() {
    setLoading(true);
    const [txRes, custRes] = await Promise.all([
      (supabase.from("loyalty_transactions") as any)
        .select("customer_id, points, type, transaction_date")
        .gte("transaction_date", dateFrom)
        .lte("transaction_date", dateTo),
      (supabase.from("customers") as any)
        .select("id, code, name, phone, loyalty_points")
        .eq("is_active", true),
    ]);
    setTxs((txRes.data as TxRow[]) || []);
    setCustomers((custRes.data as CustomerLite[]) || []);
    setLoading(false);
  }

  // Period KPIs
  const periodKpis = useMemo(() => {
    const totals = aggregateTotals(txs);
    const activeSet = new Set<string>();
    for (const t of txs) activeSet.add(t.customer_id);
    return {
      earned: totals.earned,
      redeemed: totals.redeemed,
      activeCount: activeSet.size,
    };
  }, [txs]);

  // System-wide outstanding (all customers, regardless of period filter)
  const outstanding = useMemo(() => {
    let total = 0;
    let holders = 0;
    for (const c of customers) {
      const b = c.loyalty_points || 0;
      if (b > 0) {
        total += b;
        holders += 1;
      }
    }
    return { total, holders };
  }, [customers]);

  // Last activity per customer (within current period window)
  const lastActivityByCustomer = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of txs) {
      const prev = m.get(t.customer_id);
      if (!prev || t.transaction_date > prev) m.set(t.customer_id, t.transaction_date);
    }
    return m;
  }, [txs]);

  // Build full rows: every active customer with activity in period OR with current balance > 0
  const allRows = useMemo<Row[]>(() => {
    const byCustomer = aggregateByCustomer(txs);
    const rows: Row[] = [];
    for (const c of customers) {
      const agg = byCustomer.get(c.id);
      const earned = agg?.earned || 0;
      const redeemed = agg?.redeemed || 0;
      const balance = c.loyalty_points || 0;
      const hasActivity = !!agg;
      if (!hasActivity && balance <= 0) continue;
      rows.push({
        id: c.id,
        code: c.code,
        name: c.name,
        phone: c.phone,
        earned_in_period: earned,
        redeemed_in_period: redeemed,
        net_in_period: earned - redeemed,
        current_balance: balance,
        last_activity: lastActivityByCustomer.get(c.id) || null,
      });
    }
    rows.sort((a, b) => b.current_balance - a.current_balance);
    return rows;
  }, [txs, customers, lastActivityByCustomer]);

  // Apply search + activeOnly
  const filteredRows = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return allRows.filter((r) => {
      if (activeOnly && r.earned_in_period === 0 && r.redeemed_in_period === 0) return false;
      if (!q) return true;
      const name = r.name.toLowerCase();
      const code = r.code.toLowerCase();
      const phone = (r.phone || "").replace(/\s+/g, "");
      if (name.includes(q) || code.includes(q)) return true;
      if (qDigits && phone.includes(qDigits)) return true;
      return false;
    });
  }, [allRows, search, activeOnly]);

  const maxEarned = useMemo(
    () => Math.max(1, ...filteredRows.map((r) => r.earned_in_period)),
    [filteredRows],
  );

  // Dormant threshold (90 days ago)
  const dormantCutoff = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  })();

  async function applyAdjustment(
    customer: Row,
    delta: number,
    reason: string,
  ): Promise<boolean> {
    if (!delta || isNaN(delta)) return false;
    const newBalance = (customer.current_balance || 0) + delta;
    if (newBalance < 0) {
      notify.error("غير مسموح", "الرصيد الناتج سيكون سالباً");
      return false;
    }
    try {
      const { error: txErr } = await (supabase.from("loyalty_transactions") as any).insert({
        customer_id: customer.id,
        points: delta,
        type: "manual_adjust",
        transaction_date: today,
        notes: reason || "تعديل يدوي",
      });
      if (txErr) throw txErr;
      const { error: cErr } = await (supabase.from("customers") as any)
        .update({ loyalty_points: newBalance })
        .eq("id", customer.id);
      if (cErr) throw cErr;
      notify.success("تم التعديل", `${customer.name}: ${delta > 0 ? "+" : ""}${delta} نقطة`);
      await load();
      return true;
    } catch (e: any) {
      notify.error("خطأ", e.message);
      return false;
    }
  }

  const columns: ColumnDef<Row, any>[] = [
    {
      accessorKey: "name",
      header: "العميل",
      cell: ({ row }) => {
        const r = row.original;
        const ready = r.current_balance >= pointsPerRedeem && pointsPerRedeem > 0;
        const dormant =
          r.last_activity !== null && r.last_activity < dormantCutoff && r.current_balance > 0;
        const neverActive = r.last_activity === null && r.current_balance > 0;
        return (
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
              {initials(r.name)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-foreground truncate">{r.name}</span>
                {ready && (
                  <Badge
                    variant="outline"
                    className="h-5 px-1.5 text-[10px] gap-0.5 border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50"
                  >
                    <Sparkles className="h-2.5 w-2.5" /> جاهز للاستبدال
                  </Badge>
                )}
                {(dormant || neverActive) && (
                  <Badge
                    variant="outline"
                    className="h-5 px-1.5 text-[10px] gap-0.5 border-slate-300 bg-slate-50 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400 dark:border-slate-700"
                  >
                    <Moon className="h-2.5 w-2.5" /> خامل
                  </Badge>
                )}
              </div>
              <div className="text-[11px] font-mono text-muted-foreground flex items-center gap-2">
                <span>{r.code}</span>
                {r.phone && <span className="text-muted-foreground/70">• {r.phone}</span>}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "earned_in_period",
      header: ({ column }) => <DataTableColumnHeader column={column} title="مكتسبة" />,
      cell: ({ row }) => {
        const v = row.original.earned_in_period;
        if (v === 0) return <span className="text-xs text-muted-foreground/50">—</span>;
        const pct = Math.round((v / maxEarned) * 100);
        return (
          <div className="space-y-1 min-w-[110px]">
            <div className="flex items-center gap-1.5">
              <ArrowUp className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
              <span className="font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                {v.toLocaleString()}
              </span>
            </div>
            <div className="h-1 w-full rounded-full bg-emerald-100 dark:bg-emerald-950/40 overflow-hidden">
              <div
                className="h-full bg-emerald-500 dark:bg-emerald-400 rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "redeemed_in_period",
      header: ({ column }) => <DataTableColumnHeader column={column} title="مستبدلة" />,
      cell: ({ row }) => {
        const v = row.original.redeemed_in_period;
        if (v === 0) return <span className="text-xs text-muted-foreground/50">—</span>;
        return (
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200/60 dark:border-amber-900/40">
            <ArrowDown className="h-3 w-3" />
            <span className="font-mono tabular-nums text-sm font-semibold">
              {v.toLocaleString()}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "current_balance",
      header: ({ column }) => <DataTableColumnHeader column={column} title="الرصيد الحالي" />,
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono tabular-nums text-base font-bold text-foreground">
              {row.original.current_balance.toLocaleString()}
            </span>
            <span className="text-[10px] text-muted-foreground font-medium">نقطة</span>
          </div>
          {pointValue > 0 && (
            <div className="text-[11px] text-muted-foreground font-mono">
              ≈ {formatCurrency(round2(row.original.current_balance * pointValue))}
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "last_activity",
      header: ({ column }) => <DataTableColumnHeader column={column} title="آخر نشاط" />,
      cell: ({ row }) => {
        const d = row.original.last_activity;
        if (!d) return <span className="text-xs text-muted-foreground/50">—</span>;
        return <span className="text-xs font-mono text-muted-foreground tabular-nums">{d}</span>;
      },
    },
    ...(isAdmin
      ? [
          {
            id: "actions",
            header: "",
            cell: ({ row }: any) => <AdjustPopover customer={row.original} onApply={applyAdjustment} />,
          } as ColumnDef<Row, any>,
        ]
      : []),
  ];

  if (!settings?.loyalty_enabled) {
    return (
      <div className="space-y-6" dir="rtl">
        <PageHeader icon={Gift} title="ولاء العملاء" description="نظام نقاط الولاء" />
        <div className="bg-card p-12 rounded-2xl border text-center space-y-3">
          <Gift className="h-12 w-12 mx-auto text-muted-foreground/50" />
          <p className="text-lg font-semibold">نظام الولاء غير مُفعّل</p>
          <p className="text-sm text-muted-foreground">
            يمكن تفعيله من إعدادات الشركة ← تبويب "ولاء العملاء".
          </p>
        </div>
      </div>
    );
  }

  if (loading) return <PageSkeleton />;

  const presetLabel: Record<PresetKey, string> = {
    all: "كل الوقت",
    year: "هذه السنة",
    month: "هذا الشهر",
    "30d": "آخر 30 يوم",
    custom: "فترة مخصصة",
  };

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={Gift}
        title="ولاء العملاء"
        description="نقاط الولاء — أرصدة العملاء وحركة الفترة"
      />

      {/* Filters */}
      <div className="bg-card p-4 rounded-2xl border shadow-sm flex flex-wrap items-center gap-2">
        {(["all", "year", "month", "30d"] as PresetKey[]).map((k) => (
          <Button
            key={k}
            variant={preset === k ? "default" : "outline"}
            size="sm"
            onClick={() => applyPreset(k)}
          >
            {presetLabel[k]}
          </Button>
        ))}

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              فلاتر متقدمة
              {preset === "custom" && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px] ml-1">
                  مفعّل
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 space-y-3" dir="rtl">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold">فترة مخصصة</p>
              <p className="text-[11px] text-muted-foreground">حدد نطاق تاريخ يدوي</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground font-medium">من تاريخ</label>
                <DatePickerInput
                  value={dateFrom}
                  onChange={(v) => {
                    setPreset("custom");
                    setDateFrom(v);
                  }}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground font-medium">إلى تاريخ</label>
                <DatePickerInput
                  value={dateTo}
                  onChange={(v) => {
                    setPreset("custom");
                    setDateTo(v);
                  }}
                />
              </div>
            </div>
            <Button variant="ghost" size="sm" className="w-full" onClick={() => applyPreset("all")}>
              إعادة إلى «كل الوقت»
            </Button>
          </PopoverContent>
        </Popover>

        <div className="text-[11px] text-muted-foreground mr-auto font-mono">
          الفترة: {presetLabel[preset]}
          {preset !== "all" && (
            <span className="text-muted-foreground/70">
              {" "}
              ({dateFrom} ← {dateTo})
            </span>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard
          icon={Wallet}
          label="إجمالي الرصيد المعلَّق"
          value={outstanding.total.toLocaleString()}
          sub={
            pointValue > 0
              ? `≈ ${formatCurrency(round2(outstanding.total * pointValue))} • ${outstanding.holders} عميل`
              : `${outstanding.holders} عميل`
          }
          tone="primary"
        />
        <KpiCard
          icon={TrendingUp}
          label="نقاط مكتسبة (الفترة)"
          value={periodKpis.earned.toLocaleString()}
          sub={pointValue > 0 ? `≈ ${formatCurrency(round2(periodKpis.earned * pointValue))}` : ""}
          tone="emerald"
        />
        <KpiCard
          icon={TrendingDown}
          label="نقاط مستبدلة (الفترة)"
          value={periodKpis.redeemed.toLocaleString()}
          sub={pointValue > 0 ? `≈ ${formatCurrency(round2(periodKpis.redeemed * pointValue))}` : ""}
          tone="amber"
        />
        <KpiCard
          icon={Users}
          label="عملاء نشطون (الفترة)"
          value={periodKpis.activeCount.toLocaleString()}
          sub={`من إجمالي ${outstanding.holders} برصيد`}
          tone="primary"
        />
      </div>

      {/* Customers table */}
      <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/20 gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Trophy className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-bold text-foreground leading-tight">عملاء برنامج الولاء</h3>
              <p className="text-[11px] text-muted-foreground">
                {filteredRows.length.toLocaleString()} عميل
                {search && ` • نتائج البحث عن "${search}"`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث بالاسم أو الكود أو الهاتف..."
                className="h-9 w-64 pr-8"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <Switch checked={activeOnly} onCheckedChange={setActiveOnly} />
              نشاط فقط
            </label>
            <ExportMenu
              config={{
                filenamePrefix: "loyalty-customers",
                sheetName: "Loyalty",
                pdfTitle: `عملاء برنامج الولاء — ${presetLabel[preset]}`,
                headers: [
                  "الكود",
                  "العميل",
                  "الهاتف",
                  "مكتسبة",
                  "مستبدلة",
                  "صافي",
                  "الرصيد الحالي",
                  "آخر نشاط",
                ],
                rows: filteredRows.map((r) => [
                  r.code,
                  r.name,
                  r.phone || "",
                  r.earned_in_period,
                  r.redeemed_in_period,
                  r.net_in_period,
                  r.current_balance,
                  r.last_activity || "",
                ]),
                settings,
              }}
            />
          </div>
        </div>
        <div className="p-4">
          <DataTable
            columns={columns}
            data={filteredRows}
            emptyMessage={
              search
                ? "لا توجد نتائج مطابقة للبحث"
                : "لا يوجد عملاء برنامج الولاء بهذه الفلاتر"
            }
            showSearch={false}
            showColumnToggle={false}
            showPagination={true}
          />
        </div>
      </div>
    </div>
  );
}

function AdjustPopover({
  customer,
  onApply,
}: {
  customer: Row;
  onApply: (c: Row, delta: number, reason: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"add" | "sub">("add");
  const [amount, setAmount] = useState<string>("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const amt = parseInt(amount, 10);
  const valid = !isNaN(amt) && amt > 0;
  const delta = mode === "add" ? amt : -amt;
  const newBalance = customer.current_balance + (valid ? delta : 0);
  const willBeNegative = valid && newBalance < 0;

  async function handleSave() {
    if (!valid || willBeNegative) return;
    setSaving(true);
    const ok = await onApply(customer, delta, reason.trim());
    setSaving(false);
    if (ok) {
      setOpen(false);
      setAmount("");
      setReason("");
      setMode("add");
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="تعديل النقاط">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3" dir="rtl">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">تعديل يدوي للنقاط</p>
          <p className="text-[11px] text-muted-foreground">
            الرصيد الحالي: <span className="font-mono font-bold">{customer.current_balance}</span> نقطة
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1.5 p-1 bg-muted rounded-lg">
          <button
            type="button"
            onClick={() => setMode("add")}
            className={cn(
              "py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1",
              mode === "add"
                ? "bg-emerald-500 text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ArrowUp className="h-3 w-3" /> إضافة
          </button>
          <button
            type="button"
            onClick={() => setMode("sub")}
            className={cn(
              "py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1",
              mode === "sub"
                ? "bg-amber-500 text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ArrowDown className="h-3 w-3" /> خصم
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] text-muted-foreground font-medium">عدد النقاط</label>
          <Input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="مثال: 50"
            className="h-9 font-mono"
            error={willBeNegative}
          />
          {willBeNegative && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400">
              الرصيد الناتج سيكون سالباً
            </p>
          )}
          {valid && !willBeNegative && (
            <p className="text-[11px] text-muted-foreground">
              الرصيد بعد التعديل:{" "}
              <span className="font-mono font-semibold text-foreground">{newBalance}</span>
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] text-muted-foreground font-medium">السبب (اختياري)</label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="مثال: تسوية، خطأ، حملة..."
            className="h-9"
            maxLength={120}
          />
        </div>

        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="flex-1"
            disabled={!valid || willBeNegative || saving}
            onClick={handleSave}
          >
            {saving ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            إلغاء
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  tone: "primary" | "emerald" | "amber" | "rose";
}) {
  return <StatCard size="lg" icon={icon} label={label} value={value} sub={sub} tone={tone} />;
}
