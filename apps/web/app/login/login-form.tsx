"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, FieldError, Input, Label, TextField } from "@heroui/react";
import { Icon } from "@iconify/react";
import { safeRedirectPath } from "@/lib/safe-redirect";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Login failed");
        return;
      }

      const next = safeRedirectPath(searchParams.get("next"));
      router.replace(next);
      router.refresh();
    } catch {
      setError("Unable to reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <Card.Header className="flex flex-col items-start gap-2 p-6 pb-2">
        <div className="flex items-center gap-2 text-accent">
          <Icon icon="gravity-ui:chart-line" width={22} />
          <span className="text-sm font-medium">Stonks</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign In</h1>
        <p className="text-sm text-muted">
          Enter your household username and password to open the portfolio ledger.
        </p>
      </Card.Header>
      <Card.Content className="p-6 pt-4">
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <TextField
            isRequired
            name="username"
            value={username}
            onChange={setUsername}
            autoComplete="username"
          >
            <Label>Username</Label>
            <Input placeholder="meet" />
          </TextField>

          <TextField
            isRequired
            name="password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          >
            <Label>Password</Label>
            <Input placeholder="••••••••" />
          </TextField>

          {error ? <FieldError>{error}</FieldError> : null}

          <Button type="submit" variant="primary" isPending={pending} fullWidth>
            Sign In
          </Button>
        </form>
      </Card.Content>
    </Card>
  );
}
