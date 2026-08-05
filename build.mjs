// Build the installable bundle from source.
//
// rewrite-assistant.json's `js` field holds the extension code; this splices the
// current extension.js into it so the bundle never drifts from source by hand.
// selfcheck runs first: a version that fails its own checks is never bundled.
// There is no auto-update loader: Marinara 2.4 binds approval to the SHA-256 of the
// stored code, so any runtime-fetched code would bypass the review it exists to enforce.
//   node build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const BUNDLE = "rewrite-assistant.json";
const SOURCE = "extension.js";
const STYLES = "extension.css";

// 1) Gate on selfcheck (its top-level assertions throw on failure).
// Tell it we're mid-build so it skips its bundle-is-in-sync assertion — that check
// exists to catch a forgotten rebuild, and this IS the rebuild.
process.env.RWA_BUILDING = "1";
try {
  await import("./selfcheck.mjs");
} catch (e) {
  console.error("\nbuild: selfcheck FAILED — bundle not written.\n" + (e && e.message ? e.message : e));
  process.exit(1);
}

// 2) Build the manifest fresh. Marinara 2.4's schema has no `id` or `enabled` —
//    the engine mints its own id and every import starts disabled pending hash
//    approval — and `capabilities` must be explicit: without it the import path
//    defaults to the safe sandbox, a Worker with no DOM and no /api access, so
//    the extension would install cleanly and then do nothing at all.
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

// Pretty-print (2-space) then convert structural newlines to CRLF to match the
// existing file. Newlines inside the js/css strings are already escaped as "\n".
const out = JSON.stringify(bundle, null, 2).replace(/\n/g, "\r\n");
writeFileSync(BUNDLE, out, "utf8");

// 3) Round-trip check: the written bundle must parse and its js must match.
const check = JSON.parse(readFileSync(BUNDLE, "utf8"));
if (check.js !== source) {
  console.error("build: round-trip mismatch — bundle js does not equal extension.js.");
  process.exit(1);
}
if (check.css !== styles) {
  console.error("build: round-trip mismatch — bundle css does not equal extension.css.");
  process.exit(1);
}
console.log(`build: wrote ${BUNDLE} (${out.length} chars; js ${source.length} chars; css ${styles.length} chars) OK`);
