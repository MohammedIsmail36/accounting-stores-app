import { lazy, Suspense } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { FULL_SALES_REPORT_ROLES } from "@/features/sales-report/domain/access";
import { FINANCE_ROLES } from "@/lib/role-access";
import { PageSkeleton } from "@/components/PageSkeleton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { usePageTitle } from "@/hooks/use-page-title";

const PageTitleUpdater = () => {
  usePageTitle();
  return null;
};

// Eager (small + first-paint critical)
import Auth from "./pages/Auth";
import MfaVerify from "./pages/MfaVerify";

import NotFound from "./pages/NotFound";

// Dashboard is heavy (recharts) — lazy load it
const Dashboard = lazy(() => import("./pages/Dashboard"));

// Lazy — list pages
const Accounts = lazy(() => import("./pages/Accounts"));
const Journal = lazy(() => import("./pages/Journal"));
const JournalEntryForm = lazy(() => import("./pages/JournalEntryForm"));
const Ledger = lazy(() => import("./pages/Ledger"));
const Sales = lazy(() => import("./pages/Sales"));
const SalesInvoiceForm = lazy(() => import("./pages/SalesInvoiceForm"));
const SalesReturns = lazy(() => import("./pages/SalesReturns"));
const SalesReturnForm = lazy(() => import("./pages/SalesReturnForm"));
const CustomerPayments = lazy(() => import("./pages/CustomerPayments"));
const Customers = lazy(() => import("./pages/Customers"));
const Purchases = lazy(() => import("./pages/Purchases"));
const PurchaseInvoiceForm = lazy(() => import("./pages/PurchaseInvoiceForm"));
const PurchaseReturns = lazy(() => import("./pages/PurchaseReturns"));
const PurchaseReturnForm = lazy(() => import("./pages/PurchaseReturnForm"));
const SupplierPayments = lazy(() => import("./pages/SupplierPayments"));
const Suppliers = lazy(() => import("./pages/Suppliers"));
const Products = lazy(() => import("./pages/Products"));
const ProductForm = lazy(() => import("./pages/ProductForm"));
const ProductView = lazy(() => import("./pages/ProductView"));
const ProductImport = lazy(() => import("./pages/ProductImport"));
const LookupManagement = lazy(() => import("./pages/LookupManagement"));
const CategoryManagement = lazy(() => import("./pages/CategoryManagement"));
const InventoryMovements = lazy(() => import("./pages/InventoryMovements"));
const InventoryAdjustments = lazy(() => import("./pages/InventoryAdjustments"));
const InventoryAdjustmentForm = lazy(() => import("./pages/InventoryAdjustmentForm"));
const TrialBalance = lazy(() => import("./pages/TrialBalance"));
const IncomeStatement = lazy(() => import("./pages/IncomeStatement"));
const BalanceSheet = lazy(() => import("./pages/BalanceSheet"));
const CashFlowStatement = lazy(() => import("./pages/CashFlowStatement"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const UserManagement = lazy(() => import("./pages/UserManagement"));
const Profile = lazy(() => import("./pages/Profile"));
const SystemSetup = lazy(() => import("./pages/SystemSetup"));
const CustomerStatement = lazy(() => import("./pages/CustomerStatement"));
const SupplierStatement = lazy(() => import("./pages/SupplierStatement"));
const FiscalYearClosing = lazy(() => import("./pages/FiscalYearClosing"));
const ExpenseTypes = lazy(() => import("./pages/ExpenseTypes"));
const Expenses = lazy(() => import("./pages/Expenses"));
const LoyaltyReport = lazy(() => import("./pages/LoyaltyReport"));




// Lazy — reports (heavy: recharts/jspdf/xlsx)
const SalesReportPage = lazy(() => import("./pages/reports/SalesReportPage"));
const PurchasesReportPage = lazy(() => import("./pages/reports/PurchasesReportPage"));
const DebtAgingReportPage = lazy(() => import("./pages/reports/DebtAgingReportPage"));
const GrowthAnalyticsPage = lazy(() => import("./pages/reports/GrowthAnalyticsPage"));
const ProductAnalyticsPage = lazy(() => import("./pages/reports/ProductAnalyticsPage"));
const AccountBalancesPage = lazy(() => import("./pages/reports/AccountBalancesPage"));
const ProfitLossPage = lazy(() => import("./pages/reports/ProfitLossPage"));
const CommissionCalculatorPage = lazy(() => import("./pages/reports/CommissionCalculatorPage"));
const InventoryReconciliationPage = lazy(() => import("./pages/reports/InventoryReconciliationPage"));
const InventoryValuationPage = lazy(() => import("./pages/reports/InventoryValuationPage"));
const InventoryAgingPage = lazy(() => import("./pages/reports/InventoryAgingPage"));
const InventoryReorderPage = lazy(() => import("./pages/reports/InventoryReorderPage"));
const InventoryKpisPage = lazy(() => import("./pages/reports/InventoryKpisPage"));
const SystemHealthPage = lazy(() => import("./pages/reports/SystemHealthPage"));




const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const withSuspense = (node: React.ReactNode) => (
  <Suspense fallback={<PageSkeleton />}>{node}</Suspense>
);

const HomeRoute = () => {
  const { role, roleLoading } = useAuth();

  if (roleLoading) return <PageSkeleton />;
  if (!role || !FINANCE_ROLES.includes(role)) {
    return <Navigate to="/sales" replace />;
  }

  return <AppLayout>{withSuspense(<Dashboard />)}</AppLayout>;
};

const routerBasename =
  import.meta.env.BASE_URL === "/"
    ? undefined
    : import.meta.env.BASE_URL.replace(/\/$/, "");

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <ErrorBoundary>
        <BrowserRouter basename={routerBasename}>
          <AuthProvider>
            <SettingsProvider>
            <PageTitleUpdater />
            <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/mfa" element={<MfaVerify />} />

            <Route path="/" element={<ProtectedRoute><HomeRoute /></ProtectedRoute>} />
            <Route path="/accounts" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<Accounts />)}</AppLayout></ProtectedRoute>} />
            <Route path="/journal" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<Journal />)}</AppLayout></ProtectedRoute>} />
            <Route path="/journal/new" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<JournalEntryForm />)}</AppLayout></ProtectedRoute>} />
            <Route path="/journal/:id" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<JournalEntryForm />)}</AppLayout></ProtectedRoute>} />
            <Route path="/ledger" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<Ledger />)}</AppLayout></ProtectedRoute>} />
            <Route path="/sales" element={<ProtectedRoute allowedRoles={["admin", "accountant", "sales"]}><AppLayout>{withSuspense(<Sales />)}</AppLayout></ProtectedRoute>} />
            <Route path="/sales/new" element={<ProtectedRoute allowedRoles={["admin", "accountant", "sales"]}><AppLayout>{withSuspense(<SalesInvoiceForm />)}</AppLayout></ProtectedRoute>} />
            <Route path="/sales/:id" element={<ProtectedRoute allowedRoles={["admin", "accountant", "sales"]}><AppLayout>{withSuspense(<SalesInvoiceForm />)}</AppLayout></ProtectedRoute>} />
            <Route path="/sales-returns" element={<ProtectedRoute allowedRoles={["admin", "accountant", "sales"]}><AppLayout>{withSuspense(<SalesReturns />)}</AppLayout></ProtectedRoute>} />
            <Route path="/sales-returns/new" element={<ProtectedRoute allowedRoles={["admin", "accountant", "sales"]}><AppLayout>{withSuspense(<SalesReturnForm />)}</AppLayout></ProtectedRoute>} />
            <Route path="/sales-returns/:id" element={<ProtectedRoute allowedRoles={["admin", "accountant", "sales"]}><AppLayout>{withSuspense(<SalesReturnForm />)}</AppLayout></ProtectedRoute>} />
            <Route path="/customer-payments" element={<ProtectedRoute allowedRoles={["admin", "accountant", "sales"]}><AppLayout>{withSuspense(<CustomerPayments />)}</AppLayout></ProtectedRoute>} />
            <Route path="/customers" element={<ProtectedRoute allowedRoles={["admin", "accountant", "sales"]}><AppLayout>{withSuspense(<Customers />)}</AppLayout></ProtectedRoute>} />
            <Route path="/customer-statement/:id" element={<ProtectedRoute allowedRoles={["admin", "accountant", "sales"]}><AppLayout>{withSuspense(<CustomerStatement />)}</AppLayout></ProtectedRoute>} />
            <Route path="/purchases" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<Purchases />)}</AppLayout></ProtectedRoute>} />
            <Route path="/purchases/new" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<PurchaseInvoiceForm />)}</AppLayout></ProtectedRoute>} />
            <Route path="/purchases/:id" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<PurchaseInvoiceForm />)}</AppLayout></ProtectedRoute>} />
            <Route path="/purchase-returns" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<PurchaseReturns />)}</AppLayout></ProtectedRoute>} />
            <Route path="/purchase-returns/new" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<PurchaseReturnForm />)}</AppLayout></ProtectedRoute>} />
            <Route path="/purchase-returns/:id" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<PurchaseReturnForm />)}</AppLayout></ProtectedRoute>} />
            <Route path="/supplier-payments" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<SupplierPayments />)}</AppLayout></ProtectedRoute>} />
            <Route path="/suppliers" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<Suppliers />)}</AppLayout></ProtectedRoute>} />
            <Route path="/supplier-statement/:id" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<SupplierStatement />)}</AppLayout></ProtectedRoute>} />
            <Route path="/products" element={<ProtectedRoute allowedRoles={FINANCE_ROLES}><AppLayout>{withSuspense(<Products />)}</AppLayout></ProtectedRoute>} />
            <Route path="/products/new" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<ProductForm />)}</AppLayout></ProtectedRoute>} />
            <Route path="/products/import" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<ProductImport />)}</AppLayout></ProtectedRoute>} />
            <Route path="/products/:id" element={<ProtectedRoute allowedRoles={FINANCE_ROLES}><AppLayout>{withSuspense(<ProductView />)}</AppLayout></ProtectedRoute>} />
            <Route path="/products/:id/edit" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<ProductForm />)}</AppLayout></ProtectedRoute>} />
            <Route path="/inventory/categories" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<CategoryManagement />)}</AppLayout></ProtectedRoute>} />
            <Route path="/inventory/:type" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<LookupManagement />)}</AppLayout></ProtectedRoute>} />
            <Route path="/trial-balance" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<TrialBalance />)}</AppLayout></ProtectedRoute>} />
            <Route path="/income-statement" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<IncomeStatement />)}</AppLayout></ProtectedRoute>} />
            <Route path="/balance-sheet" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<BalanceSheet />)}</AppLayout></ProtectedRoute>} />
            <Route path="/cash-flow" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<CashFlowStatement />)}</AppLayout></ProtectedRoute>} />
            <Route path="/reports/sales" element={<ProtectedRoute allowedRoles={FULL_SALES_REPORT_ROLES}><AppLayout>{withSuspense(<SalesReportPage />)}</AppLayout></ProtectedRoute>} />
            <Route path="/reports/purchases" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<PurchasesReportPage />)}</AppLayout></ProtectedRoute>} />
            <Route path="/reports/inventory" element={<Navigate to="/reports/inventory-valuation" replace />} />
            <Route path="/reports/aging" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<DebtAgingReportPage />)}</AppLayout></ProtectedRoute>} />
            <Route path="/reports/growth" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<GrowthAnalyticsPage />)}</AppLayout></ProtectedRoute>} />
            <Route path="/reports/products" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<ProductAnalyticsPage />)}</AppLayout></ProtectedRoute>} />
            <Route path="/reports/balances" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<AccountBalancesPage />)}</AppLayout></ProtectedRoute>} />
            <Route path="/reports/profit-loss" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<ProfitLossPage />)}</AppLayout></ProtectedRoute>} />
            <Route path="/reports/commission" element={<ProtectedRoute allowedRoles={FINANCE_ROLES}><AppLayout>{withSuspense(<CommissionCalculatorPage />)}</AppLayout></ProtectedRoute>} />
            <Route path="/reports/inventory-valuation" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<InventoryValuationPage />)}</AppLayout></ProtectedRoute>} />
            <Route path="/reports/inventory-aging" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<InventoryAgingPage />)}</AppLayout></ProtectedRoute>} />
            <Route path="/reports/inventory-reorder" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<InventoryReorderPage />)}</AppLayout></ProtectedRoute>} />
            <Route path="/reports/inventory-kpis" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<InventoryKpisPage />)}</AppLayout></ProtectedRoute>} />
            <Route path="/reports/inventory-reconciliation" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<InventoryReconciliationPage />)}</AppLayout></ProtectedRoute>} />
            <Route path="/reports/system-health" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<SystemHealthPage />)}</AppLayout></ProtectedRoute>} />

            <Route path="/customer-statement" element={<ProtectedRoute allowedRoles={["admin", "accountant", "sales"]}><AppLayout>{withSuspense(<CustomerStatement />)}</AppLayout></ProtectedRoute>} />
            <Route path="/supplier-statement" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<SupplierStatement />)}</AppLayout></ProtectedRoute>} />
            <Route path="/inventory-movements" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<InventoryMovements />)}</AppLayout></ProtectedRoute>} />
            <Route path="/reports/inventory-turnover/*" element={<Navigate to="/reports/inventory" replace />} />

            <Route path="/inventory-adjustments" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<InventoryAdjustments />)}</AppLayout></ProtectedRoute>} />
            <Route path="/inventory-adjustments/new" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<InventoryAdjustmentForm />)}</AppLayout></ProtectedRoute>} />
            <Route path="/inventory-adjustments/:id" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<InventoryAdjustmentForm />)}</AppLayout></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute allowedRoles={["admin"]}><AppLayout>{withSuspense(<SettingsPage />)}</AppLayout></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute allowedRoles={["admin"]}><AppLayout>{withSuspense(<UserManagement />)}</AppLayout></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><AppLayout>{withSuspense(<Profile />)}</AppLayout></ProtectedRoute>} />
            <Route path="/system-setup" element={<ProtectedRoute allowedRoles={["admin"]}><AppLayout>{withSuspense(<SystemSetup />)}</AppLayout></ProtectedRoute>} />
            <Route path="/fiscal-year-closing" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<FiscalYearClosing />)}</AppLayout></ProtectedRoute>} />
            <Route path="/expense-types" element={<ProtectedRoute allowedRoles={["admin", "accountant"]}><AppLayout>{withSuspense(<ExpenseTypes />)}</AppLayout></ProtectedRoute>} />
            <Route path="/expenses" element={<ProtectedRoute allowedRoles={FINANCE_ROLES}><AppLayout>{withSuspense(<Expenses />)}</AppLayout></ProtectedRoute>} />
            <Route path="/loyalty" element={<ProtectedRoute allowedRoles={["admin", "accountant", "sales"]}><AppLayout>{withSuspense(<LoyaltyReport />)}</AppLayout></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </SettingsProvider>
        </AuthProvider>
      </BrowserRouter>
      </ErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
