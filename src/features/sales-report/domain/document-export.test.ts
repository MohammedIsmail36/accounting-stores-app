import { describe, expect, it } from "vitest";
import {
  buildInvoiceSalesExport,
  buildReturnSalesExport,
} from "./document-export";

const period = { dateFrom: "2026-08-01", dateTo: "2026-08-31" };

describe("sales document exports", () => {
  it("exports posted invoice coverage, profit and overdue state", () => {
    const config = buildInvoiceSalesExport({
      ...period,
      invoicePrefix: "INV-",
      today: "2026-09-03",
      invoices: [
        {
          id: "inv-1",
          invoice_number: 99,
          posted_number: 7,
          invoice_date: "2026-08-01",
          due_date: "2026-08-31",
          status: "posted",
          total: 1150,
          tax: 150,
          customer: { name: "عميل" },
        },
      ],
      cogsByInvoice: { "inv-1": 600 },
      coverageByInvoice: {
        "inv-1": {
          cashCollected: 500,
          returnSettled: 100,
          totalCovered: 600,
        },
      },
      detailStatusLabel: "المُرحّلة فقط",
    });

    expect(config.rows[0]).toEqual([
      "INV-0007",
      "2026-08-01",
      "عميل",
      "مُرحّل",
      1150,
      500,
      100,
      550,
      600,
      400,
      "40.0%",
      "نعم",
    ]);
    expect(config.rows[0]).toHaveLength(config.headers.length);
  });

  it("matches the table by hiding profit and margin for non-posted invoices", () => {
    const config = buildInvoiceSalesExport({
      ...period,
      invoicePrefix: "INV-",
      today: "2026-09-03",
      invoices: [
        {
          id: "draft",
          invoice_number: 12,
          posted_number: null,
          invoice_date: "2026-08-02",
          due_date: "2026-08-03",
          status: "draft",
          total: 100,
          tax: 0,
        },
        {
          id: "no-cost",
          invoice_number: 13,
          posted_number: 8,
          invoice_date: "2026-08-03",
          status: "posted",
          total: 100,
          tax: 0,
        },
      ],
      cogsByInvoice: {},
      coverageByInvoice: {},
      detailStatusLabel: "كل الحالات",
    });

    expect(config.rows[0].slice(9, 12)).toEqual(["—", "—", ""]);
    expect(config.rows[1].slice(9, 11)).toEqual([100, "—"]);
  });

  it("exports a return as an independent document before tax", () => {
    const config = buildReturnSalesExport({
      ...period,
      returnPrefix: "SRN-",
      detailStatusLabel: "المُرحّلة فقط",
      returns: [
        {
          return_number: 20,
          posted_number: 3,
          return_date: "2026-08-10",
          status: "posted",
          total: 230,
          tax: 30,
          customer: null,
          items: [{}, {}],
        },
      ],
    });

    expect(config.rows[0]).toEqual([
      "SRN-0003",
      "2026-08-10",
      "مُرحّل",
      "عميل نقدي",
      2,
      200,
      "مستند مستقل",
    ]);
    expect(config.rows[0]).toHaveLength(config.headers.length);
  });
});
