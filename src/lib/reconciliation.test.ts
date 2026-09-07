import { describe, it, expect } from "vitest";
import {
  checkProductQuantities,
  checkInventoryValue,
  checkTrialBalance,
  checkJournalBalance,
  checkOrphanEntries,
  checkPostedNumberSequence,
  checkEntityBalances,
  checkDocumentsHaveJournal,
  checkMovementsHaveSource,
  computeEntityBalanceDetails,
  summarizeChecks,
} from "./reconciliation";

import type { InventoryMovementRow } from "./inventory-metrics";

const moves: InventoryMovementRow[] = [
  { product_id: "p1", movement_type: "purchase", quantity: 10, total_cost: 1000 },
  { product_id: "p1", movement_type: "sale", quantity: 4, total_cost: 400 },
  { product_id: "p2", movement_type: "purchase", quantity: 5, total_cost: 250 },
];

describe("checkProductQuantities", () => {
  it("يمرّ عندما تطابق الكمية الحركات", () => {
    const r = checkProductQuantities(
      [
        { id: "p1", code: "A1", name: "منتج أ", quantity_on_hand: 6 },
        { id: "p2", code: "A2", name: "منتج ب", quantity_on_hand: 5 },
      ],
      moves,
    );
    expect(r.severity).toBe("ok");
    expect(r.checked).toBe(2);
    expect(r.issues).toHaveLength(0);
  });

  it("يرصد الفرق ويوضح المتوقع والفعلي", () => {
    const r = checkProductQuantities(
      [{ id: "p1", code: "A1", name: "منتج أ", quantity_on_hand: 9 }],
      moves,
    );
    expect(r.severity).toBe("error");
    expect(r.issues[0]).toMatchObject({
      label: "[A1] منتج أ",
      expected: 6,
      actual: 9,
      diff: 3,
    });
    expect(r.issues[0].link).toBe("/products/p1");
  });

  it("يرصد المنتج الذي له كمية بلا حركات", () => {
    const r = checkProductQuantities(
      [{ id: "pX", code: "X", name: "بلا حركات", quantity_on_hand: 4 }],
      moves,
    );
    expect(r.issues[0].expected).toBe(0);
    expect(r.issues[0].diff).toBe(4);
  });

  it("يتجاهل الفروق داخل حدود التسامح", () => {
    const r = checkProductQuantities(
      [{ id: "p1", code: "A1", name: "منتج أ", quantity_on_hand: 6.005 }],
      moves,
    );
    expect(r.severity).toBe("ok");
  });
});

describe("checkInventoryValue", () => {
  it("يطابق رصيد الدفتر مع قيمة التقييم", () => {
    const r = checkInventoryValue({
      computedValue: 850,
      ledgerBalance: 850,
      productsChecked: 2,
    });
    expect(r.computedValue).toBe(850);
    expect(r.ledgerValue).toBe(850);
    expect(r.severity).toBe("ok");
    expect(r.issues).toHaveLength(0);
  });

  it("يعدّ الفرق المحدود تحذيرًا لا انحرافًا حرجًا", () => {
    const r = checkInventoryValue({
      computedValue: 496732.97,
      ledgerBalance: 496986.28,
      productsChecked: 40,
    });
    expect(r.severity).toBe("warning");
    expect(r.issues[0].diff).toBe(253.31);
    expect(r.issues[0].unit).toBe("currency");
  });

  it("يعلن انحرافًا حرجًا عند الفرق الكبير", () => {
    const r = checkInventoryValue({
      computedValue: 850,
      ledgerBalance: 50000,
      productsChecked: 2,
    });
    expect(r.severity).toBe("error");
  });

  it("لا يقارن مع صفر وهمي عند تعذّر قراءة رصيد الدفتر", () => {
    const r = checkInventoryValue({
      computedValue: 496732.97,
      ledgerBalance: null,
      productsChecked: 40,
    });
    expect(r.severity).toBe("unavailable");
    expect(r.issues).toHaveLength(0);
    expect(r.unavailableReason).toContain("1104");
  });

  it("لا يقارن عند تعذّر قراءة قيمة التقييم", () => {
    const r = checkInventoryValue({
      computedValue: undefined,
      ledgerBalance: 496986.28,
      productsChecked: 40,
    });
    expect(r.severity).toBe("unavailable");
    expect(r.issues).toHaveLength(0);
  });

  it("يتجاهل فروق التقريب داخل حد التسامح", () => {
    const r = checkInventoryValue({
      computedValue: 100,
      ledgerBalance: 100.4,
      productsChecked: 1,
    });
    expect(r.severity).toBe("ok");
  });
});

