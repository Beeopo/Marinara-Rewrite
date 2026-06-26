# Marinara Engine v2.x Compatibility Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Rewrite Assistant extension commit rewrites reliably against Marinara Engine v2.0.5, where the rendered DOM diverges from raw `msg.content`.

**Architecture:** Replace the DOM-editor commit path with a direct API `PATCH`. Locate the user's selection in the engine's *own* rendered output (read from the DOM), then char-align rendered↔raw `msg.content` (LCS) to map the span into raw coordinates for the splice. No engine transform logic is reimplemented, so the fix can't drift across engine versions. Undo/redo and review mode are rebuilt on PATCH; the broken lorebook fallback endpoint is repointed; three dark-only theme values are made theme-aware.

**Tech Stack:** Single-file browser extension (`extension.js`, ES5-style `var`, one IIFE). Build via `node build.mjs`. Logic self-checks via `node selfcheck.mjs` (Node `assert`, mirrors pure logic + source drift guards). No DOM/test framework — DOM behavior is verified by driving a live engine in Chrome.

## Global Constraints

- Target engine: **Marinara Engine v2.0.5+**. No dual code paths for older engines.
- All extension code lives in **`extension.js`** (one IIFE). Match existing style: `var`, function declarations, no ES modules inside the file.
- `apiFetch` paths take **no `/api` prefix** (the bridge adds it): `marinara.apiFetch("/chats/" + cid + "/messages/" + mid, {...})`.
- The bundle **`id` stays `"rewrite-assistant-v4"`** (it is the Marinara install slot; changing it orphans existing installs). Only `name`/`description` change.
- Every code change ends with `node build.mjs` (gates on selfcheck, regenerates **both** bundles, round-trip-checks them). Commit `extension.js`, `selfcheck.mjs`, and **both regenerated bundles** together.
- Commit author is already `Beeopo <295459174+Beeopo@users.noreply.github.com>` (repo default — do not override).
- Do not touch the untracked `screenshots/generating.png`.

## Verification Environment (one-time, for Chrome-driven checks)

Several tasks need a live engine. Set this up once before Task 2:

1. **Run the engine** from `C:\ST\Marinara-Engine` (this *is* the v2.0.5 source): `pnpm install` then the dev/start command (`pnpm dev` or per its README). Confirm it serves on a localhost port.
2. **Build + import the extension:** `node build.mjs` in `C:\ST\Rewrite-Assistant`, then in the running Marinara UI go to Settings → Extensions and import `rewrite-assistant.json` (the full bundle, not the loader, for deterministic local testing).
3. **Connect Chrome:** drive the Marinara tab with the `mcp__Claude_in_Chrome__*` tools (navigate to the localhost URL, `read_page`/`get_page_text`, `computer`/`find` to select text and click). Create a chat with a character so macros (`{{char}}`/`{{user}}`), curly quotes, and markdown are present in messages.

Re-import the bundle after each task whose behavior you want to re-check (or rely on the loader if configured).

---

### Task 1: Render↔raw alignment helper (pure logic, TDD)

The core of the fix: map a span in the rendered text to a span in raw `msg.content`. Pure function → tested with Node `assert` mirrored in `selfcheck.mjs`, the repo's established pattern.

```json:metadata
{ "modelTier": "standard" }
```

**Files:**
- Modify: `extension.js` — add `mapRenderedSpanToRaw` near the other text helpers (after `nthIndexOf`, `extension.js:507`).
- Modify: `selfcheck.mjs` — append a mirrored copy + assertions, and a drift guard.

**Interfaces:**
- Produces: `mapRenderedSpanToRaw(renderedFull, rawContent, rs, re) -> { as: number, ae: number } | null`. `rs`/`re` are character offsets (`re` exclusive) into `renderedFull`; `as`/`ae` are the mapped offsets into `rawContent`. Returns `null` when alignment is impossible (empty input or over the size cap) so callers fall back to the existing copy path.

- [ ] **Step 1: Write the failing test** — append to `selfcheck.mjs` (before the final `console.log`):

