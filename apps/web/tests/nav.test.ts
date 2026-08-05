import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isRouteActive } from "@/lib/nav";

describe("NAV_ITEMS", () => {
  it("lists the ten screens in order", () => {
    expect(NAV_ITEMS.map((item) => [item.label, item.href])).toEqual([
      ["Overview", "/"],
      ["Accounts", "/accounts"],
      ["Positions", "/positions"],
      ["Transactions", "/ledger"],
      ["Borrowing", "/borrowing"],
      ["Charts", "/charts"],
      ["Tax", "/tax"],
      ["Open Items", "/open-items"],
      ["New Entry", "/entry"],
      ["Settings", "/settings"],
    ]);
  });

  it("never points at an API route", () => {
    for (const item of NAV_ITEMS) {
      expect(item.href.startsWith("/api")).toBe(false);
    }
  });

  it("has a unique href per entry", () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("isRouteActive", () => {
  it("matches a route against itself", () => {
    expect(isRouteActive("/positions", "/positions")).toBe(true);
  });

  it("matches a nested route against its section", () => {
    expect(isRouteActive("/positions/xyz", "/positions")).toBe(true);
    expect(isRouteActive("/positions/xyz/lots", "/positions")).toBe(true);
  });

  it("does not match a different section", () => {
    expect(isRouteActive("/positions", "/ledger")).toBe(false);
  });

  it("does not match a route that merely shares a prefix string", () => {
    expect(isRouteActive("/open-items-archive", "/open-items")).toBe(false);
    expect(isRouteActive("/entry-templates", "/entry")).toBe(false);
  });

  it("matches the root only exactly", () => {
    expect(isRouteActive("/", "/")).toBe(true);
    expect(isRouteActive("/positions", "/")).toBe(false);
    expect(isRouteActive("/ledger/2024", "/")).toBe(false);
  });

  it("ignores a trailing slash on either side", () => {
    expect(isRouteActive("/positions/", "/positions")).toBe(true);
    expect(isRouteActive("/positions", "/positions/")).toBe(true);
    expect(isRouteActive("//", "/")).toBe(true);
  });

  it("ignores a query string or hash on the current path", () => {
    expect(isRouteActive("/ledger?page=2", "/ledger")).toBe(true);
    expect(isRouteActive("/ledger#row-7", "/ledger")).toBe(true);
    expect(isRouteActive("/?tab=all", "/")).toBe(true);
  });

  it("treats an empty pathname as the root", () => {
    expect(isRouteActive("", "/")).toBe(true);
    expect(isRouteActive("", "/positions")).toBe(false);
  });

  it("highlights exactly one entry for any given path", () => {
    for (const path of ["/", "/accounts", "/positions/abc", "/ledger", "/entry", "/settings"]) {
      const active = NAV_ITEMS.filter((item) => isRouteActive(path, item.href));
      expect(active).toHaveLength(1);
    }
  });
});