describe("checkTrialBalance", () => {
  it("يمرّ عند تساوي المدين والدائن", () => {
    expect(checkTrialBalance(1000, 1000).severity).toBe("ok");
  });

  it("يرصد عدم التوازن", () => {
    const r = checkTrialBalance(1000, 900);
    expect(r.severity).toBe("error");
    expect(r.issues[0].diff).toBe(100);
  });

  it("يعلن تعذّر الفحص عند غياب الإجماليات", () => {
    expect(checkTrialBalance(null, null).severity).toBe("unavailable");
  });
});

describe("checkDocumentsHaveJournal", () => {
  it("يرصد المستند المرحّل بلا قيد فقط", () => {
    const r = checkDocumentsHaveJournal(
      [
        { id: "d1", label: "INV-1", status: "posted", journal_entry_id: "j1" },
        { id: "d2", label: "INV-2", status: "posted", journal_entry_id: null },
        { id: "d3", label: "INV-3", status: "draft", journal_entry_id: null },
        { id: "d4", label: "INV-4", status: "cancelled", journal_entry_id: null },
      ],
      "فواتير البيع",
    );
    expect(r.checked).toBe(2);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].id).toBe("d2");
    expect(r.severity).toBe("error");
  });
});

describe("checkMovementsHaveSource", () => {
  it("يتجاهل الرصيد الافتتاحي ويرصد الحركات بلا مرجع", () => {
    const r = checkMovementsHaveSource([
      { id: "m1", reference_id: "x", movement_type: "purchase" },
      { id: "m2", reference_id: null, movement_type: "opening_balance" },
      { id: "m3", reference_id: null, movement_type: "sale", product_label: "منتج" },
    ]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].id).toBe("m3");
    expect(r.severity).toBe("warning");
  });
});

describe("computeEntityBalanceDetails", () => {
  it("يفصّل مكوّنات الرصيد المتوقع", () => {
    const details = computeEntityBalanceDetails({
      openingBalances: new Map([["c1", 100]]),
      invoices: [{ entity_id: "c1", total: 1000 }],
      returns: [{ entity_id: "c1", total: 200 }],
      payments: [{ id: "pay1", entity_id: "c1", amount: 300 }],
      returnAllocations: [],
    });
    const b = details.get("c1")!;
    expect(b.opening).toBe(100);
    expect(b.invoices).toBe(1000);
    expect(b.returns).toBe(200);
    expect(b.payments).toBe(300);
    expect(b.expected).toBe(600);
  });
});


describe("checkJournalBalance", () => {
  const entries = [
    { id: "j1", entry_number: 1, posted_number: 11, total_debit: 100, total_credit: 100 },
    { id: "j2", entry_number: 2, posted_number: 12, total_debit: 50, total_credit: 50 },
  ];

  it("يمرّ عندما تتوازن السطور وتطابق الرأس", () => {
    const r = checkJournalBalance(entries, [
      { journal_entry_id: "j1", debit: 100, credit: 0 },
      { journal_entry_id: "j1", debit: 0, credit: 100 },
      { journal_entry_id: "j2", debit: 50, credit: 0 },
      { journal_entry_id: "j2", debit: 0, credit: 50 },
    ]);
    expect(r.severity).toBe("ok");
  });

  it("يرصد السطور غير المتوازنة", () => {
    const r = checkJournalBalance([entries[0]], [
      { journal_entry_id: "j1", debit: 100, credit: 0 },
      { journal_entry_id: "j1", debit: 0, credit: 90 },
    ]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].label).toContain("سطور غير متوازنة");
    expect(r.issues[0].diff).toBe(10);
  });

  it("يرصد اختلاف الرأس عن مجموع السطور", () => {
    const r = checkJournalBalance(
      [{ id: "j3", entry_number: 3, total_debit: 200, total_credit: 200 }],
      [
        { journal_entry_id: "j3", debit: 100, credit: 0 },
        { journal_entry_id: "j3", debit: 0, credit: 100 },
      ],
    );
    expect(r.issues[0].label).toContain("لا يطابق السطور");
    expect(r.issues[0].diff).toBe(100);
  });

  it("يجمع كل سطور القيد ولا يقتصر على سطرين", () => {
    const r = checkJournalBalance(
      [{ id: "j5", entry_number: 5, total_debit: 2799, total_credit: 2799 }],
      [
        { journal_entry_id: "j5", debit: 2799, credit: 0 },
        { journal_entry_id: "j5", debit: 184.22, credit: 0 },
        { journal_entry_id: "j5", debit: 0, credit: 2983.22 },
      ],
    );
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({
      expected: 2983.22,
      actual: 2799,
      diff: -184.22,
    });
  });

  it("يعرض انحراف الدائن عندما يكون رأس المدين صحيحًا", () => {
    const r = checkJournalBalance(
      [{ id: "j6", entry_number: 6, total_debit: 100, total_credit: 90 }],
      [
        { journal_entry_id: "j6", debit: 100, credit: 0 },
        { journal_entry_id: "j6", debit: 0, credit: 100 },
      ],
    );
    expect(r.issues[0]).toMatchObject({ expected: 100, actual: 90, diff: -10 });
    expect(r.issues[0].note).toContain("الدائن");
  });

  it("لا يبلّغ عن نفس القيد مرتين", () => {
    const r = checkJournalBalance(
      [{ id: "j4", entry_number: 4, total_debit: 999, total_credit: 999 }],
      [
        { journal_entry_id: "j4", debit: 100, credit: 0 },
        { journal_entry_id: "j4", debit: 0, credit: 80 },
      ],
    );
    expect(r.issues).toHaveLength(1);
  });
});

