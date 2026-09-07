import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { AppBreadcrumb } from "./AppBreadcrumb";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { FlaskConical, LogOut, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: React.ReactNode;
}

const roleLabels: Record<string, string> = {
  admin: "مدير",
  accountant: "محاسب",
  sales: "موظف مبيعات",
};

const isStagingEnvironment = import.meta.env.VITE_APP_ENV === "staging";

export function AppLayout({ children }: AppLayoutProps) {
  const { fullName, role, signOut } = useAuth();
  const navigate = useNavigate();
  usePageTitle();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header
            className={cn(
              "relative h-16 border-b border-border/60 bg-card flex items-center px-4 gap-3 sticky top-0 z-50",
              isStagingEnvironment &&
                "border-amber-400 bg-amber-100 shadow-[inset_0_-3px_0_0_rgb(217_119_6_/_0.55)] dark:border-amber-700 dark:bg-amber-950",
            )}
            data-environment={isStagingEnvironment ? "staging" : "production"}
          >
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <AppBreadcrumb />
            {isStagingEnvironment && (
              <div
                className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-300 bg-amber-100/95 px-2.5 py-1 text-[11px] font-bold text-amber-950 shadow-sm sm:px-3 sm:text-xs dark:border-amber-700 dark:bg-amber-900/80 dark:text-amber-100"
                role="status"
                aria-label="بيئة تجريبية، البيانات غير حقيقية"
              >
                <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">بيئة تجريبية</span>
                <span className="sm:hidden">تجريبي</span>
                <span className="hidden text-amber-700/80 lg:inline dark:text-amber-200/70">
                  — بيانات غير حقيقية
                </span>
              </div>
            )}
            <div className="flex-1" />
            {/* User */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate("/profile")}
                className="flex items-center gap-1.5 text-xs hover:text-primary transition-colors cursor-pointer"
              >
                <User className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="font-medium hidden sm:inline">
                  {fullName || "مستخدم"}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                onClick={signOut}
                aria-label="تسجيل الخروج"
                className="h-7 w-7"
              >
                <LogOut className="w-3.5 h-3.5" />
              </Button>
            </div>
          </header>
          <main className="px-4 md:px-6 pb-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
