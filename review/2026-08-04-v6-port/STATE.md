# comb — v6.0 personal-extensions port

**Scope:** `8ec8a79..HEAD` on `feat/v6.0-personal-extensions` in `C:/ST/Rewrite-Assistant`
**Baseline:** HEAD `2d8932a`, branch `feat/v6.0-personal-extensions`, dirty: `screenshots/generating.png` (untracked, pre-existing, out of scope)
**Config:** dims = all five · cap = 12 · adversarial emphasis (user-requested) · not `--dry`

## Phase status

| Phase | Status |
|---|---|
| 0 MAP | done |
| 1 COMB | **done** — 7/7 finders returned, 23 candidates in `candidates.md`. Tier 1+2 equivalent (region generalists + 3 conditional lenses, all preconditions present). Deep tier NOT run (not `--exhaustive`) — so this is a standard-tier dry, not a clean bill of health. |
| 2 VERIFY | 4 adversarial skeptics dispatched, batched by cluster: A security/import/prompt · B concurrency/commit · C adoption/storage · D guards/build/perf/docs. 2 candidates skip skeptic review — orchestrator-confirmed with live evidence (C-R1-1 sidecar Content-Type via curl against :7860; C-RT-1 alignExact bisection reproduced against the shipped function). |
| ~~1 COMB~~ | ~~wave 1 dispatched~~ — 7 agents, standard tier, read-only: R1 shim/storage/adoption · R2 inference/LLM-output · R3 commit path · R5 build/manifest · round-trip lens · claims lens · trust-boundary lens. R4 (UI/settings) and R6 (docs) folded into the claims + trust-boundary lenses per the honest-yield note. |
| 2 VERIFY | pending |
| 3 PLAN | pending |
| GATE | pending |
| 4 FIX | pending |
| 4.5 SIGN-OFF | pending |
| 5 DOCS | pending |
| 6 REPORT | pending |

## Stack / conventions

- Vanilla ES5-style browser JS (`var`/`function`, no arrows/`const`/`let` in `extension.js`); `.mjs` tooling is modern ESM.
- No test framework. `node selfcheck.mjs` IS the suite (top-level `node:assert` + a drift-guard block grepping the shipped source). `node build.mjs` runs selfcheck first, then splices `extension.js` + `extension.css` into `rewrite-assistant.json`.
- No `package.json`, no bible/, no prior `review/` runs.
- Host: Marinara Engine 2.4.0 at `C:/ST/Marinara-Engine` (read-only reference).

## Known-decided list (do NOT re-flag the choice; bugs in the implementation are still fair game)

- `extension.js:16` — `clearTimeout`/`clearInterval` deliberately not mirrored on the shim.
- `extension.js:55` — `-p` last in `SUFFIXES` on purpose (sentinel ordering).
- `extension.js:682` — `ponytail:` CJK/no-space word-count heuristic, known ceiling.
- `extension.js:707` — `ponytail:` ~4M char-product cap on the aligner; null → caller windows or copy-falls-back.
- `extension.js:2411` — `ponytail:` 1.5s poll for chat-switch detection, no event to hook.
- `selfcheck.mjs:101` — loader keys named on purpose (v6.0 calls `removeItem` on them).
- `selfcheck.mjs:116` — `alignExact` mirror kept identical by hand (pre-existing; the *adoption* mirror was already replaced with source extraction this run).
- Already fixed and verified this session — do not re-report as new: `-p` sentinel ordering, adoption recency scoring, `Headers()` normalization, unused shim members, loader settings-group removal, over-broad drift guards.

## Region map

| # | Region | Files / lines |
|---|---|---|
| R1 | Host shim + storage + adoption | `extension.js:1-100` |
| R2 | Inference, prompt assembly, LLM-output handling | `extension.js` runInference / doRewrite / context builders |
| R3 | Commit path: render↔stored alignment, patchMessage, undo/redo, ledger | `extension.js` alignExact / windowMap / patchMessage / doUndo / doRedo |
| R4 | UI, settings, export/import, debug log | `extension.js` popup + settings panes |
| R5 | Build + check pipeline + manifest | `build.mjs`, `selfcheck.mjs`, `rewrite-assistant.json`, `extension.css` |
| R6 | Docs | `README.md`, `CHANGELOG.md` |

## Conditional lenses — precondition check

| Lens | Precondition | Decision |
|---|---|---|
| Round-trip | PRESENT — build splice/round-trip check; adoption copy; undo/redo inverse pair; settings export/import; render↔stored map/splice | RUN |
| Claims | PRESENT — README/CHANGELOG assert install + behaviour; drift guards assert code properties; manifest description asserts features | RUN |
| Trust boundary | PRESENT — consumes LLM output, `/api` responses, imported settings JSON, and localStorage written by an older version | RUN |

## Cost check (logged, not a gate)

Honest-yield note: this diff was already swept this session by a frontier whole-branch reviewer, whose findings were fixed. A generalist re-sweep has low expected yield; the value here is the three conditional lenses, none of which has ever run on this code, plus adversarial re-verification of the fixes that landed after that review.

| Phase | Agents | Tier | Rough tokens |
|---|---|---|---|
| COMB pass 1 (shrunk: R1-R3 + R5 only, R4/R6 folded into lenses) | 4 | standard | ~200k |
| COMB conditional lenses (round-trip, claims, trust-boundary) | 3 | standard | ~180k |
| VERIFY (batched by file cluster) | 3 | standard | ~150k |
| SIGN-OFF (if fixes land) | 1-2 | frontier | ~120k |
| **Total** | **~11-12** | | **~650k** |

Within the default cap of 12 and the user's ~15-agent standing guidance. No ceiling breach — proceeding without an approval ask.

## Artifacts

- `candidates.md` — raw finder output
- `verify.md` — skeptic verdicts
- `findings.md` — verified ledger (+ CHECKED-AND-CLEARED)
- `PLAN.md` — fix plan
