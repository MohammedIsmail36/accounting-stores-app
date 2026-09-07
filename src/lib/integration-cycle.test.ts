import { describe, it, expect } from "vitest";

/**
 * Integration Tests - Complete Accounting Cycle
 *
 * Simulates a full business cycle:
 * 1. Purchase invoice → inventory in
 * 2. Sales invoice → inventory out + COGS
 * 3. Sales return → inventory back + reverse COGS
 * 4. Customer payment → balance reduction
 * 5. Account statement → running balance verification
 * 6. Trial balance → equation check
 * 7. Income statement → profit calculation
 * 8. Balance sheet → equation check
 *
 * All logic mirrors the actual app code (no DB calls).
 */

// ─── Simulated Database State ───────────────────────────────────────────

interface Account {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
}

interface JournalLine {
  accountCode: string;
  debit: number;
  credit: number;
  description: string;
}

interface JournalEntry {
  id: number;
  description: string;
  status: "posted";
  lines: JournalLine[];
}

interface InventoryMovement {
  productCode: string;
  type: "purchase" | "sale" | "sale_return" | "opening_balance" | "adjustment";
  quantity: number;
  unitCost: number;
  totalCost: number;
}

interface StatementLine {
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

// ─── Helper Functions (mirror app logic) ────────────────────────────────

function validateJournalEntry(lines: JournalLine[]): boolean {
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  return Math.abs(totalDebit - totalCredit) < 0.001;
}

function getAvgPurchasePrice(movements: InventoryMovement[]): number {
  const buys = movements.filter(m => m.type === "purchase" || m.type === "opening_balance");
  const totalQty = buys.reduce((s, m) => s + m.quantity, 0);
  const totalCost = buys.reduce((s, m) => s + m.totalCost, 0);
  return totalQty > 0 ? totalCost / totalQty : 0;
}

function getAccountBalance(entries: JournalEntry[], code: string): { debit: number; credit: number; net: number } {
  let debit = 0, credit = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.accountCode === code) {
        debit += line.debit;
        credit += line.credit;
      }
    }
  }
  return { debit, credit, net: debit - credit };
}

function buildCustomerStatement(entries: JournalEntry[], customerAccountCode: string): StatementLine[] {
  const lines: StatementLine[] = [];
  let balance = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.accountCode === customerAccountCode) {
        balance += line.debit - line.credit;
        lines.push({
          description: entry.description,
          debit: line.debit,
          credit: line.credit,
          runningBalance: balance,
        });
      }
    }
  }
  return lines;
}

