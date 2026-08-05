# comb — final report

**Scope:** the v6.0 Marinara-2.4 port, `8ec8a79..HEAD` on `feat/v6.0-personal-extensions`.
**Run:** 2026-08-04/05 · 24 agents · adversarial emphasis (user-requested) · Tracks A+B+C all approved at the gate.

---

## Counts, reconciled

| | |
|---|---|
| **Found** | 23 candidates (7 finders: 4 region generalists + 3 conditional lenses) |
| **Verified** | 18 CONFIRMED · 2 REFUTED · 3 dropped (non-defect / out-of-scope / defer) |
| **Fixed** | 18 of 18 CONFIRMED |
| **Deferred** | 1 (`rwa-loader-allow-remote` reclaim — fail-safe reset, no action) |
| **Found by sign-off, after the fixes** | **12 further defects**, all in code that had passed a green suite |

`found = verified + refuted` → 23 = 18 + 2 + 3 ✓
`verified = fixed + deferred` → 18 = 18 + 0 ✓ (the deferral was a DROPPED item, not a CONFIRMED one)

Every candidate in `candidates.md` carries a disposition in `findings.md`. No silent drops.

## Build / test

- `node selfcheck.mjs` — **green, 17 sections** (was 5 at the start of the run).
- `node build.mjs` — green; the bundle is in sync and now *guarded* to stay so.
- Strict-mode parse inside the engine's async-arrow wrapper — OK.
- Line endings CRLF-clean (a mid-run normalization accident desynced the shipped artifact; caught by the guard added for exactly that, then restored).

## Live verification — done, on `:7999`

The engine died mid-run on `:7860` and was restarted on `:7999`. The current build was re-imported and re-approved; **the code change cleared `approvedHash` and disabled the extension, which independently confirms a README claim** previously only read from engine source.

| Property | Result |
|---|---|
| Rewrite round-trip | `*softly*` → `*MOCKREWRITE_OK*` |
| Formatting preserved | `*…*` markers and `{{char}}` intact |
| Occurrence targeting | **2nd** occurrence rewritten, 1st untouched |
| Concurrent-edit guard | real concurrent write → confirm modal, **not overwritten** |
| Cancel path | stored content unchanged, history preserved |

Cleanup: throwaway chat deleted, the user's three chats untouched, connection config restored, mock LLM stopped.

## Sign-off — two rounds, and both earned their cost

**Round 1** (3 skeptics) found defects in all three groups:
- **B1's fix was outright wrong.** Parity counting let the same corruption through the delimiter it guarded (`**bold**` + select `"ld text"` → `"**boX"`), covered 4 of ~10 constructs the engine strips, and refused on transform-free prose.
- **No guard read the shipped artifact** — and it had genuinely drifted.
- Empty-profile resurrection · an abort-race that would turn cancels into error dialogs · two guards pinning the condition rather than the effect (one of which, if swapped, would export the API key in plaintext).

**Round 2** (3 skeptics) found 7 more, including the run's most important finding:
- **The aligner's 20 pinned cases tested a hand-copied mirror, not the shipped function.** Gutting the real `spanIsBalanced` to `return true` left the whole suite green while the extension produced `**boX`. A claim made in a commit message — "proven to fail if the rule reverts to counting" — was true of the mirror and false of the artifact.
- With the real function under test: **nested pairs never registered** (`/g/` scan leaves `lastIndex` past the close; the engine recurses emphasis six deep and wraps group chats in `<speaker="…">`, so every inner tag is nested), and **`windowMap` validated a window slice**, leaving attempt 1's headline bug live in exactly the large messages windowing exists for.
- `guardedPatch` **wrote blind whenever the re-read resolved non-array** — which, because `apiFetch` resolves on 4xx/5xx, is the normal shape of a failed GET. The guard disabled itself precisely when the engine is unhealthy.
- A declined overwrite stalled the merge chain; `reviewThenPatch` had **three** non-write exits and only two got fixed on the first pass.
- The adoption rollback **deleted pre-existing values** instead of restoring them — worse than the staleness it guarded.

Nothing found by sign-off was waved through; every item re-entered FIX.

## Bugs found that were never in the ledger

Two real defects surfaced only by *touching* the code, not by auditing it:

1. **`applyMerged` passed no occurrence index**, so every segment of a multi-message rewrite spliced at occurrence 0 rather than the one selected. 23 candidates, three conditional lenses and four skeptics all walked past it; it appeared when B3's fingerprint had to be threaded through that path.
2. **A test's mock had no `removeItem`**, so the rollback it claimed to exercise was swallowed by its own try/catch.

## The pattern this run kept finding

Six separate instances of **a check that cannot fail**:

| | |
|---|---|
| `.rwa-win ` | trailing space matched only the scrollbar rules |
| `removeEventListener` | matched three unrelated call sites |
| Content-Type guard | pinned the condition; scoping the set to `PATCH` kept the substring verbatim |
| `CONN_KEYS` guards | didn't pin direction; swapping them exported the API key |
| bundle sync | nothing read the artifact users install |
| aligner suite | tested a mirror, not the shipped function |

And three of **a fix applied to the obvious call site while a sibling stayed broken** (`spanIsBalanced` call sites, `reviewThenPatch`'s three exits, the merge path's missing `occ`).

## Lenses

Ran: **round-trip**, **claims**, **trust-boundary** — all three preconditions present, none had ever run on this code. Between them they produced the two criticals the generalists missed.

**Not run: the deep tier** (`--exhaustive` was not requested). This is a standard-tier result. "All confirmed findings fixed" means the configured tiers came up dry — **not** that the code is clean.

## Known ceilings, commented in source

- Block macros (`{{#if}}…{{/if}}`) still pass as two independent tokens and can be halved.
- A message repeating an identical 24-char context block fingerprints the same at each site (degrades to prior behaviour, never worse).
- History and ledgers written before this build carry no pre-image or fingerprint and skip their check — the alternative bricks every stored ledger.
- Escaping applies to the selection too, so a selection containing a literal `</rewrite_this>` is sent escaped and the model could echo it back.

## Open, not addressed

- **No `.gitattributes`.** The bundle-sync guard passes only under `core.autocrlf=true`; on an LF checkout (Linux/macOS/CI) it hard-fails with a false "stale". Flagged by round-2 sign-off; a one-line `.gitattributes` fixes it. **Recommended next action.**
- **No CI.** Nothing enforces `node build.mjs` before commit. A process gap, not a code defect — worth a follow-up issue.
- `TAG_RE` backtracks quadratically on a `<` followed by a long unbroken alphanumeric run (618 ms at 40k chars). Low real-world exposure.
- Transform-free prose containing *two or more* literal `*` or `_` still false-refuses.
- No `bible/` exists in this repo; `foundation-audit` is offered, not run.

## Artifacts

`review/2026-08-04-v6-port/` — `STATE.md` · `candidates.md` · `verify.md` · `findings.md` · `PLAN.md` · this report.
