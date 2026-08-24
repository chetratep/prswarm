import { lazy, Suspense, useState, type FormEvent } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ApiError, apiPost, useSession, SESSION_QUERY_KEY } from "./api/client";
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
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

// Lazy: DefinePage pulls in CodeMirror + language packages, which roughly
// quadrupled the bundle (230KB -> 860KB minified) for pages that never touch
// it. Split so Connect/Select/Preview/Confirm/Results stay light and the
// editor only loads once someone actually reaches Define.
const DefinePage = lazy(() => import("./pages/DefinePage").then((m) => ({ default: m.DefinePage })));

// A hard reload (not queryClient.clear()) on every login/signup/logout
// transition. This is deliberate, not a shortcut: queryClient.clear() wipes
// the cache but doesn't reliably re-wake already-mounted observers (verified
// directly — a component's useQuery can keep rendering its last value after
// clear() until something else prompts a re-render), which is exactly the
// bug this is fixing — a previous account's cached data (e.g. the admin
// users list) staying visible for an instant after a different user logs
// in on the same tab. A full reload guarantees a fresh JS heap and an empty
// cache with no such window. Auth transitions are rare, coarse events, so
// losing SPA smoothness here is an acceptable, simple trade for certainty.
function reloadAfterAuthChange() {
  window.location.href = "/";
}

function LoginForm() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const loginMutation = useMutation({
    mutationFn: () => apiPost<{ ok: true }>("/api/login", { username, password }),
    onSuccess: reloadAfterAuthChange,
  });

  const signupMutation = useMutation({
    mutationFn: () => apiPost<{ user: unknown }>("/api/signup", { username, password }),
    onSuccess: reloadAfterAuthChange,
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
          <Input
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
          <PasswordInput
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
            {activeMutation.error instanceof ApiError && activeMutation.error.status === 429
              ? "Too many failed attempts from this device. This isn't about whether your password is right — wait 15 minutes, then try again."
              : activeMutation.error instanceof Error
                ? activeMutation.error.message
                : "Something went wrong."}
          </p>
        )}
        <Button type="submit" disabled={activeMutation.isPending}>
          {activeMutation.isPending
            ? mode === "login"
              ? "Signing in…"
              : "Creating account…"
            : mode === "login"
              ? "Sign in"
              : "Create account"}
        </Button>
        <Button
          type="button"
          variant="link"
          className="text-link h-auto p-0"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
        >
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </Button>
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
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const logoutMutation = useMutation({
    mutationFn: () => apiPost<{ ok: true }>("/api/logout", {}),
    onSuccess: reloadAfterAuthChange,
  });

  const changePasswordMutation = useMutation({
    mutationFn: () =>
      apiPost<{ ok: true }>("/api/users/me/password", { currentPassword, newPassword }),
    onSuccess: () => {
      setChangePasswordOpen(false);
      setCurrentPassword("");
      setNewPassword("");
    },
  });

  if (sessionQuery.isLoading) {
    return null;
  }

  const username = sessionQuery.data?.username;
  const authenticated = sessionQuery.data?.authenticated;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="rounded-full pl-2.5">
            <IconUser size={15} />
            <strong className="font-semibold">{username ?? "local"}</strong>
            <ChevronDown size={14} className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        {authenticated && (
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{username ?? "local"}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="whitespace-nowrap"
              onSelect={() => {
                changePasswordMutation.reset();
                setChangePasswordOpen(true);
              }}
            >
              Change password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="whitespace-nowrap"
              variant="destructive"
              disabled={logoutMutation.isPending}
              onSelect={() => logoutMutation.mutate()}
            >
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>
      {authenticated && (
        <Dialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change password</DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                changePasswordMutation.mutate();
              }}
            >
              <Label className="flex flex-col items-start gap-1">
                <span>Current password</span>
                <PasswordInput
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </Label>
              <Label className="flex flex-col items-start gap-1">
                <span>New password (min 8 characters)</span>
                <PasswordInput
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                />
              </Label>
              {changePasswordMutation.isError && (
                <p className="form__error" role="alert">
                  {changePasswordMutation.error instanceof Error
                    ? changePasswordMutation.error.message
                    : "Failed to change password."}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setChangePasswordOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    currentPassword.length === 0 ||
                    newPassword.length < 8 ||
                    changePasswordMutation.isPending
                  }
                >
                  Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
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
              <h1 className="app-header__title">PRSwarm</h1>
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
