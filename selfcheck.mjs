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
assert.ok(_SRC.includes("PATCH did not return an updated message"), "drift: PATCH success-shape check missing (failed write must reject)");
assert.ok(_SRC.includes("function renderedTextForMid"), "drift: renderedTextForMid missing");
assert.ok(_SRC.includes("function refreshMessages"), "drift: refreshMessages (post-PATCH view refresh) missing");
assert.ok(_SRC.includes("function mapRenderedSpanToRaw"), "drift: mapRenderedSpanToRaw missing");
assert.ok(_SRC.includes("function alignExact"), "drift: alignExact (exact LCS core) missing");
assert.ok(_SRC.includes("function findCleanAnchor"), "drift: findCleanAnchor (windowing peg) missing");
assert.ok(_SRC.includes("function normForAnchor"), "drift: normForAnchor (quote-normalized anchoring) missing");
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

// 6) render<->raw span alignment + NON-CORRUPTION (mirror of alignExact)
function _alignExact(R, A, rs, re) {
  // <<< keep this mirror IDENTICAL in logic to extension.js's alignExact >>>
  const n = R.length, m = A.length;
  if (!n || !m || n * m > 4000000) return null;
  if (rs < 0 || re > n || re < rs) return null;
  let i, j, k, c;
  const dp = [];
  for (i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
  for (i = n - 1; i >= 0; i--)
    for (j = m - 1; j >= 0; j--)
      dp[i][j] = (R.charCodeAt(i) === A.charCodeAt(j))
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
  // Backtrace: mr[i] = matched raw index for rendered char i, or -1 (rendered-only).
  // matchedRaw[j] = 1 if raw char j is an LCS match (else raw-only / transform char).
  const mr = new Int32Array(n);
  for (k = 0; k < n; k++) mr[k] = -1;
  const matchedRaw = new Uint8Array(m);
  let i2 = 0, j2 = 0;
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
  let changed = true;
  while (changed) {
    changed = false;
    for (k = 0; k < n; k++) {
      const rj = mr[k];
      if (rj < 0) continue;
      const leftRO = (rj > 0) && !matchedRaw[rj - 1];
      const rightRO = (rj < m - 1) && !matchedRaw[rj + 1];
      if (leftRO && rightRO) { mr[k] = -1; matchedRaw[rj] = 0; changed = true; }
    }
  }
  // Compute raw cut points from the nearest real anchors.
  let as, ae, x, pm, nm;
  if (rs >= n) { as = m; }
  else if (mr[rs] >= 0) { as = mr[rs]; }
  else {
    pm = -1;
    for (x = rs - 1; x >= 0; x--) { if (mr[x] >= 0) { pm = x; break; } }
    as = (pm >= 0) ? mr[pm] + 1 : 0;
  }
  if (re <= 0) { ae = 0; }
  else if (mr[re - 1] >= 0) { ae = mr[re - 1] + 1; }
  else {
    nm = -1;
    for (x = re; x < n; x++) { if (mr[x] >= 0) { nm = x; break; } }
    ae = (nm >= 0) ? mr[nm] : m;
  }
  if (ae < as) return null;
  // If the selection touches a transform, snap each edge OUTWARD so no raw-only
  // token is bisected.
  let touchesTransform = false;
  for (k = rs; k < re; k++) { if (mr[k] < 0) { touchesTransform = true; break; } }
  if (!touchesTransform) {
    for (c = as; c < ae; c++) { if (!matchedRaw[c]) { touchesTransform = true; break; } }
  }
  if (touchesTransform) {
    while (as > 0 && !matchedRaw[as - 1] && !matchedRaw[as]) as--;
    while (ae < m && !matchedRaw[ae] && ae > 0 && !matchedRaw[ae - 1]) ae++;
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
  const dirtyStart = as > 0 && as < m && !matchedRaw[as - 1] && !matchedRaw[as];
  const dirtyEnd = ae > 0 && ae < m && !matchedRaw[ae - 1] && !matchedRaw[ae];
  if (dirtyStart || dirtyEnd) return null;
  return { as, ae };
}
// mirror of extension.js findCleanAnchor
function _findCleanAnchor(R, A, pos, side, LEN, MAXSPAN) {
  const step = 8;
  for (let t = 0; t * step <= MAXSPAN; t++) {
    const p = side < 0 ? (pos - t * step - LEN) : (pos + t * step);
    if (p < 0 || p + LEN > R.length) continue;
    const cand = R.substring(p, p + LEN);
    const idx = A.indexOf(cand);
    if (idx < 0) continue;
    if (A.indexOf(cand, idx + 1) >= 0) continue;
    return { rPos: p, aPos: idx };
  }
  return null;
}
// mirror of extension.js normForAnchor
function _normForAnchor(s) { return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"); }
// mirror of extension.js mapRenderedSpanToRaw (windowed wrapper over _alignExact)
function _mapRenderedSpanToRaw(R, A, rs, re) {
  const n = R.length, m = A.length;
  if (!n || !m) return null;
  if (rs < 0 || re > n || re < rs) return null;
  if (n * m <= 4000000) return _alignExact(R, A, rs, re);
  const LEN = 40, MAXSPAN = 800;
  const Rn = _normForAnchor(R), An = _normForAnchor(A);
  const left = _findCleanAnchor(Rn, An, rs, -1, LEN, MAXSPAN);
  const right = _findCleanAnchor(Rn, An, re, 1, LEN, MAXSPAN);
  const wlo = left ? left.rPos : 0;
  const lo = left ? left.aPos : 0;
  const whi = right ? right.rPos + LEN : n;
  const hi = right ? right.aPos + LEN : m;
  if (wlo > rs || whi < re || lo >= hi || wlo >= whi) return null;
  if ((whi - wlo) * (hi - lo) > 4000000) return null;
  const loc = _alignExact(R.slice(wlo, whi), A.slice(lo, hi), rs - wlo, re - wlo);
  if (!loc) return null;
  return { as: lo + loc.as, ae: lo + loc.ae };
}
function _spl(R, A, rs, re, x) { const s = _mapRenderedSpanToRaw(R, A, rs, re); return s ? A.slice(0, s.as) + x + A.slice(s.ae) : null; }
// clean boundaries MUST splice exactly:
assert.equal(_spl("hello world", "hello world", 6, 11, "X"), "hello X");           // identity
assert.equal(_spl("a b c", "a b c", 2, 3, "X"), "a X c");                          // mid, identical
assert.equal(_spl("bold text", "**bold** text", 5, 9, "X"), "**bold** X");         // markdown stripped (suffix)
assert.equal(_spl("he said “hi”", 'he said "hi"', 9, 11, "X"), 'he said "X"');     // curly→straight quotes
assert.equal(_spl("Hi Alice!", "Hi {{char}}!", 0, 3, "X"), "X{{char}}!");          // clean prefix, macro after
assert.equal(_spl("Hi Alice!", "Hi {{char}}!", 8, 9, "X"), "Hi {{char}}X");        // clean suffix, macro before
// boundary INSIDE a transform region MUST NOT corrupt: null OR clean snap to whole token
const _s6 = _spl("Hi Alice!", "Hi {{char}}!", 3, 8, "X"); // whole expanded macro
assert.ok(_s6 === null || _s6 === "Hi X!", "macro whole-token: must snap clean or fall back; got: " + _s6);
const _s7 = _spl("Hi Alice!", "Hi {{char}}!", 3, 6, "X"); // sub-token "Ali"
assert.ok(_s7 === null || _s7 === "Hi X!", "macro sub-token: must snap clean or fall back; got: " + _s7);
// unanchorable large input (no shared runs) returns null -> copy fallback
assert.equal(_mapRenderedSpanToRaw("a".repeat(2001), "b".repeat(2001), 0, 1), null);
console.log("selfcheck: span-alignment assertions passed");

// 6b) LARGE-message windowing. A real roleplay message (~3k chars) makes the full
// O(n*m) matrix exceed the 4M cap, so the un-windowed aligner returns null and the
// rewrite falls back to manual copy (the v5.1 bug seen live: 3173x3161 = 10M). The
// windowed aligner must splice correctly while leaving the huge untouched regions
// byte-identical. Filler is varied (embedded indices) so 40-char anchor runs are unique.
function _filler(tag, count) {
  let s = "";
  for (let i = 0; i < count; i++)
    s += tag + i + ": the quick brown fox " + (i * 7) + " jumps over the lazy dog " + (i * 13) + ". ";
  return s;
}
{
  const pre = _filler("Pre", 40), post = _filler("Post", 40);
  const RAW = pre + ' She whispered *softly* to {{char}}, "hi" now. ' + post;
  const RND = pre + " She whispered softly to Alice, “hi” now. " + post; // italic stripped, macro expanded, quotes curled
  assert.ok(RAW.length * RND.length > 4000000, "large test not large enough: " + RAW.length * RND.length);
  // (a) clean word inside an italic span -> markers preserved, filler untouched
  const rsA = RND.indexOf("softly");
  const outA = _spl(RND, RAW, rsA, rsA + "softly".length, "MURMURED");
  assert.equal(outA, pre + ' She whispered *MURMURED* to {{char}}, "hi" now. ' + post, "large/clean-word splice");
  // (b) selection spanning a macro: never corrupt the message; filler stays intact
  const rsB = RND.indexOf("whispered softly to Alice");
  const outB = _spl(RND, RAW, rsB, rsB + "whispered softly to Alice".length, "X");
  assert.ok(outB === null || (outB.startsWith(pre) && outB.endsWith(post)), "large/macro-span: filler corrupted; got middle: " + (outB && outB.slice(pre.length, pre.length + 50)));
  console.log("selfcheck: large-message windowing assertions passed");
}
{
  // Quote-dense dialogue: curly quotes every few chars mean NO quote-free 40-char
  // anchor run exists near the selection. Without quote-normalization the anchor
  // search fails on every window (rendered “ != stored ") and the rewrite falls back
  // to copy; quote-normalized anchoring maps it. (Splice still aligns original text.)
  const u = (i) => "“Y" + i + ",” “N" + i + ",” ";
  const ur = (i) => '"Y' + i + ',\" "N' + i + ',\" ';
  let preR = "", preA = "", postR = "", postA = "";
  for (let i = 0; i < 100; i++) { preR += u(i); preA += ur(i); }
  for (let i = 100; i < 200; i++) { postR += u(i); postA += ur(i); }
  const RAW = preA + "He felt *afraid* then. " + postA;
  const RND = preR + "He felt afraid then. " + postR;
  assert.ok(RAW.length * RND.length > 4000000, "dialogue test not large enough: " + RAW.length * RND.length);
  const rs = RND.indexOf("afraid");
  const out = _spl(RND, RAW, rs, rs + "afraid".length, "<<X>>");
  assert.equal(out, preA + "He felt *<<X>>* then. " + postA, "dialogue/quote-dense splice (normalized anchoring)");
  console.log("selfcheck: dialogue quote-normalization assertions passed");
}
