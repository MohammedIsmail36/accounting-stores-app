import { createContext, useContext, useCallback } from "react";
import {
  useCompanySettingsQuery,
  useInvalidateCompanySettings,
} from "@/hooks/use-company-settings";

export interface CompanySettings {
  id: string;
  company_name: string;
  company_name_en: string;
  logo_url: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  tax_number: string;
  commercial_register: string;
  business_activity: string;
  default_currency: string;
  fiscal_year_start: string;
  tax_rate: number;
  sales_invoice_prefix: string;
  purchase_invoice_prefix: string;
  sales_return_prefix: string;
  purchase_return_prefix: string;
  customer_payment_prefix: string;
  supplier_payment_prefix: string;
  payment_terms_days: number;
  show_tax_on_invoice: boolean;
  show_discount_on_invoice: boolean;
  invoice_notes: string;
  invoice_footer: string;
  journal_entry_prefix: string;
  expense_prefix: string;
  product_code_prefix: string;
  return_days_limit: number;
  enable_return_days_limit: boolean;
  enable_fiscal_year_closing: boolean;
  monthly_sales_target: number;
  stock_enforcement_enabled: boolean;
  locked_until_date: string | null;
  enable_tax: boolean;
  sales_tax_account_id: string | null;
  purchase_tax_account_id: string | null;
  loyalty_enabled: boolean;
  loyalty_egp_per_point: number;
  loyalty_points_per_redeem: number;
  loyalty_redeem_value: number;
  inventory_lead_time_days: number;
  inventory_target_cover_days: number;
  inventory_slow_days: number;
  inventory_dead_days: number;
  inventory_new_days: number;
}

interface SettingsContextType {
  settings: CompanySettings | null;
  loading: boolean;
  refetch: () => Promise<void>;
  currency: string;
  formatCurrency: (val: number) => string;
}

const SettingsContext = createContext<SettingsContextType>({
  settings: null,
  loading: true,
  refetch: async () => {},
  currency: "EGP",
  formatCurrency: (val) =>
    `${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP`,
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useCompanySettingsQuery();
  const invalidate = useInvalidateCompanySettings();

  const settings = (data ?? null) as unknown as CompanySettings | null;
  const currency = settings?.default_currency || "EGP";

  const formatCurrency = useCallback(
    (val: number) => {
      const isNegative = val < 0;
      const formatted = Math.abs(val).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return `${isNegative ? "-" : ""}${formatted} ${currency}`;
    },
    [currency],
  );

  const refetch = useCallback(async () => {
    await invalidate();
  }, [invalidate]);

  return (
    <SettingsContext.Provider
      value={{
        settings,
        loading: isLoading,
        refetch,
        currency,
        formatCurrency,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
