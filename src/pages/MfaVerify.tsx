import { useState, useEffect } from "react";
import { LoadingState } from "@/components/LoadingState";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ShieldCheck, Loader2, CheckCircle, HeadsetIcon } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from "@/components/ui/input-otp";
import { notify } from "@/lib/notify";

export default function MfaVerify() {
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { user, mfaRequired } = useAuth();

  useEffect(() => {
    if (!user) {
      navigate("/auth", { replace: true });
      return;
    }
    if (!mfaRequired) {
      navigate("/", { replace: true });
      return;
    }

    const loadFactor = async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp.filter((f) => f.status === "verified") || [];
      if (verified.length > 0) {
        setFactorId(verified[0].id);
      }
      setLoading(false);
    };
    loadFactor();
  }, [user, mfaRequired, navigate]);

  const handleVerify = async () => {
    if (code.length !== 6 || !factorId) return;
    setVerifying(true);
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (verifyError) throw verifyError;

      navigate("/", { replace: true });
      window.location.reload();
    } catch (error: any) {
      notify.error("خطأ", "رمز التحقق غير صحيح");
      setCode("");
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoadingState variant="inline" className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted p-4 font-tajawal" dir="rtl">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="bg-card shadow-xl rounded-xl p-8 border border-border">
          {/* Header */}
          <div className="flex flex-col items-center mb-8 text-center">
            <div className="bg-primary/10 p-3 rounded-full mb-4">
              <ShieldCheck className="w-9 h-9 text-primary" />
            </div>
            <h1 className="text-foreground text-xl font-bold mb-2">التحقق بخطوتين</h1>
            <p className="text-muted-foreground text-sm">أدخل رمز التحقق من تطبيق المصادقة الخاص بك</p>
          </div>

          {/* OTP Input */}
          <div className="space-y-8">
            <div className="flex justify-center" dir="ltr">
              <InputOTP maxLength={6} value={code} onChange={(val) => setCode(val)}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} className="w-12 h-14 text-2xl font-bold" />
                  <InputOTPSlot index={1} className="w-12 h-14 text-2xl font-bold border-2" />
                  <InputOTPSlot index={2} className="w-12 h-14 text-2xl font-bold border-2" />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  <InputOTPSlot index={3} className="w-12 h-14 text-2xl font-bold border-2" />
                  <InputOTPSlot index={4} className="w-12 h-14 text-2xl font-bold border-2" />
                  <InputOTPSlot index={5} className="w-12 h-14 text-2xl font-bold border-2" />
                </InputOTPGroup>
              </InputOTP>
            </div>

            {/* Primary Action */}
            <button
              onClick={handleVerify}
              disabled={code.length !== 6 || verifying}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {verifying ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>جاري التحقق...</span>
                </>
              ) : (
                <>
                  <span>تأكيد</span>
                  <CheckCircle className="w-5 h-5" />
                </>
              )}
            </button>
          </div>

          {/* Footer Links */}
          <div className="mt-8 text-center flex flex-col gap-4">
            <button
              onClick={() => {
                supabase.auth.signOut();
                navigate("/auth", { replace: true });
              }}
              className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors underline decoration-border underline-offset-4"
            >
              العودة لتسجيل الدخول
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
