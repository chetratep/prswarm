// Maps a file path's extension to a CodeMirror language extension for the
// Define page's content editor. Deliberately small — this tool's overwhelming
// common case is workflow/config YAML, with JSON and Markdown as the next
// most likely. Anything else falls back to plain text (still gets line
// numbers, selection, etc. — just no syntax-specific highlighting).
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import type { Extension } from "@uiw/react-codemirror";

export function languageExtensionsForPath(filePath: string): Extension[] {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "yml":
    case "yaml":
      return [yaml()];
    case "json":
      return [json()];
    case "md":
    case "markdown":
      return [markdown()];
    default:
      return [];
  }
}
