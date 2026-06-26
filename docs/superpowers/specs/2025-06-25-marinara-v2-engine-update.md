# Spec: Marinara Engine v2.x Compatibility Update

**Target:** Rewrite Assistant v5.1
**Date:** 2025-06-25 (revised 2026-06-26 after verification against Marinara Engine v2.0.5 source)
**Status:** approved

---

## Context

The Rewrite Assistant was built against Marinara Engine v1.6.1. The engine is now
at v2.0.5, and the extension's commit path no longer works reliably.

**What changed in the engine.** The display-layer transforms — chat macros
(`{{char}}`, `{{user}}`, …), quote formatting (straight↔curly), and markdown
rendering — are *not* new. Macros and quote formatting already shipped in v1.6.1.
What changed is *where* they apply. In v1.6.1 they ran at the prompt-assembly
layer (shaping what was sent to the model), so the API-stored `msg.content` and
the rendered DOM were the same bytes. v2.0.0's prompt-pipeline refactor moved
these transforms into the client render path; v2.0.5 is stabilization of that
refactor. The breakage trigger is the v2.0.0 refactor, not a v2.0.5 feature.

**Verified in v2.0.5 source:**

- `GET /api/chats/:id/messages` returns **raw** stored `msg.content` — no macro
  resolution, regex, or quote formatting. Those transforms live only in the
  generate/prompt paths (`applyRegexScriptsToPromptMessages`,
  `resolveMacrosWithVariableSnapshot`).
- The client renders each message as
  `formatTextQuotes(resolveMessageMacros(message.content, ctx), quoteFormat)`
  plus markdown, at display time (`ConversationMessage.tsx:266`).
- `PATCH /api/chats/:cid/messages/:mid` exists, takes `{ content: string }`,
  has no auth gate, and returns the updated message
  (`chats.routes.ts:1335`). The `apiFetch` bridge denylist only blocks
  `/extensions*` and `/admin*`, so the extension can call it.

So in v2.0 the DOM shows a *transformed* version of `msg.content`. The extension
captures selections from the rendered DOM (`range.toString()`), so matching a
rendered selection against raw `msg.content` fails whenever a macro expands, a
quote is curled, or markdown is stripped. That is the root cause of commit
failures.

**Two other breakages:**

- The `/lorebook-entries` endpoint used by the Extender memory fallback no longer
  exists in v2.0.5 (confirmed absent from the server routes). `/lorebooks/scan/:chatId`
  exists and is the replacement.
- Three hardcoded dark-theme color values in the injected stylesheet don't adapt
  to the engine's light theme.

---

## Changes

### 1. Commit path: direct API PATCH with black-box render alignment

**Root cause (verified):** the engine stores and serves raw `msg.content`; the
client renders it transformed; the extension selects from the rendered DOM.
Matching rendered-selection against raw content is the failure.

**Key insight:** the extension does not need to *reproduce* the engine's
transforms — it can *read* the engine's actual rendered output from the DOM.
`extractLocalContext` (`extension.js:343`) already does this: it reads
`msgEl.textContent` (the rendered text) and locates the selection inside it by
occurrence index. Because the selection text was captured *from* the DOM, it is
an exact substring of the rendered text — locating it needs no fuzzy matching.
The only remaining problem is mapping that rendered-space span to a raw-content
span for the PATCH splice, solved by aligning the two strings directly. No engine
logic is reimplemented, so this is immune to macro/quote/markdown/regex changes
in future engine versions.

**New `doCommit` flow:**

1. Fetch the message via the API (as today, `cachedMessages`) → `rawContent = msg.content`.
2. Read the message's rendered text from the DOM using the **same
   `.mari-message-content` blocks** that `selectionTextInMessage`
   (`extension.js:3160`) clamps the selection to — excluding the author/timestamp
   header and concatenating all blocks for this `mid` (a grouped turn can render
   several blocks under one id). `renderedFull = normalize(thatText)`. This keeps
   the rendered coordinate space identical to the captured selection *and* matched
   to raw `msg.content` (body only, no header).
3. Locate the selection in `renderedFull` exactly:
   `[rs, re) = nthIndexOf(renderedFull, savedSel.text, savedSel.occ)`, falling
   back to first occurrence. (Reuses existing `nthIndexOf`, `extension.js:507`.)
