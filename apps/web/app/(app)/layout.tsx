import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const username = session?.username ?? "user";

  return <AppShell username={username}>{children}</AppShell>;
}
