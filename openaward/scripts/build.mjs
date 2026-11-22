// Builds the OpenAward fallback sites and the three Campus Sidequest sites.
//
//   node scripts/build.mjs           copy the runtime and the kit into each site, then build each network
//   node scripts/build.mjs --check   change nothing: check the copies match, then build-check each network
//
// For each site it:
//   1. copies skills/agentify-website/runtime/ unchanged into <site>/runtime/;
//   2. copies the shared kit files the site uses into <site>/kit/ (and, for a publisher,
//      the kit's site-actions.js, bridge/bridge-actions.js and site.js);
//   3. runs the skill's build_network.mjs on <site>/<network>.hocon with its manifest, which
//      writes <network>.network.json, bridge/ and the discovery files, and validates them
//      with the runtime's own parser and validator.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");
export const REPO = path.resolve(ROOT, "..");
export const SKILL = path.join(REPO, "skills", "agentify-website");
export const RUNTIME = path.join(SKILL, "runtime");
export const KIT = path.join(ROOT, "kit");

const PUBLISHER_KIT = ["passport-fields.js", "eligibility.js", "result-view.js", "publisher-core.js", "publisher-page.js", "kit.css"];

export const SITES = [
  {
    dir: path.join(ROOT, "passport"),
    network: "openaward_passport",
    kit: ["passport-fields.js", "eligibility.js", "disclosure.js", "result-view.js", "kit.css"],
    extra: [],
  },
  {
    dir: path.join(ROOT, "publishers", "pell-desk"),
    network: "pell_rules_desk",
    kit: PUBLISHER_KIT,
    extra: [
      ["publisher/site-actions.js", "site-actions.js"],
      ["publisher/bridge-actions.js", "bridge/bridge-actions.js"],
      ["publisher/site.js", "site.js"],
    ],
  },
  {
    dir: path.join(ROOT, "publishers", "oregon-desk"),
    network: "oregon_grant_desk",
    kit: PUBLISHER_KIT,
    extra: [
      ["publisher/site-actions.js", "site-actions.js"],
      ["publisher/bridge-actions.js", "bridge/bridge-actions.js"],
      ["publisher/site.js", "site.js"],
    ],
  },
  {
    dir: path.join(ROOT, "sidequest"),
    network: "campus_sidequest",
    kit: [],
    extra: [],
  },
  {
    dir: path.join(ROOT, "publishers", "maker-studio"),
    network: "maker_studio",
    kit: ["publisher.css"],
    extra: [],
  },
  {
    dir: path.join(ROOT, "publishers", "campus-games"),
    network: "campus_games",
    kit: ["publisher.css"],
    extra: [],
  },
];

/**
 * List every file under a folder, as paths relative to it.
 *
 * :param dir: The folder.
 * :return: Sorted relative paths with forward slashes.
 */
export function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        out.push(path.relative(dir, full).split(path.sep).join("/"));
      }
    }
  };
  if (existsSync(dir)) {
    walk(dir);
  }
  return out.sort();
}

/**
 * Every vendored file of one site: [source, destination] pairs.
 *
 * :param site: An entry of SITES.
 * :return: The pairs.
 */
export function vendoredFiles(site) {
  const pairs = [];
  for (const rel of listFiles(RUNTIME)) {
    pairs.push([path.join(RUNTIME, rel), path.join(site.dir, "runtime", rel)]);
  }
  for (const name of site.kit) {
    pairs.push([path.join(KIT, name), path.join(site.dir, "kit", name)]);
  }
  for (const [from, to] of site.extra) {
    pairs.push([path.join(KIT, from), path.join(site.dir, to)]);
  }
  return pairs;
}

function same(a, b) {
  return existsSync(b) && readFileSync(a).equals(readFileSync(b));
}

/**
 * The _headers file for Netlify or Cloudflare Pages: CORS on the public agent files only
 * ("Static hosting" in the skill's references/bundle_and_hosting.md), the sandbox worker's
 * CSP, and two safe defaults. Nothing blocks framing of bridge/: callers load it in a frame.
 *
 * :param site: An entry of SITES.
 * :return: The file's text.
 */
export function headersFile(site) {
  const cors = ["/agent-manifest.json", `/${site.network}.network.json`, "/links.json", "/agent-mcp.json", "/.well-known/nsdeploy.json", "/.well-known/nsdeploy-agent.json"];
  const lines = ["# Written by scripts/build.mjs. For Netlify and Cloudflare Pages. Do not edit by hand.", ""];
  for (const file of cors) {
    lines.push(file, "  Access-Control-Allow-Origin: *", "");
  }
  lines.push("/runtime/sandbox-worker.js", "  Content-Security-Policy: default-src 'none'; script-src blob:; connect-src 'none'; worker-src 'none'", "");
  lines.push("/*", "  X-Content-Type-Options: nosniff", "  Referrer-Policy: no-referrer", "");
  return lines.join("\n");
}

function main() {
  const check = process.argv.includes("--check");
  let failed = false;
  for (const site of SITES) {
    const name = path.relative(ROOT, site.dir);
    console.log(`\n=== ${name}`);
    const pairs = vendoredFiles(site);
    if (check) {
      const stale = pairs.filter(([from, to]) => !same(from, to)).map(([, to]) => path.relative(site.dir, to));
      const extraRuntime = listFiles(path.join(site.dir, "runtime")).filter((rel) => !existsSync(path.join(RUNTIME, rel)));
      const headersPath = path.join(site.dir, "_headers");
      if (!existsSync(headersPath) || readFileSync(headersPath, "utf8") !== headersFile(site)) {
        stale.push("_headers");
      }
      if (stale.length || extraRuntime.length) {
        failed = true;
        console.log(`Vendored files differ from their source: ${[...stale, ...extraRuntime.map((rel) => `runtime/${rel}`)].join(", ")}. Run node scripts/build.mjs.`);
      } else {
        console.log(`Vendored files match: runtime/ (${listFiles(RUNTIME).length} files) and ${site.kit.length + site.extra.length} kit files.`);
      }
    } else {
      rmSync(path.join(site.dir, "runtime"), { recursive: true, force: true });
      rmSync(path.join(site.dir, "kit"), { recursive: true, force: true });
      for (const [from, to] of pairs) {
        mkdirSync(path.dirname(to), { recursive: true });
        cpSync(from, to);
      }
      writeFileSync(path.join(site.dir, "_headers"), headersFile(site));
      console.log(`Copied runtime/ and ${site.kit.length + site.extra.length} kit files; wrote _headers.`);
    }
    const args = [
      path.join(SKILL, "scripts", "build_network.mjs"),
      path.join(site.dir, `${site.network}.hocon`),
      "--manifest",
      path.join(site.dir, "agent-manifest.json"),
    ];
    if (check) {
      args.push("--check");
    }
    const run = spawnSync(process.execPath, args, { stdio: "inherit" });
    if (run.status !== 0) {
      failed = true;
    }
  }
  if (failed) {
    console.error("\nBuild failed. Fix the errors above.");
    process.exit(1);
  }
  console.log(`\nAll ${SITES.length} sites built.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
