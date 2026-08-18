import { lazy, Suspense, useState, type FormEvent } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, useSession, SESSION_QUERY_KEY } from "./api/client";
import { Stepper } from "./components/Stepper";
import { ConnectPage } from "./pages/ConnectPage";
import { SelectPage } from "./pages/SelectPage";
import { PreviewPage } from "./pages/PreviewPage";
import { ConfirmPage } from "./pages/ConfirmPage";
import { ExecutePage } from "./pages/ExecutePage";
import { ResultsPage } from "./pages/ResultsPage";
import { HistoryPage } from "./pages/HistoryPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { SelectionProvider } from "./state/SelectionContext";
import { IconHistory, IconUser, LogoMark } from "./components/icons";

// Lazy: DefinePage pulls in CodeMirror + language packages, which roughly
// quadrupled the bundle (230KB -> 860KB minified) for pages that never touch
// it. Split so Connect/Select/Preview/Confirm/Results stay light and the
// editor only loads once someone actually reaches Define.
const DefinePage = lazy(() => import("./pages/DefinePage").then((m) => ({ default: m.DefinePage })));

function LoginForm() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const loginMutation = useMutation({
    mutationFn: () => apiPost<{ ok: true }>("/api/login", { username, password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });

  const signupMutation = useMutation({
    mutationFn: () => apiPost<{ user: unknown }>("/api/signup", { username, password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });

  const activeMutation = mode === "login" ? loginMutation : signupMutation;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    activeMutation.mutate();
  }

  return (
    <div className="login-screen">
      <form className="form login-form" onSubmit={handleSubmit}>
        <h1>{mode === "login" ? "Sign in" : "Create an account"}</h1>
        <label className="form__field">
          <span>Username</span>
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </label>
        <label className="form__field">
          <span>Password</span>
          <input
            type="password"
            name="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={mode === "signup" ? 8 : undefined}
          />
        </label>
        {activeMutation.isError && (
          <p className="form__error" role="alert">
            {activeMutation.error instanceof Error ? activeMutation.error.message : "Something went wrong."}
          </p>
        )}
        <button type="submit" className="button button--primary" disabled={activeMutation.isPending}>
          {activeMutation.isPending
            ? mode === "login"
              ? "Signing in…"
              : "Creating account…"
            : mode === "login"
              ? "Sign in"
              : "Create account"}
        </button>
        <button
          type="button"
          className="button-link"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
        >
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}

// Shown in the header on every page — the instance/system user this session
// is signed in as (AUTH_USERNAME, e.g. "admin"), NOT the connected GitHub
// account. Those are two separate identities: this app's own instance login
// (optional, off by default — see CLAUDE.md) versus whichever GitHub
// credential the stored Connection happens to use (shown on the Connect
// page instead). Falls back to "local" — the same term this app already
// uses elsewhere (Job.createdBy) for "no instance auth configured, single
// implicit user".
function CurrentUserBadge() {
  const sessionQuery = useSession();

  if (sessionQuery.isLoading) {
    return null;
  }

  const username = sessionQuery.data?.username;
  return (
    <span className="app-header__user">
      <IconUser size={15} />
      Signed in as <strong>{username ?? "local"}</strong>
    </span>
  );
}

function AdminUsersNavLink() {
  const sessionQuery = useSession();
  if (sessionQuery.data?.role !== "admin") {
    return null;
  }
  return (
    <Link to="/admin/users" className="app-header__nav-link">
      Users
    </Link>
  );
}

function App() {
  const sessionQuery = useSession();

  if (sessionQuery.isLoading) {
    return (
      <div className="app-loading">
        <p>Loading…</p>
      </div>
    );
  }

  if (sessionQuery.isError) {
    return (
      <div className="app-loading">
        <p>Could not reach the server. Is the API running?</p>
      </div>
    );
  }

  const session = sessionQuery.data;
  if (session?.authRequired && !session.authenticated) {
    return <LoginForm />;
  }

  return (
    <SelectionProvider>
      <div className="app-shell">
        <header className="app-header">
          <div className="app-header__top">
            <div className="app-header__brand">
              <span className="app-header__logo">
                <LogoMark size={17} />
              </span>
              <h1 className="app-header__title">Bulk GitHub Update Tool</h1>
            </div>
            <div className="app-header__top-actions">
              <Link to="/history" className="app-header__nav-link">
                <IconHistory size={15} />
                History
              </Link>
              <AdminUsersNavLink />
              <CurrentUserBadge />
            </div>
          </div>
          <Stepper />
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Navigate to="/connect" replace />} />
            <Route path="/connect" element={<ConnectPage />} />
            <Route path="/select" element={<SelectPage />} />
            <Route
              path="/define"
              element={
                <Suspense fallback={<p className="page__loading">Loading editor…</p>}>
                  <DefinePage />
                </Suspense>
              }
            />
            <Route path="/preview/:jobId" element={<PreviewPage />} />
            <Route path="/confirm/:jobId" element={<ConfirmPage />} />
            {/* Execute now has real content: execute is async (returns fast,
                job flips to RUNNING immediately, writes happen in the
                background), so this page opens an SSE connection to
                GET /api/jobs/:id/events and renders live per-repo progress
                as it streams in. */}
            <Route path="/execute/:jobId" element={<ExecutePage />} />
            <Route path="/results/:jobId" element={<ResultsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="*" element={<Navigate to="/connect" replace />} />
          </Routes>
        </main>
      </div>
    </SelectionProvider>
  );
}

export default App;
