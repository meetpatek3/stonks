"use client";

import { usePathname, useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import { Sidebar, useSidebar } from "@heroui-pro/react/sidebar";
import { NAV_ITEMS, isRouteActive } from "@/lib/nav";

type AppShellProps = {
  username: string;
  /**
   * Number of open items, derived on the server. `0` renders no badge: an
   * empty ledger and a clean ledger both mean "nothing to show here", and a
   * zero badge would draw the eye to neither.
   */
  openItemCount?: number;
  children: React.ReactNode;
};

/**
 * The shell every authenticated screen renders inside.
 *
 * The Pro sidebar hides its desktop `<aside>` below 768px (see the shipped
 * `sidebar.css`), so mobile navigation lives in `Sidebar.Mobile` — the same
 * sections rendered into a sheet — opened from the header trigger. Both
 * copies share one element tree so the two can never drift apart.
 */
export function AppShell({ username, openItemCount = 0, children }: AppShellProps) {
  const router = useRouter();

  return (
    <Sidebar.Provider
      collapsible="icon"
      variant="floating"
      navigate={(href) => router.push(href)}
    >
      <ShellBody username={username} openItemCount={openItemCount}>
        {children}
      </ShellBody>
    </Sidebar.Provider>
  );
}

function ShellBody({
  username,
  openItemCount,
  children,
}: {
  username: string;
  openItemCount: number;
  children: React.ReactNode;
}) {
  const { isMobile } = useSidebar();
  const sections = <ShellSections username={username} openItemCount={openItemCount} />;

  return (
    <>
      <Sidebar>
        {sections}
        <Sidebar.Rail />
      </Sidebar>

      <Sidebar.Mobile>{sections}</Sidebar.Mobile>

      <Sidebar.Main>
        {isMobile ? (
          <header className="flex items-center gap-3 border-b border-separator px-4 py-3">
            <Sidebar.Trigger aria-label="Open navigation">
              <Icon icon="gravity-ui:bars" width={18} />
            </Sidebar.Trigger>
            <span className="font-semibold tracking-tight text-foreground">Stonks</span>
          </header>
        ) : null}
        <div className="min-w-0 flex-1 p-4 md:p-8">{children}</div>
      </Sidebar.Main>
    </>
  );
}

function ShellSections({
  username,
  openItemCount,
}: {
  username: string;
  openItemCount: number;
}) {
  const pathname = usePathname();
  const { isMobile, isOpen } = useSidebar();
  // The desktop sidebar collapses to icons; the mobile sheet never does.
  const showLabels = isMobile || isOpen;

  return (
    <>
      <Sidebar.Header>
        <div className="flex items-center gap-2">
          <Icon icon="gravity-ui:chart-line" className="text-accent" width={20} />
          <span className="font-semibold tracking-tight" data-sidebar="label">
            Stonks
          </span>
        </div>
      </Sidebar.Header>

      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.GroupLabel>Portfolio</Sidebar.GroupLabel>
          <Sidebar.Menu aria-label="Main navigation">
            {NAV_ITEMS.map((item) => (
              <Sidebar.MenuItem
                key={item.href}
                id={item.href}
                href={item.href}
                isCurrent={isRouteActive(pathname, item.href)}
                textValue={item.label}
              >
                <Sidebar.MenuIcon>
                  <Icon icon={item.icon} width={18} />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>{item.label}</Sidebar.MenuLabel>
                {item.href === "/open-items" && openItemCount > 0 ? (
                  <Sidebar.MenuChip aria-label={`${openItemCount} open items`}>
                    {openItemCount}
                  </Sidebar.MenuChip>
                ) : null}
              </Sidebar.MenuItem>
            ))}
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>

      <Sidebar.Footer>
        <ShellFooter username={username} showLabels={showLabels} />
      </Sidebar.Footer>
    </>
  );
}

function ShellFooter({
  username,
  showLabels,
}: {
  username: string;
  showLabels: boolean;
}) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {showLabels ? (
        <p className="truncate px-2 text-sm text-muted">{username}</p>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        isIconOnly={!showLabels}
        aria-label="Sign out"
        onPress={logout}
      >
        <Icon icon="gravity-ui:arrow-right-from-square" width={16} />
        {showLabels ? <span>Sign Out</span> : null}
      </Button>
    </div>
  );
}
