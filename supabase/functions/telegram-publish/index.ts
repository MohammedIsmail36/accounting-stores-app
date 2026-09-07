import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const MAX_IMAGES = 10;

const BIDI_CHARS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

function buildCaption(
  template: string,
  p: any,
  opts: { show_price: boolean; show_stock: boolean; currency: string; price_source: string },
) {
  const esc = (v: unknown) =>
    String(v ?? "")
      .replace(BIDI_CHARS, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const rawPrice =
    opts.price_source === "barcode"
      ? p.barcode_price != null
        ? Number(p.barcode_price)
        : Number(p.selling_price || 0)
      : Number(p.selling_price || 0);
  const price = opts.show_price
    ? `${rawPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${opts.currency}`
    : "";
  const stock = opts.show_stock ? String(Number(p.quantity_on_hand || 0)) : "";
  let source = (template || "المنتج: <b>{name}</b>").replace(BIDI_CHARS, "");

  // Remove optional fields before substitution so an empty label is never sent.
  if (!opts.show_price)
    source = source
      .split("\n")
      .filter((line) => !line.includes("{price}"))
      .join("\n");
  if (!opts.show_stock)
    source = source
      .split("\n")
      .filter((line) => !line.includes("{stock}"))
      .join("\n");

  let text = source
    .replace(/\{name\}/g, esc(p.name))
    .replace(/\{code\}/g, esc(p.code))
    .replace(/\{brand\}/g, esc(p.product_brands?.name || ""))
    .replace(/\{model\}/g, esc(p.model_number || ""))
    .replace(/\{price\}/g, esc(price))
    .replace(/\{stock\}/g, esc(stock))
    .replace(/\{description\}/g, esc(p.description || ""));

  text = text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1024);

  // Force RTL direction explicitly on every line by prefixing with RLM
  // (U+200F). This fixes Telegram mobile clients rendering the caption
  // as left-aligned when a line starts with a Latin/number character
  // (e.g. "EGP", "PRD-002") even though the overall text is Arabic.
  // Telegram Desktop/Web use a smarter bidi engine and don't need this,
  // but mobile apps rely on the first strong-direction character only.
  const RLM = "\u200F";
  text = text
    .split("\n")
    .map((line) => (line ? RLM + line : line))
    .join("\n");

  return text;
}

