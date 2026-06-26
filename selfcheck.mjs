// Runnable check for the two bits of non-trivial logic I added:
// 1) URL normalization  2) direct-mode response shaping
import assert from "node:assert";

// 1) URL normalization (mirror of runInference's base handling)
const norm = (u) => (u||"").trim().replace(/\/+$/,"").replace(/\/chat\/completions$/,"") + "/chat/completions";
assert.equal(norm("http://127.0.0.1:11434/v1"), "http://127.0.0.1:11434/v1/chat/completions");
assert.equal(norm("http://127.0.0.1:11434/v1/"), "http://127.0.0.1:11434/v1/chat/completions");
assert.equal(norm("http://127.0.0.1:11434/v1/chat/completions"), "http://127.0.0.1:11434/v1/chat/completions"); // no double path

// 2) response shaping (mirror of runInference's .then)
const shape = (status, j) => {
  j = j || {};
  if (j.error) return { error: j.error.message || j.error.type || JSON.stringify(j.error) };
  if (!status || status >= 400) return { error: "HTTP " + status };
  const msg = j.choices && j.choices[0] && j.choices[0].message;
  return { result: msg && typeof msg.content === "string" ? msg.content : "" };
};
assert.equal(shape(200, {choices:[{message:{content:"hi"}}]}).result, "hi");
assert.equal(shape(200, {error:{message:"bad model"}}).error, "bad model");
assert.equal(shape(404, {}).error, "HTTP 404");
assert.equal(shape(200, {}).result, ""); // empty/malformed -> empty string, not crash
console.log("selfcheck: all assertions passed");

// 3) length-control: percentage -> explicit word-count range (mirror of doRewrite)
const lenNote = (ow, pct) => {
  const target = Math.max(1, Math.round(ow * (1 + pct / 100)));
  const lo = Math.max(1, Math.round(target * 0.85)), hi = Math.round(target * 1.15);
  return { target, lo, hi };
};
let r = lenNote(100, 50);   assert.equal(r.target, 150); assert.ok(r.lo < 150 && r.hi > 150); // +50% -> ~150
r = lenNote(100, -40);      assert.equal(r.target, 60);  // -40% -> 60 words
r = lenNote(3, -90);        assert.equal(r.target, 1);   // never below 1 word
console.log("selfcheck: length-control assertions passed");

// 4) assembly order: context blocks precede the fenced target, target is last
const assemble = (ctx, task, text) =>
  (ctx ? ctx + "\n\n" : "") + "Task: " + task +
  "\n\nRewrite only the text inside <rewrite_this>. Output the rewritten passage and nothing else.\n" +
  "<rewrite_this>\n" + text + "\n</rewrite_this>";
const out = assemble("<character>voice</character>", "Expand.", "the span");
assert.ok(out.indexOf("<character>") < out.indexOf("Task:"));            // context before task
assert.ok(out.indexOf("Task:") < out.indexOf("<rewrite_this>"));         // task before target
assert.ok(out.trim().endsWith("</rewrite_this>"));                       // target is last
console.log("selfcheck: assembly-order assertions passed");

// 5) debug ring buffer: never exceeds 100 entries (mirror of logDbg cap)
let dbg = [];
const push = (e) => { dbg.push(e); if (dbg.length > 100) dbg.splice(0, dbg.length - 100); };
for (let i = 0; i < 250; i++) push({ i });
assert.equal(dbg.length, 100);
assert.equal(dbg[0].i, 150);          // oldest dropped, newest kept
assert.equal(dbg[99].i, 249);
// ── Drift guards: the shipped source must still contain the fixes ──
import { readFileSync as _rf } from "node:fs";
const _SRC = _rf(new URL("./extension.js", import.meta.url), "utf8");
assert.ok(_SRC.includes('(msg.content || "")'), "drift: null-guard on msg.content missing");
assert.ok(!/data\.config = cfg\b/.test(_SRC), "drift: export assigns raw cfg (apiKey leak)");
assert.ok(_SRC.includes("seqOk"), "drift: merge marker ordering (seqOk) missing");
// Phase 1-5 drift guards
assert.ok(_SRC.includes("function nthIndexOf"), "drift: nthIndexOf missing");
assert.ok(_SRC.includes("function patchMessage"), "drift: patchMessage (v2 PATCH commit) missing");
assert.ok(/method:\s*"PATCH"/.test(_SRC), "drift: PATCH method missing");
assert.ok(_SRC.includes("function renderedTextForMid"), "drift: renderedTextForMid missing");
assert.ok(_SRC.includes("function mapRenderedSpanToRaw"), "drift: mapRenderedSpanToRaw missing");
assert.ok(_SRC.includes("function doRedo"), "drift: doRedo missing");
assert.ok(_SRC.includes('connMode === "extender"'), "drift: extender branch missing");
assert.ok(_SRC.includes("_autoInFlight"), "drift: _autoInFlight guard missing");
assert.ok(_SRC.includes("selectionOccurrence"), "drift: selectionOccurrence missing");
assert.ok(_SRC.includes("fetchExtenderMemory"), "drift: fetchExtenderMemory missing");
assert.ok(_SRC.includes("fetchSpeakerNote"), "drift: fetchSpeakerNote missing");
const _LOADER = _rf(new URL("./loader.js", import.meta.url), "utf8");
assert.ok(_LOADER.includes("allowRemote"), "drift: loader.js allowRemote gate missing");
console.log("drift-guard assertions passed");
console.log("selfcheck: debug-buffer assertions passed");

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
