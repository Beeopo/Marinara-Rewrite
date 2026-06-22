// Build the installable bundle from source.
//
// rewrite-assistant.json's `js` field holds the extension code; this splices the
// current extension.js into it so the bundle never drifts from source by hand.
// selfcheck runs first: a version that fails its own checks is never bundled.
// A second bundle (rewrite-assistant-loader.json) is also written from loader.js.
//   node build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const BUNDLE = "rewrite-assistant.json";
const SOURCE = "extension.js";
const LOADER_SRC = "loader.js";
const LOADER_BUNDLE = "rewrite-assistant-loader.json";

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
console.log(`build: wrote ${BUNDLE} (${out.length} chars; js ${source.length} chars) OK`);

// 4) Loader bundle — same extension id and name, but its `js` is the tiny
//    auto-update loader instead of the full code. Importing EITHER fills the
//    same slot: the loader pulls the latest extension on each Marinara load.
const loaderCode = readFileSync(LOADER_SRC, "utf8");
const loaderBundle = {
  id: bundle.id,
  name: bundle.name,
  description: "Auto-update loader — fetches the latest Rewrite Assistant on each Marinara load (Extender sidecar first, then GitHub if opted in, then offline cache).",
  enabled: true,
  js: loaderCode,
  css: "",
};
const loaderOut = JSON.stringify(loaderBundle, null, 2).replace(/\n/g, "\r\n");
writeFileSync(LOADER_BUNDLE, loaderOut, "utf8");

// 5) Loader round-trip check.
const loaderCheck = JSON.parse(readFileSync(LOADER_BUNDLE, "utf8"));
if (loaderCheck.js !== loaderCode) {
  console.error("build: loader round-trip mismatch — loader bundle js does not equal loader.js.");
  process.exit(1);
}
console.log(`build: wrote ${LOADER_BUNDLE} (${loaderOut.length} chars; loader ${loaderCode.length} chars) OK`);