4. Char-align `renderedFull` ↔ `rawContent` and map `[rs, re)` → raw `[as, ae)`.
   Where a selection boundary lands inside a region with no raw counterpart
   (inside an expanded macro, or stripped markdown markers), snap outward to the
   nearest aligned boundary so the splice covers the whole enclosing raw token.
5. Splice: `updated = rawContent.slice(0, as) + newText + rawContent.slice(ae)`.
6. Review off → `PATCH /api/chats/:cid/messages/:mid` with `{ content: updated }`.
   Review on → hand `updated` to the extension-native review UI (§1b), which
   PATCHes on Apply.
7. On success: push undo history (`old: rawContent`, `post: updated`), invalidate
   message cache, toast.

**New helper — render↔raw alignment.** A bounded character-level alignment
(LCS / edit-script) that produces an offset map from rendered coordinates to raw
coordinates, plus a boundary-snap for spans that fall inside transform-only
regions. Guard the DP by length the way `computeWordDiff` already caps
(`extension.js:526`); for over-cap messages, fall back to anchoring on the
longest raw-stable substring around the selection. Self-contained, ~one function.

**Why no selection-time pre-fetch/snapshot (changed from the prior draft).** An
earlier draft pre-fetched `msg.content` at selection time to "match API vs API."
That was mislabeled (the selection is DOM text, so it was always DOM-vs-API) and
unnecessary: with alignment, the transform gap is bridged by reading the live
rendered DOM, not by a snapshot. The selection-to-commit race (content edited in
between) is handled as today — the selection is re-located in the *current*
rendered DOM by occurrence; if it can't be found, the existing "Could not locate"
error fires. Dropping the snapshot removes a fetch and simplifies the flow.

**Dead code removed:**

- The 4-tier fuzzy matcher in `doCommit` (exact-against-raw, whitespace-flexible,
  head-tail anchor, markdown-tolerant, `extension.js:2112–2199`). It existed to
  bridge rendered-vs-raw divergence; alignment replaces it. Exact-locate now runs
  against the *rendered* text, where the selection always matches.
- `prefillEditTextarea()`, `waitForTextarea()`, `findEditTextarea()`,
  `findSaveButton()`, `setNativeTextareaValue()`, `applyToTextarea()`.
- `rwa-msg-hl` CSS class (`extension.js:741`).
- `marinara.observe()` usage (the only consumer) and the
  `marinara:start-edit-message` dispatch (`extension.js:1324`).

**Unchanged in intent:** `cachedMessages()` / `invalidateMsgCache()`, undo/redo
stacks, history depth.

### 1a. Undo / redo

`doUndo` / `doRedo` switch to `PATCH /api/chats/:cid/messages/:mid`, restoring
`h.old` / `r.post` (raw content) directly. The undo/redo stacks and depth are
unchanged.

**Behavior change (improvement):** the current `!ok` guard and the
"Can't undo — scroll to the message first" toast (`extension.js:2240`, `2265`)
exist only because the editor path needs the message in the DOM. PATCH has no DOM
dependency, so the guard and toast are removed — undo/redo now work even when the
message is scrolled out of the virtualized list.

### 1b. Review mode (`reviewBeforeApply`) — extension-native

The native-editor path is removed, so review mode is reimplemented in the
extension's own UI. When `reviewBeforeApply` is on, `doCommit` produces `updated`
(the spliced raw content) and, instead of PATCHing immediately, shows it in an
**editable textarea** in the extension's result modal with an **Apply** button.
Apply PATCHes the textarea's *current* content, so hand-edits are honored. Review
off PATCHes directly.

The textarea shows raw source (macros/markdown unexpanded) — the same form the
native editor showed, so the review experience is equivalent. Update the
settings-row label (`extension.js:2896`, currently "Place in editor, don't save")
to match — e.g. "Review & edit before applying".

### 2. Lorebook-entries endpoint fix

**Current:** `rawScan()` (`extension.js:419`) calls
`marinara.apiFetch("/lorebook-entries?chatId=" + cid)`. This endpoint no longer
exists in v2.0.5.

