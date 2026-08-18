import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import type {
  FetchContentRequest,
  FetchContentResponse,
  WriteMode,
} from "@bulk-github-update-tool/shared-types";
import { apiPost } from "../api/client";
import { languageExtensionsForPath } from "../lib/contentLanguage";

export interface FileEntryValue {
  filePath: string;
  mode: WriteMode;
  content: string;
}

interface FileEntryEditorProps {
  index: number;
  value: FileEntryValue;
  canRemove: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (index: number, value: FileEntryValue) => void;
  onRemove: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}

/** One file's path/mode/content editor within DefinePage's repeatable file
 * list. Its own component (not inlined in a .map()) specifically so
 * `useMemo` can be called per-row — each row needs its own memoized
 * CodeMirror `extensions` array keyed on its own file path, the same fix
 * that resolved this editor's original cursor-focus bug: an inline array
 * recreated every render forces CodeMirror to tear down and reconfigure
 * its EditorState on every keystroke. The fetch-from-URL row is per-file
 * too, for the same reason each row has its own editor. */
export function FileEntryEditor({
  index,
  value,
  canRemove,
  canMoveUp,
  canMoveDown,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: FileEntryEditorProps) {
  const contentExtensions = useMemo(() => languageExtensionsForPath(value.filePath), [value.filePath]);
  const [sourceUrl, setSourceUrl] = useState("");

  const fetchContentMutation = useMutation({
    mutationFn: () =>
      apiPost<FetchContentResponse>("/api/fetch-content", { url: sourceUrl } satisfies FetchContentRequest),
    onSuccess: (res) => onChange(index, { ...value, content: res.content }),
  });

  function handleFetchContent() {
    if (sourceUrl.trim() === "" || fetchContentMutation.isPending) return;
    fetchContentMutation.mutate();
  }

  return (
    <div className="file-entry">
      <div className="file-entry__header">
        <span className="file-entry__index">File {index + 1}</span>
        <div className="file-entry__reorder">
          <button
            type="button"
            className="button-link"
            onClick={() => onMoveUp(index)}
            disabled={!canMoveUp}
            aria-label={`Move file ${index + 1} up`}
          >
            ▲
          </button>
          <button
            type="button"
            className="button-link"
            onClick={() => onMoveDown(index)}
            disabled={!canMoveDown}
            aria-label={`Move file ${index + 1} down`}
          >
            ▼
          </button>
        </div>
        <button
          type="button"
          className="button button--secondary file-entry__remove"
          onClick={() => onRemove(index)}
          disabled={!canRemove}
        >
          Remove
        </button>
      </div>

      <label className="form__field">
        <span>
          File path <span className="required-mark" aria-hidden="true">*</span>
        </span>
        <input
          type="text"
          value={value.filePath}
          onChange={(event) => onChange(index, { ...value, filePath: event.target.value })}
          placeholder=".github/workflows/pr-review.yml"
          required
        />
      </label>

      <label className="form__field">
        <span>
          Mode <span className="optional-mark">(optional — defaults to Upsert)</span>
        </span>
        <select
          value={value.mode}
          onChange={(event) => onChange(index, { ...value, mode: event.target.value as WriteMode })}
        >
          <option value="CREATE_ONLY">Create only</option>
          <option value="OVERWRITE">Overwrite</option>
          <option value="UPSERT">Upsert</option>
        </select>
      </label>

      <div className="form__field">
        <span>
          Content <span className="required-mark" aria-hidden="true">*</span>
        </span>

        <div className="content-fetch-row">
          <input
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="Or paste a raw file URL to fetch it — e.g. a GitHub raw link"
            className="content-fetch-row__input"
          />
          <button
            type="button"
            className="button button--secondary"
            onClick={handleFetchContent}
            disabled={sourceUrl.trim() === "" || fetchContentMutation.isPending}
          >
            {fetchContentMutation.isPending ? "Fetching…" : "Fetch"}
          </button>
        </div>
        {fetchContentMutation.isError && (
          <p className="form__error" role="alert">
            {fetchContentMutation.error instanceof Error
              ? fetchContentMutation.error.message
              : "Failed to fetch that URL."}
          </p>
        )}

        <CodeMirror
          value={value.content}
          onChange={(content) => onChange(index, { ...value, content })}
          extensions={contentExtensions}
          height="240px"
          placeholder={"name: PR review\non:\n  pull_request:\n    types: [opened, synchronize]\n"}
          className="content-editor"
        />
      </div>
    </div>
  );
}