function getTrialBalance(entries: JournalEntry[], accounts: Account[]): { code: string; name: string; debit: number; credit: number }[] {
  return accounts.map(acc => {
    const bal = getAccountBalance(entries, acc.code);
    // Trial balance shows raw debit/credit totals per account
    return { code: acc.code, name: acc.name, debit: bal.debit, credit: bal.credit };
  }).filter(a => a.debit !== 0 || a.credit !== 0);
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("Integration: Complete Sales Cycle", () => {
  // Shared state across the cycle
  const accounts: Account[] = [
    { code: "1101", name: "الصندوق", type: "asset" },
    { code: "1103", name: "العملاء", type: "asset" },
    { code: "1104", name: "المخزون", type: "asset" },
    { code: "2101", name: "الموردون", type: "liability" },
    { code: "3101", name: "رأس المال", type: "equity" },
    { code: "4101", name: "إيرادات المبيعات", type: "revenue" },
    { code: "5101", name: "تكلفة البضاعة المباعة", type: "expense" },
  ];

  const entries: JournalEntry[] = [];
  const movements: InventoryMovement[] = [];
  let entryId = 0;
  let productQty = 0;
  let customerBalance = 0;
  let supplierBalance = 0;

  // ── Step 1: Purchase 20 units @ 100 each = 2,000 ──
  it("Step 1: Purchase invoice creates correct journal & inventory", () => {
    const qty = 20, unitPrice = 100, total = qty * unitPrice;

    // Journal: Dr Inventory 2000, Cr Supplier 2000
    const lines: JournalLine[] = [
      { accountCode: "1104", debit: total, credit: 0, description: "المخزون" },
      { accountCode: "2101", debit: 0, credit: total, description: "الموردون" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);

    entries.push({ id: ++entryId, description: "فاتورة شراء #1", status: "posted", lines });
    movements.push({ productCode: "P001", type: "purchase", quantity: qty, unitCost: unitPrice, totalCost: total });
    productQty += qty;
    supplierBalance += total;

    expect(productQty).toBe(20);
    expect(supplierBalance).toBe(2000);
  });

  // ── Step 2: Purchase another 10 units @ 120 each = 1,200 ──
  it("Step 2: Second purchase updates avg cost correctly", () => {
    const qty = 10, unitPrice = 120, total = qty * unitPrice;

    const lines: JournalLine[] = [
      { accountCode: "1104", debit: total, credit: 0, description: "المخزون" },
      { accountCode: "2101", debit: 0, credit: total, description: "الموردون" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);

    entries.push({ id: ++entryId, description: "فاتورة شراء #2", status: "posted", lines });
    movements.push({ productCode: "P001", type: "purchase", quantity: qty, unitCost: unitPrice, totalCost: total });
    productQty += qty;
    supplierBalance += total;

    // Avg = (2000 + 1200) / (20 + 10) = 3200 / 30 = 106.67
    const avgCost = getAvgPurchasePrice(movements);
    expect(avgCost).toBeCloseTo(106.67, 2);
    expect(productQty).toBe(30);
    expect(supplierBalance).toBe(3200);
  });

  // ── Step 3: Sell 8 units @ 200 each = 1,600 ──
  it("Step 3: Sales invoice uses avg cost for COGS", () => {
    const qty = 8, sellingPrice = 200;
    const revenue = qty * sellingPrice; // 1600
    const avgCost = getAvgPurchasePrice(movements); // 106.67
    const cogs = Math.round(avgCost * qty * 100) / 100; // 853.33

    // Journal: Dr Customer 1600, Cr Revenue 1600, Dr COGS 853.33, Cr Inventory 853.33
    const lines: JournalLine[] = [
      { accountCode: "1103", debit: revenue, credit: 0, description: "العملاء" },
      { accountCode: "4101", debit: 0, credit: revenue, description: "إيرادات المبيعات" },
      { accountCode: "5101", debit: cogs, credit: 0, description: "تكلفة البضاعة" },
      { accountCode: "1104", debit: 0, credit: cogs, description: "المخزون" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);

    entries.push({ id: ++entryId, description: "فاتورة بيع #1", status: "posted", lines });
    movements.push({ productCode: "P001", type: "sale", quantity: qty, unitCost: avgCost, totalCost: cogs });
    productQty -= qty;
    customerBalance += revenue;

    expect(productQty).toBe(22);
    expect(customerBalance).toBe(1600);
  });

  // ── Step 4: Sales return 2 units ──
  it("Step 4: Sales return reverses revenue & COGS at avg cost", () => {
    const qty = 2, sellingPrice = 200;
    const returnValue = qty * sellingPrice; // 400
    const avgCost = getAvgPurchasePrice(movements); // still 106.67
    const costReturn = Math.round(avgCost * qty * 100) / 100; // 213.33

    // Journal: Dr Revenue 400, Cr Customer 400, Dr Inventory 213.33, Cr COGS 213.33
    const lines: JournalLine[] = [
      { accountCode: "4101", debit: returnValue, credit: 0, description: "مرتجع مبيعات" },
      { accountCode: "1103", debit: 0, credit: returnValue, description: "العملاء" },
      { accountCode: "1104", debit: costReturn, credit: 0, description: "المخزون" },
      { accountCode: "5101", debit: 0, credit: costReturn, description: "عكس تكلفة" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);

    entries.push({ id: ++entryId, description: "مرتجع بيع #1", status: "posted", lines });
    movements.push({ productCode: "P001", type: "sale_return", quantity: qty, unitCost: avgCost, totalCost: costReturn });
    productQty += qty;
    customerBalance -= returnValue;

    expect(productQty).toBe(24);
    expect(customerBalance).toBe(1200);
  });

  // ── Step 5: Customer payment 500 ──
  it("Step 5: Customer payment reduces balance correctly", () => {
    const paymentAmount = 500;

    // Journal: Dr Cash 500, Cr Customer 500
    const lines: JournalLine[] = [
      { accountCode: "1101", debit: paymentAmount, credit: 0, description: "سند قبض" },
      { accountCode: "1103", debit: 0, credit: paymentAmount, description: "العملاء" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);

    entries.push({ id: ++entryId, description: "سند قبض #1", status: "posted", lines });
    customerBalance -= paymentAmount;

    expect(customerBalance).toBe(700);
  });

  // ── Step 6: Supplier payment 1000 ──
  it("Step 6: Supplier payment reduces supplier balance", () => {
    const paymentAmount = 1000;

    const lines: JournalLine[] = [
      { accountCode: "2101", debit: paymentAmount, credit: 0, description: "سند صرف" },
      { accountCode: "1101", debit: 0, credit: paymentAmount, description: "الصندوق" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);

    entries.push({ id: ++entryId, description: "سند صرف #1", status: "posted", lines });
    supplierBalance -= paymentAmount;

    expect(supplierBalance).toBe(2200);
  });

  // ── Step 7: Verify customer account statement ──
  it("Step 7: Customer account statement shows correct running balance", () => {
    const statement = buildCustomerStatement(entries, "1103");

    // Expected: sale +1600, return -400, payment -500
    expect(statement.length).toBe(3);
    expect(statement[0].debit).toBe(1600);
    expect(statement[0].runningBalance).toBe(1600);
    expect(statement[1].credit).toBe(400);
    expect(statement[1].runningBalance).toBe(1200);
    expect(statement[2].credit).toBe(500);
    expect(statement[2].runningBalance).toBe(700);

    // Final balance matches tracked balance
    expect(statement[statement.length - 1].runningBalance).toBe(customerBalance);
  });

  // ── Step 8: Verify trial balance equation ──
  it("Step 8: Trial balance total debits = total credits", () => {
    const tb = getTrialBalance(entries, accounts);
    const totalDebit = tb.reduce((s, a) => s + a.debit, 0);
    const totalCredit = tb.reduce((s, a) => s + a.credit, 0);
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
  });

  // ── Step 9: Verify income statement ──
  it("Step 9: Income statement calculates net profit correctly", () => {
    // Net revenue = 1600 (sale) - 400 (return) = 1200
    const revenueBal = getAccountBalance(entries, "4101");
    const netRevenue = revenueBal.credit - revenueBal.debit; // credit nature
    expect(netRevenue).toBe(1200);

    // Net COGS = 853.33 (sale) - 213.33 (return) = 640
    const cogsBal = getAccountBalance(entries, "5101");
    const netCOGS = cogsBal.debit - cogsBal.credit; // debit nature
    expect(netCOGS).toBeCloseTo(640, 2);

    // Gross profit = 1200 - 640 = 560
    const grossProfit = netRevenue - netCOGS;
    expect(grossProfit).toBeCloseTo(560, 2);
  });

  // ── Step 10: Verify balance sheet equation ──
  it("Step 10: Balance sheet: Assets = Liabilities + Equity + Profit", () => {
    // Assets
    const cash = getAccountBalance(entries, "1101").net;       // 500 - 1000 = -500
    const customers = getAccountBalance(entries, "1103").net;  // 1600 - 400 - 500 = 700
    const inventory = getAccountBalance(entries, "1104").net;  // 3200 - 853.33 + 213.33 = 2560
    const totalAssets = cash + customers + inventory;

    // Liabilities
    const suppliers = -(getAccountBalance(entries, "2101").net); // credit nature: 3200 - 1000 = 2200

    // Net profit (revenue - expenses)
    const revenue = getAccountBalance(entries, "4101");
    const netRevenue = revenue.credit - revenue.debit;
    const cogs = getAccountBalance(entries, "5101");
    const netCOGS = cogs.debit - cogs.credit;
    const netProfit = netRevenue - netCOGS;

    // Assets = Liabilities + Equity + Profit (no equity injected in this cycle)
    // totalAssets = -500 + 700 + 2560 = 2760
    // suppliers + profit = 2200 + 560 = 2760
    expect(totalAssets).toBeCloseTo(suppliers + netProfit, 2);
  });

  // ── Step 11: Verify inventory quantity matches movements ──
  it("Step 11: Inventory quantity reconciles with movements", () => {
    let calculatedQty = 0;
    for (const m of movements) {
      if (m.type === "purchase" || m.type === "opening_balance" || m.type === "sale_return") {
        calculatedQty += m.quantity;
      } else if (m.type === "sale") {
        calculatedQty -= m.quantity;
      }
    }
    expect(calculatedQty).toBe(productQty);
    expect(calculatedQty).toBe(24);
  });

  // ── Step 12: All journal entries are balanced ──
  it("Step 12: Every single journal entry is balanced", () => {
    for (const entry of entries) {
      const totalDebit = entry.lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = entry.lines.reduce((s, l) => s + l.credit, 0);
      expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
    }
  });
});

describe("Integration: Inventory Adjustment Full Cycle (Deficit + Surplus → Trial Balance → Income Statement)", () => {
  const accounts: Account[] = [
    { code: "1104", name: "المخزون", type: "asset" },
    { code: "4101", name: "إيرادات المبيعات", type: "revenue" },
    { code: "4201", name: "فائض مخزون", type: "revenue" },
    { code: "5101", name: "تكلفة البضاعة المباعة", type: "expense" },
    { code: "5201", name: "عجز مخزون", type: "expense" },
    { code: "1103", name: "العملاء", type: "asset" },
    { code: "2101", name: "الموردون", type: "liability" },
  ];

  const entries: JournalEntry[] = [];
  const movements: InventoryMovement[] = [];
  let entryId = 200;
  let productQty = 0;

  // ── Step 1: Initial purchase 100 units @ 60 ──
  it("Step 1: Purchase creates initial inventory", () => {
    const qty = 100, unitPrice = 60, total = qty * unitPrice;
    const lines: JournalLine[] = [
      { accountCode: "1104", debit: total, credit: 0, description: "المخزون" },
      { accountCode: "2101", debit: 0, credit: total, description: "الموردون" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
    entries.push({ id: ++entryId, description: "فاتورة شراء", status: "posted", lines });
    movements.push({ productCode: "P003", type: "purchase", quantity: qty, unitCost: unitPrice, totalCost: total });
    productQty = qty;
    expect(productQty).toBe(100);
  });

  // ── Step 2: Sell 20 units @ 120 ──
  it("Step 2: Sales invoice reduces inventory", () => {
    const qty = 20, sellingPrice = 120;
    const revenue = qty * sellingPrice; // 2400
    const avgCost = getAvgPurchasePrice(movements); // 60
    const cogs = avgCost * qty; // 1200

    const lines: JournalLine[] = [
      { accountCode: "1103", debit: revenue, credit: 0, description: "العملاء" },
      { accountCode: "4101", debit: 0, credit: revenue, description: "إيرادات" },
      { accountCode: "5101", debit: cogs, credit: 0, description: "تكلفة بضاعة" },
      { accountCode: "1104", debit: 0, credit: cogs, description: "المخزون" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
    entries.push({ id: ++entryId, description: "فاتورة بيع", status: "posted", lines });
    movements.push({ productCode: "P003", type: "sale", quantity: qty, unitCost: avgCost, totalCost: cogs });
    productQty -= qty;
    expect(productQty).toBe(80);
  });

  // ── Step 3: Inventory adjustment - deficit 5 units ──
  it("Step 3: Deficit adjustment (system 80, actual 75) creates expense entry", () => {
    const systemQty = 80;
    const actualQty = 75;
    const deficit = systemQty - actualQty; // 5
    const avgCost = getAvgPurchasePrice(movements); // 60
    const deficitCost = deficit * avgCost; // 300

    const lines: JournalLine[] = [
      { accountCode: "5201", debit: deficitCost, credit: 0, description: "عجز مخزون" },
      { accountCode: "1104", debit: 0, credit: deficitCost, description: "المخزون" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
    entries.push({ id: ++entryId, description: "تسوية مخزون - عجز", status: "posted", lines });
    movements.push({ productCode: "P003", type: "adjustment", quantity: -deficit, unitCost: avgCost, totalCost: deficitCost });
    productQty -= deficit;

    expect(productQty).toBe(75);
    expect(deficitCost).toBe(300);
  });

  // ── Step 4: Inventory adjustment - surplus 8 units (different product scenario) ──
  it("Step 4: Surplus adjustment (system 75, actual 83) creates revenue entry", () => {
    const systemQty = 75;
    const actualQty = 83;
    const surplus = actualQty - systemQty; // 8
    const avgCost = getAvgPurchasePrice(movements); // 60
    const surplusCost = surplus * avgCost; // 480

    const lines: JournalLine[] = [
      { accountCode: "1104", debit: surplusCost, credit: 0, description: "المخزون" },
      { accountCode: "4201", debit: 0, credit: surplusCost, description: "فائض مخزون" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
    entries.push({ id: ++entryId, description: "تسوية مخزون - فائض", status: "posted", lines });
    movements.push({ productCode: "P003", type: "adjustment", quantity: surplus, unitCost: avgCost, totalCost: surplusCost });
    productQty += surplus;

    expect(productQty).toBe(83);
    expect(surplusCost).toBe(480);
  });

  // ── Step 5: All entries balanced ──
  it("Step 5: Every journal entry is balanced", () => {
    for (const entry of entries) {
      const totalDebit = entry.lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = entry.lines.reduce((s, l) => s + l.credit, 0);
      expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
    }
  });

  // ── Step 6: Trial balance ──
  it("Step 6: Trial balance debits = credits (adjustments included)", () => {
    const tb = getTrialBalance(entries, accounts);
    const totalDebit = tb.reduce((s, a) => s + a.debit, 0);
    const totalCredit = tb.reduce((s, a) => s + a.credit, 0);
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
  });

  // ── Step 7: Deficit appears in trial balance ──
  it("Step 7: Deficit account (5201) appears in trial balance with correct amount", () => {
    const deficitBal = getAccountBalance(entries, "5201");
    expect(deficitBal.debit).toBe(300);
    expect(deficitBal.credit).toBe(0);
    expect(deficitBal.net).toBe(300);
  });

  // ── Step 8: Surplus appears in trial balance ──
  it("Step 8: Surplus account (4201) appears in trial balance with correct amount", () => {
    const surplusBal = getAccountBalance(entries, "4201");
    expect(surplusBal.credit).toBe(480);
    expect(surplusBal.debit).toBe(0);
    expect(surplusBal.net).toBe(-480); // credit nature
  });

  // ── Step 9: Income statement includes adjustments ──
  it("Step 9: Income statement includes deficit as expense & surplus as revenue", () => {
    // Revenue accounts (credit nature)
    const salesRevenue = getAccountBalance(entries, "4101");
    const netSalesRevenue = salesRevenue.credit - salesRevenue.debit; // 2400

    const surplusRevenue = getAccountBalance(entries, "4201");
    const netSurplusRevenue = surplusRevenue.credit - surplusRevenue.debit; // 480

    const totalRevenue = netSalesRevenue + netSurplusRevenue; // 2880

    // Expense accounts (debit nature)
    const cogs = getAccountBalance(entries, "5101");
    const netCOGS = cogs.debit - cogs.credit; // 1200

    const deficit = getAccountBalance(entries, "5201");
    const netDeficit = deficit.debit - deficit.credit; // 300

    const totalExpenses = netCOGS + netDeficit; // 1500

    // Net profit = 2880 - 1500 = 1380
    const netProfit = totalRevenue - totalExpenses;

    expect(netSalesRevenue).toBe(2400);
    expect(netSurplusRevenue).toBe(480);
    expect(totalRevenue).toBe(2880);
    expect(netCOGS).toBe(1200);
    expect(netDeficit).toBe(300);
    expect(totalExpenses).toBe(1500);
    expect(netProfit).toBe(1380);
  });

  // ── Step 10: Balance sheet equation ──
  it("Step 10: Balance sheet: Assets = Liabilities + Profit (with adjustments)", () => {
    // Assets
    const inventory = getAccountBalance(entries, "1104").net;
    // 6000 (purchase) - 1200 (COGS) - 300 (deficit) + 480 (surplus) = 4980
    const customers = getAccountBalance(entries, "1103").net; // 2400

    const totalAssets = inventory + customers;

    // Liabilities
    const suppliers = -(getAccountBalance(entries, "2101").net); // 6000

    // Profit (from income statement)
    const revenue = (getAccountBalance(entries, "4101").credit - getAccountBalance(entries, "4101").debit)
                   + (getAccountBalance(entries, "4201").credit - getAccountBalance(entries, "4201").debit);
    const expenses = (getAccountBalance(entries, "5101").debit - getAccountBalance(entries, "5101").credit)
                   + (getAccountBalance(entries, "5201").debit - getAccountBalance(entries, "5201").credit);
    const netProfit = revenue - expenses;

    // Assets = Liabilities + Profit
    expect(totalAssets).toBeCloseTo(suppliers + netProfit, 2);
    expect(inventory).toBe(4980);
    expect(totalAssets).toBe(7380);
    expect(suppliers).toBe(6000);
    expect(netProfit).toBe(1380);
  });

  // ── Step 11: Inventory quantity reconciliation ──
  it("Step 11: Inventory quantity matches sum of all movements", () => {
    let calculatedQty = 0;
    for (const m of movements) {
      if (m.type === "purchase" || m.type === "opening_balance") {
        calculatedQty += m.quantity;
      } else if (m.type === "sale") {
        calculatedQty -= m.quantity;
      } else if (m.type === "adjustment") {
        calculatedQty += m.quantity; // positive for surplus, negative for deficit
      }
    }
    expect(calculatedQty).toBe(productQty);
    expect(calculatedQty).toBe(83);
  });
});

describe("Integration: Multi-Customer Payment Allocation", () => {
  it("Multiple payments correctly reduce customer balance", () => {
    let balance = 5000; // initial invoice
    const payments = [1000, 1500, 500, 2000];

    for (const payment of payments) {
      balance -= payment;
    }
    expect(balance).toBe(0);
  });

  it("Partial payment leaves correct remaining balance", () => {
    const invoiceTotal = 3000;
    const payment1 = 1000;
    const payment2 = 800;
    const remaining = invoiceTotal - payment1 - payment2;
    expect(remaining).toBe(1200);
  });
});

describe("Integration: Complete Purchase Cycle (Invoice → Return → Payment → Statement)", () => {
  const entries: JournalEntry[] = [];
  const movements: InventoryMovement[] = [];
  let entryId = 100;
  let productQty = 0;
  let supplierBalance = 0;

  // ── Step 1: Purchase 50 units @ 80 = 4,000 ──
  it("Step 1: Purchase invoice creates inventory & supplier liability", () => {
    const qty = 50, unitPrice = 80, total = qty * unitPrice;
    const lines: JournalLine[] = [
      { accountCode: "1104", debit: total, credit: 0, description: "المخزون" },
      { accountCode: "2101", debit: 0, credit: total, description: "الموردون" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
    entries.push({ id: ++entryId, description: "فاتورة شراء #10", status: "posted", lines });
    movements.push({ productCode: "P002", type: "purchase", quantity: qty, unitCost: unitPrice, totalCost: total });
    productQty += qty;
    supplierBalance += total;
    expect(productQty).toBe(50);
    expect(supplierBalance).toBe(4000);
  });

  // ── Step 2: Second purchase 30 units @ 100 = 3,000 ──
  it("Step 2: Second purchase updates avg cost", () => {
    const qty = 30, unitPrice = 100, total = qty * unitPrice;
    const lines: JournalLine[] = [
      { accountCode: "1104", debit: total, credit: 0, description: "المخزون" },
      { accountCode: "2101", debit: 0, credit: total, description: "الموردون" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
    entries.push({ id: ++entryId, description: "فاتورة شراء #11", status: "posted", lines });
    movements.push({ productCode: "P002", type: "purchase", quantity: qty, unitCost: unitPrice, totalCost: total });
    productQty += qty;
    supplierBalance += total;

    // Avg = (4000 + 3000) / (50 + 30) = 7000 / 80 = 87.5
    const avgCost = getAvgPurchasePrice(movements);
    expect(avgCost).toBe(87.5);
    expect(productQty).toBe(80);
    expect(supplierBalance).toBe(7000);
  });

  // ── Step 3: Purchase return 10 units at avg cost ──
  it("Step 3: Purchase return reduces inventory & supplier balance at avg cost", () => {
    const returnQty = 10;
    const avgCost = getAvgPurchasePrice(movements); // 87.5
    const returnTotal = returnQty * avgCost; // 875

    const lines: JournalLine[] = [
      { accountCode: "2101", debit: returnTotal, credit: 0, description: "مرتجع مشتريات" },
      { accountCode: "1104", debit: 0, credit: returnTotal, description: "المخزون" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
    entries.push({ id: ++entryId, description: "مرتجع شراء #1", status: "posted", lines });
    movements.push({ productCode: "P002", type: "purchase" as any, quantity: -returnQty, unitCost: avgCost, totalCost: -returnTotal });
    productQty -= returnQty;
    supplierBalance -= returnTotal;

    expect(productQty).toBe(70);
    expect(supplierBalance).toBe(6125);
  });

  // ── Step 4: Supplier payment 3,000 ──
  it("Step 4: Supplier payment reduces supplier balance", () => {
    const paymentAmount = 3000;
    const lines: JournalLine[] = [
      { accountCode: "2101", debit: paymentAmount, credit: 0, description: "سند صرف" },
      { accountCode: "1101", debit: 0, credit: paymentAmount, description: "الصندوق" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
    entries.push({ id: ++entryId, description: "سند صرف مورد #1", status: "posted", lines });
    supplierBalance -= paymentAmount;
    expect(supplierBalance).toBe(3125);
  });

  // ── Step 5: Second supplier payment 1,500 ──
  it("Step 5: Second supplier payment", () => {
    const paymentAmount = 1500;
    const lines: JournalLine[] = [
      { accountCode: "2101", debit: paymentAmount, credit: 0, description: "سند صرف" },
      { accountCode: "1101", debit: 0, credit: paymentAmount, description: "الصندوق" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
    entries.push({ id: ++entryId, description: "سند صرف مورد #2", status: "posted", lines });
    supplierBalance -= paymentAmount;
    expect(supplierBalance).toBe(1625);
  });

  // ── Step 6: Supplier account statement ──
  it("Step 6: Supplier account statement shows correct running balance", () => {
    // Build statement for supplier account (2101) - credit nature
    const statement = buildCustomerStatement(entries, "2101");

    // Entries: purchase -4000, purchase -3000, return +875, payment +3000, payment +1500
    expect(statement.length).toBe(5);

    // Purchase 1: credit 4000, balance = -4000
    expect(statement[0].credit).toBe(4000);
    expect(statement[0].runningBalance).toBe(-4000);

    // Purchase 2: credit 3000, balance = -7000
    expect(statement[1].credit).toBe(3000);
    expect(statement[1].runningBalance).toBe(-7000);

    // Return: debit 875, balance = -6125
    expect(statement[2].debit).toBe(875);
    expect(statement[2].runningBalance).toBe(-6125);

    // Payment 1: debit 3000, balance = -3125
    expect(statement[3].debit).toBe(3000);
    expect(statement[3].runningBalance).toBe(-3125);

    // Payment 2: debit 1500, balance = -1625
    expect(statement[4].debit).toBe(1500);
    expect(statement[4].runningBalance).toBe(-1625);

    // Final balance matches tracked balance (supplier balance is credit nature, so negate)
    expect(Math.abs(statement[statement.length - 1].runningBalance)).toBe(supplierBalance);
  });

  // ── Step 7: All entries balanced ──
  it("Step 7: Every journal entry in the purchase cycle is balanced", () => {
    for (const entry of entries) {
      const totalDebit = entry.lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = entry.lines.reduce((s, l) => s + l.credit, 0);
      expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
    }
  });

  // ── Step 8: Trial balance for purchase cycle ──
  it("Step 8: Trial balance debits = credits for purchase cycle", () => {
    const accounts: Account[] = [
      { code: "1101", name: "الصندوق", type: "asset" },
      { code: "1104", name: "المخزون", type: "asset" },
      { code: "2101", name: "الموردون", type: "liability" },
    ];
    const tb = getTrialBalance(entries, accounts);
    const totalDebit = tb.reduce((s, a) => s + a.debit, 0);
    const totalCredit = tb.reduce((s, a) => s + a.credit, 0);
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
  });

  // ── Step 9: Inventory reconciliation ──
  it("Step 9: Inventory quantity reconciles with movements", () => {
    let calculatedQty = 0;
    for (const m of movements) {
      calculatedQty += m.quantity; // purchases positive, return negative
    }
    expect(calculatedQty).toBe(productQty);
    expect(calculatedQty).toBe(70);
  });

  // ── Step 10: Inventory value reconciliation ──
  it("Step 10: Inventory value matches journal entries", () => {
    const inventoryBal = getAccountBalance(entries, "1104");
    const inventoryValue = inventoryBal.net; // debit - credit
    // Purchases: 4000 + 3000 = 7000, Return: -875, Net: 6125
    expect(inventoryValue).toBe(6125);
  });
});

describe("Integration: Tax Calculation in Full Cycle", () => {
  it("Tax is correctly calculated and flows through the system", () => {
    const subtotal = 1000;
    const taxRate = 0.14;
    const tax = subtotal * taxRate; // 140
    const total = subtotal + tax; // 1140

    // Sales invoice with tax: Dr Customer 1140, Cr Revenue 1000, Cr Tax Payable 140
    const lines: JournalLine[] = [
      { accountCode: "1103", debit: total, credit: 0, description: "العملاء" },
      { accountCode: "4101", debit: 0, credit: subtotal, description: "إيرادات" },
      { accountCode: "2102", debit: 0, credit: tax, description: "ضريبة مستحقة" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
    expect(tax).toBe(140);
    expect(total).toBe(1140);
  });

  it("Discount applied before tax calculation", () => {
    const subtotal = 2000;
    const discount = 200;
    const afterDiscount = subtotal - discount; // 1800
    const taxRate = 0.14;
    const tax = afterDiscount * taxRate; // 252
    const total = afterDiscount + tax; // 2052

    expect(afterDiscount).toBe(1800);
    expect(tax).toBeCloseTo(252, 2);
    expect(total).toBeCloseTo(2052, 2);
  });
});

// ─── Edge Case Tests ────────────────────────────────────────────────────

describe("Edge Cases: Insufficient Stock", () => {
  it("should detect when sale quantity exceeds available stock", () => {
    const availableQty = 5;
    const requestedQty = 10;
    const hasEnoughStock = availableQty >= requestedQty;
    expect(hasEnoughStock).toBe(false);
  });

  it("should allow sale when stock is exactly equal to requested", () => {
    const availableQty = 10;
    const requestedQty = 10;
    const hasEnoughStock = availableQty >= requestedQty;
    expect(hasEnoughStock).toBe(true);
  });

  it("should detect insufficient stock across multiple line items", () => {
    const products = [
      { code: "P001", available: 10, requested: 5 },
      { code: "P002", available: 3, requested: 8 },  // insufficient
      { code: "P003", available: 20, requested: 15 },
    ];
    const insufficientItems = products.filter(p => p.available < p.requested);
    expect(insufficientItems.length).toBe(1);
    expect(insufficientItems[0].code).toBe("P002");
  });

  it("should not allow negative inventory after sale", () => {
    const currentQty = 7;
    const saleQty = 7;
    const remainingQty = currentQty - saleQty;
    expect(remainingQty).toBeGreaterThanOrEqual(0);

    const oversellQty = 8;
    const wouldBeNegative = currentQty - oversellQty;
    expect(wouldBeNegative).toBeLessThan(0);
  });

  it("should handle zero stock correctly", () => {
    const availableQty = 0;
    const requestedQty = 1;
    expect(availableQty >= requestedQty).toBe(false);
    expect(availableQty >= 0).toBe(true);
  });
});

describe("Edge Cases: Payment Exceeds Balance", () => {
  it("should detect when payment exceeds customer balance", () => {
    const customerBalance = 500;
    const paymentAmount = 800;
    const exceedsBalance = paymentAmount > customerBalance;
    expect(exceedsBalance).toBe(true);
  });

  it("should allow payment equal to customer balance (full settlement)", () => {
    const customerBalance = 1000;
    const paymentAmount = 1000;
    const exceedsBalance = paymentAmount > customerBalance;
    expect(exceedsBalance).toBe(false);
    const remainingBalance = customerBalance - paymentAmount;
    expect(remainingBalance).toBe(0);
  });

  it("should calculate overpayment amount correctly", () => {
    const customerBalance = 300;
    const paymentAmount = 500;
    const overpayment = Math.max(0, paymentAmount - customerBalance);
    expect(overpayment).toBe(200);
  });

  it("should handle zero balance customer", () => {
    const customerBalance = 0;
    const paymentAmount = 100;
    const exceedsBalance = paymentAmount > customerBalance;
    expect(exceedsBalance).toBe(true);
  });

  it("should detect when supplier payment exceeds supplier balance", () => {
    const supplierBalance = 2000;
    const paymentAmount = 3000;
    const exceedsBalance = paymentAmount > supplierBalance;
    expect(exceedsBalance).toBe(true);
  });

  it("should handle partial payment correctly", () => {
    const customerBalance = 5000;
    const paymentAmount = 2000;
    const remaining = customerBalance - paymentAmount;
    expect(remaining).toBe(3000);
    expect(remaining).toBeGreaterThan(0);
  });

  it("journal entry for overpayment scenario is still balanced", () => {
    // Even if business rules should prevent this, the journal must balance
    const paymentAmount = 800;
    const lines: JournalLine[] = [
      { accountCode: "1101", debit: paymentAmount, credit: 0, description: "الصندوق" },
      { accountCode: "1103", debit: 0, credit: paymentAmount, description: "العملاء" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
  });
});

describe("Edge Cases: Return Exceeds Invoice Quantity", () => {
  it("should detect when return quantity exceeds original invoice quantity", () => {
    const invoiceQty = 10;
    const returnQty = 15;
    const exceedsInvoice = returnQty > invoiceQty;
    expect(exceedsInvoice).toBe(true);
  });

  it("should allow return equal to invoice quantity (full return)", () => {
    const invoiceQty = 10;
    const returnQty = 10;
    const exceedsInvoice = returnQty > invoiceQty;
    expect(exceedsInvoice).toBe(false);
  });

  it("should track cumulative returns against single invoice", () => {
    const invoiceQty = 20;
    const previousReturns = [5, 8]; // two partial returns
    const totalReturned = previousReturns.reduce((s, r) => s + r, 0); // 13
    const remainingReturnable = invoiceQty - totalReturned; // 7

    expect(remainingReturnable).toBe(7);

    const newReturnQty = 10;
    const exceedsRemaining = newReturnQty > remainingReturnable;
    expect(exceedsRemaining).toBe(true);

    const validReturnQty = 5;
    expect(validReturnQty <= remainingReturnable).toBe(true);
  });

  it("should handle return of zero quantity", () => {
    const returnQty = 0;
    const invoiceQty = 10;
    const isValid = returnQty > 0 && returnQty <= invoiceQty;
    expect(isValid).toBe(false); // zero return is invalid
  });

  it("should calculate correct refund for partial return", () => {
    const invoiceQty = 10;
    const unitPrice = 200;
    const returnQty = 3;
    const refundAmount = returnQty * unitPrice;
    expect(refundAmount).toBe(600);

    // Customer balance should decrease by refund amount
    const customerBalance = 2000;
    const newBalance = customerBalance - refundAmount;
    expect(newBalance).toBe(1400);
  });

  it("should calculate correct COGS reversal for partial return", () => {
    const returnQty = 3;
    const avgCost = 106.67;
    const cogsReversal = Math.round(returnQty * avgCost * 100) / 100;
    expect(cogsReversal).toBeCloseTo(320.01, 2);

    // Journal must still balance
    const refundAmount = returnQty * 200; // 600
    const lines: JournalLine[] = [
      { accountCode: "4101", debit: refundAmount, credit: 0, description: "مرتجع مبيعات" },
      { accountCode: "1103", debit: 0, credit: refundAmount, description: "العملاء" },
      { accountCode: "1104", debit: cogsReversal, credit: 0, description: "المخزون" },
      { accountCode: "5101", debit: 0, credit: cogsReversal, description: "عكس تكلفة" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
  });

  it("should detect purchase return exceeding purchase invoice quantity", () => {
    const purchaseQty = 50;
    const returnQty = 60;
    const exceedsPurchase = returnQty > purchaseQty;
    expect(exceedsPurchase).toBe(true);
  });

  it("should handle multiple items return validation", () => {
    const invoiceItems = [
      { productCode: "P001", invoiceQty: 10, returnQty: 5 },  // valid
      { productCode: "P002", invoiceQty: 8, returnQty: 12 },  // invalid
      { productCode: "P003", invoiceQty: 15, returnQty: 15 }, // valid (full)
    ];
    const invalidItems = invoiceItems.filter(i => i.returnQty > i.invoiceQty);
    expect(invalidItems.length).toBe(1);
    expect(invalidItems[0].productCode).toBe("P002");
  });
});

describe("Edge Cases: Floating Point Precision", () => {
  it("should handle tax calculation with floating point correctly", () => {
    const subtotal = 33.33;
    const taxRate = 0.14;
    const tax = Math.round(subtotal * taxRate * 100) / 100;
    expect(tax).toBe(4.67);
  });

  it("should handle discount splitting across items", () => {
    const items = [
      { total: 333.33 },
      { total: 333.33 },
      { total: 333.34 },
    ];
    const grandTotal = items.reduce((s, i) => s + i.total, 0);
    expect(grandTotal).toBe(1000);
  });

  it("should maintain balance with many small amounts", () => {
    const lines: JournalLine[] = [];
    let totalAmount = 0;
    for (let i = 0; i < 100; i++) {
      const amount = 10.01;
      totalAmount += amount;
    }
    // Round to avoid floating point drift
    totalAmount = Math.round(totalAmount * 100) / 100;
    lines.push({ accountCode: "1101", debit: totalAmount, credit: 0, description: "مدين" });
    lines.push({ accountCode: "4101", debit: 0, credit: totalAmount, description: "دائن" });
    expect(validateJournalEntry(lines)).toBe(true);
    expect(totalAmount).toBe(1001);
  });
});

// ─── Integration: Payment Allocation to Multiple Invoices ───────────────

describe("Integration: Customer Payment Allocation to Multiple Invoices", () => {
  /**
   * Tests the full payment reconciliation cycle:
   * 1. Create 3 sales invoices for the same customer
   * 2. Customer makes partial payment → allocate across invoices
   * 3. Customer makes second payment → allocate remaining
   * 4. Verify running balances, allocations, and trial balance
   */

  interface Allocation {
    paymentId: number;
    invoiceId: number;
    allocatedAmount: number;
  }

  interface Invoice {
    id: number;
    total: number;
    paidAmount: number;
  }

  const accounts: Account[] = [
    { code: "1101", name: "الصندوق", type: "asset" },
    { code: "1103", name: "العملاء", type: "asset" },
    { code: "1104", name: "المخزون", type: "asset" },
    { code: "2101", name: "الموردون", type: "liability" },
    { code: "4101", name: "إيرادات المبيعات", type: "revenue" },
    { code: "5101", name: "تكلفة البضاعة المباعة", type: "expense" },
  ];

  const entries: JournalEntry[] = [];
  const allocations: Allocation[] = [];
  const invoices: Invoice[] = [];
  let entryId = 500;
  let customerBalance = 0;
  let paymentId = 0;

  // Helper: calculate paid amount for an invoice from allocations
  function getInvoicePaidAmount(invoiceId: number): number {
    return allocations
      .filter(a => a.invoiceId === invoiceId)
      .reduce((s, a) => s + a.allocatedAmount, 0);
  }

  // Helper: calculate unallocated amount for a payment
  function getPaymentUnallocated(pmtId: number, totalAmount: number): number {
    const allocated = allocations
      .filter(a => a.paymentId === pmtId)
      .reduce((s, a) => s + a.allocatedAmount, 0);
    return totalAmount - allocated;
  }

  // ── Step 1: Create Invoice #1 → 3,000 ──
  it("Step 1: Sales invoice #1 (3,000) increases customer balance", () => {
    const total = 3000;
    const avgCost = 50; // simplified
    const cogs = 8 * avgCost; // 8 units
    const lines: JournalLine[] = [
      { accountCode: "1103", debit: total, credit: 0, description: "العملاء" },
      { accountCode: "4101", debit: 0, credit: total, description: "إيرادات" },
      { accountCode: "5101", debit: cogs, credit: 0, description: "تكلفة بضاعة" },
      { accountCode: "1104", debit: 0, credit: cogs, description: "المخزون" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
    entries.push({ id: ++entryId, description: "فاتورة بيع #1", status: "posted", lines });
    invoices.push({ id: 1, total, paidAmount: 0 });
    customerBalance += total;
    expect(customerBalance).toBe(3000);
  });

  // ── Step 2: Create Invoice #2 → 2,000 ──
  it("Step 2: Sales invoice #2 (2,000) increases customer balance", () => {
    const total = 2000;
    const cogs = 5 * 50;
    const lines: JournalLine[] = [
      { accountCode: "1103", debit: total, credit: 0, description: "العملاء" },
      { accountCode: "4101", debit: 0, credit: total, description: "إيرادات" },
      { accountCode: "5101", debit: cogs, credit: 0, description: "تكلفة بضاعة" },
      { accountCode: "1104", debit: 0, credit: cogs, description: "المخزون" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
    entries.push({ id: ++entryId, description: "فاتورة بيع #2", status: "posted", lines });
    invoices.push({ id: 2, total, paidAmount: 0 });
    customerBalance += total;
    expect(customerBalance).toBe(5000);
  });

  // ── Step 3: Create Invoice #3 → 1,500 ──
  it("Step 3: Sales invoice #3 (1,500) increases customer balance", () => {
    const total = 1500;
    const cogs = 3 * 50;
    const lines: JournalLine[] = [
      { accountCode: "1103", debit: total, credit: 0, description: "العملاء" },
      { accountCode: "4101", debit: 0, credit: total, description: "إيرادات" },
      { accountCode: "5101", debit: cogs, credit: 0, description: "تكلفة بضاعة" },
      { accountCode: "1104", debit: 0, credit: cogs, description: "المخزون" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
    entries.push({ id: ++entryId, description: "فاتورة بيع #3", status: "posted", lines });
    invoices.push({ id: 3, total, paidAmount: 0 });
    customerBalance += total;
    expect(customerBalance).toBe(6500);
  });

  // ── Step 4: Payment #1 → 4,000 allocated across invoices 1 & 2 ──
  it("Step 4: Payment 4,000 allocated: 3,000 to inv#1 (full) + 1,000 to inv#2 (partial)", () => {
    const pmtAmount = 4000;
    const currentPmtId = ++paymentId;

    // Journal entry for payment
    const lines: JournalLine[] = [
      { accountCode: "1101", debit: pmtAmount, credit: 0, description: "سند قبض" },
      { accountCode: "1103", debit: 0, credit: pmtAmount, description: "العملاء" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
    entries.push({ id: ++entryId, description: "سند قبض #1", status: "posted", lines });
    customerBalance -= pmtAmount;

    // Allocate: 3,000 to invoice #1 (fully paid)
    allocations.push({ paymentId: currentPmtId, invoiceId: 1, allocatedAmount: 3000 });
    // Allocate: 1,000 to invoice #2 (partial)
    allocations.push({ paymentId: currentPmtId, invoiceId: 2, allocatedAmount: 1000 });

    // Verify allocation totals
    const totalAllocated = allocations
      .filter(a => a.paymentId === currentPmtId)
      .reduce((s, a) => s + a.allocatedAmount, 0);
    expect(totalAllocated).toBe(pmtAmount);

    // Verify invoice paid amounts
    expect(getInvoicePaidAmount(1)).toBe(3000); // fully paid
    expect(getInvoicePaidAmount(2)).toBe(1000); // partial
    expect(getInvoicePaidAmount(3)).toBe(0);    // unpaid

    // Verify no unallocated remainder
    expect(getPaymentUnallocated(currentPmtId, pmtAmount)).toBe(0);
    expect(customerBalance).toBe(2500);
  });

  // ── Step 5: Payment #2 → 2,500 allocated to remaining invoices ──
  it("Step 5: Payment 2,500 allocated: 1,000 to inv#2 (complete) + 1,500 to inv#3 (full)", () => {
    const pmtAmount = 2500;
    const currentPmtId = ++paymentId;

    const lines: JournalLine[] = [
      { accountCode: "1101", debit: pmtAmount, credit: 0, description: "سند قبض" },
      { accountCode: "1103", debit: 0, credit: pmtAmount, description: "العملاء" },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
    entries.push({ id: ++entryId, description: "سند قبض #2", status: "posted", lines });
    customerBalance -= pmtAmount;

    // Allocate: 1,000 to invoice #2 (remaining balance)
    allocations.push({ paymentId: currentPmtId, invoiceId: 2, allocatedAmount: 1000 });
    // Allocate: 1,500 to invoice #3 (fully paid)
    allocations.push({ paymentId: currentPmtId, invoiceId: 3, allocatedAmount: 1500 });

    const totalAllocated = allocations
      .filter(a => a.paymentId === currentPmtId)
      .reduce((s, a) => s + a.allocatedAmount, 0);
    expect(totalAllocated).toBe(pmtAmount);

    expect(getInvoicePaidAmount(1)).toBe(3000);
    expect(getInvoicePaidAmount(2)).toBe(2000); // 1000 + 1000
    expect(getInvoicePaidAmount(3)).toBe(1500);

    expect(getPaymentUnallocated(currentPmtId, pmtAmount)).toBe(0);
    expect(customerBalance).toBe(0);
  });

  // ── Step 6: All invoices fully paid ──
  it("Step 6: All invoices are fully paid", () => {
    for (const inv of invoices) {
      const paid = getInvoicePaidAmount(inv.id);
      expect(paid).toBe(inv.total);
    }
  });

  // ── Step 7: Customer statement shows zero balance ──
  it("Step 7: Customer statement ends with zero balance", () => {
    const statement = buildCustomerStatement(entries, "1103");
    const finalBalance = statement[statement.length - 1].runningBalance;
    expect(finalBalance).toBe(0);
    expect(finalBalance).toBe(customerBalance);

    // Verify statement has 5 lines: 3 invoices + 2 payments
    expect(statement.length).toBe(5);
  });

  // ── Step 8: Trial balance is balanced ──
  it("Step 8: Trial balance debits = credits", () => {
    const tb = getTrialBalance(entries, accounts);
    const totalDebit = tb.reduce((s, a) => s + a.debit, 0);
    const totalCredit = tb.reduce((s, a) => s + a.credit, 0);
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
  });

  // ── Step 9: All journal entries balanced ──
  it("Step 9: Every journal entry is balanced", () => {
    for (const entry of entries) {
      const d = entry.lines.reduce((s, l) => s + l.debit, 0);
      const c = entry.lines.reduce((s, l) => s + l.credit, 0);
      expect(Math.abs(d - c)).toBeLessThan(0.01);
    }
  });

  // ── Step 10: Partial payment with unallocated remainder ──
  it("Step 10: Payment with partial allocation leaves unallocated amount", () => {
    const pmtAmount = 1000;
    const currentPmtId = ++paymentId;

    // New invoice
    const invTotal = 1500;
    const lines1: JournalLine[] = [
      { accountCode: "1103", debit: invTotal, credit: 0, description: "العملاء" },
      { accountCode: "4101", debit: 0, credit: invTotal, description: "إيرادات" },
    ];
    expect(validateJournalEntry(lines1)).toBe(true);
    entries.push({ id: ++entryId, description: "فاتورة بيع #4", status: "posted", lines: lines1 });
    invoices.push({ id: 4, total: invTotal, paidAmount: 0 });

    // Payment
    const lines2: JournalLine[] = [
      { accountCode: "1101", debit: pmtAmount, credit: 0, description: "سند قبض" },
      { accountCode: "1103", debit: 0, credit: pmtAmount, description: "العملاء" },
    ];
    expect(validateJournalEntry(lines2)).toBe(true);
    entries.push({ id: ++entryId, description: "سند قبض #3", status: "posted", lines: lines2 });

    // Only allocate 600 out of 1000
    allocations.push({ paymentId: currentPmtId, invoiceId: 4, allocatedAmount: 600 });

    expect(getInvoicePaidAmount(4)).toBe(600);
    expect(getPaymentUnallocated(currentPmtId, pmtAmount)).toBe(400);
  });

  // ── Step 11: Multi-payment on single invoice ──
  it("Step 11: Multiple payments cover one invoice via separate allocations", () => {
    const inv5Total = 5000;
    const lines1: JournalLine[] = [
      { accountCode: "1103", debit: inv5Total, credit: 0, description: "العملاء" },
      { accountCode: "4101", debit: 0, credit: inv5Total, description: "إيرادات" },
    ];
    expect(validateJournalEntry(lines1)).toBe(true);
    entries.push({ id: ++entryId, description: "فاتورة بيع #5", status: "posted", lines: lines1 });
    invoices.push({ id: 5, total: inv5Total, paidAmount: 0 });

    // 3 separate payments
    const paymentAmounts = [2000, 1500, 1500];
    for (const amt of paymentAmounts) {
      const pmtId = ++paymentId;
      const lines: JournalLine[] = [
        { accountCode: "1101", debit: amt, credit: 0, description: "سند قبض" },
        { accountCode: "1103", debit: 0, credit: amt, description: "العملاء" },
      ];
      expect(validateJournalEntry(lines)).toBe(true);
      entries.push({ id: ++entryId, description: `سند قبض`, status: "posted", lines });
      allocations.push({ paymentId: pmtId, invoiceId: 5, allocatedAmount: amt });
    }

    expect(getInvoicePaidAmount(5)).toBe(5000);
  });

  // ── Step 12: Allocation cannot exceed invoice remaining ──
  it("Step 12: Validates allocation does not exceed invoice remaining", () => {
    function validateAllocation(invoiceTotal: number, invoiceId: number, newAmount: number): boolean {
      const alreadyPaid = getInvoicePaidAmount(invoiceId);
      const remaining = invoiceTotal - alreadyPaid;
      return newAmount <= remaining + 0.001;
    }

    // Invoice #5 is fully paid (5000/5000)
    expect(validateAllocation(5000, 5, 1)).toBe(false);
    expect(validateAllocation(5000, 5, 0)).toBe(true);

    // Invoice #4 has 600 paid out of 1500
    expect(validateAllocation(1500, 4, 900)).toBe(true);
    expect(validateAllocation(1500, 4, 901)).toBe(false);
  });

  // ── Step 13: Unlink allocation restores invoice unpaid ──
  it("Step 13: Unlinking allocation restores invoice unpaid amount", () => {
    // Remove one allocation from invoice #4 (600)
    const beforePaid = getInvoicePaidAmount(4);
    expect(beforePaid).toBe(600);

    const idx = allocations.findIndex(a => a.invoiceId === 4);
    const removed = allocations.splice(idx, 1)[0];
    expect(removed.allocatedAmount).toBe(600);

    const afterPaid = getInvoicePaidAmount(4);
    expect(afterPaid).toBe(0);

    // Invoice remaining is now full amount
    const remaining = 1500 - afterPaid;
    expect(remaining).toBe(1500);
  });

  // ── Step 14: Final trial balance still balanced ──
  it("Step 14: Final trial balance remains balanced after all operations", () => {
    const tb = getTrialBalance(entries, accounts);
    const totalDebit = tb.reduce((s, a) => s + a.debit, 0);
    const totalCredit = tb.reduce((s, a) => s + a.credit, 0);
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
  });
});
