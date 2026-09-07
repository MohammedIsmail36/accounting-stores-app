import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { notify } from "@/lib/notify";
import { Send, Loader2, Save, Info, PlugZap, RotateCcw } from "lucide-react";
import { FunctionsHttpError } from "@supabase/supabase-js";

interface Row {
  id: string;
  bot_token_hint: string | null;
  channel_id: string | null;
  is_enabled: boolean;
  message_template: string;
  show_price: boolean;
  show_stock: boolean;
  price_source: string | null;
}

const DEFAULT_TEMPLATE = [
  "المنتج: <b>{name}</b>",
  "العلامة التجارية: <b>{brand}</b>",
  "رقم الموديل: <code>{model}</code>",
  "كود المنتج: <code>{code}</code>",
  "السعر: <b>{price}</b>",
  "المتوفر: <b>{stock}</b>",
  "الوصف: {description}",
].join("\n");

export function TelegramSettingsTab({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [row, setRow] = useState<Row | null>(null);
  const [newToken, setNewToken] = useState("");
  const [channelId, setChannelId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [showPrice, setShowPrice] = useState(true);
  const [showStock, setShowStock] = useState(false);
  const [priceSource, setPriceSource] = useState<"selling" | "barcode">("selling");

  const load = async () => {
    const { data } = await (supabase.from("telegram_settings" as any) as any)
      .select("id, bot_token_hint, channel_id, is_enabled, message_template, show_price, show_stock, price_source")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const r = (data as Row) || null;
    setRow(r);
    setChannelId(r?.channel_id ?? "");
    setEnabled(!!r?.is_enabled);
    setTemplate(r?.message_template ?? DEFAULT_TEMPLATE);
    setShowPrice(r?.show_price ?? true);
    setShowStock(r?.show_stock ?? false);
    setPriceSource(r?.price_source === "barcode" ? "barcode" : "selling");
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!channelId.trim()) {
      notify.error("أدخل معرّف القناة (مثال: @my_channel أو -1001234567890)");
      return;
    }
    if (!row?.bot_token_hint && !newToken.trim()) {
      notify.error("أدخل توكن البوت أولاً");
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      channel_id: channelId.trim(),
      is_enabled: enabled,
      message_template: template,
      show_price: showPrice,
      show_stock: showStock,
      price_source: priceSource,
    };
    if (newToken.trim()) payload.bot_token = newToken.trim();

    const { error } = row
      ? await (supabase.from("telegram_settings" as any) as any).update(payload).eq("id", row.id)
      : await (supabase.from("telegram_settings" as any) as any).insert(payload);

    setSaving(false);
    if (error) {
      notify.error("فشل حفظ إعدادات تيليجرام: " + error.message);
      return;
    }
    setNewToken("");
    notify.success("تم حفظ إعدادات تيليجرام");
    await load();
    queryClient.invalidateQueries({ queryKey: ["telegram-settings-public"] });
  };

  const test = async () => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-publish", {
        body: { action: "test" },
      });
      if (error) {
        let details = error.message;
        if (error instanceof FunctionsHttpError) {
          const raw = await error.context.text();
          try {
            details = JSON.parse(raw)?.error || raw;
          } catch {
            details = raw;
          }
        }
        throw new Error(details);
      }
      notify.success(`تم الاتصال بنجاح عبر البوت @${(data as any)?.bot ?? ""} وإرسال رسالة اختبار للقناة`);
    } catch (e) {
      notify.error("فشل الاتصال: " + (e instanceof Error ? e.message : "خطأ غير معروف"));
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="bg-card p-6 rounded-2xl border border-border text-sm text-muted-foreground">
        إعدادات تيليجرام متاحة للمدير فقط.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-card p-6 rounded-2xl border border-border shadow-sm space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Send className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold text-foreground">ربط قناة تيليجرام</h3>
            <p className="text-xs text-muted-foreground">
              لنشر المنتجات من صفحة المنتجات مباشرة إلى قناتك. أضف البوت كمشرف (Admin) في القناة أولاً.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl border border-border">
          <div>
            <Label className="text-sm font-bold">تفعيل النشر على تيليجرام</Label>
            <p className="text-xs text-muted-foreground mt-1">عند الإيقاف يتم تعطيل زر النشر في صفحة المنتجات.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label className="text-sm font-bold">توكن البوت (Bot Token)</Label>
            <Input
              type="password"
              autoComplete="new-password"
              placeholder={row?.bot_token_hint ? `محفوظ — ينتهي بـ ****${row.bot_token_hint}` : "123456:ABC-DEF..."}
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              يُخزّن بشكل مشفّر على السيرفر ولا يظهر مرة أخرى. اتركه فارغاً للإبقاء على التوكن الحالي.
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-bold">معرّف القناة (Channel ID)</Label>
            <Input
              dir="ltr"
              placeholder="@my_channel أو -1001234567890"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">للقنوات العامة استخدم @username، وللخاصة الرقم السالب.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between p-3 bg-muted/20 rounded-xl border border-border">
            <Label className="text-sm font-bold">إظهار السعر في المنشور</Label>
            <Switch checked={showPrice} onCheckedChange={setShowPrice} />
          </div>
          <div className="space-y-2 p-3 bg-muted/20 rounded-xl border border-border md:col-span-2">
            <Label className="text-sm font-bold">السعر المنشور</Label>
            <Select
              value={priceSource}
              onValueChange={(v) => setPriceSource(v as "selling" | "barcode")}
              disabled={!showPrice}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="selling">سعر البيع</SelectItem>
                <SelectItem value="barcode">سعر الباركود</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              في حال اختيار سعر الباركود ولم يكن محدداً للمنتج، يُستخدم سعر البيع تلقائياً.
            </p>
          </div>
          <div className="flex items-center justify-between p-3 bg-muted/20 rounded-xl border border-border">
            <Label className="text-sm font-bold">إظهار الكمية المتاحة</Label>
            <Switch checked={showStock} onCheckedChange={setShowStock} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm font-bold">قالب نص المنشور</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-2 text-xs"
              onClick={() => setTemplate(DEFAULT_TEMPLATE)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              استعادة القالب المقترح
            </Button>
          </div>
          <Textarea
            rows={8}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="font-mono text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
          <Button onClick={save} disabled={saving} className="gap-2 font-bold">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            حفظ إعدادات تيليجرام
          </Button>
          <Button
            variant="outline"
            onClick={test}
            disabled={testing || !row?.bot_token_hint || !row?.channel_id}
            className="gap-2 font-bold"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
            اختبار الاتصال
          </Button>
          {!row?.bot_token_hint && (
            <span className="text-xs text-muted-foreground">احفظ التوكن أولاً لتمكين الاختبار.</span>
          )}
        </div>
      </div>
    </div>
  );
}
