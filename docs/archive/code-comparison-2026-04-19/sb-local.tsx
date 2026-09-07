import {
  LayoutDashboard,
  FileText,
  ShoppingCart,
  Package,
  BarChart3,
  Users,
  Truck,
  BookOpen,
  Calculator,
  Settings,
  UserCog,
  RotateCcw,
  ClipboardCheck,
  CreditCard,
  TrendingUp,
  Landmark,
  ReceiptText,
  Boxes,
  ChartPie,
  Lock,
  Wallet,
  Receipt,
  Award,
  Clock,
  DollarSign,
  AlertTriangle,
  Sparkles,
  Archive,
  Undo2,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { RoleGuard } from "@/components/auth/RoleGuard";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

type AppRole = "admin" | "accountant" | "sales";

interface MenuItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: AppRole[];
  children?: MenuItem[];
}

interface MenuSection {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  colorVar: string;
  items: MenuItem[];
  defaultOpen?: boolean;
}

const sections: MenuSection[] = [
  {
    label: "المخزون",
    icon: Boxes,
    colorVar: "var(--cat-inventory)",
    items: [
      {
        title: "المنتجات",
        url: "/products",
        icon: Package,
        roles: ["admin", "accountant", "sales"],
      },
      {
        title: "الوحدات",
        url: "/inventory/units",
        icon: Package,
        roles: ["admin", "accountant"],
      },
      {
        title: "التصنيف",
        url: "/inventory/categories",
        icon: Package,
        roles: ["admin", "accountant"],
      },
      {
        title: "الماركة المصنعة",
        url: "/inventory/brands",
        icon: Package,
        roles: ["admin", "accountant"],
      },
    ],
  },
  {
    label: "الحسابات",
    icon: Landmark,
    colorVar: "var(--cat-accounting)",
    items: [
      {
        title: "شجرة الحسابات",
        url: "/accounts",
        icon: BookOpen,
        roles: ["admin", "accountant"],
      },
      {
        title: "قيود اليومية",
        url: "/journal",
        icon: FileText,
        roles: ["admin", "accountant"],
      },
      {
        title: "دفتر الأستاذ",
        url: "/ledger",
        icon: Calculator,
        roles: ["admin", "accountant"],
      },
    ],
  },
  {
    label: "المصروفات",
    icon: Wallet,
    colorVar: "var(--cat-purchases)",
    items: [
      {
        title: "المصروفات",
        url: "/expenses",
        icon: Receipt,
        roles: ["admin", "accountant", "sales"],
      },
      {
        title: "أنواع المصروفات",
        url: "/expense-types",
        icon: Receipt,
        roles: ["admin", "accountant"],
      },
    ],
  },
  {
    label: "المشتريات",
    icon: ShoppingCart,
    colorVar: "var(--cat-purchases)",
    items: [
      {
        title: "فاتورة مشتريات",
        url: "/purchases",
        icon: ReceiptText,
        roles: ["admin", "accountant"],
      },
      {
        title: "مرتجع مشتريات",
        url: "/purchase-returns",
        icon: RotateCcw,
        roles: ["admin", "accountant"],
      },
      {
        title: "مدفوعات موردين",
        url: "/supplier-payments",
        icon: CreditCard,
        roles: ["admin", "accountant"],
      },
      {
        title: "الموردين",
        url: "/suppliers",
        icon: Truck,
        roles: ["admin", "accountant"],
      },
      {
        title: "كشف حساب مورد",
        url: "/supplier-statement",
        icon: FileText,
        roles: ["admin", "accountant"],
      },
    ],
  },
  {
    label: "المبيعات",
    icon: TrendingUp,
    colorVar: "var(--cat-sales)",
    items: [
      {
        title: "فاتورة مبيعات",
        url: "/sales",
        icon: ReceiptText,
        roles: ["admin", "accountant", "sales"],
      },
      {
        title: "مرتجع مبيعات",
        url: "/sales-returns",
        icon: RotateCcw,
        roles: ["admin", "accountant", "sales"],
      },
      {
        title: "مدفوعات عملاء",
        url: "/customer-payments",
        icon: CreditCard,
        roles: ["admin", "accountant", "sales"],
      },
      {
        title: "العملاء",
        url: "/customers",
        icon: Users,
        roles: ["admin", "accountant", "sales"],
      },
      {
        title: "كشف حساب عميل",
        url: "/customer-statement",
        icon: FileText,
        roles: ["admin", "accountant", "sales"],
      },
    ],
  },
  {
    label: "التقارير",
    icon: ChartPie,
    colorVar: "var(--cat-reports)",
    items: [
      {
        title: "ميزان المراجعة",
        url: "/trial-balance",
        icon: BarChart3,
        roles: ["admin", "accountant"],
      },
      {
        title: "قائمة الدخل",
        url: "/income-statement",
        icon: BarChart3,
        roles: ["admin", "accountant"],
      },
      {
        title: "الميزانية العمومية",
        url: "/balance-sheet",
        icon: BarChart3,
        roles: ["admin", "accountant"],
      },
      {
        title: "التدفقات النقدية",
        url: "/cash-flow",
        icon: BarChart3,
        roles: ["admin", "accountant"],
      },
      {
        title: "تحليلات النمو",
        url: "/reports/growth",
        icon: TrendingUp,
        roles: ["admin", "accountant"],
      },
      {
        title: "تحليل المنتجات",
        url: "/reports/products",
        icon: Award,
        roles: ["admin", "accountant"],
      },
      {
        title: "تقرير المبيعات",
        url: "/reports/sales",
        icon: BarChart3,
        roles: ["admin", "accountant", "sales"],
      },
      {
        title: "تقرير المشتريات",
        url: "/reports/purchases",
        icon: ShoppingCart,
        roles: ["admin", "accountant"],
      },
      {
        title: "تقرير المخزون",
        url: "/reports/inventory",
        icon: Package,
        roles: ["admin", "accountant"],
      },
      {
        title: "أعمار الديون",
        url: "/reports/aging",
        icon: Clock,
        roles: ["admin", "accountant"],
      },
      {
        title: "أرصدة الحسابات",
        url: "/reports/balances",
        icon: Calculator,
        roles: ["admin", "accountant"],
      },
      {
        title: "الأرباح والخسائر",
        url: "/reports/profit-loss",
        icon: DollarSign,
        roles: ["admin", "accountant"],
      },
      {
        title: "حركة المخزون",
        url: "/inventory-movements",
        icon: Package,
        roles: ["admin", "accountant"],
      },
      {
        title: "دوران المخزون",
        url: "/reports/inventory-turnover",
        icon: TrendingUp,
        roles: ["admin", "accountant"],
        children: [
          {
            title: "لوحة المؤشرات",
            url: "/reports/inventory-turnover",
            icon: ChartPie,
            roles: ["admin", "accountant"],
          },
          {
            title: "إجراءات عاجلة",
            url: "/reports/inventory-turnover/urgent-actions",
            icon: AlertTriangle,
            roles: ["admin", "accountant"],
          },
          {
            title: "خطة الشراء",
            url: "/reports/inventory-turnover/purchase-planning",
            icon: ShoppingCart,
            roles: ["admin", "accountant"],
          },
          {
            title: "المخزون الراكد",
            url: "/reports/inventory-turnover/dormant",
            icon: Archive,
            roles: ["admin", "accountant"],
          },
          {
            title: "إرجاع للمورد",
            url: "/reports/inventory-turnover/supplier-returns",
            icon: Undo2,
            roles: ["admin", "accountant"],
          },
          {
            title: "منتجات جديدة",
            url: "/reports/inventory-turnover/new-products",
            icon: Sparkles,
            roles: ["admin", "accountant"],
          },
          {
            title: "مراجعة مطلوبة",
            url: "/reports/inventory-turnover/unlisted",
            icon: AlertTriangle,
            roles: ["admin", "accountant"],
          },
          {
            title: "التحليل الشامل",
            url: "/reports/inventory-turnover/analysis",
            icon: BarChart3,
            roles: ["admin", "accountant"],
          },
        ],
      },
      {
        title: "تسوية المخزون",
        url: "/inventory-adjustments",
        icon: ClipboardCheck,
        roles: ["admin", "accountant"],
      },
    ],
  },
];

