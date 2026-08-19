import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type {
  Connection,
  GitHubOrgSummary,
  GitHubRepoSummary,
} from "@bulk-github-update-tool/shared-types";
import { apiGet, apiGetOrNull } from "../api/client";
import { useSelection } from "../state/SelectionContext";
import { OrgBadge } from "../components/OrgBadge";
import { EmptyState } from "../components/EmptyState";
import { IconSearch } from "../components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CONNECTION_QUERY_KEY = ["connection", "current"] as const;
const SEARCH_DEBOUNCE_MS = 300;

export function SelectPage() {
  const navigate = useNavigate();

  const connectionQuery = useQuery({
    queryKey: CONNECTION_QUERY_KEY,
    queryFn: () => apiGetOrNull<Connection>("/api/connections/current"),
  });

  const hasConnection = !!connectionQuery.data;

  useEffect(() => {
    if (!connectionQuery.isLoading && !hasConnection) {
      navigate("/connect", { replace: true });
    }
  }, [connectionQuery.isLoading, hasConnection, navigate]);

  const orgsQuery = useQuery({
    queryKey: ["orgs"],
    queryFn: () => apiGet<GitHubOrgSummary[]>("/api/orgs"),
    enabled: hasConnection,
  });

  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [debouncedLanguage, setDebouncedLanguage] = useState("");
  const [topic, setTopic] = useState("");
  const [debouncedTopic, setDebouncedTopic] = useState("");
  // Discrete choice, not free text — no debounce needed. "" means "All" and
  // is omitted from the request entirely (see reposQuery below).
  const [archived, setArchived] = useState<"" | "true" | "false">("");
  // Lifted to SelectionContext (see src/state/SelectionContext.tsx) so the
  // selection survives navigating on to /define — kept across org switches
  // the same way it always was, it's just backed by context now instead of
  // local state.
  const { selectedRepos, setSelectedRepos } = useSelection();

  // Single shared timer debounces all three free-text filters together —
  // simpler than three independent effects, at the cost of restarting the
  // whole debounce window if the user is still typing in a different field.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setDebouncedLanguage(language.trim());
      setDebouncedTopic(topic.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, language, topic]);

  const reposQuery = useQuery({
    queryKey: ["repos", selectedOrg, debouncedSearch, debouncedLanguage, debouncedTopic, archived],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (debouncedLanguage) params.set("language", debouncedLanguage);
      if (debouncedTopic) params.set("topic", debouncedTopic);
      if (archived) params.set("archived", archived);
      const qs = params.toString();
      return apiGet<GitHubRepoSummary[]>(
        `/api/orgs/${encodeURIComponent(selectedOrg as string)}/repos${qs ? `?${qs}` : ""}`,
      );
    },
    enabled: !!selectedOrg,
  });

  const repos = reposQuery.data ?? [];
  const allVisibleSelected = repos.length > 0 && repos.every((repo) => selectedRepos.has(repo.fullName));

  function toggleRepo(fullName: string) {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) {
        next.delete(fullName);
      } else {
        next.add(fullName);
      }
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        repos.forEach((repo) => next.delete(repo.fullName));
      } else {
        repos.forEach((repo) => next.add(repo.fullName));
      }
      return next;
    });
  }

  function selectOrg(login: string) {
    setSelectedOrg(login);
  }

  // Selections already persist across org switches (selectedRepos lives in
  // SelectionContext, untouched by which org is currently being browsed) —
  // this just makes that visible, grouped by owner, so picking repos from
  // several orgs into one run is discoverable instead of looking like each
  // org switch resets you.
  const selectedByOwner = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const fullName of selectedRepos) {
      const owner = fullName.split("/")[0];
      const list = map.get(owner) ?? [];
      list.push(fullName);
      map.set(owner, list);
    }
    return map;
  }, [selectedRepos]);

  if (connectionQuery.isLoading || !hasConnection) {
    return (
      <div className="page">
        <h2>Select targets</h2>
        <p>Checking connection…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>Select targets</h2>
      <p className="page__intro">
        Pick an org, choose repos, then switch orgs and keep picking — selections carry across
        orgs into the same run.
      </p>

      {selectedRepos.size > 0 && (
        <div className="selection-summary">
          <h3>
            Selected — {selectedRepos.size} repo{selectedRepos.size === 1 ? "" : "s"} across{" "}
            {selectedByOwner.size} org{selectedByOwner.size === 1 ? "" : "s"}
          </h3>
          <div className="selection-summary__groups">
            {Array.from(selectedByOwner.entries()).map(([owner, repos]) => (
              <div key={owner} className="selection-summary__group">
                <span className="selection-summary__owner">
                  <OrgBadge login={owner} size={16} />
                  {owner}
                </span>
                <div className="selection-summary__chips">
                  {repos.map((fullName) => (
                    <span key={fullName} className="chip chip--selected-repo">
                      {fullName.slice(owner.length + 1)}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="h-4 w-4"
                        aria-label={`Remove ${fullName}`}
                        onClick={() => toggleRepo(fullName)}
                      >
                        ×
                      </Button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {orgsQuery.isLoading && <p>Loading orgs…</p>}
      {orgsQuery.isError && (
        <p className="form__error" role="alert">
          {orgsQuery.error instanceof Error ? orgsQuery.error.message : "Failed to load orgs."}
        </p>
      )}

      {orgsQuery.data && (
        <div className="org-grid">
          {orgsQuery.data.map((org) => (
            <button
              key={org.id}
              type="button"
              className={
                "org-card" + (org.login === selectedOrg ? " org-card--selected" : "")
              }
              onClick={() => selectOrg(org.login)}
            >
              <img src={org.avatarUrl} alt="" className="org-card__avatar" width={32} height={32} />
              <span className="org-card__login">{org.login}</span>
              {org.type === "User" && <span className="badge badge--muted">personal</span>}
            </button>
          ))}
          {orgsQuery.data.length === 0 && <p>No orgs accessible with this connection.</p>}
        </div>
      )}

      {selectedOrg && (
        <div className="repo-section">
          <div className="repo-section__header">
            <h3>{selectedOrg}</h3>
            <span className="selected-count">{selectedRepos.size} selected</span>
          </div>

          <div className="repo-section__controls">
            <span className="repo-search-wrap">
              <IconSearch size={15} />
              <Input
                type="search"
                placeholder="Filter repos by name…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="repo-search"
              />
            </span>
            <Input
              type="search"
              placeholder="Filter by language…"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              className="repo-search repo-filter"
              aria-label="Filter by language"
            />
            <Input
              type="search"
              placeholder="Filter by topic…"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              className="repo-search repo-filter"
              aria-label="Filter by topic"
            />
            <Select
              value={archived === "" ? "all" : archived}
              onValueChange={(value) =>
                setArchived(value === "all" ? "" : (value as "true" | "false"))
              }
            >
              <SelectTrigger aria-label="Filter by archived status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="false">Active only</SelectItem>
                <SelectItem value="true">Archived only</SelectItem>
              </SelectContent>
            </Select>
            <div className="select-all flex items-center gap-2">
              <Checkbox
                id="select-all-visible"
                checked={allVisibleSelected}
                onCheckedChange={toggleSelectAllVisible}
                disabled={repos.length === 0}
              />
              <Label htmlFor="select-all-visible" className="cursor-pointer font-normal">
                Select all visible
              </Label>
            </div>
          </div>

          {reposQuery.isLoading && <p>Loading repos…</p>}
          {reposQuery.isError && (
            <p className="form__error" role="alert">
              {reposQuery.error instanceof Error ? reposQuery.error.message : "Failed to load repos."}
            </p>
          )}

          {reposQuery.data && (
            <ul className="repo-list">
              {repos.map((repo) => (
                <li key={repo.fullName} className="repo-list__item">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`repo-${repo.fullName}`}
                      checked={selectedRepos.has(repo.fullName)}
                      onCheckedChange={() => toggleRepo(repo.fullName)}
                    />
                    <Label htmlFor={`repo-${repo.fullName}`} className="cursor-pointer font-normal">
                      <span className="repo-list__name">{repo.fullName}</span>
                      {repo.private && <span className="badge badge--muted">private</span>}
                      {repo.archived && <span className="badge badge--muted">archived</span>}
                      {repo.language && <span className="badge badge--muted">{repo.language}</span>}
                    </Label>
                  </div>
                </li>
              ))}
              {repos.length === 0 && (
                <li>
                  <EmptyState message="No repos match these filters." />
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {selectedRepos.size > 0 && (
        <div className="page__footer-actions">
          <Button asChild>
            <Link to="/define">
              Continue with {selectedRepos.size} repo{selectedRepos.size === 1 ? "" : "s"}
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
