# Marinara Rewrite

An extension for [Marinara Engine](https://github.com/SillyTavern/Marinara-Engine) that rewrites a selected
section of text in a message using an AI model. Select text, choose a mode, and the selection is replaced in place.

## Screenshots

| Rewrite popup | Result with diff |
| --- | --- |
| <img src="screenshots/popup.png" width="380" alt="Rewrite popup: token-cost panel, mode grid, length slider"> | <img src="screenshots/result.png" width="380" alt="Result modal with original/rewritten diff, token breakdown, and Copy"> |

![Settings — Styles](screenshots/settings-styles.png)

![Settings — Context](screenshots/settings-context.png)

![Settings — Connection](screenshots/settings-connection.png)

## Features

### Rewrite styles

- **13 built-in modes:** Expand, Compress, Add Inner Thoughts, Convert to Dialogue, Passive to Active, Use
  Different Words, Show Don't Tell, Show More Emotion, Fix Transitions, Remove LLM-isms, Expand Dialogue, Increase
  Romance, Grammar Fix.
- **Custom prompt** — a one-off instruction entered at the time of use. **AI Refine** turns a rough note
  ("bigger, longer") into a clear instruction; **Save as profile** promotes it to a permanent popup button.
- **AI Prompt Architect** — describe a style in plain language; the model produces a reusable profile.
- **Auto-profiles** — generates a profile matched to the current character's voice on chat switch, pinned at the
  top of the popup.

### The popup

- **Token-cost panel** — per-source token estimates (selection, surrounding text, persona, character, lorebook,
  previous messages, Extender memory) with a live total. Estimates are fetched locally and cached; no model call.
  - Empty dot = counting, green = counted. **Click a dot to exclude** that source from the next rewrite (turns
    red); the total updates and it is dropped from the prompt. Per-popup, resets on the next selection.
  - Collapsible (`^`), with the selection's token count shown in the header.
- **Trim before sending** — edit or trim the selected text before rewriting (single-message selections), with a
  hint when the edit strays from the original so the result can still be applied.
- **Movable and pinnable** — drag the popup by the bottom-corner grips; pin it to lock where it appears for later
  selections.
- **Copy** the result for manual paste, and a **manual-trigger-only** mode (`Alt+R`, no popup on selection).

### Context sources

- Surrounding text (configurable word count), previous messages, lorebook entries, and one or more character cards.
- **Your persona** on your own (user-authored) messages, plus **speaker-aware editing** that frames the rewrite as
  the author versus a character's voice.
- **Marinara Extender memory** — pulls a character's live memory from the
  [Marinara Extender](https://github.com/TCLowe1982/Marinara-Extender) sidecar, falling back to its persisted
  lorebook entries when the server isn't reachable.
- Any source can be excluded for a single rewrite from the popup's token panel.

### Connection

- The built-in **Marinara sidecar**, the **Marinara Extender** proxy (one local model serves rewrites and memory),
  or a **direct OpenAI-compatible API** (Ollama, LM Studio, llama.cpp, etc.).
- For direct mode: endpoint **presets** for common local servers, a **Discover models** button, optional API key,
  and a temperature control.

### Editing and applying

- **Length control** — a slider that converts the target into an explicit word-count range (small models handle
  this far better than a percentage). A **concise system-prompt** option trims tokens further for small models.
- **Multi-message rewrites** — a selection spanning several messages is rewritten one at a time, or merged into a
  single pass.
- **Large selections via the Ledger Pattern** — a selection too big for the model's context is windowed into slices
  (~1/6 of the configured context size), rewritten one at a time against a durable, resumable ledger (review,
  retry, or skip each slice), then assembled and applied in a single splice — instead of being truncated. Set the
  model's context size in Settings → Connection.
- **Undo and redo**, **cancellable** generation (aborts the in-flight request), and a **manual-save** mode that
  leaves the editor open so you confirm before committing.
- **Occurrence-targeted splice** — when the selected text appears more than once in a message, the rewrite targets
  the occurrence you selected.

### Management

- Per-profile color coding, drag-to-reorder, and **hide from the popup** (keeps the profile, removes its button).
- **Search** on the Profiles and Characters lists.
- **Selective export/import** — choose whether to include profiles, settings, custom prompts, and auto-profiles.
  Connection settings (API key, API URL, Extender URL, connection mode) never travel in either direction: an
  exported file cannot leak your key, and an imported one cannot redirect where your rewrites are sent. Set those
  by hand on each machine.
- **Debug log** — exportable record of prompts and replies for troubleshooting (API key redacted).
- All settings persist between sessions.

## Install

Marinara Engine 2.4+ keeps third-party extensions behind two gates. Open both first:

1. On the Marinara host, set `ENABLE_EXTERNAL_EXTENSIONS=true` in `.env`, then restart the server.
2. In Marinara, go to **Settings → Advanced → Danger Zone**, scroll past the data-deletion
   controls, and enable **Allow third-party extension imports**.

Then download [`rewrite-assistant.json`](rewrite-assistant.json) and import it under
**Settings → Addons → External Extensions**. Review the code, compare the displayed SHA-256
hash against the one in the approval dialog, and choose **Review and Run**.

Select text in any message, or press `Alt+R`, to open the rewrite popup.

**This extension requests Full page access,** which is not a sandbox capability — the code runs
inside Marinara's page with the same authority as anything pasted into the browser console. It
needs that: the rewrite flow reads your selection out of the rendered message DOM and commits
the result through Marinara's `/api` routes, neither of which the sandboxed runtime can reach.
Read the source before you approve it.

**There is no automatic updater any more.** Marinara binds approval to the exact hash of the
stored code, so every update needs a fresh import and a fresh approval — code fetched at runtime
would bypass the review that approval exists to enforce, and the engine's CSP now blocks that
execution path regardless.

Source lives in [`extension.js`](extension.js) and [`extension.css`](extension.css).

## Direct API configuration

By default the extension uses the Marinara sidecar. To use a local OpenAI-compatible endpoint instead:

1. Open Settings → Connection and select Direct API.
2. Set the URL (use a preset, or e.g. `http://localhost:11434/v1` for Ollama), then **Discover models** or type the
   model name. Add an API key if your server requires one.
3. Use Test Connection to verify.

When using Ollama from the browser, start it with `OLLAMA_ORIGINS=*` to permit cross-origin requests.

## Credits

This release builds on two community forks, with thanks to both authors:

- **MrsKieu1102** — their r-w-a v2-3 build seeded several features that were reworked to fit this extension:
  user-persona / voice-matching context, local model discovery, the edit-only (manual) trigger, speaker-aware
  editing, and redo.
- **TCLowe1982** — their [Marinara-Rewrite fork](https://github.com/TCLowe1982/Marinara-Rewrite) contributed the
  Marinara Extender memory source and connection mode, cancellable rewrites, the large-text Ledger Pattern
  (windowed, resumable rewrites), the auto-update loader and build pipeline, and splice-reliability fixes
  (occurrence-targeted matching, multi-paragraph anchors, and correct lorebook scan handling). TCLowe also ported
  the speaker-aware editing and redo features from MrsKieu1102's build.

## Limitations

The model generates the rewrite; the extension then has to locate your selected text inside the stored message
and splice the new text in. Most failures happen at that second step, not the generation step.

- **The selection can't be located in the stored message.** The text shown on screen does not always match what
  is stored byte-for-byte: Markdown markers (`*emphasis*`, `_italics_`, `` `code` ``), `{{macros}}`, and curly vs
  straight quotes are all applied when the message is rendered. Locating the selection is two steps: it is matched
  **exactly** against the rendered text, then that span is aligned back to stored content by character-level LCS
  diffing, with anchor-windowing for long messages. Each step reports its own error — "could not locate the
  selected text in the rendered message", and "could not map the selection back to stored content". A selection
  whose edges land inside a formatting marker or a macro refuses rather than risk a bad splice; trimming the
  selection to whole words, clear of markers, usually resolves it. The same applies to nested formatting
  (`**bold with *inner* italic**`) and to `<speaker="…">` wrappers in group chats — taking one delimiter without
  its partner would leave the other stranded in the message, so the rewrite is refused instead.
- **The message may have changed since you selected the text.** Marinara writes to messages from several places —
  swipes, regenerates, and automatic background messages — and its save endpoint is last-write-wins. Before
  applying, undoing, or redoing, the extension re-reads the message and compares it. If something else wrote to it
  in the meantime you get a prompt naming what happened, with **Cancel** as the default; nothing is overwritten
  unless you choose to. Independently, if the surrounding text moved enough that the extension can no longer be
  sure which occurrence you picked, it refuses rather than rewriting the wrong one.
- **Very large prompts get trimmed.** Marinara's inference endpoint caps the prompt, so if your selection plus all
  enabled context exceeds the budget, the lowest-priority context is dropped first (previous messages, then
  Extender memory, lorebook, character card, persona, surrounding prose) and a toast tells you what was dropped.
  Your selection is never trimmed — if it alone is over budget, the rewrite is refused with a message saying so.
- **Output quality depends entirely on the configured model.** Small local models in particular may ignore the
  length target, leak the surrounding context into the rewrite, or return commentary instead of just the passage.
- **Context costs tokens and attention.** Enabling surrounding text, previous messages, lorebook entries, Extender
  memory, and multiple character cards all at once produces a large prompt that weaker models handle poorly — use
  the popup's token panel to see the cost and exclude sources you don't need for a given rewrite.

## Troubleshooting

**A rewrite failed to apply ("Could not locate the selected text").**

- Re-select within a single paragraph. Avoid grabbing the blank line between paragraphs.
- Avoid starting or ending the selection on a formatting marker or a list bullet; select the words, not the `*`/`_`.
- Use the popup's **trim** flyout to tidy the selection before sending.
- Enable **Settings → Behaviour → Leave editor open (save manually)**. The rewrite is placed in the editor and you
  save it yourself with `Ctrl+Enter`, so you can confirm it landed before committing.
- As a fallback, use **Copy** in the result dialog and paste the rewrite in manually.

**The rewrite applied but the message didn't change / reverted.**

- The save did not register. Use the manual-save mode above and confirm with `Ctrl+Enter`.
- Use **Undo** (in the popup) to roll back, or **Redo** to re-apply; history depth is configurable in Settings.

**Output is low quality, wrong length, or includes the surrounding text.**

- Turn off context sources you don't need (in the popup token panel, or **Settings → Context**); fewer inputs help
  weaker models stay on task.
- Enable the **concise system prompt** (Settings → Behaviour) on small / short-context models.
- In Direct API mode, lower the temperature (Settings → Connection) for more faithful, less inventive edits.

**Direct API / Extender errors, or "Test connection" fails.**

- Confirm the URL, model name, and key in Settings → Connection, then use **Test Connection** or **Discover
  models**.
- For Ollama, start it with `OLLAMA_ORIGINS=*` so the browser is allowed to call it.

**Diagnosing anything else.** Enable the debug log (Settings) to capture the exact prompts and replies, then
export it. The API key is redacted from the export.

## Development

Source is `extension.js` (behavior) and `extension.css` (styles). A runnable check covers the
non-trivial logic (URL normalization, API response shaping, length-control math, prompt assembly
order, debug ring buffer, render↔stored span alignment, legacy-namespace adoption, and drift
guards):

```sh
node selfcheck.mjs
```

Build the installable bundle from source — runs selfcheck first, then splices `extension.js` and
`extension.css` into `rewrite-assistant.json`. Never hand-edit that file; `build.mjs` owns it,
manifest metadata included:

```sh
node build.mjs
```

## License

[MIT](LICENSE)
