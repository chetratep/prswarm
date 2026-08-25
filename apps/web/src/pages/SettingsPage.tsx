import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SettingsResponse, UpdateSettingsRequest } from "@prswarm/shared-types";
import { apiGet, apiPost } from "../api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SETTINGS_QUERY_KEY = ["admin", "settings"] as const;

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");

  const settingsQuery = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => apiGet<SettingsResponse>("/api/settings"),
  });

  // Sync the input from the server once it loads — a plain useState default
  // can't do this since the query starts out empty and resolves later.
  useEffect(() => {
    if (settingsQuery.data) {
      setSlackWebhookUrl(settingsQuery.data.slackWebhookUrl ?? "");
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (body: UpdateSettingsRequest) => apiPost<SettingsResponse>("/api/settings", body),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, data);
    },
  });

  if (settingsQuery.isLoading) {
    return (
      <div className="page">
        <h2>Settings</h2>
        <p className="page__loading">Loading settings…</p>
      </div>
    );
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <div className="page">
        <h2>Settings</h2>
        <p className="form__error" role="alert">
          {settingsQuery.error instanceof Error ? settingsQuery.error.message : "Failed to load settings."}
        </p>
      </div>
    );
  }

  const isEnvSourced = settingsQuery.data.slackWebhookUrlSource === "env";

  return (
    <div className="page">
      <h2>Settings</h2>

      <form
        className="form form--wide"
        onSubmit={(event) => {
          event.preventDefault();
          if (isEnvSourced) return;
          saveMutation.mutate({ slackWebhookUrl: slackWebhookUrl.trim() === "" ? null : slackWebhookUrl.trim() });
        }}
      >
        <h3>Slack notifications</h3>
        <p className="page__intro">
          Posts a one-line summary to this webhook whenever a job finishes (completed, partial failure, or
          failed). Leave blank to disable.
        </p>

        <label className="form__field">
          <span>Webhook URL</span>
          <Input
            type="url"
            value={slackWebhookUrl}
            onChange={(event) => setSlackWebhookUrl(event.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            disabled={isEnvSourced}
          />
        </label>

        {isEnvSourced && (
          <p className="form__hint">
            Set via the <code>SLACK_WEBHOOK_URL</code> environment variable on this server, which takes
            precedence — unset it there to configure this here instead.
          </p>
        )}

        {saveMutation.isError && (
          <p className="form__error" role="alert">
            {saveMutation.error instanceof Error ? saveMutation.error.message : "Failed to save settings."}
          </p>
        )}

        {saveMutation.isSuccess && <p className="form__hint">Saved.</p>}

        <Button type="submit" disabled={isEnvSourced || saveMutation.isPending}>
          {saveMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </form>
    </div>
  );
}
