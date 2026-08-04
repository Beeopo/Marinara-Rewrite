# Rewrite Assistant v6.0 — Marinara Engine 2.4 Personal Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Rewrite Assistant from the removed Marinara 2.0 extension bridge to the Marinara 2.4 Personal Extensions full-page runtime, without losing any user's saved profiles, history, or settings.

**Architecture:** Marinara 2.4 replaced `extensions` with `personal-extensions`. The new host object drops `apiFetch`, `on`, `addStyle`, and `extensionId` but keeps `setTimeout`/`setInterval`/`onCleanup`. Rather than rewrite ~3,300 lines of call sites, we rename the IIFE parameter to `host` and rebuild a `marinara` shim on top of it — the body is untouched. CSS moves out of the deleted `addStyle` call into the manifest's `css` field so the engine owns stylesheet teardown. The storage namespace becomes a fixed literal with a one-time non-destructive adoption of the old random-id namespace. The auto-update loader is deleted outright: approval binds to the SHA-256 of stored code, so runtime code fetching is architecturally dead, not just CSP-blocked.

**Tech Stack:** Vanilla ES5-style browser JS (no build step beyond `build.mjs`), Node ≥18 for `build.mjs` / `selfcheck.mjs`, `node:assert` for checks. No test framework — `selfcheck.mjs` is the suite.

**User decisions (already made):**
- "1 - yeah go ahead and split" — CSS is extracted to `extension.css` and shipped via the manifest `css` field, not inlined in `extension.js`.
- "2 V 6 is fine." — version is `6.0.0`; the loader removal is treated as a breaking change.
- "yes, do an adversarial review of the findings" — the six holes found in that review are the basis for Tasks 1, 4, and 7 below.

**Engine facts this plan depends on (verified at engine commit `c82291d6c`, v2.4.0):**

| Fact | Source |
|---|---|
| Full-page JS is spliced into `run(extension, async (marinara) => { "use strict"; <js> })` | `packages/server/src/routes/personal-extensions.routes.ts:210` |
| Full-page API is only `{version, extension, log, storage, setTimeout, clearTimeout, setInterval, clearInterval, onCleanup}` | `packages/client/src/components/layout/PersonalExtensionInjector.tsx:35` |
| Explicit `capabilities` in the manifest wins over the legacy `kind` heuristic | `packages/client/src/lib/personal-extension-import.ts:110` |
| `full_page_access` is the capability string | `packages/shared/src/types/personal-extension.ts:11` |
| `blob:` was removed from CSP `script-src` | `packages/server/src/middleware/security-headers.ts:30` |
| CSRF header is `x-marinara-csrf: 1` | `packages/shared/src/constants/security.ts:1` |
| `PATCH /api/chats/:chatId/messages/:messageId` takes `{content}`, returns the message | `packages/server/src/routes/chats.routes.ts:1860` |
| Both the old and new engines generate their own extension id and ignore the manifest's | baseline `extensions.storage.ts` `create()`; new `personal-extension.schema.ts` has no `id` field |

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `loader.js` | Delete | Auto-update loader — obsolete, see Task 1 |
| `rewrite-assistant-loader.json` | Delete | Loader bundle — obsolete |
| `extension.css` | Create | All Rewrite Assistant styles, previously passed to `marinara.addStyle` |
| `extension.js` | Modify | Behavior. Gains a host compat shim at the top; loses the `addStyle` block and the derived namespace |
| `build.mjs` | Modify | Generates the manifest object and splices `extension.js` + `extension.css` into it |
| `selfcheck.mjs` | Modify | Assertions + drift guards. Gains legacy-namespace-adoption coverage |
| `rewrite-assistant.json` | Regenerate | The installable bundle, now in the 2.4 manifest schema |
| `README.md` | Modify | Install (two gates, hash approval, no loader) and Development sections |
| `CHANGELOG.md` | Modify | v6.0 entry |

---

### Task 1: Retire the auto-update loader

**Goal:** Delete the loader and every reference to it in the build and check pipeline, because approval binds to the SHA-256 of stored code and runtime code fetching can no longer work by design.

**Files:**
- Delete: `loader.js`
- Delete: `rewrite-assistant-loader.json`
- Modify: `build.mjs` (header comment; delete steps 4 and 5)
- Modify: `selfcheck.mjs` (delete the `_LOADER` drift guard)

**Acceptance Criteria:**
- [ ] `loader.js` and `rewrite-assistant-loader.json` no longer exist in the repo
- [ ] `build.mjs` writes exactly one file and mentions no loader
- [ ] `selfcheck.mjs` does not read `loader.js` (it would throw ENOENT)
- [ ] `node selfcheck.mjs && node build.mjs` both exit 0

**Verify:** `node selfcheck.mjs && node build.mjs` → prints "selfcheck: ... passed" lines then exactly one `build: wrote rewrite-assistant.json ... OK` line, and no line mentioning the loader.

**Steps:**

- [ ] **Step 1: Delete the `_LOADER` drift guard in `selfcheck.mjs`**

Find and delete these two lines (they sit at the end of the drift-guard block, just before `console.log("drift-guard assertions passed")`):

```js
const _LOADER = _rf(new URL("./loader.js", import.meta.url), "utf8");
assert.ok(_LOADER.includes("allowRemote"), "drift: loader.js allowRemote gate missing");
```

- [ ] **Step 2: Run selfcheck to confirm it still passes with the guard gone**

Run: `node selfcheck.mjs`
Expected: exits 0, prints `drift-guard assertions passed` among the other passing lines.

