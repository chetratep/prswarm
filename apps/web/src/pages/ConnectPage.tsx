import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Connection,
  ConnectGithubAppResponse,
  ConnectPatResponse,
  ListGithubAppInstallationsResponse,
} from "@prswarm/shared-types";
import { apiDelete, apiGet, apiPost } from "../api/client";
import { IconCheckCircle, IconKey, IconPlug, IconPlusCircle, IconTrash } from "../components/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const CONNECTIONS_QUERY_KEY = ["connections"] as const;

// Remembers which tab was open last (PAT vs GitHub App) so returning users
// land back where they left off rather than always defaulting to PAT.
const METHOD_STORAGE_KEY = "connect-method";
type ConnectMethod = "PAT" | "GITHUB_APP";

function loadLastMethod(): ConnectMethod {
  try {
    const stored = localStorage.getItem(METHOD_STORAGE_KEY);
    return stored === "GITHUB_APP" ? "GITHUB_APP" : "PAT";
  } catch {
    return "PAT";
  }
}

function saveLastMethod(method: ConnectMethod) {
  try {
    localStorage.setItem(METHOD_STORAGE_KEY, method);
  } catch {
    // Ignore — persistence is a nicety, not a requirement.
  }
}

export function ConnectPage() {
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<ConnectMethod>(loadLastMethod);

  const connectionsQuery = useQuery({
    queryKey: CONNECTIONS_QUERY_KEY,
    queryFn: () => apiGet<Connection[]>("/api/connections"),
  });

  // Once at least one connection exists, the per-slot cards take over — this
  // lets the user step back to the form to save a different/second
  // credential. Each slot (PAT, GitHub App) is independently saved; see
  // connectionsRepository.ts's replaceWith* functions.
  const [showReconnectForm, setShowReconnectForm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/connections/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
      setPendingDeleteId(null);
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => apiPost<Connection>(`/api/connections/${id}/activate`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
    },
  });

  // --- PAT flow (unchanged behavior, just now lives under a tab) ---

  const [token, setToken] = useState("");
  const [host, setHost] = useState("");

  const connectPatMutation = useMutation({
    mutationFn: (patToken: string) =>
      apiPost<ConnectPatResponse>("/api/connections", {
        token: patToken,
        host: host.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
      setToken("");
      setShowReconnectForm(false);
    },
  });

  function handlePatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token.trim()) return;
    connectPatMutation.mutate(token.trim());
  }

  // --- GitHub App flow: its own local state, not shared with the PAT form ---

  const [appId, setAppId] = useState("");
  const [privateKeyPem, setPrivateKeyPem] = useState("");
  const [selectedInstallationIds, setSelectedInstallationIds] = useState<Set<number>>(new Set());

  const listInstallationsMutation = useMutation({
    mutationFn: () =>
      apiPost<ListGithubAppInstallationsResponse>("/api/connections/github-app/installations", {
        appId: appId.trim(),
        privateKeyPem: privateKeyPem.trim(),
        host: host.trim() || undefined,
      }),
  });

  const connectAppMutation = useMutation({
    mutationFn: (installationIds: number[]) =>
      apiPost<ConnectGithubAppResponse>("/api/connections/github-app", {
        appId: appId.trim(),
        privateKeyPem: privateKeyPem.trim(),
        installationIds,
        host: host.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
      setShowReconnectForm(false);
      setSelectedInstallationIds(new Set());
    },
  });

  function handleListInstallations() {
    setSelectedInstallationIds(new Set());
    listInstallationsMutation.mutate();
  }

  function toggleInstallation(installationId: number) {
    setSelectedInstallationIds((prev) => {
      const next = new Set(prev);
      if (next.has(installationId)) {
        next.delete(installationId);
      } else {
        next.add(installationId);
      }
      return next;
    });
  }

  function handleConnectSelected() {
    if (selectedInstallationIds.size === 0) return;
    connectAppMutation.mutate(Array.from(selectedInstallationIds));
  }

  function handleMethodChange(next: ConnectMethod) {
    setMethod(next);
    saveLastMethod(next);
  }

  if (connectionsQuery.isLoading) {
    return (
      <div className="page">
        <h2>Connect</h2>
        <p>Checking for existing connections…</p>
      </div>
    );
  }

  const connections = connectionsQuery.data ?? [];
  const activeConnection = connections.find((c) => c.active) ?? null;

  if (connections.length > 0 && !showReconnectForm) {
    const missingMethod: ConnectMethod | null =
      connections.length < 2 ? (connections.some((c) => c.type === "PAT") ? "GITHUB_APP" : "PAT") : null;
    const pendingDeleteConnection = connections.find((c) => c.id === pendingDeleteId) ?? null;

    function openConnectForm(forMethod: ConnectMethod) {
      setMethod(forMethod);
      saveLastMethod(forMethod);
      setShowReconnectForm(true);
    }

    return (
      <div className="page">
        <h2>Connect</h2>
        <p className="page__intro">
          Pick which credential PRSwarm uses right now. Switching is instant — the one you're not
          using stays saved.
        </p>

        <div
          className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2"
          role="radiogroup"
          aria-label="Active GitHub connection"
        >
          {connections.map((connection) => {
            const isPending = activateMutation.isPending && activateMutation.variables === connection.id;
            return (
              <div
                key={connection.id}
                role="radio"
                aria-checked={connection.active}
                tabIndex={0}
                className={cn(
                  "relative flex cursor-pointer flex-col gap-2.5 rounded-xl border bg-card p-4 shadow-sm transition-all",
                  connection.active
                    ? "border-link ring-1 ring-link"
                    : "border-border hover:border-muted-foreground/40",
                  isPending && "cursor-wait opacity-70"
                )}
                onClick={() => {
                  if (!connection.active && !activateMutation.isPending) activateMutation.mutate(connection.id);
                }}
                onKeyDown={(event) => {
                  if ((event.key === "Enter" || event.key === " ") && !connection.active && !activateMutation.isPending) {
                    event.preventDefault();
                    activateMutation.mutate(connection.id);
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full",
                      connection.active ? "bg-link/10 text-link" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {connection.type === "PAT" ? <IconKey size={15} /> : <IconPlug size={15} />}
                  </span>
                  <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {connection.type === "PAT" ? "Personal access token" : "GitHub App"}
                  </span>
                  {connection.active && (
                    <span className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-full bg-link text-white">
                      <IconCheckCircle size={12} />
                    </span>
                  )}
                </div>

                <p className="truncate text-base font-semibold text-foreground">
                  {connection.login ?? "(no login)"}
                </p>

                {(connection.host || (connection.installations?.length ?? 0) > 1) && (
                  <div className="flex flex-wrap gap-1.5">
                    {connection.host && <span className="badge badge--muted">{connection.host}</span>}
                    {connection.type === "GITHUB_APP" && (connection.installations?.length ?? 0) > 1 && (
                      <span className="badge badge--muted">
                        {connection.installations?.length} installations
                      </span>
                    )}
                  </div>
                )}

                <div className="mt-auto flex items-center justify-between pt-1">
                  <span className={cn("text-xs", connection.active ? "font-medium text-link" : "text-muted-foreground")}>
                    {isPending ? "Switching…" : connection.active ? "In use" : "Tap to switch to this"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove this ${connection.type === "PAT" ? "personal access token" : "GitHub App"} connection`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPendingDeleteId(connection.id);
                    }}
                  >
                    <IconTrash size={13} />
                  </Button>
                </div>
              </div>
            );
          })}

          {missingMethod && (
            <button
              type="button"
              className="flex min-h-[7.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
              onClick={() => openConnectForm(missingMethod)}
            >
              <IconPlusCircle size={20} />
              <span>Add {missingMethod === "PAT" ? "personal access token" : "GitHub App"}</span>
            </button>
          )}
        </div>

        {pendingDeleteConnection && (
          <div className="disconnect-confirm">
            <p>
              This forgets the stored {pendingDeleteConnection.type === "PAT" ? "token" : "private key"} on
              this instance — it doesn't revoke it on GitHub. You'll need to reconnect before using it
              again.
            </p>
            {deleteMutation.isError && (
              <p className="form__error" role="alert">
                {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Failed to remove."}
              </p>
            )}
            <div className="disconnect-confirm__actions">
              <Button
                type="button"
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(pendingDeleteConnection.id)}
              >
                {deleteMutation.isPending ? "Removing…" : "Yes, remove"}
              </Button>
              <Button
                type="button"
                variant="link"
                className="text-link h-auto p-0"
                onClick={() => setPendingDeleteId(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {activeConnection && (
          <Button asChild size="lg" className="mt-4">
            <Link to="/select">Continue to select repos</Link>
          </Button>
        )}
      </div>
    );
  }

  const canListInstallations =
    !!appId.trim() && !!privateKeyPem.trim() && !listInstallationsMutation.isPending;

  return (
    <div className="page">
      <h2>Connect</h2>

      {connections.length > 0 && (
        <p className="page__intro">
          {activeConnection && (
            <>Currently using <strong>{activeConnection.login ?? "(no login)"}</strong>. </>
          )}
          <Button
            type="button"
            variant="link"
            className="text-link h-auto p-0"
            onClick={() => setShowReconnectForm(false)}
          >
            Cancel and go back
          </Button>
        </p>
      )}

      <Tabs value={method} onValueChange={(v) => handleMethodChange(v as ConnectMethod)}>
        <TabsList variant="line">
          <TabsTrigger value="PAT">
            <IconKey size={15} />
            Personal access token
          </TabsTrigger>
          <TabsTrigger value="GITHUB_APP">
            <IconPlug size={15} />
            GitHub App
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {method === "PAT" && (
        <>
          <p className="page__intro">
            Connect a GitHub personal access token. It needs read access to the orgs/repos you want
            to target, and write access to push changes later in the workflow.
          </p>
          <form className="form" onSubmit={handlePatSubmit}>
            <label className="form__field">
              <span>Personal access token</span>
              <PasswordInput
                name="token"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="ghp_…"
                required
              />
            </label>
            <label className="form__field">
              <span>
                GitHub Enterprise Server hostname <span className="optional-mark">(optional)</span>
              </span>
              <Input
                type="text"
                name="host"
                autoComplete="off"
                value={host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="github.example.com — leave blank for github.com"
              />
            </label>
            {connectPatMutation.isError && (
              <p className="form__error" role="alert">
                {connectPatMutation.error instanceof Error
                  ? connectPatMutation.error.message
                  : "Failed to connect."}
              </p>
            )}
            <Button
              type="submit"
              disabled={connectPatMutation.isPending}
            >
              {connectPatMutation.isPending ? "Connecting…" : "Connect"}
            </Button>
          </form>
        </>
      )}

      {method === "GITHUB_APP" && (
        <>
          <p className="page__intro">
            Connect a GitHub App by its App ID and private key. We'll list the accounts the App is
            installed on so you can pick which one this connection targets.
          </p>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              if (canListInstallations) handleListInstallations();
            }}
          >
            <label className="form__field">
              <span>App ID</span>
              <Input
                type="text"
                name="appId"
                autoComplete="off"
                value={appId}
                onChange={(event) => setAppId(event.target.value)}
                placeholder="123456"
                required
              />
            </label>
            <label className="form__field">
              <span>Private key (.pem)</span>
              <Textarea
                name="privateKeyPem"
                className="font-mono text-sm field-sizing-fixed resize-y overflow-y-auto"
                rows={8}
                autoComplete="off"
                value={privateKeyPem}
                onChange={(event) => setPrivateKeyPem(event.target.value)}
                placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;…&#10;-----END RSA PRIVATE KEY-----"
                required
              />
            </label>
            <label className="form__field">
              <span>
                GitHub Enterprise Server hostname <span className="optional-mark">(optional)</span>
              </span>
              <Input
                type="text"
                name="host"
                autoComplete="off"
                value={host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="github.example.com — leave blank for github.com"
              />
            </label>
            {listInstallationsMutation.isError && (
              <p className="form__error" role="alert">
                {listInstallationsMutation.error instanceof Error
                  ? listInstallationsMutation.error.message
                  : "Failed to list installations."}
              </p>
            )}
            <Button type="submit" disabled={!canListInstallations}>
              {listInstallationsMutation.isPending ? "Listing installations…" : "List installations"}
            </Button>
          </form>

          {listInstallationsMutation.data && (
            <div className="repo-section">
              <h3>Choose one or more installations</h3>
              {listInstallationsMutation.data.installations.length === 0 && (
                <p className="page__loading">No installations found for this App.</p>
              )}
              {listInstallationsMutation.data.installations.length > 0 && (
                <>
                  <div className="org-grid">
                    {listInstallationsMutation.data.installations.map((installation) => {
                      const isSelected = selectedInstallationIds.has(installation.installationId);
                      return (
                        <button
                          key={installation.installationId}
                          type="button"
                          aria-pressed={isSelected}
                          className={"org-card" + (isSelected ? " org-card--selected" : "")}
                          disabled={connectAppMutation.isPending}
                          onClick={() => toggleInstallation(installation.installationId)}
                        >
                          <img
                            src={installation.accountAvatarUrl}
                            alt=""
                            className="org-card__avatar"
                            width={32}
                            height={32}
                          />
                          <span className="org-card__login">{installation.accountLogin}</span>
                          <span className="badge badge--muted">{installation.accountType}</span>
                          {isSelected && <IconCheckCircle size={15} />}
                        </button>
                      );
                    })}
                  </div>
                  <Button
                    type="button"
                    disabled={selectedInstallationIds.size === 0 || connectAppMutation.isPending}
                    onClick={handleConnectSelected}
                  >
                    {connectAppMutation.isPending
                      ? "Connecting…"
                      : `Connect ${selectedInstallationIds.size || ""} installation${selectedInstallationIds.size === 1 ? "" : "s"}`.trim()}
                  </Button>
                </>
              )}
              {connectAppMutation.isError && (
                <p className="form__error" role="alert">
                  {connectAppMutation.error instanceof Error
                    ? connectAppMutation.error.message
                    : "Failed to connect the selected installations."}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
