"use client";

import { usePathname, useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import { Sidebar } from "@heroui-pro/react/sidebar";

type AppShellProps = {
  username: string;
  children: React.ReactNode;
};

export function AppShell({ username, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <Sidebar.Provider
      collapsible="icon"
      variant="floating"
      navigate={(href) => router.push(href)}
    >
      <Sidebar>
        <Sidebar.Header>
          <div className="flex items-center gap-2 px-2 py-1">
            <Icon icon="gravity-ui:chart-line" className="text-accent" width={20} />
            <span className="font-semibold tracking-tight group-data-[collapsed=true]/hidden">
              Stonks
            </span>
          </div>
        </Sidebar.Header>

        <Sidebar.Content>
          <Sidebar.Group>
            <Sidebar.GroupLabel>Portfolio</Sidebar.GroupLabel>
            <Sidebar.Menu aria-label="Main navigation">
              <Sidebar.MenuItem href="/" isCurrent={pathname === "/"} textValue="Dashboard">
                <Sidebar.MenuIcon>
                  <Icon icon="gravity-ui:house" width={18} />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>Dashboard</Sidebar.MenuLabel>
              </Sidebar.MenuItem>
              <Sidebar.MenuItem
                href="/api/ledger/balances"
                isCurrent={pathname.startsWith("/api/ledger")}
                textValue="Balances API"
              >
                <Sidebar.MenuIcon>
                  <Icon icon="gravity-ui:layout-cells-large" width={18} />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>Balances API</Sidebar.MenuLabel>
              </Sidebar.MenuItem>
            </Sidebar.Menu>
          </Sidebar.Group>
        </Sidebar.Content>

        <Sidebar.Footer>
          <div className="flex flex-col gap-2 px-2">
            <p className="truncate text-sm text-muted group-data-[collapsed=true]/hidden">
              {username}
            </p>
            <Button variant="ghost" size="sm" onPress={logout}>
              <Icon icon="gravity-ui:arrow-right-from-square" width={16} />
              <span className="group-data-[collapsed=true]/hidden">Sign Out</span>
            </Button>
          </div>
        </Sidebar.Footer>
        <Sidebar.Rail />
      </Sidebar>

      <Sidebar.Main className="min-h-svh p-6 md:p-8">{children}</Sidebar.Main>
    </Sidebar.Provider>
  );
}
