import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Stonks",
  description: "Self-hosted investment portfolio tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`glass-dark ${inter.variable}`} data-theme="glass-dark">
      <body className="min-h-svh antialiased">{children}</body>
    </html>
  );
}
