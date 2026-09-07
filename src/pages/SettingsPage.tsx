import { useEffect, useState } from "react";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { deleteStorageFile } from "@/lib/storage-cleanup";
import { useSettings, type CompanySettings } from "@/contexts/SettingsContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountCombobox } from "@/components/AccountCombobox";
import { notify } from "@/lib/notify";
import { useUserRole } from "@/hooks/use-user-role";
import { TelegramSettingsTab } from "@/components/settings/TelegramSettingsTab";
import { z } from "zod";

const prefixSchema = z
  .string({ invalid_type_error: "يجب أن تكون البادئة نصاً" })
  .trim()
  .min(1, "لا يمكن أن تكون البادئة فارغة")
  .max(10, "يجب ألا تتجاوز البادئة 10 أحرف");

const prefixFields: { key: keyof CompanySettings; label: string }[] = [
  { key: "sales_invoice_prefix", label: "بادئة فواتير المبيعات" },
  { key: "purchase_invoice_prefix", label: "بادئة فواتير المشتريات" },
  { key: "sales_return_prefix", label: "بادئة مرتجعات المبيعات" },
  { key: "purchase_return_prefix", label: "بادئة مرتجعات المشتريات" },
  { key: "customer_payment_prefix", label: "بادئة سندات القبض" },
  { key: "supplier_payment_prefix", label: "بادئة سندات الصرف" },
  { key: "journal_entry_prefix", label: "بادئة قيود اليومية" },
  { key: "expense_prefix", label: "بادئة المصروفات" },
  { key: "product_code_prefix", label: "بادئة أكواد المنتجات" },
];
import {
  Building2,
  DollarSign,
  FileText,
  Save,
  Loader2,
  Upload,
  X,
  Image,
  Info,
  Phone,
  Settings2,
  Hash,
  ReceiptText,
  Eye,
  ShieldCheck,
  Percent,
  Gift,
} from "lucide-react";

const currencies = [
  { value: "EGP", label: "جنيه مصري (EGP)" },
  { value: "SAR", label: "ريال سعودي (SAR)" },
  { value: "AED", label: "درهم إماراتي (AED)" },
  { value: "KWD", label: "دينار كويتي (KWD)" },
  { value: "QAR", label: "ريال قطري (QAR)" },
  { value: "BHD", label: "دينار بحريني (BHD)" },
  { value: "OMR", label: "ريال عماني (OMR)" },
  { value: "JOD", label: "دينار أردني (JOD)" },
  { value: "IQD", label: "دينار عراقي (IQD)" },
  { value: "LBP", label: "ليرة لبنانية (LBP)" },
  { value: "USD", label: "دولار أمريكي (USD)" },
  { value: "EUR", label: "يورو (EUR)" },
];

const fiscalYearOptions = [
  { value: "01-01", label: "يناير (01/01)" },
  { value: "04-01", label: "أبريل (04/01)" },
  { value: "07-01", label: "يوليو (07/01)" },
  { value: "10-01", label: "أكتوبر (10/01)" },
];

const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];
const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB

function SectionCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card p-6 md:p-8 rounded-2xl border border-border shadow-sm">
      <h3 className="text-xl font-bold mb-6 flex items-center gap-2.5">
        <Icon className="h-5 w-5 text-primary" />
        {title}
      </h3>
      {children}
    </div>
  );
}

interface AccountOption {
  id: string;
  code: string;
  name: string;
  account_type: string;
}

