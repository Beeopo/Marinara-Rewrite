// Rewrite Assistant v4.1 — Marinara Engine Extension (UI Overhaul)
(function (marinara) {
  "use strict";

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

  var profiles = loadArr(K_PROF, DEF_PROFILES);

  var DEF_CFG = {
    cols: 2, rows: 8, typewriter: false, useCharCard: false, showDiff: false,
    lengthEnabled: false, lengthPct: 0, autoApply: false, popupPos: "auto",
    historyDepth: 5,
    localContextEnabled: false, localContextWords: 150,
    useLorebookEntries: false, usePrevMessages: false, prevMessageCount: 2,
    charCardIds: [], reviewBeforeApply: false, useUserPersona: false,
    // Connection: "sidecar" (Marinara local sidecar), "direct" (OpenAI-compatible
    // endpoint such as Ollama/llama.cpp), or "extender" (Marinara Extender sidecar).
    // Direct/Extender avoid running two models at once.
    connMode: "sidecar", apiUrl: "http://127.0.0.1:11434/v1", apiModel: "", apiKey: "", directTemp: 0.7,
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

  // Write raw content back to the engine. apiFetch spreads options into fetch and
  // resolves to parsed JSON; the PATCH route returns the updated message object.
  function patchMessage(cid, mid, content) {
    return marinara.apiFetch(
      "/chats/" + encodeURIComponent(cid) + "/messages/" + encodeURIComponent(mid),
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: content }) }
    );
  }

  var _loreCache = { key: null, result: null, ts: 0 };
  var _charListCache = null;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function getChatId() {
    var fromStore = localStorage.getItem("marinara-active-chat-id");
    if (fromStore) return fromStore;
    var el = document.querySelector('[data-chat-id][class*="sidebar-accent"]');
    return el ? el.getAttribute("data-chat-id") : null;
  }

  function buildCharCardContext(chars) {
    var parts = [];
    chars.forEach(function (char) {
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
    return parts.length ? "\n\n<character note=\"Match this character's voice, register, and speech style.\">\n" + parts.join("\n\n") + "\n</character>" : "";
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
        var result = "\n\n<lore note=\"World facts for continuity — reference only.\">\n" + combined + "\n</lore>";
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
      return "\n\n<context note=\"Preceding messages — reference only, do not rewrite.\">\n" + sl.map(function (m) {
        return (m.role || "user").toUpperCase() + ": " + (m.content || "").slice(0, 300);
      }).join("\n") + "\n</context>";
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
      ? "\n\n<persona note=\"This is the human user's persona. When rewriting their own message, keep their voice and self-description.\">\n" + lines.join("\n") + "\n</persona>"
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
    return parts.length ? "\n\n<context note=\"Surrounding prose — reference only, do not rewrite.\">\n" + parts.join("\n\n") + "\n</context>" : "";
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
    return inner
      ? "\n\n<memory note=\"Character & world memory — reference only, do not rewrite.\">\n" + inner + "\n</memory>"
      : "";
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
    // Fetch all lorebook entries for the chat so the fallback can filter.
    return marinara.apiFetch("/lorebook-entries?chatId=" + encodeURIComponent(cid || ""))
      .then(function (resp) {
        return Array.isArray(resp) ? resp : ((resp && (resp.entries || resp.data)) || []);
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
  // Index of the n-th (0-based) non-overlapping occurrence of needle in haystack, or -1.
  function nthIndexOf(hay, needle, n) {
    var idx = hay.indexOf(needle);
    for (var k = 0; k < n && idx !== -1; k++) idx = hay.indexOf(needle, idx + needle.length);
    return idx;
  }
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

  // ── Styles ────────────────────────────────────────────────────────────────

  marinara.addStyle(
        ".rwa{position:fixed;background:var(--popover);border:1px solid var(--border);border-radius:12px;" +
    "padding:12px;box-shadow:0 12px 40px rgba(0,0,0,.55);z-index:10000;display:flex;flex-direction:column;gap:6px;" +
    "min-width:200px;width:max-content;max-width:min(90vw,480px);backdrop-filter:blur(18px);overflow:hidden;" +
    "animation:rwa-in .14s cubic-bezier(.22,1,.36,1);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,'Open Sans','Helvetica Neue',sans-serif;}" +
    "@keyframes rwa-in{from{opacity:0;transform:translateY(6px) scale(.95)}to{opacity:1;transform:none}}" +
    ".rwa-topbar{height:2px;background:var(--primary);opacity:.5;flex-shrink:0;margin:-12px -12px 0;}" +
    ".rwa-mini-hdr{display:flex;align-items:center;padding:2px 2px 8px;margin:0 0 8px;" +
    "border-bottom:1px solid var(--border);}" +
    ".rwa-mini-title{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;" +
    "color:var(--muted-foreground);}" +
    ".rwa-mini-sub{margin-left:auto;font-size:9.5px;color:var(--muted-foreground);white-space:nowrap;}" +
    ".rwa-grid{display:grid;gap:4px;overflow-y:auto;}" +
    ".rwa-pb{display:block;width:100%;height:30px;line-height:30px;padding:0 12px;" +
    "background:var(--secondary);border:1px solid var(--border);border-radius:8px;" +
    "color:var(--secondary-foreground);font:600 11px/1 inherit;cursor:pointer;text-align:left;" +
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
    "transition:all .15s;}" +
    ".rwa-pb:hover{background:var(--accent);border-color:var(--primary);}" +
    ".rwa-auto{display:flex;align-items:center;gap:6px;width:100%;background:color-mix(in srgb,var(--primary) 12%,transparent);border:1px solid color-mix(in srgb,var(--primary) 32%,transparent);border-radius:8px;padding:8px 12px;color:var(--primary);font:600 11.5px/1 inherit;cursor:pointer;text-align:left;overflow:hidden;transition:background .12s;}" +
    ".rwa-auto:hover{background:color-mix(in srgb,var(--primary) 18%,transparent);}" +
    ".rwa-auto svg{width:14px;height:14px;flex-shrink:0;}" +
    ".rwa-btn{display:inline-flex;align-items:center;justify-content:center;height:26px;box-sizing:border-box;" +
    "background:var(--secondary);border:1px solid var(--border);color:var(--foreground);padding:0 12px;" +
    "border-radius:8px;font:600 11px/1 inherit;cursor:pointer;white-space:nowrap;" +
    "transition:all .15s;}" +
    ".rwa-sq{width:26px;padding:0;flex:0 0 auto;color:var(--muted-foreground);}" +
    ".rwa-btn:hover{background:var(--accent);border-color:var(--primary);}" +
    ".rwa-btn:disabled{opacity:.35;cursor:not-allowed;}" +
    ".rwa-btn svg{width:15px;height:15px;display:block;}" +
    ".rwa-btn-sm{height:26px;padding:0 10px;font-size:11px;display:inline-flex;align-items:center;gap:5px;line-height:1;}" +
    ".rwa-btn-sm svg{width:13px;height:13px;}" +
    ".rwa-accept{background:var(--primary)!important;color:var(--primary-foreground)!important;border-color:transparent!important;font-weight:600;}" +
    ".rwa-accept:hover{filter:brightness(1.1);}" +
    ".rwa-dng{color:var(--destructive)!important;}" +
    ".rwa-ibtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:0 0 auto;padding:0;background:transparent;border:1px solid transparent;border-radius:8px;color:var(--muted-foreground);cursor:pointer;transition:background .12s,color .12s;}" +
    ".rwa-ibtn:hover{background:var(--accent);color:var(--foreground);}" +
    ".rwa-ibtn.rwa-dng:hover{color:var(--destructive)!important;}" +
    ".rwa-ibtn svg{width:15px;height:15px;}" +
    ".rwa-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}" +
    ".rwa-foot{display:flex;gap:6px;border-top:1px solid var(--border);padding-top:10px;margin-top:0;}" +
    ".rwa-slider-row{display:flex;align-items:center;gap:8px;padding:10px 0 0;" +
    "border-top:1px solid var(--border);margin-top:0;transition:opacity .15s;}" +
    ".rwa-slider-lbl{font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;" +
    "color:var(--muted-foreground);white-space:nowrap;}" +
    ".rwa-slider-val{font-size:10px;font-weight:700;color:var(--primary);min-width:38px;text-align:right;cursor:text;}" +
    ".rwa-len-inp{width:54px;font:700 10px/1 inherit;color:var(--primary);background:var(--secondary);border:1px solid var(--primary);border-radius:5px;padding:2px 4px;text-align:right;outline:none;-moz-appearance:textfield;box-sizing:border-box;}" +
    ".rwa-len-inp::-webkit-inner-spin-button,.rwa-len-inp::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;}" +
    ".rwa-range{flex:1;accent-color:var(--primary);cursor:pointer;height:3px;}" +
    ".rwa-toggle-wrap{position:relative;display:inline-block;width:36px;height:20px;flex-shrink:0;cursor:pointer;}" +
    ".rwa-toggle-wrap input{opacity:0;width:0;height:0;position:absolute;}" +
    ".rwa-toggle-sl{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;" +
    "background:color-mix(in srgb,var(--muted) 60%,var(--muted-foreground) 20%);border-radius:20px;transition:background .2s;}" +
    ".rwa-toggle-sl:before{content:'';position:absolute;height:14px;width:14px;" +
    "left:3px;bottom:3px;background:var(--muted-foreground);border-radius:50%;transition:transform .2s,background .2s;}" +
    ".rwa-toggle-wrap input:checked+.rwa-toggle-sl{background:color-mix(in srgb,var(--primary) 35%,transparent);}" +
    ".rwa-toggle-wrap input:checked+.rwa-toggle-sl:before{transform:translateX(16px);background:var(--primary);}" +
    ".rwa-tip{position:fixed;background:var(--popover);border:1px solid var(--border);" +
    "border-radius:8px;padding:6px 10px;font-size:11px;line-height:1.5;" +
    "color:var(--foreground);max-width:260px;white-space:normal;" +
    "box-shadow:0 8px 24px rgba(0,0,0,.5);z-index:10010;pointer-events:none;" +
    "opacity:0;transition:opacity .12s;}" +
    ".rwa-tip-show{opacity:1!important;}" +
    ".rwa-ov{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.72);" +
    "backdrop-filter:blur(8px);z-index:10001;display:flex;align-items:center;justify-content:center;" +
    "animation:rwa-fade .18s ease-out;}" +
    "@keyframes rwa-fade{from{opacity:0}to{opacity:1}}" +
    ".rwa-win{background:var(--popover);border:1px solid var(--border);border-radius:12px;" +
    "width:560px;max-width:95vw;max-height:88vh;box-shadow:0 28px 56px rgba(0,0,0,.8);" +
    "display:flex;flex-direction:column;overflow:hidden;animation:rwa-up .18s cubic-bezier(.22,1,.36,1);}" +
    "@keyframes rwa-up{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}" +
    ".rwa-bar{height:2px;background:var(--primary);opacity:.5;}" +
    ".rwa-hdr{padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;" +
    "justify-content:space-between;background:var(--secondary);}" +
    ".rwa-title{font-size:13.5px;font-weight:600;color:var(--foreground);}" +
    ".rwa-body{padding:16px;overflow-y:auto;flex:1;}" +
    ".rwa-prev{background:var(--secondary);border:1px solid var(--border);border-radius:8px;" +
    "padding:12px;font-size:12px;line-height:1.6;max-height:200px;overflow-y:auto;white-space:pre-wrap;color:var(--foreground);}" +
    ".rwa-plbl{font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;" +
    "color:var(--muted-foreground);margin-bottom:6px;}" +
    ".rwa-wc{font-size:9px;color:var(--muted-foreground);text-align:right;margin-top:4px;}" +
    ".rwa-err{padding:12px;font-size:11px;color:var(--destructive);line-height:1.6;white-space:pre-wrap;}" +
    ".rwa-inp{background:var(--secondary);border:1px solid var(--border);color:var(--foreground);" +
    "padding:8px 12px;border-radius:8px;width:100%;margin-bottom:12px;" +
    "font:13px/1.4 inherit;box-sizing:border-box;outline:none;transition:border-color .12s;}" +
    ".rwa-inp:focus{border-color:var(--primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--ring) 22%,transparent);}" +
    ".rwa-sel{-webkit-appearance:none;appearance:none;background:var(--secondary);" +
    "border:1px solid var(--border);padding:8px 32px 8px 12px;border-radius:8px;color:var(--foreground);" +
    "font-size:12px;outline:none;cursor:pointer;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23b57edc' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\");" +
    "background-repeat:no-repeat;background-position:right 12px center;transition:border-color .12s;}" +
    ".rwa-sel:focus{border-color:var(--primary);}" +
    ".rwa-lbl{display:block;font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;" +
    "color:var(--muted-foreground);margin:16px 0 8px;}" +
    ".rwa-sep{height:1px;background:var(--border);margin:16px 0;}" +
    ".rwa-item{display:flex;align-items:center;gap:8px;padding:8px 12px;" +
    "border-radius:8px;border:1px solid var(--border);background:var(--secondary);" +
    "margin-bottom:6px;cursor:grab;transition:all .15s;}" +
    ".rwa-item:hover{border-color:var(--primary);}" +
    ".rwa-item.rwa-drag{opacity:.3;}.rwa-item.rwa-over{border-color:var(--primary);border-style:dashed;}" +
    ".rwa-hnd{color:var(--muted-foreground);display:inline-flex;user-select:none;cursor:grab;}" +
    ".rwa-hnd svg{width:14px;height:14px;display:block;}" +
    ".rwa-pulse{height:2px;background:var(--primary);border-radius:2px;" +
    "transform-origin:center;animation:rwa-pls 1.4s ease-in-out infinite;}" +
    "@keyframes rwa-pls{0%,100%{opacity:.3;transform:scaleX(.45)}50%{opacity:1;transform:scaleX(1)}}" +
    ".rwa-shimmer{position:relative;overflow:hidden;}" +
    ".rwa-shimmer::after{content:'';position:absolute;top:0;left:-100%;width:200%;height:100%;" +
    "background:linear-gradient(90deg,transparent 0%,color-mix(in srgb,var(--primary) 10%,transparent) 50%,transparent 100%);" +
    "animation:rwa-shim 1.8s linear infinite;pointer-events:none;}" +
    "@keyframes rwa-shim{from{left:-100%}to{left:100%}}" +
    ".rwa-toast{position:fixed;background:var(--primary);color:var(--primary-foreground);" +
    "padding:8px 16px;border-radius:8px;font:700 12px/1.4 inherit;" +
    "box-shadow:0 4px 20px rgba(0,0,0,.5);z-index:20000;pointer-events:none;" +
    "transition:opacity .4s ease;max-width:320px;text-align:center;}" +
    ".rwa-toast-ok{background:linear-gradient(135deg,#10b981,#14b8a6)!important;color:#fff!important;}" +
    ".rwa-hist{background:var(--secondary);border:1px solid var(--border);" +
    "border-radius:8px;padding:8px 12px;margin-bottom:6px;}" +
    ".rwa-badge{display:inline-block;font-size:9px;font-weight:600;background:var(--primary);" +
    "color:var(--primary-foreground);padding:2px 8px;border-radius:999px;margin-bottom:4px;}" +
    ".rwa-setting-row{display:flex;align-items:center;gap:12px;margin-bottom:9px;font-size:12px;color:var(--foreground);}" +
    ".rwa-setting-row>span{flex:1;}" +
    ".rwa-row-lbl{flex:1;min-width:0;}" +
    ".rwa-row-title{font-size:12px;color:var(--foreground);}" +
    ".rwa-row-help{font-size:10px;color:var(--muted-foreground);line-height:1.4;margin-top:2px;}" +
    ".rwa-dep{margin-left:13px;border-left:1px solid var(--border);padding-left:11px;}" +
    ".rwa-grp{font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted-foreground);margin:14px 0 9px;padding-top:13px;border-top:1px solid var(--border);}" +
    ".rwa-grp-first{border-top:0;padding-top:0;margin-top:2px;}" +
    ".rwa-split{display:flex;height:440px;max-height:72vh;}" +
    ".rwa-nav{width:158px;flex-shrink:0;border-right:1px solid var(--border);padding:8px;display:flex;flex-direction:column;gap:4px;overflow-y:auto;}" +
    ".rwa-nav-item{padding:8px 12px;border-radius:8px;font-size:12.5px;color:var(--muted-foreground);cursor:pointer;user-select:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .12s,color .12s;}" +
    ".rwa-nav-item:hover{background:color-mix(in srgb,var(--accent) 55%,transparent);color:var(--foreground);}" +
    ".rwa-nav-active{background:color-mix(in srgb,var(--primary) 14%,transparent)!important;color:var(--primary)!important;font-weight:600;}" +
    ".rwa-pane{flex:1;min-width:0;padding:16px;overflow-y:auto;}" +
    ".rwa-pane-title{font-size:13px;font-weight:600;color:var(--foreground);margin-bottom:4px;}" +
    ".rwa-pane-desc{font-size:11.5px;color:var(--muted-foreground);margin-bottom:16px;line-height:1.5;}" +
    ".rwa-card{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--secondary);border-radius:8px;margin-bottom:6px;border:1px solid var(--border);}" +
    ".rwa-char-list{max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:12px;background:var(--secondary);}" +
    ".rwa-subtitle{font-size:11px;color:var(--muted-foreground);margin-top:2px;}" +
    ".rwa-foot-note{padding:12px 16px;border-top:1px solid var(--border);font-size:10.5px;color:var(--muted-foreground);}" +
    "@media(max-width:560px){.rwa-split{flex-direction:column;height:auto;}.rwa-nav{width:auto;flex-direction:row;flex-wrap:wrap;border-right:0;border-bottom:1px solid var(--border);}}"+
    ".rwa ::-webkit-scrollbar{width:6px;}" +
    ".rwa ::-webkit-scrollbar-track{background:transparent;}" +
    ".rwa ::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--muted-foreground) 28%,transparent);border-radius:3px;}" +
    ".rwa ::-webkit-scrollbar-thumb:hover{background:var(--primary);}" +
    ".rwa-win ::-webkit-scrollbar{width:6px;}" +
    ".rwa-win ::-webkit-scrollbar-track{background:transparent;}" +
    ".rwa-win ::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--muted-foreground) 28%,transparent);border-radius:3px;}" +
    ".rwa-win ::-webkit-scrollbar-thumb:hover{background:var(--primary);}"

  );

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
  // ── Inference: route to local sidecar or a direct OpenAI-compatible endpoint ─
  // Resolves to { result: string } or { error: string } so callers stay identical.
  function runInference(systemPrompt, userPrompt, signal) {
    var mode = (cfg.connMode === "direct" || cfg.connMode === "extender") ? cfg.connMode : "sidecar";
    var started = Date.now();
    var p;
    if (mode === "sidecar") {
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
      var segs = (sel.segments && sel.segments.length) ? sel.segments : [{ mid: sel.mid, text: sel.text, occ: sel.occ || 0 }];
      queue = { segments: segs, index: 0 };
    }
    var seg = queue.segments[queue.index];
    var total = queue.segments.length;
    var savedSel = { text: seg.text, mid: seg.mid, cid: sel.cid, occ: seg.occ || 0 };
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

        // Order: speaker first, then card -> memory -> persona -> lore -> local -> prev.
        var ctxBlock = (speakerCtx + cardCtx + memCtx + personaCtx + loreCtx + localCtx + prevCtx).replace(/^\n+/, "");
        logDbg("rewrite.assemble", {
          profile: profile.name, profileId: profile.id, selChars: savedSel.text.length,
          lengthNote: lengthNote || null,
          ctxChars: { speaker: speakerCtx.length, character: cardCtx.length, memory: memCtx.length, persona: personaCtx.length, lore: loreCtx.length, surrounding: localCtx.length, prevMessages: prevCtx.length },
          ctxEnabled: { charCard: !!cfg.useCharCard, userPersona: !!cfg.useUserPersona, lorebook: !!cfg.useLorebookEntries, surrounding: !!cfg.localContextEnabled, prevMessages: !!cfg.usePrevMessages, extenderMemory: !!cfg.useExtenderMemory, speakerAware: !!cfg.speakerAware },
        });
        var userPrompt =
          (ctxBlock ? ctxBlock + "\n\n" : "") +
          "Task: " + profile.prompt + lengthNote +
          "\n\nRewrite only the text inside <rewrite_this>. Output the rewritten passage and nothing else.\n" +
          "<rewrite_this>\n" + safeText + "\n</rewrite_this>";

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
          var hint = cfg.connMode === "direct"
            ? "Check Settings \u2192 Connection \u2014 API URL and model name must point to a running server."
            : cfg.connMode === "extender"
            ? "Check Settings \u2192 Connection \u2014 Extender server URL must point to a running Marinara Extender."
            : "Check Settings \u2192 AI Models \u2014 a local model must be loaded.";
          showModalErr(ov, body,
            (cfg.connMode === "direct" ? "Direct API error: " : cfg.connMode === "extender" ? "Extender error: " : "Sidecar error: ") + resp.error +
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
      ? "<context note=\"Surrounding sections — reference only, do not rewrite.\">\n" + parts.join("\n\n") + "\n</context>"
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
        "<rewrite_this>\n" + sl.text + "\n</rewrite_this>";
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
      doCommit(assembled, { text: ledger.orig, mid: ledger.mid, cid: ledger.cid, occ: ledger.occ || 0 }, function () {
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
        // Order: speaker first, then card -> memory -> persona -> lore -> local -> prev.
        var ctxBlock = (speakerCtxM + cardCtxM + memCtxM + personaCtxM + loreCtxM + localCtxMerge + prevCtxM).replace(/^\n+/, "");
        var markerNote = "\n\nThe passage contains " + (segments.length - 1) +
          " markers like [[SECTION 2]], [[SECTION 3]] that separate parts which belong to different messages. " +
          "Keep every [[SECTION n]] marker exactly as written, on its own line, in the same order. Do not add, remove, renumber, or move them.";
        var userPrompt =
          (ctxBlock ? ctxBlock + "\n\n" : "") +
          "Task: " + profile.prompt + lengthNote + markerNote +
          "\n\nRewrite only the text inside <rewrite_this>, preserving the [[SECTION n]] markers. Output the rewritten passage and nothing else.\n" +
          "<rewrite_this>\n" + safeMerged + "\n</rewrite_this>";
        logDbg("rewrite.merge.request", { messages: segments.length, mergedChars: merged.length });
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

  function applyMerged(segments, pieces, cid, i, onDone) {
    if (i >= segments.length) { if (onDone) onDone(); return; }
    doCommit(pieces[i], { text: segments[i].text, mid: segments[i].mid, cid: cid }, function () {
      // N8 fix: invalidate the message cache before recursing to the next segment.
      // doCommit already invalidates after its own match, but in chained auto-apply
      // the next call to doCommit may re-read the cached (pre-edit) content before
      // Marinara's store update flushes. Invalidating here ensures each chained
      // commit reads fresh data from the API rather than the stale cached baseline.
      invalidateMsgCache();
      applyMerged(segments, pieces, cid, i + 1, onDone);
    });
  }

  function showMergePreview(ov, body, profile, segments, pieces, cid) {
    if (cfg.autoApply) {
      ov.remove();
      applyMerged(segments, pieces, cid, 0, function () { showToast(null, "✓ Applied to " + segments.length + " messages", "ok"); });
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
      applyMerged(segments, pieces, cid, 0, function () { ov.remove(); showToast(null, "✓ Applied to " + segments.length + " messages", "ok"); });
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
  function doCommit(newText, savedSel, onDone) {
    var mid = savedSel.mid;
    var cid = savedSel.cid || getChatId();
    if (!cid) {
      showErr("Cannot detect active chat ID.\nTry clicking the chat in the sidebar first.");
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
          .catch(function (e) {
            showErr("Save failed:\n" + (e && e.message ? e.message : String(e)));
          });
      })
      .catch(function (e) {
        showErr("Commit failed:\n" + (e && e.message ? e.message : String(e)));
      });
  }


  // ── Undo ──────────────────────────────────────────────────────────────────
  function doUndo() {
    if (!hist.length) return;
    var h = hist[0];
    var depth = Math.max(1, Math.min(20, cfg.historyDepth || 5));
    invalidateMsgCache();
    patchMessage(h.cid || getChatId(), h.mid, h.old)
      .then(function () {
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
    invalidateMsgCache();
    patchMessage(r.cid || getChatId(), r.mid, r.post)
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
  function exportProfiles(opts) {
    opts = opts || { profiles: true, config: true, customs: true, autoProfs: true };
    var data = { type: "rwa-profiles-export", version: 1 };
    var picked = [];
    if (opts.profiles)  { data.profiles = profiles;        picked.push("profiles"); }
    if (opts.config)    { var safeCfg = {}; Object.keys(cfg).forEach(function (k) { if (k !== "apiKey") safeCfg[k] = cfg[k]; }); data.config = safeCfg; picked.push("settings"); }
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

          // profiles/customs: must be arrays; entries must be objects with string
          // id, name, prompt (the three required profile fields).
          function validProfileEntry(e) {
            return e && typeof e === "object" && !Array.isArray(e) &&
                   typeof e.id === "string" && typeof e.name === "string" && typeof e.prompt === "string";
          }
          if (Array.isArray(data.profiles)) {
            var before = data.profiles.length;
            profiles = data.profiles.filter(validProfileEntry);
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
          var msg = dropped > 0
            ? "Imported (" + dropped + " malformed " + (dropped === 1 ? "entry" : "entries") + " dropped)"
            : "Imported!";
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
        [["sidecar", "Local Sidecar (default)"], ["direct", "Direct API (Ollama / llama.cpp)"], ["extender", "Marinara Extender (one sidecar)"]].forEach(function (opt) {
          var o = mk("option", "", opt[1]); o.value = opt[0];
          if ((cfg.connMode || "sidecar") === opt[0]) o.selected = true;
          modeSel.appendChild(o);
        });
        row(db, "Model source", modeSel, "Direct API skips the Marinara sidecar, so Ollama won’t load a second model.");

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

        // Loader: remote auto-update opt-in.
        // Written directly to localStorage (not cfg) because the loader bundle
        // reads this key standalone before extension.js is loaded.
        grp(db, "Loader");
        var remoteOn = (function () { try { return localStorage.getItem("rwa-loader-allow-remote") === "1"; } catch (e) { return false; } })();
        row(db, "Allow remote auto-update (loader)",
          ck(remoteOn, function (e) {
            try { localStorage.setItem("rwa-loader-allow-remote", e.target.checked ? "1" : "0"); } catch (err) {}
          }),
          "Fetches extension code from GitHub on each Marinara load (falls back after local sidecar fails). ⚠️ Runs remote code — only enable if you trust the configured GitHub URL."
        );
        var loaderNote = mk("div", "", "Off by default. When off, only the local Extender sidecar and the last-cached copy are used. Change the REMOTE URL in loader.js to point at your own repo before enabling.");
        loaderNote.style.cssText = "font-size:10px;color:var(--muted-foreground);margin-top:4px;line-height:1.5;";
        ap(db, loaderNote);
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
          "Drop the rewrite into the message editor so you confirm and save it yourself (Ctrl+Enter).");
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
      if (t && t.length >= 2) segs.push({ mid: order[k], text: t, occ: selectionOccurrence(range, order[k], t) });
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

