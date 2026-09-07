import { describe, it, expect } from "vitest";
import {
  validateJournalLines,
  journalTotal,
  reverseLines,
} from "./journal-writer";

const acc = (n: string) => `00000000-0000-0000-0000-00000000000${n}`;

describe("validateJournalLines", () => {
  it("يرفض القيد الفارغ", () => {
    expect(validateJournalLines([])).toMatch("سطرين");
  });

  it("يرفض القيد بسطر واحد", () => {
    expect(
      validateJournalLines([{ account_id: acc("1"), debit: 100, credit: 0 }]),
    ).toMatch("سطرين");
  });

  it("يرفض القيد غير المتوازن", () => {
    expect(
      validateJournalLines([
        { account_id: acc("1"), debit: 100, credit: 0 },
        { account_id: acc("2"), debit: 0, credit: 90 },
      ]),
    ).toMatch("غير متوازن");
  });

  it("يرفض سطرًا مدينًا ودائنًا في نفس الوقت", () => {
    expect(
      validateJournalLines([
        { account_id: acc("1"), debit: 100, credit: 100 },
        { account_id: acc("2"), debit: 100, credit: 100 },
      ]),
    ).toMatch("مدينًا ودائنًا");
  });

  it("يرفض السطر بدون حساب", () => {
    expect(
      validateJournalLines([
        { account_id: "", debit: 100, credit: 0 },
        { account_id: acc("2"), debit: 0, credit: 100 },
      ]),
    ).toMatch("حساب");
  });

  it("يتجاهل السطور الصفرية ويرفض ما يقل عن سطرين بعدها", () => {
    expect(
      validateJournalLines([
        { account_id: acc("1"), debit: 100, credit: 0 },
        { account_id: acc("2"), debit: 0, credit: 100 },
        { account_id: acc("3"), debit: 0, credit: 0 },
      ]),
    ).toBeNull();
  });

  it("يقبل القيد المتوازن مع فروق تقريب", () => {
    expect(
      validateJournalLines([
        { account_id: acc("1"), debit: 10.005, credit: 0 },
        { account_id: acc("2"), debit: 0, credit: 10.005 },
      ]),
    ).toBeNull();
  });
});

describe("journalTotal", () => {
  it("يحسب إجمالي المدين مقربًا لخانتين", () => {
    expect(
      journalTotal([
        { account_id: acc("1"), debit: 33.333, credit: 0 },
        { account_id: acc("2"), debit: 0, credit: 33.33 },
      ]),
    ).toBe(33.33);
  });
});

describe("reverseLines", () => {
  it("يقلب المدين والدائن ويضيف بادئة الوصف", () => {
    const out = reverseLines([
      { account_id: acc("1"), debit: 50, credit: 0, description: "مبيعات" },
      { account_id: acc("2"), debit: 0, credit: 50, description: "عملاء" },
    ]);
    expect(out[0]).toEqual({
      account_id: acc("1"),
      debit: 0,
      credit: 50,
      description: "عكس - مبيعات",
    });
    expect(out[1].debit).toBe(50);
    expect(out[1].credit).toBe(0);
  });

  it("القيد العكسي يبقى متوازنًا", () => {
    const out = reverseLines([
      { account_id: acc("1"), debit: 120.5, credit: 0 },
      { account_id: acc("2"), debit: 0, credit: 100 },
      { account_id: acc("3"), debit: 0, credit: 20.5 },
    ]);
    expect(validateJournalLines(out)).toBeNull();
  });
});
