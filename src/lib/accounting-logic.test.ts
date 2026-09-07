import { describe, it, expect } from "vitest";
import { isBalanced } from "./constants";

/**
 * Accounting logic unit tests
 * Tests the fundamental accounting equations and business rules
 */

// Helper: simulate running balance calculation (same logic as AccountStatement)
function calculateRunningBalance(lines: { debit: number; credit: number }[]) {
  let balance = 0;
  return lines.map((line) => {
    balance += line.debit - line.credit;
    return { ...line, runningBalance: balance };
  });
}

// Helper: simulate journal entry validation (double-entry)
function validateJournalEntry(
  lines: { debit: number; credit: number }[],
): boolean {
  const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
  return Math.abs(totalDebit - totalCredit) < 0.001; // floating point tolerance
}

// Helper: simulate average cost calculation
function calculateAvgPurchasePrice(
  movements: { quantity: number; total_cost: number; movement_type: string }[],
): number {
  const purchaseMoves = movements.filter(
    (m) =>
      m.movement_type === "purchase" || m.movement_type === "opening_balance",
  );
  const totalQty = purchaseMoves.reduce((s, m) => s + m.quantity, 0);
  const totalCost = purchaseMoves.reduce((s, m) => s + m.total_cost, 0);
  return totalQty > 0 ? totalCost / totalQty : 0;
}

describe("Account Statement - Running Balance", () => {
  it("should calculate running balance correctly for customer", () => {
    const lines = [
      { debit: 1000, credit: 0 }, // فاتورة بيع
      { debit: 0, credit: 500 }, // سند قبض
      { debit: 2000, credit: 0 }, // فاتورة بيع
      { debit: 0, credit: 200 }, // مرتجع مبيعات
    ];
    const result = calculateRunningBalance(lines);
    expect(result[0].runningBalance).toBe(1000);
    expect(result[1].runningBalance).toBe(500);
    expect(result[2].runningBalance).toBe(2500);
    expect(result[3].runningBalance).toBe(2300);
  });

  it("should calculate running balance correctly for supplier", () => {
    const lines = [
      { debit: 0, credit: 5000 }, // فاتورة مشتريات
      { debit: 3000, credit: 0 }, // سند صرف
      { debit: 1000, credit: 0 }, // مرتجع مشتريات
    ];
    const result = calculateRunningBalance(lines);
    expect(result[0].runningBalance).toBe(-5000);
    expect(result[1].runningBalance).toBe(-2000);
    expect(result[2].runningBalance).toBe(-1000);
  });

  it("should handle empty lines", () => {
    const result = calculateRunningBalance([]);
    expect(result).toEqual([]);
  });

  it("should handle zero amounts", () => {
    const lines = [{ debit: 0, credit: 0 }];
    const result = calculateRunningBalance(lines);
    expect(result[0].runningBalance).toBe(0);
  });
});

