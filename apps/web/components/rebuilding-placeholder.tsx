import { EmptyState } from "@heroui-pro/react/empty-state";

/**
 * Temporary stand-in for a screen whose demo data source was removed. Each of
 * these screens is rebuilt on the real read model in a later task; nothing
 * here renders a number, because there is no derived number to render yet.
 */
export function RebuildingPlaceholder({ screen }: { screen: string }) {
  return (
    <EmptyState>
      <EmptyState.Header>
        <EmptyState.Title>{screen}</EmptyState.Title>
        <EmptyState.Description>
          This screen is being rebuilt on the ledger read model. It will return once its
          figures are derived from your posted journals.
        </EmptyState.Description>
      </EmptyState.Header>
    </EmptyState>
  );
}
