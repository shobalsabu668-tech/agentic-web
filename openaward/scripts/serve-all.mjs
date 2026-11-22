// Serves the three Campus Sidequest sites on three origins, with the skill's static server, which
// sends the CORS header on the public agent files and never blocks framing of bridge/.
//
//   node scripts/serve-all.mjs [--log <folder>]
//
//   sidequest      http://127.0.0.1:8080/   (bound to 127.0.0.1)
//   makers studio  http://localhost:8081/   (bound to 127.0.0.1, opened as localhost)
//   campus games   http://[::1]:8083/       (bound to ::1)
//
// Three host names on purpose: on loopback hosts the runtime copies a saved key into a
// cookie for the host name, so a publisher on the passport's host name would receive it.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SERVER = path.resolve(ROOT, "..", "skills", "agentify-website", "scripts", "serve_site.mjs");

export const SERVED = [
  { name: "sidequest", dir: "sidequest", args: ["--port", "8080", "--open-as", "127.0.0.1"], url: "http://127.0.0.1:8080/" },
  { name: "makers", dir: "publishers/maker-studio", args: ["--port", "8081", "--open-as", "localhost"], url: "http://localhost:8081/" },
  { name: "games", dir: "publishers/campus-games", args: ["--host", "::1", "--port", "8083"], url: "http://[::1]:8083/" },
];

// The archived OpenAward Passport sites, on the same three origins (scripts/serve-openaward-fallback.mjs
// and the passport's e2e checks). Their log names are what those checks read.
export const FALLBACK = [
  { name: "passport", dir: "passport", args: ["--port", "8080", "--open-as", "127.0.0.1"], url: "http://127.0.0.1:8080/" },
  { name: "pell", dir: "publishers/pell-desk", args: ["--port", "8081", "--open-as", "localhost"], url: "http://localhost:8081/" },
  { name: "oregon", dir: "publishers/oregon-desk", args: ["--host", "::1", "--port", "8083"], url: "http://[::1]:8083/" },
];

/**
 * Start the three Campus Sidequest servers.
 *
 * :param options: {logDir, quiet}.
 * :return: The child processes.
 */
export function startAll(options = {}) {
  return startSites(SERVED, options);
}

/**
 * Start the three archived OpenAward Passport servers.
 *
 * :param options: {logDir, quiet}.
 * :return: The child processes.
 */
export function startFallback(options = {}) {
  return startSites(FALLBACK, options);
}

function startSites(sites, options) {
  const children = [];
  for (const site of sites) {
    // All three are static sites; each site's agent runs in the visitor's browser.
    const args = [SERVER, path.join(ROOT, site.dir), ...site.args];
    if (options.logDir) {
      mkdirSync(options.logDir, { recursive: true });
      args.push("--log", path.join(options.logDir, `${site.name}.jsonl`));
    }
    children.push(spawn(process.execPath, args, { stdio: options.quiet ? "ignore" : "inherit" }));
  }
  return children;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const logIndex = process.argv.indexOf("--log");
  const children = startAll({ logDir: logIndex > 0 ? process.argv[logIndex + 1] : null });
  console.log("\nCampus Sidequest sites:");
  for (const site of SERVED) {
    console.log(`  ${site.name.padEnd(9)} ${site.url}`);
  }
  console.log("\nOpen Sidequest first. Press Ctrl+C to stop all three.\n");
  const stop = () => {
    for (const child of children) {
      child.kill();
    }
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
