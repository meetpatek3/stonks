/**
 * Pure helpers for the open-items dashboard.
 *
 * Findings themselves come from the read model (`openItems` /
 * `openItemCounts`). These helpers only arrange them for display — severity
 * order, a chip tone, a stable row id, and the screen a finding traces to.
 * The total shown on this page is always `openItemCounts.total` from the same
 * snapshot the sidebar badge reads; nothing here counts a second time.
 */

import type {
  OpenItem,
  OpenItemRefType,
  OpenItemSeverity,
} from "@/lib/portfolio-shared";

/** One severity bucket, ready to render as its own section. */
export type OpenItemSeverityGroup = {
  severity: OpenItemSeverity;
  items: OpenItem[];
};

const SEVERITY_ORDER: readonly OpenItemSeverity[] = [
  "ERROR",
  "WARNING",
  "INFO",
];

/**
 * Group findings by severity, ERROR → WARNING → INFO, omitting empty buckets.
 * Relative order within a severity is preserved.
 */
export function groupOpenItemsBySeverity(
  items: readonly OpenItem[],
): OpenItemSeverityGroup[] {
  const bySeverity = new Map<OpenItemSeverity, OpenItem[]>();
  for (const severity of SEVERITY_ORDER) {
    bySeverity.set(severity, []);
  }
  for (const item of items) {
    bySeverity.get(item.severity)?.push(item);
  }

  const groups: OpenItemSeverityGroup[] = [];
  for (const severity of SEVERITY_ORDER) {
    const bucket = bySeverity.get(severity) ?? [];
    if (bucket.length === 0) continue;
    groups.push({ severity, items: bucket });
  }
  return groups;
}

/**
 * Where a finding's reference points in the app.
 *
 * Deep-linking into a single position or journal is not available yet (the
 * positions and ledger screens have no id-scoped route), so the href lands on
 * the screen that owns that kind of record. The `refId` itself is shown beside
 * the link so the finding stays auditable.
 */
export function openItemRefHref(
  refType: OpenItemRefType,
  _refId: string,
): string {
  switch (refType) {
    case "POSITION":
      return "/positions";
    case "ACCOUNT":
      return "/accounts";
    case "JOURNAL":
      return "/ledger";
  }
}

/** HeroUI chip colour for a severity. */
export function openItemSeverityTone(
  severity: OpenItemSeverity,
): "danger" | "warning" | "accent" {
  switch (severity) {
    case "ERROR":
      return "danger";
    case "WARNING":
      return "warning";
    case "INFO":
      return "accent";
  }
}

/** Stable DataGrid row id — kind + ref uniquely identifies a finding today. */
export function openItemRowId(item: OpenItem): string {
  return `${item.kind}:${item.refType}:${item.refId}`;
}