- [ ] **Step 3: Delete loader steps 4 and 5 from `build.mjs`**

Delete everything from the `// 4) Loader bundle` comment to the end of the file. The file must now end at the line:

```js
console.log(`build: wrote ${BUNDLE} (${out.length} chars; js ${source.length} chars) OK`);
```

Also delete these two now-unused constants near the top:

```js
const LOADER_SRC = "loader.js";
const LOADER_BUNDLE = "rewrite-assistant-loader.json";
```

And replace this line in the header comment:

```js
// A second bundle (rewrite-assistant-loader.json) is also written from loader.js.
```

with:

```js
// There is no auto-update loader: Marinara 2.4 binds approval to the SHA-256 of the
// stored code, so any runtime-fetched code would bypass the review it exists to enforce.
```

- [ ] **Step 4: Delete the loader source and bundle**

```bash
git rm loader.js rewrite-assistant-loader.json
```

- [ ] **Step 5: Run the pipeline to verify**

Run: `node selfcheck.mjs && node build.mjs`
Expected: exits 0. Exactly one `build: wrote rewrite-assistant.json (...) OK` line. No loader output.

- [ ] **Step 6: Commit**

```bash
git add build.mjs selfcheck.mjs rewrite-assistant.json
git commit -m "chore: retire the auto-update loader

Marinara 2.4 binds extension approval to the SHA-256 of stored code, so a
loader that fetches code at runtime bypasses the review gate it depends on.
The engine's CSP also dropped blob: from script-src, which blocks the
loader's execution path outright."
```

---

### Task 2: Extract the stylesheet into `extension.css`

**Goal:** Move the CSS out of the removed `marinara.addStyle` call into a standalone `extension.css` that ships in the manifest's `css` field, so the engine creates and tears down the stylesheet node.

**Files:**
- Create: `extension.css`
- Modify: `extension.js:872-1022` (delete the `marinara.addStyle( ... );` call and its `// ── Styles ──` header)
- Modify: `build.mjs` (read and splice `extension.css`)
- Modify: `selfcheck.mjs` (add drift guards)

**Acceptance Criteria:**
- [ ] `extension.css` contains every rule previously passed to `addStyle`, as plain CSS with no JS string concatenation
- [ ] `extension.js` contains no occurrence of `addStyle`
- [ ] `build.mjs` splices `extension.css` into the bundle's `css` field and round-trip checks it
- [ ] The built bundle's `css` is byte-identical to `extension.css`
- [ ] `selfcheck.mjs` fails if `addStyle` reappears in `extension.js` or `extension.css` goes missing/empty

**Verify:** `node selfcheck.mjs && node build.mjs && node -e "const b=require('./rewrite-assistant.json'),f=require('fs');if(b.css!==f.readFileSync('extension.css','utf8'))throw new Error('css mismatch');if(!b.css.includes('.rwa{'))throw new Error('css empty');console.log('css splice OK')"` → prints `css splice OK`

**Steps:**

- [ ] **Step 1: Add the failing drift guards to `selfcheck.mjs`**

In the drift-guard block (after the existing `assert.ok(_SRC.includes("fetchSpeakerNote"), ...)` line), add:

```js
// v6.0: styles moved out of the removed marinara.addStyle bridge into extension.css,
// which the manifest ships in its own `css` field so the engine owns teardown.
assert.ok(!/addStyle/.test(_SRC), "drift: extension.js still calls addStyle (removed in Marinara 2.4)");
const _CSS = _rf(new URL("./extension.css", import.meta.url), "utf8");
assert.ok(_CSS.includes(".rwa{"), "drift: extension.css missing the base .rwa rule");
assert.ok(_CSS.includes(".rwa-win "), "drift: extension.css missing the .rwa-win rules");
```

- [ ] **Step 2: Run selfcheck to verify it fails**

Run: `node selfcheck.mjs`
Expected: FAIL. Either `Cannot find module`/ENOENT for `extension.css`, or `AssertionError: drift: extension.js still calls addStyle (removed in Marinara 2.4)`.

- [ ] **Step 3: Create `extension.css` from the current `addStyle` argument**

Take the JS string expression currently spanning `extension.js:874-1021` (the argument to `marinara.addStyle(`, from `".rwa{position:fixed;..."` through `".rwa-win ::-webkit-scrollbar-thumb:hover{background:var(--primary);}"`), concatenate every string literal in order, and write the result as plain CSS. Mechanically: strip the leading/trailing `"` on each literal, drop the ` +` joiners, unescape `\"` to `"`, and put each rule on its own line.

Add this header at the top of the new file:

```css
/* Rewrite Assistant v6.0 — styles.
   Shipped in the manifest's `css` field. Marinara injects this as a <link> it owns
   and removes on disable, so the extension never manages a <style> node itself. */
```

Correctness check for this step: the concatenated CSS must contain, in order, `.rwa{`, `@keyframes rwa-in{`, `.rwa-topbar{`, and end with `.rwa-win ::-webkit-scrollbar-thumb:hover{background:var(--primary);}`.

- [ ] **Step 4: Delete the `addStyle` call from `extension.js`**

Delete lines `872-1022` inclusive — the section header, the call, and its closing `);`:

```js
  // ── Styles ────────────────────────────────────────────────────────────────

  marinara.addStyle(
        ".rwa{position:fixed;...
    ...
    ".rwa-win ::-webkit-scrollbar-thumb:hover{background:var(--primary);}"

  );
```

