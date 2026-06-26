# Changelog

## v5.1 — Marinara Engine v2.x compatibility

- **Fixed:** rewrites now commit reliably on Marinara v2.0.5+. The engine moved
  macro/quote/markdown transforms into the render path (v2.0.0 refactor), so the
  rendered DOM no longer matches stored content. The extension now commits via the
  message API (`PATCH`), locating the selection in the engine's rendered output and
  aligning it back to stored content for the splice — no editor automation.
- **Fixed:** rewrites in long messages now apply instead of falling back to manual
  copy/paste. The render↔stored alignment is now windowed around the selection, so a
  full-length roleplay reply (the exact alignment cost previously blew a size cap at
  ~2,000 characters) maps and splices correctly without scanning the whole message.
  Large *selections* (a whole paragraph, ≳2,000 characters) are handled too: their
  two cut points are mapped independently, since the selected span is replaced wholesale
  and only its boundaries need locating.
- **Fixed:** the edited message now updates on screen immediately after applying
  (the API-commit path refreshes the engine's chat view; previously a direct write
  left the displayed text stale until you switched chats or reloaded).
- **Changed:** undo/redo use the API and work even when the message is scrolled
  out of view.
- **Changed:** "Review before applying" now opens an editable preview in the
  extension (the native editor is no longer driven).
- **Fixed:** Extender memory fallback uses `/lorebooks/scan/:chatId`
  (`/lorebook-entries` was removed in v2.x).
- **Fixed:** popup shadow, overlay, and success toast adapt to light themes.
- **Note:** requires Marinara Engine v2.0.5 or newer.

## v5.0

Major release. A new popup with live token costs and per-rewrite context control, the Marinara Extender
integration, large-text rewrites, and a broad reliability pass. Two community forks were folded in — grouped by
source below so it's clear what came from where.

### Added — new in this release

- **Token-cost panel** in the popup: per-source estimates (selection, surrounding, persona, character, lorebook,
  previous messages) and a live total, fetched locally and cached. Collapsible, and **click a dot to exclude** any
  source from the next rewrite.
- **Trim-before-send** flyout, a **movable / pinnable** popup, and a **Copy** button on results.
- **Custom prompt**: **AI Refine** (turn a rough note into a clear instruction) and **Save as profile**.
- **Search** on Profiles and Characters, **selective export** (choose profiles / settings / custom prompts /
  auto-profiles), and **hide a profile** from the popup.
- **Concise system-prompt** toggle for small models.

### Added — from MrsKieu1102's r-w-a v2-3 fork

- **User-persona / voice-matching context** — include your active persona when rewriting your own messages.
- **Local model discovery** — list models from a direct endpoint (also added endpoint presets).
- **Edit-only (manual) trigger** — selection no longer opens the popup; use `Alt+R`.
- **Language lock** — system prompt now keeps the original's language (never translates) and preserves markdown
  wrappers (`*…*`, quotes) only when present.

### Added — from TCLowe1982's Marinara-Rewrite fork

- **Marinara Extender** connection mode + **character-memory** context source.
- **Large-text Ledger Pattern** — selections too big for the model context are windowed into resumable slices
  (review / retry / skip each), then assembled and applied in one splice, instead of being truncated.
- **Cancellable rewrites** — Cancel aborts the in-flight request.
- **Speaker-aware editing** and **Redo** — *(TCLowe ported these from MrsKieu1102's fork.)*
- **Auto-update loader** + a build pipeline (`build.mjs`, `loader.js`).
- **Splice-reliability fixes** — occurrence-targeted commit, multi-paragraph anchors, and correct lorebook scan
  handling.

### Changed

- **UI/UX polish** — tighter popup spacing and padding, unobtrusive corner drag handles, and reorganised settings
  (per-section search, grouped export options, clearer Context / Connection layout).
- Context fetching is shared and cached, so the popup's token preview and the actual rewrite use one round trip.

### Fixed

- A reliability pass on top of the fork fixes: safer splice matching (no wrong-region or over-replacement,
  surrogate-safe, ReDoS-capped), type-safe storage and stricter import validation, the API key redacted from
  exports, and assorted popup, merge, and undo edge cases.

## v4

Most of the work went into reliability and giving the model more to work with, plus a couple of bigger features.

### Added

- **Direct API mode** — point it at your own OpenAI-compatible endpoint (Ollama, llama.cpp, etc.) with a
  configurable URL, model, key, and temperature, plus a "Test connection" button. Previously it could only use the
  built-in Marinara sidecar.
- **Context-aware rewrites** — optionally include surrounding prose (configurable word count per side), previous
  messages, and lorebook entries so rewrites fit the flow.
- **Multiple character cards** as context, not just the first character in the chat.
- **Auto-profiles** — generates a rewrite profile tuned to the current character's voice on chat switch, pinned at
  the top of the popup and manageable in settings.
- **Multi-message rewrites** — selections spanning several messages are handled one at a time (accept/skip each),
  or merged into a single pass.
- **Export / import** of profiles, settings, and custom prompts, plus a "reset to defaults."
- **Manual-save mode** — leave the editor open and save yourself instead of auto-applying.
- **Debug log** — exportable record of prompts/replies for troubleshooting (API key redacted).

### Changed

- **Length control** now converts the target percentage into an explicit word-count range, which small local
  models handle far better than a vague percentage.
- Built-in prompts rewritten to be terser and more imperative, with shared rules moved into the system prompt. A
  version migration auto-upgrades built-in profiles while preserving your custom ones, ordering, and colors.
- Settings reorganized into tabs (Profiles, Connection, Behaviour, Context, Auto-Profile, Characters, History,
  Backup & Reset), and the UI restyled to match the app.
- Config now merges new defaults over saved settings, so updates don't leave existing users missing new options.

### Fixed

- **Saves now stick reliably** — the editor's text is updated in a way the app actually registers, fixing rewrites
  that silently didn't commit.
- More robust at opening the correct editor across different message types, and at locating your selected text
  (added a markdown-tolerant fuzzy match) — fewer "re-select and retry" failures.
- Undo and history no longer record broken entries when a rewrite fails to apply.
- Removed the old "replace whole message" path that could overwrite more than intended.
- Guards against localStorage quota errors and runaway diffs on very long selections.

## v3 (initial release)

- Highlight-to-rewrite with 13 built-in modes, custom prompt, AI prompt architect.
- Length slider with toggle, per-profile color coding, auto-apply, configurable grid and history depth.
- Optional character-card context. Persistent settings.
