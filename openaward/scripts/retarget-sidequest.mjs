// Point the Sidequest hub at three separately hosted origins, or restore local origins.
// Usage: node scripts/retarget-sidequest.mjs --sidequest https://hub.example --maker https://makers.example --games https://games.example
//        node scripts/retarget-sidequest.mjs --local
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL = { sidequest: "http://127.0.0.1:8080", maker: "http://localhost:8081", games: "http://[::1]:8083" };
const argv = process.argv.slice(2);
const getArg = (name) => { const at = argv.indexOf(name); return at < 0 ? null : argv[at + 1] || null; };
const local = argv.includes("--local");
const bases = local ? LOCAL : { sidequest: getArg("--sidequest"), maker: getArg("--maker"), games: getArg("--games") };

function cleanBase(value, label) {
  if (!value) throw new Error(`Missing ${label} base URL.`);
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${label} URL must not have credentials, a query or a fragment.`);
  if (local) {
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error(`${label} local URL must use a loopback host.`);
  } else if (url.protocol !== "https:") throw new Error(`${label} hosted URL must use https.`);
  return url.href.replace(/\/+$/, "");
}

try {
  for (const key of Object.keys(bases)) bases[key] = cleanBase(bases[key], key);
  if (new Set(Object.values(bases).map((base) => new URL(base).origin)).size !== 3) throw new Error("Sidequest, Makers Studio and Campus Games must use three different origins.");
} catch (error) {
  console.error(`${error.message}\nUse --local, or provide --sidequest <https-url> --maker <https-url> --games <https-url>.`);
  process.exit(2);
}

function edit(relative, transform) {
  const file = path.join(ROOT, relative);
  const before = readFileSync(file, "utf8");
  const after = transform(before);
  writeFileSync(file, after);
}
const makerNetwork = `${bases.maker}/maker_studio`;
const gamesNetwork = `${bases.games}/campus_games`;
const makerOrigin = new URL(bases.maker).origin;
const gamesOrigin = new URL(bases.games).origin;
const peerCsp = local
  ? "connect-src 'self' https: http:; frame-src 'self' https: http:;"
  : `connect-src 'self' https: ${makerOrigin} ${gamesOrigin}; frame-src 'self' https: ${makerOrigin} ${gamesOrigin};`;

edit("sidequest/sidequest.js", (text) => text
  .replace(/(id: "maker", name: "Makers Studio", base: ")[^"]+/, `$1${bases.maker}`)
  .replace(/(id: "games", name: "Campus Games", base: ")[^"]+/, `$1${bases.games}`));
edit("sidequest/index.html", (text) => text
  .replace(/(class="partner-card maker-card" href=")[^"]+/, `$1${bases.maker}/`)
  .replace(/(class="partner-card games-card" href=")[^"]+/, `$1${bases.games}/`)
  .replace(/connect-src [^;]+; frame-src [^;]+;/, peerCsp));
for (const site of ["publishers/maker-studio/index.html", "publishers/campus-games/index.html"]) {
  edit(site, (text) => text
    .replace(/(class="back-link" href=")[^"]+/, `$1${bases.sidequest}/#planner`)
    .replace(/(<footer>[\s\S]*?<a href=")[^"]+("\s*>Campus Sidequest<\/a>)/, `$1${bases.sidequest}/$2`));
}
edit("sidequest/campus_sidequest.hocon", (text) => text
  .replace(/https?:\/\/[^"\s]+\/maker_studio/g, makerNetwork)
  .replace(/https?:\/\/[^"\s]+\/campus_games/g, gamesNetwork));
edit("sidequest/agent-manifest.json", (text) => {
  const manifest = JSON.parse(text);
  manifest.allowed_peers = [makerOrigin, gamesOrigin];
  return `${JSON.stringify(manifest, null, 2)}\n`;
});

const build = spawnSync(process.execPath, [path.join(ROOT, "scripts", "build.mjs")], { cwd: ROOT, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status || 1);
console.log(`\nSidequest: ${bases.sidequest}/\nMakers Studio: ${bases.maker}/\nCampus Games: ${bases.games}/`);
