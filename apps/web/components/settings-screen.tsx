"use client";

import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  ListBox,
  Select,
  Table,
  TextField,
} from "@heroui/react";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { Icon } from "@iconify/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Settings screen — MCP personal access tokens.
 *
 * The plaintext token is shown EXACTLY ONCE, in the panel that appears after
 * creation, with an explicit warning. Listings show metadata only: no hash,
 * no plaintext. Revocation goes through DELETE /api/tokens (cookie-auth);
 * the MCP server can never reach these endpoints.
 */

export type SettingsTokenRow = {
  id: string;
  name: string;
  scope: "read" | "read_write";
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type SettingsScreenProps = {
  tokens: SettingsTokenRow[];
  message?: string | undefined;
};

type CreatedToken = {
  id: string;
  token: string;
  name: string;
  scope: string;
};

function formatInstant(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function SettingsScreen({ tokens, message }: SettingsScreenProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "read_write">("read");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);

  const unavailable = message !== undefined;

  async function createToken() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scope }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not create the token");
        return;
      }
      const body = (await res.json()) as CreatedToken;
      setCreated(body);
      setCopied(false);
      setName("");
      setScope("read");
      router.refresh();
    } catch {
      setError("Unable to reach the server");
    } finally {
      setPending(false);
    }
  }

  async function revokeToken(id: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not revoke the token");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-medium text-foreground">Settings</h1>
        <p className="text-sm text-muted">
          MCP access tokens let your own AI agent connect to this app. Prefer read
          scope unless the agent must record journals.
        </p>
      </div>

      {unavailable ? (
        <Card>
          <Card.Content className="p-8">
            <EmptyState>
              <EmptyState.Header>
                <EmptyState.Media variant="icon">
                  <Icon icon="gravity-ui:gear" width={24} />
                </EmptyState.Media>
                <EmptyState.Title>
                  {message === "DATABASE_URL not configured"
                    ? "No database configured"
                    : "Not signed in"}
                </EmptyState.Title>
                <EmptyState.Description>
                  {message === "DATABASE_URL not configured"
                    ? "DATABASE_URL is not set, so tokens cannot be listed or minted."
                    : "Token management needs a signed-in household session."}
                </EmptyState.Description>
              </EmptyState.Header>
            </EmptyState>
          </Card.Content>
        </Card>
      ) : (
        <>
          <Card>
            <Card.Header className="flex flex-col gap-1 p-5 pb-2">
              <Card.Title className="text-base font-medium">Create a token</Card.Title>
              <Card.Description className="text-sm text-muted">
                The token is shown once, immediately after creation.
              </Card.Description>
            </Card.Header>
            <Card.Content className="flex flex-col gap-4 px-5 pb-5">
              <TextField
                className="w-full"
                value={name}
                onChange={setName}
                isRequired
              >
                <Label>Token name</Label>
                <Input placeholder="e.g. Claude on my laptop" autoComplete="off" />
              </TextField>

              <Select
                className="w-full"
                selectedKey={scope}
                onSelectionChange={(key) => {
                  if (key == null) return;
                  setScope(String(key) as "read" | "read_write");
                }}
                aria-label="Token scope"
              >
                <Label>Scope</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item key="read" id="read" textValue="Read only">
                      Read only
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item key="read_write" id="read_write" textValue="Read and write">
                      Read and write
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>

              {error ? <p className="text-sm text-danger">{error}</p> : null}

              <div>
                <Button
                  variant="primary"
                  isPending={pending}
                  isDisabled={pending || name.trim().length === 0}
                  onPress={createToken}
                >
                  Create token
                </Button>
              </div>
            </Card.Content>
          </Card>

          {created ? (
            <Card>
              <Card.Header className="flex flex-col gap-1 p-5 pb-2">
                <Card.Title className="text-base font-medium">
                  Token created — copy it now
                </Card.Title>
                <Card.Description className="text-sm text-danger">
                  This is the only time the token is shown. It will never be displayed
                  again, and it is stored only as a hash.
                </Card.Description>
              </Card.Header>
              <Card.Content className="flex flex-col gap-3 px-5 pb-5">
                <code className="block w-full select-all break-all rounded-lg bg-surface-secondary p-3 text-sm text-foreground">
                  {created.token}
                </code>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    onPress={async () => {
                      await navigator.clipboard.writeText(created.token);
                      setCopied(true);
                    }}
                  >
                    {copied ? "Copied" : "Copy token"}
                  </Button>
                  <Button variant="ghost" onPress={() => setCreated(null)}>
                    Dismiss
                  </Button>
                </div>
              </Card.Content>
            </Card>
          ) : null}

          <Card>
            <Card.Header className="flex flex-col gap-1 p-5 pb-2">
              <Card.Title className="text-base font-medium">Your tokens</Card.Title>
              <Card.Description className="text-sm text-muted">
                Revoking takes effect on the agent&apos;s next request.
              </Card.Description>
            </Card.Header>
            <Card.Content className="px-5 pb-5">
              {tokens.length === 0 ? (
                <EmptyState>
                  <EmptyState.Header>
                    <EmptyState.Media variant="icon">
                      <Icon icon="gravity-ui:key" width={24} />
                    </EmptyState.Media>
                    <EmptyState.Title>No tokens yet</EmptyState.Title>
                    <EmptyState.Description>
                      Create a token above, then point your agent at /api/mcp with it as a
                      bearer token.
                    </EmptyState.Description>
                  </EmptyState.Header>
                </EmptyState>
              ) : (
                <Table aria-label="Access tokens">
                  <Table.ScrollContainer>
                    <Table.Content>
                      <Table.Header>
                        <Table.Column>Name</Table.Column>
                        <Table.Column>Scope</Table.Column>
                        <Table.Column>Created</Table.Column>
                        <Table.Column>Last used</Table.Column>
                        <Table.Column>Status</Table.Column>
                        <Table.Column>Action</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {tokens.map((token) => (
                          <Table.Row key={token.id}>
                            <Table.Cell>{token.name}</Table.Cell>
                            <Table.Cell>
                              <Chip size="sm" variant="soft">
                                {token.scope === "read_write" ? "read + write" : "read"}
                              </Chip>
                            </Table.Cell>
                            <Table.Cell>{formatInstant(token.createdAt)}</Table.Cell>
                            <Table.Cell>{formatInstant(token.lastUsedAt)}</Table.Cell>
                            <Table.Cell>
                              {token.revokedAt ? (
                                <Chip size="sm" variant="soft" color="danger">
                                  Revoked
                                </Chip>
                              ) : (
                                <Chip size="sm" variant="soft" color="success">
                                  Active
                                </Chip>
                              )}
                            </Table.Cell>
                            <Table.Cell>
                              <Button
                                size="sm"
                                variant="danger-soft"
                                isDisabled={pending || token.revokedAt !== null}
                                onPress={() => revokeToken(token.id)}
                              >
                                Revoke
                              </Button>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              )}
            </Card.Content>
          </Card>
        </>
      )}
    </div>
  );
}
