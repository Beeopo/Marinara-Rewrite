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
// The balance check is what stops a macro's raw spelling being bisected when it
// shares a run with its own expansion. Guard both the function and both call sites —
// alignExact's, and the per-edge composition that alignExact never sees.
assert.ok(_SRC.includes("function spanIsBalanced"), "drift: spanIsBalanced (mid-token splice guard) missing");
assert.equal((_SRC.match(/if \(!spanIsBalanced\(/g) || []).length, 2,
  "drift: spanIsBalanced must gate BOTH alignExact and the per-edge composed span");
assert.ok(_SRC.includes("function findCleanAnchor"), "drift: findCleanAnchor (windowing peg) missing");
assert.ok(_SRC.includes("function normForAnchor"), "drift: normForAnchor (quote-normalized anchoring) missing");
assert.ok(_SRC.includes("function windowMap"), "drift: windowMap (per-edge large-selection mapping) missing");
assert.ok(_SRC.includes("function doRedo"), "drift: doRedo missing");
assert.ok(_SRC.includes('connMode === "extender"'), "drift: extender branch missing");
assert.ok(_SRC.includes("_autoInFlight"), "drift: _autoInFlight guard missing");
assert.ok(_SRC.includes("selectionOccurrence"), "drift: selectionOccurrence missing");
assert.ok(_SRC.includes("fetchExtenderMemory"), "drift: fetchExtenderMemory missing");
assert.ok(_SRC.includes("fetchSpeakerNote"), "drift: fetchSpeakerNote missing");
// v6.0: styles moved out of the removed marinara.addStyle bridge into extension.css,
// which the manifest ships in its own `css` field so the engine owns teardown.
// Match a real call, not the bare word — the shim's comments need to be able to
// name the removed helper without tripping this.
assert.ok(!/\baddStyle\s*\(/.test(_SRC), "drift: extension.js still calls addStyle(...) (removed in Marinara 2.4)");
const _CSS = _rf(new URL("./extension.css", import.meta.url), "utf8");
assert.ok(_CSS.includes(".rwa{"), "drift: extension.css missing the base .rwa rule");
// ".rwa-win{" not ".rwa-win " — the trailing-space form only ever matched the
// descendant-combinator scrollbar rules, so the base rule (background, border,
// width, shadow) could be deleted and this still passed, leaving all three modal
// surfaces unstyled with a green suite.
assert.ok(_CSS.includes(".rwa-win{"), "drift: extension.css missing the .rwa-win base rule");
assert.ok(_CSS.includes(".rwa-win ::-webkit-scrollbar"), "drift: extension.css missing the .rwa-win scrollbar rules");
// v6.0: Marinara 2.4's full-page host object dropped apiFetch/on/addStyle/extensionId.
// The shim rebuilds them so the 5.1 body needs no call-site changes.
assert.ok(/^\(function \(host\) \{/m.test(_SRC), "drift: IIFE parameter is not `host` (shim missing)");
assert.ok(_SRC.includes("var marinara = {"), "drift: compat shim object missing");
assert.ok(_SRC.includes('"x-marinara-csrf"'), "drift: apiFetch shim not sending the CSRF header");
assert.ok(_SRC.includes('fetch("/api" + path'), "drift: apiFetch shim not prefixing /api");
// Match the shim's OWN teardown, not the bare word: extension.js has three
// unrelated removeEventListener call sites (drag handling, a focus listener), so
// the bare-word form passed even with the shim's teardown deleted.
assert.ok(/target\.removeEventListener\(type, handler, options\)/.test(_SRC), "drift: on() shim not registering teardown");
// A body with no Content-Type makes the browser send text/plain; Fastify then hands
// the route a raw string and the zod schema rejects it before the handler runs. This
// silently broke the default sidecar mode once already.
assert.ok(/o\.body != null && !headers\.has\("Content-Type"\)/.test(_SRC), "drift: apiFetch no longer defaults Content-Type on a body");
// v6.0: the storage namespace is a fixed literal. Deriving it from the engine's
// extension id stranded the user's data on every re-import.
assert.ok(_SRC.includes("function adoptLegacyNamespace"), "drift: adoptLegacyNamespace missing");
assert.ok(_SRC.includes('var NS = "rwa-rewrite-assistant"'), "drift: storage namespace is not the fixed literal");
// Match a real use, not the bare word, so comments can still explain the history.
assert.ok(!/marinara\.extensionId\b|extensionId\s*:/.test(_SRC), "drift: extensionId is back (the id is regenerated on every import)");
assert.ok(/SUFFIXES = \[[^\]]*"-p"\]/.test(_SRC), "drift: the -p sentinel is no longer copied last (partial-copy would strand data)");
// Forbid READING or WRITING the loader's keys, not merely naming them — v6.0
// deliberately calls removeItem on them to reclaim the storage the loader left behind.
assert.ok(!/grp\(\w+, "Loader"\)/.test(_SRC), "drift: the Loader settings group is back (loader.js was deleted in v6.0)");
assert.ok(!/(?:get|set)Item\("rwa-loader-/.test(_SRC), "drift: something reads or writes a loader key again");
assert.ok(_SRC.includes('removeItem("rwa-loader-cache-v4")'), "drift: the loader's ~180KB source cache is no longer reclaimed");
// v6.0: build.mjs owns the manifest. Guard the two fields that decide whether the
// extension runs in the page or dies silently in the sandboxed Worker.
const _BUILD = _rf(new URL("./build.mjs", import.meta.url), "utf8");
assert.ok(_BUILD.includes('capabilities: ["full_page_access"]'), "drift: manifest does not request full_page_access");
assert.ok(_BUILD.includes('runtime: "client"'), "drift: manifest runtime is not client");
assert.ok(!/^\s*id:/m.test(_BUILD), "drift: manifest re-introduced an `id` field (not in the 2.4 schema)");
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
  if (!_spanIsBalanced(A.slice(as, ae))) return null;
  return { as, ae };
}
// mirror of extension.js spanIsBalanced
function _spanIsBalanced(s) {
  // <<< keep this mirror IDENTICAL in logic to extension.js's spanIsBalanced >>>
  if ((s.match(/\{\{/g) || []).length !== (s.match(/\}\}/g) || []).length) return false;
  if ((s.match(/\*/g) || []).length % 2) return false;
  if ((s.match(/`/g) || []).length % 2) return false;
  if ((s.match(/_/g) || []).length % 2) return false;
  return true;
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
// mirror of extension.js windowMap
function _windowMap(R, A, rs, re) {
  const n = R.length, m = A.length;
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
// mirror of extension.js mapRenderedSpanToRaw (windowed; large selections map per-edge)
function _mapRenderedSpanToRaw(R, A, rs, re) {
  const n = R.length, m = A.length;
  if (!n || !m) return null;
  if (rs < 0 || re > n || re < rs) return null;
  if (n * m <= 4000000) return _alignExact(R, A, rs, re);
  const whole = _windowMap(R, A, rs, re);
  if (whole) return whole;
  if (re - rs < 1) return null;
  const startSpan = _windowMap(R, A, rs, rs + 1);
  const endSpan = _windowMap(R, A, re - 1, re);
  if (!startSpan || !endSpan || endSpan.ae < startSpan.as) return null;
  if (!_spanIsBalanced(A.slice(startSpan.as, endSpan.ae))) return null;
  return { as: startSpan.as, ae: endSpan.ae };
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
// A macro whose expansion shares a run with its own raw spelling used to defeat the
// clean-edge test: "50" looks matched, the cut lands mid-token, and the splice leaves
// "50}}" behind as literal text the macro can never expand from again. Must REFUSE.
assert.equal(_spl("Hi PersonName50 there.", "Hi {{char50}} there.", 0, 11, "X"), null,
  "2-char incidental match inside a macro must refuse, not bisect");
assert.equal(_spl("Hi NameABC there.", "Hi {{charABC}} there.", 0, 8, "X"), null,
  "3-char incidental match inside a macro must refuse, not bisect");
// ...and refusing must NOT come at the cost of eating emphasis markers around short
// words. These are the common case (*no*, **hi**) and must still splice cleanly.
assert.equal(_spl("hey there", "**hey** there", 0, 3, "X"), "**X** there", "3-char word keeps its bold markers");
assert.equal(_spl("hi there", "*hi* there", 0, 2, "X"), "*X* there", "2-char word keeps its italic markers");
assert.equal(_spl("softly there", "*softly* there", 0, 6, "X"), "*X* there", "6-char word keeps its markers");
assert.equal(_spl("bold text", "**bold** text", 0, 4, "X"), "**X** text", "4-char word keeps its markers");
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
{
  // LARGE selection: when the SELECTION itself exceeds the ~4M cap it can't window as a
  // single slice (the bug behind the live "Could not map" on a big paragraph — selections
  // ≳1.9k chars returned null -> copy fallback). Its interior is replaced wholesale, so
  // each edge is mapped with its own tiny window. Edges clean here -> exact splice.
  const pre = _filler("Lp", 30), midSel = _filler("Lm", 60), post = _filler("Lq", 30);
  const RAW = pre + midSel + post;   // no transforms in this case: rendered == raw
  assert.ok(RAW.length * RAW.length > 4000000, "large-sel test not large enough");
  assert.ok(midSel.length > 1900, "selection not large enough to force edge-mapping: " + midSel.length);
  const out = _spl(RAW, RAW, pre.length, pre.length + midSel.length, "<<X>>");
  assert.equal(out, pre + "<<X>>" + post, "large-selection edge-mapped splice (clean edges)");
  // and with an italic that opens just before the selection and closes just after it:
  // the markers must be preserved around the replacement, not bisected.
  const RAW2 = pre + "*" + midSel + "*" + post;
  const RND2 = pre + midSel + post; // italic markers stripped in render
  const out2 = _spl(RND2, RAW2, pre.length, pre.length + midSel.length, "<<X>>");
  assert.equal(out2, pre + "*<<X>>*" + post, "large-selection edge-mapped splice (transform-straddled edges)");
  console.log("selfcheck: large-selection edge-mapping assertions passed");
}

// 7) legacy-namespace adoption. 5.x derived its namespace from the engine-generated
// extension id, which is minted fresh on every import, so each re-import stranded
// the previous data.
//
// These cases run the SHIPPED function, extracted from extension.js — not a hand-
// copied mirror. A mirror has to be kept identical by hand, and a review caught one
// faithfully reproducing a bug while eight assertions passed over it. The namespace
// and suffix list are read from the source too, so they cannot drift either.
const _NS = JSON.parse(_SRC.match(/var NS = ("[^"]*");/)[1]);
const _SUF = JSON.parse(_SRC.match(/var SUFFIXES = (\[[^\]]*\]);/)[1]);
assert.equal(_NS, "rwa-rewrite-assistant", "storage namespace changed unexpectedly");
assert.equal(_SUF[_SUF.length - 1], "-p", "the -p sentinel must be copied last");
const _ADOPT_SRC = _SRC.slice(
  _SRC.indexOf("function legacyRecency"),
  _SRC.indexOf("var _adoptedFrom = adoptLegacyNamespace();"),
);
assert.ok(_ADOPT_SRC.includes("function adoptLegacyNamespace"), "could not extract adoptLegacyNamespace from extension.js");
function _fakeLS(seed) {
  const m = { ...seed };
  return {
    get length() { return Object.keys(m).length; },
    key: (i) => Object.keys(m)[i] ?? null,
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    dump: () => m,
  };
}
const _adopt = (ls) =>
  new Function("localStorage", "NS", "SUFFIXES", _ADOPT_SRC + "\nreturn adoptLegacyNamespace();")(ls, _NS, _SUF);

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
// (f) a throw mid-copy (localStorage quota — a copy transiently doubles usage)
// must leave the "-p" sentinel UNSET so the next load retries. "-p" is last in
// _SUF for exactly this reason: written first, a partial copy would look like a
// completed adoption forever and strand every remaining suffix.
{
  const seed = {};
  for (const s of _SUF) seed["rwa-9f3c1a2b" + s] = "V" + s;
  const base = _fakeLS(seed);
  let writes = 0;
  const ls = {
    get length() { return base.length; },
    key: (i) => base.key(i),
    getItem: (k) => base.getItem(k),
    setItem: (k, v) => {
      if (++writes > 3) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
      base.setItem(k, v);
    },
    dump: () => base.dump(),
  };
  assert.equal(_adopt(ls), null, "a swallowed throw must report failure, not success");
  assert.equal(ls.getItem(_NS + "-p"), null, "sentinel must be unset so the next load retries");
  // retry on a healthy store completes the adoption
  const ls2 = _fakeLS(ls.dump());
  assert.equal(_adopt(ls2), "rwa-9f3c1a2b", "retry must find the legacy set again");
  for (const s of _SUF) assert.equal(ls2.getItem(_NS + s), "V" + s, "retry must copy " + s);
}
// (g) SEVERAL legacy namespaces — every 5.x re-import minted a new one, so a user
// who re-imported has one set per import. The most recently USED one must win, by
// history recency; picking the first or last enumerated would be a coin flip on
// implementation-defined localStorage ordering and could restore stale settings
// over current ones.
{
  const older = [{ when: 1000 }, { when: 900 }];
  const newer = [{ when: 5000 }, { when: 4000 }];
  const ls = _fakeLS({
    "rwa-OLD-p": "OLDPROFILES", "rwa-OLD-c": "oldcfg", "rwa-OLD-h": JSON.stringify(older),
    "rwa-NEW-p": "NEWPROFILES", "rwa-NEW-c": "newcfg", "rwa-NEW-h": JSON.stringify(newer),
  });
  assert.equal(_adopt(ls), "rwa-NEW", "the most recently used namespace must win");
  assert.equal(ls.getItem(_NS + "-c"), "newcfg", "must not restore the stale config");
  assert.equal(ls.getItem(_NS + "-p"), "NEWPROFILES");
}
// (h) insertion order must NOT decide it: same data, reversed key order, same answer.
{
  const older = [{ when: 1000 }], newer = [{ when: 5000 }];
  const mk = (first, second) => _fakeLS({
    [first + "-p"]: first, [first + "-h"]: JSON.stringify(first === "rwa-NEW" ? newer : older),
    [second + "-p"]: second, [second + "-h"]: JSON.stringify(second === "rwa-NEW" ? newer : older),
  });
  assert.equal(_adopt(mk("rwa-OLD", "rwa-NEW")), "rwa-NEW");
  assert.equal(_adopt(mk("rwa-NEW", "rwa-OLD")), "rwa-NEW", "result must not depend on enumeration order");
}
// (i) no history anywhere: still adopts something rather than giving up
{
  const ls = _fakeLS({ "rwa-A-p": "A", "rwa-B-p": "B" });
  assert.ok(["rwa-A", "rwa-B"].includes(_adopt(ls)), "must still adopt when no history exists");
  assert.notEqual(ls.getItem(_NS + "-p"), null, "profiles must be copied");
}
// (j) corrupt history JSON must not abort adoption — it just scores 0
{
  const ls = _fakeLS({
    "rwa-BAD-p": "BAD", "rwa-BAD-h": "{not json",
    "rwa-GOOD-p": "GOOD", "rwa-GOOD-h": JSON.stringify([{ when: 42 }]),
  });
  assert.equal(_adopt(ls), "rwa-GOOD", "corrupt history must score 0, not throw");
}
// (k) a malformed profile from an adopted legacy namespace must not kill init.
// adoptLegacyNamespace copies a previous install's -p value verbatim, so it is a
// writer this file never validated. A single null element used to throw in
// migratePrompts, and because the engine splices extension.js synchronously into
// its main(), that throw aborted every remaining top-level statement — the whole
// extension silently failed to exist, with no listener anywhere in the client for
// the error event the engine dispatches.
{
  const src = _SRC.slice(_SRC.indexOf("function validProfileEntry"), _SRC.indexOf("var DEF_CFG"));
  const migrate = _SRC.slice(_SRC.indexOf("function migratePrompts"), _SRC.indexOf("})();", _SRC.indexOf("function migratePrompts")) + 5);
  assert.ok(src.includes(".filter(validProfileEntry)"), "drift: K_PROF load no longer filters malformed entries");

  const run = (raw) => new Function("stored", `
    function loadArr(k, def) { var v = null; try { v = JSON.parse(stored); } catch (e) {} return Array.isArray(v) ? v : def; }
    var K_PROF = "x", DEF_PROFILES = [{id:"expand",name:"Expand",prompt:"p",order:0}];
    ${src.slice(0, src.indexOf("var DEF_CFG"))}
    return profiles;
  `)(raw);

  // the exact value that used to blackhole the extension
  const survived = run('[{"id":"expand","name":"Expand","prompt":"p"},null]');
  assert.ok(Array.isArray(survived), "malformed legacy profiles must not throw");
  assert.ok(survived.every((p) => p && typeof p.id === "string"), "null element must be filtered out");
  assert.equal(survived.length, 1, "the one valid entry survives");

  // an entirely malformed array falls back to defaults rather than an empty list
  const allBad = run('[null,null]');
  assert.ok(allBad.length > 0, "an all-malformed array must fall back to DEF_PROFILES, not empty");
}
console.log("selfcheck: legacy-namespace adoption assertions passed");
