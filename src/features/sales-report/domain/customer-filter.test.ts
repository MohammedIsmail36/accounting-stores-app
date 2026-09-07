import { describe, expect, it } from "vitest";
import {
  ALL_CUSTOMERS_FILTER,
  CASH_CUSTOMER_FILTER,
  buildSalesCustomerFilterOptions,
  filterSalesDocumentsByCustomer,
} from "./customer-filter";

const documents = [
  { id: "one", customer_id: "customer-1", customer: { name: "باسم" } },
  { id: "cash", customer_id: null, customer: null },
  { id: "two", customer_id: "customer-2", customer: { name: "أحمد" } },
];

describe("sales report customer filter", () => {
  it("keeps all documents only for the all-customers option", () => {
    expect(filterSalesDocumentsByCustomer(documents, ALL_CUSTOMERS_FILTER)).toBe(
      documents,
    );
    expect(
      filterSalesDocumentsByCustomer(documents, "customer-1").map(
        ({ id }) => id,
      ),
    ).toEqual(["one"]);
  });

  it("treats missing customer ids as cash-customer documents", () => {
    expect(
      filterSalesDocumentsByCustomer(documents, CASH_CUSTOMER_FILTER).map(
        ({ id }) => id,
      ),
    ).toEqual(["cash"]);
  });

  it("builds unique Arabic-sorted choices from invoices and returns", () => {
    expect(
      buildSalesCustomerFilterOptions(documents, [
        {
          customer_id: "customer-1",
          customer: { name: "باسم المحدث" },
        },
      ]),
    ).toEqual([
      { id: ALL_CUSTOMERS_FILTER, name: "كل العملاء" },
      { id: CASH_CUSTOMER_FILTER, name: "عميل نقدي" },
      { id: "customer-2", name: "أحمد" },
      { id: "customer-1", name: "باسم المحدث" },
    ]);
  });
});
