# comb — adversarial skeptic verdicts

Skeptics were instructed to REFUTE, were never the finder, and did not receive the finder's confidence score.

## Orchestrator-confirmed (skipped skeptic review — proven with live evidence)

### C-R1-1 — sidecar `Content-Type` regression → **CONFIRMED (critical)**
Verified by the orchestrator against the running engine on :7860:
```
Content-Type: text/plain        → HTTP 400 {"error":"Validation Error",
                                            "details":[{"path":"","message":"Expected object, received string"}]}
Content-Type: application/json  → HTTP 503 {"error":"Sidecar model is not available"}  ← past validation
```
Blast radius independently checked: exactly two `apiFetch` call sites send a body; `patchMessage` (:350) sets the header, `/sidecar/tracker` (:1490) does not.

### C-RT-1 — `alignExact` mid-token bisection → **CONFIRMED (critical)**
Reproduced by the orchestrator against the shipped function:
```
A = "Hi {{char50}} there, friend."   R = "Hi PersonName50 there, friend."
alignExact(R, A, 0, 11) → {as:0, ae:9}     (macro token spans A[3,13); ae=9 is inside it)
splice → "<<NEW>>50}} there, friend."
```

---

## Cluster A — security / import / prompt (complete)

### A1 = C-R2-1 — settings import redirects inference + leaks API key → **CONFIRMED**
- Evidence: `:2507-2521` merges `data.config` key-by-key with only `typeof impVal === typeof defVal`, no allow/denylist and no special case for `apiKey`/`apiUrl`/`connMode`. `:1500-1511` builds the endpoint from `cfg.apiUrl` with **no host allowlist** and unconditionally attaches `Authorization: Bearer <cfg.apiKey>` whenever the key is truthy and mode ≠ extender. **No confirmation dialog on Import** (`:2999` calls `importProfiles(render)` directly) — contrast `:3003`, where Reset *does* wrap in `confirm(...)`.
- **Demonstrated**, not argued: seeded a real key under `direct` mode, imported a file containing only `{connMode, apiUrl, apiModel}` and no `apiKey`. Output: `cfg.apiKey = sk-REAL-USER-SECRET-KEY-abc123 <-- SURVIVED, untouched by import`, then simulated next-request headers `{"Authorization":"Bearer sk-REAL-…"}` → `https://attacker.example/v1/chat/completions`.
- Severity: **high, but conditional** — the skeptic added a precondition the finder missed: the leak only fires if the user already configured `direct`/`extender` with a saved key (defaults are `sidecar` + empty key). Plausible for a meaningful subset given the docs promote Ollama/OpenRouter as first-class. Delivery is realistic: a shared profile-pack `.json`, one file-picker click, zero confirmation.

### A2 = C-R2-4 — unescaped fence interpolation → **CONFIRMED, severity argued UP**
- Evidence: `:1685-1689` concatenates `safeText` raw. Same pattern in the **automatic** context builders: `fetchLorebookEntries` (:431) `<lore>`, `buildPersonaContext` (:462) `<persona>`, `fetchPrevMessages` (:448) `<context>`. Grepped the whole file for any escaping helper — **zero matches**.
- Structural break demonstrated: a lorebook entry containing `</lore>` + injected text + a fake reopening `<lore>` closes the real fence early, leaving the payload unfenced. (Whether a given model then obeys it is model-dependent and untestable here; the fence break itself is proven.)
- **Severity argued UP against the finder's own framing.** The finder anchored on `safeText` — user-selected and user-visible, close to theatre since the user could type the injection themselves. But the identical bug applies to `<lore>`/`<character>`/`<persona>`/`<context>`, pulled in automatically by config flags from **data the user never authored or reviewed** — a downloaded character card or shared lorebook is a genuine indirect-injection vector. Worse with `cfg.autoApply` (opt-in, `:2043`/`:2078`): the model's output is committed via `doCommit` with the preview modal skipped entirely, so an injection writes attacker-influenced text into the user's story with no human in the loop.
- Verdict split: near-theatre for the manual-selection path; **genuinely worth fixing** for auto-included context + autoApply.

### A3 = C-RT-2 — profile id collision breaks drag-reorder → **CONFIRMED, severity argued DOWN**
- Evidence: `validProfileEntry` (:2472-2475) checks only that `id`/`name`/`prompt` are strings; no uniqueness check anywhere on the import path. Drop handler (:2687) is `profiles.find(x => x.id === dragId)` — first-match semantics. Reproduced: dragging row "B" resolves `src` to "A"; output `Is src the row the user actually dragged (B)? false / Is src instead the FIRST duplicate (A)? true`. Both duplicates render as independently draggable — the UI does not block the case.
- Notable detail the skeptic added: the delete path (`:2644-2645`) uses `profiles.indexOf(pr)` — **reference** equality — so it is correct even with duplicate ids. Only the id-string drag path is broken.
- **Severity argued DOWN to low.** UI data-integrity, not data loss or security: worst case a profile silently jumps position, fixable by re-dragging. New in-app profiles get collision-proof ids (`Date.now()+"-"+Math.random()`, `:3096`/`:3137`), so duplicates cannot arise from normal use — it requires a hand-edited or crafted import, i.e. the same delivery precondition as A1 but with far lower payoff.