**Fix:** Replace with `/lorebooks/scan/:chatId` (confirmed present in v2.0.5;
already used by `fetchLorebookEntries`). The existing Extender-lorebook filter is
kept: `fetchExtenderLorebookIds()` (`extension.js:400`, via `/lorebooks`, name
prefix "marinara extender") supplies the id set, and `fetchExtenderMemoryViaScan`
(`extension.js:427`) filters scan results by `lorebookId ∈ extIds`, then extracts
memory — downstream unchanged.

**Needs runtime verification:** the scan response's entry shape (the fields
`lorebookId`, `name`, `content` that the filter/extract rely on). Confirm against
a running v2.0.5 and adapt the field accessors if they differ. Invariant: produce
the same `<memory>…</memory>` string the live Extender API path produces.

### 3. Theme polish

Three hardcoded dark-only values replaced with theme-aware alternatives:

| Location | Current | Replacement |
|----------|---------|-------------|
| `.rwa` box-shadow | `rgba(0,0,0,.55)` | `0 12px 40px rgba(0,0,0,.15)` (lighter, works on both themes) |
| `.rwa-ov` background | `rgba(0,0,0,.72)` | `color-mix(in srgb, var(--background) 88%, var(--foreground) 12%)` |
| `.rwa-toast-ok` gradient | `linear-gradient(135deg,#10b981,#14b8a6)` | Use `var(--primary)` with brightness adjustment |

`color-mix(in srgb, …)` is already used in ~10 places in the stylesheet, so the
approach fits the existing code.

### 4. Version banner

Update file header from `v4.1` to `v5.1` and package `name` / `description` in
both `rewrite-assistant.json` and `rewrite-assistant-loader.json`.

---

## Files affected

| File | Change |
|------|--------|
| `extension.js` | Commit path rewrite (PATCH + alignment helper), undo/redo PATCH, extension-native review UI, lorebook fix, theme polish, version banner |
| `rewrite-assistant.json` | Rebuilt bundle (post-`build.mjs`) |
| `rewrite-assistant-loader.json` | Rebuilt loader (post-`build.mjs`, unchanged source) |
| `CHANGELOG.md` | v5.1 entry |
| `selfcheck.mjs` | Drop drift guards for removed editor functions; add guard(s) for the PATCH path and the alignment helper |

---

## Backward compatibility

The extension targets Marinara Engine v2.0.5+. Users on v1.6.1 who haven't
upgraded would lose the PATCH endpoint — but they also don't have the
display-layer divergence that causes the failure, so the old editor-insertion
path would have worked for them anyway.

We do not maintain dual code paths. The extension requires Marinara Engine
v2.0.5+ going forward. The loader's auto-update mechanism means existing
installations that upgrade Marinara will automatically pull the new extension
code on next reload.

---

## Testing

- `node selfcheck.mjs` — drift guards updated to match new code patterns.
- Manual: select text in a message, run a rewrite, verify it applies via PATCH.
- Manual (alignment): rewrite a selection containing a macro (`{{char}}`/`{{user}}`)
  — the splice lands in the correct raw span.
- Manual (alignment): rewrite a selection containing markdown (`*emphasis*`, a
  list item) — splice correct.
- Manual (alignment): with curly quotes enabled, rewrite a quoted passage —
  splice correct.
- Manual: undo and redo work, **including when the message is scrolled out of
  view** (new behavior).
- Manual: review mode — edit the proposed text in the extension textarea, Apply
  PATCHes the edited content.
- Manual: Extender memory fallback produces memory context via the lorebook scan
  path.
- Manual: light theme shows correct popup/overlay/toast colors.

---

## Risks

- **Alignment cost:** char-level alignment is O(n·m) in message length. Capped the
  same way `computeWordDiff` caps (`extension.js:526`); over-cap messages fall
  back to anchoring on the longest raw-stable substring around the selection.
- **Boundary inside a macro:** a selection entirely inside an expanded macro
  (e.g. selecting half of a rendered character name) has no clean raw span;
  snap-to-token widens the splice to the enclosing raw token. Rare; degrades
  gracefully rather than corrupting content.
- **Lorebook scan shape:** the `/lorebooks/scan/:chatId` response entry shape is
  unconfirmed against a live instance (see §2). Verify before release.
- **Review textarea shows raw source:** the user reviews raw macros/markdown, the
  same as the old native editor showed — equivalent, but worth noting in release
  notes.
- **PATCH response shape:** the response is not used by the extension; only
  success matters. If undo/redo ever need the returned shape, adjust then.