```js
// 6) render<->raw span alignment (mirror of mapRenderedSpanToRaw in extension.js)
function _mapRenderedSpanToRaw(R, A, rs, re) {
  var n = R.length, m = A.length;
  if (!n || !m || n * m > 4000000) return null;
  const dp = [];
  for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = (R.charCodeAt(i) === A.charCodeAt(j))
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rawAt = new Int32Array(n + 1);
  let i = 0, j = 0;
  while (i < n) {
    if (j < m && R.charCodeAt(i) === A.charCodeAt(j)) { rawAt[i++] = j++; }
    else if (j >= m) { rawAt[i++] = m; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rawAt[i++] = j; }   // rendered-only char
    else { j++; }                                                // raw-only char
  }
  rawAt[n] = m;
  const as = rawAt[rs], ae = rawAt[re];
  return (ae >= as) ? { as, ae } : null;
}
function _slice(A, s) { return A.slice(s.as, s.ae); }
// identity
let s = _mapRenderedSpanToRaw("hello world", "hello world", 6, 11);
assert.equal(_slice("hello world", s), "world");
// markdown stripped in raw: rendered "bold text" <- raw "**bold** text"
s = _mapRenderedSpanToRaw("bold text", "**bold** text", 5, 9);
assert.equal(_slice("**bold** text", s), "text");
// curly quotes in rendered, straight in raw (same length)
s = _mapRenderedSpanToRaw("he said “hi”", 'he said "hi"', 9, 11);
assert.equal(_slice('he said "hi"', s), "hi");
// macro expanded in rendered: select text AFTER the macro maps past the raw token
s = _mapRenderedSpanToRaw("Hi Alice!", "Hi {{char}}!", 8, 9); // the "!"
assert.equal(_slice("Hi {{char}}!", s), "!");
// boundary INSIDE an expanded macro: degrades gracefully (snaps within the raw token)
s = _mapRenderedSpanToRaw("Hi Alice!", "Hi {{char}}!", 3, 8); // "Alice"
assert.ok(s && s.as >= 3 && s.ae <= 11 && s.ae >= s.as);
// over-cap returns null
assert.equal(_mapRenderedSpanToRaw("a".repeat(2001), "b".repeat(2001), 0, 1), null);
console.log("selfcheck: span-alignment assertions passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node selfcheck.mjs`
Expected: throws `AssertionError` on the new block (the mirror's expectations not yet matched by a drift guard), OR passes the mirror but the next step's drift guard is what fails. Confirm the new `console.log` line is reached only after the asserts.

- [ ] **Step 3: Add the implementation to `extension.js`** (after `nthIndexOf`, around `extension.js:511`):

```js
  // Map a [rs,re) span in the rendered text to a [as,ae) span in raw msg.content.
  // The engine renders raw content through macro/quote/markdown transforms; this
  // LCS-aligns the two strings so a selection captured from the DOM can be spliced
  // back into raw content. Returns null over the size cap (caller copies instead).
  function mapRenderedSpanToRaw(R, A, rs, re) {
    var n = R.length, m = A.length;
    if (!n || !m || n * m > 4000000) return null; // ponytail: ~2k×2k char cap; null -> copy fallback
    var dp = [];
    for (var i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (var i = n - 1; i >= 0; i--)
      for (var j = m - 1; j >= 0; j--)
        dp[i][j] = (R.charCodeAt(i) === A.charCodeAt(j))
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var rawAt = new Int32Array(n + 1);
    var i2 = 0, j2 = 0;
    while (i2 < n) {
      if (j2 < m && R.charCodeAt(i2) === A.charCodeAt(j2)) { rawAt[i2++] = j2++; }
      else if (j2 >= m) { rawAt[i2++] = m; }
      else if (dp[i2 + 1][j2] >= dp[i2][j2 + 1]) { rawAt[i2++] = j2; } // rendered-only
      else { j2++; }                                                   // raw-only
    }
    rawAt[n] = m;
    var as = rawAt[rs], ae = rawAt[re];
    return (ae >= as) ? { as: as, ae: ae } : null;
  }
```

- [ ] **Step 4: Add the drift guard** to `selfcheck.mjs` (in the drift-guard block, after the `nthIndexOf` guard at `selfcheck.mjs:63`):

```js
assert.ok(_SRC.includes("function mapRenderedSpanToRaw"), "drift: mapRenderedSpanToRaw missing");
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node selfcheck.mjs`
Expected: all blocks print, ending with `drift-guard assertions passed` and no `AssertionError`.

- [ ] **Step 6: Commit**

```bash
cd /c/ST/Rewrite-Assistant
node build.mjs
git add extension.js selfcheck.mjs rewrite-assistant.json rewrite-assistant-loader.json
git commit -m "feat: add render<->raw span alignment helper for v2 commit path"
```

---

### Task 2: PATCH helper + rewire `doCommit` to alignment + PATCH

Replace the 4-tier matcher (which matched rendered text against raw content) and the editor call with: locate-in-rendered → align → splice raw → PATCH.

```json:metadata
{ "modelTier": "standard" }
```

**Files:**
- Modify: `extension.js` — add `patchMessage`, add `renderedTextForMid`, rewrite the body of `doCommit` (`extension.js:2087-2225`).
- Modify: `selfcheck.mjs` — swap the anchor-cap drift guard for new guards.

**Interfaces:**
- Consumes: `mapRenderedSpanToRaw` (Task 1); existing `cachedMessages(cid)`, `invalidateMsgCache()`, `nthIndexOf(hay,needle,n)`, `getChatId()`, `showErr(msg)`, `showToast(el,msg,variant)`, `hist`, `redo`, `saveH`, `saveRedo`, `cfg.historyDepth`.
- Produces: `patchMessage(cid, mid, content) -> Promise<object>` (resolves to the updated message; the body shape is unused beyond success). `renderedTextForMid(mid) -> string` (rendered text of the message's `.mari-message-content` blocks, normalized, header excluded). `doCommit(newText, savedSel, onDone)` signature unchanged; `savedSel = { text, mid, cid?, occ? }`.

- [ ] **Step 1: Add `patchMessage`** near the other API helpers (after `cachedMessages`, ~`extension.js:200`):

```js
  // Write raw content back to the engine. apiFetch spreads options into fetch and
  // resolves to parsed JSON; the PATCH route returns the updated message object.
  function patchMessage(cid, mid, content) {
    return marinara.apiFetch(
      "/chats/" + encodeURIComponent(cid) + "/messages/" + encodeURIComponent(mid),
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: content }) }
    );
  }
```

- [ ] **Step 2: Add `renderedTextForMid`** next to `selectionTextInMessage` (after `extension.js:3188`). It mirrors that function's clamping so commit reads the same coordinate space the selection was captured in:

```js
  // The rendered text of a message's content blocks (NOT the whole element — the
  // author/timestamp header isn't in stored content). Concatenated across blocks
  // for grouped turns that share one id. This is the string the selection was
  // captured from, and what we align against raw msg.content.
  function renderedTextForMid(mid) {
    var segs = document.querySelectorAll('[data-message-id="' + mid + '"]');
    var out = "";
    for (var i = 0; i < segs.length; i++) {
      var cs = segs[i].querySelectorAll(".mari-message-content");
      for (var j = 0; j < cs.length; j++) out += cs[j].textContent || "";
    }
    return out.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }
```

- [ ] **Step 3: Rewrite `doCommit`'s match+apply body.** Replace the 4-tier matcher block and the `prefillEditTextarea` call (`extension.js:2112-2220`) with the alignment locate + splice + PATCH. New body from the `var msg = ...` resolution onward:

```js
        var normSel = savedSel.text.trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        var rawContent = (msg.content || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        var renderedFull = renderedTextForMid(mid);

        // Locate the selection in the rendered text exactly — it was captured from
        // the DOM, so it is a substring of the rendered text (no fuzzy match needed).
        var occ = (savedSel && typeof savedSel.occ === "number") ? savedSel.occ : 0;
        var rs = nthIndexOf(renderedFull, normSel, occ);
        if (rs === -1) rs = renderedFull.indexOf(normSel);
        if (rs === -1) {
          showErr(
            "Could not locate the selected text in the rendered message.\n\n" +
            "The message may have changed since you selected. Re-select and try again."
          );
          return;
        }
        var re = rs + normSel.length;

        // Map the rendered span into raw msg.content coordinates and splice.
        var span = mapRenderedSpanToRaw(renderedFull, rawContent, rs, re);
        if (!span) {
          showErr(
            "Could not map the selection back to stored content (message too large\n" +
            "or unmappable). Use the Copy button and paste the rewrite manually."
          );
          return;
        }
        var updated = rawContent.slice(0, span.as) + newText + rawContent.slice(span.ae);

        invalidateMsgCache();
        patchMessage(cid, mid, updated)
          .then(function () {
            var depth = Math.max(1, Math.min(20, cfg.historyDepth || 5));
            hist.unshift({ mid: mid, cid: cid, old: msg.content, post: updated, when: Date.now() });
            if (hist.length > depth) hist.length = depth;
            if (redo.length) { redo.length = 0; saveRedo(); }
            saveH();
            showToast(null, "✓ Applied", "ok");
            if (onDone) onDone();
          })
          .catch(function (e) {
            showErr("Save failed:\n" + (e && e.message ? e.message : String(e)));
          });
```

Leave the `cachedMessages(cid).then(function (msgs) {...})` wrapper and the message-lookup/`!msg` error (`extension.js:2095-2110`) intact; only the matcher+apply tail changes. Delete the old `var normOrig/normContent/updated/found` matcher (all four tiers) and the trailing `prefillEditTextarea(...)` block.

- [ ] **Step 4: Update drift guards** in `selfcheck.mjs`: remove the now-obsolete anchor guard (`selfcheck.mjs:61`, `normOrig.length * 1.5`) and the `found = true` guard (`selfcheck.mjs:59`); add:

```js
assert.ok(_SRC.includes("function patchMessage"), "drift: patchMessage (v2 PATCH commit) missing");
assert.ok(/method:\s*"PATCH"/.test(_SRC), "drift: PATCH method missing");
assert.ok(_SRC.includes("function renderedTextForMid"), "drift: renderedTextForMid missing");
```

- [ ] **Step 5: Verify logic checks pass**

Run: `node selfcheck.mjs`
Expected: all assertions pass, including the new drift guards; no reference to the removed `found`/anchor patterns trips a guard.

- [ ] **Step 6: Build, then Chrome-verify a basic commit** (Verification Environment must be up)

Run: `node build.mjs`; re-import `rewrite-assistant.json` into the running Marinara.
Then via `mcp__Claude_in_Chrome__*`: open a chat, select a plain-prose phrase in a message (no macro/markdown), run a rewrite, click Accept. Reload the chat and confirm via `get_page_text` that the message now contains the rewritten text and nothing else changed.

- [ ] **Step 7: Commit**

```bash
cd /c/ST/Rewrite-Assistant
git add extension.js selfcheck.mjs rewrite-assistant.json rewrite-assistant-loader.json
git commit -m "feat: commit rewrites via API PATCH with render-aligned splice"
```

---

### Task 3: Remove dead editor code; move undo/redo to PATCH

The matcher no longer drives the editor, so delete the editor machinery and rebuild undo/redo on `patchMessage`.

```json:metadata
{ "modelTier": "standard" }
```

**Files:**
- Modify: `extension.js` — delete `prefillEditTextarea` (`1313`), `applyToTextarea` (`1329`), `waitForTextarea` (`1364`), `findEditTextarea` (`1262`), `findSaveButton` (`1297`), `setNativeTextareaValue` (`1251`); delete the `.rwa-msg-hl` CSS rule (`741`); rewrite `doUndo` (`2229`) and `doRedo` (`2252`).
- Modify: `selfcheck.mjs` — no new guards required; ensure none reference deleted names.

**Interfaces:**
- Consumes: `patchMessage` (Task 2), `hist`, `redo`, `saveH`, `saveRedo`, `cfg.historyDepth`, `invalidateMsgCache`, `killPopup`, `showToast`.

- [ ] **Step 1: Delete the editor functions.** Remove the six functions listed above in full. After deletion, grep to confirm no remaining references:

Run: `grep -nE "prefillEditTextarea|applyToTextarea|waitForTextarea|findEditTextarea|findSaveButton|setNativeTextareaValue|rwa-msg-hl|marinara:start-edit-message|marinara\.observe" extension.js`
Expected: no matches (zero lines).

- [ ] **Step 2: Delete the `.rwa-msg-hl` CSS** at `extension.js:741`:

```js
    ".rwa-msg-hl{outline:2px solid var(--primary)!important;outline-offset:3px;border-radius:4px;}" +
```
Remove that entire string-concat line.

- [ ] **Step 3: Rewrite `doUndo`** (`extension.js:2229-2246`):

```js
  function doUndo() {
    if (!hist.length) return;
    var h = hist[0];
    var depth = Math.max(1, Math.min(20, cfg.historyDepth || 5));
    invalidateMsgCache();
    patchMessage(h.cid, h.mid, h.old)
      .then(function () {
        hist.shift();
        saveH();
        if (h.post != null) { redo.unshift(h); if (redo.length > depth) redo.length = depth; saveRedo(); }
        showToast(null, "↶ Undone", "ok");
        killPopup();
      })
      .catch(function (e) { showErr("Undo failed:\n" + (e && e.message ? e.message : String(e))); });
  }
```

- [ ] **Step 4: Rewrite `doRedo`** (`extension.js:2252-2268`):

```js
  function doRedo() {
    if (!redo.length) return;
    var r = redo[0];
    if (r.post == null) { redo.shift(); saveRedo(); return; }
    var depth = Math.max(1, Math.min(20, cfg.historyDepth || 5));
    invalidateMsgCache();
    patchMessage(r.cid, r.mid, r.post)
      .then(function () {
        redo.shift();
        saveRedo();
        hist.unshift(r);
        if (hist.length > depth) hist.length = depth;
        saveH();
        showToast(null, "↷ Redone", "ok");
        killPopup();
      })
      .catch(function (e) { showErr("Redo failed:\n" + (e && e.message ? e.message : String(e))); });
  }
```

(Removes the `!ok` guard and the "scroll to the message first" toast — PATCH has no DOM dependency.)

- [ ] **Step 5: Verify logic checks pass**

Run: `node selfcheck.mjs`
Expected: passes. The `doRedo` and `nthIndexOf`/`selectionOccurrence` drift guards still hold.

- [ ] **Step 6: Build + Chrome-verify undo/redo**

Run: `node build.mjs`; re-import the bundle.
Via Chrome: apply a rewrite, click Undo (the popup's undo control) → confirm the message reverts; click Redo → confirm it re-applies. Scroll the edited message out of view, then Undo → confirm it still works (the old guard would have blocked this).

- [ ] **Step 7: Commit**

```bash
cd /c/ST/Rewrite-Assistant
git add extension.js selfcheck.mjs rewrite-assistant.json rewrite-assistant-loader.json
git commit -m "refactor: delete DOM-editor commit path; undo/redo via PATCH"
```

---

### Task 4: Extension-native review mode

`reviewBeforeApply` no longer opens Marinara's editor; it shows the spliced raw content in an editable textarea and PATCHes on Apply.

```json:metadata
{ "modelTier": "standard" }
```

**Files:**
- Modify: `extension.js` — add a review branch in `doCommit` (before the direct `patchMessage` call from Task 2); add a `reviewThenPatch` helper using existing modal infra (`mkOv`, `mkWin`, `mkBtn`, `ap`, `mk`); update the settings-row label at `extension.js:2896`.

**Interfaces:**
- Consumes: `patchMessage`, `mkOv(z)`, `mkWin(ov,w,title)`, `mkBtn(label,cls,fn)`, `ap(parent,child)`, `mk(tag,cls,text)`, `cfg.reviewBeforeApply`, `hist`, `redo`, `saveH`, `saveRedo`, `cfg.historyDepth`, `invalidateMsgCache`, `showErr`, `showToast`.
- Produces: `reviewThenPatch(cid, mid, oldContent, proposed, onDone)` — shows the editable textarea modal; Apply PATCHes the textarea's current value and records history.

- [ ] **Step 1: Add `reviewThenPatch`** (near the modal helpers, after `showModalErr`, ~`extension.js:1229`):

```js
  // Review mode: show the spliced raw content in an editable textarea and only
  // PATCH (with whatever the user edited) when they click Apply.
  function reviewThenPatch(cid, mid, oldContent, proposed, onDone) {
    var ov = mkOv(10010);
    var body = mkWin(ov, "560px", "Review & edit before applying");
    var ta = ap(body, mk("textarea", "rwa-inp"));
    ta.value = proposed;
    ta.style.cssText = "width:100%;min-height:240px;resize:vertical;white-space:pre-wrap;font-family:inherit;";
    var ft = ap(body, mk("div", "rwa-foot"));
    ap(ft, mkBtn("Apply", "rwa-accept", function () {
      var content = ta.value;
      invalidateMsgCache();
      patchMessage(cid, mid, content)
        .then(function () {
          var depth = Math.max(1, Math.min(20, cfg.historyDepth || 5));
          hist.unshift({ mid: mid, cid: cid, old: oldContent, post: content, when: Date.now() });
          if (hist.length > depth) hist.length = depth;
          if (redo.length) { redo.length = 0; saveRedo(); }
          saveH();
          ov.remove();
          showToast(null, "✓ Applied", "ok");
          if (onDone) onDone();
        })
        .catch(function (e) { showErr("Save failed:\n" + (e && e.message ? e.message : String(e))); });
    })).style.flex = "2";
    ap(ft, mkBtn("Cancel", null, function () { ov.remove(); })).style.flex = "1";
  }
```

- [ ] **Step 2: Branch in `doCommit`.** In the Task 2 tail, replace the direct `patchMessage(...)` chain with a review check:

```js
        invalidateMsgCache();
        if (cfg.reviewBeforeApply) {
          reviewThenPatch(cid, mid, msg.content, updated, onDone);
          return;
        }
        patchMessage(cid, mid, updated)
          .then(function () {
            var depth = Math.max(1, Math.min(20, cfg.historyDepth || 5));
            hist.unshift({ mid: mid, cid: cid, old: msg.content, post: updated, when: Date.now() });
            if (hist.length > depth) hist.length = depth;
            if (redo.length) { redo.length = 0; saveRedo(); }
            saveH();
            showToast(null, "✓ Applied", "ok");
            if (onDone) onDone();
          })
          .catch(function (e) { showErr("Save failed:\n" + (e && e.message ? e.message : String(e))); });
```

- [ ] **Step 3: Update the settings label** at `extension.js:2896`:

```js
        row(db, "Review & edit before applying", ck(cfg.reviewBeforeApply, function (e) { cfg.reviewBeforeApply = e.target.checked; saveC(); }),
```

- [ ] **Step 4: Verify logic checks pass**

Run: `node selfcheck.mjs`
Expected: passes.

- [ ] **Step 5: Build + Chrome-verify review mode**

Run: `node build.mjs`; re-import; enable "Review & edit before applying" in settings.
Via Chrome: run a rewrite → Accept → confirm the review textarea appears pre-filled with the spliced *raw* content; edit a word in the textarea; click Apply; reload and confirm the message reflects the hand-edited content.

- [ ] **Step 6: Commit**

```bash
cd /c/ST/Rewrite-Assistant
git add extension.js selfcheck.mjs rewrite-assistant.json rewrite-assistant-loader.json
git commit -m "feat: extension-native review mode (editable textarea + Apply->PATCH)"
```

---

### Task 5: Lorebook fallback endpoint fix

`rawScan` calls the removed `/lorebook-entries`; repoint to `/lorebooks/scan/:chatId`.

```json:metadata
{ "modelTier": "standard" }
```

**Files:**
- Modify: `extension.js` — `rawScan` (`extension.js:419-425`), and adapt the entry-field access in `fetchExtenderMemoryViaScan` (`extension.js:427-438`) if the scan shape differs.

**Interfaces:**
- Consumes: `marinara.apiFetch`, `fetchExtenderLorebookIds()` (unchanged), `extractMemoryContent`, `fenceMemory`.
- Produces: `rawScan(cid) -> Promise<Array<entry>>` where each `entry` exposes (or is adapted to expose) `lorebookId`, `name`, `content` — the fields `fetchExtenderMemoryViaScan` filters/extracts on.

- [ ] **Step 1: Chrome-verify the scan response shape FIRST.** With the engine running and a chat that has an "marinara extender …" lorebook, fetch `GET /api/lorebooks/scan/<chatId>` (via the browser devtools/network using `mcp__Claude_in_Chrome__read_network_requests` or `javascript_tool` to `fetch` it) and record the JSON: is it an array of entries or `{entries:[...]}`? What are the per-entry field names for the owning lorebook id, the entry name, and the entry content? This determines Step 2's accessors.

- [ ] **Step 2: Rewrite `rawScan`** (`extension.js:419`) to the verified shape. Baseline (adjust field plucking to what Step 1 showed):

```js
  function rawScan(cid) {
    // /lorebook-entries was removed in Marinara v2.x; /lorebooks/scan/:chatId is
    // the replacement (same endpoint fetchLorebookEntries uses).
    return marinara.apiFetch("/lorebooks/scan/" + encodeURIComponent(cid || ""))
      .then(function (resp) {
        var arr = Array.isArray(resp) ? resp : ((resp && (resp.entries || resp.data)) || []);
        // Normalize to { lorebookId, name, content } so the filter below is stable.
        return arr.map(function (e) {
          return {
            lorebookId: e.lorebookId != null ? e.lorebookId : (e.lorebook_id != null ? e.lorebook_id : (e.bookId)),
            name: e.name || e.title || "",
            content: e.content || e.text || "",
          };
        });
      }).catch(function () { return []; });
  }
```

If Step 1 shows the existing field names already match (`lorebookId`/`name`/`content`), drop the `.map` normalization and keep the array directly — minimal diff.

- [ ] **Step 3: Verify logic checks pass**

Run: `node selfcheck.mjs`
Expected: passes (the `fetchExtenderMemory` drift guard still holds).

- [ ] **Step 4: Build + Chrome-verify the fallback** — with no Extender sidecar URL configured (so the lorebook scan path is taken), trigger a rewrite on a chat with an Extender lorebook and confirm via the debug log (`logDbg("extender.memory.source", { via: "scan-fallback" })`) that memory content is produced (non-empty `<memory>` block in the assembled prompt).

```bash
cd /c/ST/Rewrite-Assistant
node build.mjs
git add extension.js rewrite-assistant.json rewrite-assistant-loader.json
git commit -m "fix: repoint Extender memory fallback to /lorebooks/scan/:chatId"
```

---

### Task 6: Theme polish (3 values)

```json:metadata
{ "modelTier": "mechanical" }
```

**Files:**
- Modify: `extension.js` — three CSS string lines: `634`, `695`, `746`.

- [ ] **Step 1: `.rwa` box-shadow** at `extension.js:634` — change `rgba(0,0,0,.55)` to `rgba(0,0,0,.15)`:

```js
    "padding:12px;box-shadow:0 12px 40px rgba(0,0,0,.15);z-index:10000;display:flex;flex-direction:column;gap:6px;" +
```

- [ ] **Step 2: `.rwa-ov` background** at `extension.js:695` — change `background:rgba(0,0,0,.72)` to the theme-aware mix:

```js
    ".rwa-ov{position:fixed;top:0;left:0;right:0;bottom:0;background:color-mix(in srgb,var(--background) 88%,var(--foreground) 12%);" +
```

- [ ] **Step 3: `.rwa-toast-ok` background** at `extension.js:746` — replace the hardcoded gradient with the theme primary:

```js
    ".rwa-toast-ok{background:var(--primary)!important;color:var(--primary-foreground)!important;}" +
```

- [ ] **Step 4: Build + Chrome-verify on light theme** — switch Marinara to its light theme, confirm the popup shadow, overlay background, and success toast all read correctly (no near-black overlay, toast uses the accent).

```bash
cd /c/ST/Rewrite-Assistant
node selfcheck.mjs && node build.mjs
git add extension.js rewrite-assistant.json rewrite-assistant-loader.json
git commit -m "fix: theme-aware popup shadow, overlay, and success toast"
```

---

### Task 7: Version banner + changelog + final bundle

```json:metadata
{ "modelTier": "mechanical" }
```

**Files:**
- Modify: `extension.js:1` (header), `rewrite-assistant.json` (`name`, `description` — NOT `id`), `CHANGELOG.md` (new v5.1 entry).

- [ ] **Step 1: Update the header** at `extension.js:1`:

```js
// Rewrite Assistant v5.1 — Marinara Engine v2.x Compatibility
```

- [ ] **Step 2: Update bundle metadata** in `rewrite-assistant.json` (top of file; keep `"id": "rewrite-assistant-v4"` unchanged):

```json
  "name": "Rewrite Assistant v5.1",
  "description": "Highlight text in any message to rewrite with AI. v5.1: Marinara Engine v2.x compatibility — commits via API PATCH with render-aligned splice (handles macros, curly quotes, markdown), extension-native review mode, lorebook scan fallback, theme-aware UI.",
```

(`build.mjs` preserves `name`/`description` from this file and propagates `name` to the loader bundle; the loader's own description is fixed in `build.mjs` and needs no change.)

- [ ] **Step 3: Add the CHANGELOG entry** at the top of `CHANGELOG.md` (match the existing entry format):

```markdown
## v5.1 — Marinara Engine v2.x compatibility

- **Fixed:** rewrites now commit reliably on Marinara v2.0.5+. The engine moved
  macro/quote/markdown transforms into the render path (v2.0.0 refactor), so the
  rendered DOM no longer matches stored content. The extension now commits via the
  message API (`PATCH`), locating the selection in the engine's rendered output and
  aligning it back to stored content for the splice — no editor automation.
- **Changed:** undo/redo use the API and work even when the message is scrolled
  out of view.
- **Changed:** "Review before applying" now opens an editable preview in the
  extension (the native editor is no longer driven).
- **Fixed:** Extender memory fallback uses `/lorebooks/scan/:chatId`
  (`/lorebook-entries` was removed in v2.x).
- **Fixed:** popup shadow, overlay, and success toast adapt to light themes.
- **Note:** requires Marinara Engine v2.0.5 or newer.
```

- [ ] **Step 4: Final build + full Chrome regression**

Run: `node selfcheck.mjs && node build.mjs`. Confirm build prints both "OK" lines and the loader bundle now shows `"name": "Rewrite Assistant v5.1"`.
Chrome regression pass: a plain rewrite, a macro-containing selection, a markdown selection, a curly-quote selection, undo+redo, review mode, and the lorebook fallback — all from the prior tasks, once more end to end.

- [ ] **Step 5: Commit**

```bash
cd /c/ST/Rewrite-Assistant
git add extension.js rewrite-assistant.json rewrite-assistant-loader.json CHANGELOG.md
git commit -m "release: Rewrite Assistant v5.1 (Marinara Engine v2.x compatibility)"
```

---

## Self-Review

**Spec coverage:**
- §1 commit path / black-box alignment → Tasks 1, 2. ✓
- §1a undo/redo via PATCH (+ guard removal) → Task 3. ✓
- §1b extension-native review → Task 4. ✓
- §2 lorebook `/lorebooks/scan/:chatId` → Task 5. ✓
- §3 theme polish (3 values) → Task 6. ✓
- §4 version banner → Task 7. ✓
- Dead-code removal (editor fns, `rwa-msg-hl`, `observe`, `start-edit-message`) → Task 3. ✓
- `selfcheck.mjs` drift-guard updates → Tasks 1–3. ✓
- Bundles rebuilt via `build.mjs` → every task. ✓
- Two "needs live verification" items (scan shape, macro-boundary edge) → Task 5 Step 1 (scan), Task 1 Step 1 macro-boundary assertion + Task 2 Step 6 Chrome check. ✓

**Type consistency:** `mapRenderedSpanToRaw -> {as,ae}|null` used identically in Task 1 (def) and Task 2 (consume). `patchMessage(cid,mid,content)` defined Task 2, consumed Tasks 3, 4. `renderedTextForMid(mid)` defined/consumed Task 2. `reviewThenPatch(cid,mid,oldContent,proposed,onDone)` defined/consumed Task 4. `doCommit(newText, savedSel, onDone)` signature preserved (4 existing call sites unchanged). ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code; the one genuinely runtime-dependent value (scan entry field names) is gated behind an explicit verify-first step with a documented baseline + fallback. ✓
