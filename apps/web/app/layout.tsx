import type { Metadata } from "next";
import { Figtree, Fraunces, IBM_Plex_Mono } from "next/font/google";
import { AppShell } from "../components/AppShell";
import "./globals.css";

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: "stonks — portfolio tracker",
  description: "Self-hosted double-entry investment portfolio tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" data-theme="dark">
      <body
        className={`${figtree.variable} ${fraunces.variable} ${plexMono.variable} bg-background text-foreground antialiased`}
        style={
          {
            "--font-sans": "var(--font-figtree), Figtree, sans-serif",
            "--font-display": "var(--font-fraunces), Fraunces, serif",
            "--font-mono": "var(--font-plex), IBM Plex Mono, monospace",
          } as React.CSSProperties
        }
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
