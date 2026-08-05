# Changelog

## v6.1 — Marinara-connection mode

- **Added:** a new default **Model source: Marinara connection** — rewrites run
  through any chat connection you already configured in Marinara, picked from a
  dropdown in Settings → Connection. The API key stays on the Marinara server; the
  extension never sees or stores a copy.
- **Fixed:** the old default ("Local Sidecar") pointed at Marinara's *downloaded
  local model* and failed with "Sidecar model is not available" on every install
  that never downloaded one. Existing configs still carrying that default are
  migrated to the new mode once; picking the local model in Settings afterwards is
  respected and never overridden again.
- **Fixed:** errors in the new mode are labelled "Connection error" and point at
  the connection picker, instead of blaming the local sidecar.
- The selected connection id is excluded from settings export/import, like every
  other connection setting.

## v6.0 — Marinara Engine v2.4 Personal Extensions

Marinara 2.4 replaced its extension system (`extensions` → `personal-extensions`,
sandboxed by default). v5.1 does not run on it at all — it installs and then does
nothing. This release ports the extension to the new full-page runtime.

- **Breaking:** the auto-update loader is gone. `loader.js` and
  `rewrite-assistant-loader.json` are deleted. Marinara binds approval to the SHA-256
  of the stored code, so any runtime-fetched code bypasses the review gate; the
  engine also dropped `blob:` from its CSP `script-src`, which blocked the loader's
  execution path outright. Updates now mean re-import and re-approve.
- **Breaking:** installing requires two gates to be open first —
  `ENABLE_EXTERNAL_EXTENSIONS=true` on the host, and **Allow third-party extension
  imports** in Settings → Advanced → Danger Zone. See the README.
- **Fixed:** the manifest now declares `runtime: "client"` and
  `capabilities: ["full_page_access"]`. Without an explicit capabilities field the
  2.4 import path assumes the safe sandbox, where the extension runs in a Worker
  with no DOM and no `/api` access — it would install cleanly and never work.
- **Fixed:** `apiFetch`, `on`, `addStyle`, and `extensionId` were all removed from
  the host object. The first three are rebuilt as a compatibility shim, preserving
  the old `apiFetch` behaviour of resolving on 4xx/5xx so a failed write is still
  detected from the response shape rather than being reported as "Applied".
- **Fixed:** settings no longer vanish on upgrade. The storage namespace was
  derived from the engine-generated extension id, and the engine dedupes imports by
  extension *name* — but the old manifest baked the version into that name
  ("Rewrite Assistant v5.1"), so every release looked like a brand-new extension,
  got a fresh id, and stranded the previous install's profiles, history, and custom
  prompts. The namespace is now a fixed literal independent of any engine id, the
  manifest name no longer carries the version, and a first run copies a previous
  install's keys across without deleting them.
- **Fixed:** rewrites no longer corrupt formatting. Locating a selection could cut
  through a `{{macro}}` or one half of a formatting pair, leaving orphaned syntax in
  the message that could never render again — `{{char50}}` becoming `50}}`, or
  `**bold**` losing its opening marker. The aligner now refuses any splice that would
  take one delimiter without its partner, including nested formatting and
  `<speaker="…">` wrappers, rather than risking a bad write.
- **Fixed:** applying, undoing, or redoing no longer silently overwrites a message
  that changed in the meantime. Marinara's save endpoint is last-write-wins and
  several things write to messages — swipes, regenerates, automatic background
  messages — so the extension now re-reads and compares first, and asks before
  replacing newer text. A selection whose surroundings moved is refused rather than
  applied to the wrong occurrence.
- **Fixed:** connection settings no longer travel through export or import. Export
  already stripped the API key, but nothing filtered on the way in, so an imported
  file could point your rewrites at another host — and your existing key went with
  them. API key, API URL, Extender URL, and connection mode are now user-owned in
  both directions.
- **Fixed:** oversized prompts are trimmed instead of rejected. Context pieces were
  capped individually but never summed, so a large selection with everything enabled
  exceeded the engine's limit and produced an unhelpful validation error. The
  lowest-priority context is now dropped first and you are told what went.
- **Fixed:** a multi-message apply that fails partway now says which messages were
  written. Previously the chain stopped with only the failing segment's error, so
  there was no way to tell what had already committed.
- **Changed:** styles moved from the removed `marinara.addStyle` call into
  `extension.css`, shipped in the manifest's `css` field so the engine creates and
  removes the stylesheet node itself.

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
- **Changed:** the rewrite result/review modal no longer dims and blurs the whole
  screen — its backdrop is now a light scrim, so the chat stays visible behind it.
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