describe("Double-Entry Validation", () => {
  it("should validate balanced journal entry", () => {
    const lines = [
      { debit: 1000, credit: 0 },
      { debit: 0, credit: 1000 },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
  });

  it("should reject unbalanced journal entry", () => {
    const lines = [
      { debit: 1000, credit: 0 },
      { debit: 0, credit: 500 },
    ];
    expect(validateJournalEntry(lines)).toBe(false);
  });

  it("should validate multi-line journal entry", () => {
    // Sales invoice: Dr Customer 1150, Cr Revenue 1000, Cr Tax 150
    const lines = [
      { debit: 1150, credit: 0 },
      { debit: 0, credit: 1000 },
      { debit: 0, credit: 150 },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
  });

  it("should handle floating point precision", () => {
    const lines = [
      { debit: 33.33, credit: 0 },
      { debit: 33.33, credit: 0 },
      { debit: 33.34, credit: 0 },
      { debit: 0, credit: 100 },
    ];
    expect(validateJournalEntry(lines)).toBe(true);
  });
});

describe("Average Purchase Price Calculation", () => {
  it("should calculate simple average", () => {
    const movements = [
      { quantity: 10, total_cost: 1000, movement_type: "purchase" },
      { quantity: 20, total_cost: 2400, movement_type: "purchase" },
    ];
    // (1000 + 2400) / (10 + 20) = 3400 / 30 = 113.33
    expect(calculateAvgPurchasePrice(movements)).toBeCloseTo(113.33, 2);
  });

  it("should include opening balance in average", () => {
    const movements = [
      { quantity: 5, total_cost: 500, movement_type: "opening_balance" },
      { quantity: 10, total_cost: 1200, movement_type: "purchase" },
    ];
    // (500 + 1200) / (5 + 10) = 1700 / 15 = 113.33
    expect(calculateAvgPurchasePrice(movements)).toBeCloseTo(113.33, 2);
  });

  it("should exclude sales from average", () => {
    const movements = [
      { quantity: 10, total_cost: 1000, movement_type: "purchase" },
      { quantity: 5, total_cost: 750, movement_type: "sale" },
    ];
    expect(calculateAvgPurchasePrice(movements)).toBe(100);
  });

  it("should return 0 for no purchases", () => {
    const movements = [{ quantity: 5, total_cost: 750, movement_type: "sale" }];
    expect(calculateAvgPurchasePrice(movements)).toBe(0);
  });

  it("should return 0 for empty movements", () => {
    expect(calculateAvgPurchasePrice([])).toBe(0);
  });
});

describe("Sales Invoice Accounting", () => {
  it("should calculate correct COGS with average price", () => {
    const avgPurchasePrice = 100;
    const quantity = 5;
    const cogs = avgPurchasePrice * quantity;
    expect(cogs).toBe(500);
  });

  it("should calculate correct profit margin", () => {
    const sellingPrice = 150;
    const avgPurchasePrice = 100;
    const quantity = 10;
    const revenue = sellingPrice * quantity;
    const cogs = avgPurchasePrice * quantity;
    const profit = revenue - cogs;
    expect(profit).toBe(500);
    expect(profit / revenue).toBeCloseTo(0.3333, 4);
  });

  it("should handle tax calculation", () => {
    const subtotal = 1000;
    const taxRate = 0.14;
    const tax = subtotal * taxRate;
    const total = subtotal + tax;
    expect(tax).toBe(140);
    expect(total).toBe(1140);
  });

  it("should handle discount before tax", () => {
    const subtotal = 1000;
    const discount = 100;
    const taxRate = 0.14;
    const afterDiscount = subtotal - discount;
    const tax = afterDiscount * taxRate;
    const total = afterDiscount + tax;
    expect(afterDiscount).toBe(900);
    expect(tax).toBeCloseTo(126, 2);
    expect(total).toBeCloseTo(1026, 2);
  });
});

describe("Inventory Adjustment Accounting", () => {
  it("should calculate deficit correctly", () => {
    const systemQty = 100;
    const actualQty = 95;
    const difference = actualQty - systemQty;
    expect(difference).toBe(-5);
  });

  it("should calculate surplus correctly", () => {
    const systemQty = 100;
    const actualQty = 103;
    const difference = actualQty - systemQty;
    expect(difference).toBe(3);
  });

  it("should calculate adjustment cost with average price", () => {
    const avgPrice = 50;
    const difference = -5; // deficit
    const totalCost = Math.abs(difference) * avgPrice;
    expect(totalCost).toBe(250);
  });

  it("should create balanced journal entry for deficit", () => {
    const avgPrice = 50;
    const deficit = 5;
    const totalCost = deficit * avgPrice; // 250
    // Dr: Inventory Loss (expense) 250
    // Cr: Inventory (asset) 250
    const journalLines = [
      { debit: totalCost, credit: 0 }, // expense
      { debit: 0, credit: totalCost }, // inventory
    ];
    expect(validateJournalEntry(journalLines)).toBe(true);
  });

  it("should create balanced journal entry for surplus", () => {
    const avgPrice = 50;
    const surplus = 3;
    const totalCost = surplus * avgPrice; // 150
    // Dr: Inventory (asset) 150
    // Cr: Inventory Gain (revenue) 150
    const journalLines = [
      { debit: totalCost, credit: 0 }, // inventory
      { debit: 0, credit: totalCost }, // revenue
    ];
    expect(validateJournalEntry(journalLines)).toBe(true);
  });
});

describe("Customer/Supplier Balance Updates", () => {
  it("should increase customer balance on sales invoice", () => {
    const currentBalance = 1000;
    const invoiceTotal = 500;
    const newBalance = currentBalance + invoiceTotal;
    expect(newBalance).toBe(1500);
  });

  it("should decrease customer balance on payment", () => {
    const currentBalance = 1500;
    const paymentAmount = 500;
    const newBalance = currentBalance - paymentAmount;
    expect(newBalance).toBe(1000);
  });

  it("should decrease customer balance on sales return", () => {
    const currentBalance = 1500;
    const returnTotal = 300;
    const newBalance = currentBalance - returnTotal;
    expect(newBalance).toBe(1200);
  });

  it("should increase supplier balance on purchase invoice", () => {
    const currentBalance = 0;
    const invoiceTotal = 5000;
    const newBalance = currentBalance + invoiceTotal;
    expect(newBalance).toBe(5000);
  });

  it("should decrease supplier balance on supplier payment", () => {
    const currentBalance = 5000;
    const paymentAmount = 2000;
    const newBalance = currentBalance - paymentAmount;
    expect(newBalance).toBe(3000);
  });

  it("should decrease supplier balance on purchase return", () => {
    const currentBalance = 5000;
    const returnTotal = 1000;
    const newBalance = currentBalance - returnTotal;
    expect(newBalance).toBe(4000);
  });
});

describe("Trial Balance Equation", () => {
  it("total debits should equal total credits", () => {
    const accounts = [
      { code: "1101", name: "الصندوق", debit: 10000, credit: 0 },
      { code: "1104", name: "المخزون", debit: 5000, credit: 0 },
      { code: "1201", name: "العملاء", debit: 3000, credit: 0 },
      { code: "2101", name: "الموردين", debit: 0, credit: 8000 },
      { code: "3101", name: "رأس المال", debit: 0, credit: 5000 },
      { code: "4101", name: "إيرادات المبيعات", debit: 0, credit: 10000 },
      { code: "5101", name: "تكلفة البضاعة", debit: 5000, credit: 0 },
    ];
    const totalDebit = accounts.reduce((s, a) => s + a.debit, 0);
    const totalCredit = accounts.reduce((s, a) => s + a.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });
});

describe("Income Statement Logic", () => {
  it("should calculate net profit correctly", () => {
    const revenue = 50000;
    const cogs = 30000;
    const expenses = 10000;
    const netProfit = revenue - cogs - expenses;
    expect(netProfit).toBe(10000);
  });

  it("should handle net loss", () => {
    const revenue = 20000;
    const cogs = 15000;
    const expenses = 10000;
    const netProfit = revenue - cogs - expenses;
    expect(netProfit).toBe(-5000);
  });
});

describe("Balance Sheet Equation", () => {
  it("Assets = Liabilities + Equity + Net Profit", () => {
    const assets = 100000;
    const liabilities = 40000;
    const equity = 50000;
    const netProfit = 10000;
    expect(assets).toBe(liabilities + equity + netProfit);
  });
});

describe("Purchase Return Full Cycle - Journal Entries & Balances", () => {
  // Scenario: Purchase invoice 5000, fully paid, then return 1000, supplier refunds 1000

  it("should have correct journal entries through full cycle", () => {
    // Step 1: Purchase invoice posted
    // Dr Inventory 5000, Cr Suppliers 5000
    const purchaseJE = [
      { debit: 5000, credit: 0 }, // Inventory
      { debit: 0, credit: 5000 }, // Suppliers
    ];
    expect(validateJournalEntry(purchaseJE)).toBe(true);

    // Step 2: Supplier payment (we pay them 5000)
    // Dr Suppliers 5000, Cr Cash 5000
    const paymentJE = [
      { debit: 5000, credit: 0 }, // Suppliers
      { debit: 0, credit: 5000 }, // Cash
    ];
    expect(validateJournalEntry(paymentJE)).toBe(true);

    // Step 3: Purchase return posted (return 1000)
    // Dr Suppliers 1000, Cr Inventory 1000
    const returnJE = [
      { debit: 1000, credit: 0 }, // Suppliers (reduces liability)
      { debit: 0, credit: 1000 }, // Inventory (reduces inventory)
    ];
    expect(validateJournalEntry(returnJE)).toBe(true);

    // Step 4: Supplier refund (they pay us back 1000)
    // Dr Cash 1000, Cr Suppliers 1000
    const refundJE = [
      { debit: 1000, credit: 0 }, // Cash (we receive)
      { debit: 0, credit: 1000 }, // Suppliers (settles debit balance)
    ];
    expect(validateJournalEntry(refundJE)).toBe(true);
  });

  it("should have correct supplier balance through cycle", () => {
    let supplierBalance = 0;

    // Purchase invoice: we owe them more
    supplierBalance += 5000;
    expect(supplierBalance).toBe(5000);

    // Payment: we pay them
    supplierBalance -= 5000;
    expect(supplierBalance).toBe(0);

    // Purchase return: they owe us (negative means they owe us)
    supplierBalance -= 1000;
    expect(supplierBalance).toBe(-1000);

    // Refund: they pay us back, settling the balance
    supplierBalance += 1000;
    expect(supplierBalance).toBe(0);
  });

  it("should have correct supplier account ledger", () => {
    // Supplier account (credit = liability increases, debit = liability decreases)
    const supplierLedger = [
      { debit: 0, credit: 5000 }, // Purchase invoice (we owe them)
      { debit: 5000, credit: 0 }, // Payment (we paid)
      { debit: 1000, credit: 0 }, // Purchase return (reduces what we owe)
      { debit: 0, credit: 1000 }, // Refund (settles return credit)
    ];
    const totalDebit = supplierLedger.reduce((s, l) => s + l.debit, 0);
    const totalCredit = supplierLedger.reduce((s, l) => s + l.credit, 0);
    // Net should be zero - all settled
    expect(totalDebit).toBe(totalCredit); // 6000 = 6000
  });

  it("should have correct cash account through cycle", () => {
    // Cash movements
    let cashBalance = 10000; // Starting cash

    cashBalance -= 5000; // Paid supplier
    expect(cashBalance).toBe(5000);

    cashBalance += 1000; // Received refund from supplier
    expect(cashBalance).toBe(6000);

    // Net cash impact: -4000 (paid 5000, got 1000 back)
    expect(10000 - cashBalance).toBe(4000);
  });
});

describe("Sales Return Full Cycle - Journal Entries & Balances", () => {
  // Scenario: Sales invoice 5000, customer paid, then return 1000, we refund customer 1000

  it("should have correct journal entries through full cycle", () => {
    // Step 1: Sales invoice posted (with COGS)
    // Dr Customers 5000, Cr Revenue 5000
    // Dr COGS 3000, Cr Inventory 3000
    const salesJE = [
      { debit: 5000, credit: 0 }, // Customers
      { debit: 0, credit: 5000 }, // Revenue
      { debit: 3000, credit: 0 }, // COGS
      { debit: 0, credit: 3000 }, // Inventory
    ];
    expect(validateJournalEntry(salesJE)).toBe(true);

    // Step 2: Customer payment (they pay us 5000)
    // Dr Cash 5000, Cr Customers 5000
    const paymentJE = [
      { debit: 5000, credit: 0 }, // Cash
      { debit: 0, credit: 5000 }, // Customers
    ];
    expect(validateJournalEntry(paymentJE)).toBe(true);

    // Step 3: Sales return posted (return 1000 worth, cost 600)
    // Dr Revenue 1000, Cr Customers 1000
    // Dr Inventory 600, Cr COGS 600
    const returnJE = [
      { debit: 1000, credit: 0 }, // Revenue (reduces revenue)
      { debit: 0, credit: 1000 }, // Customers (reduces what they owe / we owe them)
      { debit: 600, credit: 0 }, // Inventory (returns to stock)
      { debit: 0, credit: 600 }, // COGS (reverses cost)
    ];
    expect(validateJournalEntry(returnJE)).toBe(true);

    // Step 4: Refund to customer (we pay them back 1000)
    // Dr Customers 1000, Cr Cash 1000
    const refundJE = [
      { debit: 1000, credit: 0 }, // Customers (settles credit balance)
      { debit: 0, credit: 1000 }, // Cash (we pay out)
    ];
    expect(validateJournalEntry(refundJE)).toBe(true);
  });

  it("should have correct customer balance through cycle", () => {
    let customerBalance = 0;

    // Sales invoice: customer owes us
    customerBalance += 5000;
    expect(customerBalance).toBe(5000);

    // Customer payment
    customerBalance -= 5000;
    expect(customerBalance).toBe(0);

    // Sales return: we owe customer (negative = we owe them)
    customerBalance -= 1000;
    expect(customerBalance).toBe(-1000);

    // Refund: we pay customer back
    customerBalance += 1000;
    expect(customerBalance).toBe(0);
  });

  it("should have correct customer account ledger", () => {
    const customerLedger = [
      { debit: 5000, credit: 0 }, // Sales invoice (they owe us)
      { debit: 0, credit: 5000 }, // Payment (they paid)
      { debit: 0, credit: 1000 }, // Sales return (reduces what they owe / we owe them)
      { debit: 1000, credit: 0 }, // Refund (settles return credit)
    ];
    const totalDebit = customerLedger.reduce((s, l) => s + l.debit, 0);
    const totalCredit = customerLedger.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit); // 6000 = 6000
  });

  it("should have correct net profit after return", () => {
    const revenue = 5000 - 1000; // Revenue minus return
    const cogs = 3000 - 600; // COGS minus reversed cost
    const netProfit = revenue - cogs;
    expect(netProfit).toBe(1600); // 4000 - 2400
  });
});

describe("isBalanced (from constants) - edge cases", () => {
  it("isBalanced(0, 0) → true", () => {
    expect(isBalanced(0, 0)).toBe(true);
  });

  it("isBalanced(1000.005, 1000) → true (within 0.01 tolerance)", () => {
    expect(isBalanced(1000.005, 1000)).toBe(true);
  });

  it("isBalanced(1000.02, 1000) → false (exceeds 0.01 tolerance)", () => {
    expect(isBalanced(1000.02, 1000)).toBe(false);
  });

  it("isBalanced(-100, -100) → true", () => {
    expect(isBalanced(-100, -100)).toBe(true);
  });
});

// --- المرحلة 2: سيناريوهات محاسبية متقدمة ---
describe("Advanced Accounting Scenarios", () => {
  it("فاتورة 1000 + خصم 10% + ضريبة 15% → الضريبة على 900 = 135", () => {
    const subtotal = 1000;
    const discount = 0.1 * subtotal;
    const afterDiscount = subtotal - discount;
    const taxRate = 0.15;
    const tax = afterDiscount * taxRate;
    expect(afterDiscount).toBe(900);
    expect(tax).toBe(135);
    const total = afterDiscount + tax;
    expect(total).toBe(1035);
  });

  it("مرتجع مع ضريبة → الضريبة تُعكس", () => {
    const originalTax = 150;
    const returnAmount = 500;
    const taxRate = 0.15;
    const returnTax = returnAmount * taxRate;
    expect(returnTax).toBe(75);
    // عند المرتجع، الضريبة تُخصم من الضريبة المستحقة
    const netTax = originalTax - returnTax;
    expect(netTax).toBe(75);
  });

  it("فاتورة بضريبة + مرتجع جزئي → الضريبة تتناسب", () => {
    const invoiceTotal = 2000;
    const taxRate = 0.15;
    const tax = invoiceTotal * taxRate; // 300
    const returnAmount = 800;
    const proportionalTax = returnAmount * taxRate; // 120
    expect(tax).toBe(300);
    expect(proportionalTax).toBe(120);
    // الضريبة المستحقة بعد المرتجع
    const netTax = tax - proportionalTax;
    expect(netTax).toBe(180);
  });

  it("تسوية مرتجع كامل مقابل فاتورة", () => {
    let invoiceBalance = 1000;
    const returnAmount = 1000;
    // التسوية: تخصم المرتجع من الفاتورة بالكامل
    invoiceBalance -= returnAmount;
    expect(invoiceBalance).toBe(0);
  });

  it("تسوية جزئية (100 من مرتجع 500)", () => {
    let invoiceBalance = 400;
    let returnAmount = 500;
    const settlement = 100;
    // تخصم فقط جزء من المرتجع
    invoiceBalance -= settlement;
    returnAmount -= settlement;
    expect(invoiceBalance).toBe(300);
    expect(returnAmount).toBe(400);
  });

  it("تسويات متعددة لنفس الفاتورة", () => {
    let invoiceBalance = 600;
    const returnAmounts = [200, 150, 250];
    let totalSettled = 0;
    for (const amt of returnAmounts) {
      const settle = Math.min(invoiceBalance, amt);
      invoiceBalance -= settle;
      totalSettled += settle;
    }
    expect(invoiceBalance).toBe(0);
    expect(totalSettled).toBe(600);
  });

  it("المدفوع = allocations + settlements", () => {
    const allocations = 700;
    const settlements = 300;
    const paid = allocations + settlements;
    expect(paid).toBe(1000);
  });

  it("دفعة أكبر من المتبقي → رفض", () => {
    const remaining = 500;
    const payment = 600;
    const isValid = payment <= remaining;
    expect(isValid).toBe(false);
  });

  it("تخصيص 0 أو سالب → رفض", () => {
    const allocations = [100, 0, -50];
    const allValid = allocations.every((a) => a > 0);
    expect(allValid).toBe(false);
  });

  it("فك تخصيص → المتاح يزيد", () => {
    let available = 200;
    let allocated = 150;
    // فك التخصيص
    available += allocated;
    allocated = 0;
    expect(available).toBe(350);
    expect(allocated).toBe(0);
  });
});
