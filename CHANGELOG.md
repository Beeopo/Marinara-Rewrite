# Changelog

## v5.0

A major release: two community forks folded in alongside a transparency-focused popup, per-rewrite context
control, the Marinara Extender integration, and a hardening pass.

**Credits.** Several features originated in **MrsKieu1102's** r-w-a v2-3 build and were reworked to fit here —
user-persona / voice-matching context, local model discovery, the edit-only (manual) trigger, speaker-aware
editing, and redo. The **Marinara Extender** integration (memory source + connection mode), cancellable rewrites,
the auto-update loader and build pipeline, and the splice-reliability fixes came from **TCLowe1982's**
[Marinara-Rewrite fork](https://github.com/TCLowe1982/Marinara-Rewrite) (TCLowe ported speaker-aware editing and
redo from MrsKieu1102's build). Thanks to both.

### Added

- **User-persona context** — on your own (user-authored) messages, the rewrite can include your active persona so
  edits keep your voice. Driven by the message role, not DOM guessing.
- **Token-cost panel in the popup** — per-source token estimates (selection, surrounding, persona, character,
  lorebook, previous messages) with a live total. Estimates are fetched locally and cached; no model call.
  - **Ready / pending dots** — empty while counting, green when counted.
  - **Click a dot to exclude** a source from the next rewrite (turns red); the total updates and that source is
    dropped from the prompt. Per-popup, resets on the next selection.
  - **Collapsible** via a `^` toggle (state remembered).
- **Trim-before-send flyout** — edit/trim the selected text before rewriting (single-message selections), with a
  safety hint when the edit strays from the original so the result can still be applied.
- **Movable, pinnable popup** — drag it by the bottom-corner grips; pin it to lock where it appears for subsequent
  selections.
- **Copy button** on the result — paste the rewrite manually when auto-apply can't locate the text.
- **Direct-API model discovery** — a "Discover" button lists models from the endpoint (`/api/tags`, then
  `/models`), plus one-click presets for common local servers (Ollama, LM Studio, llama.cpp, KoboldCpp, Jan,
  text-generation-webui, vLLM).
- **Manual-trigger-only mode** — selection no longer opens the popup; use `Alt+R`. Keeps normal highlight/copy.
- **Concise system-prompt toggle** — a terser system prompt for small / short-context models.
- **Search** on the Profiles and Characters lists in settings.
- **Selective export** — choose whether to include profiles, settings, custom prompts, and auto-profiles; import
  now also restores auto-profiles.
- **Hide from main UI** — a per-profile toggle that keeps the profile but removes its button from the popup.
- **Custom prompt: AI Refine** (turn a rough note into a clear instruction) and **Save as profile**.
- **Redo** — undone rewrites can be redone (Redo button in the popup footer; persisted across reloads). A fresh
  commit clears the redo timeline.
- **Cancel in-flight rewrite** — a Cancel button on the generating modal aborts the request immediately (both
  sidecar and direct/Extender modes honour the abort signal).
- **Marinara Extender connection mode** — route rewrites through a Marinara Extender sidecar instead of a
  separate Ollama/llama.cpp process, so only one model runs at a time. Configured in Settings → Connection.
- **Character memory from Extender** — pulls live character memory from the Extender's `/api/memory-block`
  endpoint (falls back to a lorebook scan tagged "marinara extender"). Toggled in Settings → Context.
- **Speaker-aware editing** — detects whether the selected passage is the author's prose or a character's voice
  and injects a `<speaker>` hint so the model edits in the right register. Toggled in Settings → Context.
- **Opt-in auto-update loader** — a companion `loader.js` bundle that fetches the latest extension on each
  Marinara load (Extender sidecar → GitHub opt-in → offline cache). Remote fetching is off by default and
  must be explicitly enabled in Settings → Connection.
- **Occurrence-targeted commit** — when a phrase appears multiple times in a message, the correct occurrence is
  identified at selection time and spliced precisely on commit.

### Changed

- **UI/UX polish pass** — refined popup spacing and padding, made the corner drag handles unobtrusive, and tidied
  the settings panels: per-section search, grouped export options, and clearer Context/Connection layout.
- Context fetching is shared and cached, so the popup's token preview and the actual rewrite use one round trip.

### Fixed

- **API key no longer leaks into exports** — exporting settings now redacts the direct-API key, matching the debug-log
  export. Existing exports made before this fix may still contain your key.
- **Rewrites can't quietly land in the wrong place** — the commit logic now tracks whether a match was actually found
  rather than inferring it from the result text, so an empty or zero-length rewrite no longer falls through to a
  different region of the message.
- **Anchor matching won't over-replace** — on repetitive prose, the fuzzy "anchor" match is rejected when it would
  span far more text than you selected, instead of silently replacing the larger region.
- **Merged multi-message rewrites verify section order** — the split back into per-message pieces now checks the
  `[[SECTION n]]` markers are numbered in sequence, not just that the count matches, and falls back to per-message
  when they aren't.
- **Rewriting non-text messages no longer errors** — messages with no text content (e.g. system/image entries) are
  handled safely instead of aborting the commit.
- **Undo no longer discards history on failure** — if the message element isn't in the DOM (scrolled away), the
  undo entry is kept rather than silently dropped so the pre-rewrite text is preserved.
- **Type-safe storage load** — `loadArr` and `loadObj` validate the parsed type before returning, preventing a
  corrupted localStorage value from reaching code that expects a specific type (e.g. `charCardIds.join`,
  history arithmetic).
- **Auto-profile overlap guard** — the per-chat in-flight flag (`_autoInFlight`) prevents two concurrent
  auto-profile generations for the same chat when the user switches quickly back and forth.
- **Wrong-textarea mid-ownership check** — before accepting a scroller-level textarea, its owning message id is
  verified so a still-closing editor from a previous message isn't mistakenly written to.
- **Surrogate-safe regex** — the `u` flag is applied to all match regexes in `doCommit` so Unicode surrogate
  pairs in emoji-heavy messages don't corrupt the match index.
- **Merge context exclusions honoured** — merge mode (`doMergeRewrite`) now routes context assembly through the
  same `fetchContextParts` path as single-message rewrites, so excluded sources (dot overrides) are respected
  and no source is silently double-sent.
- **Merge `[[SECTION n]]` regex is fresh per use** — the `MERGE_MARK_RE` constant is wrapped in `markRe()` so
  each caller gets its own `RegExp` instance, preventing stateful `lastIndex` from causing missed splits.
- **Drag-listener leak fixed** — popup drag listeners (mousemove/mouseup) are removed in `killPopup` via a
  stored cleanup function; previously they leaked if the popup was closed mid-drag.
- **Import rejects malformed profiles and config values** — the shape of each imported entry is validated;
  type mismatches are counted and reported, not silently accepted.
- **Custom prompts survive export/import** — the import validator now correctly accepts plain strings in the
  customs array (previously filtered them as objects, silently dropping all custom prompts on re-import).
- **Anchor gap tightened (ReDoS cap)** — the per-word separator in the fuzzy match is capped at `{0,8}` and
  the word list is capped at 60 to prevent the regex engine stalling on long failed selections.
- **Popup-identity guard on async context fill** — async context fetches check that the popup hasn't been
  replaced before writing results, preventing stale data appearing in a newer popup.
- **Typewriter cancels prior reveal** — opening a second result modal cancels any still-running typewriter
  animation so orphaned timer chains don't corrupt the DOM.
- **Import input cleaned up on cancel** — if the OS file picker is cancelled, the hidden `<input type=file>`
  element is removed from the document shortly after (previously leaked until page reload).
- **CJK word-count heuristic** — the word-count estimate (`wc()`) falls back to `chars/2` for CJK text that
  has few whitespace-delimited words, so length-control targets are reasonable for non-Latin prose.
- **Sort tiebreaker** — profile ordering uses `id` as a stable secondary sort key so buttons don't reorder on
  equal `order` values.

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
