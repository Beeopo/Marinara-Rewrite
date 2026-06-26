# Spec: Marinara Engine v2.x Compatibility Update

**Target:** Rewrite Assistant v5.1
**Date:** 2025-06-25
**Status:** approved

---

## Context

The Rewrite Assistant was built against Marinara Engine v1.6.1. The engine has
since advanced to v2.0.5, introducing display-layer transformations (chat macros,
regex post-processing, quote formatting) that cause the DOM-rendered text to
diverge from the API-stored `msg.content`. The extension's commit path relied on
matching DOM-selected text against stored content — a strategy that now
consistently fails.

Additionally, the `/lorebook-entries` API endpoint used by the Extender memory
fallback no longer exists.

Three hardcoded dark-theme color values in the injected stylesheet don't adapt
to the engine's light theme.

---

## Changes

### 1. Commit path: replace editor insertion with direct API PATCH

**Current flow (`doCommit`):**

1. Fetch messages via `GET /api/chats/:cid/messages`
2. Match DOM-selected text against `msg.content` using 4-tier fallback (exact,
   whitespace-flexible, head-tail anchor, markdown-tolerant)
3. On match: dispatch `marinara:start-edit-message` to open inline editor
4. Observe DOM for textarea (`marinara.observe`), fill via native setter, click
   Save or send Ctrl+Enter

**New flow:**

1. At selection time (popup open), pre-fetch `msg.content` from the API and
   store it on the `sel` object alongside the DOM selection text and mid
2. At commit time, fetch messages via API (same as today)
3. Match DOM-selected text against **the cached stored content** from step 1
   (API vs API — no display-layer divergence). The same 4-tier matching
   strategies remain.
4. On match: `PATCH /api/chats/:cid/messages/:mid` with
   `{ content: splicedContent }`
5. Update undo history, invalidate message cache, show toast

**Why pre-fetch at selection time:** The message content can change between
selection (popup opens) and commit (rewrite completes). Storing a snapshot at
selection time ensures the splice targets the same content the user selected
from.

**Dead code removed:**
- `prefillEditTextarea()` — dispatches event, waits for textarea
- `waitForTextarea()` — MutationObserver + 3s timeout
- `findEditTextarea()` — textarea location logic
- `findSaveButton()` — save button location logic
- `setNativeTextareaValue()` — React bypass hack
- `applyToTextarea()` — fill + save orchestration
- `rwa-msg-hl` CSS class
- `marinara.observe()` usage (the only consumer)
- `marinara:start-edit-message` dispatch

**Unchanged:**
- `doUndo()` and `doRedo()` get the same PATCH treatment as the main commit
  path. Their current implementation calls `prefillEditTextarea` which is
  removed; they will use `PATCH /api/chats/:cid/messages/:mid` to restore old
  content directly. The undo/redo stacks and history depth are unchanged.
- `cfg.reviewBeforeApply` mode is unaffected — the PATCH writes to the DB, the
  inline editor opens normally and the user reviews/saves manually.
- All 4 matching strategies (exact, whitespace, head-tail, markdown-tolerant)
  remain as-is — they were already robust; the failure was the DOM-vs-stored
  text divergence, not the matching logic.
- `cachedMessages()`, `invalidateMsgCache()`, undo/redo stacks, history depth.

### 2. Lorebook-entries endpoint fix

**Current:** `rawScan()` calls `marinara.apiFetch("/lorebook-entries?chatId=" + cid)`.
This endpoint no longer exists in the engine.

**Fix:** Replace with a scan against the current API. The function's purpose is
to find lorebook entries belonging to Extender lorebooks for a given chat, so
it can extract memory content as a fallback when the Extender sidecar is
unreachable. Use the existing `/lorebooks/scan/:chatId` endpoint, filtering
the results for Extender-lorebook entries client-side, then calling
`/lorebooks/:id/entries` for those lorebooks.

Alternative (simpler): use `/lorebooks/scan/:chatId` which already returns
entries for the chat. Filter results by lorebook name matching
"marinara extender" prefix, as `fetchExtenderLorebookIds` already does.

The exact replacement path will be determined during implementation based on
response shape compatibility. The principle is: the fallback must produce the
same `<memory>...</memory>` string as the live Extender API path.

### 3. Theme polish

Three hardcoded dark-only values replaced with theme-aware alternatives:

| Location | Current | Replacement |
|----------|---------|-------------|
| `.rwa` box-shadow | `rgba(0,0,0,.55)` | `0 12px 40px rgba(0,0,0,.15)` (lighter, works on both themes) |
| `.rwa-ov` background | `rgba(0,0,0,.72)` | `color-mix(in srgb, var(--background) 88%, var(--foreground) 12%)` |
| `.rwa-toast-ok` gradient | `linear-gradient(135deg,#10b981,#14b8a6)` | Use `var(--primary)` with brightness adjustment |

### 4. Version banner

Update file header from `v4.1` to `v5.1` and package `name` / `description` in
both `rewrite-assistant.json` and `rewrite-assistant-loader.json`.

---

## Files affected

| File | Change |
|------|--------|
| `extension.js` | Commit path rewrite, lorebook fix, theme polish, version banner |
| `rewrite-assistant.json` | Rebuilt bundle (post-`build.mjs`) |
| `rewrite-assistant-loader.json` | Rebuilt loader (post-`build.mjs`, unchanged source) |
| `CHANGELOG.md` | v5.1 entry |
| `selfcheck.mjs` | Drift guards updated for removed/added code patterns |

---

## Backward compatibility

The extension targets Marinara Engine v2.0.5+. Users on v1.6.1 who haven't
upgraded will lose the PATCH endpoint — but they also don't have the
display-layer divergence that causes the failure, so the old editor-insertion
path would still work for them.

We do not maintain dual code paths. The extension requires Marinara Engine
v2.0.5+ going forward. The loader's auto-update mechanism means existing
installations that upgrade Marinara will automatically pull the new extension
code on next reload.

---

## Testing

- `node selfcheck.mjs` — update drift guards to match new code patterns
- Manual test: select text in a message, run a rewrite, verify it applies
- Manual test: select text in a message with macros/regex enabled, verify match
- Manual test: undo and redo still work
- Manual test: `cfg.reviewBeforeApply` mode still works
- Manual test: Extender memory fallback produces memory context
- Manual test: light theme shows correct popup/overlay colors

---

## Risks

- **API response shape:** The PATCH endpoint returns the updated message. If the
  returned shape differs from expectations, undo/redo stacks need adjustment.
  Mitigation: the response is not currently used by the extension; only success
  matters.
- **PATCH permission:** The engine requires no special auth for message edits.
  Confirmed: extensions can call this endpoint via `apiFetch`.
- **Selection-timing race:** If the stored message content changes between
  selection-capture and commit (another client edits it), the match may fail
  even with the pre-fetch. Mitigation: the 4-tier matcher is tolerant enough
  to handle minor edits; catastrophic changes show the existing "Could not
  locate" error.
