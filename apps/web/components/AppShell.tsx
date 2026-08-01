"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Overview" },
  { href: "/entry", label: "Entry" },
  { href: "/ledger", label: "Ledger" },
  { href: "/positions", label: "Positions" },
  { href: "/open-items", label: "Open items" },
  { href: "/tax", label: "Tax" },
  { href: "/charts", label: "Charts" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="relative min-h-screen">
      <header className="border-b border-[var(--color-line)]/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-6 py-5">
          <div>
            <p className="font-display text-3xl tracking-tight text-white md:text-4xl">stonks</p>
            <p className="mt-1 text-sm text-[var(--color-fog)]/80">
              Double-entry portfolio tracker
            </p>
          </div>
          <nav className="flex flex-wrap gap-1">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-[var(--color-mint)]/15 text-[var(--color-mint)]"
                      : "text-[var(--color-fog)] hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="h-px w-full bg-gradient-to-r from-transparent via-[var(--color-mint)]/50 to-transparent animate-pulse-line" />
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
