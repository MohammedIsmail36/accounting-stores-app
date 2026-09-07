import { describe, expect, it } from "vitest";
import { getSafeInternalPath } from "./safe-internal-path";

describe("getSafeInternalPath", () => {
  it.each([
    ["/", "/"],
    ["/reports/sales", "/reports/sales"],
    ["/products?page=2#stock", "/products?page=2#stock"],
    ["/reports/../sales", "/sales"],
  ])("accepts and normalizes an internal route: %s", (input, expected) => {
    expect(getSafeInternalPath(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "reports/sales",
    "https://evil.example/path",
    "javascript:alert(1)",
    "//evil.example/path",
    "///evil.example/path",
    "/\\evil.example/path",
    "/%5Cevil.example/path",
    "/%255Cevil.example/path",
    "/%25255Cevil.example/path",
    "/%2F%2Fevil.example/path",
    "/%252F%252Fevil.example/path",
    "/%25252F%25252Fevil.example/path",
    "/reports/%",
    "/reports\n/sales",
    "/reports/%25250Aevil",
  ])("rejects an unsafe redirect: %s", (input) => {
    expect(getSafeInternalPath(input)).toBe("/");
  });

  it("uses the supplied fallback for unsafe input", () => {
    expect(getSafeInternalPath("/\\evil.example", "/sales")).toBe("/sales");
  });
});
