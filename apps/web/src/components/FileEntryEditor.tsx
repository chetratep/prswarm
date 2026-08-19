import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import type {
  FetchContentRequest,
  FetchContentResponse,
  WriteMode,
} from "@bulk-github-update-tool/shared-types";
import { apiPost } from "../api/client";
import { languageExtensionsForPath, placeholderForPath } from "../lib/contentLanguage";
import { IconChevronDown, IconChevronUp, IconTrash } from "./icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const contentPlaceholder = useMemo(() => placeholderForPath(value.filePath), [value.filePath]);
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
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onMoveUp(index)}
            disabled={!canMoveUp}
            aria-label={`Move file ${index + 1} up`}
          >
            <IconChevronUp size={15} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onMoveDown(index)}
            disabled={!canMoveDown}
            aria-label={`Move file ${index + 1} down`}
          >
            <IconChevronDown size={15} />
          </Button>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="file-entry__remove"
          onClick={() => onRemove(index)}
          disabled={!canRemove}
        >
          <IconTrash size={14} />
          Remove
        </Button>
      </div>

      <label className="form__field">
        <span>
          File path <span className="required-mark" aria-hidden="true">*</span>
        </span>
        <Input
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
        <Select
          value={value.mode}
          onValueChange={(v) => onChange(index, { ...value, mode: v as WriteMode })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CREATE_ONLY">Create only</SelectItem>
            <SelectItem value="OVERWRITE">Overwrite</SelectItem>
            <SelectItem value="UPSERT">Upsert</SelectItem>
          </SelectContent>
        </Select>
      </label>

      <div className="form__field">
        <span>
          Content <span className="required-mark" aria-hidden="true">*</span>
        </span>

        <div className="content-fetch-row">
          <Input
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="Or paste a raw file URL to fetch it — e.g. a GitHub raw link"
            className="content-fetch-row__input"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleFetchContent}
            disabled={sourceUrl.trim() === "" || fetchContentMutation.isPending}
          >
            {fetchContentMutation.isPending ? "Fetching…" : "Fetch"}
          </Button>
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
          placeholder={contentPlaceholder}
          className="content-editor"
        />
      </div>
    </div>
  );
}