Leave the `// ── Tooltip helpers ──` section that follows it intact.

- [ ] **Step 5: Splice the CSS in `build.mjs`**

Add next to the existing `SOURCE` constant:

```js
const STYLES = "extension.css";
```

After the line `bundle.js = source;` add:

```js
const styles = readFileSync(STYLES, "utf8");
bundle.css = styles;
```

And extend the round-trip check — replace:

```js
if (check.js !== source) {
  console.error("build: round-trip mismatch — bundle js does not equal extension.js.");
  process.exit(1);
}
```

with:

```js
if (check.js !== source) {
  console.error("build: round-trip mismatch — bundle js does not equal extension.js.");
  process.exit(1);
}
if (check.css !== styles) {
  console.error("build: round-trip mismatch — bundle css does not equal extension.css.");
  process.exit(1);
}
```

Then update the success log to report both:

```js
console.log(`build: wrote ${BUNDLE} (${out.length} chars; js ${source.length} chars; css ${styles.length} chars) OK`);
```

- [ ] **Step 6: Run the verify command**

Run: `node selfcheck.mjs && node build.mjs && node -e "const b=require('./rewrite-assistant.json'),f=require('fs');if(b.css!==f.readFileSync('extension.css','utf8'))throw new Error('css mismatch');if(!b.css.includes('.rwa{'))throw new Error('css empty');console.log('css splice OK')"`
Expected: PASS — selfcheck lines, one build OK line reporting non-zero css chars, then `css splice OK`.

- [ ] **Step 7: Commit**

```bash
git add extension.css extension.js build.mjs selfcheck.mjs rewrite-assistant.json
git commit -m "refactor: ship styles via the manifest css field

Marinara 2.4 removed marinara.addStyle. Styles now live in extension.css and
are spliced into the manifest's css field, so the engine creates the stylesheet
node and removes it on disable instead of the extension managing its own."
```

---

### Task 3: Rebuild the removed host APIs as a compatibility shim

**Goal:** Restore `apiFetch`, `on`, and `extensionId` on top of the Marinara 2.4 full-page host object so the existing ~3,300 lines of call sites keep working unchanged.

