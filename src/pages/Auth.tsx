import { notify } from "@/lib/notify";
import { LoadingState } from "@/components/LoadingState";
import { useState } from "react";
import { useNavigate, Navigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getSafeInternalPath } from "@/lib/safe-internal-path";
import {
  Calculator,
  Eye,
  EyeOff,
  CheckCircle,
  Lock,
  ShieldCheck,
} from "lucide-react";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading, mfaRequired } = useAuth();

  const nextPath = getSafeInternalPath(searchParams.get("next"));

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingState variant="inline" className="h-8 w-8" />
      </div>
    );
  }

  if (user && mfaRequired) {
    return <Navigate to="/auth/mfa" replace />;
  }

  if (user) {
    return <Navigate to={nextPath} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      navigate(nextPath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "تعذّر تسجيل الدخول.";
      notify.error("خطأ", message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex h-screen w-full overflow-hidden font-tajawal"
      dir="rtl"
    >
      {/* Login Form Section */}
      <section className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12 md:p-24 bg-card">
        <div className="w-full max-w-md animate-fade-in">
          {/* Logo and Heading */}
          <div className="text-center mb-10">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
                <Calculator className="w-7 h-7 text-primary-foreground" />
              </div>
              <span className="text-2xl font-extrabold text-foreground tracking-tight">
                النظام المحاسبي
              </span>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              تسجيل الدخول
            </h2>
            <p className="text-muted-foreground">
              مرحباً بك مجدداً! يرجى إدخال بياناتك للدخول
            </p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-foreground mb-2"
              >
                البريد الإلكتروني
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
                dir="ltr"
                className="block w-full px-4 py-3 rounded-xl border border-input bg-muted text-foreground placeholder:text-muted-foreground transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-foreground mb-2"
              >
                كلمة المرور
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  dir="ltr"
                  className="block w-full px-4 py-3 rounded-xl border border-input bg-muted text-foreground placeholder:text-muted-foreground transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 mr-4 pl-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={
                    showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"
                  }
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-3.5 px-4 rounded-xl shadow-sm text-base font-bold text-primary-foreground bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "جارٍ التحميل..." : "تسجيل الدخول"}
            </button>

            {/* Footer */}
            <div className="text-center mt-8 pt-6 border-t border-border">
              <p className="text-sm text-muted-foreground">
                © 2026 جميع الحقوق محفوظة
              </p>
            </div>
          </form>
        </div>
      </section>

      {/* Branding Section */}
      <section className="hidden lg:flex lg:w-1/2 bg-[hsl(213,65%,16%)] relative overflow-hidden flex-col items-center justify-center p-12 text-primary-foreground">
        {/* Decorative background */}
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <svg
            className="w-full h-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <circle cx="10" cy="10" r="20" fill="currentColor" />
            <circle cx="90" cy="90" r="30" fill="currentColor" />
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
            />
          </svg>
        </div>

        <div className="relative z-10 text-center max-w-md">
          <h1 className="text-4xl font-extrabold mb-6 leading-tight">
            نظام محاسبي متطور لإدارة أعمالك
          </h1>
          <p className="text-xl text-blue-100 font-light mb-12">
            نحن نوفر لك حلولاً مالية ذكية وموثوقة تساعدك على التركيز على نمو
            أعمالك بينما نتولى نحن الأرقام.
          </p>

          {/* Feature Highlights */}
          <div className="space-y-6 text-right">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                <CheckCircle className="h-6 w-6" />
              </div>
              <p className="text-lg">تقارير مالية فورية ودقيقة</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                <Lock className="h-6 w-6" />
              </div>
              <p className="text-lg">أمان عالي لبياناتك المحاسبية</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <p className="text-lg">تحقق بخطوتين لحماية حسابك</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
