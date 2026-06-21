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

- Rewrites are not guaranteed to apply on every attempt. If one fails, re-select a slightly different range and
  retry. Large or heavily formatted selections fail more often.
- Output quality depends on the configured model.

## Development

Source: `extension.js`. A runnable check covers the non-trivial logic (URL normalization, API response shaping,
length-control math, prompt assembly order, debug ring buffer):

```sh
node selfcheck.mjs
```

## License

[MIT](LICENSE)
