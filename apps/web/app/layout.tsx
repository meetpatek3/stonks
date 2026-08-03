import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stonks",
  description: "Self-hosted investment portfolio tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" data-theme="dark">
      <body className="min-h-svh antialiased">{children}</body>
    </html>
  );
}
