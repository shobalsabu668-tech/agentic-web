// Points the passport at hosted publishers, and back.
//
//   node scripts/retarget.mjs --passport <base> --pell <base> --oregon <base>
//   node scripts/retarget.mjs --local
//
// Each <base> is the https URL where that folder is served, with any subpath and no
// trailing slash, such as https://openaward-pell.netlify.app. The three sites must be on
// three different origins: that is what makes the publishers independent peers.
//
// It rewrites the publisher network URLs in passport/js/publisher-directory.js, the
// passport's .hocon (partner tools, link_labels and the "How to work" tool names) and
// agent-manifest.json (allowed_peers); drops "http:" from each page's CSP for an https
// deployment; then rebuilds all three sites.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseNetworkUrl } from "../passport/js/publisher-directory.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL = { pell: "http://localhost:8081", oregon: "http://[::1]:8083" };
const NETWORKS = { pell: "pell_rules_desk", oregon: "oregon_grant_desk" };
const CSP_HTTP = "connect-src 'self' https: http:; frame-src 'self' https: http:;";
const CSP_HTTPS = "connect-src 'self' https:; frame-src 'self' https:;";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").replace(/\/+$/, "") : null;
};

const local = args.includes("--local");
const bases = local ? LOCAL : { pell: option("--pell"), oregon: option("--oregon") };
const passport = local ? "http://127.0.0.1:8080" : option("--passport");
if (!bases.pell || !bases.oregon || !passport) {
  console.error("Usage: node scripts/retarget.mjs --passport <base> --pell <base> --oregon <base>   or   --local");
  process.exit(2);
}
const origins = new Set([passport, bases.pell, bases.oregon].map((base) => new URL(base).origin));
if (origins.size !== 3) {
  console.error("The passport and the two publishers must be on three different origins.");
  process.exit(2);
}
if (!local && ![passport, bases.pell, bases.oregon].every((base) => base.startsWith("https://"))) {
  console.error("Hosted sites must use https (spec sections 3.2 and 3.3).");
  process.exit(2);
}

const directoryPath = path.join(ROOT, "passport", "js", "publisher-directory.js");
let directory = readFileSync(directoryPath, "utf8");
const current = {};
for (const id of Object.keys(NETWORKS)) {
  const match = new RegExp(`id: "${id}",[\\s\\S]*?networkUrl: "([^"]+)"`).exec(directory);
  current[id] = match[1];
}
const next = Object.fromEntries(Object.keys(NETWORKS).map((id) => [id, `${bases[id]}/${NETWORKS[id]}`]));

const hoconPath = path.join(ROOT, "passport", "openaward_passport.hocon");
const manifestPath = path.join(ROOT, "passport", "agent-manifest.json");
let hocon = readFileSync(hoconPath, "utf8");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const id of Object.keys(NETWORKS)) {
  const before = current[id];
  const after = next[id];
  directory = directory.replace(`networkUrl: "${before}"`, `networkUrl: "${after}"`);
  hocon = hocon.split(`"${before}"`).join(`"${after}"`);
  const oldTool = parseNetworkUrl(before).partnerTool;
  const newTool = parseNetworkUrl(after).partnerTool;
  hocon = hocon.replace(new RegExp(`\\b${oldTool}\\b(?= for the)`, "g"), newTool);
  manifest.allowed_peers = manifest.allowed_peers.map((origin) => (origin === new URL(before).origin ? new URL(after).origin : origin));
  console.log(`${id}: ${before} -> ${after} (tool ${newTool})`);
}
writeFileSync(directoryPath, directory);
writeFileSync(hoconPath, hocon);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

for (const page of ["passport/index.html", "publishers/pell-desk/index.html", "publishers/oregon-desk/index.html"]) {
  const file = path.join(ROOT, page);
  const html = readFileSync(file, "utf8");
  writeFileSync(file, local ? html.replace(CSP_HTTPS, CSP_HTTP) : html.replace(CSP_HTTP, CSP_HTTPS));
}

const build = spawnSync(process.execPath, [path.join(ROOT, "scripts", "build.mjs")], { stdio: "inherit" });
console.log(local ? "\nPointed back at the local addresses." : `\nPassport at ${passport} now calls ${next.pell} and ${next.oregon}. Deploy each folder to its base URL.`);
process.exit(build.status ?? 1);
