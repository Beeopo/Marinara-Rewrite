// Rewrite Assistant — auto-update loader.
//
// Import this ONCE into Marinara → Settings → Extensions (instead of the full
// rewrite-assistant.json). On every Marinara load it fetches the latest
// extension code and runs it, so updates never need re-importing — just reload
// Marinara.
//
// Source order (hybrid):
//   1. the local Marinara Extender sidecar (your working build — no push needed),
//   2. GitHub raw (only when the user opts in — see allowRemote() below),
//   3. the last-good copy cached in localStorage (offline).
//
// Marinara's CSP allows blob: scripts but NOT eval/new Function, so the fetched
// code is run via a blob <script>, with the scoped `marinara` API bridged in
// through a temporary global. extension.js self-invokes with `marinara`; the
// wrapper's param makes that inner invocation resolve to the bridged API.
(function (marinara) {
  "use strict";
  var LOCAL  = "http://127.0.0.1:3001/rewrite-assistant.js";   // Extender sidecar (serves the local build)

  // REMOTE points at TCLowe1982's repo and pulls `main` HEAD unpinned —
  // you should change it to YOUR OWN repo and ideally a pinned tag/commit
  // before enabling remote; it is OFF by default for this reason.
  var REMOTE = "https://raw.githubusercontent.com/TCLowe1982/Marinara-Rewrite/main/extension.js";

  var CACHE  = "rwa-loader-cache-v4";

  function run(code, source) {
    try { localStorage.setItem(CACHE, code); } catch (e) {}
    window.__rwaMarinara = marinara;
    var wrapped = "(function(marinara){\n" + code + "\n})(window.__rwaMarinara);";
    var url = URL.createObjectURL(new Blob([wrapped], { type: "text/javascript" }));
    var s = document.createElement("script");
    s.src = url;
    s.onload = function () { URL.revokeObjectURL(url); };
    document.head.appendChild(s);
    if (marinara.onCleanup) marinara.onCleanup(function () { s.remove(); });
    try { console.log("[Rewrite Assistant] loaded from " + source); } catch (e) {}
  }

  function pull(url) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, 5000);
    return fetch(url + (url.indexOf("?") === -1 ? "?" : "&") + "ts=" + Date.now(), { signal: ctrl.signal })
      .then(function (r) { clearTimeout(t); if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .catch(function (e) { clearTimeout(t); throw e; });
  }

  function allowRemote() { try { return localStorage.getItem("rwa-loader-allow-remote") === "1"; } catch (e) { return false; } }

  function offlineBanner() {
    try {
      var id = "rwa-loader-offline";
      if (document.getElementById(id)) return;
      var b = document.createElement("div");
      b.id = id;
      b.textContent = "Rewrite Assistant: couldn't load (Extender sidecar offline and remote auto-update is disabled or unavailable). Start the sidecar or enable remote in Settings → Connection, then reload Marinara.";
      b.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483647;max-width:340px;background:#3f1414;color:#fecaca;border:1px solid #f87171;border-radius:8px;padding:10px 14px;font:13px system-ui,-apple-system,sans-serif;line-height:1.4;box-shadow:0 2px 12px rgba(0,0,0,.4)";
      document.body.appendChild(b);
      if (marinara.onCleanup) marinara.onCleanup(function () { b.remove(); });
      setTimeout(function () { b.remove(); }, 15000);
    } catch (e) {}
  }

  // local sidecar → GitHub (opt-in only) → cache
  pull(LOCAL)
    .then(function (code) { run(code, "Extender sidecar"); })
    .catch(function () {
      if (allowRemote()) return pull(REMOTE).then(function (code) { run(code, "GitHub"); });
      throw new Error("remote disabled");
    })
    .catch(function () {
      var cached = null; try { cached = localStorage.getItem(CACHE); } catch (e) {}
      if (cached) run(cached, "cache (offline)"); else offlineBanner();
    });
})(marinara);