describe("checkOrphanEntries", () => {
  it("يرصد القيود بلا سطور فقط", () => {
    const r = checkOrphanEntries(
      [
        { id: "j1", entry_number: 1, total_debit: 0, total_credit: 0 },
        { id: "j2", entry_number: 2, total_debit: 10, total_credit: 10 },
      ],
      [{ journal_entry_id: "j2", debit: 10, credit: 0 }],
    );
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].id).toBe("j1");
  });
});

describe("checkPostedNumberSequence", () => {
  it("يمرّ على تسلسل سليم", () => {
    const r = checkPostedNumberSequence(
      [
        { id: "a", posted_number: 1 },
        { id: "b", posted_number: 2 },
        { id: "c", posted_number: 3 },
      ],
      "فواتير البيع",
    );
    expect(r.severity).toBe("ok");
    expect(r.checked).toBe(3);
  });

  it("يتجاهل المسودات (بلا رقم نشر)", () => {
    const r = checkPostedNumberSequence(
      [
        { id: "a", posted_number: 1 },
        { id: "b", posted_number: null },
      ],
      "فواتير البيع",
    );
    expect(r.checked).toBe(1);
    expect(r.severity).toBe("ok");
  });

  it("يعرض الفراغ كمعلومة فقط لا تحذير", () => {
    const r = checkPostedNumberSequence(
      [
        { id: "a", posted_number: 1 },
        { id: "b", posted_number: 4 },
      ],
      "فواتير البيع",
    );
    expect(r.severity).toBe("info");
    expect(r.issues[0].diff).toBe(2);
  });

  it("يرصد التكرار", () => {
    const r = checkPostedNumberSequence(
      [
        { id: "a", posted_number: 2 },
        { id: "b", posted_number: 2 },
      ],
      "فواتير البيع",
    );
    expect(r.issues.some((i) => i.label.includes("مكرر"))).toBe(true);
  });
});

describe("checkEntityBalances", () => {
  it("يمرّ عند التطابق", () => {
    const r = checkEntityBalances(
      [{ id: "c1", code: "CUST-001", name: "عميل", balance: 500 }],
      new Map([["c1", 500]]),
      "customer",
    );
    expect(r.severity).toBe("ok");
  });

  it("يرصد الفرق ويشير للمسار الصحيح", () => {
    const r = checkEntityBalances(
      [{ id: "s1", code: "SUPP-001", name: "مورد", balance: 300 }],
      new Map([["s1", 250]]),
      "supplier",
    );
    expect(r.issues[0].diff).toBe(50);
    expect(r.issues[0].link).toBe("/suppliers");
  });

  it("يعتبر الجهة بلا حركة دفترية متوقعها صفرًا", () => {
    const r = checkEntityBalances(
      [{ id: "c2", code: "CUST-002", name: "عميل ٢", balance: 120 }],
      new Map(),
      "customer",
    );
    expect(r.issues[0].expected).toBe(0);
  });
});

describe("summarizeChecks", () => {
  it("يلخّص الحالات ويحدد السلامة العامة", () => {
    const checks = [
      checkOrphanEntries([], []),
      checkPostedNumberSequence(
        [
          { id: "a", posted_number: 1 },
          { id: "b", posted_number: 5 },
        ],
        "قيود",
      ),
      checkProductQuantities(
        [{ id: "p1", code: "A1", name: "أ", quantity_on_hand: 99 }],
        moves,
      ),
    ];
    const s = summarizeChecks(checks);
    expect(s.total).toBe(3);
    expect(s.passed).toBe(1);
    expect(s.info).toBe(1);
    expect(s.warnings).toBe(0);
    expect(s.errors).toBe(1);
    expect(s.totalIssues).toBe(2);
    expect(s.healthy).toBe(false);
  });

  it("healthy عندما تنجح كل الفحوص", () => {
    const s = summarizeChecks([checkOrphanEntries([], [])]);
    expect(s.healthy).toBe(true);
  });
});