async function tg(token: string, method: string, body: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok !== true) {
    const desc = data?.description || `HTTP ${res.status}`;
    throw new Error(desc);
  }
  return data.result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "غير مصرح" }, 401);

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user: caller },
    error: callerError,
  } = await callerClient.auth.getUser();
  if (callerError || !caller) return json({ error: "جلسة غير صالحة" }, 401);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", caller.id);
  const roleList = (roles || []).map((r: any) => r.role);
  const isAdmin = roleList.includes("admin");
  const canPublish = isAdmin || roleList.includes("accountant") || roleList.includes("sales");
  if (!canPublish) return json({ error: "صلاحيات غير كافية" }, 403);

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: "طلب غير صالح" }, 400);
  }
  const action = payload?.action === "test" ? "test" : "publish";

  const { data: settings } = await supabase
    .from("telegram_settings")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!settings?.bot_token || !settings?.channel_id) {
    return json({ error: "إعدادات تيليجرام غير مكتملة. أضف توكن البوت ومعرّف القناة أولاً." }, 400);
  }

  const token = settings.bot_token as string;
  const channelId = settings.channel_id as string;

  try {
    if (action === "test") {
      if (!isAdmin) return json({ error: "اختبار الاتصال متاح للمدير فقط" }, 403);
      const me = await tg(token, "getMe", {});
      const msg = await tg(token, "sendMessage", {
        chat_id: channelId,
        text: "✅ اختبار اتصال ناجح من نظام الحسابات.",
      });
      return json({ ok: true, bot: me?.username ?? null, message_id: msg?.message_id ?? null });
    }

    if (settings.is_enabled !== true) {
      return json({ error: "النشر على تيليجرام معطّل من الإعدادات." }, 400);
    }

    const productId = payload?.product_id;
    if (!productId || typeof productId !== "string") {
      return json({ error: "معرّف المنتج مفقود" }, 400);
    }

    const { data: product, error: prodError } = await supabase
      .from("products")
      .select(
        "id, code, name, description, model_number, main_image_url, selling_price, barcode_price, quantity_on_hand, is_active, product_brands(name)",
      )
      .eq("id", productId)
      .maybeSingle();
    if (prodError) return json({ error: prodError.message }, 400);
    if (!product) return json({ error: "المنتج غير موجود" }, 404);
    if (product.is_active !== true) return json({ error: "لا يمكن نشر منتج غير مفعّل" }, 400);
    if (Number(product.quantity_on_hand || 0) <= 0) {
      return json({ error: "لا يمكن نشر منتج رصيده صفر" }, 400);
    }

    const { data: gallery } = await supabase
      .from("product_images")
      .select("image_url, sort_order")
      .eq("product_id", productId)
      .order("sort_order", { ascending: true });

    const images: string[] = [
      ...(product.main_image_url ? [product.main_image_url] : []),
      ...((gallery || []).map((g: any) => g.image_url).filter(Boolean) as string[]),
    ].filter((url, i, arr) => arr.indexOf(url) === i);

    if (images.length === 0) {
      return json({ error: "لا يمكن النشر: المنتج بدون صورة" }, 400);
    }

    const { data: appSettings } = await supabase.from("settings").select("default_currency").limit(1).maybeSingle();

    const caption = buildCaption(settings.message_template, product, {
      show_price: settings.show_price !== false,
      show_stock: settings.show_stock === true,
      currency: (appSettings as any)?.default_currency || "EGP",
      price_source: (settings as any)?.price_source === "barcode" ? "barcode" : "selling",
    });

    const sendImages = images.slice(0, MAX_IMAGES);
    const mainImage = sendImages[0];
    const galleryImages = sendImages.slice(1);
    let messageId: number | null = null;

    if (galleryImages.length === 0) {
      // صورة أساسية فقط: رسالة واحدة مع القالب
      const res = await tg(token, "sendPhoto", {
        chat_id: channelId,
        photo: mainImage,
        caption,
        parse_mode: "HTML",
      });
      messageId = res?.message_id ?? null;
    } else {
      // الرسالة الأولى: الصورة الأساسية كبيرة بدون نص
      const first = await tg(token, "sendPhoto", {
        chat_id: channelId,
        photo: mainImage,
      });
      messageId = first?.message_id ?? null;

      // الرسالة الثانية: صور المعرض مع القالب
      if (galleryImages.length === 1) {
        await tg(token, "sendPhoto", {
          chat_id: channelId,
          photo: galleryImages[0],
          caption,
          parse_mode: "HTML",
        });
      } else {
        const media = galleryImages.map((url, i) => ({
          type: "photo",
          media: url,
          ...(i === 0 ? { caption, parse_mode: "HTML" } : {}),
        }));
        await tg(token, "sendMediaGroup", { chat_id: channelId, media });
      }
    }


    await supabase.from("telegram_post_log").insert({
      product_id: productId,
      channel_id: channelId,
      message_id: messageId,
      images_count: sendImages.length,
      status: "success",
      created_by: caller.id,
    });

    return json({
      ok: true,
      message_id: messageId,
      images_count: sendImages.length,
      skipped_images: Math.max(0, images.length - sendImages.length),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("telegram-publish failed:", message);
    if (action === "publish" && payload?.product_id) {
      await supabase.from("telegram_post_log").insert({
        product_id: payload.product_id,
        channel_id: channelId,
        images_count: 0,
        status: "failed",
        error: message,
        created_by: caller.id,
      });
    }
    return json({ error: message }, 502);
  }
});