**Files:**
- Modify: `extension.js:1-6` (rename IIFE parameter, insert the shim)
- Modify: `extension.js:3339` (the trailing `})(marinara);` stays as-is — it refers to the engine's binding)
- Modify: `selfcheck.mjs` (drift guards)

**Acceptance Criteria:**
- [ ] The IIFE parameter is `host`; a local `marinara` object is built from it
- [ ] `apiFetch(path, opts)` prefixes `/api`, sends `x-marinara-csrf: 1` on non-GET/HEAD, and resolves to parsed JSON *regardless of HTTP status* (the old bridge did not check `res.ok`, and `patchMessage` depends on receiving the `{error}` body)
- [ ] `apiFetch` resolves `null` rather than rejecting when the body is not JSON
- [ ] `on(target, type, handler)` registers via `addEventListener` and registers the matching `removeEventListener` with `host.onCleanup`
- [ ] `setTimeout`, `setInterval`, `onCleanup`, `log`, `storage`, `extension` pass through to the host
- [ ] The whole file still parses under strict mode inside an async arrow wrapper

**Verify:** `node selfcheck.mjs` → passes, including the new `shim` drift guards; plus the strict-mode parse check in Step 5 prints `STRICT-MODE PARSE: OK`

**Steps:**

- [ ] **Step 1: Add the failing drift guards to `selfcheck.mjs`**

In the drift-guard block, after the guards added in Task 2, add:

```js
// v6.0: Marinara 2.4's full-page host object dropped apiFetch/on/addStyle/extensionId.
// The shim rebuilds them so the 5.1 body needs no call-site changes.
assert.ok(/^\(function \(host\) \{/m.test(_SRC), "drift: IIFE parameter is not `host` (shim missing)");
assert.ok(_SRC.includes("var marinara = {"), "drift: compat shim object missing");
assert.ok(_SRC.includes('"x-marinara-csrf"'), "drift: apiFetch shim not sending the CSRF header");
assert.ok(_SRC.includes('fetch("/api" + path'), "drift: apiFetch shim not prefixing /api");
assert.ok(_SRC.includes("removeEventListener"), "drift: on() shim not registering teardown");
```

- [ ] **Step 2: Run selfcheck to verify it fails**

Run: `node selfcheck.mjs`
Expected: FAIL with `AssertionError: drift: IIFE parameter is not \`host\` (shim missing)`.

- [ ] **Step 3: Replace `extension.js` lines 1-3 with the shim**

Replace:

```js
// Rewrite Assistant v5.1 — Marinara Engine v2.x Compatibility
(function (marinara) {
  "use strict";
```

with:

```js
// Rewrite Assistant v6.0 — Marinara Engine v2.4 Personal Extensions (full page)
(function (host) {
  "use strict";

  // ── Host compatibility shim ───────────────────────────────────────────────
  // Marinara 2.4 replaced the extension bridge with the Personal Extensions
  // full-page runtime. The engine splices this file into
  //   run(extension, async (marinara) => { "use strict"; <this file> })
  // and that `marinara` is now only
  //   { version, extension, log, storage, setTimeout, clearTimeout,
  //     setInterval, clearInterval, onCleanup }
  // — apiFetch, on, addStyle, and extensionId are gone. Rebuilding those four
  // here is a ~30-line change; rewriting their ~3,300 lines of call sites is not.
  // addStyle has no shim: the CSS ships in the manifest's `css` field instead.
  var marinara = {
    extension:   host.extension,
    log:         host.log,
    storage:     host.storage,
    setTimeout:  host.setTimeout,
    setInterval: host.setInterval,
    onCleanup:   host.onCleanup,
    extensionId: host.extension.id,

    // The old bridge resolved to parsed JSON and did NOT check res.ok, so callers
    // detect failure from the response shape instead of a rejection — see
    // patchMessage's `res.error || res.id == null` test. Preserve that exactly:
    // parse the body whatever the status, and resolve null when it isn't JSON at
    // all (an HTML error page), which patchMessage already treats as a failure.
    apiFetch: function (path, opts) {
      var o = opts || {};
      var method = (o.method || "GET").toUpperCase();
      var headers = Object.assign({}, o.headers);
      if (method !== "GET" && method !== "HEAD") headers["x-marinara-csrf"] = "1";
      return fetch("/api" + path, Object.assign({}, o, { headers: headers, cache: "no-store" }))
        .then(function (r) { return r.json().catch(function () { return null; }); });
    },

    // The old bridge removed its listeners when the extension was disabled.
    // addEventListener does not, so register the teardown with the host.
    on: function (target, type, handler, options) {
      target.addEventListener(type, handler, options);
      host.onCleanup(function () { target.removeEventListener(type, handler, options); });
    }
  };
```

The rest of the file — starting at `// ── Storage ──` — is unchanged, as is the trailing `})(marinara);`, which resolves to the engine's binding.

- [ ] **Step 4: Run selfcheck to verify it passes**

Run: `node selfcheck.mjs`
Expected: PASS — `drift-guard assertions passed` among the output.

- [ ] **Step 5: Verify the file parses under the engine's exact wrapper**

The engine wraps the file in `run(extension, async (marinara) => { "use strict"; <js> })`, which is strict mode and an async function body. Confirm the file still parses there:

```bash
{ printf '"use strict";\n(async (marinara) => {\n"use strict";\n'; cat extension.js; printf '\n});\n'; } > /tmp/rwa-strictcheck.mjs && node --check /tmp/rwa-strictcheck.mjs && echo "STRICT-MODE PARSE: OK"
```

Expected: `STRICT-MODE PARSE: OK`

- [ ] **Step 6: Build and commit**

```bash
node build.mjs
git add extension.js selfcheck.mjs rewrite-assistant.json
git commit -m "feat: rebuild apiFetch/on/extensionId on the 2.4 host object

Marinara 2.4's full-page extension API is only {version, extension, log,
storage, timers, onCleanup}. Rename the IIFE parameter to host and construct
a marinara shim from it, so the existing call sites are untouched. apiFetch
preserves the old bridge's resolve-on-4xx/5xx behaviour, which patchMessage
relies on to detect a failed write."
```

---

### Task 4: Fix the storage namespace and adopt existing installs

**Goal:** Pin the localStorage namespace to a fixed literal, and copy a previous install's data across on first run, because both the old and new engines generate a fresh extension id on every import — so the 5.x namespace moved every time.

**Files:**
- Modify: `extension.js` (the `// ── Storage ──` block: `NS` definition, add `SUFFIXES` and `adoptLegacyNamespace`)
- Modify: `extension.js` (shim: drop the now-unused `extensionId` key)
- Modify: `selfcheck.mjs` (add section 7 — adoption assertions)

**Acceptance Criteria:**
- [ ] `NS` is the literal `"rwa-rewrite-assistant"`, derived from nothing
- [ ] On a fresh install (no `rwa-*` keys) adoption is a no-op and returns `null`
- [ ] With a legacy `rwa-<id>-*` set present and the fixed namespace empty, every present suffix is copied to the fixed namespace
- [ ] Absent legacy suffixes are skipped, not written as `"null"`
- [ ] When the fixed namespace already has `-p`, adoption returns `null` and overwrites nothing
- [ ] Adoption **copies, never deletes** — the legacy keys survive untouched so a rollback to 5.1 still works
- [ ] `selfcheck.mjs` covers all five cases above

**Verify:** `node selfcheck.mjs` → prints `selfcheck: legacy-namespace adoption assertions passed`

**Steps:**

- [ ] **Step 1: Write the failing assertions in `selfcheck.mjs`**

Append a new section after the existing section 6 blocks (before nothing in particular — end of file is fine):

```js
// 7) legacy-namespace adoption (mirror of extension.js adoptLegacyNamespace).
// 5.x derived its namespace from the engine-generated extension id, which is
// regenerated on every import, so each re-import stranded the previous data.
const _NS = "rwa-rewrite-assistant";
const _SUF = ["-p", "-c", "-h", "-r", "-x", "-a", "-dbg", "-ledger"];
function _fakeLS(seed) {
  const m = { ...seed };
  return {
    get length() { return Object.keys(m).length; },
    key: (i) => Object.keys(m)[i] ?? null,
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    dump: () => m,
  };
}
function _adopt(ls) {
  // <<< keep this mirror IDENTICAL in logic to extension.js's adoptLegacyNamespace >>>
  if (ls.getItem(_NS + "-p") !== null) return null;
  let old = null;
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (!k || k.slice(-2) !== "-p" || k.indexOf("rwa-") !== 0) continue;
    const prefix = k.slice(0, -2);
    if (prefix === _NS) continue;
    old = prefix;
    break;
  }
  if (!old) return null;
  for (let j = 0; j < _SUF.length; j++) {
    const v = ls.getItem(old + _SUF[j]);
    if (v !== null) ls.setItem(_NS + _SUF[j], v);
  }
  return old;
}

// (a) fresh install: nothing to adopt, nothing written
{
  const ls = _fakeLS({});
  assert.equal(_adopt(ls), null);
  assert.deepEqual(ls.dump(), {});
}
// (b) legacy install: every present suffix copied, absent ones skipped
{
  const ls = _fakeLS({
    "rwa-9f3c1a2b-p": '[{"id":"expand"}]',
    "rwa-9f3c1a2b-c": '{"temp":0.8}',
    "rwa-9f3c1a2b-h": "[]",
    "unrelated-key": "keep me",
  });
  assert.equal(_adopt(ls), "rwa-9f3c1a2b");
  assert.equal(ls.getItem(_NS + "-p"), '[{"id":"expand"}]');
  assert.equal(ls.getItem(_NS + "-c"), '{"temp":0.8}');
  assert.equal(ls.getItem(_NS + "-h"), "[]");
  assert.equal(ls.getItem(_NS + "-ledger"), null, "absent suffix must not be written");
  assert.equal(ls.getItem("unrelated-key"), "keep me");
}
// (c) non-destructive: the legacy keys survive so a rollback to 5.1 still reads them
{
  const ls = _fakeLS({ "rwa-9f3c1a2b-p": "LEGACY" });
  _adopt(ls);
  assert.equal(ls.getItem("rwa-9f3c1a2b-p"), "LEGACY", "adoption must copy, never move");
}
// (d) already migrated: no-op, never clobbers newer data
{
  const ls = _fakeLS({ [_NS + "-p"]: "NEW", "rwa-9f3c1a2b-p": "OLD" });
  assert.equal(_adopt(ls), null);
  assert.equal(ls.getItem(_NS + "-p"), "NEW");
}
// (e) the fixed namespace's own key is never treated as a legacy source
{
  const ls = _fakeLS({ [_NS + "-c"]: "x" });
  assert.equal(_adopt(ls), null);
}
console.log("selfcheck: legacy-namespace adoption assertions passed");
```

- [ ] **Step 2: Run selfcheck to verify the new section passes but the drift guard fails**

Add the drift guard in the drift-guard block first:

```js
assert.ok(_SRC.includes("function adoptLegacyNamespace"), "drift: adoptLegacyNamespace missing");
assert.ok(_SRC.includes('var NS = "rwa-rewrite-assistant"'), "drift: storage namespace is not the fixed literal");
```

Run: `node selfcheck.mjs`
Expected: FAIL with `AssertionError: drift: adoptLegacyNamespace missing`.

- [ ] **Step 3: Replace the `// ── Storage ──` header block in `extension.js`**

Replace:

```js
  // ── Storage ───────────────────────────────────────────────────────────────
  var NS = "rwa-" + marinara.extensionId;
  var K_PROF  = NS + "-p";
  var K_CFG   = NS + "-c";
  var K_HIST  = NS + "-h";
  var K_REDO  = NS + "-r";
  var K_CUST  = NS + "-x";
  var K_AUTO  = NS + "-a";
  var K_DBG   = NS + "-dbg";
  var K_LEDGER = NS + "-ledger";
```

with:

```js
  // ── Storage ───────────────────────────────────────────────────────────────
  // Fixed namespace. 5.x used "rwa-" + the engine-generated extension id, but both
  // the old and the new engine mint a fresh id on every import, so the namespace
  // moved each time and stranded the previous install's profiles and history.
  var NS = "rwa-rewrite-assistant";
  var SUFFIXES = ["-p", "-c", "-h", "-r", "-x", "-a", "-dbg", "-ledger"];
  var K_PROF  = NS + "-p";
  var K_CFG   = NS + "-c";
  var K_HIST  = NS + "-h";
  var K_REDO  = NS + "-r";
  var K_CUST  = NS + "-x";
  var K_AUTO  = NS + "-a";
  var K_DBG   = NS + "-dbg";
  var K_LEDGER = NS + "-ledger";

  // One-time adoption of a 5.x install's data: find the old "rwa-<id>-*" set by its
  // profiles key and copy it onto the fixed namespace. Guarded on the fixed
  // namespace being empty, so re-running never clobbers newer data. Copies rather
  // than moves — the legacy keys stay readable if the user rolls back to 5.1.
  function adoptLegacyNamespace() {
    try {
      if (localStorage.getItem(NS + "-p") !== null) return null;
      var old = null;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.slice(-2) !== "-p" || k.indexOf("rwa-") !== 0) continue;
        var prefix = k.slice(0, -2);
        if (prefix === NS) continue;
        old = prefix;
        break;
      }
      if (!old) return null;
      for (var j = 0; j < SUFFIXES.length; j++) {
        var v = localStorage.getItem(old + SUFFIXES[j]);
        if (v !== null) localStorage.setItem(NS + SUFFIXES[j], v);
      }
      return old;
    } catch (e) { return null; }
  }
  var _adoptedFrom = adoptLegacyNamespace();
  if (_adoptedFrom) marinara.log.info("adopted settings from legacy namespace " + _adoptedFrom);
```

- [ ] **Step 4: Remove the now-unused `extensionId` key from the shim**

In the shim object added in Task 3, delete this line — `NS` was its only consumer:

```js
    extensionId: host.extension.id,
```

- [ ] **Step 5: Run selfcheck to verify it passes**

Run: `node selfcheck.mjs`
Expected: PASS, printing `selfcheck: legacy-namespace adoption assertions passed` and `drift-guard assertions passed`.

- [ ] **Step 6: Confirm `extensionId` is fully gone**

```bash
grep -n "extensionId" extension.js
```

Expected: no output (exit 1).

- [ ] **Step 7: Build and commit**

```bash
node build.mjs
git add extension.js selfcheck.mjs rewrite-assistant.json
git commit -m "fix: pin the storage namespace and adopt legacy installs

The namespace was derived from the engine-generated extension id, which is
minted fresh on every import — so each re-import silently stranded the user's
profiles, history, and settings. Pin it to a literal and copy a previous
install's keys across on first run. Non-destructive: the legacy keys are left
in place so a rollback still reads them."
```

---

### Task 5: Emit the Marinara 2.4 manifest schema

**Goal:** Generate `rewrite-assistant.json` in the 2.4 Personal Extension schema so it imports with **Full page access** instead of silently landing in the sandboxed Worker where it can reach neither the DOM nor `/api`.

**Files:**
- Modify: `build.mjs` (build the manifest object in code instead of reusing the old file's keys)
- Regenerate: `rewrite-assistant.json`
- Modify: `selfcheck.mjs` (assert the emitted manifest shape)

**Acceptance Criteria:**
- [ ] The bundle has `name`, `version`, `description`, `runtime: "client"`, `capabilities: ["full_page_access"]`, `css`, `js`
- [ ] The bundle has **no** `id` and **no** `enabled` key — both were dropped from the 2.4 schema and would be silently stripped
- [ ] `version` is `"6.0.0"`
- [ ] `build.mjs` is the single source of the manifest metadata; the JSON is never hand-edited
- [ ] `selfcheck.mjs` fails if the emitted manifest drifts from that shape

**Verify:** `node build.mjs && node -e "const b=require('./rewrite-assistant.json');const a=require('assert');a.equal(b.runtime,'client');a.deepEqual(b.capabilities,['full_page_access']);a.equal(b.version,'6.0.0');a.ok(!('id' in b),'id must be gone');a.ok(!('enabled' in b),'enabled must be gone');a.ok(b.js.length>1000&&b.css.length>1000);console.log('manifest shape OK')"` → prints `manifest shape OK`

**Steps:**

- [ ] **Step 1: Replace the bundle construction in `build.mjs`**

Replace:

```js
// 2) Splice source into the bundle, preserving key order + metadata.
const bundle = JSON.parse(readFileSync(BUNDLE, "utf8"));
const source = readFileSync(SOURCE, "utf8");
bundle.js = source;
const styles = readFileSync(STYLES, "utf8");
bundle.css = styles;
```

with:

```js
// 2) Build the manifest fresh. Marinara 2.4's schema has no `id` or `enabled` —
//    the engine mints its own id and every import starts disabled pending hash
//    approval — and `capabilities` must be explicit: without it the import path
//    defaults to the sandboxed Worker, which has no DOM and no /api access, so
//    the extension would install cleanly and then do nothing.
//    See packages/client/src/lib/personal-extension-import.ts in the engine.
const MANIFEST = {
  name: "Rewrite Assistant",
  version: "6.0.0",
  description:
    "Highlight text in any message to rewrite with AI. v6.0: Marinara Engine v2.4 " +
    "Personal Extensions — full-page capability, host compatibility shim, " +
    "manifest-owned stylesheet, and a fixed storage namespace that survives re-imports.",
  runtime: "client",
  capabilities: ["full_page_access"],
};
const source = readFileSync(SOURCE, "utf8");
const styles = readFileSync(STYLES, "utf8");
const bundle = { ...MANIFEST, css: styles, js: source };
```

- [ ] **Step 2: Run the build and check the shape**

Run: `node build.mjs && node -e "const b=require('./rewrite-assistant.json');const a=require('assert');a.equal(b.runtime,'client');a.deepEqual(b.capabilities,['full_page_access']);a.equal(b.version,'6.0.0');a.ok(!('id' in b),'id must be gone');a.ok(!('enabled' in b),'enabled must be gone');a.ok(b.js.length>1000&&b.css.length>1000);console.log('manifest shape OK')"`
Expected: `build: wrote rewrite-assistant.json (...) OK` then `manifest shape OK`.

- [ ] **Step 3: Add a manifest drift guard to `selfcheck.mjs`**

In the drift-guard block, add:

```js
// v6.0: build.mjs owns the manifest. Guard the two fields that decide whether the
// extension runs in the page or dies silently in the sandboxed Worker.
const _BUILD = _rf(new URL("./build.mjs", import.meta.url), "utf8");
assert.ok(_BUILD.includes('capabilities: ["full_page_access"]'), "drift: manifest does not request full_page_access");
assert.ok(_BUILD.includes('runtime: "client"'), "drift: manifest runtime is not client");
assert.ok(!/^\s*id:/m.test(_BUILD), "drift: manifest re-introduced an `id` field (not in the 2.4 schema)");
```

- [ ] **Step 4: Run selfcheck to verify it passes**

Run: `node selfcheck.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add build.mjs selfcheck.mjs rewrite-assistant.json
git commit -m "feat: emit the Marinara 2.4 personal-extension manifest

Declare runtime: client and capabilities: [full_page_access], and drop the
id/enabled keys that no longer exist in the 2.4 schema. Without an explicit
capabilities field the import path assumes the safe sandbox, where the
extension has no DOM and no /api access — it installs cleanly and then does
nothing at all."
```

---

### Task 6: Update the install and development docs

**Goal:** Document the two gates, the hash-approval flow, and the loader's removal, so a user following the README can actually get v6.0 running.

**Files:**
- Modify: `README.md:84-96` (Install)
- Modify: `README.md:170-186` (Development)
- Modify: `CHANGELOG.md` (new v6.0 entry above the v5.1 entry)

**Acceptance Criteria:**
- [ ] The Install section documents both gates (`ENABLE_EXTERNAL_EXTENSIONS=true`, then Danger Zone), the **Settings → Addons → External Extensions** path, and the hash approval
- [ ] The Install section explains that Full page access is requested and why
- [ ] No section of the README offers the loader as an install option
- [ ] The Development section names `extension.js` and `extension.css`, not `loader.js`
- [ ] `CHANGELOG.md` has a v6.0 entry covering all five breaks
- [ ] The Credits section is left untouched — its loader mention is historical attribution and stays accurate
- [ ] `grep -n "loader" README.md` returns only the Credits line

**Verify:** `grep -n "loader" README.md` → exactly one hit, on the Credits line about TCLowe1982

**Steps:**

- [ ] **Step 1: Replace the Install section in `README.md`**

Replace everything from `## Install` through the line `The unbundled source is in [\`extension.js\`](extension.js); the loader source is in [\`loader.js\`](loader.js).` with:

```markdown
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

**There is no auto-update loader any more.** Marinara binds approval to the exact hash of the
stored code, so every update needs a fresh import and a fresh approval — a loader that fetched
code at runtime would bypass the review it exists to enforce, and the engine's CSP now blocks
its execution path regardless.

Source lives in [`extension.js`](extension.js) and [`extension.css`](extension.css).
```

- [ ] **Step 2: Replace the Development section in `README.md`**

Replace everything from `## Development` through the closing fence of the `node build.mjs` block with:

```markdown
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
```

- [ ] **Step 3: Add the v6.0 entry to `CHANGELOG.md`**

Insert immediately after the `# Changelog` line and before `## v5.1 — ...`:

```markdown
## v6.0 — Marinara Engine v2.4 Personal Extensions

Marinara 2.4 replaced its extension system (`extensions` → `personal-extensions`,
sandboxed by default). v5.1 does not run on it at all — it installs and then does
nothing. This release ports the extension to the new full-page runtime.

- **Breaking:** the auto-update loader is gone. `loader.js` and
  `rewrite-assistant-loader.json` are deleted. Marinara binds approval to the SHA-256
  of the stored code, so any runtime-fetched code bypasses the review gate; the
  engine also dropped `blob:` from its CSP `script-src`, which blocked the loader's
  execution path outright. Updates now mean re-import and re-approve.
- **Breaking:** installing requires two gates to be open first —
  `ENABLE_EXTERNAL_EXTENSIONS=true` on the host, and **Allow third-party extension
  imports** in Settings → Advanced → Danger Zone. See the README.
- **Fixed:** the manifest now declares `runtime: "client"` and
  `capabilities: ["full_page_access"]`. Without an explicit capabilities field the
  2.4 import path assumes the safe sandbox, where the extension runs in a Worker
  with no DOM and no `/api` access — it would install cleanly and never work.
- **Fixed:** `apiFetch`, `on`, `addStyle`, and `extensionId` were all removed from
  the host object. The first three are rebuilt as a compatibility shim over the new
  API, preserving the old `apiFetch` behaviour of resolving on 4xx/5xx so a failed
  write is still detected from the response shape rather than being reported as
  "Applied".
- **Fixed:** settings no longer vanish on re-import. The storage namespace was
  derived from the engine-generated extension id, which is minted fresh every time
  the extension is imported, so each import stranded the previous install's
  profiles, history, and custom prompts. The namespace is now a fixed literal, and
  a first run copies a previous install's keys across without deleting them.
- **Changed:** styles moved from the removed `marinara.addStyle` call into
  `extension.css`, shipped in the manifest's `css` field so the engine creates and
  removes the stylesheet node itself.
```

- [ ] **Step 4: Verify no loader references remain outside Credits**

Run: `grep -n "loader" README.md`
Expected: exactly one line — the Credits bullet crediting TCLowe1982 with the loader. That is historical attribution and stays accurate; leave it.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document the 2.4 install flow and the loader removal

Install now needs both external-extension gates open and a hash approval, and
the extension requests Full page access. Explain why that capability is
required and why the auto-update loader could not be carried forward."
```

---

### Task 7: Verify the rewrite round-trip in a live Marinara 2.4.0

**Goal:** Confirm in a running Marinara 2.4.0 instance that selecting text in a message, rewriting it, and applying the result actually changes the stored message content, and that undo restores the original.

> **USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

**Files:**
- Modify: none (verification only)

**Acceptance Criteria:**
- [ ] Marinara 2.4.0 is running on `http://127.0.0.1:7860` and serving the client
- [ ] `rewrite-assistant.json` imports without a schema error and its **Requested access** list shows **Full page access**
- [ ] After approval the browser console shows no `[Personal Extension Rewrite Assistant] failed` error
- [ ] Selecting ≥2 characters inside a message opens the rewrite popup (or `Alt+R` does)
- [ ] **Before state captured:** the target message's stored `content` recorded verbatim via `GET /api/chats/<chatId>/messages`
- [ ] **After state captured:** the same field re-read after Apply, differing from the before state and containing the rewritten span
- [ ] The on-screen message re-renders with the new text without a page reload
- [ ] Undo restores the stored content to the recorded before state
- [ ] Existing profiles/settings from the previous install are present in the popup (namespace adoption worked), or — on a machine with no previous install — the defaults load cleanly

**Verify:** `curl -s http://127.0.0.1:7860/api/chats/<chatId>/messages | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s).find(x=>x.id==='<messageId>');console.log(JSON.stringify(m.content))})"` run once before Apply and once after → the two outputs differ, and the second contains the rewritten text.

**Steps:**

- [ ] **Step 1: Open both external-extension gates — USER ACTION REQUIRED**

This cannot be done from the extension repo. In `C:\ST\Marinara-Engine`:

1. Add `ENABLE_EXTERNAL_EXTENSIONS=true` to `.env`.
2. Start the server (step 2), then in the UI go to **Settings → Advanced → Danger Zone**, scroll past the data-deletion controls, and enable **Allow third-party extension imports**.

If either gate stays shut, nothing below can run — the record is hidden and unapprovable. Stop and report that rather than closing this task.

- [ ] **Step 2: Build and start the engine**

`pnpm dev` is known to crash under the standalone `pnpm.exe` on this machine — use build + start.

```bash
cd /c/ST/Marinara-Engine && pnpm build && pnpm start
```

Expected: server listening on `http://127.0.0.1:7860`. Before starting, check for a zombie process squatting the port and kill it if found.

- [ ] **Step 3: Import and approve**

In Marinara: **Settings → Addons → External Extensions** → import `C:\ST\Rewrite-Assistant\rewrite-assistant.json`. Confirm **Requested access** lists **Full page access**. Open the draft, compare the SHA-256, choose **Review and Run**.

Expected: the extension appears enabled. Capture the browser console — there must be no `[Personal Extension Rewrite Assistant] failed` line.

- [ ] **Step 4: Capture the BEFORE state**

Open a chat with at least one assistant message. Note its `data-message-id` from the DOM and the chat id from `localStorage["marinara-active-chat-id"]`, then:

```bash
curl -s "http://127.0.0.1:7860/api/chats/<chatId>/messages" > /tmp/rwa-before.json && node -e "const m=require('/tmp/rwa-before.json').find(x=>x.id==='<messageId>');console.log('BEFORE:',JSON.stringify(m.content))"
```

Record the printed `BEFORE:` line verbatim — it is the evidence for this gate's first axis.

- [ ] **Step 5: Exercise the rewrite**

Select a phrase inside that message (or press `Alt+R` with it selected). The popup must open. Run a rewrite with any profile and click Apply.

Expected: a toast confirming the apply, and the message text on screen updates without a page reload.

- [ ] **Step 6: Capture the AFTER state and diff**

```bash
curl -s "http://127.0.0.1:7860/api/chats/<chatId>/messages" > /tmp/rwa-after.json && node -e "const b=require('/tmp/rwa-before.json').find(x=>x.id==='<messageId>').content,a=require('/tmp/rwa-after.json').find(x=>x.id==='<messageId>').content;console.log('AFTER:',JSON.stringify(a));if(a===b)throw new Error('STORED CONTENT UNCHANGED — the PATCH did not land');console.log('CHANGED: stored content differs')"
```

Expected: prints the `AFTER:` line and `CHANGED: stored content differs`. If it throws, the write path is broken — do not close this task; report the failure with both captured strings.

- [ ] **Step 7: Verify undo**

Press undo in the popup (or the extension's undo control). Then re-run the AFTER capture command and confirm the content matches the recorded BEFORE string exactly.

Expected: stored content is byte-identical to the BEFORE capture.

- [ ] **Step 8: Verify namespace adoption**

Open the extension's Profiles list. On a machine that had v5.1 installed, the previous profiles, custom prompts, and settings must be present. Check the console for `[Personal Extension Rewrite Assistant] adopted settings from legacy namespace rwa-<id>`. On a clean machine, confirm the default profiles load without error instead.

- [ ] **Step 9: Report the evidence**

Post the BEFORE string, the AFTER string, the `CHANGED:` line, and the undo re-check. Only then close this task.

---

## Self-Review

**Spec coverage** — each break identified in the adversarial review maps to a task:

| Break | Task |
|---|---|
| Manifest lacks `capabilities` → silently sandboxed | 5 |
| Existing install is `source='legacy'` → hidden and unapprovable (fixed by fresh import) | 5, 7 |
| `apiFetch` gone (15 call sites) | 3 |
| `on`, `addStyle`, `extensionId` gone | 2 (addStyle), 3 (on, extensionId) |
| `loader.js` dead — CSP *and* hash-approval | 1 |
| Namespace orphans user data on every import | 4 |
| Two external-extension gates block everything | 6 (documented), 7 (opened) |
| Strict-mode async wrapper | 3 Step 5 |

**Placeholder scan:** every code step contains the literal code to write. No "TBD", no "add error handling", no "similar to Task N". The one place with a mechanical rather than literal transform — Task 2 Step 3, converting the JS string concatenation to CSS — carries an explicit correctness check naming the first three and last rules.

**Type consistency:** `NS`, `SUFFIXES`, and `adoptLegacyNamespace` are named identically in `extension.js` (Task 4 Step 3), the selfcheck mirror (`_NS`, `_SUF`, `_adopt`, Task 4 Step 1), and the drift guards. `host` is the IIFE parameter in Task 3 and stays that in Task 4. `STYLES`/`styles` in `build.mjs` are introduced in Task 2 Step 5 and reused in Task 5 Step 1. `MANIFEST` exists only in Task 5.
