import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer } from "lucide-react";
import {
  buildPrintHtml,
  DEFAULT_SIZE_KEY,
  printLabels,
  PRESET_SIZES,
  renderLabelHtml,
  type LabelProduct,
  type LabelSize,
} from "@/lib/barcode-label";
import { useCompanySettingsQuery } from "@/hooks/use-company-settings";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: LabelProduct[];
}

export function BarcodePrintDialog({ open, onOpenChange, products }: Props) {
  const { data: settings } = useCompanySettingsQuery();
  const currency = ((settings as any)?.default_currency || "EGP").toString().toUpperCase();

  const [sizeKey, setSizeKey] = useState<string>(DEFAULT_SIZE_KEY);
  const [customW, setCustomW] = useState<number>(40);
  const [customH, setCustomH] = useState<number>(30);
  const [showName, setShowName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showCode, setShowCode] = useState(true);
  const [copies, setCopies] = useState<number>(1);

  const size: LabelSize = useMemo(() => {
    if (sizeKey === "custom") return { widthMm: customW, heightMm: customH };
    return PRESET_SIZES[sizeKey] ?? PRESET_SIZES[DEFAULT_SIZE_KEY];
  }, [sizeKey, customW, customH]);

  const opts = { size, showName, showPrice, showCode, currency };

  const previewHtml = useMemo(() => {
    if (!products.length) return "";
    return renderLabelHtml(products[0], opts);
  }, [products, opts]);

  const handlePrint = () => {
    if (!products.length) return;
    const items = products.map((product) => ({ product, copies: Math.max(1, copies) }));
    const html = buildPrintHtml(items, opts);
    printLabels(html);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>طباعة ملصقات الباركود</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>مقاس الملصق</Label>
              <Select value={sizeKey} onValueChange={setSizeKey}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(PRESET_SIZES).map((k) => (
                    <SelectItem key={k} value={k}>
                      {k} مم
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">مخصص…</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {sizeKey === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>العرض (مم)</Label>
                  <Input
                    type="number"
                    min={10}
                    value={customW}
                    onChange={(e) => setCustomW(Number(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>الارتفاع (مم)</Label>
                  <Input
                    type="number"
                    min={10}
                    value={customH}
                    onChange={(e) => setCustomH(Number(e.target.value) || 0)}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>عدد النسخ لكل منتج</Label>
              <Input
                type="number"
                min={1}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <Label>إظهار الاسم</Label>
                <Switch checked={showName} onCheckedChange={setShowName} />
              </div>
              <div className="flex items-center justify-between">
                <Label>إظهار السعر</Label>
                <Switch checked={showPrice} onCheckedChange={setShowPrice} />
              </div>
              <div className="flex items-center justify-between">
                <Label>إظهار كود المنتج</Label>
                <Switch checked={showCode} onCheckedChange={setShowCode} />
              </div>
            </div>

            <div className="text-xs text-muted-foreground pt-2">
              عدد المنتجات: {products.length} — إجمالي الملصقات: {products.length * Math.max(1, copies)}
            </div>
          </div>

          <div className="space-y-2">
            <Label>معاينة (بالحجم الطبيعي)</Label>
            <div className="border rounded-md p-3 bg-muted/30 flex items-center justify-center overflow-auto min-h-[180px]">
              {previewHtml ? (
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              ) : (
                <span className="text-sm text-muted-foreground">لا توجد منتجات</span>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={handlePrint} disabled={!products.length}>
            <Printer className="w-4 h-4 ml-2" />
            طباعة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BarcodePrintDialog;
