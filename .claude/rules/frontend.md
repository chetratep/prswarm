---
paths:
  - "apps/web/src/**/*.tsx"
  - "apps/web/src/**/*.ts"
---

# Frontend conventions

## Content editor

The Define page's file content field is `@uiw/react-codemirror` (CodeMirror 6 — the same engine GitHub's own web file editor uses), language-detected off the file path extension (`yml`/`yaml`, `json`, `md`; anything else falls back to plain text). It's lazy-loaded via `React.lazy` + `Suspense` in `App.tsx` — CodeMirror + language packages roughly quadruple the JS bundle, so splitting it into its own chunk keeps every other page's bundle size unaffected and only pays that cost once someone reaches Define. Don't import it eagerly.

**Known tooling limitation**: CodeMirror's editing model doesn't cooperate with programmatic/scripted typing in this environment's browser automation. Don't rely on driving it via automated UI interaction for verification — verify editor-adjacent logic (rendering, template detection, per-repo values) at the API/data level instead, and treat a source-code review of the editor wiring itself as sufficient rather than forcing a flaky UI click-through.

## Multi-file editing (Define page)

`FileEntryEditor` rows in `DefinePage.tsx` are a repeatable list: starts at one entry, minimum of one (Remove is disabled at that floor), "+ Add another file" appends, per-row up/down buttons reorder by swapping `orderIndex`. Each row owns its own CodeMirror instance and its own fetch-from-URL control — template variables are a union across every file's content, not just one file's.

## Selection persistence

`SelectionContext` lives above the currently-browsed org, so picks already persist across org switches on their own — if selection appears to "reset" when switching orgs, the bug is almost always that the UI isn't *showing* the persisted selection, not that it was lost. The `.selection-summary` panel on `SelectPage` (grouped by owner, removable per-repo chips) exists specifically to make the persisted state visible regardless of which org's repo list is currently showing.

## Form validation feedback

Don't let a submit button look enabled while validation silently blocks it (e.g. an HTML `required` attribute the JS-side `canSubmit` check forgot to account for). Every required field should be marked, and a live checklist of what's still missing is preferred over a plain disabled button with no explanation.
