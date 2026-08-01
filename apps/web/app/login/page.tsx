import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Suspense fallback={<div className="text-muted text-sm">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
