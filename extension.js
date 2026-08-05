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
  // — apiFetch, on, and the old style-injection helper are gone.
  // Rebuilding the first two here is a ~30-line change; rewriting their
  // ~3,300 lines of call sites is not. The style helper (last) has no shim: the
  // CSS ships in the manifest's `css` field instead.
  // clearTimeout/clearInterval are deliberately not mirrored — nothing calls
  // them through the bridge, and the host cancels outstanding timers on teardown.
  var marinara = {
    log:         host.log,
    setTimeout:  host.setTimeout,
    setInterval: host.setInterval,
    onCleanup:   host.onCleanup,

    // The old bridge resolved to parsed JSON and did NOT check res.ok, so callers
    // detect failure from the response shape instead of a rejection — see
    // patchMessage's `res.error || res.id == null` test. Preserve that exactly:
    // parse the body whatever the status, and resolve null when it isn't JSON at
    // all (an HTML error page), which patchMessage already treats as a failure.
    apiFetch: function (path, opts) {
      var o = opts || {};
      var method = (o.method || "GET").toUpperCase();
      // Headers(), not a plain object: it normalizes every shape a caller might
      // pass (plain object, Headers instance, array of pairs). Object.assign on a
      // Headers instance yields {} — the entries aren't own properties — which
      // would silently drop the CSRF header on a write.
      var headers = new Headers(o.headers || {});
      if (method !== "GET" && method !== "HEAD") headers.set("x-marinara-csrf", "1");
      // The 2.x bridge set this on every request; the 2.4 host object does not, and
      // dropping it silently broke the DEFAULT sidecar mode: with no Content-Type the
      // browser sends text/plain, Fastify hands the route a raw string, and the zod
      // schema rejects it ("Expected object, received string") before the handler runs.
      // Restore the old contract here rather than at each call site.
      // Only for a string body. fetch derives the right Content-Type for FormData,
      // Blob and URLSearchParams itself — including a multipart boundary that cannot
      // be reconstructed once discarded — so forcing JSON on those would corrupt them.
      if (typeof o.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      return fetch("/api" + path, Object.assign({}, o, { headers: headers, cache: o.cache || "no-store" }))
        .then(function (r) { return r.json().catch(function () { return null; }); });
    },

    // The old bridge removed its listeners when the extension was disabled.
    // addEventListener does not, so register the teardown with the host.
    on: function (target, type, handler, options) {
      target.addEventListener(type, handler, options);
      host.onCleanup(function () { target.removeEventListener(type, handler, options); });
    }
  };

  // ── Storage ───────────────────────────────────────────────────────────────
  // Fixed namespace. 5.x used "rwa-" + the engine-generated extension id. The engine
  // dedupes an import by extension NAME and patches the existing row in place, so a
  // same-name reimport keeps its id — but the old manifest baked the version into the
  // name ("Rewrite Assistant v5.1"), so every release imported as a brand-new
  // extension, got a fresh id, and stranded the previous install's profiles and
  // history. v6.0's name carries no version, which fixes that half independently.
  var NS = "rwa-rewrite-assistant";
  // "-p" is LAST on purpose: it doubles as the "already adopted" sentinel below.
  // Writing it first would make a mid-copy throw (localStorage quota — and a copy
  // transiently doubles usage) look like a completed adoption forever, stranding
  // every suffix after it. Written last, a failed run leaves the sentinel absent
  // and the next load retries; re-copying is idempotent.
  var SUFFIXES = ["-c", "-h", "-r", "-x", "-a", "-dbg", "-ledger", "-p"];
  var K_PROF  = NS + "-p";
  var K_CFG   = NS + "-c";
  var K_HIST  = NS + "-h";
  var K_REDO  = NS + "-r";
  var K_CUST  = NS + "-x";
  var K_AUTO  = NS + "-a";
  var K_DBG   = NS + "-dbg";
  var K_LEDGER = NS + "-ledger";

  // Newest write time in a namespace's history, or 0. History entries carry
  // `when: Date.now()`, so this is a real recency signal — unlike localStorage
  // enumeration order, which the spec leaves implementation-defined.
  function legacyRecency(prefix) {
    try {
      var h = JSON.parse(localStorage.getItem(prefix + "-h"));
      if (!Array.isArray(h)) return 0;
      var best = 0;
      for (var i = 0; i < h.length; i++) {
        if (h[i] && typeof h[i].when === "number" && h[i].when > best) best = h[i].when;
      }
      return best;
    } catch (e) { return 0; }
  }

  // One-time adoption of a 5.x install's data: find the old "rwa-<id>-*" sets by
  // their profiles key and copy the most recently used one onto the fixed
  // namespace. Guarded on the fixed namespace being empty, so re-running never
  // clobbers newer data. Copies rather than moves — the legacy keys stay readable
  // if the user rolls back to 5.1.
  //
  // There can be several: every 5.x re-import minted a fresh namespace, which is
  // the bug this exists to repair, so a user who re-imported has one set per
  // import. Picking the first or last enumerated would be a coin flip on
  // implementation-defined ordering and could restore months-old settings over
  // current ones, so score by history recency instead. `>=` lets a later
  // candidate win a tie, which keeps the no-history case deterministic.
  function adoptLegacyNamespace() {
    try {
      if (localStorage.getItem(NS + "-p") !== null) return null;
      var old = null, bestWhen = -1;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.slice(-2) !== "-p" || k.indexOf("rwa-") !== 0) continue;
        var prefix = k.slice(0, -2);
        if (prefix === NS) continue;
        var when = legacyRecency(prefix);
        if (when >= bestWhen) { bestWhen = when; old = prefix; }
      }
      if (!old) return null;
      // Copy is not atomic (localStorage has no transactions), so track which
      // suffixes actually landed. A mid-copy throw (quota is a live concern here —
      // see the comment above on transient doubled usage) rolls back everything
      // written so far, rather than leaving the current load to boot on a mixed
      // legacy/default state. The sentinel-last ordering still makes a *later*
      // retry safe; this makes the *current* load safe too.
      // Snapshot the PRIOR value of each key before overwriting it, so a rollback can
      // restore rather than delete. Recording only "I touched this" and removing it
      // would erase a real pre-existing value — turning "overwritten with a stale
      // legacy value" into "gone, fall back to hardcoded defaults", which is worse
      // than the bug the rollback exists to prevent.
      var written = [];
      try {
        for (var j = 0; j < SUFFIXES.length; j++) {
          var v = localStorage.getItem(old + SUFFIXES[j]);
          if (v !== null) {
            written.push([SUFFIXES[j], localStorage.getItem(NS + SUFFIXES[j])]);
            localStorage.setItem(NS + SUFFIXES[j], v);
          }
        }
      } catch (e) {
        // Two phases, and the order matters: restoring with setItem alone fails under
        // the very quota condition that triggered the rollback. Clear everything this
        // run touched FIRST — that frees the space — then put the prior values back.
        for (var r = 0; r < written.length; r++) {
          try { localStorage.removeItem(NS + written[r][0]); } catch (e2) {}
        }
        for (var r2 = 0; r2 < written.length; r2++) {
          if (written[r2][1] === null) continue;
          try { localStorage.setItem(NS + written[r2][0], written[r2][1]); } catch (e3) {}
        }
        return null;
      }
      return old;
    } catch (e) { return null; }
  }
  var _adoptedFrom = adoptLegacyNamespace();
  if (_adoptedFrom) marinara.log.info("adopted settings from legacy namespace " + _adoptedFrom);
  // The 5.x auto-update loader (deleted in v6.0) cached the whole extension source
  // under rwa-loader-cache-v4 — ~180 KB of the origin's localStorage budget that
  // nothing reads any more, and this extension's own history competes for it.
  try {
    localStorage.removeItem("rwa-loader-cache-v4");
    localStorage.removeItem("rwa-loader-allow-remote");
  } catch (e) {}

  var _quotaWarned = false;
  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {
      if (!_quotaWarned) { _quotaWarned = true; showToast(null, "Storage full \u2014 changes may not persist"); }
    }
  }
  function loadArr(k, def) { var v = load(k); return Array.isArray(v) ? v : def; }
  function loadObj(k, def) { var v = load(k); return (v && typeof v === "object" && !Array.isArray(v)) ? v : def; }

  // Prompts are terse, imperative operations. Shared rules (preserve POV, tense,
  // facts, voice; output only the rewrite) live in the system prompt, so each
  // profile says only what to change. Bump PROMPTS_VERSION when these change.
  var PROMPTS_VERSION = 2;
  var DEF_PROFILES = [
    { id: "expand",      name: "Expand",               order: 0,  prompt: "Expand the passage with more descriptive detail, sensory imagery, and action. Add no new plot events." },
    { id: "compress",    name: "Compress",              order: 1,  prompt: "Condense the passage to be more succinct, keeping every key event and beat." },
    { id: "thoughts",    name: "Add Inner Thoughts",    order: 2,  prompt: "Weave in the point-of-view character's inner thoughts and emotional reactions, in close POV." },
    { id: "dialogue",    name: "Convert to Dialogue",   order: 3,  prompt: "Convert the passage into natural spoken dialogue between the characters, carrying the same information through what they say and do." },
    { id: "active",      name: "Passive to Active",     order: 4,  prompt: "Convert passive-voice constructions to active voice." },
    { id: "diffwords",   name: "Use Different Words",   order: 5,  prompt: "Rephrase using different vocabulary and sentence structure, keeping the exact meaning and tone." },
    { id: "showdont",    name: "Show, Don't Tell",      order: 6,  prompt: "Show, don't tell: turn statements of emotion or state into concrete action, sensory detail, and behaviour. Example: \"She was afraid\" becomes \"Her breath caught and her hands went cold.\"" },
    { id: "emotion",     name: "Show More Emotion",     order: 7,  prompt: "Heighten the emotional depth so the characters' feelings land more vividly. Do not change what happens." },
    { id: "transitions", name: "Fix Transitions",       order: 8,  prompt: "Smooth the flow and transitions so sentences and ideas connect naturally." },
    { id: "noai",        name: "Remove LLM-isms",       order: 9,  prompt: "Remove AI-writing tells. Cut filler clichés (\"a testament to\", \"the air was thick with\", \"couldn't help but\", \"a mix of X and Y\"), purple metaphors, and uniform sentence rhythm. Vary sentence length and keep it plainly human. Add no new content." },
    { id: "expdialogue", name: "Expand Dialogue",       order: 10, prompt: "Expand the existing dialogue with more back-and-forth, subtext, and distinct character voice." },
    { id: "romance",     name: "Increase Romance",      order: 11, prompt: "Increase the romantic tension, chemistry, and intimacy between the characters." },
    { id: "grammar",     name: "Grammar Fix",           order: 12, prompt: "Fix only grammar, spelling, and punctuation. Do not change wording, style, or content." },
  ];

  // Shape predicate for a stored profile. Shared by the loader below and the
  // settings import, which is the only other place untrusted profile data enters.
  function validProfileEntry(e) {
    return e && typeof e === "object" && !Array.isArray(e) &&
           typeof e.id === "string" && typeof e.name === "string" && typeof e.prompt === "string";
  }

  // Filter, don't just array-check. loadArr only proves the top level is an array,
  // and adoptLegacyNamespace copies a previous install's profiles across verbatim —
  // a new unvalidated writer of this key. A single null element made migratePrompts
  // below throw, and because the engine splices this file synchronously into its
  // main(), that throw aborts every remaining top-level statement: no bindings, no
  // popup, and nothing in the UI to say why. Filtering here covers every writer.
  // Restore defaults only when something was there and NOTHING survived — that is
  // corruption. An already-empty array is a user who deleted every profile (the
  // delete button has no minimum-count guard), and resurrecting the defaults under
  // them on the next load would make that choice impossible to keep.
  var _loadedProfiles = loadArr(K_PROF, DEF_PROFILES);
  var profiles = _loadedProfiles.filter(validProfileEntry);
  if (_loadedProfiles.length && !profiles.length) profiles = DEF_PROFILES.slice();

  var DEF_CFG = {
    cols: 2, rows: 8, typewriter: false, useCharCard: false, showDiff: false,
    lengthEnabled: false, lengthPct: 0, autoApply: false, popupPos: "auto",
    historyDepth: 5,
    localContextEnabled: false, localContextWords: 150,
    useLorebookEntries: false, usePrevMessages: false, prevMessageCount: 2,
    charCardIds: [], reviewBeforeApply: false, useUserPersona: false,
    // Connection: "marinara" (a connection you already configured in Marinara —
    // the key stays server-side), "sidecar" (Marinara's downloaded local model),
    // "direct" (OpenAI-compatible endpoint such as Ollama/llama.cpp), or
    // "extender" (Marinara Extender sidecar).
    // "sidecar" is NOT your Marinara connection list — it is the local model from
    // Settings → Connections → Local Model, and 503s if that was never downloaded.
    connMode: "marinara", connectionId: "",
    // One-shot latch for the sidecar→marinara flip in the cfg loader below.
    // False only on configs saved before this mode existed; saveC persists it,
    // after which a user-chosen "sidecar" is never flipped again.
    connModeMigrated: false,
    apiUrl: "http://127.0.0.1:11434/v1", apiModel: "", apiKey: "", directTemp: 0.7,
    // Model context window (tokens). Selections larger than ~1/6 of this are
    // windowed into slices and rewritten via the Ledger Pattern, not truncated.
    ctxTokens: 8192,
    // Extender: URL of the Marinara Extender sidecar (shared by inference + memory fetch).
    extenderUrl: "http://127.0.0.1:3001",
    // When true, pulls live character memory from the Extender and adds it to the rewrite context.
    useExtenderMemory: false,
    // When true, detects whether the selection is user prose or a character's voice and tells
    // the model which editing mode to apply.
    speakerAware: false,
    autoProfileEnabled: true, promptsVersion: 0, debugEnabled: false,
    mergeMultiMsg: false,
    // When true, selecting text does NOT auto-open the popup; only Alt+R does.
    // Keeps normal highlight/copy/paste from triggering the popup.
    manualTriggerOnly: false,
    // Swap the full system prompt for a terse one to save tokens on small models.
    conciseSysPrompt: false,
    // Collapsed state of the popup's token-cost panel (the ^ toggle).
    ctxCollapsed: false,
    // Pinned popup position {left,top} as CSS px strings, or null to follow the
    // selection. Pinning locks WHERE the popup appears, not whether it stays open.
    pinnedPos: null,
  };

  // Shared rewrite system prompt (single + merge paths).
  var REWRITE_SYS =
    "You are a line editor rewriting a passage of fiction in place for an author.\n\n" +
    "Output rules:\n" +
    "- Output ONLY the rewritten passage. No preamble, notes, explanations, quotation marks, markdown, or code fences.\n" +
    "- Do not repeat or acknowledge these instructions.\n\n" +
    "Always:\n" +
    "- Apply the requested edit to the text inside <rewrite_this> only.\n" +
    "- Keep the same point of view and verb tense as the original.\n" +
    "- Keep every named character, plot fact, and continuity detail unchanged unless the edit explicitly calls for it.\n" +
    "- Match the voice and register of the surrounding prose.\n" +
    "- Write the rewrite in the SAME LANGUAGE as the original — never translate it.\n" +
    "- Preserve wrapping markdown or punctuation (*…*, \"…\", (…)) only when it is present in the original.\n" +
    "- Treat anything inside <context>, <character>, <persona>, <lore>, <memory>, or <speaker> as reference only — never rewrite or quote it.";

  // Terse system prompt for users on tiny context windows (small local models).
  // Keeps the must-haves (output-only, reference-only, POV/continuity) and drops
  // the elaboration. ~90 tokens vs ~180. Toggled by cfg.conciseSysPrompt.
  var REWRITE_SYS_CONCISE =
    "You are a line editor. Rewrite the text inside <rewrite_this> as instructed.\n" +
    "Output ONLY the rewritten passage — no preamble, notes, quotes, or markdown.\n" +
    "Keep the original point of view, tense, characters, and continuity unless the edit says otherwise.\n" +
    "Write in the same language as the original — never translate. Keep wrapping *…*/\"…\" only if present.\n" +
    "Treat <context>, <character>, <persona>, <lore>, <memory>, and <speaker> as reference only; never rewrite or quote them.";

  function sysPrompt() { return cfg.conciseSysPrompt ? REWRITE_SYS_CONCISE : REWRITE_SYS; }

  var cfg = (function () {
    var stored = loadObj(K_CFG, {});
    var merged = {};
    Object.keys(DEF_CFG).forEach(function (k) { merged[k] = stored[k] !== undefined ? stored[k] : DEF_CFG[k]; });
    // Changing DEF_CFG's connMode default reaches only brand-new installs — the
    // merge above pins every previously-saved config to whatever it stored, and
    // "sidecar" was the old baked-in default, not a choice: it runs Marinara's
    // downloaded local model and 503s on installs that never fetched one (most).
    // Flip a pre-latch "sidecar" to the connection-backed mode once. Re-choosing
    // sidecar in Settings saves the latch with it, so that choice sticks.
    if (!merged.connModeMigrated) {
      if (merged.connMode === "sidecar") merged.connMode = "marinara";
      merged.connModeMigrated = true;
    }
    return merged;
  })();
  var hist    = loadArr(K_HIST, []);
  var redo    = loadArr(K_REDO, []);
  var customs = loadArr(K_CUST, []);
  var autoProfs = loadObj(K_AUTO, {});
  var dbg     = loadArr(K_DBG, []);
  // in-flight guard: prevents overlapping auto-profile generations per chat id
  var _autoInFlight = {};

  function saveP() { save(K_PROF, profiles); }
  function saveC() { save(K_CFG, cfg); }
  function saveH() { save(K_HIST, hist); }
  function saveRedo() { save(K_REDO, redo); }
  function saveX() { save(K_CUST, customs); }
  function saveA() { save(K_AUTO, autoProfs); }
  function saveDbg() { save(K_DBG, dbg.slice(-100)); }

  // ── Debug log ───────────────────────────────────────────────────────────────
  // Ring buffer (last 100 events) persisted to localStorage, mirrored to the
  // console, and exportable to ME-rewrite-debug.json in the Downloads folder.
  function logDbg(event, data) {
    if (!cfg.debugEnabled) return;
    var entry = { t: new Date().toISOString(), event: event };
    if (data) Object.keys(data).forEach(function (k) { entry[k] = data[k]; });
    dbg.push(entry);
    if (dbg.length > 100) dbg.splice(0, dbg.length - 100);
    saveDbg();
    try { console.log("[RewriteAssistant:" + event + "]", data || ""); } catch (e) {}
  }
  function downloadDebug() {
    var safeCfg = {};
    Object.keys(cfg).forEach(function (k) { if (k !== "apiKey") safeCfg[k] = cfg[k]; });
    safeCfg.apiKeySet = !!cfg.apiKey;
    var payload = {
      extension: "rewrite-assistant-v4",
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      config: safeCfg,
      entries: dbg,
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "ME-rewrite-debug.json"; a.click();
    URL.revokeObjectURL(url);
  }
  try {
    window.__rwaDebug = {
      get entries() { return dbg; },
      dump: downloadDebug,
      clear: function () { dbg.length = 0; saveDbg(); },
    };
  } catch (e) {}

  // Upgrade built-in profile prompts/names in place when PROMPTS_VERSION bumps.
  // Matches by id, so user-added profiles and saved order/colour are preserved.
  (function migratePrompts() {
    if (cfg.promptsVersion === PROMPTS_VERSION) return;
    var defById = {};
    DEF_PROFILES.forEach(function (d) { defById[d.id] = d; });
    profiles.forEach(function (p) {
      var d = defById[p.id];
      if (d) { p.prompt = d.prompt; p.name = d.name; }
    });
    cfg.promptsVersion = PROMPTS_VERSION;
    saveP(); saveC();
  })();

  // ── Caches ───────────────────────────────────────────────────────────────
  var _msgCache = { key: null, msgs: null, ts: 0 };
  function cachedMessages(cid) {
    var key = "/chats/" + cid + "/messages";
    if (_msgCache.key === key && Date.now() - _msgCache.ts < 2000 && _msgCache.msgs) return Promise.resolve(_msgCache.msgs);
    return marinara.apiFetch(key).then(function (msgs) {
      if (Array.isArray(msgs)) { _msgCache = { key: key, msgs: msgs, ts: Date.now() }; }
      return msgs;
    });
  }
  function invalidateMsgCache() { _msgCache = { key: null, msgs: null, ts: 0 }; }

  // Direct PATCH leaves the engine's react-query cache unaware of the change, so the
  // on-screen message stays stale until its own refetch (the removed editor save used
  // to trigger that). Reach the engine's QueryClient via the React fiber (it sits a
  // few nodes under #root) and invalidate the chat's message query. Best-effort: if
  // engine internals change this no-ops and we fall back to refetch-on-navigate; it
  // never throws into the commit path.
  var _qc = null;
  function findQueryClient() {
    if (_qc && typeof _qc.invalidateQueries === "function") return _qc;
    var root = document.getElementById("root") || document.body;
    if (!root) return null;
    var key = null, ks = Object.keys(root), i;
    for (i = 0; i < ks.length; i++) {
      if (ks[i].indexOf("__reactContainer") === 0 || ks[i].indexOf("__reactFiber") === 0) { key = ks[i]; break; }
    }
    if (!key) return null;
    var start = root[key];
    if (start && start.current) start = start.current;
    var stack = [start], seen = new Set(), count = 0;
    while (stack.length && count < 50000) {
      var f = stack.pop(); count++;
      if (!f || typeof f !== "object" || seen.has(f)) continue;
      seen.add(f);
      var c = f.memoizedProps && f.memoizedProps.client;
      if (c && typeof c.invalidateQueries === "function") { _qc = c; return c; }
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    return null;
  }
  function refreshMessages(cid) {
    try {
      var qc = findQueryClient();
      if (!qc || !cid) return;
      qc.invalidateQueries({ predicate: function (q) {
        var k = q && q.queryKey;
        return Array.isArray(k) && k.indexOf("messages") !== -1 && k.indexOf(cid) !== -1;
      } });
    } catch (e) { /* best-effort; falls back to refetch-on-navigate */ }
  }

  // Write raw content back to the engine. apiFetch spreads options into fetch and
  // resolves to parsed JSON; the PATCH route returns the updated message object.
  function patchMessage(cid, mid, content) {
    return marinara.apiFetch(
      "/chats/" + encodeURIComponent(cid) + "/messages/" + encodeURIComponent(mid),
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: content }) }
    ).then(function (res) {
      // apiFetch resolves even on HTTP 4xx/5xx (the engine bridge doesn't check
      // res.ok). The route returns the updated message (has an id) on success and
      // { error } on failure, so detect that shape and throw — otherwise a failed
      // write would falsely toast "Applied" and undo would shift away the only copy
      // of the pre-rewrite text.
      if (!res || res.error || res.id == null) {
        throw new Error((res && res.error) ? String(res.error) : "PATCH did not return an updated message");
      }
      refreshMessages(cid); // re-render the edited message now that there's no editor save to do it
      return res;
    });
  }

  // ── B2: last-write-wins guard ────────────────────────────────────────────
  // The engine's PATCH route is a bare overwrite — chats.routes.ts's handler calls
  // storage.updateMessageContent, and chats.storage.ts's withPatchQueue serializes
  // per message id for ATOMICITY only; it never compares against an expected prior
  // value. There is no version, etag, or conditional write to ask for, so the check
  // has to live here. And concurrent modification is routine, not theoretical: swipe
  // and regenerate write the same rows from several routes, and the background
  // autonomous-messaging hook mutates chat state with no user action at all.
  //
  // Every PATCH this extension issues therefore goes through here: re-read the
  // stored content, compare it to the pre-image the operation assumed, and on a
  // mismatch ask instead of overwriting. Resolves to null when the user declined
  // (nothing was written), the patch result otherwise. A failed re-read rejects —
  // callers already surface that, and refusing to write is the safe outcome.
  function guardedPatch(cid, mid, expected, content, what) {
    // A staleness check that reads a stale cache is worthless: cachedMessages
    // serves up to 2s old data, which is the whole width of the race.
    invalidateMsgCache();
    return cachedMessages(cid).then(function (msgs) {
      // apiFetch resolves the parsed body on 4xx/5xx and null on a non-JSON body, so
      // a FAILED re-read arrives resolved and non-array, not as a rejection. Reading
      // that as "the message isn't in the list" let the cur == null escape below wave
      // the write through — disabling the guard precisely when the engine is
      // unhealthy and a concurrent clobber is most likely. Refuse instead.
      if (!Array.isArray(msgs)) {
        throw new Error("Could not re-read the message to check for concurrent edits — nothing was written.");
      }
      var cur = null;
      for (var i = 0; i < msgs.length; i++) {
        if (msgs[i].id === mid) { cur = msgs[i].content; break; }
      }
      // expected == null: history entry written by an older build recorded no
      // pre-image, so there is nothing to compare. cur == null: the message is no
      // longer in the list — let the PATCH itself produce the real error.
      if (expected == null || cur == null || cur === expected) return true;
      return confirmOverwrite(what, cur);
    }).then(function (ok) {
      if (!ok) return null;
      return patchMessage(cid, mid, content);
    });
  }

  // The mismatch prompt. Cancel is the default in both senses: it is the primary
  // button, and every exit that is not the explicit "Overwrite anyway" click — the
  // X, Cancel — resolves false, so a dismissed dialog can never destroy the other
  // writer's change. No merge is offered; guessing how to combine two edits to the
  // same message is how you lose both.
  function confirmOverwrite(what, cur) {
    return new Promise(function (resolve) {
      var settled = false;
      var ov = mkOv(10030);
      function finish(v) {
        if (settled) return;
        settled = true;
        ov.remove();
        resolve(v);
      }
      var win = ap(ov, mk("div", "rwa-win"));
      win.style.width = "480px";
      ap(win, mk("div", "rwa-bar"));
      var hdr = ap(win, mk("div", "rwa-hdr"));
      ap(hdr, mk("div", "rwa-title", "⚠️ This message changed"));
      ap(hdr, xBtn(function () { finish(false); }));
      var body = ap(win, mk("div", "rwa-body"));
      ap(body, mk("div", "rwa-err",
        "The stored message is no longer what this " + (what || "change") + " assumed.\n\n" +
        "Something else wrote to it since — a swipe, a regenerate, or an automatic " +
        "background message. Applying now replaces that newer text, and it is not " +
        "recoverable from here.\n\nCancel, look at the message, and try again."));
      ap(body, mk("div", "rwa-plbl", "Stored right now"));
      var prev = ap(body, mk("div", "rwa-prev", String(cur == null ? "" : cur).slice(0, 600)));
      prev.style.cssText = "white-space:pre-wrap;max-height:140px;overflow:auto;margin:4px 0 10px;font-size:11px;";
      var ft = ap(body, mk("div", "rwa-foot"));
      ap(ft, mkBtn("Cancel", "rwa-accept", function () { finish(false); })).style.flex = "2";
      ap(ft, mkBtn("Overwrite anyway", null, function () { finish(true); })).style.flex = "1";
    });
  }

  var _loreCache = { key: null, result: null, ts: 0 };
  var _charListCache = null;

  // ── Fence escaping ───────────────────────────────────────────────────────
  // Context text (lorebook entries, character cards, personas, prior
  // messages, memory) is interpolated into <tag>...</tag> fences. Most of it
  // arrives automatically from downloaded character cards and shared
  // lorebooks the user never reviewed — a literal closing tag inside that
  // text terminates the fence early and lands the remainder wherever the
  // system prompt says real instructions live. Neutralize literal open/close
  // occurrences of the fence tag actually in use. Not general XML escaping —
  // that would mangle ordinary prose containing "<" and ">", which is common
  // in fiction.
  function escFence(text, tag) {
    if (!text) return text;
    var openRe  = new RegExp("<\\s*" + tag + "\\b[^>]*>", "gi");
    var closeRe = new RegExp("<\\s*/\\s*" + tag + "\\s*>", "gi");
    return String(text).replace(closeRe, "[/" + tag + "]").replace(openRe, "[" + tag + "]");
  }

  // ── Prompt budget ────────────────────────────────────────────────────────
  // The engine hard-caps systemPrompt AND userPrompt at 16000 chars each
  // (packages/server/src/routes/sidecar.routes.ts) via a schema.parse() that
  // runs before the route's own try/catch, so blowing the cap produces a
  // generic Fastify validation error, not anything actionable. Each context
  // piece is capped individually, but nothing ever summed them — a realistic
  // selection with card + memory + persona + lore + local + prev context
  // enabled can sum well past 16000. Stay comfortably under the engine's cap
  // so there's headroom for the task/scaffold text this budget doesn't count.
  var PROMPT_BUDGET = 14000;

  // Drop context pieces lowest-priority-first until `fixedLen` (the part that
  // is never trimmed: speaker note + task text + the fenced selection) plus
  // the surviving pieces fits PROMPT_BUDGET. Mutates `parts` in place,
  // clearing dropped keys to "", and returns the dropped names in drop order
  // (empty if nothing needed dropping). Priority, lowest to highest: previous
  // messages -> extender memory -> lorebook entries -> character card ->
  // persona -> local surrounding context. The selection itself is never in
  // `parts` — callers must check `fixedLen` against the budget separately.
  var CTX_DROP_ORDER = ["prev", "memory", "lore", "card", "persona", "local"];
  function trimContextToBudget(parts, fixedLen) {
    var dropped = [];
    var total = fixedLen;
    CTX_DROP_ORDER.forEach(function (k) { total += (parts[k] || "").length; });
    for (var i = 0; i < CTX_DROP_ORDER.length && total > PROMPT_BUDGET; i++) {
      var k = CTX_DROP_ORDER[i];
      if (!parts[k]) continue;
      total -= parts[k].length;
      parts[k] = "";
      dropped.push(k);
    }
    return dropped;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function getChatId() {
    var fromStore = localStorage.getItem("marinara-active-chat-id");
    if (fromStore) return fromStore;
    var el = document.querySelector('[data-chat-id][class*="sidebar-accent"]');
    return el ? el.getAttribute("data-chat-id") : null;
  }

  // Capped at 8 characters — a group chat's character list is otherwise
  // unbounded and, summed with the other context pieces, was the main
  // contributor to prompts blowing past the engine's 16000-char cap.
  function buildCharCardContext(chars) {
    var parts = [];
    chars.slice(0, 8).forEach(function (char) {
      var data = {};
      try { data = typeof char.data === "string" ? JSON.parse(char.data) : char.data || {}; } catch (e) {}
      var name        = data.name        || char.name        || "";
      var personality = data.personality || char.personality || "";
      var description = data.description || char.description || "";
      var lines = [];
      if (name)        lines.push("Character: " + name);
      if (personality) lines.push("Personality: " + personality.slice(0, 300));
      if (description) lines.push("Description: " + description.slice(0, 200));
      if (lines.length) parts.push(lines.join("\n"));
    });
    return parts.length ? "\n\n<character note=\"Match this character's voice, register, and speech style.\">\n" + escFence(parts.join("\n\n"), "character") + "\n</character>" : "";
  }

  function fetchCharCard(cid) {
    var specificIds = cfg.charCardIds || [];
    if (specificIds.length) {
      return Promise.all(specificIds.map(function (id) {
        return marinara.apiFetch("/characters/" + id).catch(function () { return null; });
      })).then(function (chars) { return buildCharCardContext(chars.filter(Boolean)); });
    }
    if (!cid) return Promise.resolve("");
    return marinara.apiFetch("/chats/" + cid)
      .then(function (chat) {
        var ids = [];
        try { ids = typeof chat.characterIds === "string" ? JSON.parse(chat.characterIds) : chat.characterIds || []; } catch (e) {}
        if (!ids.length) return "";
        return Promise.all(ids.map(function (id) {
          return marinara.apiFetch("/characters/" + id).catch(function () { return null; });
        })).then(function (chars) { return buildCharCardContext(chars.filter(Boolean)); });
      })
      .catch(function () { return ""; });
  }

  function fetchLorebookEntries(cid) {
    if (!cid) return Promise.resolve("");
    var key = "/lorebooks/scan/" + cid;
    if (_loreCache.key === key && Date.now() - _loreCache.ts < 30000 && _loreCache.result !== null) return Promise.resolve(_loreCache.result);
    return marinara.apiFetch(key)
      .then(function (entries) {
        if (!Array.isArray(entries) || !entries.length) { _loreCache = { key: key, result: "", ts: Date.now() }; return ""; }
        var parts = entries.slice(0, 20).map(function (e) {
          var lkey     = (e.key || (Array.isArray(e.keys) ? e.keys.join(", ") : "") || "").trim();
          var content = (e.content || e.value || "").trim();
          return lkey ? lkey + ": " + content : content;
        }).filter(function (s) { return s.length > 3; });
        if (!parts.length) { _loreCache = { key: key, result: "", ts: Date.now() }; return ""; }
        var combined = parts.join("\n");
        var ws = combined.split(/\s+/);
        if (ws.length > 500) combined = ws.slice(0, 500).join(" ") + "\u2026";
        var result = "\n\n<lore note=\"World facts for continuity — reference only.\">\n" + escFence(combined, "lore") + "\n</lore>";
        _loreCache = { key: key, result: result, ts: Date.now() };
        return result;
      })
      .catch(function () { return ""; });
  }

  function fetchPrevMessages(cid, mid) {
    if (!cfg.usePrevMessages || !cid) return Promise.resolve("");
    var n = Math.max(1, Math.min(4, cfg.prevMessageCount || 2));
    return cachedMessages(cid).then(function (msgs) {
      if (!Array.isArray(msgs)) return "";
      var idx = -1;
      for (var i = 0; i < msgs.length; i++) { if (msgs[i].id === mid) { idx = i; break; } }
      if (idx < 1) return "";
      var sl = msgs.slice(Math.max(0, idx - n), idx);
      if (!sl.length) return "";
      return "\n\n<context note=\"Preceding messages — reference only, do not rewrite.\">\n" + escFence(sl.map(function (m) {
        return (m.role || "user").toUpperCase() + ": " + (m.content || "").slice(0, 300);
      }).join("\n"), "context") + "\n</context>";
    }).catch(function () { return ""; });
  }

  function buildPersonaContext(p) {
    if (!p) return "";
    var lines = [];
    if (p.name)        lines.push("Name: " + p.name);
    if (p.description) lines.push("Description: " + String(p.description).slice(0, 300));
    if (p.personality) lines.push("Personality: " + String(p.personality).slice(0, 200));
    if (p.appearance)  lines.push("Appearance: " + String(p.appearance).slice(0, 150));
    return lines.length
      ? "\n\n<persona note=\"This is the human user's persona. When rewriting their own message, keep their voice and self-description.\">\n" + escFence(lines.join("\n"), "persona") + "\n</persona>"
      : "";
  }

  // Inject the user's persona, but only when the selected message was authored by
  // the user (role === "user"). Role comes from the stored message data, not DOM
  // class guessing — the fork's bug was defaulting to the character on any miss.
  function fetchUserPersona(cid, mid) {
    if (!cfg.useUserPersona || !cid) return Promise.resolve("");
    return cachedMessages(cid).then(function (msgs) {
      if (!Array.isArray(msgs)) return "";
      var msg = null;
      for (var i = 0; i < msgs.length; i++) { if (msgs[i].id === mid) { msg = msgs[i]; break; } }
      if (!msg || (msg.role || "").toLowerCase() !== "user") return "";
      return marinara.apiFetch("/chats/" + cid).then(function (chat) {
        var pid = chat && chat.personaId;
        if (!pid) return "";
        // Marinara serves personas under /characters/personas/:id (not /personas/:id,
        // which is the SillyTavern-era path the fork assumed).
        return marinara.apiFetch("/characters/personas/" + pid)
          .then(function (p) { return buildPersonaContext(p); })
          .catch(function () { return ""; });
      });
    }).catch(function () { return ""; });
  }

  // Fetch all async context parts at once, cached by chat+message+enabled-flags so
  // the popup's preview fetch and the actual rewrite share one round trip. Local
  // (surrounding) context is selection-derived and stays out of this cache.
  var _ctxCache = { key: null, ts: 0, data: null };
  function ctxKey(cid, mid) {
    return [cid, mid, !!cfg.useCharCard, !!cfg.useUserPersona, !!cfg.useLorebookEntries,
      !!cfg.usePrevMessages, cfg.prevMessageCount, (cfg.charCardIds || []).join(",")].join("|");
  }
  function fetchContextParts(cid, mid) {
    var key = ctxKey(cid, mid);
    if (_ctxCache.key === key && Date.now() - _ctxCache.ts < 20000 && _ctxCache.data) {
      return Promise.resolve(_ctxCache.data);
    }
    return Promise.all([
      cfg.useCharCard ? fetchCharCard(cid) : Promise.resolve(""),
      cfg.useLorebookEntries ? fetchLorebookEntries(cid) : Promise.resolve(""),
      fetchPrevMessages(cid, mid),
      fetchUserPersona(cid, mid),
    ]).then(function (r) {
      var data = { card: r[0], lore: r[1], prev: r[2], persona: r[3] };
      _ctxCache = { key: key, ts: Date.now(), data: data };
      return data;
    });
  }

  // N12: added `occ` param (0-based occurrence index) so repeated phrases use the
  // correct instance. Falls back to indexOf if nthIndexOf misses. Pass 0 if unknown.
  function extractLocalContext(mid, selText, occ) {
    var msgEl = document.querySelector('[data-message-id="' + mid + '"]');
    if (!msgEl) return "";
    var fullText = (msgEl.textContent || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    var normSel  = selText.trim();
    var idx      = nthIndexOf(fullText, normSel, occ || 0);
    if (idx === -1) idx = fullText.indexOf(normSel); // fallback to first occurrence
    var words    = Math.max(20, Math.min(400, cfg.localContextWords || 150));

    var allMsgs = Array.from(document.querySelectorAll("[data-message-id]"));
    var myIdx   = allMsgs.findIndex(function (el) { return el.getAttribute("data-message-id") === mid; });

    function wordArr(str) { return str.split(/\s+/).filter(Boolean); }
    function tailWords(arr, n) { return arr.slice(-n).join(" "); }
    function headWords(arr, n) { return arr.slice(0, n).join(" "); }

    var ctxBefore = "", ctxAfter = "";
    if (idx !== -1) {
      ctxBefore = tailWords(wordArr(fullText.slice(0, idx).trim()), words);
      ctxAfter  = headWords(wordArr(fullText.slice(idx + normSel.length).trim()), words);
    }
    if (wordArr(ctxBefore).length < 20 && myIdx > 0) {
      var prevText = (allMsgs[myIdx - 1].textContent || "").trim();
      ctxBefore = tailWords(wordArr(tailWords(wordArr(prevText), words) + " " + ctxBefore), words);
    }
    if (wordArr(ctxAfter).length < 20 && myIdx >= 0 && myIdx < allMsgs.length - 1) {
      var nextText = (allMsgs[myIdx + 1].textContent || "").trim();
      ctxAfter = headWords(wordArr(ctxAfter + " " + headWords(wordArr(nextText), words)), words);
    }
    var parts = [];
    if (ctxBefore) parts.push("Before: " + ctxBefore);
    if (ctxAfter)  parts.push("After: "  + ctxAfter);
    return parts.length ? "\n\n<context note=\"Surrounding prose — reference only, do not rewrite.\">\n" + escFence(parts.join("\n\n"), "context") + "\n</context>" : "";
  }

  // ── Marinara Extender: character-memory fetch ─────────────────────────────
  // Fetches live character memory from the Extender sidecar's /api/memory-block
  // endpoint, or falls back to lorebook entries tagged "marinara extender".
  // Returns a fenced <memory> string (or "" if nothing found / feature disabled).

  var _extenderLbCache = null; // { ids: {id:true,...}, ts: number } lorebook ID cache

  function extractMemoryContent(block) {
    if (!block || typeof block !== "string") return "";
    // Prefer the <memory>…</memory> section after a blank line
    var idx = block.indexOf("\n\n<memory>");
    var mem = idx === -1 ? "" : block.slice(idx + 2).trim();
    if (!mem) { var m = block.match(/<memory>[\s\S]*<\/memory>/i); mem = m ? m[0] : ""; }
    return mem.replace(/^<memory>\s*/i, "").replace(/\s*<\/memory>$/i, "").trim();
  }

  function fenceMemory(inner) {
    if (!inner) return "";
    // Was uncapped — unlike lore/local/prev/persona, which all already cap
    // their contribution. Mirror lore's word cap so one big memory block
    // can't dominate the prompt budget on its own.
    var ws = inner.split(/\s+/);
    if (ws.length > 400) inner = ws.slice(0, 400).join(" ") + "…";
    return "\n\n<memory note=\"Character & world memory — reference only, do not rewrite.\">\n" + escFence(inner, "memory") + "\n</memory>";
  }

  function fetchExtenderLorebookIds() {
    // Cache for 60 s so repeated rewrite calls within a session avoid re-fetching.
    if (_extenderLbCache && Date.now() - _extenderLbCache.ts < 60000) {
      return Promise.resolve(_extenderLbCache.ids);
    }
    return marinara.apiFetch("/lorebooks").then(function (resp) {
      var list = Array.isArray(resp) ? resp : ((resp && (resp.lorebooks || resp.data)) || []);
      var ids = {};
      list.forEach(function (lb) {
        var name = (lb && (lb.name || (lb.data && lb.data.name))) || "";
        if (typeof name === "string" && name.trim().toLowerCase().indexOf("marinara extender") === 0) {
          ids[String(lb.id)] = true;
        }
      });
      _extenderLbCache = { ids: ids, ts: Date.now() };
      return ids;
    }).catch(function () { return {}; });
  }

  function rawScan(cid) {
    // /lorebook-entries was removed in Marinara v2.x; /lorebooks/scan/:chatId is
    // the replacement (same endpoint fetchLorebookEntries uses). Field names are
    // normalized defensively until confirmed against a live v2.0.5 instance.
    return marinara.apiFetch("/lorebooks/scan/" + encodeURIComponent(cid || ""))
      .then(function (resp) {
        var arr = Array.isArray(resp) ? resp : ((resp && (resp.entries || resp.data)) || []);
        return arr.map(function (e) {
          return {
            lorebookId: e.lorebookId != null ? e.lorebookId : (e.lorebook_id != null ? e.lorebook_id : e.bookId),
            name: e.name || e.title || "",
            content: e.content || e.text || "",
          };
        });
      }).catch(function () { return []; });
  }

  function fetchExtenderMemoryViaScan(cid) {
    return Promise.all([rawScan(cid), fetchExtenderLorebookIds()]).then(function (r) {
      var entries = r[0], extIds = r[1];
      var mem = entries.filter(function (e) {
        return extIds[String(e.lorebookId)] && !/instruction/i.test(String(e.name || ""));
      }).map(function (e) {
        var c = String(e.content || "");
        return extractMemoryContent(c) || c.trim();
      }).filter(Boolean).join("\n\n");
      return fenceMemory(mem);
    }).catch(function () { return ""; });
  }

  function getFirstCharacterId(cid) {
    return marinara.apiFetch("/chats/" + encodeURIComponent(cid || ""))
      .then(function (resp) {
        // Marinara chat object shape: characters array or characterId field
        var chars = resp && (resp.characters || resp.characterIds);
        if (Array.isArray(chars) && chars.length) return String(chars[0].id || chars[0]);
        return (resp && resp.characterId) ? String(resp.characterId) : "";
      }).catch(function () { return ""; });
  }

  function fetchExtenderMemory(cid) {
    if (!cfg.useExtenderMemory || !cid) return Promise.resolve("");
    var base = (cfg.extenderUrl || "").trim().replace(/\/+$/, "");
    if (!base) {
      // No Extender URL — fall back to lorebook scan immediately
      return fetchExtenderMemoryViaScan(cid);
    }
    return getFirstCharacterId(cid).then(function (charId) {
      if (!charId) return fetchExtenderMemoryViaScan(cid);
      var ctrl = new AbortController();
      var to = setTimeout(function () { ctrl.abort(); }, 4000);
      var url = base + "/api/memory-block?characterId=" + encodeURIComponent(charId) + "&chatId=" + encodeURIComponent(cid);
      return fetch(url, { signal: ctrl.signal })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (j) {
          clearTimeout(to);
          var inner = j ? extractMemoryContent(j.memoryBlock || "") : "";
          if (inner) { logDbg("extender.memory.source", { via: "api" }); return fenceMemory(inner); }
          return fetchExtenderMemoryViaScan(cid);
        })
        .catch(function () {
          clearTimeout(to);
          logDbg("extender.memory.source", { via: "scan-fallback" });
          return fetchExtenderMemoryViaScan(cid);
        });
    });
  }

  // ── Speaker-aware editing ─────────────────────────────────────────────────
  // Detects whether the selected passage is the user's own prose or a character's
  // voice, and injects a <speaker> note so the model edits in the right register.
  var SPEAKER_USER =
    "\n\n<speaker note=\"reference only\">\nThis passage is the author's/user's own narration or input, not a story character's speech. Edit it as the author's prose. Do not answer in a character's voice, adopt a persona or pronouns, or add roleplay or commentary.\n</speaker>";
  var SPEAKER_CHAR =
    "\n\n<speaker note=\"reference only\">\nThis passage is written in the responding character's voice. Preserve that character's voice, register, and language; do not switch to the author's or editor's voice.\n</speaker>";

  function fetchSpeakerNote(cid, mid) {
    if (!cfg.speakerAware || !cid || !mid) return Promise.resolve("");
    return cachedMessages(cid).then(function (msgs) {
      if (!Array.isArray(msgs)) return "";
      var role = "";
      for (var i = 0; i < msgs.length; i++) {
        if (msgs[i].id === mid) { role = (msgs[i].role || "").toLowerCase(); break; }
      }
      if (role === "user") return SPEAKER_USER;
      return role ? SPEAKER_CHAR : "";
    }).catch(function () { return ""; });
  }

  function wc(s) {
    var words = s.trim().split(/\s+/).filter(Boolean);
    // ponytail: light CJK/no-space heuristic — if whitespace-delimited word count
    // is suspiciously low relative to character length, estimate chars/2 instead.
    if (words.length < 3 && s.trim().length > 10) return Math.ceil(s.trim().length / 2);
    return words.length;
  }
  // Would replacing raw span [as,ae) orphan half of a transform token?
  //
  // The aligner's clean-edge test asks whether each cut sits between two raw-only
  // chars. That misses the case where a macro's raw spelling shares a run with its
  // own rendered expansion: {{char50}} rendering as PersonName50 makes "50" look
  // matched, so a cut lands mid-token and the splice leaves "50}}" behind as literal
  // text the macro can never expand from again. Refuse rather than snap outward:
  // refusing degrades to the copy fallback — annoying but reversible — whereas
  // snapping silently eats the emphasis markers around short words (*no*, **hi**).
  //
  // The rule is CONTAINMENT, not delimiter counting. Counting was tried and is
  // wrong twice over: "ld** text" holds one run's closing ** and has an even count,
  // so parity passed it and the splice orphaned the opening ** — the same corruption
  // class, through the delimiter the check exists to guard. And it refused on
  // transform-free prose ("the 3 * 4 grid", "log_file"), where the map is the
  // identity and the splice is provably exact.
  //
  // Two kinds of construct:
  //   OPAQUE — the whole token is structural ({{macro}}, code span, image, escape,
  //            self-closing tag). Overlapping it without covering it whole bisects it.
  //   PAIRED — an opening and a closing delimiter stripped during render while the
  //            text between survives (*em*, **b**, ~~s~~, ==h==, _i_, [label](url),
  //            <b>..</b>). Cutting through the CONTENT is fine and is the common
  //            case; taking one delimiter without its partner is not.
  //
  // ponytail: regex tokens + name stacks, not the engine's tokenizer — it does
  // not know the engine's tag allowlist or macro arity; upgrade path for block
  // macros is reusing macro-engine's findBalancedMacroEnd.
  var OPAQUE_RE = /\{\{[\s\S]*?\}\}|```[\s\S]*?```|`[^`\n]*`|!\[[^\]\n]*\]\([^)\s]*\)|\\[\s\S]|<[A-Za-z][^<>]*\/>/g;
  var EMPH_RE   = /(\*\*\*|\*\*|~~|==|__|\*|_)(?!\1)([\s\S]*?)\1/g;
  var LINK_RE   = /\[([^\]\n]*)\]\(([^)\s]*)\)/g;
  // Tags and block macros pair by NAME with proper LIFO nesting. A lazy
  // open-to-close regex pairs an outer opener with an inner closer on
  // same-named nesting, leaving the TRUE outer closer in no pair at all —
  // a span could then take it, or everything before it, and orphan it.
  // One linear scan, no backtracking ambiguity (boundary lookaheads: without
  // them the name atom and the attribute atom match the same run, so an
  // unclosed "<" or "{{#" plus a long word run re-partitions quadratically).
  var PAIR_TOK_RE = /<(\/?)([A-Za-z][A-Za-z0-9]*)(?![A-Za-z0-9])[^<>]*>|\{\{(#|\/)([A-Za-z_][\w-]*)(?![\w-])[^{}]*\}\}/g;
  function spanIsBalanced(A, as, ae) {
    var t, m, i, pairs = [], ov = function (s, e) { return as < e && ae > s; };
    OPAQUE_RE.lastIndex = 0;
    while ((t = OPAQUE_RE.exec(A))) {
      var os = t.index, oe = os + t[0].length;
      if (ov(os, oe) && !(as <= os && ae >= oe)) return false;
    }
    EMPH_RE.lastIndex = 0;
    while ((m = EMPH_RE.exec(A))) {
      var d = m[1].length, s0 = m.index, e0 = s0 + m[0].length;
      pairs.push([s0, s0 + d, e0 - d, e0]);
      // Rescan from just past the OPENING delimiter, not past the whole match: a
      // /g/ scan leaves lastIndex after the close, so a pair nested in the content
      // never registers, and a pair that never registers can never be checked.
      // The engine recurses emphasis six deep, so **bold with *inner* italic** is a
      // live construct — cutting through it used to orphan the inner delimiter.
      // s0 + d strictly advances, so this cannot loop.
      EMPH_RE.lastIndex = s0 + d;
    }
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(A))) {
      var ls = m.index;
      pairs.push([ls, ls + 1, ls + 1 + m[1].length, ls + m[0].length]);
    }
    // Nesting is the whole point here: the engine renders <speaker="…">…</speaker>
    // as a wrapper, so in any multi-character chat every inner <b>/<i> is a nested
    // pair, and blocks nest by name too. A stack per name closes each opener with
    // its OWN closer, so all of them register — including the outermost.
    var stacks = {};
    PAIR_TOK_RE.lastIndex = 0;
    while ((m = PAIR_TOK_RE.exec(A))) {
      // A self-closing tag (<x/>) is atomic — OPAQUE_RE already protects it
      // whole. It must NOT enter the stack: pushed as a phantom opener it
      // hijacks the real pair's LIFO slot, and the real opener never pairs.
      if (m[2] !== undefined && /\/\s*>$/.test(m[0])) continue;
      // Key by kind + name so a <if> tag can never pair a {{/if}} macro.
      var isClose = m[1] === "/" || m[3] === "/";
      var key = (m[2] !== undefined ? "t:" + m[2] : "m:" + m[4]);
      if (!isClose) {
        (stacks[key] || (stacks[key] = [])).push([m.index, m.index + m[0].length]);
      } else {
        var open = stacks[key] && stacks[key].pop();
        // An unmatched closer (empty stack) or an unmatched opener (left on the
        // stack at the end) forms no pair — nothing to orphan, so nothing to refuse.
        if (open) pairs.push([open[0], open[1], m.index, m.index + m[0].length]);
      }
    }
    // Exactly one delimiter of a pair inside the cut orphans the other.
    for (i = 0; i < pairs.length; i++) {
      if (ov(pairs[i][0], pairs[i][1]) !== ov(pairs[i][2], pairs[i][3])) return false;
    }
    return true;
  }
  // Index of the n-th (0-based) non-overlapping occurrence of needle in haystack, or -1.
  function nthIndexOf(hay, needle, n) {
    var idx = hay.indexOf(needle);
    for (var k = 0; k < n && idx !== -1; k++) idx = hay.indexOf(needle, idx + needle.length);
    return idx;
  }

  // ── B3: surrounding-context fingerprint ──────────────────────────────────
  // nthIndexOf is a bare walk-forward with nothing to validate against. The
  // occurrence index `occ` is captured at SELECTION time; if the phrase's
  // occurrence count shifted since (an earlier instance added or removed by a
  // swipe, a regenerate, or background autonomous messaging), the same index
  // resolves to a DIFFERENT occurrence. The text still matches, so no error
  // fires and the toast still reads "Applied" — the splice just lands in the
  // wrong place. Ledgers make it worse: they persist in localStorage with no
  // TTL, so a resumed ledger can carry a days-old `occ`.
  //
  // So record what surrounds the selection at capture time and re-verify it at
  // the resolved index before splicing. Whitespace-normalized (render
  // whitespace is not stable), bounded to FP_LEN chars, and empty on whichever
  // side the selection touches the edge of the message.
  //
  // This answers "is this the same PLACE in the rendered text?". The separate
  // question "is the STORED content still the pre-image we assumed?" is
  // answered in exactly one other place — guardedPatch. Neither substitutes
  // for the other: the DOM can lag the store, and the store carries no
  // position.
  var FP_LEN = 24;
  function fpNorm(s) { return s.replace(/\s+/g, " ").trim(); }
  // Fingerprint the text either side of [idx, idx+len). Reads a wider raw window
  // than FP_LEN so that collapsing whitespace cannot shorten the kept slice, then
  // keeps the FP_LEN chars nearest the selection — the far edge of the window is
  // what a mid-word cut would corrupt, and it is exactly what gets dropped.
  function ctxFingerprintAt(fullText, idx, len) {
    if (idx == null || idx < 0) return null;
    var end = idx + len;
    return {
      b: fpNorm(fullText.slice(Math.max(0, idx - FP_LEN * 4), idx)).slice(-FP_LEN),
      a: fpNorm(fullText.slice(end, end + FP_LEN * 4)).slice(0, FP_LEN),
    };
  }
  // Capture-time: locate the occurrence the user picked, then fingerprint it.
  // Normalizes the needle exactly as doCommit does, so both sides agree.
  function ctxFingerprint(fullText, needle, occ) {
    var n = String(needle == null ? "" : needle).trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!n) return null;
    return ctxFingerprintAt(fullText, nthIndexOf(fullText, n, occ || 0), n.length);
  }
  // Commit-time: does the resolved splice site still look the way it did?
  // No fingerprint recorded (a ledger written by an older build) means there is
  // nothing to compare against — allow, rather than break every stored ledger.
  function fingerprintOk(fp, fullText, idx, len) {
    if (!fp) return true;
    var now = ctxFingerprintAt(fullText, idx, len);
    return !!now && now.b === fp.b && now.a === fp.a;
  }
  // Map a [rs,re) span in the rendered text to a [as,ae) span in raw msg.content.
  // The engine renders raw content through macro/quote/markdown transforms; this
  // LCS-aligns the two strings so a selection captured from the DOM can be spliced
  // back into raw content. Returns null over the size cap (caller copies instead).
  //
  // CORRECTNESS / NON-CORRUPTION: a naive LCS map orphans transform tokens when a
  // selection boundary lands inside a transform-only region (e.g. selecting part of
  // an expanded {{char}}). Incidental single-char matches inside such tokens (the
  // 'c' shared by "Alice" and "{{char}}") defeat boundary detection, so they are
  // demoted to non-anchors. Boundaries that touch a transform are snapped OUTWARD to
  // cover whole token(s); if a clean span cannot be produced, null is returned and
  // the caller shows the Copy fallback. Clean boundaries always splice exactly.
  function alignExact(R, A, rs, re) {
    var n = R.length, m = A.length;
    if (!n || !m || n * m > 4000000) return null; // ponytail: ~2k×2k char cap; null -> caller windows or copy-falls-back
    if (rs < 0 || re > n || re < rs) return null;
    var i, j, k, c;
    var dp = [];
    for (i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (i = n - 1; i >= 0; i--)
      for (j = m - 1; j >= 0; j--)
        dp[i][j] = (R.charCodeAt(i) === A.charCodeAt(j))
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    // Backtrace the alignment. mr[i] = matched raw index for rendered char i, or -1
    // (rendered-only). matchedRaw[j] = 1 if raw char j is an LCS match (else it is a
    // raw-only / transform char).
    var mr = new Int32Array(n);
    for (k = 0; k < n; k++) mr[k] = -1;
    var matchedRaw = new Uint8Array(m);
    var i2 = 0, j2 = 0;
    while (i2 < n || j2 < m) {
      if (i2 < n && j2 < m && R.charCodeAt(i2) === A.charCodeAt(j2)) {
        mr[i2] = j2; matchedRaw[j2] = 1; i2++; j2++;
      } else if (j2 >= m || (i2 < n && dp[i2 + 1][j2] >= dp[i2][j2 + 1])) {
        i2++; // rendered-only char
      } else {
        j2++; // raw-only char
      }
    }
    // Demote ISLAND matches: a matched raw char flanked by raw-only chars on BOTH
    // sides is an incidental match inside a transform token, not a real anchor.
    // Iterate to a fixpoint (demoting one island can expose another).
    var changed = true;
    while (changed) {
      changed = false;
      for (k = 0; k < n; k++) {
        var rj = mr[k];
        if (rj < 0) continue;
        var leftRO = (rj > 0) && !matchedRaw[rj - 1];
        var rightRO = (rj < m - 1) && !matchedRaw[rj + 1];
        if (leftRO && rightRO) { mr[k] = -1; matchedRaw[rj] = 0; changed = true; }
      }
    }
    // Compute raw cut points from the nearest real anchors.
    var as, ae, x, pm, nm;
    // START cut (before rendered char rs).
    if (rs >= n) { as = m; }
    else if (mr[rs] >= 0) { as = mr[rs]; }
    else { // rendered-only: just after the previous anchor's raw char
      pm = -1;
      for (x = rs - 1; x >= 0; x--) { if (mr[x] >= 0) { pm = x; break; } }
      as = (pm >= 0) ? mr[pm] + 1 : 0;
    }
    // END cut (after rendered char re-1).
    if (re <= 0) { ae = 0; }
    else if (mr[re - 1] >= 0) { ae = mr[re - 1] + 1; }
    else { // last selected char is rendered-only: extend to the next anchor's raw start
      nm = -1;
      for (x = re; x < n; x++) { if (mr[x] >= 0) { nm = x; break; } }
      ae = (nm >= 0) ? mr[nm] : m;
    }
    if (ae < as) return null;
    // If the selection touches a transform (it contains rendered-only chars, or the
    // raw span interior contains raw-only chars), snap each edge OUTWARD so no
    // raw-only token is bisected.
    var touchesTransform = false;
    for (k = rs; k < re; k++) { if (mr[k] < 0) { touchesTransform = true; break; } }
    if (!touchesTransform) {
      for (c = as; c < ae; c++) { if (!matchedRaw[c]) { touchesTransform = true; break; } }
    }
    if (touchesTransform) {
      // Start partway into a raw-only token -> pull cut to that token's start.
      while (as > 0 && !matchedRaw[as - 1] && !matchedRaw[as]) as--;
      // End partway through a raw-only token -> push cut to that token's end.
      while (ae < m && !matchedRaw[ae] && ae > 0 && !matchedRaw[ae - 1]) ae++;
      // Selection clearly covers a transform but mapped to an empty raw span:
      // expand to enclose the adjacent raw-only run.
      if (as === ae) {
        for (k = rs; k < re; k++) {
          if (mr[k] < 0) {
            while (ae < m && !matchedRaw[ae]) ae++;
            while (as > 0 && !matchedRaw[as - 1]) as--;
            break;
          }
        }
      }
    }
    if (ae < as) return null;
    // Final clean-edge check: neither cut may sit strictly inside a raw-only run.
    var dirtyStart = as > 0 && as < m && !matchedRaw[as - 1] && !matchedRaw[as];
    var dirtyEnd = ae > 0 && ae < m && !matchedRaw[ae - 1] && !matchedRaw[ae];
    if (dirtyStart || dirtyEnd) return null;
    if (!spanIsBalanced(A, as, ae)) return null;
    return { as: as, ae: ae };
  }
  // Find a "clean anchor": a verbatim run of rendered text near `pos` that occurs
  // exactly once in raw A, giving an unambiguous coordinate peg. side<0 searches runs
  // ending at/before pos (leftward); side>0 searches runs starting at/after pos
  // (rightward). Steps past transforms (which break the verbatim match) and repetition
  // (which breaks uniqueness). Returns {rPos, aPos} (R[rPos..rPos+LEN] === A[aPos..]) or null.
  function findCleanAnchor(R, A, pos, side, LEN, MAXSPAN) {
    var step = 8, t, p, cand, idx;
    for (t = 0; t * step <= MAXSPAN; t++) {
      p = side < 0 ? (pos - t * step - LEN) : (pos + t * step);
      if (p < 0 || p + LEN > R.length) continue;
      cand = R.substring(p, p + LEN);
      idx = A.indexOf(cand);
      if (idx < 0) continue;                       // transform inside cand: not verbatim in raw
      if (A.indexOf(cand, idx + 1) >= 0) continue; // not unique: ambiguous peg
      return { rPos: p, aPos: idx };
    }
    return null;
  }
  // Curly quotes/apostrophes are the engine's most common length-PRESERVING transform
  // (straight " -> “ ”, ' -> ’). They break verbatim anchor matching but not positions,
  // so we normalize them straight for the anchor SEARCH only — pegs stay valid in the
  // original coords, and the splice still aligns the original (un-normalized) window.
  function normForAnchor(s) {
    return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  }
  // Window the alignment of [rs,re): peg clean anchors just outside the selection on
  // both sides and run alignExact on only that bounded slice, then translate the cut
  // back to global raw coords. The window must CONTAIN the whole selection, so this
  // returns null when the selection itself is too big (its own size blows the cap) —
  // mapRenderedSpanToRaw handles that case by mapping the two edges separately.
  function windowMap(R, A, rs, re) {
    var n = R.length, m = A.length;
    var LEN = 40, MAXSPAN = 800;
    var Rn = normForAnchor(R), An = normForAnchor(A);
    var left = findCleanAnchor(Rn, An, rs, -1, LEN, MAXSPAN);
    var right = findCleanAnchor(Rn, An, re, 1, LEN, MAXSPAN);
    var wlo = left ? left.rPos : 0;
    var lo = left ? left.aPos : 0;
    var whi = right ? right.rPos + LEN : n;
    var hi = right ? right.aPos + LEN : m;
    if (wlo > rs || whi < re || lo >= hi || wlo >= whi) return null; // anchors must bracket & stay ordered
    if ((whi - wlo) * (hi - lo) > 4000000) return null;             // window (incl. whole selection) too big
    var loc = alignExact(R.slice(wlo, whi), A.slice(lo, hi), rs - wlo, re - wlo);
    if (!loc) return null;
    // alignExact validated the WINDOW SLICE. Window edges are 40-char verbatim
    // anchors, and inside a long emphasised run the content is verbatim in raw — so
    // an anchor can legally land BETWEEN a pair's opening and closing delimiter. The
    // slice then holds one lone delimiter, which yields no pair, and the check waves
    // through exactly the orphaning it exists to stop. Re-check against the whole
    // document, the way the per-edge path below already does.
    if (!spanIsBalanced(A, lo + loc.as, lo + loc.ae)) return null;
    return { as: lo + loc.as, ae: lo + loc.ae };
  }
  // Map a rendered span [rs,re) into raw msg.content coords. Small message: exact
  // full-message LCS. Large message: the O(n*m) matrix would blow the ~4M-cell cap
  // (the v5.1 bug), so window it. A SMALL selection windows whole in one slice. A LARGE
  // selection (>~1.9k chars) can't — its own size exceeds the cap — but its interior is
  // replaced wholesale, so only the two cut points matter: map each edge with its own
  // tiny window. Falls back to null (copy) only when the message can't be anchored.
  function mapRenderedSpanToRaw(R, A, rs, re) {
    var n = R.length, m = A.length;
    if (!n || !m) return null;
    if (rs < 0 || re > n || re < rs) return null;
    // Rendered text identical to stored text means the engine transformed
    // NOTHING in this message: no macro expanded, no marker stripped, no quote
    // curled. Every "*" or "_" the user sees is a literal character, not
    // formatting — orphaning is impossible, and the splice replaces exactly
    // what was on screen. The balance heuristic exists to protect transforms;
    // with none present it can only false-refuse. Identity-map and skip it.
    // NOTE: sound only as a WHOLE-MESSAGE check. A per-window version in
    // windowMap below cannot skip spanIsBalanced — its re-check runs against
    // the FULL document precisely to catch pairs straddling the window edge.
    if (R === A) return { as: rs, ae: re };
    if (n * m <= 4000000) return alignExact(R, A, rs, re);
    var whole = windowMap(R, A, rs, re);
    if (whole) return whole;
    // Selection too large to align as one window — map the START and END edges
    // independently (1-char windows), then splice everything between them.
    if (re - rs < 1) return null;
    var startSpan = windowMap(R, A, rs, rs + 1);
    var endSpan = windowMap(R, A, re - 1, re);
    if (!startSpan || !endSpan || endSpan.ae < startSpan.as) return null;
    // Each edge was validated against its own window; the span BETWEEN them never
    // was, and that interior is what gets replaced. Re-check the composed span.
    if (!spanIsBalanced(A, startSpan.as, endSpan.ae)) return null;
    return { as: startSpan.as, ae: endSpan.ae };
  }
  function wcDiff(a, b) {
    var d = wc(b) - wc(a), p = wc(a) ? Math.round((d / wc(a)) * 100) : 0;
    return (d >= 0 ? "+" : "") + d + " words (" + (p >= 0 ? "+" : "") + p + "%)";
  }
  function formatPct(v) { return (v >= 0 ? "+" : "") + v + "%"; }

  // ── Word-level diff (capped) ───────────────────────────────────────────────
  var DIFF_TOKEN_CAP = 500;
  function computeWordDiff(oldStr, newStr) {
    var oldToks = oldStr.split(/(\s+)/);
    var newToks = newStr.split(/(\s+)/);
    if (oldToks.length > DIFF_TOKEN_CAP * 2) oldToks = oldToks.slice(0, DIFF_TOKEN_CAP * 2);
    if (newToks.length > DIFF_TOKEN_CAP * 2) newToks = newToks.slice(0, DIFF_TOKEN_CAP * 2);
    var m = oldToks.length, n = newToks.length;
    if (m * n > DIFF_TOKEN_CAP * DIFF_TOKEN_CAP) return null;
    var dp = [];
    for (var i = 0; i <= m; i++) { dp[i] = []; for (var j = 0; j <= n; j++) dp[i][j] = 0; }
    for (var i = 1; i <= m; i++) {
      for (var j = 1; j <= n; j++) {
        dp[i][j] = oldToks[i - 1] === newToks[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    var ops = [], i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldToks[i - 1] === newToks[j - 1]) {
        ops.unshift({ t: "eq", v: oldToks[i - 1] }); i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        ops.unshift({ t: "ins", v: newToks[j - 1] }); j--;
      } else {
        ops.unshift({ t: "del", v: oldToks[i - 1] }); i--;
      }
    }
    return ops;
  }

  function renderDiff(el, oldStr, newStr) {
    var ops = computeWordDiff(oldStr, newStr);
    el.innerHTML = "";
    if (!ops) { el.textContent = newStr; return; }
    ops.forEach(function (op) {
      if (op.t === "eq") {
        el.appendChild(document.createTextNode(op.v));
      } else {
        var s = document.createElement("span");
        s.style.cssText = op.t === "ins"
          ? "color:#10b981;font-weight:700;"
          : "color:#ef4444;text-decoration:line-through;opacity:.65;";
        s.textContent = op.v;
        el.appendChild(s);
      }
    });
  }

  // ── DOM ───────────────────────────────────────────────────────────────────
  function mk(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt !== undefined) n.textContent = txt;
    return n;
  }
  function ap(p, c) { if (p && c) p.appendChild(c); return c; }
  function mkBtn(label, cls, fn) {
    var b = mk("button", "rwa-btn" + (cls ? " " + cls : ""), label);
    b.addEventListener("click", function (e) { e.stopPropagation(); fn(e); });
    return b;
  }
  function xBtn(fn) {
    var b = mkBtn("", null, fn);
    b.innerHTML = svgEl(ICON.x);
    b.setAttribute("aria-label", "Close");
    b.style.cssText = "flex:0 0 auto;padding:5px;color:var(--muted-foreground);display:inline-flex;align-items:center;justify-content:center;";
    return b;
  }
  var ICON = {
    edit:  '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    undo:  '<path d="M9 14 4 9l5-5"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
    redo:  '<path d="m15 14 5-5-5-5"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>',
    gear:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
    plus:  '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    x:     '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    grip:  '<path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01"/>',
    chevron: '<polyline points="18 15 12 9 6 15"/>',
    pin:   '<line x1="12" y1="17" x2="12" y2="22"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z"/>',
    eye:   '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff:'<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M6.61 6.61A18.5 18.5 0 0 0 1 12s4 8 11 8a9.12 9.12 0 0 0 5.39-1.61"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  };
  function svgEl(paths, size) {
    var s = size || 16;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
  }
  function iconBtn(paths, cls, fn, aria) {
    var b = mk("button", "rwa-ibtn" + (cls ? " " + cls : ""));
    if (aria) b.setAttribute("aria-label", aria);
    b.innerHTML = svgEl(paths);
    b.addEventListener("click", function (e) { e.stopPropagation(); fn(e); });
    return b;
  }
  // Compact icon+label action button (header actions).
  function actBtn(paths, label, cls, fn) {
    var b = mkBtn("", cls, fn);
    b.classList.add("rwa-btn-sm");
    b.innerHTML = svgEl(paths) + "<span>" + label + "</span>";
    return b;
  }

  // ── State ─────────────────────────────────────────────────────────────────
  var popup = null;
  var sel   = { text: "", mid: "", cid: null };
  var dragId = null;
  var _twCancel = null;
  var _movingPopup = false;  // set during a corner-grabber drag to suppress dismiss
  var _dragCleanup = null;   // N11: cleanup fn to remove drag listeners on killPopup
  var _ctxOff = {};          // per-popup overrides: context sources excluded via the dots


  // ── Tooltip helpers ───────────────────────────────────────────────────────
  var _tip = null;
  function showTip(anchor, text) {
    if (!_tip) { _tip = mk("div", "rwa-tip"); document.body.appendChild(_tip); }
    _tip.textContent = text;
    var r = anchor.getBoundingClientRect();
    _tip.style.left = (r.right + 8) + "px";
    _tip.style.top  = r.top + "px";
    marinara.setTimeout(function () {
      if (!_tip) return;
      var tw = _tip.offsetWidth;
      if (r.right + 8 + tw > window.innerWidth) _tip.style.left = (r.left - tw - 8) + "px";
      _tip.classList.add("rwa-tip-show");
    }, 0);
  }
  function hideTip() { if (_tip) _tip.classList.remove("rwa-tip-show"); }

  // ── Popup ─────────────────────────────────────────────────────────────────
  function killPopup() {
    hideTip();
    if (_twCancel) { _twCancel(); _twCancel = null; }
    if (_dragCleanup) { _dragCleanup(); _dragCleanup = null; } // N11: remove any in-flight drag listeners
    if (popup) { popup.remove(); popup = null; }
  }

  function showPopup(rect, segments) {
    _movingPopup = false; // N11: defensive reset so a previous stuck drag doesn't swallow this selection
    killPopup();
    _ctxOff = {};
    var cid = getChatId();
    // segments: [{mid, text, occ}] in document order. sel.text/mid/occ mirror the
    // first segment so single-message helpers (Custom Prompt, undo) keep working.
    sel = {
      segments: segments,
      text: segments[0].text,
      mid: segments[0].mid,
      occ: segments[0].occ || 0,
      fp: segments[0].fp || null,
      cid: cid,
    };

    var colCount  = Math.max(1, cfg.cols || 2);
    var rowCount  = Math.max(1, cfg.rows || 6);
    var estWidth  = Math.max(200, colCount * 115) + 20;
    var panelRows = 2 + (cfg.localContextEnabled ? 1 : 0) + (cfg.useUserPersona ? 1 : 0) +
      (cfg.useCharCard ? 1 : 0) + (cfg.useLorebookEntries ? 1 : 0) + (cfg.usePrevMessages ? 1 : 0) +
      (cfg.useExtenderMemory ? 1 : 0);
    var estHeight = rowCount * 34 - 4 + 140 + (cfg.ctxCollapsed ? 0 : panelRows * 16);

    var lft = rect.left;
    var top;
    var pos = cfg.popupPos || "auto";
    if (pos === "above") {
      top = rect.top - estHeight - 8;
    } else if (pos === "below") {
      top = rect.bottom + 8;
    } else {
      top = rect.bottom + 8;
      if (top + estHeight > window.innerHeight) top = rect.top - estHeight - 8;
    }
    if (lft + estWidth > window.innerWidth) lft = window.innerWidth - estWidth - 8;

    // Pinned: appear at the locked spot (clamped to the viewport) instead of by
    // the selection. Content still re-populates for each new selection.
    if (cfg.pinnedPos) {
      lft = Math.min(parseFloat(cfg.pinnedPos.left) || lft, window.innerWidth - estWidth - 8);
      top = Math.min(parseFloat(cfg.pinnedPos.top) || top, window.innerHeight - 60);
    }

    var p = mk("div", "rwa");
    p.style.left     = Math.max(8, lft) + "px";
    p.style.top      = Math.max(8, top) + "px";
    p.style.minWidth = Math.max(200, colCount * 115) + "px";
    document.body.appendChild(p);
    popup = p;

    ap(p, mk("div", "rwa-topbar"));

    var mhdr = ap(p, mk("div", "rwa-mini-hdr"));
    ap(mhdr, mk("span", "rwa-mini-title", "REWRITE"));
    var selTok = segments.reduce(function (s, g) { return s + tokest(g.text); }, 0);
    var sub = ap(mhdr, mk("span", "rwa-mini-sub",
      (segments.length > 1 ? segments.length + " messages" : "1 message") + " · ~" + selTok + " tok"));
    if (segments.length > 1) { sub.style.color = "var(--primary)"; sub.title = "Selection spans " + segments.length + " messages; each is rewritten in turn."; }

    // Collapse chevron for the token panel (sits at the top-right of the header).
    var collapseBtn = mk("button", "rwa-ibtn");
    collapseBtn.style.cssText = "width:18px;height:18px;margin-left:auto;flex:0 0 auto;";
    collapseBtn.setAttribute("aria-label", "Collapse token panel");
    ap(mhdr, collapseBtn);

    // ── Context cost panel: selection (instant) + each enabled source (async,
    // cached). Empty dot = fetch pending; green dot = counted. Total updates live.
    var partsToks = { sel: selTok, local: 0, persona: 0, card: 0, lore: 0, prev: 0, memory: 0 };
    var ctxPanel = ap(p, mk("div", "rwa-ctx"));
    ctxPanel.style.cssText = "padding:2px 12px 4px;font-size:10px;color:var(--muted-foreground);line-height:1.6;";
    function setCollapsed(on) {
      cfg.ctxCollapsed = on; saveC();
      ctxPanel.style.display = on ? "none" : "";
      collapseBtn.innerHTML = svgEl(ICON.chevron, 14);
      collapseBtn.firstChild.style.transition = "transform .15s";
      collapseBtn.firstChild.style.transform = on ? "rotate(180deg)" : "";
      collapseBtn.setAttribute("aria-label", on ? "Show token panel" : "Collapse token panel");
    }
    collapseBtn.addEventListener("click", function (e) { e.stopPropagation(); setCollapsed(!cfg.ctxCollapsed); });
    // Dot states: pending (empty) → counting; on (green) → counted & included;
    // off (red) → user-excluded via click, dropped from the next rewrite.
    function paintDot(dot, state) {
      var c = state === "off" ? "#ef4444" : state === "on" ? "#22c55e" : "var(--muted-foreground)";
      dot.style.cssText = "width:8px;height:8px;border-radius:50%;flex:0 0 auto;border:1px solid " + c +
        ";background:" + (state === "pending" ? "transparent" : c) + ";";
    }
    var ctxRows = {};
    function repaint(key) {
      var r = ctxRows[key]; if (!r) return;
      var off = r.tkey && _ctxOff[r.tkey];
      paintDot(r.dot, off ? "off" : (r.loaded ? "on" : "pending"));
      r.val.style.textDecoration = off ? "line-through" : "";
      r.val.style.opacity = off ? ".7" : "";
      if (off) r.val.textContent = r.loaded ? ("~" + r.toks + " off") : "off";
      else r.val.textContent = r.loaded ? (r.toks > 0 ? ("~" + r.toks + " tok") : "none") : "counting…";
    }
    function addCtxRow(key, label, pending, tkey) {
      var row = mk("div", ""); row.style.cssText = "display:flex;align-items:center;gap:6px;";
      var dot = mk("span", "");
      var nm = mk("span", "", label); nm.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      var val = mk("span", "");
      row.appendChild(dot); row.appendChild(nm); row.appendChild(val);
      ap(ctxPanel, row);
      ctxRows[key] = { dot: dot, val: val, tkey: tkey || null, loaded: !pending, toks: 0 };
      if (tkey) {
        dot.style.cursor = "pointer";
        row.title = "Click the dot to include / exclude this source from the rewrite.";
        dot.addEventListener("click", function (e) { e.stopPropagation(); _ctxOff[tkey] = !_ctxOff[tkey]; repaint(key); updateTotal(); });
      } else if (pending) {
        row.title = "Counting… fetched live from the app and cached for 20s (no model call — local only).";
      }
      repaint(key);
    }
    function fillCtxRow(key, toks) {
      var r = ctxRows[key]; if (!r) return;
      r.loaded = true; r.toks = toks; repaint(key);
    }
    function updateTotal() {
      var t = partsToks.sel +
        (_ctxOff.local ? 0 : partsToks.local) + (_ctxOff.persona ? 0 : partsToks.persona) +
        (_ctxOff.card ? 0 : partsToks.card) + (_ctxOff.lore ? 0 : partsToks.lore) +
        (_ctxOff.prev ? 0 : partsToks.prev) + (_ctxOff.memory ? 0 : partsToks.memory);
      if (ctxRows.total) { ctxRows.total.val.textContent = "~" + t + " tok"; ctxRows.total.val.style.fontWeight = "700"; }
    }
    addCtxRow("sel", "Selected text", false); fillCtxRow("sel", partsToks.sel);
    if (cfg.localContextEnabled) {
      partsToks.local = tokest(extractLocalContext(sel.mid, sel.text, sel.occ)); // N12: pass occ
      addCtxRow("local", "Surrounding", false, "local"); fillCtxRow("local", partsToks.local);
    }
    var asyncSrc = [];
    if (cfg.useUserPersona)     { addCtxRow("persona", "Persona", true, "persona");    asyncSrc.push(["persona", "persona"]); }
    if (cfg.useCharCard)        { addCtxRow("card", "Character", true, "card");        asyncSrc.push(["card", "card"]); }
    if (cfg.useLorebookEntries) { addCtxRow("lore", "Lorebook", true, "lore");         asyncSrc.push(["lore", "lore"]); }
    if (cfg.usePrevMessages)    { addCtxRow("prev", "Prev messages", true, "prev");    asyncSrc.push(["prev", "prev"]); }
    // Memory row: async, independent of fetchContextParts (uses fetchExtenderMemory).
    // Shown whenever cfg.useExtenderMemory is on — same gate as the rewrite path.
    // Speaker note is a tiny constant hint (~20 tok) with no per-popup exclusion and
    // no variable cost worth surfacing; it is not shown as a panel row.
    var hasMemory = !!cfg.useExtenderMemory;
    if (hasMemory) { addCtxRow("memory", "Extender memory", true, "memory"); }
    addCtxRow("total", "Total", asyncSrc.length > 0 || hasMemory); updateTotal();
    if (asyncSrc.length && cid) {
      var myPopup = popup; // N15: capture at call time; bail if a newer popup has replaced this one
      fetchContextParts(cid, sel.mid).then(function (parts) {
        if (!popup || popup !== myPopup) return; // stale fetch — popup was killed or replaced
        asyncSrc.forEach(function (s) { partsToks[s[0]] = tokest(parts[s[1]]); fillCtxRow(s[0], partsToks[s[0]]); });
        if (!hasMemory && ctxRows.total) { ctxRows.total.loaded = true; paintDot(ctxRows.total.dot, "on"); }
        updateTotal();
      }).catch(function () {});
    }
    if (hasMemory && cid) {
      var myPopupMem = popup; // capture for staleness check
      fetchExtenderMemory(cid).then(function (memText) {
        if (!popup || popup !== myPopupMem) return;
        partsToks.memory = tokest(memText);
        fillCtxRow("memory", partsToks.memory);
        if (ctxRows.total) { ctxRows.total.loaded = true; paintDot(ctxRows.total.dot, "on"); }
        updateTotal();
      }).catch(function () {
        if (!popup || popup !== myPopupMem) return;
        fillCtxRow("memory", 0);
        if (ctxRows.total) { ctxRows.total.loaded = true; paintDot(ctxRows.total.dot, "on"); }
        updateTotal();
      });
    }
    setCollapsed(!!cfg.ctxCollapsed); // apply persisted collapse state + chevron icon

    // Trim flyout (single-segment only): edit/trim the selection before sending.
    function showTrim() {
      hideTip();
      var orig = sel.text;
      var ov = mkOv(10003);
      var body = mkWin(ov, "480px", "Trim selection before sending");
      ap(body, mk("div", "rwa-plbl", "Text to send — trim the edges"));
      var ta = mk("textarea", "rwa-inp");
      ta.value = orig;
      ta.style.cssText = "width:100%;min-height:120px;font-size:12px;line-height:1.5;resize:vertical;";
      ap(body, ta);
      var info = mk("div", ""); info.style.cssText = "font-size:10px;margin:6px 0 12px;line-height:1.6;";
      ap(body, info);
      function upd() {
        var v = ta.value.trim();
        var ok = v.length > 0 && orig.indexOf(v) !== -1;
        info.innerHTML = "";
        var meta = mk("span", "", "~" + tokest(v) + " tok · " + v.length + " chars");
        meta.style.color = "var(--muted-foreground)"; ap(info, meta);
        var hint = mk("span", "", ok ? "   ✓ within the original selection"
          : (v.length ? "   ⚠ edited beyond the original — the rewrite may not apply cleanly" : "   ⚠ empty"));
        hint.style.color = ok ? "#22c55e" : "var(--destructive, #ef4444)";
        ap(info, hint);
      }
      ta.addEventListener("input", upd); upd();
      var ft2 = ap(body, mk("div", "rwa-foot"));
      ap(ft2, mkBtn("Cancel", null, function () { ov.remove(); })).style.flex = "1";
      ap(ft2, mkBtn("Use this text", null, function () {
        var v = ta.value.trim();
        if (!v) { showToast(null, "Selection can't be empty."); return; }
        sel.text = v;
        if (sel.segments && sel.segments[0]) sel.segments[0].text = v;
        partsToks.sel = tokest(v); fillCtxRow("sel", partsToks.sel);
        if (cfg.localContextEnabled) { partsToks.local = tokest(extractLocalContext(sel.mid, v, sel.occ)); fillCtxRow("local", partsToks.local); } // N12: pass occ
        updateTotal();
        ov.remove();
        showToast(null, "Selection set to ~" + partsToks.sel + " tok", "ok");
      })).style.flex = "1";
    }

    var grid = ap(p, mk("div", "rwa-grid"));
    grid.style.gridTemplateColumns = "repeat(" + colCount + ", 1fr)";
    grid.style.maxHeight = (rowCount * 34 - 4) + "px";

    // Pinned auto-profile (full-width, above the grid) when one exists for this chat.
    var activeAutoProf = cid && autoProfs[cid] ? autoProfs[cid] : null;
    if (activeAutoProf) {
      var autoPr = { id: activeAutoProf.id, name: activeAutoProf.name, prompt: activeAutoProf.prompt };
      var ab = mk("button", "rwa-auto");
      ab.innerHTML = svgEl(ICON.spark);
      var albl = mk("span", "", activeAutoProf.name);
      albl.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      ab.appendChild(albl);
      ab.addEventListener("mouseenter", function () { showTip(ab, activeAutoProf.name + ": " + activeAutoProf.prompt + "  (instruction ~" + tokest(activeAutoProf.prompt) + " tok)"); });
      ab.addEventListener("mouseleave", hideTip);
      ab.addEventListener("click", function (e) { e.stopPropagation(); hideTip(); doRewrite(autoPr); });
      p.insertBefore(ab, grid);
    }

    profiles.slice().filter(function (pr) { return !pr.hidden; }).sort(function (a, b) { return ((a.order || 0) - (b.order || 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }).forEach(function (pr) { // N18: stable tiebreaker by id
      var b = mk("button", "rwa-pb", pr.name);
      b.addEventListener("mouseenter", function () { showTip(b, pr.name + ": " + pr.prompt + "  (instruction ~" + tokest(pr.prompt) + " tok)"); });
      b.addEventListener("mouseleave", hideTip);
      b.addEventListener("click", function (e) { e.stopPropagation(); hideTip(); doRewrite(pr); });
      ap(grid, b);
    });

    var slRow = ap(p, mk("div", "rwa-slider-row"));
    var togWrap = mk("label", "rwa-toggle-wrap");
    var togInp  = mk("input"); togInp.type = "checkbox"; togInp.checked = !!cfg.lengthEnabled;
    var togSl   = mk("span", "rwa-toggle-sl");
    togWrap.appendChild(togInp); togWrap.appendChild(togSl);
    ap(slRow, togWrap);
    ap(slRow, mk("span", "rwa-slider-lbl", "LENGTH"));
    var range = mk("input", "rwa-range");
    range.type = "range"; range.min = "-99";
    range.max = String(Math.max(200, cfg.lengthPct || 0));
    range.value = String(cfg.lengthPct || 0);
    ap(slRow, range);
    var valLbl = ap(slRow, mk("span", "rwa-slider-val", formatPct(cfg.lengthPct || 0)));
    valLbl.title = "Click to type an exact percentage";
    function updateSlider() {
      var on = !!cfg.lengthEnabled;
      slRow.style.opacity = on ? "1" : "0.45";
      range.disabled = !on;
    }
    updateSlider();
    range.addEventListener("input", function () {
      cfg.lengthPct = parseInt(range.value, 10);
      valLbl.textContent = formatPct(cfg.lengthPct);
      saveC();
    });
    // Click the readout to type an exact value (can exceed the slider's 200% range).
    function commitLen(v) {
      v = Math.max(-99, Math.min(1000, Math.round(isNaN(v) ? 0 : v)));
      cfg.lengthPct = v;
      if (v > parseInt(range.max, 10)) range.max = String(v);
      range.value = String(v);
      valLbl.textContent = formatPct(v);
      saveC();
    }
    valLbl.addEventListener("click", function () {
      if (!cfg.lengthEnabled) return;
      var inp = mk("input", "rwa-len-inp");
      inp.type = "number"; inp.min = "-99"; inp.max = "1000";
      inp.value = String(cfg.lengthPct || 0);
      slRow.replaceChild(inp, valLbl);
      inp.focus(); inp.select();
      var closed = false;
      function done(apply) {
        if (closed) return; closed = true;
        if (apply) commitLen(parseInt(inp.value, 10));
        if (inp.parentNode === slRow) slRow.replaceChild(valLbl, inp);
      }
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); done(true); }
        else if (e.key === "Escape") { e.preventDefault(); done(false); }
      });
      inp.addEventListener("blur", function () { done(true); });
    });
    togInp.addEventListener("change", function () {
      cfg.lengthEnabled = togInp.checked;
      saveC();
      updateSlider();
    });

    var ft = ap(p, mk("div", "rwa-foot"));
    var ub = mkBtn("", "rwa-sq", doUndo);
    ub.innerHTML = svgEl(ICON.undo); ub.setAttribute("aria-label", "Undo last rewrite");
    if (!hist.length) ub.disabled = true;
    ap(ft, ub);
    var rb2 = mkBtn("", "rwa-sq", doRedo);
    rb2.innerHTML = svgEl(ICON.redo); rb2.setAttribute("aria-label", "Redo last undo");
    if (!redo.length) rb2.disabled = true;
    ap(ft, rb2);
    var single = segments.length === 1;
    var tb = mkBtn("", "rwa-sq", function () { if (single) showTrim(); });
    tb.innerHTML = svgEl(ICON.edit);
    tb.setAttribute("aria-label", single ? "Trim selection before sending" : "Trim unavailable for multi-message selections");
    tb.title = single ? "Trim the selection before sending" : "Trimming works on single-message selections only — select within one message.";
    if (!single) { tb.style.opacity = ".4"; tb.style.cursor = "not-allowed"; }
    ap(ft, tb);
    ap(ft, mkBtn("Custom prompt", null, showCustom)).style.flex = "1";
    var pb2 = mkBtn("", "rwa-sq", function () {
      cfg.pinnedPos = cfg.pinnedPos ? null : { left: p.style.left, top: p.style.top };
      saveC(); paintPin();
    });
    pb2.innerHTML = svgEl(ICON.pin);
    function paintPin() {
      var on = !!cfg.pinnedPos;
      pb2.style.color = on ? "var(--primary)" : "";
      pb2.setAttribute("aria-label", on ? "Unpin (popup follows your selection)" : "Pin popup to this spot");
      pb2.title = on ? "Pinned here — new selections open the popup at this spot. Click to unpin." : "Pin the popup to this spot.";
    }
    paintPin();
    ap(ft, pb2);
    var gb = mkBtn("", "rwa-sq", showSettings);
    gb.innerHTML = svgEl(ICON.gear); gb.setAttribute("aria-label", "Settings");
    ap(ft, gb);

    // Corner grabbers (bottom-left/right): drag to move the popup.
    // N11 fix: (a) store handler refs and remove them in killPopup via _dragCleanup;
    // (b) only set _movingPopup after actual movement so a grip click doesn't swallow
    //     the next text selection; (c) showPopup resets _movingPopup defensively.
    function startDrag(e) {
      e.preventDefault(); e.stopPropagation();
      var sx = e.clientX, sy = e.clientY, r = p.getBoundingClientRect(), ox = r.left, oy = r.top;
      var moved = false; // track whether the mouse actually moved
      function mv(ev) {
        moved = true;
        var nx = Math.max(4, Math.min(ox + (ev.clientX - sx), window.innerWidth - p.offsetWidth - 4));
        var ny = Math.max(4, Math.min(oy + (ev.clientY - sy), window.innerHeight - p.offsetHeight - 4));
        p.style.left = nx + "px"; p.style.top = ny + "px";
      }
      function up() {
        if (moved) _movingPopup = true; // only suppress selection if the grip was actually dragged
        if (moved && cfg.pinnedPos) { cfg.pinnedPos = { left: p.style.left, top: p.style.top }; saveC(); }
        document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up, true);
        _dragCleanup = null;
      }
      // Store a cleanup fn so killPopup can remove these listeners even if up() never fires.
      _dragCleanup = function () {
        document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up, true);
      };
      document.addEventListener("mousemove", mv);
      document.addEventListener("mouseup", up, true); // capture: runs before the selection handler
    }
    ["left", "right"].forEach(function (side) {
      var g = mk("div", "");
      g.title = "Drag to move";
      var base = "position:absolute;bottom:0;" + side + ":0;width:11px;height:11px;cursor:move;z-index:2;transition:opacity .12s;" +
        "background:repeating-linear-gradient(" + (side === "left" ? "45deg" : "-45deg") +
        ",var(--muted-foreground) 0 1px,transparent 1px 4px);";
      g.style.cssText = base + "opacity:.12;";
      g.addEventListener("mousedown", startDrag);
      g.addEventListener("mouseenter", function () { g.style.opacity = ".55"; });
      g.addEventListener("mouseleave", function () { g.style.opacity = ".12"; });
      ap(p, g);
    });
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  function showErr(msg) {
    if (!popup) {
      var p = mk("div", "rwa");
      p.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);min-width:280px;max-width:400px;";
      document.body.appendChild(p);
      popup = p;
    }
    popup.innerHTML = "";
    ap(popup, mk("div", "rwa-err", msg));
    var ft = ap(popup, mk("div", "rwa-foot"));
    ap(ft, mkBtn("Close", null, killPopup)).style.flex = "1";
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────
  function mkOv(z) {
    var ov = mk("div", "rwa-ov");
    ov.style.zIndex = String(z);
    document.body.appendChild(ov);
    return ov;
  }

  function mkWin(ov, w, title) {
    var win = ap(ov, mk("div", "rwa-win"));
    if (w) win.style.width = w;
    ap(win, mk("div", "rwa-bar"));
    var hdr = ap(win, mk("div", "rwa-hdr"));
    var titleEl = ap(hdr, mk("div", "rwa-title", title));
    ap(hdr, xBtn(function () { ov.remove(); }));
    var body = ap(win, mk("div", "rwa-body"));
    body._titleEl = titleEl;
    return body;
  }

  // ── Token estimate ────────────────────────────────────────────────────────
  // Rough estimate (~4 chars/token). NOT a real tokenizer — exact counts vary by
  // model. Always shown with a leading "~" so it never reads as authoritative.
  function tokest(str) { return str ? Math.ceil(String(str).length / 4) : 0; }
  var _lastCost = null; // { prompt, sel, total } from the most recent assembly
  function costLine(c) {
    var d = mk("div", "rwa-cost",
      "~" + c.total + " tokens  ·  prompt ~" + c.prompt + "  ·  highlighted ~" + c.sel);
    d.style.cssText = "font-size:10px;color:var(--muted-foreground);margin:2px 0 10px;letter-spacing:.02em;";
    d.title = "Rough estimate (~4 chars per token). Actual tokens vary by model and tokenizer.";
    return d;
  }

  function showModalErr(ov, body, msg) {
    body.innerHTML = "";
    if (body._titleEl) body._titleEl.textContent = "Error";
    ap(body, mk("div", "rwa-err", msg));
    var ft = ap(body, mk("div", "rwa-foot"));
    ap(ft, mkBtn("Close", null, function () { ov.remove(); })).style.flex = "1";
  }

  // Review mode: show the spliced raw content in an editable textarea and only
  // PATCH (with whatever the user edited) when they click Apply.
  // onFail mirrors doCommit's: applyMerged recurses from onDone and aggregates from
  // onFail, so every exit that is neither a write nor a retry must call one of them
  // or a multi-message chain stalls with no partial-apply summary. That applies to
  // the review modal too — declining the overwrite, and Cancel, both end the chain.
  function reviewThenPatch(cid, mid, oldContent, proposed, onDone, onFail) {
    var ov = mkOv(10010);
    var body = mkWin(ov, "560px", "Review & edit before applying");
    var ta = ap(body, mk("textarea", "rwa-inp"));
    ta.value = proposed;
    ta.style.cssText = "width:100%;min-height:240px;resize:vertical;white-space:pre-wrap;font-family:inherit;";
    var ft = ap(body, mk("div", "rwa-foot"));
    ap(ft, mkBtn("Apply", "rwa-accept", function () {
      var content = ta.value;
      // B2: `proposed` was spliced together BEFORE this modal opened and the modal
      // has no timeout, so the race window is however long the user left it open —
      // the widest of any write path here. Re-read and compare before writing.
      guardedPatch(cid, mid, oldContent, content, "review")
        .then(function (res) {
          // Declined: nothing written, no history entry, and the modal stays so the
          // rewrite is still recoverable — but the chain has ended, so say so.
          if (!res) { if (onFail) onFail(null); return; }
          var depth = Math.max(1, Math.min(20, cfg.historyDepth || 5));
          hist.unshift({ mid: mid, cid: cid, old: oldContent, post: content, when: Date.now() });
          if (hist.length > depth) hist.length = depth;
          if (redo.length) { redo.length = 0; saveRedo(); }
          saveH();
          ov.remove();
          showToast(null, "✓ Applied", "ok");
          if (onDone) onDone();
        })
        .catch(function (e) {
          // The THIRD exit from this modal, and the one that stayed broken after the
          // decline and Cancel paths were fixed: a save failure showed its modal and
          // returned without calling either callback, so a reviewed multi-message
          // merge stalled with no partial-apply summary — exactly the bug the summary
          // was added to prevent. Every exit that is not a write must report.
          showErr("Save failed:\n" + (e && e.message ? e.message : String(e)));
          if (onFail) onFail("Save failed");
        });
    })).style.flex = "2";
    ap(ft, mkBtn("Cancel", null, function () { ov.remove(); if (onFail) onFail(null); })).style.flex = "1";
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(anchorEl, msg, variant) {
    var t = mk("div", "rwa-toast" + (variant === "ok" ? " rwa-toast-ok" : ""), msg);
    if (anchorEl) {
      var rect = anchorEl.getBoundingClientRect();
      t.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 330)) + "px";
      t.style.top  = (rect.top > 60 ? rect.top - 50 : rect.bottom + 8) + "px";
    } else {
      t.style.bottom = "80px";
      t.style.left = "50%";
      t.style.transform = "translateX(-50%)";
    }
    document.body.appendChild(t);
    marinara.setTimeout(function () {
      t.style.opacity = "0";
      marinara.setTimeout(function () { t.remove(); }, 420);
    }, 3200);
  }

  // ── Rewrite — opens generation modal ─────────────────────────────────────
  // ── Inference: route to a Marinara connection, the local sidecar model, or a
  //    direct OpenAI-compatible endpoint ────────────────────────────────────────
  // Resolves to { result: string } or { error: string } so callers stay identical.
  var CONN_MODES = ["marinara", "sidecar", "direct", "extender"];
  function runInference(systemPrompt, userPrompt, signal) {
    var mode = CONN_MODES.indexOf(cfg.connMode) >= 0 ? cfg.connMode : "marinara";
    var started = Date.now();
    var p;
    if (mode === "marinara") {
      // Runs through a connection already configured in Marinara. The key is
      // stored (encrypted) server-side and never reaches the extension, so this
      // needs no second copy of your credentials.
      if (!cfg.connectionId) {
        return Promise.resolve({ error: "No Marinara connection selected (Settings → Connection)." });
      }
      logDbg("inference.request", { mode: mode, connectionId: cfg.connectionId, system: systemPrompt, user: userPrompt });
      p = marinara.apiFetch("/generate/raw", {
        method: "POST",
        body: JSON.stringify({
          connectionId: cfg.connectionId,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          streaming: false,
        }),
        signal: signal,
      }).then(function (j) {
        // apiFetch resolves on 4xx/5xx, so an error body arrives here as data.
        // null means the body was not JSON at all — hand it to the shared
        // normalizer below rather than inventing a message here.
        if (!j) return null;
        if (j.error) return { error: typeof j.error === "string" ? j.error : JSON.stringify(j.error) };
        return { result: typeof j.content === "string" ? j.content : "" };
      });
    } else if (mode === "sidecar") {
      logDbg("inference.request", { mode: mode, system: systemPrompt, user: userPrompt });
      // apiFetch spreads options into the native fetch, so `signal` is honoured —
      // cancelling aborts the sidecar request, not just the UI.
      p = marinara.apiFetch("/sidecar/tracker", {
        method: "POST",
        body: JSON.stringify({ systemPrompt: systemPrompt, userPrompt: userPrompt }),
        signal: signal,
      });
    } else {
      // Direct mode: OpenAI-compatible endpoint (Ollama, llama.cpp, etc.)
      // Extender mode: Marinara Extender sidecar — same OpenAI-compatible protocol,
      //   but uses cfg.extenderUrl, auto-appends /v1, sends no model/auth fields
      //   (the Extender uses its own configured model).
      var isExtender = (mode === "extender");
      var rawBase = isExtender ? (cfg.extenderUrl || "http://127.0.0.1:3001") : (cfg.apiUrl || "");
      // Accept bare host, ".../v1", or a full ".../chat/completions" paste.
      var base = rawBase.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
      if (isExtender && !/\/v1$/.test(base)) base += "/v1";
      if (!base) return Promise.resolve({ error: isExtender ? "No Extender URL set (Settings → Connection)." : "No API URL set (Settings → Connection)." });
      if (!isExtender && !cfg.apiModel) return Promise.resolve({ error: "No model name set (Settings → Connection)." });
      var endpoint = base + "/chat/completions";
      var temp = typeof cfg.directTemp === "number" ? cfg.directTemp : 0.7;
      logDbg("inference.request", { mode: mode, endpoint: endpoint, model: isExtender ? "(extender)" : cfg.apiModel, temperature: temp, system: systemPrompt, user: userPrompt });
      var headers = { "Content-Type": "application/json" };
      if (cfg.apiKey && !isExtender) headers["Authorization"] = "Bearer " + cfg.apiKey;
      var reqBody = {
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        temperature: temp,
        stream: false,
      };
      if (!isExtender) reqBody.model = cfg.apiModel; // Extender uses its own configured model
      p = fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(reqBody),
        signal: signal,
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, json: j }; });
        })
        .then(function (o) {
          var j = o.json || {};
          if (j.error) return { error: j.error.message || j.error.type || JSON.stringify(j.error) };
          if (!o.status || o.status >= 400) return { error: "HTTP " + o.status + " from endpoint." };
          var msg = j.choices && j.choices[0] && j.choices[0].message;
          return { result: msg && typeof msg.content === "string" ? (msg.content || "") : "" };
        })
        .catch(function (e) {
          // A user-cancelled request rejects with an AbortError — that's not a
          // failure to report, so swallow it as an explicit aborted outcome.
          if ((signal && signal.aborted) || (e && e.name === "AbortError")) return { aborted: true };
          return {
            error: (isExtender ? "Extender request failed: " : "Direct API request failed: ") +
              (e && e.message ? e.message : String(e)) +
              (isExtender
                ? "\n\nIs the Marinara Extender sidecar running? Check the Extender server URL in Settings → Connection."
                : "\n\nIf using Ollama, the browser is blocked by CORS — set OLLAMA_ORIGINS=* (env var) and restart Ollama."),
          };
        });
    }
    return p.then(function (resp) {
      // Sidecar mode returns apiFetch's value untouched, and apiFetch resolves null
      // when the body isn't JSON at all (a proxy error page, a crashed process).
      // Every caller tests `!resp || resp.aborted` in a single branch, so a null read
      // as "user cancelled": the Generating… modal stayed open forever with no error,
      // and a ledger slice sat on "rewriting…" with Accept-all disabled. Genuine
      // cancels never needed that branch — the Cancel button tears the modal down
      // itself. Shape it here, the one place all three callers pass through, rather
      // than teaching each of them the difference.
      // ...but check for a cancel first. Abort does NOT always reject: if the user
      // cancels after the response headers land while r.json() is still consuming the
      // body, that rejection is swallowed by apiFetch's own .catch into a resolved
      // null. Without this check the normalization below would pop an error dialog on
      // what was a perfectly ordinary cancellation.
      if (!resp && signal && signal.aborted) resp = { aborted: true };
      if (!resp) resp = { error: "The server returned an unreadable response (not JSON)." };
      logDbg("inference.response", {
        mode: mode,
        ms: Date.now() - started,
        error: (resp && resp.error) || null,
        result: resp && typeof resp.result === "string" ? resp.result : null,
      });
      return resp;
    }).catch(function (e) {
      // Sidecar mode aborts by rejecting the apiFetch promise. Treat a cancel as
      // an aborted outcome; let genuine errors propagate to the caller's .catch.
      if ((signal && signal.aborted) || (e && e.name === "AbortError")) {
        logDbg("inference.aborted", { mode: mode, ms: Date.now() - started });
        return { aborted: true };
      }
      throw e;
    });
  }

  // List models from the direct endpoint: Ollama's native /api/tags first, then
  // the OpenAI-compatible /models. Returns {models:[...]} or {error}.
  function discoverModels() {
    var base = (cfg.apiUrl || "").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
    if (!base) return Promise.resolve({ error: "No API URL set (Settings → Connection)." });
    var headers = {};
    if (cfg.apiKey) headers["Authorization"] = "Bearer " + cfg.apiKey;
    var root = base.replace(/\/v1$/, "");
    return fetch(root + "/api/tags", { headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (j) {
        var names = j && Array.isArray(j.models) ? j.models.map(function (m) { return m.name; }).filter(Boolean) : null;
        if (names && names.length) return { models: names };
        return fetch(base + "/models", { headers: headers })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j2) {
            var ids = j2 && Array.isArray(j2.data) ? j2.data.map(function (m) { return m.id; }).filter(Boolean) : [];
            return { models: ids };
          });
      })
      .catch(function (e) {
        return { error: "Discovery failed: " + (e && e.message ? e.message : String(e)) + " — if using Ollama, set OLLAMA_ORIGINS=* and restart it." };
      });
  }

  function doRewrite(profile, queue) {
    _lastCost = null;
    // Merge mode: rewrite the whole multi-message span as one, then split back.
    if (!queue && cfg.mergeMultiMsg && sel.segments && sel.segments.length > 1) {
      doMergeRewrite(profile, sel.segments);
      return;
    }
    // queue: { segments:[{mid,text}], index }. Built from sel on first call so a
    // multi-message selection is rewritten one message at a time.
    if (!queue) {
      var segs = (sel.segments && sel.segments.length) ? sel.segments : [{ mid: sel.mid, text: sel.text, occ: sel.occ || 0, fp: sel.fp || null }];
      queue = { segments: segs, index: 0 };
    }
    var seg = queue.segments[queue.index];
    var total = queue.segments.length;
    var savedSel = { text: seg.text, mid: seg.mid, cid: sel.cid, occ: seg.occ || 0, fp: seg.fp || null };
    killPopup();
    if (!savedSel.cid) savedSel.cid = getChatId();

    // Large selection → window it through the Ledger Pattern instead of one
    // truncated call. doLedgerRewrite advances the queue itself once it commits.
    if (tokest(savedSel.text) > sliceBudget()) {
      doLedgerRewrite(profile, savedSel, queue);
      return;
    }

    var controller = new AbortController();

    var ov   = mkOv(10002);
    var counter = total > 1 ? " (Msg " + (queue.index + 1) + "/" + total + ")" : "";
    var body = mkWin(ov, "560px", profile.name + counter + " \u2014 Generating\u2026");

    if (total > 1) {
      var note = ap(body, mk("div", "", "Selection spans " + total + " messages \u2014 rewriting each in turn."));
      note.style.cssText = "font-size:11px;color:var(--primary);margin-bottom:10px;font-weight:600;";
    }
    ap(body, mk("div", "rwa-plbl", "Selected Text"));
    var selBox = mk("div", "rwa-prev rwa-shimmer", savedSel.text);
    selBox.style.marginBottom = "14px";
    ap(body, selBox);

    var loadRow = mk("div", "");
    loadRow.style.cssText = "padding:8px 0 12px;";
    ap(loadRow, mk("div", "rwa-pulse"));
    var loadLbl = mk("div", "", "Rewriting\u2026");
    loadLbl.style.cssText = "font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;" +
      "color:var(--muted-foreground);margin-top:6px;text-align:center;";
    ap(loadRow, loadLbl);
    ap(body, loadRow);

    var ft = ap(body, mk("div", "rwa-foot"));
    ap(ft, mkBtn("Cancel", null, function () { controller.abort(); ov.remove(); })).style.flex = "1";

    var localCtx = (cfg.localContextEnabled && !_ctxOff.local) ? extractLocalContext(savedSel.mid, savedSel.text, savedSel.occ) : ""; // N12: pass occ

    // Extender memory and speaker note are fetched in parallel with context parts.
    var memPromise = fetchExtenderMemory(savedSel.cid);
    var speakerPromise = fetchSpeakerNote(savedSel.cid, savedSel.mid);

    Promise.all([fetchContextParts(savedSel.cid, savedSel.mid), memPromise, speakerPromise])
      .then(function (resolved) {
        var parts = resolved[0];
        // Respect per-popup dot overrides — an excluded source is dropped here.
        var cardCtx = _ctxOff.card ? "" : parts.card;
        var loreCtx = _ctxOff.lore ? "" : parts.lore;
        var prevCtx = _ctxOff.prev ? "" : parts.prev;
        var personaCtx = _ctxOff.persona ? "" : parts.persona;
        // Extender memory respects the memory-row exclusion dot (_ctxOff.memory).
        var memCtx = _ctxOff.memory ? "" : resolved[1];
        var speakerCtx = resolved[2];
        if (!ov.parentNode) return;
        var safeText = savedSel.text.length > 10000 ? savedSel.text.slice(0, 10000) + "\u2026" : savedSel.text;

        // Small models can't reason about "70% of the original", so convert the
        // percentage into an explicit target word-count range from the real count.
        var lengthNote = "";
        if (cfg.lengthEnabled && cfg.lengthPct !== 0) {
          var ow = wc(safeText);
          var target = Math.max(1, Math.round(ow * (1 + cfg.lengthPct / 100)));
          var lo = Math.max(1, Math.round(target * 0.85));
          var hi = Math.round(target * 1.15);
          lengthNote = "\n\nLength: the original is " + ow + " words; rewrite to approximately " +
            target + " words (range " + lo + "\u2013" + hi + ").";
        }

        // Task/selection scaffold — never trimmed; the selection is sent whole
        // or not at all.
        var taskBlock = "Task: " + profile.prompt + lengthNote +
          "\n\nRewrite only the text inside <rewrite_this>. Output the rewritten passage and nothing else.\n" +
          "<rewrite_this>\n" + escFence(safeText, "rewrite_this") + "\n</rewrite_this>";
        var fixedLen = speakerCtx.length + taskBlock.length + 2; // +2 for the ctxBlock/task join
        if (fixedLen > PROMPT_BUDGET) {
          showModalErr(ov, body,
            "The selected text alone (~" + fixedLen + " chars) exceeds the " + PROMPT_BUDGET +
            "-char prompt budget even with no other context. Select a smaller passage."
          );
          return;
        }
        var ctxParts = { card: cardCtx, memory: memCtx, persona: personaCtx, lore: loreCtx, local: localCtx, prev: prevCtx };
        var trimmedOut = trimContextToBudget(ctxParts, fixedLen);
        cardCtx = ctxParts.card; memCtx = ctxParts.memory; personaCtx = ctxParts.persona;
        loreCtx = ctxParts.lore; localCtx = ctxParts.local; prevCtx = ctxParts.prev;
        if (trimmedOut.length) {
          logDbg("rewrite.budget.trim", { dropped: trimmedOut, budget: PROMPT_BUDGET });
          showToast(null, "Context trimmed to fit the prompt size limit (dropped: " + trimmedOut.join(", ") + ")", "");
        }

        // Order: speaker first, then card -> memory -> persona -> lore -> local -> prev.
        var ctxBlock = (speakerCtx + cardCtx + memCtx + personaCtx + loreCtx + localCtx + prevCtx).replace(/^\n+/, "");
        logDbg("rewrite.assemble", {
          profile: profile.name, profileId: profile.id, selChars: savedSel.text.length,
          lengthNote: lengthNote || null,
          ctxChars: { speaker: speakerCtx.length, character: cardCtx.length, memory: memCtx.length, persona: personaCtx.length, lore: loreCtx.length, surrounding: localCtx.length, prevMessages: prevCtx.length },
          ctxEnabled: { charCard: !!cfg.useCharCard, userPersona: !!cfg.useUserPersona, lorebook: !!cfg.useLorebookEntries, surrounding: !!cfg.localContextEnabled, prevMessages: !!cfg.usePrevMessages, extenderMemory: !!cfg.useExtenderMemory, speakerAware: !!cfg.speakerAware },
          budgetDropped: trimmedOut.length ? trimmedOut : null,
        });
        var userPrompt = (ctxBlock ? ctxBlock + "\n\n" : "") + taskBlock;

        // Token estimate: total = system + full user prompt; highlighted = the
        // selection; prompt = everything else (system + task + context + scaffold).
        var sys = sysPrompt();
        var selTok = tokest(safeText);
        var totalTok = tokest(sys) + tokest(userPrompt);
        _lastCost = { sel: selTok, total: totalTok, prompt: Math.max(0, totalTok - selTok) };
        if (ov.parentNode) ap(body, costLine(_lastCost));

        return runInference(sys, userPrompt, controller.signal);
      })
      .then(function (resp) {
        if (!resp || resp.aborted || !ov.parentNode) return;
        if (resp.error) {
          // The fallthrough bucket is "marinara", matching runInference's mode
          // resolution \u2014 an unknown stored mode runs there, so its error must
          // point there too, not at the local-model sidecar.
          var hint = cfg.connMode === "direct"
            ? "Check Settings \u2192 Connection \u2014 API URL and model name must point to a running server."
            : cfg.connMode === "extender"
            ? "Check Settings \u2192 Connection \u2014 Extender server URL must point to a running Marinara Extender."
            : cfg.connMode === "sidecar"
            ? "Check Settings \u2192 Connections \u2014 Marinara's local model must be downloaded and loaded, or switch Model source to a Marinara connection."
            : "Check Settings \u2192 Connection \u2014 pick one of your configured Marinara connections.";
          showModalErr(ov, body,
            (cfg.connMode === "direct" ? "Direct API error: " : cfg.connMode === "extender" ? "Extender error: " : cfg.connMode === "sidecar" ? "Local model error: " : "Connection error: ") + resp.error +
            "\n\n" + hint + "\n\nRaw: " +
            JSON.stringify(resp).slice(0, 300)
          );
          return;
        }
        var result_raw = typeof resp.result === "string" ? resp.result.trim() : "";
        var result_clean = result_raw;
        var openQ  = result_raw.match(/^["\u201c\u2018\u00ab]/);
        var closeQ = result_raw.match(/["\u201d\u2019\u00ab]$/);
        if (openQ && closeQ) {
          var o = openQ[0], c = closeQ[0];
          var pairs = { '"': '"', '\u201c': '\u201d', '\u2018': '\u2019', '\u00ab': '\u00bb' };
          if (pairs[o] === c) result_clean = result_raw.slice(1, -1);
        }
        if (!result_clean) {
          showModalErr(ov, body,
            "The AI returned an empty response.\n\nCommon causes:\n" +
            "\u2022 No local model is loaded (Settings \u2192 AI Models)\n" +
            "\u2022 The sidecar process crashed or is still loading\n" +
            "\u2022 Context size is too small for the prompt\n\n" +
            "Raw response: " + JSON.stringify(resp).slice(0, 300)
          );
          return;
        }
        showModalPreview(ov, body, result_clean, profile, savedSel, queue);
      })
      .catch(function (e) {
        if (!ov.parentNode) return;
        showModalErr(ov, body,
          "Request failed: " + (e && e.message ? e.message : String(e)) +
          "\n\nDebug:\n" +
          "\u2022 Check the browser console for network errors\n" +
          "\u2022 Verify Marinara server is running\n" +
          "\u2022 Confirm the sidecar model is loaded\n" +
          "\u2022 chat-id=" + (savedSel.cid || "null")
        );
      });
  }

  // ── Merge mode: rewrite N message-spans as one, split back by markers ──────
  // MERGE_MARK_RE: canonical pattern source only. Never use this shared instance
  // directly in .split/.test/.exec — the `g` flag makes lastIndex stateful.
  // Each call site must construct its own fresh RegExp (see markRe() below).
  var MERGE_MARK_RE = /\s*\[\[\s*SECTION\s*\d+\s*\]\]\s*/gi;
  function markRe() { return new RegExp(MERGE_MARK_RE.source, MERGE_MARK_RE.flags); }
  function buildMergedText(segments) {
    var out = "";
    for (var i = 0; i < segments.length; i++) {
      out += (i > 0 ? "\n[[SECTION " + (i + 1) + "]]\n" : "") + segments[i].text;
    }
    return out;
  }

  // ── Ledger Pattern (large-text rewrites) ───────────────────────────────────
  // A selection too big for one prompt is windowed into slices (~1/6 of the model
  // context), rewritten one at a time against a durable, resumable ledger, then
  // assembled and spliced in one go — instead of truncating. Ported from
  // TCLowe1982's Marinara-Rewrite fork; uses our tokest/sysPrompt/occ helpers.
  function sliceBudget() { return Math.max(256, Math.floor((cfg.ctxTokens || 8192) / 6)); }
  function splitToSize(text, maxChars) {
    var sentences = text.match(/[^.!?]*[.!?]+\s*|[^.!?]+$/g) || [text];
    var out = [], cur = "";
    sentences.forEach(function (s) {
      while (s.length > maxChars) { if (cur) { out.push(cur); cur = ""; } out.push(s.slice(0, maxChars)); s = s.slice(maxChars); }
      if (cur && (cur + s).length > maxChars) { out.push(cur); cur = s; } else { cur += s; }
    });
    if (cur) out.push(cur);
    return out.length ? out : [text];
  }
  function windowText(text, maxTokens) {
    var maxChars = Math.max(400, maxTokens * 4);
    var units = [], sepRe = /\n[ \t]*\n[ \t\n]*/g, last = 0, mm;
    while ((mm = sepRe.exec(text)) !== null) { units.push({ text: text.slice(last, mm.index), sep: mm[0] }); last = sepRe.lastIndex; }
    units.push({ text: text.slice(last), sep: "" });
    var slices = [];
    units.forEach(function (u) {
      if (u.text.length <= maxChars) { slices.push(u); return; }
      var parts = splitToSize(u.text, maxChars);
      for (var i = 0; i < parts.length; i++) slices.push({ text: parts[i], sep: i === parts.length - 1 ? u.sep : "" });
    });
    return slices.filter(function (s) { return s.text.length || s.sep.length; });
  }
  function stripWrapQuotes(s) {
    var openQ = s.match(/^["“‘«]/), closeQ = s.match(/["”’»]$/);
    if (openQ && closeQ) {
      var pairs = { '"': '"', "“": "”", "‘": "’", "«": "»" };
      if (pairs[openQ[0]] === closeQ[0]) return s.slice(1, -1);
    }
    return s;
  }
  function strHash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function ledgerKey(mid, text) { return (mid || "?") + ":" + strHash(text || ""); }
  function loadLedgers() { return loadObj(K_LEDGER, {}); }
  function loadLedger(key) { return loadLedgers()[key] || null; }
  function saveLedger(key, obj) {
    var all = loadLedgers(); all[key] = obj;
    var keys = Object.keys(all);
    if (keys.length > 12) {
      keys.sort(function (a, b) { return (all[a].createdAt || 0) - (all[b].createdAt || 0); });
      while (keys.length > 12) delete all[keys.shift()];
    }
    save(K_LEDGER, all);
  }
  function clearLedger(key) { var all = loadLedgers(); delete all[key]; save(K_LEDGER, all); }

  function ledgerContextNote(ledger, i) {
    var before = i > 0 ? ledger.slices[i - 1].text : "";
    var after  = i < ledger.slices.length - 1 ? ledger.slices[i + 1].text : "";
    var parts = [];
    if (before) parts.push("Preceding section (end): …" + before.slice(-300));
    if (after)  parts.push("Following section (start): " + after.slice(0, 300) + "…");
    return parts.length
      ? "<context note=\"Surrounding sections — reference only, do not rewrite.\">\n" + escFence(parts.join("\n\n"), "context") + "\n</context>"
      : "";
  }

  function doLedgerRewrite(profile, savedSel, queue) {
    killPopup();
    if (!savedSel.cid) savedSel.cid = getChatId();
    var key = ledgerKey(savedSel.mid, savedSel.text);
    var ledger = loadLedger(key);
    // Reuse an existing run only if it matches this selection + profile.
    if (!ledger || ledger.profileId !== profile.id || ledger.orig !== savedSel.text) {
      var win = windowText(savedSel.text, sliceBudget());
      ledger = {
        key: key, mid: savedSel.mid, cid: savedSel.cid, occ: savedSel.occ || 0,
        // B3: ledgers outlive the page — pruned by count, never by age — so the
        // fingerprint travels with the stored occ or a day-old resume splices blind.
        fp: savedSel.fp || null,
        profileId: profile.id, orig: savedSel.text,
        slices: win.map(function (s) { return { text: s.text, sep: s.sep, result: null, status: "pending" }; }),
        createdAt: Date.now(),
      };
      saveLedger(key, ledger);
    }
    logDbg("ledger.start", { mid: savedSel.mid, slices: ledger.slices.length, sliceBudget: sliceBudget() });
    openLedgerModal(profile, savedSel, ledger, queue);
  }

  function openLedgerModal(profile, savedSel, ledger, queue) {
    var total = ledger.slices.length;
    var controller = new AbortController();
    var ov = mkOv(10002);
    var body = mkWin(ov, "560px", profile.name + " — Ledger rewrite (" + total + " slices)");
    var note = ap(body, mk("div", "", "Large selection — windowed into " + total + " slices, rewritten one at a time. Progress is saved as it goes, so you can close and resume."));
    note.style.cssText = "font-size:11px;color:var(--primary);margin-bottom:10px;font-weight:600;";
    var listWrap = mk("div", "rwa-prev");
    listWrap.style.cssText = "max-height:300px;overflow-y:auto;margin-bottom:8px;";
    ap(body, listWrap);
    var statusLine = ap(body, mk("div", "rwa-wc", ""));
    var ft = ap(body, mk("div", "rwa-foot"));
    var acceptBtn = mkBtn("Accept all & apply", "rwa-accept", function () { assembleAndCommit(); });
    acceptBtn.style.flex = "2"; ap(ft, acceptBtn);
    ap(ft, mkBtn("Cancel", null, function () { controller.abort(); ov.remove(); })).style.flex = "1";
    function nextPending() { for (var i = 0; i < ledger.slices.length; i++) if (ledger.slices[i].status === "pending") return i; return -1; }
    function updateStatus() {
      var done = 0, pend = 0, err = 0;
      ledger.slices.forEach(function (s) { if (s.status === "done") done++; else if (s.status === "pending" || s.status === "running") pend++; else if (s.status === "error") err++; });
      statusLine.textContent = done + "/" + total + " done" + (pend ? ", " + pend + " pending" : "") + (err ? ", " + err + " error" : "");
      acceptBtn.disabled = pend > 0;
    }
    function renderList() {
      listWrap.innerHTML = "";
      ledger.slices.forEach(function (sl, i) {
        var row = ap(listWrap, mk("div", ""));
        row.style.cssText = "padding:6px 0;border-bottom:1px solid var(--border);";
        var hdr = ap(row, mk("div", ""));
        hdr.style.cssText = "display:flex;align-items:center;gap:8px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted-foreground);";
        var badge = sl.status === "done" ? "✓ done" : sl.status === "skipped" ? "skipped" : sl.status === "error" ? "✗ error" : sl.status === "running" ? "rewriting…" : "pending";
        ap(hdr, mk("span", "", "Slice " + (i + 1) + "/" + total + " · " + badge));
        var acts = ap(hdr, mk("span", "")); acts.style.cssText = "margin-left:auto;display:flex;gap:4px;";
        var rb = mkBtn("Retry", null, function () { processSlice(i, true); }); rb.classList.add("rwa-btn-sm"); ap(acts, rb);
        var sb = mkBtn(sl.status === "skipped" ? "Unskip" : "Skip", null, function () {
          if (sl.status === "skipped") { sl.status = sl.result != null ? "done" : "pending"; } else { sl.status = "skipped"; }
          saveLedger(ledger.key, ledger); renderList(); updateStatus();
        });
        sb.classList.add("rwa-btn-sm"); ap(acts, sb);
        var prev = ap(row, mk("div", "", sl.result != null ? sl.result : sl.text));
        prev.style.cssText = "font-size:11px;line-height:1.5;white-space:pre-wrap;margin-top:4px;max-height:80px;overflow:hidden;color:" + (sl.result != null ? "var(--foreground)" : "var(--muted-foreground)") + ";";
      });
    }
    function processSlice(i, single) {
      if (!ov.parentNode) return;
      var sl = ledger.slices[i];
      sl.status = "running"; renderList(); updateStatus();
      var ow = wc(sl.text), lengthNote = "";
      if (cfg.lengthEnabled && cfg.lengthPct !== 0) {
        var target = Math.max(1, Math.round(ow * (1 + cfg.lengthPct / 100)));
        var lo = Math.max(1, Math.round(target * 0.85)), hi = Math.round(target * 1.15);
        lengthNote = "\n\nLength: the original is " + ow + " words; rewrite to approximately " + target + " words (range " + lo + "–" + hi + ").";
      }
      var ctxNote = ledgerContextNote(ledger, i);
      var userPrompt = (ctxNote ? ctxNote + "\n\n" : "") +
        "Task: " + profile.prompt + lengthNote +
        "\n\nThis is one section of a longer passage. Rewrite only the text inside <rewrite_this>, keeping continuity with the surrounding sections. Output the rewritten passage and nothing else.\n" +
        "<rewrite_this>\n" + escFence(sl.text, "rewrite_this") + "\n</rewrite_this>";
      runInference(sysPrompt(), userPrompt, controller.signal).then(function (resp) {
        if (!ov.parentNode || !resp || resp.aborted) return;
        if (resp.error) { sl.status = "error"; saveLedger(ledger.key, ledger); renderList(); updateStatus(); return; }
        var clean = stripWrapQuotes((typeof resp.result === "string" ? resp.result : "").trim());
        if (!clean) { sl.status = "error"; saveLedger(ledger.key, ledger); renderList(); updateStatus(); return; }
        sl.result = clean; sl.status = "done"; saveLedger(ledger.key, ledger);
        renderList(); updateStatus();
        if (!single) { var n = nextPending(); if (n !== -1) processSlice(n, false); }
      });
    }
    function assembleAndCommit() {
      // Join in order: rewritten result where done, original text where skipped.
      var assembled = ledger.slices.map(function (s) {
        return (s.status === "done" && s.result != null ? s.result : s.text) + s.sep;
      }).join("");
      logDbg("ledger.assemble", { mid: ledger.mid, slices: total, chars: assembled.length });
      ov.remove();
      doCommit(assembled, { text: ledger.orig, mid: ledger.mid, cid: ledger.cid, occ: ledger.occ || 0, fp: ledger.fp || null }, function () {
        clearLedger(ledger.key);
        showToast(null, "✓ Applied (" + total + " slices)", "ok");
        if (queue && queue.index + 1 < queue.segments.length) doRewrite(profile, { segments: queue.segments, index: queue.index + 1 });
      });
    }
    renderList(); updateStatus();
    var first = nextPending();
    if (first !== -1) processSlice(first, false);
  }

  function doMergeRewrite(profile, segments) {
    killPopup();
    var controller = new AbortController();
    var cid = sel.cid || getChatId();
    var anchorMid = segments[0].mid;
    var merged = buildMergedText(segments);

    var ov   = mkOv(10002);
    var body = mkWin(ov, "560px", profile.name + " (" + segments.length + " merged) — Generating…");
    var note = ap(body, mk("div", "", "Merging " + segments.length + " messages, rewriting as one, then splitting back."));
    note.style.cssText = "font-size:11px;color:var(--primary);margin-bottom:10px;font-weight:600;";
    ap(body, mk("div", "rwa-plbl", "Merged Selection"));
    var selBox = mk("div", "rwa-prev rwa-shimmer", merged);
    selBox.style.cssText = "margin-bottom:14px;white-space:pre-wrap;";
    ap(body, selBox);
    var loadRow = mk("div", ""); loadRow.style.cssText = "padding:8px 0 12px;";
    ap(loadRow, mk("div", "rwa-pulse"));
    var loadLbl = mk("div", "", "Rewriting…");
    loadLbl.style.cssText = "font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted-foreground);margin-top:6px;text-align:center;";
    ap(loadRow, loadLbl); ap(body, loadRow);
    var ft = ap(body, mk("div", "rwa-foot"));
    ap(ft, mkBtn("Cancel", null, function () { controller.abort(); ov.remove(); })).style.flex = "1";

    // N5 fix: route merge context assembly through fetchContextParts (same path
    // as doRewrite) so _ctxOff exclusions and persona/surrounding context are
    // honoured. Previously merge fetched card/lore/prev independently and ignored
    // _ctxOff entirely, so excluded sources were sent anyway. The [[SECTION n]]
    // marker prompt logic below is unchanged — only context assembly changes.
    var localCtxMerge = (cfg.localContextEnabled && !_ctxOff.local) ? extractLocalContext(anchorMid, segments[0].text, segments[0].occ || 0) : ""; // N12: pass occ

    var memPromiseMerge = fetchExtenderMemory(cid);
    var speakerPromiseMerge = fetchSpeakerNote(cid, anchorMid);

    Promise.all([fetchContextParts(cid, anchorMid), memPromiseMerge, speakerPromiseMerge])
      .then(function (mergedResolved) {
        var ctxResults = mergedResolved[0];
        if (!ov.parentNode) return;
        // Respect per-popup dot overrides — matches doRewrite's exclusion logic.
        var cardCtxM    = _ctxOff.card    ? "" : ctxResults.card;
        var loreCtxM    = _ctxOff.lore    ? "" : ctxResults.lore;
        var prevCtxM    = _ctxOff.prev    ? "" : ctxResults.prev;
        var personaCtxM = _ctxOff.persona ? "" : ctxResults.persona;
        var memCtxM = _ctxOff.memory ? "" : mergedResolved[1];
        var speakerCtxM = mergedResolved[2];
        var safeMerged = merged.length > 12000 ? merged.slice(0, 12000) + "…" : merged;
        var lengthNote = "";
        if (cfg.lengthEnabled && cfg.lengthPct !== 0) {
          var ow = wc(safeMerged);
          var target = Math.max(1, Math.round(ow * (1 + cfg.lengthPct / 100)));
          var lo = Math.max(1, Math.round(target * 0.85)), hi = Math.round(target * 1.15);
          lengthNote = "\n\nLength: the original is " + ow + " words; rewrite to approximately " + target + " words (range " + lo + "–" + hi + ").";
        }
        var markerNote = "\n\nThe passage contains " + (segments.length - 1) +
          " markers like [[SECTION 2]], [[SECTION 3]] that separate parts which belong to different messages. " +
          "Keep every [[SECTION n]] marker exactly as written, on its own line, in the same order. Do not add, remove, renumber, or move them.";
        // Task/selection scaffold — never trimmed; the merged selection is
        // sent whole or not at all (its own 12000-char cap is applied above).
        var taskBlockM = "Task: " + profile.prompt + lengthNote + markerNote +
          "\n\nRewrite only the text inside <rewrite_this>, preserving the [[SECTION n]] markers. Output the rewritten passage and nothing else.\n" +
          "<rewrite_this>\n" + escFence(safeMerged, "rewrite_this") + "\n</rewrite_this>";
        var fixedLenM = speakerCtxM.length + taskBlockM.length + 2;
        if (fixedLenM > PROMPT_BUDGET) {
          showModalErr(ov, body,
            "The merged selection alone (~" + fixedLenM + " chars) exceeds the " + PROMPT_BUDGET +
            "-char prompt budget even with no other context. Merge fewer messages or select less text."
          );
          return;
        }
        var ctxPartsM = { card: cardCtxM, memory: memCtxM, persona: personaCtxM, lore: loreCtxM, local: localCtxMerge, prev: prevCtxM };
        var trimmedOutM = trimContextToBudget(ctxPartsM, fixedLenM);
        cardCtxM = ctxPartsM.card; memCtxM = ctxPartsM.memory; personaCtxM = ctxPartsM.persona;
        loreCtxM = ctxPartsM.lore; localCtxMerge = ctxPartsM.local; prevCtxM = ctxPartsM.prev;
        if (trimmedOutM.length) {
          logDbg("rewrite.merge.budget.trim", { dropped: trimmedOutM, budget: PROMPT_BUDGET });
          showToast(null, "Context trimmed to fit the prompt size limit (dropped: " + trimmedOutM.join(", ") + ")", "");
        }
        // Order: speaker first, then card -> memory -> persona -> lore -> local -> prev.
        var ctxBlock = (speakerCtxM + cardCtxM + memCtxM + personaCtxM + loreCtxM + localCtxMerge + prevCtxM).replace(/^\n+/, "");
        var userPrompt = (ctxBlock ? ctxBlock + "\n\n" : "") + taskBlockM;
        logDbg("rewrite.merge.request", { messages: segments.length, mergedChars: merged.length, budgetDropped: trimmedOutM.length ? trimmedOutM : null });
        return runInference(sysPrompt() + "\n- Preserve any [[SECTION n]] markers exactly, on their own lines, in order.", userPrompt, controller.signal);
      })
      .then(function (resp) {
        if (!resp || resp.aborted || !ov.parentNode) return;
        if (resp.error) { showModalErr(ov, body, "Error: " + resp.error); return; }
        var out = (typeof resp.result === "string" ? resp.result : "").trim();
        if (!out) { showModalErr(ov, body, "The AI returned an empty response."); return; }
        var pieces = out.split(markRe()).map(function (p) { return p.trim(); });
        // Verify the markers are not just the right COUNT but the right NUMBERS in
        // order: buildMergedText emits [[SECTION 2]]..[[SECTION n]] between segments,
        // so a correct rewrite has markers numbered exactly 2,3,...,segments.length.
        // Right-count-but-wrong-position markers would otherwise commit to wrong msgs.
        var markerNums = (out.match(markRe()) || []).map(function (mk) {
          var d = mk.match(/\d+/); return d ? parseInt(d[0], 10) : NaN;
        });
        var seqOk = markerNums.length === segments.length - 1 &&
          markerNums.every(function (n, i) { return n === i + 2; });
        var clean = pieces.length === segments.length && pieces.every(function (p) { return p.length > 0; }) && seqOk;
        logDbg("rewrite.merge.split", { expected: segments.length, got: pieces.length, seqOk: seqOk, clean: clean });
        if (clean) {
          showMergePreview(ov, body, profile, segments, pieces, cid);
        } else {
          // Markers didn't survive the rewrite — fall back to per-message so we
          // never guess a split and corrupt messages.
          ov.remove();
          showToast(null, "Couldn't split cleanly — rewriting each message instead", "");
          doRewrite(profile, { segments: segments, index: 0 });
        }
      })
      .catch(function (e) {
        if (ov.parentNode) showModalErr(ov, body, "Request failed: " + (e && e.message ? e.message : String(e)));
      });
  }

  function applyMerged(segments, pieces, cid, i, onDone, results) {
    results = results || [];
    if (i >= segments.length) { if (onDone) onDone(results); return; }
    // B3: the merge chain used to drop occ AND carry no fingerprint, so every
    // segment spliced at occurrence 0 with nothing checking the place. Both travel
    // with the segment — collectSelectionSegments captured them.
    doCommit(pieces[i], { text: segments[i].text, mid: segments[i].mid, cid: cid, occ: segments[i].occ || 0, fp: segments[i].fp || null }, function () {
      results.push(true);
      // N8 fix: invalidate the message cache before recursing to the next segment.
      // doCommit already invalidates after its own match, but in chained auto-apply
      // the next call to doCommit may re-read the cached (pre-edit) content before
      // Marinara's store update flushes. Invalidating here ensures each chained
      // commit reads fresh data from the API rather than the stale cached baseline.
      invalidateMsgCache();
      applyMerged(segments, pieces, cid, i + 1, onDone, results);
    }, function () {
      // B4 fix: doCommit already showed the specific failure reason via its own
      // modal. What was missing is aggregation — stop the chain here (as before)
      // but hand back which segments committed before the break, so the caller
      // can surface one summary instead of leaving the user to guess whether
      // earlier segments in the chain were already written to their chat.
      results.push(false);
      if (onDone) onDone(results);
    });
  }

  // B4 fix: build the "N of M applied" summary for a partially-failed merge
  // chain. Segment labels reuse the same "Message k" scheme the merge preview
  // and ledger already use, rather than inventing a new naming convention.
  function mergeChainSummary(results, total) {
    var applied = [], notApplied = [];
    for (var i = 0; i < total; i++) {
      var label = "Message " + (i + 1);
      if (results[i]) applied.push(label); else notApplied.push(label);
    }
    return "Partial apply: " + applied.length + "/" + total + " applied" +
      (applied.length ? " (" + applied.join(", ") + ")" : "") +
      ". Not applied: " + notApplied.join(", ") + ".";
  }

  function mergeChainDone(segments, onFinished) {
    return function (results) {
      var total = segments.length;
      var okCount = 0;
      for (var k = 0; k < results.length; k++) if (results[k]) okCount++;
      if (onFinished) onFinished();
      if (okCount === total) {
        showToast(null, "✓ Applied to " + total + " messages", "ok");
      } else {
        showToast(null, mergeChainSummary(results, total), "");
      }
    };
  }

  function showMergePreview(ov, body, profile, segments, pieces, cid) {
    if (cfg.autoApply) {
      ov.remove();
      applyMerged(segments, pieces, cid, 0, mergeChainDone(segments));
      return;
    }
    body.innerHTML = "";
    if (body._titleEl) body._titleEl.textContent = profile.name + " (" + segments.length + " merged) — Result";
    var note = ap(body, mk("div", "", "Split cleanly into " + segments.length + " pieces — each goes back to its message."));
    note.style.cssText = "font-size:11px;color:var(--primary);margin-bottom:10px;font-weight:600;";
    ap(body, mk("div", "rwa-plbl", "Rewritten (by message)"));
    var box = mk("div", "rwa-prev");
    for (var i = 0; i < pieces.length; i++) {
      var lbl = ap(box, mk("div", "rwa-plbl", "▸ Message " + (i + 1)));
      lbl.style.cssText = "margin-top:" + (i ? "10px" : "0") + ";";
      var pc = ap(box, mk("div", "", pieces[i]));
      pc.style.cssText = "white-space:pre-wrap;font-size:12px;line-height:1.6;";
    }
    ap(body, box);
    var ft = ap(body, mk("div", "rwa-foot"));
    ap(ft, mkBtn("Accept All", "rwa-accept", function () {
      applyMerged(segments, pieces, cid, 0, mergeChainDone(segments, function () { ov.remove(); }));
    })).style.flex = "2";
    ap(ft, mkBtn("Retry", null, function () { ov.remove(); doMergeRewrite(profile, segments); })).style.flex = "1";
    ap(ft, mkBtn("Cancel", null, function () { ov.remove(); })).style.flex = "1";
  }

  // ── Modal result preview ──────────────────────────────────────────────────
  function showModalPreview(ov, body, result, profile, savedSel, queue) {
    var total = queue ? queue.segments.length : 1;
    var idx = queue ? queue.index : 0;
    var hasNext = queue && idx + 1 < total;
    function advance() {
      if (hasNext) doRewrite(profile, { segments: queue.segments, index: idx + 1 });
    }

    if (cfg.autoApply) {
      ov.remove();
      // Chain the next message's apply onto this one's completion so the editor
      // opens/saves sequentially rather than racing.
      doCommit(result, savedSel, function () {
        showToast(null, total > 1 ? "\u2713 Applied " + (idx + 1) + "/" + total : "\u2713 Applied", "ok");
        advance();
      });
      return;
    }

    body.innerHTML = "";
    if (body._titleEl) body._titleEl.textContent = profile.name + (total > 1 ? " (Msg " + (idx + 1) + "/" + total + ")" : "") + " \u2014 Result";

    if (total > 1) {
      var note = ap(body, mk("div", "", "Message " + (idx + 1) + " of " + total + " in this selection."));
      note.style.cssText = "font-size:11px;color:var(--primary);margin-bottom:10px;font-weight:600;";
    }
    if (_lastCost) ap(body, costLine(_lastCost));
    ap(body, mk("div", "rwa-plbl", "Original"));
    var origBox = mk("div", "rwa-prev");
    origBox.style.cssText = "max-height:90px;opacity:.65;margin-bottom:12px;";
    origBox.textContent = savedSel.text;
    ap(body, origBox);

    ap(body, mk("div", "rwa-plbl", cfg.showDiff ? "Diff (green\u202fadd / red\u202frem)" : "Rewritten"));
    var resultBox = mk("div", "rwa-prev");
    resultBox.style.marginBottom = "4px";
    ap(body, resultBox);

    if (cfg.showDiff) {
      renderDiff(resultBox, savedSel.text, result);
    } else if (cfg.typewriter) {
      typewriterFill(resultBox, result, function () { _twCancel = null; });
    } else {
      resultBox.textContent = result;
    }

    ap(body, mk("div", "rwa-wc", wcDiff(savedSel.text, result)));

    var ft = ap(body, mk("div", "rwa-foot"));
    ap(ft, mkBtn(hasNext ? "Accept & Next" : "Accept", "rwa-accept", function () {
      doCommit(result, savedSel, function () { ov.remove(); advance(); });
    })).style.flex = "2";
    ap(ft, mkBtn("Retry", null, function () {
      ov.remove();
      doRewrite(profile, queue);
    })).style.flex = "1";
    // Copy fallback — if the splice-back can't locate the text, paste it yourself.
    ap(ft, mkBtn("Copy", null, function () {
      try {
        navigator.clipboard.writeText(result).then(
          function () { showToast(null, "Copied to clipboard", "ok"); },
          function () { showToast(null, "Copy failed — select and copy manually."); }
        );
      } catch (e) { showToast(null, "Copy failed — select and copy manually."); }
    })).style.flex = "1";
    if (hasNext) {
      ap(ft, mkBtn("Skip", null, function () { ov.remove(); advance(); })).style.flex = "1";
    }
    ap(ft, mkBtn("Cancel", null, function () { ov.remove(); })).style.flex = "1";
  }

  // ── Typewriter reveal (with cancel) ───────────────────────────────────────
  function typewriterFill(el, text, onDone) {
    // N16: cancel any prior in-flight reveal so overlapping result modals don't
    // orphan their timer chains (one global slot means only the latest can run).
    if (_twCancel) { _twCancel(); _twCancel = null; }
    var i = 0;
    var cancelled = false;
    var ids = [];
    el.textContent = "";
    _twCancel = function () { cancelled = true; ids.forEach(function (id) { clearTimeout(id); }); ids = []; };
    function tick() {
      if (cancelled) return;
      if (i < text.length) {
        el.textContent += text[i++];
        el.scrollTop = el.scrollHeight;
        ids.push(marinara.setTimeout(tick, 8));
      } else {
        _twCancel = null;
        if (onDone) onDone();
      }
    }
    tick();
  }

  // ── Commit — splice rewritten text into message ───────────────────────────
  function doCommit(newText, savedSel, onDone, onFail) {
    var mid = savedSel.mid;
    var cid = savedSel.cid || getChatId();
    // onFail is optional and additive: existing 3-arg callers see identical
    // behaviour (showErr fires exactly as before). Callers that need to know
    // a commit failed (e.g. the merge chain, to aggregate outcomes) pass a
    // 4th callback and get the same message string handed to them too.
    function fail(msg) { showErr(msg); if (onFail) onFail(msg); }
    if (!cid) {
      fail("Cannot detect active chat ID.\nTry clicking the chat in the sidebar first.");
      return;
    }

    cachedMessages(cid)
      .then(function (msgs) {
        if (!Array.isArray(msgs)) {
          throw new Error("Unexpected response from /chats/" + cid + "/messages (got: " + typeof msgs + ")");
        }
        var msg = null;
        for (var i = 0; i < msgs.length; i++) {
          if (msgs[i].id === mid) { msg = msgs[i]; break; }
        }
        if (!msg) {
          throw new Error(
            "Message not found.\n\nDebug:\n\u2022 message-id=" + mid +
            "\n\u2022 chat-id=" + cid +
            "\n\u2022 messages checked=" + msgs.length
          );
        }

        var normSel = savedSel.text.trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        var rawContent = (msg.content || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        var renderedFull = renderedTextForMid(mid);

        // Locate the selection in the rendered text exactly — it was captured from
        // the DOM, so it is a substring of the rendered text (no fuzzy match needed).
        var occ = (savedSel && typeof savedSel.occ === "number") ? savedSel.occ : 0;
        var rs = nthIndexOf(renderedFull, normSel, occ);
        if (rs === -1) rs = renderedFull.indexOf(normSel);
        if (rs === -1) {
          fail(
            "Could not locate the selected text in the rendered message.\n\n" +
            "The message may have changed since you selected. Re-select and try again."
          );
          return;
        }
        var re = rs + normSel.length;

        // B3: matching text is not proof of the right PLACE. If an earlier instance
        // of the phrase was added or removed since selection, `occ` resolves to a
        // different occurrence that still matches — old code spliced it and toasted
        // "Applied". Verify the captured surroundings at the resolved index and fail
        // closed into the existing "could not locate" family.
        if (!fingerprintOk(savedSel.fp, renderedFull, rs, normSel.length)) {
          fail(
            "Could not locate the selected text in the rendered message.\n\n" +
            "The text around your selection has changed since you selected it, so the\n" +
            "same phrase now points somewhere else. Re-select and try again."
          );
          return;
        }

        // Map the rendered span into raw msg.content coordinates and splice.
        var span = mapRenderedSpanToRaw(renderedFull, rawContent, rs, re);
        if (!span) {
          fail(
            "Could not map the selection back to stored content (message too large\n" +
            "or unmappable). Use the Copy button and paste the rewrite manually."
          );
          return;
        }
        var updated = rawContent.slice(0, span.as) + newText + rawContent.slice(span.ae);

        invalidateMsgCache();
        if (cfg.reviewBeforeApply) {
          reviewThenPatch(cid, mid, msg.content, updated, onDone, onFail);
          return;
        }
        // B2: `updated` was spliced into the content we just read, which may itself
        // have come from the 2s cache. Compare against what is stored right now.
        guardedPatch(cid, mid, msg.content, updated, "rewrite")
          .then(function (res) {
            // Declined is not success, but it is also not silence: applyMerged
            // recurses from onDone and aggregates from onFail, so returning without
            // either stalls a multi-message chain mid-way and suppresses the
            // partial-apply summary. onFail(null) — doCommit's modal is what shows a
            // reason, and there is none to show here; the user chose this.
            if (!res) { if (onFail) onFail(null); return; }
            var depth = Math.max(1, Math.min(20, cfg.historyDepth || 5));
            hist.unshift({ mid: mid, cid: cid, old: msg.content, post: updated, when: Date.now() });
            if (hist.length > depth) hist.length = depth;
            if (redo.length) { redo.length = 0; saveRedo(); }
            saveH();
            showToast(null, "✓ Applied", "ok");
            if (onDone) onDone();
          })
          .catch(function (e) {
            fail("Save failed:\n" + (e && e.message ? e.message : String(e)));
          });
      })
      .catch(function (e) {
        fail("Commit failed:\n" + (e && e.message ? e.message : String(e)));
      });
  }


  // ── Undo ──────────────────────────────────────────────────────────────────
  function doUndo() {
    if (!hist.length) return;
    var h = hist[0];
    var depth = Math.max(1, Math.min(20, cfg.historyDepth || 5));
    // B2: undo assumed the message still holds what the rewrite wrote (h.post). If
    // it does not, restoring h.old discards whatever came after — and the old code
    // still toasted "Undone" as though nothing was lost.
    guardedPatch(h.cid || getChatId(), h.mid, h.post, h.old, "undo")
      .then(function (res) {
        if (!res) return; // declined — history untouched, so undo stays available
        hist.shift();
        saveH();
        if (h.post != null) { redo.unshift(h); if (redo.length > depth) redo.length = depth; saveRedo(); }
        showToast(null, "↶ Undone", "ok");
        killPopup();
      })
      .catch(function (e) { showErr("Undo failed:\n" + (e && e.message ? e.message : String(e))); });
  }

  // ── Redo ──────────────────────────────────────────────────────────────────
  function doRedo() {
    if (!redo.length) return;
    var r = redo[0];
    if (r.post == null) { redo.shift(); saveRedo(); return; }
    var depth = Math.max(1, Math.min(20, cfg.historyDepth || 5));
    // B2: redo assumes the message still holds the pre-rewrite text undo restored
    // (r.old); anything else means something wrote in between.
    guardedPatch(r.cid || getChatId(), r.mid, r.old, r.post, "redo")
      .then(function (res) {
        if (!res) return; // declined — redo entry stays, nothing written
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

  // ── Custom prompt ─────────────────────────────────────────────────────────
  function showCustom() {
    hideTip();
    var ov  = mkOv(10002);
    var win = ap(ov, mk("div", "rwa-win"));
    win.style.width = "440px";
    ap(win, mk("div", "rwa-bar"));
    var hdr = ap(win, mk("div", "rwa-hdr"));
    ap(hdr, mk("div", "rwa-title", "\u2709\uFE0F Custom Prompt"));
    ap(hdr, xBtn(function () { ov.remove(); }));
    var body = ap(win, mk("div", "rwa-body"));

    var info = mk("div", "", "Describe exactly what you want. Runs once and is saved for reuse.");
    info.style.cssText = "font-size:11px;color:var(--muted-foreground);margin-bottom:10px;line-height:1.5;";
    ap(body, info);

    var ta = mk("textarea", "rwa-inp");
    ta.placeholder = 'e.g. "Make Sarah sound bubbly instead of angry, and 30% longer"';
    ta.style.cssText = "height:80px;resize:vertical;margin-bottom:6px;";
    ap(body, ta);

    // AI Refine: turn a rough note into a clear instruction, in place.
    var refineRow = mk("div", ""); refineRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px;";
    ap(body, refineRow);
    var refineBtn = mkBtn("✨ Refine", null, function () {
      var d = ta.value.trim();
      if (!d) { refineSt.textContent = "Type a rough prompt first."; return; }
      refineBtn.disabled = true; refineBtn.textContent = "Refining…"; refineSt.textContent = "";
      runInference(
        "You turn a rough text-editing note into ONE clear, specific instruction for an AI that rewrites a passage. Start with a verb, keep it to one sentence, preserve the user's intent. Output ONLY the instruction — no quotes, preamble, or alternatives.",
        "Rough note: " + d
      ).then(function (resp) {
        refineBtn.disabled = false; refineBtn.textContent = "✨ Refine";
        if (resp && resp.error) { refineSt.textContent = "Failed: " + resp.error; return; }
        var out = resp && resp.result ? resp.result.trim().replace(/^["'“‘]+|["'”’]+$/g, "").trim() : "";
        if (!out) { refineSt.textContent = "Empty response."; return; }
        ta.value = out; refineSt.textContent = "Refined ✓";
      }).catch(function (e) {
        refineBtn.disabled = false; refineBtn.textContent = "✨ Refine";
        refineSt.textContent = "Failed: " + (e && e.message ? e.message : String(e));
      });
    });
    refineBtn.classList.add("rwa-btn-sm");
    refineBtn.title = 'Refine a simple prompt into something more defined — e.g. "bigger, longer" → "Expand this text to be longer and more robust."';
    ap(refineRow, refineBtn);
    var refineSt = mk("span", ""); refineSt.style.cssText = "font-size:10px;color:var(--muted-foreground);";
    ap(refineRow, refineSt);

    if (customs.length) {
      ap(body, mk("div", "rwa-lbl", "Past Prompts"));
      var lw = mk("div", "");
      lw.style.cssText = "max-height:130px;overflow-y:auto;margin-bottom:8px;";
      ap(body, lw);
      customs.forEach(function (c, i) {
        var row = mk("div", "");
        row.style.cssText = "display:flex;align-items:flex-start;gap:6px;padding:6px 8px;" +
          "background:var(--secondary);border-radius:8px;margin-bottom:4px;border:1px solid var(--border);";
        ap(lw, row);
        var t = mk("div", "", c);
        t.style.cssText = "flex:1;font-size:11px;color:var(--foreground);line-height:1.4;";
        ap(row, t);
        var useBtn = mkBtn("Use", null, function () { ta.value = c; });
        useBtn.classList.add("rwa-btn-sm"); ap(row, useBtn);
        ap(row, iconBtn(ICON.trash, "rwa-dng", function () {
          customs.splice(i, 1); saveX(); ov.remove(); showCustom();
        }, "Delete prompt"));
      });
    }

    var ft = ap(body, mk("div", "rwa-foot"));
    ap(ft, mkBtn("Run", "rwa-accept", function () {
      var v = ta.value.trim();
      if (!v) return;
      if (customs.indexOf(v) === -1) {
        customs.unshift(v);
        if (customs.length > 8) customs.length = 8;
        saveX();
      }
      ov.remove();
      doRewrite({ id: "custom", name: "Custom", order: -1, prompt: v });
    })).style.flex = "1";
    ap(ft, mkBtn("Save as profile", null, function () {
      var v = ta.value.trim();
      if (!v) { return; }
      ov.remove();
      // Open the profile editor prefilled so the user can name it; it becomes a
      // permanent popup button.
      showEdit(null, -1, function () { showToast(null, "Saved as a profile button", "ok"); }, { name: "", prompt: v });
    })).style.flex = "1";
    ap(ft, mkBtn("Cancel", null, function () { ov.remove(); })).style.flex = "1";
  }

  // ── Auto-profile ──────────────────────────────────────────────────────────
  function generateAutoProfile(chatId, cb) {
    _autoInFlight[chatId] = true;
    marinara.apiFetch("/chats/" + chatId)
      .then(function (chat) {
        var ids = [];
        try { ids = typeof chat.characterIds === "string" ? JSON.parse(chat.characterIds) : chat.characterIds || []; } catch (e) {}
        if (!ids.length) { if (cb) cb(); return; }
        return marinara.apiFetch("/characters/" + ids[0]).then(function (char) {
          var data = {};
          try { data = typeof char.data === "string" ? JSON.parse(char.data) : char.data || {}; } catch (e) {}
          var personality = (data.personality || char.personality || "").slice(0, 200);
          if (!personality) { if (cb) cb(); return; }
          var desc = "Name: " + (data.name || char.name || "Unknown") + ". Personality: " + personality;
          return runInference(
            'Output ONLY a valid JSON object (no fences) with "name" (1-3 words, e.g. the character name + \'s Voice\') and "prompt" (an instruction to rewrite text matching this specific character\'s voice and personality).',
            "Character: " + desc
          ).then(function (resp) {
            if (!resp || !resp.result) return;
            var raw = resp.result.trim().replace(/^```(?:json)?|```$/gm, "").trim();
            var d = JSON.parse(raw);
            if (d.name && d.prompt) {
              autoProfs[chatId] = { id: "auto-" + chatId, name: d.name, prompt: d.prompt, order: -1 };
              saveA();
            }
          });
        });
      })
      .catch(function () {})
      .then(function () { delete _autoInFlight[chatId]; if (cb) cb(); });
  }

  function watchForChatSwitch() {
    // getChatId() reads the `marinara-active-chat-id` localStorage key, which
    // Marinara updates on every switch. A MutationObserver here is brittle —
    // it depends on guessing the sidebar element and on the switch mutating its
    // subtree. Poll the id instead; it's cheap and selector-independent.
    // ponytail: 1.5s poll, fine for a per-switch trigger; no event to hook.
    var lastCid = getChatId();
    marinara.setInterval(function () {
      var newCid = getChatId();
      if (!newCid || newCid === lastCid) return;
      lastCid = newCid;
      if (!cfg.autoProfileEnabled) return;
      if (autoProfs[newCid]) return;
      if (_autoInFlight[newCid]) return; // in-flight guard: skip if generation already running
      generateAutoProfile(newCid, null);
    }, 1500);
  }
  watchForChatSwitch();

  // ── Settings ──────────────────────────────────────────────────────────────
  // Connection settings are user-owned and never travel in an export/import.
  // apiKey is the secret; the other three decide WHERE that secret gets sent, so
  // filtering only the key would still let an import redirect it.
  var CONN_KEYS = ["apiKey", "apiUrl", "extenderUrl", "connMode", "connectionId"];

  function exportProfiles(opts) {
    opts = opts || { profiles: true, config: true, customs: true, autoProfs: true };
    var data = { type: "rwa-profiles-export", version: 1 };
    var picked = [];
    if (opts.profiles)  { data.profiles = profiles;        picked.push("profiles"); }
    if (opts.config)    { var safeCfg = {}; Object.keys(cfg).forEach(function (k) { if (CONN_KEYS.indexOf(k) === -1) safeCfg[k] = cfg[k]; }); data.config = safeCfg; picked.push("settings"); }
    if (opts.customs)   { data.customs = customs;          picked.push("custom prompts"); }
    if (opts.autoProfs) { data.autoProfiles = autoProfs;   picked.push("auto-profiles"); }
    if (!picked.length) { showToast(null, "Select at least one thing to export."); return; }
    var json = JSON.stringify(data, null, 2);
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "rewrite-assistant-export.json"; a.click();
    URL.revokeObjectURL(url);
    showToast(null, "Exported: " + picked.join(", "), "ok");
  }

  function importProfiles(render) {
    var inp = mk("input", "");
    inp.type = "file"; inp.accept = ".json"; inp.style.cssText = "display:none;";
    document.body.appendChild(inp);
    // N17: if the OS picker is cancelled (no `change` fires) the input leaks.
    // A one-shot `focus` handler on window fires when the picker closes; remove
    // the input shortly after if no `change` has fired yet.
    var changed = false;
    window.addEventListener("focus", function onFocus() {
      window.removeEventListener("focus", onFocus);
      marinara.setTimeout(function () { if (!changed && inp.parentNode) inp.remove(); }, 300);
    }, { once: true });
    inp.addEventListener("change", function () {
      changed = true;
      var file = inp.files && inp.files[0];
      if (!file) { inp.remove(); return; }
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var data = JSON.parse(ev.target.result);
          if (data.type !== "rwa-profiles-export") { showToast(null, "Not a valid export file."); return; }
          // N9 fix: validate shape before importing to prevent wrong-typed values
          // from reaching code that expects specific types (e.g. charCardIds.join,
          // historyDepth arithmetic, profile fields). Track dropped entries for toast.
          var dropped = 0;
          var skippedConn = 0;
          var reassigned = 0;

          // profiles/customs: must be arrays; entries must be objects with string
          // id, name, prompt — validProfileEntry is defined once near the loader.
          if (Array.isArray(data.profiles)) {
            var before = data.profiles.length;
            // validProfileEntry checks shape but not id uniqueness. A duplicate id
            // makes the drag-reorder handler's `profiles.find(x => x.id === dragId)`
            // resolve to the FIRST match, silently mutating the wrong row. Mint a
            // fresh id (same scheme the UI uses for new profiles) for every entry
            // after the first with a given id.
            var seenIds = {};
            profiles = data.profiles.filter(validProfileEntry).map(function (p) {
              if (seenIds.hasOwnProperty(p.id)) {
                p.id = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
                reassigned++;
              }
              seenIds[p.id] = true;
              return p;
            });
            dropped += before - profiles.length;
            saveP();
          }
          if (Array.isArray(data.customs)) {
            var before2 = data.customs.length;
            // customs are plain prompt strings — accept only non-empty strings.
            customs = data.customs.filter(function (e) {
              return typeof e === "string" && e.trim().length > 0;
            });
            dropped += before2 - customs.length;
            saveX();
          }
          // autoProfs: must be a plain object (not array); each entry needs string name+prompt.
          if (data.autoProfiles && typeof data.autoProfiles === "object" && !Array.isArray(data.autoProfiles)) {
            var cleanAuto = {};
            Object.keys(data.autoProfiles).forEach(function (k) {
              var e = data.autoProfiles[k];
              if (e && typeof e === "object" && typeof e.name === "string" && typeof e.prompt === "string") {
                cleanAuto[k] = e;
              } else {
                dropped++;
              }
            });
            autoProfs = cleanAuto;
            saveA();
          }
          // config: for each imported key that exists in DEF_CFG, only assign if
          // typeof matches the default's type (or both are arrays). Skip mismatches.
          if (data.config && typeof data.config === "object" && !Array.isArray(data.config)) {
            Object.keys(data.config).forEach(function (k) {
              if (!cfg.hasOwnProperty(k)) return;
              // Never let an imported file decide WHERE inference goes. Export already
              // strips apiKey, but that only protects the file's author: an import that
              // sets connMode "direct" and apiUrl at an attacker's host makes the NEXT
              // rewrite send the user's own stored key there as a bearer token — the
              // file never needs to contain a key at all. These stay user-owned.
              if (CONN_KEYS.indexOf(k) !== -1) { skippedConn++; return; }
              var defVal = DEF_CFG[k];
              var impVal = data.config[k];
              // Array-typed defaults: accept only arrays.
              if (Array.isArray(defVal)) {
                if (Array.isArray(impVal)) { cfg[k] = impVal; } else { dropped++; }
              } else if (typeof impVal === typeof defVal) {
                cfg[k] = impVal;
              } else {
                dropped++;
              }
            });
            saveC();
          }
          var parts = [];
          if (dropped > 0) parts.push(dropped + " malformed " + (dropped === 1 ? "entry" : "entries") + " dropped");
          if (reassigned > 0) parts.push(reassigned + " duplicate " + (reassigned === 1 ? "id" : "ids") + " reassigned");
          if (skippedConn > 0) parts.push("connection settings ignored");
          var msg = parts.length ? "Imported (" + parts.join("; ") + ")" : "Imported!";
          showToast(null, msg, "ok");
          render();
        } catch (e) { showToast(null, "Import failed: invalid JSON."); }
      };
      reader.readAsText(file);
      inp.remove();
    });
    inp.click();
  }

  function showSettings() {
    hideTip();
    var ov  = mkOv(10001);
    var win = ap(ov, mk("div", "rwa-win"));
    win.style.width = "680px";

    function row(parent, label, ctrl, help) {
      var r = mk("div", "rwa-setting-row");
      ap(parent, r);
      var lc = ap(r, mk("div", "rwa-row-lbl"));
      ap(lc, mk("div", "rwa-row-title", label));
      if (help) ap(lc, mk("div", "rwa-row-help", help));
      ap(r, ctrl);
      return r;
    }
    // Section header with a divider above it (except the first in a pane).
    function grp(parent, text) {
      var first = !parent.querySelector(".rwa-grp");
      ap(parent, mk("div", "rwa-grp" + (first ? " rwa-grp-first" : ""), text));
    }
    // Indented sub-row that dims + disables its control when the parent is off.
    function depRow(parent, label, ctrl, isOn) {
      var r = row(parent, label, ctrl);
      r.classList.add("rwa-dep");
      function sync(on) { r.style.opacity = on ? "1" : ".45"; if (ctrl.disabled !== undefined) ctrl.disabled = !on; }
      sync(isOn);
      return sync;
    }
    // Stacked field: label (+ helper) above a full-width input. For text inputs.
    function field(parent, label, input, help) {
      var f = ap(parent, mk("div", "")); f.style.cssText = "margin-bottom:10px;";
      ap(f, mk("div", "rwa-row-title", label)).style.marginBottom = help ? "2px" : "5px";
      if (help) ap(f, mk("div", "rwa-row-help", help)).style.marginBottom = "5px";
      input.style.width = "100%"; input.style.margin = "0";
      ap(f, input);
      return f;
    }
    function ck(val, fn) {
      var wrap = mk("label", "rwa-toggle-wrap");
      var c = mk("input", "");
      c.type = "checkbox"; c.checked = !!val;
      c.style.cssText = "opacity:0;width:0;height:0;position:absolute;";
      var sl = mk("span", "rwa-toggle-sl");
      wrap.appendChild(c); wrap.appendChild(sl);
      c.addEventListener("change", fn);
      return wrap;
    }

    var active = "styles";
    function render() {
      win.innerHTML = "";
      ap(win, mk("div", "rwa-bar"));
      var hdr = ap(win, mk("div", "rwa-hdr"));
      var ht = ap(hdr, mk("div", ""));
      ap(ht, mk("div", "rwa-title", "Rewrite Assistant"));
      ap(ht, mk("div", "rwa-subtitle", "Settings"));
      ap(hdr, xBtn(function () { ov.remove(); }));

      var split = ap(win, mk("div", "rwa-split"));
      var nav   = ap(split, mk("div", "rwa-nav"));
      var pane  = ap(split, mk("div", "rwa-pane"));

      function paneHead(p, title, desc) {
        ap(p, mk("div", "rwa-pane-title", title));
        if (desc) ap(p, mk("div", "rwa-pane-desc", desc));
      }

      var SECTIONS = [
        ["styles", "Styles", secStyles],
        ["connection", "Connection", secConnection],
        ["context", "Context", secContext],
        ["popup", "Popup", secPopup],
        ["data", "Data", secData]
      ];
      SECTIONS.forEach(function (s) {
        var it = ap(nav, mk("div", "rwa-nav-item" + (s[0] === active ? " rwa-nav-active" : ""), s[1]));
        it.addEventListener("click", function () { active = s[0]; render(); });
      });
      var cur = SECTIONS.filter(function (s) { return s[0] === active; })[0] || SECTIONS[0];
      cur[2](pane);

      ap(win, mk("div", "rwa-foot-note", "Alt+R on selected text opens the popup."));

      function secStyles(pane) {
        var titleRow = mk("div", "");
        titleRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px;";
        ap(pane, titleRow);
        var ttl  = ap(titleRow, mk("div", "rwa-pane-title", "Styles"));
        ttl.style.marginBottom = "0";
        var cnt = ap(ttl, mk("span", "", " · " + profiles.length));
        cnt.style.cssText = "color:var(--muted-foreground);font-weight:400;";
        var acts = ap(titleRow, mk("div", ""));
        acts.style.cssText = "display:flex;gap:6px;flex-shrink:0;";
        ap(acts, actBtn(ICON.plus, "Add style", null, function () { showEdit(null, -1, render); }));
        ap(acts, actBtn(ICON.spark, "AI architect", "rwa-accept", function () { showAI(render); }));
        ap(pane, mk("div", "rwa-pane-desc", "Drag to reorder — sets the popup button order."));

        var profSearch = mk("input", "rwa-inp"); profSearch.type = "text"; profSearch.placeholder = "Search profiles…";
        profSearch.style.cssText = "width:100%;margin:0 0 8px;padding:6px 10px;font-size:12px;";
        ap(pane, profSearch);
        var listWrap = mk("div", ""); ap(pane, listWrap);
        profSearch.addEventListener("input", function () {
          var q = profSearch.value.trim().toLowerCase();
          listWrap.querySelectorAll(".rwa-item").forEach(function (it) {
            it.style.display = (!q || (it._q || "").indexOf(q) !== -1) ? "" : "none";
          });
        });

        profiles.slice().sort(function (a, b) { return ((a.order || 0) - (b.order || 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }).forEach(function (pr) { // N18: stable tiebreaker by id
          var ri   = profiles.indexOf(pr);
          var item = mk("div", "rwa-item");
          item._q = ((pr.name || "") + " " + (pr.prompt || "")).toLowerCase();
          item.setAttribute("draggable", "true");
          ap(listWrap, item);
          var hnd = ap(item, mk("span", "rwa-hnd")); hnd.innerHTML = svgEl(ICON.grip, 14);
          ap(item, mk("span", "rwa-dot")).style.background = pr.color || "var(--primary)";
          var inf = mk("div", "");
          inf.style.cssText = "flex:1;min-width:0;";
          ap(item, inf);
          var nm = ap(inf, mk("div", "", pr.name));
          nm.style.cssText = "font-weight:600;font-size:12px;color:var(--foreground);display:flex;justify-content:space-between;gap:8px;";
          var tk = ap(nm, mk("span", "", "~" + tokest(pr.prompt) + " tok"));
          tk.style.cssText = "font-weight:400;font-size:10px;color:var(--muted-foreground);flex:0 0 auto;";
          tk.title = "Estimated tokens this profile's instruction adds to the prompt (excludes your selection and context).";
          var pp = ap(inf, mk("div", "", pr.prompt));
          pp.style.cssText = "font-size:10px;color:var(--muted-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
          function applyHidden() { item.style.opacity = pr.hidden ? ".5" : ""; }
          var hideBtn = iconBtn(pr.hidden ? ICON.eyeoff : ICON.eye, null, function () {
            pr.hidden = !pr.hidden; saveP(); applyHidden();
            hideBtn.innerHTML = svgEl(pr.hidden ? ICON.eyeoff : ICON.eye);
            hideBtn.title = (pr.hidden ? "Hidden from popup — click to show" : "Shown in popup — click to hide");
            hideBtn.setAttribute("aria-label", (pr.hidden ? "Show " : "Hide ") + pr.name + " in popup");
          }, (pr.hidden ? "Show " : "Hide ") + pr.name + " in popup");
          hideBtn.title = pr.hidden ? "Hidden from popup — click to show" : "Shown in popup — click to hide";
          ap(item, hideBtn);
          applyHidden();
          ap(item, iconBtn(ICON.edit, null, function () { showEdit(pr, ri, render); }, "Edit " + pr.name));
          ap(item, iconBtn(ICON.trash, "rwa-dng", function () {
            if (confirm('Delete "' + pr.name + '"?')) { profiles.splice(ri, 1); saveP(); render(); }
          }, "Delete " + pr.name));

          item.addEventListener("dragstart", function () { dragId = pr.id; item.classList.add("rwa-drag"); });
          item.addEventListener("dragend", function () {
            item.classList.remove("rwa-drag");
            pane.querySelectorAll(".rwa-item").forEach(function (x) { x.classList.remove("rwa-over"); });
          });
          item.addEventListener("dragover",  function (e) { e.preventDefault(); item.classList.add("rwa-over"); });
          item.addEventListener("dragleave", function ()  { item.classList.remove("rwa-over"); });
          item.addEventListener("drop", function (e) {
            e.preventDefault(); item.classList.remove("rwa-over");
            if (!dragId || dragId === pr.id) return;
            var src = profiles.find(function (x) { return x.id === dragId; });
            if (!src) return;
            var tmp = src.order || 0; src.order = pr.order || 0; pr.order = tmp;
            saveP(); render();
          });
        });

        // Auto-match: generate a character-voice style on chat switch.
        grp(pane, "Auto-match character voice");
        row(pane, "Generate on chat switch",
          ck(cfg.autoProfileEnabled, function (e) { cfg.autoProfileEnabled = e.target.checked; saveC(); }),
          "Builds a style from the character's voice — one model request per switch.");
        Object.keys(autoProfs).forEach(function (cid) {
          var ap2 = autoProfs[cid];
          var apRow = mk("div", "rwa-card");
          ap(pane, apRow);
          var apIc = ap(apRow, mk("span", ""));
          apIc.style.cssText = "color:var(--primary);display:inline-flex;flex-shrink:0;";
          apIc.innerHTML = svgEl(ICON.spark, 13);
          var apName = ap(apRow, mk("span", "", ap2.name));
          apName.style.cssText = "flex:1;font-size:11px;color:var(--foreground);";
          ap(apRow, iconBtn(ICON.trash, "rwa-dng", function () { delete autoProfs[cid]; saveA(); render(); }, "Remove " + ap2.name));
        });
      }

      function secConnection(pane) {
        var db = pane;
        paneHead(pane, "Connection", "Where rewrites are generated.");
        var modeSel = mk("select", "rwa-sel");
        [["marinara", "Marinara connection (recommended)"], ["sidecar", "Local model (downloaded sidecar)"], ["direct", "Direct API (Ollama / llama.cpp)"], ["extender", "Marinara Extender (one sidecar)"]].forEach(function (opt) {
          var o = mk("option", "", opt[1]); o.value = opt[0];
          if ((cfg.connMode || "marinara") === opt[0]) o.selected = true;
          modeSel.appendChild(o);
        });
        row(db, "Model source", modeSel, "“Marinara connection” reuses a connection you already set up — no second copy of your API key. “Local model” is Marinara’s downloaded sidecar model, not your connection list.");

        // Marinara-connection fields — shown only when relevant.
        var mari = mk("div", "");
        ap(db, mari);
        ap(mari, mk("div", "rwa-grp", "Connection"));
        var connSel = mk("select", "rwa-sel");
        var connOpt0 = mk("option", "", "Loading connections…"); connOpt0.value = "";
        connSel.appendChild(connOpt0);
        connSel.addEventListener("change", function () { cfg.connectionId = connSel.value; saveC(); });
        field(mari, "Marinara connection", connSel, "Your configured connections. The API key stays on the Marinara server and is never copied into this extension.");
        var mariStatus = mk("div", ""); mariStatus.style.cssText = "font-size:11px;margin-top:8px;line-height:1.5;color:var(--muted-foreground);";
        marinara.apiFetch("/connections").then(function (j) {
          var list = Array.isArray(j) ? j : (j && j.connections) || [];
          // Image/video endpoints can't answer a chat completion — hide them
          // rather than let someone pick one and get an opaque provider error.
          list = list.filter(function (c) { return c && c.id && !/image|video|comfy/i.test(String(c.provider || "")); });
          connSel.innerHTML = "";
          var none = mk("option", "", list.length ? "— select a connection —" : "No usable connections found");
          none.value = ""; connSel.appendChild(none);
          list.forEach(function (c) {
            var o = mk("option", "", c.name + (c.model ? "  (" + c.model + ")" : ""));
            o.value = c.id;
            if (cfg.connectionId === c.id) o.selected = true;
            connSel.appendChild(o);
          });
        }).catch(function () {
          connSel.innerHTML = "";
          var o = mk("option", "", "Could not load connections"); o.value = "";
          connSel.appendChild(o);
        });
        var mariTestBtn = mkBtn("Test connection", null, function () {
          mariStatus.textContent = "Testing…"; mariStatus.style.color = "var(--muted-foreground)";
          runInference("You are a test.", "Reply with the single word: ok").then(function (resp) {
            if (resp && resp.error) { mariStatus.textContent = "✗ " + resp.error; mariStatus.style.color = "var(--destructive, #ef4444)"; }
            else { mariStatus.textContent = "✓ Connected. Replied: " + ((resp && resp.result) || "").slice(0, 60); mariStatus.style.color = "var(--primary)"; }
          });
        });
        ap(mari, mariTestBtn).style.width = "100%";
        ap(mari, mariStatus);

        // Direct-mode fields (URL, model, key, temp) — shown only when relevant.
        var direct = mk("div", "");
        ap(db, direct);

        // Endpoint
        ap(direct, mk("div", "rwa-grp", "Endpoint"));
        var urlInp = mk("input", "rwa-inp"); urlInp.type = "text"; urlInp.placeholder = "http://localhost:11434/v1";
        urlInp.value = cfg.apiUrl || ""; urlInp.style.cssText = "padding:6px 10px;font-size:12px;";
        urlInp.addEventListener("change", function () { cfg.apiUrl = urlInp.value.trim(); saveC(); });
        field(direct, "API URL", urlInp, "Click a preset to fill, or type your own. Most local servers expose /v1; confirm the port.");
        var presets = [
          ["Ollama", "http://localhost:11434/v1"], ["LM Studio", "http://localhost:1234/v1"],
          ["llama.cpp", "http://localhost:8080/v1"], ["KoboldCpp", "http://localhost:5001/v1"],
          ["Jan", "http://localhost:1337/v1"], ["text-gen-webui", "http://localhost:5000/v1"],
          ["vLLM", "http://localhost:8000/v1"],
        ];
        var presetWrap = mk("div", ""); presetWrap.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin:-4px 0 10px;";
        presets.forEach(function (pr) {
          var chip = mk("button", "", pr[0]);
          chip.title = "Set API URL to " + pr[1];
          chip.style.cssText = "font-size:10px;padding:2px 8px;border:1px solid var(--border,rgba(127,127,127,.3));border-radius:8px;background:transparent;color:var(--muted-foreground);cursor:pointer;";
          chip.addEventListener("click", function (e) { e.stopPropagation(); urlInp.value = pr[1]; cfg.apiUrl = pr[1]; saveC(); });
          ap(presetWrap, chip);
        });
        ap(direct, presetWrap);

        // Model
        ap(direct, mk("div", "rwa-grp", "Model"));
        var modelInp = mk("input", "rwa-inp"); modelInp.type = "text"; modelInp.placeholder = "llama3.1";
        modelInp.value = cfg.apiModel || ""; modelInp.style.cssText = "padding:6px 10px;font-size:12px;";
        modelInp.addEventListener("change", function () { cfg.apiModel = modelInp.value.trim(); saveC(); });
        field(direct, "Model name", modelInp);
        var discWrap = mk("div", ""); discWrap.style.cssText = "display:flex;gap:6px;align-items:center;";
        var discSel = mk("select", "rwa-sel"); discSel.style.cssText = "flex:1;"; discSel.style.display = "none";
        var discBtn = mkBtn("Discover", null, function () {
          discBtn.textContent = "…";
          discoverModels().then(function (res) {
            discBtn.textContent = "Discover";
            if (res.error || !res.models || !res.models.length) {
              showToast(null, res.error || "No models found at that URL."); return;
            }
            discSel.innerHTML = "";
            var ph = mk("option", "", "Select a model… (" + res.models.length + ")"); ph.value = ""; discSel.appendChild(ph);
            res.models.forEach(function (name) {
              var o = mk("option", "", name); o.value = name;
              if (name === cfg.apiModel) o.selected = true;
              discSel.appendChild(o);
            });
            discSel.style.display = "";
          });
        });
        ap(discWrap, discBtn);
        ap(discWrap, discSel);
        discSel.addEventListener("change", function () {
          if (!discSel.value) return;
          cfg.apiModel = discSel.value; modelInp.value = discSel.value; saveC();
        });
        field(direct, "Discover models", discWrap, "List the models the endpoint reports, then pick one.");

        // Authentication & tuning
        ap(direct, mk("div", "rwa-grp", "Authentication & tuning"));
        var keyInp = mk("input", "rwa-inp"); keyInp.type = "text"; keyInp.placeholder = "leave blank for local";
        keyInp.value = cfg.apiKey || ""; keyInp.style.cssText = "padding:6px 10px;font-size:12px;";
        keyInp.addEventListener("change", function () { cfg.apiKey = keyInp.value.trim(); saveC(); });
        field(direct, "API key", keyInp, "Optional — most local servers ignore it.");
        var tr = mk("input", "rwa-inp"); tr.type = "number"; tr.min = "0"; tr.max = "2"; tr.step = "0.1";
        tr.value = String(cfg.directTemp != null ? cfg.directTemp : 0.7);
        tr.style.cssText = "width:64px;margin:0;padding:6px 10px;font-size:12px;";
        tr.addEventListener("change", function () { cfg.directTemp = Math.max(0, Math.min(2, parseFloat(tr.value) || 0.7)); saveC(); });
        row(direct, "Temperature", tr, "0–2. Lower stays closer to the original.");
        var ctxInD = mk("input", "rwa-inp"); ctxInD.type = "number"; ctxInD.min = "1024"; ctxInD.max = "1000000";
        ctxInD.value = String(cfg.ctxTokens || 8192); ctxInD.style.cssText = "width:90px;margin:0;padding:6px 10px;font-size:12px;";
        ctxInD.addEventListener("change", function () { cfg.ctxTokens = Math.max(1024, Math.min(1000000, parseInt(ctxInD.value, 10) || 8192)); saveC(); });
        row(direct, "Model context size", ctxInD, "Tokens. Selections over ~1/6 of this are split into slices (Ledger Pattern) instead of truncated.");

        var testStatus = mk("div", ""); testStatus.style.cssText = "font-size:11px;margin-top:8px;line-height:1.5;color:var(--muted-foreground);";
        var testBtn = mkBtn("Test connection", null, function () {
          testStatus.textContent = "Testing…"; testStatus.style.color = "var(--muted-foreground)";
          runInference("You are a test.", "Reply with the single word: ok").then(function (resp) {
            if (resp && resp.error) { testStatus.textContent = "✗ " + resp.error; testStatus.style.color = "var(--destructive, #ef4444)"; }
            else { testStatus.textContent = "✓ Connected. Model replied: " + ((resp && resp.result) || "").slice(0, 60); testStatus.style.color = "var(--primary)"; }
          });
        });
        ap(direct, testBtn).style.width = "100%";
        ap(direct, testStatus);
        var note = mk("div", "", "Ollama needs OLLAMA_ORIGINS=* (env var) so the browser can reach it.");
        note.style.cssText = "font-size:10px;color:var(--muted-foreground);margin-top:8px;line-height:1.5;";
        ap(direct, note);

        // Extender-mode fields (URL, temperature, test) — shown only for extender mode.
        var extender = mk("div", "");
        ap(db, extender);
        ap(extender, mk("div", "rwa-grp", "Extender server"));
        var exuInp = mk("input", "rwa-inp"); exuInp.type = "text"; exuInp.placeholder = "http://127.0.0.1:3001";
        exuInp.value = cfg.extenderUrl || ""; exuInp.style.cssText = "padding:6px 10px;font-size:12px;";
        exuInp.addEventListener("change", function () { cfg.extenderUrl = exuInp.value.trim(); saveC(); });
        field(extender, "Extender server URL", exuInp, "URL of the Marinara Extender sidecar. Routes rewrites through its model — no separate Ollama needed.");
        var extr = mk("input", "rwa-inp"); extr.type = "number"; extr.min = "0"; extr.max = "2"; extr.step = "0.1";
        extr.value = String(cfg.directTemp != null ? cfg.directTemp : 0.7);
        extr.style.cssText = "width:64px;margin:0;padding:6px 10px;font-size:12px;";
        extr.addEventListener("change", function () { cfg.directTemp = Math.max(0, Math.min(2, parseFloat(extr.value) || 0.7)); saveC(); });
        row(extender, "Temperature", extr, "0–2. Shared with Direct API mode.");
        var ctxInE = mk("input", "rwa-inp"); ctxInE.type = "number"; ctxInE.min = "1024"; ctxInE.max = "1000000";
        ctxInE.value = String(cfg.ctxTokens || 8192); ctxInE.style.cssText = "width:90px;margin:0;padding:6px 10px;font-size:12px;";
        ctxInE.addEventListener("change", function () { cfg.ctxTokens = Math.max(1024, Math.min(1000000, parseInt(ctxInE.value, 10) || 8192)); saveC(); });
        row(extender, "Model context size", ctxInE, "Tokens. Selections over ~1/6 of this are split into slices (Ledger Pattern).");
        var exTestStatus = mk("div", ""); exTestStatus.style.cssText = "font-size:11px;margin-top:8px;line-height:1.5;color:var(--muted-foreground);";
        var exTestBtn = mkBtn("Test connection", null, function () {
          exTestStatus.textContent = "Testing…"; exTestStatus.style.color = "var(--muted-foreground)";
          runInference("You are a test.", "Reply with the single word: ok").then(function (resp) {
            if (resp && resp.error) { exTestStatus.textContent = "✗ " + resp.error; exTestStatus.style.color = "var(--destructive, #ef4444)"; }
            else { exTestStatus.textContent = "✓ Connected. Extender replied: " + ((resp && resp.result) || "").slice(0, 60); exTestStatus.style.color = "var(--primary)"; }
          });
        });
        ap(extender, exTestBtn).style.width = "100%";
        ap(extender, exTestStatus);

        function syncMode() {
          mari.style.display     = ((cfg.connMode || "marinara") === "marinara") ? "" : "none";
          direct.style.display   = (cfg.connMode === "direct")   ? "" : "none";
          extender.style.display = (cfg.connMode === "extender") ? "" : "none";
        }
        modeSel.addEventListener("change", function () { cfg.connMode = modeSel.value; saveC(); syncMode(); });
        syncMode();

        // Prompt economy (applies to both modes).
        grp(db, "Prompt");
        row(db, "Shorter instructions", ck(cfg.conciseSysPrompt, function (e) { cfg.conciseSysPrompt = e.target.checked; saveC(); }),
          "Sends a terser system prompt — helps small models stay on task.");

        // Debug logging (applies to both modes)
        grp(db, "Debug");
        row(db, "Debug logging", ck(cfg.debugEnabled, function (e) { cfg.debugEnabled = e.target.checked; saveC(); }),
          "Captures the exact prompt and raw reply (last 100 events).");
        var dbgBtns = mk("div", ""); dbgBtns.style.cssText = "display:flex;gap:8px;margin-top:2px;";
        ap(db, dbgBtns);
        ap(dbgBtns, mkBtn("Download log", null, downloadDebug)).style.flex = "1";
        ap(dbgBtns, mkBtn("Clear", "rwa-dng", function () { dbg.length = 0; saveDbg(); showToast(null, "Debug log cleared", "ok"); })).style.flex = "0 0 auto";
        var dbgNote = mk("div", "", "Writes ME-rewrite-debug.json to Downloads (also at window.__rwaDebug). The API key is redacted.");
        dbgNote.style.cssText = "font-size:10px;color:var(--muted-foreground);margin-top:8px;line-height:1.5;";
        ap(db, dbgNote);
      }

      function secPopup(pane) {
        var db = pane;
        paneHead(pane, "Popup", "How the popup looks and applies rewrites.");
        function numRow(label, cfgKey, min, max) {
          var ni = mk("input", "rwa-inp"); ni.type = "number"; ni.min = String(min); ni.max = String(max);
          ni.value = String(cfg[cfgKey] !== undefined ? cfg[cfgKey] : min);
          ni.style.cssText = "width:56px;margin:0;padding:6px 10px;font-size:12px;";
          ni.addEventListener("change", function () { cfg[cfgKey] = Math.max(min, Math.min(max, parseInt(ni.value, 10) || min)); saveC(); });
          row(db, label, ni);
        }
        grp(db, "Layout");
        var posSel = mk("select", "rwa-sel");
        [["auto","Auto"],["above","Above"],["below","Below"]].forEach(function (opt) {
          var o = mk("option", "", opt[1]); o.value = opt[0];
          if ((cfg.popupPos || "auto") === opt[0]) o.selected = true;
          posSel.appendChild(o);
        });
        posSel.addEventListener("change", function () { cfg.popupPos = posSel.value; saveC(); });
        row(db, "Popup position", posSel);
        numRow("Mode button columns", "cols", 1, 4);
        numRow("Mode button rows", "rows", 1, 12);

        grp(db, "Applying rewrites");
        row(db, "Open on Alt+R only", ck(cfg.manualTriggerOnly, function (e) { cfg.manualTriggerOnly = e.target.checked; saveC(); }),
          "Don't pop up when you select text — press Alt+R instead.");
        row(db, "Auto-apply", ck(cfg.autoApply, function (e) { cfg.autoApply = e.target.checked; saveC(); }),
          "Skip the preview and replace the text immediately.");
        row(db, "Review & edit before applying", ck(cfg.reviewBeforeApply, function (e) { cfg.reviewBeforeApply = e.target.checked; saveC(); }),
          "Show the rewrite in an editable box and apply it only when you click Apply.");
        row(db, "Typewriter reveal", ck(cfg.typewriter, function (e) { cfg.typewriter = e.target.checked; saveC(); }));
        row(db, "Show word diff", ck(cfg.showDiff, function (e) { cfg.showDiff = e.target.checked; saveC(); }));
        row(db, "Merge multi-message", ck(cfg.mergeMultiMsg, function (e) { cfg.mergeMultiMsg = e.target.checked; saveC(); }),
          "One rewrite for the whole span, then split back — better flow, but small models may misalign it (falls back to per-message).");
      }

      function secContext(pane) {
        var db = pane;
        paneHead(pane, "Context", "What the model sees besides your selection. More context fits better but costs tokens.");
        grp(db, "Character");
        row(db, "Character card", ck(cfg.useCharCard, function (e) { cfg.useCharCard = e.target.checked; saveC(); }),
          "Include the character's card so the rewrite matches their voice.");
        row(db, "Your persona", ck(cfg.useUserPersona, function (e) { cfg.useUserPersona = e.target.checked; saveC(); }),
          "On your own messages, include your persona card.");

        grp(db, "Conversation");
        var wn = mk("input", "rwa-inp"); wn.type = "number"; wn.min = "50"; wn.max = "400";
        wn.value = String(cfg.localContextWords || 150); wn.style.cssText = "width:56px;margin:0;padding:6px 10px;font-size:12px;";
        wn.addEventListener("change", function () { cfg.localContextWords = Math.max(50, Math.min(400, parseInt(wn.value, 10) || 150)); saveC(); });
        var syncWords = null;
        row(db, "Surrounding text", ck(cfg.localContextEnabled, function (e) { cfg.localContextEnabled = e.target.checked; saveC(); if (syncWords) syncWords(e.target.checked); }),
          "Send text on either side of your selection for continuity.");
        syncWords = depRow(db, "Words per side", wn, cfg.localContextEnabled);

        var pn = mk("input", "rwa-inp"); pn.type = "number"; pn.min = "1"; pn.max = "4";
        pn.value = String(cfg.prevMessageCount || 2); pn.style.cssText = "width:56px;margin:0;padding:6px 10px;font-size:12px;";
        pn.addEventListener("change", function () { cfg.prevMessageCount = Math.max(1, Math.min(4, parseInt(pn.value, 10) || 2)); saveC(); });
        var syncPrev = null;
        row(db, "Lorebook entries", ck(cfg.useLorebookEntries, function (e) { cfg.useLorebookEntries = e.target.checked; saveC(); }),
          "Pull in active lorebook entries for the scene.");
        row(db, "Previous messages", ck(cfg.usePrevMessages, function (e) { cfg.usePrevMessages = e.target.checked; saveC(); if (syncPrev) syncPrev(e.target.checked); }),
          "Send the messages just before the selection.");
        syncPrev = depRow(db, "How many", pn, cfg.usePrevMessages);

        grp(db, "Marinara Extender");
        row(db, "Extender memory", ck(cfg.useExtenderMemory, function (e) { cfg.useExtenderMemory = e.target.checked; saveC(); }),
          "Pulls live character memory from the Extender sidecar — adds it to the rewrite context. Falls back to lorebook scan if the server is down or URL is blank.");
        row(db, "Speaker-aware editing", ck(cfg.speakerAware, function (e) { cfg.speakerAware = e.target.checked; saveC(); }),
          "Detects whether the selection is the author's prose or a character's voice, and tells the model which mode to edit in. Recommended for roleplay chats.");

        grp(db, "Specific characters");
        var hint = mk("div", "", "Pick which character cards inform the voice. Leave all unchecked to use the chat’s own.");
        hint.style.cssText = "font-size:10px;color:var(--muted-foreground);margin:-3px 0 7px;";
        ap(db, hint);
        var charSearch = mk("input", "rwa-inp"); charSearch.type = "text"; charSearch.placeholder = "Search characters…";
        charSearch.style.cssText = "width:100%;margin:0 0 8px;padding:6px 10px;font-size:12px;";
        ap(db, charSearch);
        var charListWrap = mk("div", "rwa-char-list");
        ap(db, charListWrap);
        charSearch.addEventListener("input", function () {
          var q = charSearch.value.trim().toLowerCase();
          charListWrap.querySelectorAll(".rwa-charrow").forEach(function (it) {
            it.style.display = (!q || (it._q || "").indexOf(q) !== -1) ? "" : "none";
          });
        });
        if (_charListCache) { renderCharList(charListWrap, _charListCache); }
        else {
          var charLoadEl = ap(charListWrap, mk("div", "", "Loading…"));
          charLoadEl.style.cssText = "font-size:10px;color:var(--muted-foreground);padding:2px 0;";
          marinara.apiFetch("/characters").then(function (chars) {
            _charListCache = chars; charListWrap.innerHTML = ""; renderCharList(charListWrap, chars);
          }).catch(function () { charListWrap.innerHTML = ""; ap(charListWrap, mk("div", "", "Failed to load.")).style.cssText = "font-size:10px;color:var(--destructive);"; });
        }
      }

      function secData(pane) {
        var db = pane;
        paneHead(pane, "Data", "History, backup, and reset.");

        grp(db, "History");
        var ud = mk("input", "rwa-inp"); ud.type = "number"; ud.min = "1"; ud.max = "20";
        ud.value = String(cfg.historyDepth !== undefined ? cfg.historyDepth : 5);
        ud.style.cssText = "width:56px;margin:0;padding:6px 10px;font-size:12px;";
        ud.addEventListener("change", function () { cfg.historyDepth = Math.max(1, Math.min(20, parseInt(ud.value, 10) || 5)); saveC(); });
        row(db, "Undo depth", ud, "How many past rewrites you can step back through.");
        if (!hist.length) {
          var nh = mk("div", "", "No rewrites yet.");
          nh.style.cssText = "font-size:11px;color:var(--muted-foreground);"; ap(db, nh);
        } else {
          hist.forEach(function (h, i) {
            var hi = ap(db, mk("div", "rwa-hist"));
            ap(hi, mk("div", "rwa-badge", i === 0 ? "Most Recent" : "Previous"));
            var pv = mk("div", "", (h.old || "").slice(0, 80) + (h.old && h.old.length > 80 ? "…" : ""));
            pv.style.cssText = "font-size:11px;color:var(--foreground);"; ap(hi, pv);
            if (h.when) { var wt = mk("div", "", new Date(h.when).toLocaleTimeString()); wt.style.cssText = "font-size:9px;color:var(--muted-foreground);margin-top:2px;"; ap(hi, wt); }
          });
        }

        grp(db, "Backup");
        var hint = mk("div", "", "Choose what to export, or import to merge from a previous export. Files are JSON — the only format that can be re-imported.");
        hint.style.cssText = "font-size:11px;color:var(--muted-foreground);margin:-3px 0 10px;line-height:1.5;";
        ap(db, hint);
        var exOpts = { profiles: true, config: true, customs: true, autoProfs: true };
        [["profiles", "Styles (" + profiles.length + ")"], ["config", "Settings"],
         ["customs", "Custom prompts (" + customs.length + ")"],
         ["autoProfs", "Auto-profiles (" + Object.keys(autoProfs).length + ")"]].forEach(function (o) {
          var rrow = mk("label", ""); rrow.style.cssText = "display:flex;align-items:center;gap:8px;font-size:11px;color:var(--foreground);margin:3px 0;cursor:pointer;";
          var c = mk("input", ""); c.type = "checkbox"; c.checked = true;
          c.style.cssText = "width:14px;height:14px;accent-color:var(--primary);cursor:pointer;";
          c.addEventListener("change", function () { exOpts[o[0]] = c.checked; });
          ap(rrow, c); ap(rrow, mk("span", "", o[1])); ap(db, rrow);
        });
        var btnRow = mk("div", ""); btnRow.style.cssText = "display:flex;gap:8px;margin-top:10px;";
        ap(db, btnRow);
        ap(btnRow, mkBtn("Export selected", "rwa-accept", function () { exportProfiles(exOpts); })).style.flex = "1";
        ap(btnRow, mkBtn("Import", null, function () { importProfiles(render); })).style.flex = "1";

        grp(db, "Reset");
        ap(db, mkBtn("Reset all to defaults", "rwa-dng", function () {
          if (confirm("Reset all styles and settings to defaults?")) {
            profiles = DEF_PROFILES.slice();
            cfg = (function () { var m = {}; Object.keys(DEF_CFG).forEach(function (k) { m[k] = DEF_CFG[k]; }); return m; })();
            hist = []; customs = []; autoProfs = {};
            saveP(); saveC(); saveH(); saveX(); saveA(); render();
          }
        })).style.width = "100%";
      }
    }
    render();
  }

  function renderCharList(wrap, chars) {
    if (!Array.isArray(chars) || !chars.length) {
      ap(wrap, mk("div", "", "No characters found.")).style.cssText = "font-size:10px;color:var(--muted-foreground);";
      return;
    }
    chars.slice().sort(function (a, b) {
      var na = "", nb = "";
      try { na = (typeof a.data === "string" ? JSON.parse(a.data) : a.data || {}).name || a.name || ""; } catch(e) {}
      try { nb = (typeof b.data === "string" ? JSON.parse(b.data) : b.data || {}).name || b.name || ""; } catch(e) {}
      return na.localeCompare(nb);
    }).forEach(function (char) {
      var data = {};
      try { data = typeof char.data === "string" ? JSON.parse(char.data) : char.data || {}; } catch (e) {}
      var name = data.name || char.name || char.id;
      var charRow = mk("div", "rwa-charrow");
      charRow._q = String(name).toLowerCase();
      charRow.style.cssText = "display:flex;align-items:center;gap:8px;padding:4px 4px;border-radius:4px;cursor:pointer;";
      charRow.addEventListener("mouseenter", function () { charRow.style.background = "var(--accent)"; });
      charRow.addEventListener("mouseleave", function () { charRow.style.background = ""; });
      var cb = mk("input", "");
      cb.type = "checkbox";
      cb.checked = (cfg.charCardIds || []).indexOf(char.id) !== -1;
      cb.style.cssText = "width:14px;height:14px;accent-color:var(--primary);cursor:pointer;flex-shrink:0;";
      ap(charRow, cb);
      var lbl = ap(charRow, mk("span", "", name));
      lbl.style.cssText = "font-size:11px;color:var(--foreground);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      cb.addEventListener("change", function () {
        var ids = (cfg.charCardIds || []).slice();
        if (cb.checked) { if (ids.indexOf(char.id) === -1) ids.push(char.id); }
        else { ids = ids.filter(function (x) { return x !== char.id; }); }
        cfg.charCardIds = ids;
        saveC();
      });
      charRow.addEventListener("click", function (e) {
        if (e.target !== cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); }
      });
      ap(wrap, charRow);
    });
  }

  // ── Edit profile ──────────────────────────────────────────────────────────
  function showEdit(profile, idx, onDone, prefill) {
    var ov   = mkOv(10002);
    var body = mkWin(ov, "400px", (profile ? "Edit" : "New") + " Style");

    ap(body, mk("div", "rwa-lbl", "Name"));
    var ni = mk("input", "rwa-inp");
    ni.placeholder = "e.g. Pirate Speak";
    ni.value = profile ? profile.name : ((prefill && prefill.name) || "");
    ap(body, ni);

    ap(body, mk("div", "rwa-lbl", "Instruction"));
    var pi = mk("textarea", "rwa-inp");
    pi.placeholder = "Rewrite the following text...";
    pi.style.cssText = "height:110px;resize:vertical;";
    pi.value = profile ? profile.prompt : ((prefill && prefill.prompt) || "");
    ap(body, pi);

    ap(body, mk("div", "rwa-lbl", "Accent colour (optional)"));
    var colorRow = mk("div", "");
    colorRow.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:10px;";
    ap(body, colorRow);
    var ci = mk("input", "");
    ci.type = "color";
    var _defPri = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#b57edc";
        ci.value = (profile && profile.color) ? profile.color : _defPri;
    ci.style.cssText = "width:40px;height:28px;padding:2px;cursor:pointer;border:none;background:none;border-radius:4px;";
    ap(colorRow, ci);
    var colorHint = mk("span", "", "Theme accent = default");
    colorHint.style.cssText = "font-size:10px;color:var(--muted-foreground);";
    ap(colorRow, colorHint);
    var resetColor = mkBtn("Reset", null, function () { ci.value = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#b57edc"; });
    resetColor.classList.add("rwa-btn-sm");
    ap(colorRow, resetColor);

    var ft = ap(body, mk("div", "rwa-foot"));
    ap(ft, mkBtn("Save", "rwa-accept", function () {
      var n = ni.value.trim(), p = pi.value.trim();
      if (!n || !p) return;
      var chosenColor = ci.value !== (getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#b57edc") ? ci.value : null;
      var e = {
        id:     profile ? profile.id : Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        name:   n,
        prompt: p,
        order:  profile ? (profile.order || 0) : profiles.length,
        color:  chosenColor,
      };
      if (idx >= 0) profiles[idx] = e; else profiles.push(e);
      saveP(); ov.remove(); if (onDone) onDone();
    })).style.flex = "1";
    ap(ft, mkBtn("Cancel", null, function () { ov.remove(); })).style.flex = "1";
  }

  // ── AI Architect ──────────────────────────────────────────────────────────
  function showAI(onDone) {
    var ov   = mkOv(10002);
    var body = mkWin(ov, "440px", "\u2728 AI Prompt Architect");
    var info = mk("div", "", "Describe the rewrite style. The AI will generate a name and instruction prompt.");
    info.style.cssText = "font-size:12px;color:var(--muted-foreground);margin-bottom:12px;line-height:1.5;";
    ap(body, info);
    var ta = mk("textarea", "rwa-inp");
    ta.placeholder = 'e.g. "A grumpy old sailor with a thick accent"';
    ta.style.cssText = "height:75px;resize:none;";
    ap(body, ta);
    var st = mk("div", "");
    st.style.cssText = "font-size:11px;color:var(--muted-foreground);min-height:16px;margin-bottom:8px;";
    ap(body, st);
    var ft = ap(body, mk("div", "rwa-foot"));
    var gb = ap(ft, mkBtn("Generate", "rwa-accept", function () {
      var d = ta.value.trim();
      if (!d) return;
      gb.disabled = true; gb.textContent = "Thinking\u2026"; st.textContent = "";
      runInference(
        'Output ONLY valid JSON (no fences) with keys "name" (1-3 words) and "prompt" (starts with "Rewrite the following text").',
        "Create a rewrite style for: " + d
      )
        .then(function (resp) {
          if (resp && resp.error) throw new Error(resp.error);
          if (!resp || !resp.result) throw new Error("Empty response from AI");
          var data = JSON.parse(resp.result.trim().replace(/^```(?:json)?|```$/gm, "").trim());
          if (!data.name || !data.prompt) throw new Error("AI response missing 'name' or 'prompt' keys");
          profiles.push({
            id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
            name: data.name, prompt: data.prompt, order: profiles.length
          });
          saveP(); ov.remove(); onDone();
        })
        .catch(function (e) {
          st.textContent = "Failed: " + (e && e.message ? e.message : String(e));
          gb.disabled = false; gb.textContent = "Retry";
        });
    }));
    gb.style.flex = "1";
    ap(ft, mkBtn("Cancel", null, function () { ov.remove(); })).style.flex = "1";
  }

  // ── Selection listeners ───────────────────────────────────────────────────
  // A rewrite can only splice into ONE message, but a drag can cross message
  // boundaries (and grouped messages render as several elements sharing one id).
  // Clamp the selection to the anchor message's element block so we never try to
  // locate cross-message text in a single stored message.
  function selectionTextInMessage(range, mid) {
    var segs = document.querySelectorAll('[data-message-id="' + mid + '"]');
    if (!segs.length) return range.toString().trim();
    // Clamp to the rendered content blocks, not the message element — the
    // element also wraps the author/timestamp header, which isn't in stored
    // content and would break the splice match.
    var contents = [];
    for (var i = 0; i < segs.length; i++) {
      var cs = segs[i].querySelectorAll(".mari-message-content");
      for (var j = 0; j < cs.length; j++) contents.push(cs[j]);
    }
    var startEl = contents.length ? contents[0] : segs[0];
    var endEl = contents.length ? contents[contents.length - 1] : segs[segs.length - 1];
    try {
      var bound = document.createRange();
      bound.setStartBefore(startEl);
      bound.setEndAfter(endEl);
      var clamped = range.cloneRange();
      if (range.compareBoundaryPoints(Range.START_TO_START, bound) < 0) {
        clamped.setStart(bound.startContainer, bound.startOffset);
      }
      if (range.compareBoundaryPoints(Range.END_TO_END, bound) > 0) {
        clamped.setEnd(bound.endContainer, bound.endOffset);
      }
      return clamped.toString().trim();
    } catch (e) {
      return range.toString().trim();
    }
  }

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

  // How many times the selected text already appears in this message BEFORE the
  // selection start — i.e. which occurrence the user picked — so doCommit can
  // splice the intended one when a phrase repeats. Returns 0 when undeterminable.
  function selectionOccurrence(range, mid, segText) {
    try {
      var needle = (segText || "").trim();
      if (!needle) return 0;
      var contents = document.querySelectorAll('[data-message-id="' + mid + '"] .mari-message-content');
      var startEl = contents.length ? contents[0] : document.querySelector('[data-message-id="' + mid + '"]');
      if (!startEl) return 0;
      var pre = document.createRange();
      pre.setStartBefore(startEl);
      pre.setEnd(range.startContainer, range.startOffset);
      var before = pre.toString().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      var n = 0, i = 0;
      while ((i = before.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
      return n;
    } catch (e) { return 0; }
  }

  // A single Marinara turn can render as SEVERAL message bubbles, each its own
  // stored message. Collect one {mid, text} per message the selection touches,
  // in document order, so a cross-message drag becomes a list to rewrite in turn.
  function collectSelectionSegments(range) {
    var idEls = document.querySelectorAll("[data-message-id]");
    var order = [], seen = {};
    for (var i = 0; i < idEls.length; i++) {
      var el = idEls[i];
      try { if (!range.intersectsNode(el)) continue; } catch (e) { continue; }
      var mid = el.getAttribute("data-message-id");
      if (seen[mid]) continue;
      seen[mid] = 1; order.push(mid);
    }
    var segs = [];
    for (var k = 0; k < order.length; k++) {
      var t = selectionTextInMessage(range, order[k]);
      if (t && t.length >= 2) {
        var o = selectionOccurrence(range, order[k], t);
        // B3: `occ` alone is not proof of place — record what surrounds the chosen
        // occurrence now, so the commit can tell "same phrase" from "same spot".
        segs.push({ mid: order[k], text: t, occ: o, fp: ctxFingerprint(renderedTextForMid(order[k]), t, o) });
      }
    }
    return segs;
  }

  marinara.on(document, "mouseup", function (e) {
    if (_movingPopup) { _movingPopup = false; return; } // just finished dragging the popup
    if (cfg.manualTriggerOnly) return;
    if (e.target && !document.body.contains(e.target)) return;
    if (popup && popup.contains(e.target)) return;
    var ov = document.querySelector(".rwa-ov");
    if (ov && ov.contains(e.target)) return;

    marinara.setTimeout(function () {
      var s   = window.getSelection();
      var txt = s ? s.toString().trim() : "";
      if (!txt || txt.length < 2) { killPopup(); return; }
      var msgEl = e.target && e.target.closest ? e.target.closest("[data-message-id]") : null;
      if (!msgEl) { killPopup(); return; }
      try {
        var range = s.getRangeAt(0);
        var segs = collectSelectionSegments(range);
        if (!segs.length) { killPopup(); return; }
        showPopup(range.getBoundingClientRect(), segs);
      } catch (err) {}
    }, 150);
  });

  marinara.on(document, "keydown", function (e) {
    if (!e.altKey || (e.key !== "r" && e.key !== "R")) return;
    var s = window.getSelection(), txt = s ? s.toString().trim() : "";
    if (!txt || txt.length < 2) return;
    try {
      var range = s.getRangeAt(0);
      var sn    = range.startContainer;
      var node  = sn.nodeType === 3 ? sn.parentElement : sn;
      if (!node || !node.closest("[data-message-id]")) return;
      var segs = collectSelectionSegments(range);
      if (segs.length) showPopup(range.getBoundingClientRect(), segs);
    } catch (err) {}
  });

  // ── Cleanup registration ──────────────────────────────────────────────────
  marinara.onCleanup(function () {
    if (popup) { popup.remove(); popup = null; }
    if (_tip) { _tip.remove(); _tip = null; }
    document.querySelectorAll(".rwa-ov").forEach(function (el) { el.remove(); });
  });
})(marinara);

