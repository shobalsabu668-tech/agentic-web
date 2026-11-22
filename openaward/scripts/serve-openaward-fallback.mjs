// Serves the original OpenAward Passport product if you want to switch back from Sidequest.
// Stop serve-all.mjs first because both launchers use ports 8080, 8081 and 8083.
//
//   node scripts/serve-openaward-fallback.mjs [--log <folder>]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FALLBACK, startFallback } from "./serve-all.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const logIndex = process.argv.indexOf("--log");
  const children = startFallback({ logDir: logIndex > 0 ? process.argv[logIndex + 1] : null });
  console.log("\nOpenAward fallback sites:");
  for (const site of FALLBACK) console.log(`  ${site.name.padEnd(9)} ${site.url}`);
  console.log("\nPress Ctrl+C to stop all three.\n");
  const stop = () => { for (const child of children) child.kill(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
