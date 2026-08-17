import { lazy, Suspense, useState, type FormEvent } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, useSession, SESSION_QUERY_KEY } from "./api/client";
import { Stepper } from "./components/Stepper";
import { ConnectPage } from "./pages/ConnectPage";
import { SelectPage } from "./pages/SelectPage";
import { PreviewPage } from "./pages/PreviewPage";
import { ConfirmPage } from "./pages/ConfirmPage";
import { ExecutePage } from "./pages/ExecutePage";
import { ResultsPage } from "./pages/ResultsPage";
import { SelectionProvider } from "./state/SelectionContext";

// Lazy: DefinePage pulls in CodeMirror + language packages, which roughly
// quadrupled the bundle (230KB -> 860KB minified) for pages that never touch
// it. Split so Connect/Select/Preview/Confirm/Results stay light and the
// editor only loads once someone actually reaches Define.
const DefinePage = lazy(() => import("./pages/DefinePage").then((m) => ({ default: m.DefinePage })));

function LoginForm() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const loginMutation = useMutation({
    mutationFn: () => apiPost<{ ok: true }>("/api/login", { username, password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loginMutation.mutate();
  }

  return (
    <div className="login-screen">
      <form className="form login-form" onSubmit={handleSubmit}>
        <h1>Sign in</h1>
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
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {loginMutation.isError && (
          <p className="form__error" role="alert">
            {loginMutation.error instanceof Error ? loginMutation.error.message : "Login failed."}
          </p>
        )}
        <button type="submit" className="button button--primary" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
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
          <h1 className="app-header__title">Bulk GitHub Update Tool</h1>
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
            <Route path="*" element={<Navigate to="/connect" replace />} />
          </Routes>
        </main>
      </div>
    </SelectionProvider>
  );
}

export default App;
