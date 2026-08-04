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
try {
  await import("./selfcheck.mjs");
} catch (e) {
  console.error("\nbuild: selfcheck FAILED — bundle not written.\n" + (e && e.message ? e.message : e));
  process.exit(1);
}

// 2) Splice source into the bundle, preserving key order + metadata.
const bundle = JSON.parse(readFileSync(BUNDLE, "utf8"));
const source = readFileSync(SOURCE, "utf8");
bundle.js = source;
const styles = readFileSync(STYLES, "utf8");
bundle.css = styles;

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