## Cluster B — concurrency / commit (complete — all 5 CONFIRMED)

### B1 = C-R3-1 — undo/redo clobber concurrent edits → **CONFIRMED, argued UP**
`doUndo`/`doRedo` patch straight from the in-memory entry; entries (`:2228`, `:1447`) carry no version/hash. Engine side: `chats.routes.ts:1860-1866` → `chats.storage.ts:1040-1058`, where `withPatchQueue` serializes per-id **for atomicity only** and never compares against an expected prior value — bare last-write-wins confirmed.
**Skeptic argued severity UP:** the race is not multi-client-only. This engine has swipe/regenerate writing `updateMessageContent` from `generate.routes.ts`, `retry-agents-route.ts`, `game.routes.ts`, `tool-resolution-runtime.ts`, **plus a background-autonomous-messaging hook** (`use-background-autonomous.ts`) that mutates chat state with no user action. Reachable in ordinary single-user use.

### B2 = C-R3-2 — review modal applies a pre-modal snapshot → **CONFIRMED, not a duplicate**
`:2218` computes `updated` synchronously in `doCommit` *before* `reviewThenPatch(...)` at `:2222`. The modal only loads `proposed` into a textarea; Apply reads `ta.value` (`:1442`) and patches (`:1444`) — the user can edit the *text*, but the base document it was spliced against is never recomputed. No timeout.
Skeptic's ruling: same root class as B1 (no optimistic-concurrency check before any PATCH) but a **different call site** with a user-controlled, unbounded window. Fix together, track separately.

### B3 = C-R3-3 — occurrence index resolves to the wrong occurrence → **CONFIRMED, demonstrated**
`nthIndexOf` (`:688-692`) is a bare walk-forward over `indexOf` with no bounds/context validation. Skeptic's run:
```
edited2 occ2 index: 29 -> text: hello there. hello again.
This now silently resolves to 'hello world' instead of the originally-selected 'hello again'
  - WRONG occurrence, no error.
```
`doCommit` (`:2197-2199`) falls back to first-match on `-1` and never validates the resolved span beyond the literal substring. **Ledger persistence confirmed real and TTL-less:** `saveLedger` (`:1805-1813`) writes to localStorage, pruned only by count (>12, oldest by `createdAt`). `doLedgerRewrite` reuses by content-hash across sessions (`:1830-1833`) and `assembleAndCommit` (`:1914-1925`) passes the original `occ` through unrevalidated. Toast still reads "✓ Applied".

### B4 = C-R3-5 — partial multi-message apply → **CONFIRMED with correction**
`applyMerged` (`:2029-2040`) recurses only inside `doCommit`'s success callback; every failure branch calls `showErr` and returns without `onDone`, so the chain stops and the "✓ Applied to N messages" toast never fires.
**Correction to the finder:** it is *not* silent — `showErr` (`:1378-1389`) shows a modal naming the failing segment's reason. The real defect is **no aggregation**: no count of how many segments already committed, no per-segment success toast. A user seeing "Message not found" on segment 3 of 4 cannot tell that segments 1-2 were already written. Severity down slightly from "reports nothing"; substance holds.

### B5 = C-R2-3 — `null` response treated as cancellation → **CONFIRMED (the crux check went for the claim)**
The refutation hypothesis was that `runInference` might shape `null` into `{error:…}` before callers see it. It does not: the sidecar branch (`:1486-1494`) assigns `p = marinara.apiFetch(...)` and the shared tail (`:1547-1554`) is `return p.then(function (resp) { logDbg(...); return resp; })` — **pure passthrough**. Only the direct/extender branch (`:1518-1545`) hand-shapes to `{result}`/`{error}`, and that branch cannot produce null — irrelevant, since sidecar is the default (`:1483`).
All three consumers fold null into the abort no-op: `:1701-1702`, `:1997-1998`, `:1904-1905`. And user-initiated abort is handled **independently** by the Cancel button (`controller.abort(); ov.remove();`, `:1643`), so it never needed that branch — meaning the branch's only real traffic is failures. A null response leaves "Generating…" open indefinitely with no error.

