# Changelog

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
