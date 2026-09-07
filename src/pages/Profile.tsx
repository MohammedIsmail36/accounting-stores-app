import { useState, useEffect } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  User,
  Lock,
  Save,
  ShieldCheck,
  QrCode,
  KeyRound,
  CalendarDays,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "@/components/ui/input-otp";
import { ROLE_LABELS } from "@/lib/constants";
import { notify } from "@/lib/notify";

export default function Profile() {
  const { user, fullName, role } = useAuth();

  // Personal info
  const [name, setName] = useState(fullName);
  const [savingName, setSavingName] = useState(false);

  // Password
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // MFA
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [factorId, setFactorId] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [unenrolling, setUnenrolling] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  useEffect(() => {
    setName(fullName);
  }, [fullName]);

  // Check existing MFA factors
  useEffect(() => {
    const checkMFA = async () => {
      try {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) throw error;
        const verified = data.totp.filter((f) => f.status === "verified");
        setMfaEnabled(verified.length > 0);
        if (verified.length > 0) {
          setFactorId(verified[0].id);
        }
      } catch (err) {
        console.error("Error checking MFA:", err);
      } finally {
        setMfaLoading(false);
      }
    };
    checkMFA();
  }, []);

  const handleUpdateName = async () => {
    if (!name.trim()) {
      notify.error("خطأ", "الاسم مطلوب");
      return;
    }
    setSavingName(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: name.trim() })
        .eq("id", user?.id);
      if (error) throw error;
      notify.success("تم التحديث", "تم تحديث الاسم بنجاح");
    } catch (error: any) {
      notify.error("خطأ", error.message);
    } finally {
      setSavingName(false);
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword || !confirmPassword) {
      notify.error("خطأ", "يرجى ملء جميع الحقول");
      return;
    }
    if (newPassword.length < 8) {
      notify.error("خطأ", "كلمة المرور يجب أن تكون 8 أحرف على الأقل");
      return;
    }
    if (newPassword !== confirmPassword) {
      notify.error("خطأ", "كلمتا المرور غير متطابقتين");
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;
      notify.success("تم التحديث", "تم تغيير كلمة المرور بنجاح");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      notify.error("خطأ", error.message);
    } finally {
      setSavingPassword(false);
    }
  };

  const handleEnrollMFA = async () => {
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
      });
      if (error) throw error;
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setFactorId(data.id);
      setVerifyCode("");
      setEnrollDialogOpen(true);
    } catch (error: any) {
      notify.error("خطأ", error.message);
    }
  };

  const handleVerifyMFA = async () => {
    if (verifyCode.length !== 6) return;
    setVerifying(true);
    try {
      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: verifyCode,
      });
      if (verifyError) throw verifyError;

      setMfaEnabled(true);
      setEnrollDialogOpen(false);
      notify.success("تم التفعيل", "تم تفعيل التحقق بخطوتين بنجاح");
    } catch (error: any) {
      notify.error("خطأ", error.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleUnenrollMFA = async () => {
    setUnenrolling(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      setMfaEnabled(false);
      setFactorId("");
      notify.success("تم الإلغاء", "تم إلغاء التحقق بخطوتين");
    } catch (error: any) {
      notify.error("خطأ", error.message);
    } finally {
      setUnenrolling(false);
    }
  };

  const handleMfaToggle = (checked: boolean) => {
    if (checked) {
      handleEnrollMFA();
    } else {
      handleUnenrollMFA();
    }
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  const joinDate = user?.created_at
    ? new Date(user.created_at).toLocaleDateString("en-GB", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={User}
        title="إعدادات الملف الشخصي"
        description="قم بتحديث معلوماتك الشخصية وإدارة إعدادات الأمان الخاصة بك"
      />

      {/* Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-10 gap-6">
        {/* Left Column (Wide) */}
        <div className="lg:col-span-6 space-y-6">
          {/* Personal Information */}
          <Card className="overflow-hidden">
            <div className="p-5 border-b border-border">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <User className="w-5 h-5 text-primary" />
                المعلومات الشخصية
              </h3>
            </div>
            <CardContent className="p-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">الاسم الكامل</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="أدخل اسمك الكامل"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">
                    البريد الإلكتروني
                  </Label>
                  <Input
                    value={user?.email || ""}
                    disabled
                    className="bg-muted"
                    dir="ltr"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">الدور</Label>
                  <Input
                    value={role ? ROLE_LABELS[role] || role : ""}
                    disabled
                    className="bg-muted"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={handleUpdateName}
                    disabled={savingName}
                    className="w-full"
                  >
                    <Save className="w-4 h-4 ml-2" />
                    {savingName ? "جاري الحفظ..." : "حفظ الاسم"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Account Status */}
          <Card className="overflow-hidden">
            <div className="p-5 border-b border-border">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                حالة الحساب
              </h3>
            </div>
            <CardContent className="p-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-muted/50 p-4 rounded-xl border border-border">
                  <p className="text-xs text-muted-foreground font-medium mb-1.5">
                    حالة الأمان
                  </p>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-green-500" />
                    <span className="font-bold text-green-600 dark:text-green-400 text-sm">
                      نشط وآمن
                    </span>
                  </div>
                </div>
                <div className="bg-muted/50 p-4 rounded-xl border border-border">
                  <p className="text-xs text-muted-foreground font-medium mb-1.5">
                    تاريخ الانضمام
                  </p>
                  <div className="flex items-center gap-2">
                    <CalendarDays className="w-5 h-5 text-muted-foreground" />
                    <span className="font-bold text-sm">{joinDate}</span>
                  </div>
                </div>
                <div className="bg-muted/50 p-4 rounded-xl border border-border">
                  <p className="text-xs text-muted-foreground font-medium mb-1.5">
                    التحقق بخطوتين
                  </p>
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-5 h-5 text-muted-foreground" />
                    {mfaLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : mfaEnabled ? (
                      <Badge variant="default" className="bg-green-600 text-xs">
                        مفعّل
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        غير مفعّل
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column (Narrow) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Security & Password */}
          <Card className="overflow-hidden">
            <div className="p-5 border-b border-border">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Lock className="w-5 h-5 text-primary" />
                الأمان والخصوصية
              </h3>
            </div>
            <CardContent className="p-5 space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">
                  كلمة المرور الجديدة
                </Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  dir="ltr"
                  minLength={8}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">
                  تأكيد كلمة المرور
                </Label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  dir="ltr"
                />
              </div>
              <Button
                onClick={handleChangePassword}
                disabled={savingPassword}
                className="w-full"
                variant="secondary"
              >
                <Lock className="w-4 h-4 ml-2" />
                {savingPassword ? "جاري التحديث..." : "تحديث كلمة المرور"}
              </Button>
            </CardContent>
          </Card>

          {/* Two-Factor Authentication */}
          <Card className="overflow-hidden">
            <div className="p-5 border-b border-border">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <QrCode className="w-5 h-5 text-primary" />
                التحقق بخطوتين (2FA)
              </h3>
            </div>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-bold">تفعيل الخاصية</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    أضف طبقة أمان إضافية باستخدام تطبيق Google Authenticator
                  </p>
                </div>
                {mfaLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                ) : (
                  <Switch
                    checked={mfaEnabled}
                    onCheckedChange={handleMfaToggle}
                    disabled={unenrolling}
                  />
                )}
              </div>
              {mfaEnabled && (
                <div className="mt-4 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                  <p className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" />
                    حسابك محمي بالتحقق بخطوتين
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* MFA Enrollment Dialog */}
      <Dialog open={enrollDialogOpen} onOpenChange={setEnrollDialogOpen}>
        <DialogContent
          className="sm:max-w-[500px] p-0 overflow-hidden"
          dir="rtl"
        >
          {/* Header */}
          <div className="flex items-center justify-between py-4 px-6 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-2 rounded-lg">
                <ShieldCheck className="w-6 h-6 text-primary" />
              </div>
              <DialogTitle className="text-xl font-bold">
                تفعيل التحقق بخطوتين
              </DialogTitle>
            </div>
          </div>

          {/* Content */}
          <div className="p-4 space-y-6">
            <DialogDescription className="text-center leading-relaxed">
              امسح رمز QR باستخدام تطبيق المصادقة (مثل Google Authenticator) ثم
              أدخل الرمز المكون من 6 أرقام.
            </DialogDescription>

            {/* QR Code */}
            {qrCode && (
              <div className="flex justify-center">
                <div className="p-4 bg-card border-2 border-border rounded-xl">
                  <div className="w-48 h-48 bg-muted flex items-center justify-center rounded-lg overflow-hidden relative border border-border">
                    <img
                      src={qrCode}
                      alt="رمز QR للتحقق بخطوتين"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Manual Key Section */}
            {secret && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-muted-foreground">
                  أدخل المفتاح يدوياً إذا لم تتمكن من المسح
                </Label>
                <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border border-border">
                  <code
                    className="flex-1 font-mono text-sm tracking-widest text-foreground"
                    dir="ltr"
                  >
                    {secret}
                  </code>
                  <button
                    onClick={copySecret}
                    className="text-primary hover:bg-primary/10 p-1.5 rounded-md transition-colors flex items-center gap-1"
                  >
                    {copiedSecret ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                    <span className="text-xs font-bold">
                      {copiedSecret ? "تم" : "نسخ"}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* 6-Digit Verification Code */}
            <div className="space-y-4">
              <Label className="text-sm font-medium text-muted-foreground text-center block">
                رمز التحقق
              </Label>
              <div className="flex justify-center" dir="ltr">
                <InputOTP
                  maxLength={6}
                  value={verifyCode}
                  onChange={(val) => setVerifyCode(val)}
                >
                  <InputOTPGroup>
                    <InputOTPSlot
                      index={0}
                      className="w-12 h-14 text-xl font-bold border-2"
                    />
                    <InputOTPSlot
                      index={1}
                      className="w-12 h-14 text-xl font-bold border-2"
                    />
                    <InputOTPSlot
                      index={2}
                      className="w-12 h-14 text-xl font-bold border-2"
                    />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot
                      index={3}
                      className="w-12 h-14 text-xl font-bold border-2"
                    />
                    <InputOTPSlot
                      index={4}
                      className="w-12 h-14 text-xl font-bold border-2"
                    />
                    <InputOTPSlot
                      index={5}
                      className="w-12 h-14 text-xl font-bold border-2"
                    />
                  </InputOTPGroup>
                </InputOTP>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-6 bg-muted/30 flex flex-col gap-3">
            <button
              onClick={handleVerifyMFA}
              disabled={verifyCode.length !== 6 || verifying}
              className="w-full py-3 px-4 bg-primary text-primary-foreground font-bold rounded-xl shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {verifying ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>جاري التحقق...</span>
                </>
              ) : (
                <>
                  <span>تفعيل التحقق بخطوتين</span>
                  <Check className="w-5 h-5" />
                </>
              )}
            </button>
            <button
              onClick={() => setEnrollDialogOpen(false)}
              className="w-full py-3 px-4 text-muted-foreground font-medium rounded-xl hover:bg-muted transition-all"
            >
              إلغاء العملية
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