> **Interaction worth noting for the plan:** C-R1-1 (Content-Type) makes the sidecar return HTTP 400 with a *valid JSON* body, so `apiFetch` resolves an object, not null — the user gets an unhelpful "empty response" error rather than the B5 hang. B5's hang needs a genuinely non-JSON body (proxy error page, crashed process). Both are real; they surface differently.

## Cluster C — adoption / storage (complete — all 4 CONFIRMED, two argued down)

### C1 = C-R1-2 — non-atomic adoption copy → **CONFIRMED, argued slightly DOWN**
Harness with a mock localStorage throwing `QuotaExceededError` on the 3rd `setItem`:
```
adoptLegacyNamespace returned: null
NS-c present: true   {"cols":4,"apiKey":"sk-legacy-secret"}
NS-h present: true   [{"when":1700000000000,...}]
NS-p present (sentinel): false
profiles: [{"id":"expand",...}]   <- DEF_PROFILES fallback, legacy custom profiles lost FOR THIS LOAD
cfg:      {"cols":4,...}          <- legacy
hist:     [{"when":...}]          <- legacy
```
Genuine mixed bootstrap for the current load. A second call in the same harness **did** retry and complete — the sentinel-last design self-heals on the *next* load, just not this one. Also confirms the sub-claim that every later load re-pays the origin scan + `JSON.parse` per candidate while the sentinel is absent.
Severity down from the implied framing: nothing is destroyed, legacy keys are untouched, it self-heals. But the code's own comment predicts "a copy transiently doubles usage", and the app ships dedicated quota handling (`_quotaWarned` toast, `:127-133`) — the devs already treat quota as live. Worth the one-line fix, not urgent.

### C2 = C-R1-3 — reclaim deletes a live 5.1 preference → **CONFIRMED (mechanism), NOT a meaningful defect**
Checked the deleted `loader.js` at `git show a8d4e1b^`: `allowRemote()` returns `false` for an absent key — i.e. removal resets the user to the loader's **safe** default (no remote code pull), not an unsafe one. Also: no documented "rollback to 5.1" path exists in README or CHANGELOG; the rollback-safety goal is self-declared in a code comment only.
**Argued down significantly — recommend DEFER, no fix budget.** A fail-safe reset of an opt-in, at worst a minor preference-loss nuisance.

### C3 = C-TB-1 — adoption bypasses profile validation, silently blackholes the extension → **CONFIRMED, high**
Demonstrated: seeding `K_PROF = '[{"id":"expand"},null]'` and running the verbatim `loadArr` + `migratePrompts` →
```
migratePrompts THREW: TypeError: Cannot read properties of null (reading 'id')
```
No try/catch wraps `migratePrompts` (the `:272` one belongs to the unrelated `window.__rwaDebug` block). `PersonalExtensionInjector.tsx:390-437`: `main()` runs via `Promise.resolve().then(...)` with extension.js spliced in synchronously, so the throw aborts **every** subsequent top-level statement — no `marinara.on` bindings, no popup, no menu wiring. Rejection is caught only at `.catch` (`:426-437`) → `console.error` + a `marinara-personal-extension-error` CustomEvent.
**The skeptic grepped the entire client for listeners on that event: none exist outside the injector itself.** No toast, no UI — functionally silent to an ordinary user.
"Unreachable before this diff" independently verified: every pre-diff writer of `K_PROF` (initial `loadArr`, `saveP()`, reset-to-`DEF_PROFILES`, internal UI splice/push, and the import path filtered by `validProfileEntry`) is incapable of putting a `null` element there. **Adoption is a genuinely new unvalidated writer.**

### C4 = C-TB-2 — adoption selects candidates with no proof of ownership → **CONFIRMED, medium, not a duplicate of C3**
`:103` tests only `endsWith("-p")` + `startsWith("rwa-")`. `bestWhen` starts at `-1` and `legacyRecency` returns `0` for a missing/invalid `-h`, so a no-history colliding key still beats `-1` and can win; among several no-history candidates, implementation-defined enumeration order decides.
Downstream tolerance traced: `loadObj`/`loadArr` guard *shape*, and a foreign `-c` merges mostly harmlessly (unrelated keys ignored by the `Object.keys(DEF_CFG).forEach` merge at `:224`). **`-p` is the exposure** — a foreign array passes `loadArr` and reaches `migratePrompts`, reproducing C3's crash if it holds `null`s, or rendering garbage-shaped profiles if elements are merely wrong-shaped.
Skeptic's ruling: C3 is "the copied value can be malformed with no downstream guard"; C4 is "the source of the copy is unverified, so wrong data can be selected in the first place." They **compose**, and one fix closes both.

## Cluster D — guards / build / perf / docs

_pending_