const settingsItems: MenuItem[] = [
  { title: "إدارة المستخدمين", url: "/users", icon: UserCog, roles: ["admin"] },
  { title: "الإعدادات", url: "/settings", icon: Settings, roles: ["admin"] },
  {
    title: "إعداد النظام",
    url: "/system-setup",
    icon: Settings,
    roles: ["admin"],
  },
];

function NestedMenuItem({
  item,
  userRole,
}: {
  item: MenuItem;
  userRole: string | null;
}) {
  const location = useLocation();
  const children = (item.children || []).filter(
    (c) => userRole && c.roles.includes(userRole as AppRole),
  );
  const isActive = children.some(
    (c) =>
      location.pathname === c.url || location.pathname.startsWith(c.url + "/"),
  );
  const [open, setOpen] = useState(isActive);
  if (children.length === 0) return null;
  return (
    <SidebarMenuItem>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="w-full">
          <SidebarMenuButton className="h-8 justify-between">
            <span className="text-muted-foreground text-[13px]">
              {item.title}
            </span>
            <ChevronDown
              className={`w-3 h-3 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenu className="pr-3 pt-0.5">
            {children.map((child) => (
              <SidebarMenuItem key={child.title}>
                <SidebarMenuButton asChild className="h-7">
                  <NavLink
                    to={child.url}
                    end={child.url === "/reports/inventory-turnover"}
                    className="text-muted-foreground hover:text-foreground hover:bg-muted/50 text-[12px]"
                    activeClassName="text-primary bg-accent font-semibold"
                  >
                    <child.icon className="w-3 h-3 ml-1.5" />
                    <span>{child.title}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

function CollapsibleSection({
  section,
  userRole,
}: {
  section: MenuSection;
  userRole: string | null;
}) {
  const location = useLocation();

  // Filter items by role
  const visibleItems = section.items.filter(
    (item) => userRole && item.roles.includes(userRole as AppRole),
  );

  const isActive = visibleItems.some(
    (item) =>
      location.pathname === item.url ||
      location.pathname.startsWith(item.url + "/"),
  );
  const [open, setOpen] = useState(isActive);

  // Hide entire section if no visible items
  if (visibleItems.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <SidebarGroup className="py-0">
        <CollapsibleTrigger className="w-full">
          <SidebarGroupLabel className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/50 rounded-md transition-colors text-foreground/80 text-sm font-semibold">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: `hsl(${section.colorVar} / 0.12)`,
                color: `hsl(${section.colorVar})`,
              }}
            >
              <section.icon className="w-4 h-4" />
            </div>
            <span className="flex-1 text-right">{section.label}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            />
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent className="pr-9 pt-0.5 pb-1">
            <SidebarMenu>
              {visibleItems.map((item) =>
                item.children && item.children.length > 0 ? (
                  <NestedMenuItem
                    key={item.title}
                    item={item}
                    userRole={userRole}
                  />
                ) : (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild className="h-8">
                      <NavLink
                        to={item.url}
                        end={item.url === "/"}
                        className="text-muted-foreground hover:text-foreground hover:bg-muted/50 text-[13px]"
                        activeClassName="text-primary bg-accent font-semibold"
                      >
                        <span>{item.title}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ),
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

export function AppSidebar() {
  const { settings } = useSettings();
  const { role } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Sidebar className="border-l-0 border-e border-border/60" side="right">
      <SidebarHeader className="p-4 border-b border-border/60">
        <div className="flex items-center gap-3">
          {settings?.logo_url ? (
            <img
              src={settings.logo_url}
              alt={settings.company_name || "Logo"}
              className="w-9 h-9 rounded-xl object-contain"
            />
          ) : (
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
              <Calculator className="w-5 h-5 text-primary-foreground" />
            </div>
          )}
          {!collapsed && (
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-foreground truncate">
                {settings?.company_name || "النظام المحاسبي"}
              </h2>
              <p className="text-[11px] text-muted-foreground truncate">
                {settings?.business_activity || "نظام المحاسبة الذكي"}
              </p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="py-2">
        {/* Dashboard */}
        <SidebarGroup className="py-0">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild className="h-9">
                  <NavLink
                    to="/"
                    end
                    className="text-foreground/80 hover:bg-muted/50 font-medium"
                    activeClassName="text-primary bg-accent font-semibold"
                  >
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `hsl(var(--primary) / 0.12)` }}
                    >
                      <LayoutDashboard className="w-4 h-4 text-primary" />
                    </div>
                    <span>لوحة التحكم</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Collapsible sections */}
        {sections.map((section) => (
          <CollapsibleSection
            key={section.label}
            section={section}
            userRole={role}
          />
        ))}

        {/* Fiscal Year Closing - conditional */}
        {settings?.enable_fiscal_year_closing && (
          <SidebarGroup className="py-0">
            <SidebarGroupContent>
              <SidebarMenu>
                <RoleGuard allowedRoles={["admin", "accountant"]}>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild className="h-9">
                      <NavLink
                        to="/fiscal-year-closing"
                        className="text-foreground/80 hover:bg-muted/50 font-medium"
                        activeClassName="text-primary bg-accent font-semibold"
                      >
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center"
                          style={{
                            backgroundColor: `hsl(var(--primary) / 0.12)`,
                          }}
                        >
                          <Lock className="w-4 h-4 text-primary" />
                        </div>
                        <span>إقفال السنة المالية</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </RoleGuard>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Settings */}
        <SidebarGroup className="py-0 mt-2 border-t border-border/40 pt-2">
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => (
                <RoleGuard key={item.title} allowedRoles={item.roles}>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild className="h-8">
                      <NavLink
                        to={item.url}
                        className="text-muted-foreground hover:text-foreground hover:bg-muted/50 text-[13px]"
                        activeClassName="text-primary bg-accent font-semibold"
                      >
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </RoleGuard>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
