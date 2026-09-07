import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Wand2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { round2 } from "@/lib/utils";
import { useSettings } from "@/contexts/SettingsContext";
import { notify } from "@/lib/notify";
import { fetchAllPaged } from "@/lib/paged-fetch";


interface Row {
  id: string;
  code: string;
  name: string;
  qty_on_hand: number;
  movement_qty: number;
  movement_value: number;
  purchase_price: number;
  wac: number;
  qty_diff: number;
  legacy_value: number; // WAC × qty_on_hand (الطريقة القديمة)
  clean_value: number; // net from movements only
  value_diff: number;
}

export default function InventoryReconciliationPage() {
  const { formatCurrency } = useSettings();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [onlyMismatch, setOnlyMismatch] = useState(true);
  const [confirmRow, setConfirmRow] = useState<Row | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      // جلب كل الصفوف على دفعات (تجاوز حد 1000 صف) حتى لا تُقارن الكميات بسجل حركات ناقص
      const [products, moves] = await Promise.all([
        fetchAllPaged<any>(() =>
          supabase
            .from("products")
            .select("id, code, name, quantity_on_hand, purchase_price", { count: "exact" })
            .eq("is_active", true)
            .order("id", { ascending: true })
        ),
        fetchAllPaged<any>(() =>
          supabase
            .from("inventory_movements")
            .select("product_id, quantity, total_cost, movement_type", { count: "exact" })
            .order("id", { ascending: true })
        ),
      ]);


      const agg = new Map<
        string,
        { qty: number; value: number; wacQty: number; wacCost: number }
      >();
      (moves || []).forEach((m: any) => {
        const cur = agg.get(m.product_id) || {
          qty: 0,
          value: 0,
          wacQty: 0,
          wacCost: 0,
        };
        const q = Number(m.quantity || 0);
        const c = Number(m.total_cost || 0);
        const t = m.movement_type;
        if (t === "purchase" || t === "opening_balance") {
          cur.qty += q;
          cur.value += c;
          cur.wacQty += q;
          cur.wacCost += c;
        } else if (t === "sale_return") {
          cur.qty += q;
          cur.value += c;
        } else if (t === "sale" || t === "purchase_return") {
          cur.qty -= q;
          cur.value -= c;
        } else if (t === "adjustment") {
          // quantity signed, total_cost positive
          cur.qty += q;
          cur.value += q < 0 ? -c : c;
        }
        agg.set(m.product_id, cur);
      });

      const out: Row[] = (products || []).map((p: any) => {
        const a = agg.get(p.id) || { qty: 0, value: 0, wacQty: 0, wacCost: 0 };
        const wac = a.wacQty > 0 ? a.wacCost / a.wacQty : Number(p.purchase_price || 0);
        const qtyOnHand = Number(p.quantity_on_hand || 0);
        const legacy = round2(qtyOnHand * wac);
        const clean = round2(a.value);
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          qty_on_hand: qtyOnHand,
          movement_qty: a.qty,
          movement_value: clean,
          purchase_price: Number(p.purchase_price || 0),
          wac,
          qty_diff: round2(qtyOnHand - a.qty),
          legacy_value: legacy,
          clean_value: clean,
          value_diff: round2(legacy - clean),
        };
      });
      out.sort(
        (a, b) => Math.abs(b.value_diff) - Math.abs(a.value_diff) || a.code.localeCompare(b.code),
      );
      setRows(out);
    } catch (e: any) {
      notify.error("خطأ في التحميل", e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const summary = useMemo(() => {
    const legacy = rows.reduce((s, r) => s + r.legacy_value, 0);
    const clean = rows.reduce((s, r) => s + r.clean_value, 0);
    const mismatchCount = rows.filter((r) => Math.abs(r.value_diff) >= 0.01).length;
    return {
      legacy: round2(legacy),
      clean: round2(clean),
      diff: round2(legacy - clean),
      mismatchCount,
      total: rows.length,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyMismatch && Math.abs(r.value_diff) < 0.01) return false;
      if (!q) return true;
      return (
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q)
      );
    });
  }, [rows, search, onlyMismatch]);

  const syncRow = async (row: Row) => {
    setBusyId(row.id);
    try {
      const { error } = await supabase
        .from("products")
        .update({ quantity_on_hand: row.movement_qty })
        .eq("id", row.id);
      if (error) throw error;
      notify.success("تمت المزامنة", `تم تعديل كمية ${row.code} من ${row.qty_on_hand} إلى ${row.movement_qty}`);
      await load();
    } catch (e: any) {
      notify.error("فشلت المزامنة", e.message);
    } finally {
      setBusyId(null);
      setConfirmRow(null);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={RefreshCw}
        title="تسوية المخزون (تشخيصية)"
        description="مقارنة بين كمية المنتج المسجلة في كارت المنتج ومجموع حركات المخزون الفعلية، لكشف مصدر أي فارق في قيمة المخزون"
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              قيمة المخزون من الحركات (الصحيح = رصيد 1104)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.clean)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              قيمة المخزون بالطريقة القديمة (WAC × الكمية)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.legacy)}</div>
          </CardContent>
        </Card>
        <Card
          className={
            Math.abs(summary.diff) >= 0.01 ? "border-destructive/50" : "border-emerald-500/40"
          }
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              {Math.abs(summary.diff) >= 0.01 ? (
                <AlertTriangle className="w-4 h-4 text-destructive" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              )}
              الفارق
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                Math.abs(summary.diff) >= 0.01 ? "text-destructive" : "text-emerald-600"
              }`}
            >
              {formatCurrency(summary.diff)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              منتجات غير متطابقة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary.mismatchCount}{" "}
              <span className="text-sm text-muted-foreground font-normal">
                من {summary.total}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="بحث بالكود أو الاسم..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Button
          variant={onlyMismatch ? "default" : "outline"}
          size="sm"
          onClick={() => setOnlyMismatch((v) => !v)}
        >
          {onlyMismatch ? "عرض الكل" : "المتباينة فقط"}
        </Button>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ml-1 ${loading ? "animate-spin" : ""}`} />
          تحديث
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-600 mb-2" />
              لا توجد فروق — المخزون متطابق مع الحركات
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الكود</TableHead>
                  <TableHead>المنتج</TableHead>
                  <TableHead className="text-center">كمية الكارت</TableHead>
                  <TableHead className="text-center">صافي الحركات</TableHead>
                  <TableHead className="text-center">فرق الكمية</TableHead>
                  <TableHead className="text-center">قيمة الكارت (قديمة)</TableHead>
                  <TableHead className="text-center">قيمة الحركات (صحيح)</TableHead>
                  <TableHead className="text-center">فرق القيمة</TableHead>
                  <TableHead className="text-center">إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const bad = Math.abs(r.value_diff) >= 0.01;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="text-center">{r.qty_on_hand}</TableCell>
                      <TableCell className="text-center">{r.movement_qty}</TableCell>
                      <TableCell className="text-center">
                        {r.qty_diff !== 0 ? (
                          <Badge variant="destructive">{r.qty_diff}</Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {formatCurrency(r.legacy_value)}
                      </TableCell>
                      <TableCell className="text-center">
                        {formatCurrency(r.clean_value)}
                      </TableCell>
                      <TableCell className="text-center">
                        {bad ? (
                          <span className="text-destructive font-semibold">
                            {formatCurrency(r.value_diff)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.qty_diff !== 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === r.id}
                            onClick={() => setConfirmRow(r)}
                          >
                            <Wand2 className="w-4 h-4 ml-1" />
                            مزامنة
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!confirmRow}
        onOpenChange={(o) => !o && setConfirmRow(null)}
        title="مزامنة كمية المنتج مع الحركات"
        description={
          <>
            سيتم تعديل كمية المنتج <strong>{confirmRow?.code}</strong> من{" "}
            <strong>{confirmRow?.qty_on_hand}</strong> إلى{" "}
            <strong>{confirmRow?.movement_qty}</strong> لتتطابق مع مجموع الحركات
            الفعلية. هذا الإجراء لا يُنشئ قيداً محاسبياً — استخدمه فقط لتصحيح
            انحراف قديم في كارت المنتج (بدون تعديل في المحاسبة أو الحركات).
          </>
        }
        confirmText="تأكيد المزامنة"
        onConfirm={() => confirmRow && syncRow(confirmRow)}
      />

    </div>
  );
}
