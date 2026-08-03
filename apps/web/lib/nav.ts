/**
 * The application's navigation model.
 *
 * Every entry points at a real page route. A nav item must never point at an
 * API route: `/api/*` returns JSON, not a page, and a user who follows such a
 * link lands outside the app shell entirely.
 *
 * Pure data plus one pure function, so the route-matching rules can be unit
 * tested without rendering anything.
 */

export type NavItem = {
  /** Page route. Always an app route, never `/api/*`. */
  href: string;
  label: string;
  /** Iconify icon name, resolved by `@iconify/react` at render time. */
  icon: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Overview", icon: "gravity-ui:house" },
  { href: "/accounts", label: "Accounts", icon: "gravity-ui:wallet" },
  { href: "/positions", label: "Positions", icon: "gravity-ui:briefcase" },
  { href: "/ledger", label: "Transactions", icon: "gravity-ui:list-ul" },
  { href: "/borrowing", label: "Borrowing", icon: "gravity-ui:credit-card" },
  { href: "/charts", label: "Charts", icon: "gravity-ui:chart-column" },
  { href: "/tax", label: "Tax", icon: "gravity-ui:receipt" },
  { href: "/open-items", label: "Open Items", icon: "gravity-ui:circle-exclamation" },
  { href: "/entry", label: "New Entry", icon: "gravity-ui:square-plus" },
  { href: "/settings", label: "Settings", icon: "gravity-ui:gear" },
];

/** Drop a trailing slash and any query/hash, so `/positions/` === `/positions`. */
function normalizePath(path: string): string {
  const withoutSuffix = path.split(/[?#]/, 1)[0] ?? "";
  const withLeadingSlash = withoutSuffix.startsWith("/")
    ? withoutSuffix
    : `/${withoutSuffix}`;
  const trimmed = withLeadingSlash.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * Whether `href` is the nav entry for the page at `pathname`.
 *
 * A nested route highlights its section (`/positions/abc` → Positions), but
 * the root is matched exactly: `/` is a prefix of every path, so treating it
 * as one would highlight Overview on every screen.
 */
export function isRouteActive(pathname: string, href: string): boolean {
  const current = normalizePath(pathname);
  const target = normalizePath(href);

  if (target === "/") {
    return current === "/";
  }

  return current === target || current.startsWith(`${target}/`);
}
