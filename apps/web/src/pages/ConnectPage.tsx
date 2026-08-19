import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Connection,
  ConnectGithubAppResponse,
  ConnectPatResponse,
  ListGithubAppInstallationsResponse,
} from "@bulk-github-update-tool/shared-types";
import { apiDelete, apiGetOrNull, apiPost } from "../api/client";
import { IconCheckCircle, IconKey, IconPlug, IconTrash } from "../components/icons";

const CONNECTION_QUERY_KEY = ["connection", "current"] as const;

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

  const connectionQuery = useQuery({
    queryKey: CONNECTION_QUERY_KEY,
    queryFn: () => apiGetOrNull<Connection>("/api/connections/current"),
  });

  // Once a connection exists, the Connected card takes over — this lets the
  // user step back to the form to submit different credentials. Submitting
  // replaces the stored connection outright (see connectionsRepository.ts's
  // replaceWith* functions), so no separate disconnect/delete endpoint is
  // needed for this.
  const [showReconnectForm, setShowReconnectForm] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const disconnectMutation = useMutation({
    mutationFn: () => apiDelete("/api/connections/current"),
    onSuccess: () => {
      queryClient.setQueryData<Connection | null>(CONNECTION_QUERY_KEY, null);
      setShowDisconnectConfirm(false);
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
    onSuccess: (data) => {
      queryClient.setQueryData<Connection | null>(CONNECTION_QUERY_KEY, data.connection);
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
    onSuccess: (data) => {
      queryClient.setQueryData<Connection | null>(CONNECTION_QUERY_KEY, data.connection);
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

  if (connectionQuery.isLoading) {
    return (
      <div className="page">
        <h2>Connect</h2>
        <p>Checking for an existing connection…</p>
      </div>
    );
  }

  const connection =
    connectionQuery.data ??
    connectPatMutation.data?.connection ??
    connectAppMutation.data?.connection ??
    null;

  if (connection && !showReconnectForm) {
    return (
      <div className="page">
        <h2>Connect</h2>
        <div className="connected-card">
          <p className="connected-card__status">
            <IconCheckCircle size={17} />
            Connected
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
            <Link to="/select" className="button button--primary">
              Continue to select repos
            </Link>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setShowReconnectForm(true)}
            >
              Use different credentials
            </button>
            <button
              type="button"
              className="button-link button-link--danger"
              onClick={() => setShowDisconnectConfirm(true)}
            >
              <IconTrash size={14} />
              Disconnect
            </button>
          </div>

          {showDisconnectConfirm && (
            <div className="disconnect-confirm">
              <p>
                This forgets the stored credential on this instance — it doesn't revoke it on
                GitHub. You'll need to reconnect before running anything again.
              </p>
              {disconnectMutation.isError && (
                <p className="form__error" role="alert">
                  {disconnectMutation.error instanceof Error
                    ? disconnectMutation.error.message
                    : "Failed to disconnect."}
                </p>
              )}
              <div className="disconnect-confirm__actions">
                <button
                  type="button"
                  className="button button--danger"
                  disabled={disconnectMutation.isPending}
                  onClick={() => disconnectMutation.mutate()}
                >
                  {disconnectMutation.isPending ? "Disconnecting…" : "Yes, disconnect"}
                </button>
                <button
                  type="button"
                  className="button-link"
                  onClick={() => setShowDisconnectConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const canListInstallations =
    !!appId.trim() && !!privateKeyPem.trim() && !listInstallationsMutation.isPending;

  return (
    <div className="page">
      <h2>Connect</h2>

      {connection && (
        <p className="page__intro">
          Currently connected as <strong>{connection.login ?? "(no login)"}</strong>.{" "}
          <button
            type="button"
            className="button-link"
            onClick={() => setShowReconnectForm(false)}
          >
            Cancel and keep this connection
          </button>
        </p>
      )}

      <div className="method-tabs" role="tablist" aria-label="Connection method">
        <button
          type="button"
          role="tab"
          aria-selected={method === "PAT"}
          className={"method-tab" + (method === "PAT" ? " method-tab--active" : "")}
          onClick={() => handleMethodChange("PAT")}
        >
          <IconKey size={15} />
          Personal access token
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={method === "GITHUB_APP"}
          className={"method-tab" + (method === "GITHUB_APP" ? " method-tab--active" : "")}
          onClick={() => handleMethodChange("GITHUB_APP")}
        >
          <IconPlug size={15} />
          GitHub App
        </button>
      </div>

      {method === "PAT" && (
        <>
          <p className="page__intro">
            Connect a GitHub personal access token. It needs read access to the orgs/repos you want
            to target, and write access to push changes later in the workflow.
          </p>
          <form className="form" onSubmit={handlePatSubmit}>
            <label className="form__field">
              <span>Personal access token</span>
              <input
                type="password"
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
              <input
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
            <button
              type="submit"
              className="button button--primary"
              disabled={connectPatMutation.isPending}
            >
              {connectPatMutation.isPending ? "Connecting…" : "Connect"}
            </button>
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
              <input
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
              <textarea
                name="privateKeyPem"
                className="form__textarea form__textarea--mono"
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
              <input
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
            <button type="submit" className="button button--primary" disabled={!canListInstallations}>
              {listInstallationsMutation.isPending ? "Listing installations…" : "List installations"}
            </button>
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
