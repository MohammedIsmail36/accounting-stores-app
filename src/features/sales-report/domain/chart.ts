import type {
  CategorySalesGroup,
  CustomerSalesGroup,
  ProductSalesGroup,
  SalesTimeMode,
  TimeSalesGroup,
} from "./grouping";

type ChartGroup = "invoice" | "return" | "customer" | "product" | "time" | "category";

export interface SalesReportChartDatum {
  name: string;
  "صافي المبيعات": number;
}

export interface SalesReportChart {
  meta: { title: string; description: string } | null;
  data: SalesReportChartDatum[];
}

interface SalesReportChartInput {
  groupBy: ChartGroup;
  timeMode: SalesTimeMode;
  timeData: TimeSalesGroup[];
  customerData: CustomerSalesGroup[];
  productData: ProductSalesGroup[];
  categoryData: CategorySalesGroup[];
}

const shortenChartName = (name: string) =>
  name.length > 18 ? `${name.substring(0, 18)}…` : name;

export function buildSalesReportChart({
  groupBy,
  timeMode,
  timeData,
  customerData,
  productData,
  categoryData,
}: SalesReportChartInput): SalesReportChart {
  if (groupBy === "time") {
    return {
      meta: {
        title: `اتجاه صافي المبيعات ${timeMode === "daily" ? "اليومي" : "الشهري"}`,
        description:
          "صافي المبيعات قبل الضريبة بعد طرح المرتجعات المستقلة في كل فترة.",
      },
      data: timeData.map((period) => ({
        name: period.label,
        "صافي المبيعات": period.net,
      })),
    };
  }

  if (groupBy === "customer") {
    return {
      meta: {
        title: "أعلى 10 عملاء بصافي المبيعات",
        description:
          "ترتيب العملاء حسب المبيعات قبل الضريبة بعد طرح مرتجعات كل عميل.",
      },
      data: customerData.slice(0, 10).map((customer) => ({
        name: shortenChartName(customer.name),
        "صافي المبيعات": customer.total - customer.returns,
      })),
    };
  }

  if (groupBy === "product") {
    return {
      meta: {
        title: "أعلى 10 منتجات بصافي المبيعات",
        description:
          "ترتيب المنتجات حسب إيراد البيع الصافي بعد طرح مرتجعات المنتج.",
      },
      data: productData.slice(0, 10).map((product) => ({
        name: shortenChartName(product.name),
        "صافي المبيعات": product.revenue,
      })),
    };
  }

  if (groupBy === "category") {
    return {
      meta: {
        title: "أعلى 10 تصنيفات بصافي المبيعات",
        description:
          "ترتيب التصنيفات حسب إيراد البيع الصافي بعد طرح المرتجعات.",
      },
      data: categoryData.slice(0, 10).map((category) => ({
        name: shortenChartName(category.name),
        "صافي المبيعات": category.net,
      })),
    };
  }

  return { meta: null, data: [] };
}
