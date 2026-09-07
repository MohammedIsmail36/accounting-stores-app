export const ALL_CUSTOMERS_FILTER = "__all__";
export const CASH_CUSTOMER_FILTER = "__cash__";

interface CustomerFilterDocument {
  customer_id?: string | null;
  customer?: { name?: string | null } | null;
}

export interface SalesCustomerFilterOption {
  id: string;
  name: string;
}

export function filterSalesDocumentsByCustomer<T extends CustomerFilterDocument>(
  documents: T[],
  customerFilter: string,
): T[] {
  if (customerFilter === ALL_CUSTOMERS_FILTER) return documents;
  if (customerFilter === CASH_CUSTOMER_FILTER) {
    return documents.filter((document) => !document.customer_id);
  }
  return documents.filter(
    (document) => document.customer_id === customerFilter,
  );
}

export function buildSalesCustomerFilterOptions(
  invoices: CustomerFilterDocument[],
  returns: CustomerFilterDocument[],
): SalesCustomerFilterOption[] {
  const documents = [...invoices, ...returns];
  const customers = new Map<string, string>();
  let hasCashCustomer = false;

  for (const document of documents) {
    if (!document.customer_id) {
      hasCashCustomer = true;
      continue;
    }
    const currentName = customers.get(document.customer_id);
    const candidateName = document.customer?.name?.trim();
    if (!currentName || candidateName) {
      customers.set(
        document.customer_id,
        candidateName || currentName || "عميل بدون اسم",
      );
    }
  }

  return [
    { id: ALL_CUSTOMERS_FILTER, name: "كل العملاء" },
    ...(hasCashCustomer
      ? [{ id: CASH_CUSTOMER_FILTER, name: "عميل نقدي" }]
      : []),
    ...Array.from(customers, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name, "ar"),
    ),
  ];
}
