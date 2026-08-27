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
import { IconCheckCircle, IconKey, IconPlug, IconTrash } from "../components/icons";
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
  const [connectingInstallationId, setConnectingInstallationId] = useState<number | null>(null);

  const listInstallationsMutation = useMutation({
    mutationFn: () =>
      apiPost<ListGithubAppInstallationsResponse>("/api/connections/github-app/installations", {
        appId: appId.trim(),
        privateKeyPem: privateKeyPem.trim(),
        host: host.trim() || undefined,
      }),
  });

  const connectAppMutation = useMutation({
    mutationFn: (installationId: number) =>
      apiPost<ConnectGithubAppResponse>("/api/connections/github-app", {
        appId: appId.trim(),
        privateKeyPem: privateKeyPem.trim(),
        installationId,
        host: host.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
      setShowReconnectForm(false);
    },
    onSettled: () => setConnectingInstallationId(null),
  });

  function handleListInstallations() {
    listInstallationsMutation.mutate();
  }

  function handleConnectInstallation(installationId: number) {
    setConnectingInstallationId(installationId);
    connectAppMutation.mutate(installationId);
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
    return (
      <div className="page">
        <h2>Connect</h2>
        {connections.map((connection) => (
          <div key={connection.id} className="connected-card">
            <p className="connected-card__status">
              {connection.active ? (
                <>
                  <IconCheckCircle size={17} />
                  In use
                </>
              ) : (
                "Saved, not in use"
              )}
            </p>
            <p>
              <strong>{connection.login ?? "(no login)"}</strong>{" "}
              <span className="badge">{connection.type}</span>
              {connection.host && <span className="badge badge--muted">{connection.host}</span>}
            </p>
            <p className="connected-card__meta">
              Connection ID: <code>{connection.id}</code>
            </p>
            <div className="connected-card__actions">
              {connection.active ? (
                <Button asChild>
                  <Link to="/select">Continue to select repos</Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={activateMutation.isPending}
                  onClick={() => activateMutation.mutate(connection.id)}
                >
                  {activateMutation.isPending ? "Activating…" : "Use this connection"}
                </Button>
              )}
              <Button
                type="button"
                variant="link"
                className="text-destructive h-auto p-0"
                onClick={() => setPendingDeleteId(connection.id)}
              >
                <IconTrash size={14} />
                Remove
              </Button>
            </div>

            {pendingDeleteId === connection.id && (
              <div className="disconnect-confirm">
                <p>
                  This forgets the stored credential on this instance — it doesn't revoke it on
                  GitHub. You'll need to reconnect before using it again.
                </p>
                {deleteMutation.isError && (
                  <p className="form__error" role="alert">
                    {deleteMutation.error instanceof Error
                      ? deleteMutation.error.message
                      : "Failed to remove."}
                  </p>
                )}
                <div className="disconnect-confirm__actions">
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(connection.id)}
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
          </div>
        ))}

        {connections.length < 2 && (
          <Button type="button" variant="outline" onClick={() => setShowReconnectForm(true)}>
            Connect {connections.some((c) => c.type === "PAT") ? "GitHub App" : "another credential"}
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
              <h3>Choose an installation</h3>
              {listInstallationsMutation.data.installations.length === 0 && (
                <p className="page__loading">No installations found for this App.</p>
              )}
              {listInstallationsMutation.data.installations.length > 0 && (
                <div className="org-grid">
                  {listInstallationsMutation.data.installations.map((installation) => {
                    const isConnectingThis =
                      connectAppMutation.isPending &&
                      connectingInstallationId === installation.installationId;
                    return (
                      <button
                        key={installation.installationId}
                        type="button"
                        className={
                          "org-card" + (isConnectingThis ? " org-card--connecting" : "")
                        }
                        disabled={connectAppMutation.isPending}
                        onClick={() => handleConnectInstallation(installation.installationId)}
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
                        {isConnectingThis && (
                          <span className="org-card__status">Connecting…</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {connectAppMutation.isError && (
                <p className="form__error" role="alert">
                  {connectAppMutation.error instanceof Error
                    ? connectAppMutation.error.message
                    : "Failed to connect this installation."}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
