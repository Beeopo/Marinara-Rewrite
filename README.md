# Marinara Rewrite

An extension for [Marinara Engine](https://github.com/SillyTavern/Marinara-Engine) that rewrites a selected
section of text in a message using an AI model. Select text, choose a mode, and the selection is replaced in place.

## Features

- **13 built-in rewrite modes:** Expand, Compress, Add Inner Thoughts, Convert to Dialogue, Passive to Active,
  Use Different Words, Show Don't Tell, Show More Emotion, Fix Transitions, Remove LLM-isms, Expand Dialogue,
  Increase Romance, Grammar Fix.
- **Custom prompt:** one-off rewrite instruction entered at the time of use.
- **AI Prompt Architect:** describe a style in plain language; the model produces a reusable profile.
- **Auto-profiles:** generates a profile matched to the current character's voice on chat switch, shown at the top
  of the popup.
- **Length control:** a slider (with on/off toggle) that converts the target into an explicit word-count range.
- **Context sources:** optionally include surrounding text, previous messages, lorebook entries, and one or more
  character cards in the request.
- **Multi-message rewrites:** a selection spanning multiple messages is rewritten one message at a time, or merged
  into a single pass.
- **Connection modes:** the built-in Marinara sidecar, or a direct OpenAI-compatible API (Ollama, llama.cpp, etc.).
- **Configuration:** per-profile color coding, grid size, auto-apply, history depth, and export/import of profiles
  and settings. All settings persist between sessions.

## Install

1. Download [`rewrite-assistant.json`](rewrite-assistant.json).
2. In Marinara Engine, open the Extensions panel and import the file.
3. Enable the extension. Select text in any message, or press `Alt+R`, to open the rewrite popup.

`rewrite-assistant.json` is the installable bundle and contains the extension code. The unbundled source is in
[`extension.js`](extension.js).

## Direct API configuration

By default the extension uses the Marinara sidecar. To use a local OpenAI-compatible endpoint instead:

1. Open Settings → Connection and select Direct API.
2. Set the URL (for example `http://127.0.0.1:11434/v1` for Ollama), the model name, and an API key if required.
3. Use Test Connection to verify.

When using Ollama from the browser, start it with `OLLAMA_ORIGINS=*` to permit cross-origin requests.

## Limitations

The model generates the rewrite; the extension then has to locate your selected text inside the stored message
and splice the new text in. Most failures happen at that second step, not the generation step.

- **The selection can't be located in the stored message.** The text shown on screen does not always match what
  is stored byte-for-byte: Markdown markers (`*emphasis*`, `_italics_`, `` `code` ``), list bullets, and the blank
  lines between paragraphs are common sources of mismatch. The extension tries four matching passes (exact, then
  whitespace-flexible, then first/last-word anchors, then a Markdown-tolerant word match) before giving up, but a
  selection that straddles formatting boundaries can still miss.
- **Large or multi-paragraph selections fail more often.** A bigger span has more opportunities to mismatch, and
  the anchor/fuzzy fallbacks are deliberately bounded to avoid matching the wrong region.
- **Output quality depends entirely on the configured model.** Small local models in particular may ignore the
  length target, leak the surrounding context into the rewrite, or return commentary instead of just the passage.
- **Context costs tokens and attention.** Enabling surrounding text, previous messages, lorebook entries, and
  multiple character cards all at once produces a large prompt that weaker models handle poorly.

## Troubleshooting

**A rewrite failed to apply ("Could not locate the selected text").**

- Re-select within a single paragraph. Avoid grabbing the blank line between paragraphs.
- Avoid starting or ending the selection on a formatting marker or a list bullet; select the words, not the `*`/`_`.
- Try a smaller range. Long selections miss more often than short ones.
- Enable **Settings → Behaviour → Leave editor open (save manually)**. The rewrite is placed in the editor and you
  save it yourself with `Ctrl+Enter`, so you can confirm it landed before committing.

**The rewrite applied but the message didn't change / reverted.**

- The save did not register. Use the manual-save mode above and confirm with `Ctrl+Enter`.
- Use **Undo** (in the popup) to roll back; history depth is configurable in Settings.

**Output is low quality, wrong length, or includes the surrounding text.**

- Turn off context sources you don't need (**Settings → Context**); fewer inputs help weaker models stay on task.
- In Direct API mode, lower the temperature (Settings → Connection) for more faithful, less inventive edits.
- The length control sends an explicit word-count range; if the model still ignores it, disable the length toggle
  and rely on the mode's own instruction.

**Direct API errors / "Test connection" fails.**

- Confirm the URL, model name, and key in Settings → Connection, then use **Test Connection**.
- For Ollama, start it with `OLLAMA_ORIGINS=*` so the browser is allowed to call it.

**Diagnosing anything else.** Enable the debug log (Settings) to capture the exact prompts and replies, then
export it. The API key is redacted from the export.

## Development

Source: `extension.js`. A runnable check covers the non-trivial logic (URL normalization, API response shaping,
length-control math, prompt assembly order, debug ring buffer):

```sh
node selfcheck.mjs
```

## License

[MIT](LICENSE)
