import {
  DEFAULT_SALES_REPORT_PREFERENCES,
  parseSalesReportPreferences,
} from "./use-sales-report-preferences";

describe("parseSalesReportPreferences", () => {
  it("returns defaults for missing or malformed storage", () => {
    expect(parseSalesReportPreferences(null)).toEqual(
      DEFAULT_SALES_REPORT_PREFERENCES,
    );
    expect(parseSalesReportPreferences("not-json")).toEqual(
      DEFAULT_SALES_REPORT_PREFERENCES,
    );
  });

  it("restores valid preferences", () => {
    expect(
      parseSalesReportPreferences(
        JSON.stringify({
          statusFilter: "draft",
          groupBy: "customer",
          timeMode: "monthly",
          comparisonMode: "previous_year",
        }),
      ),
    ).toEqual({
      statusFilter: "draft",
      groupBy: "customer",
      timeMode: "monthly",
      comparisonMode: "previous_year",
    });
  });

  it("replaces invalid individual values with safe defaults", () => {
    expect(
      parseSalesReportPreferences(
        JSON.stringify({
          statusFilter: "unknown",
          groupBy: "product",
          timeMode: "weekly",
          comparisonMode: "unknown",
        }),
      ),
    ).toEqual({
      statusFilter: "posted",
      groupBy: "product",
      timeMode: "daily",
      comparisonMode: "previous_period",
    });
  });
});
