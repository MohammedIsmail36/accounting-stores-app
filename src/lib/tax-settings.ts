export const SYSTEM_TAX_ACCOUNT_CODES = {
  purchase: "1105",
  sales: "2104",
} as const;

const SERVER_MANAGED_SETTINGS_FIELDS = [
  "id",
  "created_at",
  "updated_at",
  "singleton",
  "purchase_tax_account_id",
  "sales_tax_account_id",
] as const;

export function buildCompanySettingsUpdatePayload<T extends Record<string, unknown>>(
  settings: T,
): Omit<T, (typeof SERVER_MANAGED_SETTINGS_FIELDS)[number]> {
  const payload = { ...settings };
  for (const field of SERVER_MANAGED_SETTINGS_FIELDS) delete payload[field];
  return payload;
}
