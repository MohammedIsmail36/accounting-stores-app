import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Send, CheckCircle2 } from "lucide-react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { notify } from "@/lib/notify";

export interface TelegramPublicProduct {
  id: string;
  name: string;
  code: string;
  main_image_url?: string | null;
  quantity_on_hand?: number | null;
  is_active?: boolean | null;
}

/** Public (non-secret) telegram settings, readable by app roles. */
export function useTelegramSettings() {
  return useQuery({
    queryKey: ["telegram-settings-public"],
    queryFn: async () => {
      const { data } = await (supabase.from("telegram_settings" as any) as any)
        .select("id, channel_id, is_enabled, bot_token_hint, message_template, show_price, show_stock")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      return (data as any) || null;
    },
    staleTime: 60_000,
  });
}

/** Last successful publish per product, for the "published" marker. */
export function useTelegramPostStatus(productIds: string[]) {
  const key = [...productIds].sort().join(",");
  return useQuery({
    queryKey: ["telegram-post-status", key],
    enabled: productIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase.from("telegram_post_log" as any) as any)
        .select("product_id, created_at, images_count")
        .in("product_id", productIds)
        .eq("status", "success")
        .order("created_at", { ascending: false });
      const map: Record<string, { created_at: string; images_count: number }> = {};
      for (const row of (data as any[]) || []) {
        if (!map[row.product_id]) map[row.product_id] = row;
      }
      return map;
    },
    staleTime: 30_000,
  });
}

async function invokePublish(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("telegram-publish", { body });
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
  return data as any;
}

interface Props {
  product: TelegramPublicProduct;
  /** Number of images the product has (main + gallery). Pass undefined to fetch on open. */
  imagesCount?: number;
  variant?: "icon" | "button";
}

export function TelegramPublishButton({ product, imagesCount, variant = "icon" }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: settings } = useTelegramSettings();
  const { data: statusMap } = useTelegramPostStatus([product.id]);
  const published = statusMap?.[product.id];

  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [count, setCount] = useState<number | null>(imagesCount ?? null);

  const outOfStock = Number(product.quantity_on_hand ?? 0) <= 0;
  const hasMain = !!product.main_image_url;
  const noImages = imagesCount !== undefined && imagesCount === 0;
  const configured = !!settings?.channel_id && !!settings?.bot_token_hint && settings?.is_enabled === true;

  const disabledReason = outOfStock
    ? "لا يمكن النشر: رصيد المخزون صفر"
    : noImages
      ? "لا يمكن النشر: المنتج بدون صورة"
      : product.is_active === false
        ? "لا يمكن نشر منتج غير مفعّل"
        : null;

  const openDialog = async () => {
    if (!configured) {
      notify.error("إعدادات تيليجرام غير مكتملة", "أضف توكن البوت ومعرّف القناة وفعّل النشر من صفحة الإعدادات › تيليجرام.");
      navigate("/settings");
      return;
    }
    let imgs = imagesCount;
    if (imgs === undefined) {
      const { count: galleryCount } = await (supabase.from("product_images" as any) as any)
        .select("id", { count: "exact", head: true })
        .eq("product_id", product.id);
      imgs = (hasMain ? 1 : 0) + (galleryCount || 0);
    }
    setCount(imgs);
    if ((imgs || 0) === 0) {
      notify.error("لا يمكن النشر", "المنتج بدون صورة. أضف صورة رئيسية أو صور معرض أولاً.");
      return;
    }
    setOpen(true);
  };

  const doPublish = async () => {
    setSending(true);
    try {
      const res = await invokePublish({ action: "publish", product_id: product.id });
      notify.success(published ? "تم إعادة النشر" : "تم النشر على تيليجرام", `تم إرسال ${res?.images_count ?? 0} صورة إلى ${settings?.channel_id}` +
          (res?.skipped_images ? ` (تم تجاهل ${res.skipped_images} صورة لتجاوز حد 10 صور)` : ""));
      queryClient.invalidateQueries({ queryKey: ["telegram-post-status"] });
      setOpen(false);
    } catch (e) {
      notify.error("فشل النشر على تيليجرام", e instanceof Error ? e.message : "خطأ غير معروف");
    } finally {
      setSending(false);
    }
  };

  const label = published ? "إعادة النشر على تيليجرام" : "نشر على تيليجرام";
  const tooltip = disabledReason
    ? disabledReason
    : published
      ? `نُشر في ${new Date(published.created_at).toLocaleDateString("en-GB")} — إعادة النشر`
      : label;

  const trigger =
    variant === "button" ? (
      <Button
        variant="outline"
        onClick={openDialog}
        disabled={!!disabledReason}
        className="gap-2 font-bold shadow-sm relative"
      >
        <Send className="h-4 w-4" />
        {published ? "إعادة النشر على تيليجرام" : "نشر على تيليجرام"}
        {published && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
      </Button>
    ) : (
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        disabled={!!disabledReason}
        className={`h-8 w-8 relative ${published ? "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" : "text-muted-foreground hover:text-primary hover:bg-primary/5"}`}
        onClick={openDialog}
      >
        <Send className="h-4 w-4" />
        {published && (
          <span className="absolute -top-0.5 -left-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background" />
        )}
      </Button>
    );

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{trigger}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={published ? "إعادة نشر المنتج" : "نشر المنتج على تيليجرام"}
        description={
          <span className="block space-y-2 text-right">
            <span className="block">
              المنتج: <span className="font-bold text-foreground">{product.name}</span> ({product.code})
            </span>
            <span className="block">
              القناة: <span className="font-mono text-foreground">{settings?.channel_id}</span>
            </span>
            <span className="block">
              الصور التي سترسل:{" "}
              <span className="font-bold text-foreground">{Math.min(count ?? 0, 10)}</span>
              {(count ?? 0) > 10 && (
                <span className="text-warning"> (أول 10 صور فقط — حد تيليجرام)</span>
              )}
            </span>
            {published && (
              <span className="block text-warning font-medium">
                تم نشر هذا المنتج مسبقاً في {new Date(published.created_at).toLocaleDateString("en-GB")} — إعادة
                النشر ستُنشئ منشوراً جديداً في القناة.
              </span>
            )}
          </span>
        }
        confirmText={published ? "إعادة النشر" : "نشر"}
        loading={sending}
        onConfirm={doPublish}
      />

    </>
  );
}
