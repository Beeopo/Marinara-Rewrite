# comb fix plan — v6.0 port

Ordering rules applied: **sequence by file** (all `extension.js` tasks run serially — one owner per file), **prioritise by risk** (correctness/security → wiring → docs). Every task carries a `modelTier`. Tiers reflect risk of silent wrongness, not diff size.

Findings are grouped into three tracks so the scope decision is yours. The run was scoped to "the updates"; **Track A is that scope.** Tracks B and C are pre-existing issues surfaced in passing.

---

## TRACK A — regressions this port introduced (recommended: fix all)

| # | Finding | Sev | File | Tier |
|---|---|---|---|---|
| A1 | **F1** restore implicit `Content-Type: application/json` in the shim | critical | `extension.js:29-40` | frontier |
| A2 | **F3 + F11** validate profile shape at the shared boundary | high | `extension.js:157` | standard |
| A3 | **F8 + F9** fix the two drift guards that cannot fail | medium | `selfcheck.mjs:85,92` | mechanical |
| A4 | **F10** distinguish `null` (failure) from `aborted` (cancel) | medium | `extension.js:1701,1997,1904` | standard |
| A5 | **F12** roll back a partial adoption copy | medium | `extension.js:97-116` | standard |
| A6 | **F17** correct the CHANGELOG's causal narrative | low | `CHANGELOG.md:25-29` | mechanical |

**A1** — one line, but `frontier` because it sits on the network path for every engine call and the failure mode is silent:
```js
if (o.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
```
Regression test: a selfcheck assertion that the shim source contains the guard, **plus** a live check against a running engine (`curl` the sidecar route both ways) recorded in the verification notes — the unit test alone cannot catch this class, which is exactly how it shipped.

**A2** — one line closes both F3 and F11:
```js
profiles = loadArr(K_PROF, DEF_PROFILES).filter(validProfileEntry);
```
`validProfileEntry` must be hoisted above `:157` (it currently lives at `:2472`). Add a selfcheck case seeding `K_PROF` with a `null` element and asserting init survives.

**A3** — `.includes(".rwa-win ")` → `.includes(".rwa-win{")`; bare `removeEventListener` → `/target\.removeEventListener\(type, handler, options\)/`. **Each fix must be proven by mutation** (delete the guarded thing, confirm the guard now fails) — that is the only evidence that means anything for a guard.

**A4** — three sites; check `resp == null` before the `resp.aborted` branch and route to the existing error path. Note the interaction: with A1 fixed, a broken sidecar returns valid JSON, so A4's hang needs a genuinely non-JSON body.

---

## TRACK B — pre-existing, data-safety (recommended: fix F2, decide the rest)

| # | Finding | Sev | File | Tier |
|---|---|---|---|---|
| B1 | **F2** demote contiguous matched *runs*, not single chars, in `alignExact` | critical | `extension.js:733-746` | frontier |
| B2 | **F5 + F6** re-check current content before any PATCH (undo/redo + review-apply) | high | `extension.js:2246-2280`, `:1444` | frontier |
| B3 | **F7** verify a context fingerprint at commit before splicing | high | `extension.js:2197-2199`, `:1914-1925` | frontier |
| B4 | **F15** aggregate partial multi-message apply results | medium | `extension.js:2029-2040` | standard |

**B1 is the one I would not ship without.** It silently corrupts stored messages and the existing suite passes over it. The fix is contained (group `mr`/`matchedRaw` into runs before demoting) but it touches the aligner, so it needs the full selfcheck span-alignment suite plus a new case built from the reproduced input.

B2 and B3 are the same root class (no optimistic-concurrency check before any PATCH) at three call sites. They are a genuine design change, not a patch — worth their own decision.

---

## TRACK C — pre-existing, security + docs (recommended: fix C1, then decide)

| # | Finding | Sev | File | Tier |
|---|---|---|---|---|
| C1 | **F4** filter connection keys on settings import + confirm before applying | high | `extension.js:2507-2521` | standard |
| C2 | **F14** neutralise closing tags in interpolated context blocks | medium | `extension.js:431,448,462,1685` | standard |
| C3 | **F13** budget the assembled prompt against the 16000-char cap | medium | `extension.js:1682` | standard |
| C4 | **F16** rewrite the README's matching-pipeline paragraph | medium | `README.md:140-144` | mechanical |
| C5 | **F18** dedupe profile ids on import | low | `extension.js:2472-2481` | mechanical |

**C1** is cheap and closes a credential-exfiltration path: skip `apiKey`/`apiUrl`/`extenderUrl`/`connMode` in the import merge, and gate any connection change behind a `confirm(...)` — the pattern already exists at `:3003` for Reset.

---

## Not in any task (dispositions recorded, no budget)

- **REFUTED:** `alignExact` row-allocation blowup (unreachable with real inputs) · committed-artifact git growth (4.1MB, and the bundle must be committed).
- **DROPPED as non-defect:** build round-trip not covering manifest fields — fixing it would add code that cannot fail.
- **OUT OF SCOPE:** no CI enforcing bundle-matches-source — real, but a process gap. Recommend a follow-up issue.
- **DEFERRED:** reclaim removing `rwa-loader-allow-remote` — fail-safe reset, no action.

## ID coverage check

CONFIRMED findings F1-F18 → every id appears in exactly one task above (F3+F11 → A2, F8+F9 → A3, F5+F6 → B2 by design). F-defer-1 carries an explicit deferral row. **No finding is unaccounted for.**

## Gates

- Per task: `node selfcheck.mjs` green **and** `node build.mjs` green, tree clean, committed before the next task starts.
- Risk classes stay in separate commits — no data-safety fix rides with a doc edit.
- A1 and B1 additionally require live verification against the running engine on :7860, not just a green suite. Both are classes where a green suite already lied once this session.
- SIGN-OFF: every `frontier` task gets its own adversarial skeptic over the diff before the run closes.