export default function SettingsPage() {
  const { settings: globalSettings, refetch } = useSettings();
  const { data: role } = useUserRole();

  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);

  useEffect(() => {
    fetchSettings();
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    const { data } = await supabase
      .from("accounts")
      .select("id, code, name, account_type")
      .eq("is_active", true)
      .eq("is_parent", false)
      .order("code");
    setAccounts((data as AccountOption[]) || []);
  };

  // حسابات الضريبة المرشحة (الأصول للمشتريات والخصوم للمبيعات)
  const purchaseTaxAccounts = accounts.filter(
    (a) => a.account_type === "asset",
  );
  const salesTaxAccounts = accounts.filter(
    (a) => a.account_type === "liability",
  );

  const fetchSettings = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("company_settings")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      notify.error("خطأ في تحميل الإعدادات");
      console.error(error);
    } else if (data) {
      // ضمان قيم افتراضية للبادئات إذا كانت فارغة في قاعدة البيانات
      const defaults: Record<string, string> = {
        sales_invoice_prefix: "INV-",
        purchase_invoice_prefix: "PUR-",
        sales_return_prefix: "SRN-",
        purchase_return_prefix: "PRN-",
        customer_payment_prefix: "RCV-",
        supplier_payment_prefix: "PAY-",
        journal_entry_prefix: "JV-",
        expense_prefix: "EXP-",
        product_code_prefix: "PRD-",
      };
      const normalized: any = { ...data };
      for (const k of Object.keys(defaults)) {
        if (!normalized[k] || typeof normalized[k] !== "string" || !normalized[k].trim()) {
          normalized[k] = defaults[k];
        }
      }
      setSettings(normalized as CompanySettings);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!settings) return;
    // التحقق من البادئات (لا تكون فارغة وتكون نصاً)
    for (const { key, label } of prefixFields) {
      const result = prefixSchema.safeParse(settings[key]);
      if (!result.success) {
        notify.error(`${label}: ${result.error.issues[0].message}`);
        return;
      }
    }
    // التحقق من إعدادات الضريبة عند التفعيل
    if (settings.enable_tax) {
      if (!settings.tax_rate || settings.tax_rate <= 0) {
        notify.error("نسبة الضريبة يجب أن تكون أكبر من صفر عند تفعيل الضريبة");
        return;
      }
      if (!settings.sales_tax_account_id) {
        notify.error("يجب اختيار حساب ضريبة المبيعات");
        return;
      }
      if (!settings.purchase_tax_account_id) {
        notify.error("يجب اختيار حساب ضريبة المشتريات");
        return;
      }
    }
    setSaving(true);
    // استبعاد الحقول المُدارة من قِبل قاعدة البيانات لتجنّب إرباك التريجرز
    const { id, ...rest } = settings as any;
    delete rest.created_at;
    delete rest.updated_at;
    delete rest.singleton;

    const { data, error } = await supabase
      .from("company_settings")
      .update(rest)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) {
      notify.error("خطأ في حفظ الإعدادات: " + error.message);
      console.error(error);
    } else if (!data) {
      // لم يُحدَّث أي صف — غالباً بسبب صلاحيات RLS أو أن السجل غير موجود
      notify.error(
        "تعذّر حفظ الإعدادات — تحقق من صلاحياتك (يتطلب دور المدير) ثم أعد المحاولة",
      );
    } else {
      // مزامنة الحالة المحلية مع ما حُفظ فعلياً في قاعدة البيانات
      setSettings(data as CompanySettings);
      notify.success("تم حفظ الإعدادات بنجاح");
      await refetch();
    }
    setSaving(false);
  };

  const updateField = <K extends keyof CompanySettings>(
    field: K,
    value: CompanySettings[K],
  ) => {
    if (!settings) return;
    setSettings({ ...settings, [field]: value });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !settings) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      notify.error("يُسمح فقط بصور من نوع PNG, JPG, GIF, WEBP");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      notify.error("حجم الصورة يجب أن لا يتجاوز 2 ميجابايت");
      return;
    }

    setUploading(true);
    try {
      const previousLogo = settings.logo_url || "";
      const ext = file.name.split(".").pop();
      const fileName = `company-logo-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("product-images")
        .upload(fileName, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage
        .from("product-images")
        .getPublicUrl(fileName);
      updateField("logo_url", urlData.publicUrl);
      // Best-effort cleanup of the previous logo file
      if (previousLogo && previousLogo !== urlData.publicUrl) {
        await deleteStorageFile(previousLogo);
      }
      notify.success("تم رفع الشعار بنجاح. اضغط حفظ لتأكيد التغييرات.");
    } catch (err: any) {
      notify.error("خطأ في رفع الشعار: " + err.message);
    }
    setUploading(false);
  };

  const removeLogo = () => {
    const old = settings?.logo_url || "";
    updateField("logo_url", "");
    if (old) void deleteStorageFile(old);
  };

  if (loading) {
    return (
      <LoadingState variant="block" />
    );
  }

  if (!settings) {
    return (
      <div className="text-center text-muted-foreground py-16">
        لم يتم العثور على إعدادات. تواصل مع مدير النظام.
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        icon={Settings2}
        title="إعدادات الشركة"
        description="إدارة معلومات المنشأة وتفاصيل الاتصال الرسمية الخاصة بك"
        actions={
          <Button
            onClick={handleSave}
            disabled={saving}
            className="gap-2 rounded-xl px-6 shadow-lg shadow-primary/20"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            حفظ جميع التغييرات
          </Button>
        }
      />

      {/* Tabs */}
      <Tabs defaultValue="company" dir="rtl">
        <TabsList className="bg-transparent border-b border-border rounded-none h-auto p-0 gap-8 mb-8 w-full justify-start">
          <TabsTrigger
            value="company"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none bg-transparent px-0 pb-4 font-bold text-sm"
          >
            معلومات الشركة
          </TabsTrigger>
          <TabsTrigger
            value="financial"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none bg-transparent px-0 pb-4 font-bold text-sm"
          >
            الإعدادات المالية
          </TabsTrigger>
          <TabsTrigger
            value="tax"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none bg-transparent px-0 pb-4 font-bold text-sm"
          >
            الضريبة
          </TabsTrigger>
          <TabsTrigger
            value="invoices"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none bg-transparent px-0 pb-4 font-bold text-sm"
          >
            إدارة الفواتير
          </TabsTrigger>
          <TabsTrigger
            value="loyalty"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none bg-transparent px-0 pb-4 font-bold text-sm"
          >
            ولاء العملاء
          </TabsTrigger>
          <TabsTrigger
            value="inventory"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none bg-transparent px-0 pb-4 font-bold text-sm"
          >
            إعدادات المخزون
          </TabsTrigger>
          <TabsTrigger
            value="telegram"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none bg-transparent px-0 pb-4 font-bold text-sm"
          >
            تيليجرام
          </TabsTrigger>
        </TabsList>

        {/* ── Company Tab ── */}
        <TabsContent value="company" className="space-y-6 mt-0">
          {/* Logo Card */}
          <div className="bg-card p-6 rounded-2xl border border-border shadow-sm">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <div className="relative group">
                <div className="w-32 h-32 rounded-2xl bg-muted/30 border-2 border-dashed border-border flex items-center justify-center overflow-hidden transition-all group-hover:border-primary">
                  {settings.logo_url ? (
                    <>
                      <img
                        src={settings.logo_url}
                        alt="شعار الشركة"
                        className="w-full h-full object-contain p-4"
                      />
                      <div className="absolute inset-0 bg-foreground/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer">
                        <Upload className="h-6 w-6 text-white" />
                      </div>
                    </>
                  ) : (
                    <Image className="h-10 w-10 text-muted-foreground/40" />
                  )}
                </div>
              </div>
              <div className="flex-1 text-center sm:text-right">
                <h4 className="text-lg font-bold">شعار المنشأة</h4>
                <p className="text-muted-foreground text-sm mt-1">
                  يُنصح برفع صورة عالية الجودة بصيغة PNG أو SVG بخلفية شفافة
                </p>
                <div className="mt-4 flex flex-wrap justify-center sm:justify-start gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 border-primary/20 text-primary bg-primary/10 hover:bg-primary/20 rounded-lg font-bold"
                    disabled={uploading}
                    asChild
                  >
                    <label className="cursor-pointer">
                      {uploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      {uploading ? "جاري الرفع..." : "رفع شعار جديد"}
                      <input
                        type="file"
                        accept=".png,.jpg,.jpeg,.gif,.webp"
                        className="hidden"
                        onChange={handleLogoUpload}
                      />
                    </label>
                  </Button>
                  {settings.logo_url && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={removeLogo}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4 ml-1" />
                      حذف
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* General Info */}
          <SectionCard icon={Info} title="المعلومات العامة">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              <div className="space-y-2">
                <Label className="text-sm font-bold">
                  اسم المنشأة (بالعربية)
                </Label>
                <Input
                  value={settings.company_name}
                  onChange={(e) => updateField("company_name", e.target.value)}
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">
                  اسم المنشأة (بالإنجليزية)
                </Label>
                <Input
                  value={settings.company_name_en || ""}
                  onChange={(e) =>
                    updateField("company_name_en", e.target.value)
                  }
                  dir="ltr"
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">نشاط العمل</Label>
                <Input
                  value={settings.business_activity || ""}
                  onChange={(e) =>
                    updateField("business_activity", e.target.value)
                  }
                  placeholder="مثال: تجارة مواد البناء والتوريدات"
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">الرقم الضريبي (VAT)</Label>
                <Input
                  value={settings.tax_number || ""}
                  onChange={(e) => updateField("tax_number", e.target.value)}
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">رقم السجل التجاري</Label>
                <Input
                  value={settings.commercial_register || ""}
                  onChange={(e) =>
                    updateField("commercial_register", e.target.value)
                  }
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">الموقع الإلكتروني</Label>
                <Input
                  value={settings.website || ""}
                  onChange={(e) => updateField("website", e.target.value)}
                  dir="ltr"
                  type="url"
                  className="rounded-lg"
                />
              </div>
            </div>
          </SectionCard>

          {/* Contact Info */}
          <SectionCard icon={Phone} title="معلومات الاتصال والعنوان">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              <div className="space-y-2">
                <Label className="text-sm font-bold">رقم الهاتف</Label>
                <Input
                  value={settings.phone || ""}
                  onChange={(e) => updateField("phone", e.target.value)}
                  dir="ltr"
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">
                  البريد الإلكتروني الرسمي
                </Label>
                <Input
                  value={settings.email || ""}
                  onChange={(e) => updateField("email", e.target.value)}
                  dir="ltr"
                  type="email"
                  className="rounded-lg"
                />
              </div>
              <div className="md:col-span-2 space-y-2">
                <Label className="text-sm font-bold">
                  العنوان الوطني / التفصيلي
                </Label>
                <Textarea
                  value={settings.address || ""}
                  onChange={(e) => updateField("address", e.target.value)}
                  rows={3}
                  className="rounded-lg"
                />
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── Financial Tab ── */}
        <TabsContent value="financial" className="space-y-6 mt-0">
          <SectionCard icon={DollarSign} title="الإعدادات المالية">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              <div className="space-y-2">
                <Label className="text-sm font-bold">العملة الافتراضية</Label>
                <Select
                  value={settings.default_currency}
                  onValueChange={(v) => updateField("default_currency", v)}
                >
                  <SelectTrigger className="rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">بداية السنة المالية</Label>
                <Select
                  value={settings.fiscal_year_start}
                  onValueChange={(v) => updateField("fiscal_year_start", v)}
                >
                  <SelectTrigger className="rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fiscalYearOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* تم نقل نسبة الضريبة الافتراضية إلى تبويب "الضريبة" */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-bold">
                    مدة الاسترجاع (أيام)
                  </Label>
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor="enable_return_days_limit"
                      className="text-xs text-muted-foreground"
                    >
                      تفعيل التحقق
                    </Label>
                    <Switch
                      id="enable_return_days_limit"
                      checked={settings.enable_return_days_limit ?? true}
                      onCheckedChange={(v) =>
                        updateField("enable_return_days_limit" as any, v)
                      }
                    />
                  </div>
                </div>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={settings.return_days_limit || 30}
                  onChange={(e) =>
                    updateField("return_days_limit", Number(e.target.value))
                  }
                  className="rounded-lg"
                  disabled={!(settings.enable_return_days_limit ?? true)}
                />
                {settings.enable_return_days_limit === false ? (
                  <p className="text-xs text-amber-600">
                    ⚠ التحقق من فترة الاسترجاع معطل — يمكن إرجاع أي صنف بدون
                    قيود زمنية
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    الحد الأقصى لعدد الأيام المسموح بها لإرجاع المبيعات
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">هدف المبيعات الشهري</Label>
                <Input
                  type="number"
                  min={0}
                  value={(settings as any).monthly_sales_target || 0}
                  onChange={(e) =>
                    updateField(
                      "monthly_sales_target" as any,
                      Number(e.target.value),
                    )
                  }
                  className="rounded-lg"
                />
                <p className="text-xs text-muted-foreground">
                  المبلغ المستهدف تحقيقه من المبيعات شهرياً — يظهر في لوحة
                  التحكم
                </p>
              </div>
            </div>

            <hr className="border-border my-2" />

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-bold">
                  تفعيل إقفال السنة المالية
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  يتيح إنشاء قيد إقفال تلقائي لتصفير حسابات الإيرادات والمصروفات
                  وترحيل صافي الربح/الخسارة إلى حساب الأرباح المحتجزة (3102)
                </p>
              </div>
              <Switch
                checked={settings.enable_fiscal_year_closing}
                onCheckedChange={(v) =>
                  updateField("enable_fiscal_year_closing", v)
                }
              />
            </div>
          </SectionCard>

          {/* ── Data Protection ── */}
          <SectionCard icon={ShieldCheck} title="حماية البيانات">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-bold">
                    منع البيع بأكثر من المخزون
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    عند التفعيل، لن يتم ترحيل فاتورة بيع إذا كانت الكمية
                    المطلوبة أكبر من الكمية المتاحة في المخزون
                  </p>
                </div>
                <Switch
                  checked={settings.stock_enforcement_enabled ?? true}
                  onCheckedChange={(v) =>
                    updateField("stock_enforcement_enabled", v)
                  }
                />
              </div>

              <hr className="border-border" />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-bold">
                    قفل الفترة المحاسبية حتى تاريخ
                  </Label>
                  {settings.locked_until_date && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground hover:text-destructive h-7 px-2"
                      onClick={() => updateField("locked_until_date", null)}
                    >
                      <X className="h-3 w-3 ml-1" />
                      إلغاء القفل
                    </Button>
                  )}
                </div>
                <Input
                  type="date"
                  value={settings.locked_until_date || ""}
                  onChange={(e) =>
                    updateField("locked_until_date", e.target.value || null)
                  }
                  className="rounded-lg max-w-xs"
                  dir="ltr"
                />
                <p className="text-xs text-muted-foreground">
                  عند تحديد تاريخ، لن يُسمح بإنشاء أو تعديل أي قيد محاسبي بتاريخ
                  يسبق هذا التاريخ أو يساويه
                </p>
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── Tax Tab ── */}
        <TabsContent value="tax" className="space-y-6 mt-0">
          <SectionCard icon={Percent} title="إعدادات ضريبة القيمة المضافة">
            <div className="space-y-6">
              {/* تفعيل الضريبة */}
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-bold">
                    تفعيل ضريبة القيمة المضافة
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    عند التفعيل، ستُطبَّق الضريبة على فواتير المبيعات والمشتريات
                    والمرتجعات وفقاً لحسابات الضريبة المحددة أدناه
                  </p>
                </div>
                <Switch
                  checked={settings.enable_tax ?? false}
                  onCheckedChange={(v) => updateField("enable_tax", v)}
                />
              </div>

              <hr className="border-border" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                {/* نسبة الضريبة */}
                <div className="space-y-2">
                  <Label className="text-sm font-bold">
                    نسبة الضريبة (%){" "}
                    {settings.enable_tax && (
                      <span className="text-destructive">*</span>
                    )}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={settings.tax_rate || 0}
                    onChange={(e) =>
                      updateField(
                        "tax_rate",
                        Math.min(100, Math.max(0, Number(e.target.value))),
                      )
                    }
                    disabled={!settings.enable_tax}
                    className="rounded-lg"
                  />
                  {settings.enable_tax &&
                    (!settings.tax_rate || settings.tax_rate <= 0) && (
                      <p className="text-xs text-destructive">
                        يجب أن تكون النسبة أكبر من صفر
                      </p>
                    )}
                </div>

                <div /> {/* spacer */}

                {/* حساب ضريبة المبيعات */}
                <div className="space-y-2">
                  <Label className="text-sm font-bold">
                    حساب ضريبة المبيعات (مخرجات){" "}
                    {settings.enable_tax && (
                      <span className="text-destructive">*</span>
                    )}
                  </Label>
                  <AccountCombobox
                    accounts={salesTaxAccounts}
                    value={settings.sales_tax_account_id || ""}
                    onValueChange={(v) =>
                      updateField("sales_tax_account_id", v || null)
                    }
                    placeholder="اختر حساب ضريبة المبيعات (خصوم)"
                    disabled={!settings.enable_tax}
                  />
                  <p className="text-xs text-muted-foreground">
                    حساب من نوع <strong>خصوم</strong> يُستخدم لتسجيل ضريبة
                    المبيعات المستحقة (مثال: 2102)
                  </p>
                  {settings.enable_tax && !settings.sales_tax_account_id && (
                    <p className="text-xs text-destructive">حقل إلزامي</p>
                  )}
                </div>

                {/* حساب ضريبة المشتريات */}
                <div className="space-y-2">
                  <Label className="text-sm font-bold">
                    حساب ضريبة المشتريات (مدخلات){" "}
                    {settings.enable_tax && (
                      <span className="text-destructive">*</span>
                    )}
                  </Label>
                  <AccountCombobox
                    accounts={purchaseTaxAccounts}
                    value={settings.purchase_tax_account_id || ""}
                    onValueChange={(v) =>
                      updateField("purchase_tax_account_id", v || null)
                    }
                    placeholder="اختر حساب ضريبة المشتريات (أصول)"
                    disabled={!settings.enable_tax}
                  />
                  <p className="text-xs text-muted-foreground">
                    حساب من نوع <strong>أصول</strong> يُستخدم لتسجيل ضريبة
                    المدخلات القابلة للاسترداد (مثال: 1105)
                  </p>
                  {settings.enable_tax && !settings.purchase_tax_account_id && (
                    <p className="text-xs text-destructive">حقل إلزامي</p>
                  )}
                </div>
              </div>

              <hr className="border-border" />

              {/* إظهار الضريبة في الفاتورة المطبوعة */}
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-bold">
                    إظهار الضريبة في الفاتورة المطبوعة
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    عرض تفاصيل الضريبة في الفواتير والمرتجعات عند الطباعة
                  </p>
                </div>
                <Switch
                  checked={settings.show_tax_on_invoice}
                  onCheckedChange={(v) => updateField("show_tax_on_invoice", v)}
                  disabled={!settings.enable_tax}
                />
              </div>

              {settings.enable_tax && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 text-xs text-muted-foreground">
                  <p className="font-bold text-foreground mb-1">ملاحظة هامة</p>
                  <p>
                    عند ترحيل الفواتير والمرتجعات، سيستخدم النظام الحسابات
                    المحددة هنا تلقائياً. تأكد من بقاء هذه الحسابات نشطة في
                    شجرة الحسابات.
                  </p>
                </div>
              )}
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── Invoices Tab ── */}
        <TabsContent value="invoices" className="space-y-6 mt-0">
          <SectionCard icon={Hash} title="بادئات الترقيم">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-6">
              <div className="space-y-2">
                <Label className="text-sm font-bold">فواتير المبيعات</Label>
                <Input
                  value={settings.sales_invoice_prefix}
                  onChange={(e) =>
                    updateField("sales_invoice_prefix", e.target.value)
                  }
                  dir="ltr"
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">فواتير المشتريات</Label>
                <Input
                  value={settings.purchase_invoice_prefix}
                  onChange={(e) =>
                    updateField("purchase_invoice_prefix", e.target.value)
                  }
                  dir="ltr"
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">مدة الدفع (أيام)</Label>
                <Input
                  type="number"
                  min={0}
                  value={settings.payment_terms_days}
                  onChange={(e) =>
                    updateField("payment_terms_days", Number(e.target.value))
                  }
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">مرتجعات المبيعات</Label>
                <Input
                  value={settings.sales_return_prefix}
                  onChange={(e) =>
                    updateField("sales_return_prefix", e.target.value)
                  }
                  dir="ltr"
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">مرتجعات المشتريات</Label>
                <Input
                  value={settings.purchase_return_prefix}
                  onChange={(e) =>
                    updateField("purchase_return_prefix", e.target.value)
                  }
                  dir="ltr"
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">القيود المحاسبية</Label>
                <Input
                  value={settings.journal_entry_prefix ?? ""}
                  onChange={(e) =>
                    updateField("journal_entry_prefix", e.target.value)
                  }
                  dir="ltr"
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">مدفوعات العملاء</Label>
                <Input
                  value={settings.customer_payment_prefix}
                  onChange={(e) =>
                    updateField("customer_payment_prefix", e.target.value)
                  }
                  dir="ltr"
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">مدفوعات الموردين</Label>
                <Input
                  value={settings.supplier_payment_prefix}
                  onChange={(e) =>
                    updateField("supplier_payment_prefix", e.target.value)
                  }
                  dir="ltr"
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">المصروفات</Label>
                <Input
                  value={settings.expense_prefix}
                  onChange={(e) =>
                    updateField("expense_prefix", e.target.value)
                  }
                  dir="ltr"
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">بادئة المنتجات</Label>
                <Input
                  value={settings.product_code_prefix ?? ""}
                  onChange={(e) =>
                    updateField("product_code_prefix", e.target.value)
                  }
                  dir="ltr"
                  className="rounded-lg"
                />
              </div>
            </div>
          </SectionCard>

          <SectionCard icon={Eye} title="خيارات العرض">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-bold">
                    إظهار الخصم في الفاتورة
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    عرض تفاصيل الخصم في الفواتير المطبوعة
                  </p>
                </div>
                <Switch
                  checked={settings.show_discount_on_invoice}
                  onCheckedChange={(v) =>
                    updateField("show_discount_on_invoice", v)
                  }
                />
              </div>

              <hr className="border-border" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                <div className="space-y-2">
                  <Label className="text-sm font-bold">
                    ملاحظات الفاتورة الافتراضية
                  </Label>
                  <Textarea
                    value={settings.invoice_notes || ""}
                    onChange={(e) =>
                      updateField("invoice_notes", e.target.value)
                    }
                    rows={3}
                    className="rounded-lg"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-bold">تذييل الفاتورة</Label>
                  <Textarea
                    value={settings.invoice_footer || ""}
                    onChange={(e) =>
                      updateField("invoice_footer", e.target.value)
                    }
                    rows={3}
                    className="rounded-lg"
                  />
                </div>
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── Loyalty Tab ── */}
        <TabsContent value="loyalty" className="space-y-6 mt-0">
          <SectionCard icon={Gift} title="نظام نقاط الولاء">
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl border border-border">
                <div>
                  <Label className="text-sm font-bold">تفعيل نظام النقاط</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    عند التفعيل سيكسب العملاء نقاطاً على كل فاتورة بيع مرحّلة، ويمكن استبدالها كخصم على فاتورة لاحقة.
                  </p>
                </div>
                <Switch
                  checked={!!settings.loyalty_enabled}
                  onCheckedChange={(v) => updateField("loyalty_enabled", v)}
                />
              </div>

              {settings.loyalty_enabled && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label className="text-sm font-bold">قيمة كل نقطة (مبيعات بالعملة)</Label>
                      <Input
                        type="number"
                        min={1}
                        step="any"
                        value={settings.loyalty_egp_per_point ?? 10}
                        onChange={(e) =>
                          updateField("loyalty_egp_per_point", Number(e.target.value) || 0)
                        }
                        className="rounded-lg"
                      />
                      <p className="text-xs text-muted-foreground">
                        مثال: 10 يعني أن كل 10 من قيمة الفاتورة = نقطة واحدة.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-bold">عدد النقاط للاستبدال المرجعي</Label>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={settings.loyalty_points_per_redeem ?? 100}
                        onChange={(e) =>
                          updateField(
                            "loyalty_points_per_redeem",
                            parseInt(e.target.value || "0", 10) || 0,
                          )
                        }
                        className="rounded-lg"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-bold">قيمة الخصم المقابل (بالعملة)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={settings.loyalty_redeem_value ?? 5}
                        onChange={(e) =>
                          updateField("loyalty_redeem_value", Number(e.target.value) || 0)
                        }
                        className="rounded-lg"
                      />
                      <p className="text-xs text-muted-foreground">
                        مثال: 5 — يعني كل {settings.loyalty_points_per_redeem || 100} نقطة تساوي 5 من العملة.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-bold">قيمة النقطة الواحدة</Label>
                      <div className="h-10 px-4 flex items-center rounded-lg border bg-muted/30 text-sm font-mono tabular-nums">
                        {settings.loyalty_points_per_redeem > 0
                          ? (
                              (settings.loyalty_redeem_value || 0) /
                              settings.loyalty_points_per_redeem
                            ).toFixed(4)
                          : "0.0000"}
                      </div>
                      <p className="text-xs text-muted-foreground">محسوبة تلقائياً.</p>
                    </div>
                  </div>

                  <div className="p-4 bg-primary/5 rounded-lg border border-primary/20 text-sm text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">كيف يعمل:</strong> العميل يكسب نقاطاً
                    تساوي{" "}
                    <span className="font-mono">
                      floor(صافي الفاتورة قبل الخصم بالنقاط / {settings.loyalty_egp_per_point || 10})
                    </span>
                    . عند الاستبدال يُحسب الخصم تناسبياً ولا يتجاوز قيمة الفاتورة. عند المرتجع
                    تُعكس النقاط بنفس النسبة.
                  </div>
                </>
              )}
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── Inventory Tab ── */}
        <TabsContent value="inventory" className="space-y-6 mt-0">
          <SectionCard icon={Settings2} title="معايير تقارير المخزون">
            <p className="text-sm text-muted-foreground mb-6">
              تتحكم هذه القيم في حسابات تقارير إعادة الطلب والتعمير والركود
              ومؤشرات المخزون.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              {(
                [
                  {
                    key: "inventory_lead_time_days",
                    label: "مدة التوريد (أيام)",
                    hint: "متوسط الأيام من إصدار أمر الشراء حتى استلام البضاعة",
                  },
                  {
                    key: "inventory_target_cover_days",
                    label: "أيام التغطية المستهدفة",
                    hint: "عدد الأيام التي يجب أن يغطيها المخزون بعد إعادة الطلب",
                  },
                  {
                    key: "inventory_slow_days",
                    label: "حد الحركة البطيئة (أيام)",
                    hint: "الصنف الذي لم يُبع خلال هذه المدة يُعتبر بطيء الحركة",
                  },
                  {
                    key: "inventory_dead_days",
                    label: "حد المخزون الراكد (أيام)",
                    hint: "الصنف الذي لم يُبع خلال هذه المدة يُعتبر راكداً",
                  },
                  {
                    key: "inventory_new_days",
                    label: "فترة الصنف الجديد (أيام)",
                    hint: "تُستثنى الأصناف الأحدث من هذه المدة من تحليلات الركود و ABC",
                  },
                ] as const
              ).map(({ key, label, hint }) => (
                <div key={key} className="space-y-2">
                  <Label className="text-sm font-bold">{label}</Label>
                  <Input
                    type="number"
                    min={0}
                    value={settings[key] ?? 0}
                    onChange={(e) =>
                      updateField(key, Math.max(0, Number(e.target.value) || 0))
                    }
                    className="rounded-lg"
                  />
                  <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── Telegram Tab ── */}
        <TabsContent value="telegram" className="space-y-6 mt-0">
          <TelegramSettingsTab isAdmin={role === "admin"} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
