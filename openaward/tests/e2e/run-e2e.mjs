// End-to-end check of the OpenAward flow without a key, in headless Chrome, against the
// three real sites on three origins.
//
//   node tests/e2e/run-e2e.mjs [--chrome <path>] [--screenshots <folder>]
//
// It uses the agentic-web repository's own Chrome launcher and DevTools client
// (tests/linking/chrome/), which keep Chrome off the real network: every host but the
// loopback names fails to resolve, and other traffic goes to a closed proxy port.
//
// What it proves, each from the publisher servers' own request logs or the page:
//   E1  Opening the passport contacts no publisher.
//   E2  The consent dialog names the publisher's origin before any contact.
//   E3  Declining contacts nothing.
//   E4  After Allow, the publisher served its manifest, its bridge page and its own rules
//       code; no request carried an Authorization header or a cookie.
//   E5  A check sends only the fields shown on the dialog, and the publisher reports
//       receiving exactly those fields.
//   E6  A withheld field makes its rule "unknown", never "met" or "not met".
//   E7  Two publishers give different, sourced results for the same passport.
//   E8  The page logs every contact in "What left this page".
//   E9  No console errors; the narrow (390 px) layout has no horizontal scroll.
//   E10 The privacy plan, worked out on the page with no contact: "skip" for Pell, citing
//       34 CFR 668.33, and "Share only what's needed" leaves only citizenship in the request.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChromeLauncher } from "../../../tests/linking/chrome/chrome_launcher.mjs";
import { CdpClient } from "../../../tests/linking/chrome/cdp_client.mjs";
import { startFallback as startAll } from "../../scripts/serve-all.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const PASSPORT = "http://127.0.0.1:8080/";
const PELL = "http://localhost:8081";
const OREGON = "http://[::1]:8083";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

const results = [];
function check(id, ok, detail) {
  results.push({ id, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${detail}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLog(file) {
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function waitFor(client, session, expression, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await client.evaluate(session, expression);
      if (last) {
        return last;
      }
    } catch (error) {
      last = error.message;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label} (last: ${JSON.stringify(last)})`);
}

async function main() {
  const chromePath = ChromeLauncher.locate(option("--chrome"))
    || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => existsSync(p));
  if (!chromePath) {
    console.error("No Chrome found. Pass --chrome <path> or set CHROME.");
    process.exit(2);
  }
  const work = mkdtempSync(path.join(os.tmpdir(), "openaward-e2e-"));
  const logDir = path.join(work, "logs");
  const shots = path.resolve(option("--screenshots") || path.join(ROOT, "docs", "screenshots"));
  mkdirSync(shots, { recursive: true });
  const servers = startAll({ logDir, quiet: true });
  const chrome = new ChromeLauncher(chromePath, 9783, path.join(work, "profile"), path.join(work, "chrome.log"));
  let client = null;
  const consoleErrors = [];
  try {
    await sleep(1200);
    await chrome.start();
    client = await CdpClient.connect(9783);
    const target = await client.send("Target.createTarget", { url: "about:blank" });
    const attached = await client.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const session = attached.sessionId;
    client.onEvent((message) => {
      if (message.sessionId !== session) {
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        consoleErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text);
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
      }
    });
    await client.send("Page.enable", {}, session);
    await client.send("Runtime.enable", {}, session);
    // Record every Content-Security-Policy violation from the first line of each page.
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));` }, session);
    await client.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, session);
    await client.send("Page.navigate", { url: PASSPORT }, session);
    await waitFor(client, session, `document.querySelectorAll("#passport-form fieldset").length === 4`, "the passport form");
    await waitFor(client, session, `document.querySelector("#assistant-status").textContent.includes("needs your AI provider key")`, "the assistant status");
    await sleep(800);

    const pellLog = path.join(logDir, "pell.jsonl");
    const oregonLog = path.join(logDir, "oregon.jsonl");
    check("E1", readLog(pellLog).length === 0 && readLog(oregonLog).length === 0, `publisher requests on page load: pell ${readLog(pellLog).length}, oregon ${readLog(oregonLog).length}`);
    await shot(client, session, path.join(shots, "01-passport-empty.png"));

    // Load the sample student.
    await client.evaluate(session, `[...document.querySelectorAll("#samples button")].find((b) => b.textContent.includes("Maya")).click()`);
    await waitFor(client, session, `document.querySelector("#filled-count").textContent.startsWith("11 of 12")`, "the sample passport");

    // E2, E3: the consent dialog names the origin, and a decline contacts nothing.
    const readButton = `[...document.querySelectorAll("#publishers button")].find((b) => b.textContent.includes("Pell Rules Desk's rules"))`;
    await client.evaluate(session, `${readButton}.click()`);
    const dialogText = await waitFor(client, session, `document.querySelector("dialog.consent")?.textContent`, "the consent dialog");
    check("E2", dialogText.includes(PELL) && dialogText.includes("Your profile is not sent"), `dialog names ${PELL} and says nothing is sent`);
    await shot(client, session, path.join(shots, "02-consent-read-rules.png"));
    await client.evaluate(session, `document.querySelector("dialog.consent button.ghost").click()`);
    await sleep(1500);
    check("E3", readLog(pellLog).length === 0, `requests to pell after decline: ${readLog(pellLog).length}`);

    // E4: allow, then the publisher's own files are fetched from its origin.
    await client.evaluate(session, `${readButton}.click()`);
    await waitFor(client, session, `document.querySelector("dialog.consent")`, "the consent dialog");
    await client.evaluate(session, `document.querySelector("dialog.consent button.primary").click()`);
    await waitFor(client, session, `document.querySelectorAll("#publishers .opp").length >= 1`, "the Pell rules");
    const pellPaths = readLog(pellLog).map((entry) => entry.path);
    const needed = ["/agent-manifest.json", "/bridge/action-bridge.html", "/bridge/agent-manifest.json", "/bridge/bridge-actions.js", "/kit/publisher-core.js", "/kit/eligibility.js", "/rules.json"];
    const leaked = readLog(pellLog).filter((entry) => entry.authorization || (entry.cookies && entry.cookies.length));
    check("E4", needed.every((p) => pellPaths.includes(p)) && leaked.length === 0 && !pellPaths.includes("/index.html") && !pellPaths.includes("/"),
      `pell served ${needed.filter((p) => pellPaths.includes(p)).length}/${needed.length} publisher files, page not loaded, ${leaked.length} requests with credentials`);

    // E5, E6: check with defaults. Citizenship is sensitive, so it is withheld.
    const checkButton = (text) => `[...document.querySelectorAll("#publishers button")].find((b) => b.textContent === "Check with ${text}")`;
    await client.evaluate(session, `${checkButton("Pell Rules Desk")}.click()`);
    const sendText = await waitFor(client, session, `document.querySelector("dialog.consent")?.textContent`, "the send dialog");
    await shot(client, session, path.join(shots, "03-consent-send-fields.png"));
    await client.evaluate(session, `document.querySelector("dialog.consent button.primary").click()`);
    await waitFor(client, session, `JSON.parse(sessionStorage.getItem("openaward.session.v1")).results["pell:federal_pell_grant"]`, "the Pell result");
    const first = await client.evaluate(session, `(() => { const r = JSON.parse(sessionStorage.getItem("openaward.session.v1")).results["pell:federal_pell_grant"].result; return { outcome: r.outcome, received: r.received, citizenship: r.rules.find((x) => x.id === "pell_citizenship").status }; })()`);
    // citizenship and federalAidProblem are sensitive, so both stay withheld by default.
    const expectedFirst = ["highSchool", "highestDegree", "plannedProgram", "pellLifetimeUsed"];
    check("E5", JSON.stringify([...first.received].sort()) === JSON.stringify([...expectedFirst].sort()) && !sendText.includes("DACA"),
      `publisher received ${first.received.join(", ")}; the dialog did not include the withheld citizenship value`);
    check("E6", first.outcome === "unknown" && first.citizenship === "unknown", `withheld citizenship -> rule ${first.citizenship}, outcome ${first.outcome}`);
    await shot(client, session, path.join(shots, "04-result-withheld.png"), "#publishers-section");

    // E7: share citizenship with Pell (not met) and with Oregon (met), from the same passport.
    await client.evaluate(session, `document.getElementById("share-pell:federal_pell_grant-citizenship").click()`);
    await sleep(200);
    await client.evaluate(session, `${checkButton("Pell Rules Desk")}.click()`);
    await waitFor(client, session, `document.querySelector("dialog.consent")`, "the send dialog");
    await client.evaluate(session, `document.querySelector("dialog.consent button.primary").click()`);
    await waitFor(client, session, `JSON.parse(sessionStorage.getItem("openaward.session.v1")).results["pell:federal_pell_grant"].result.outcome === "not_eligible"`, "the second Pell result");

    const readOregon = `[...document.querySelectorAll("#publishers button")].find((b) => b.textContent.includes("Oregon Grant Rules Desk's rules"))`;
    await client.evaluate(session, `${readOregon}.click()`);
    const oregonDialog = await waitFor(client, session, `document.querySelector("dialog.consent")?.textContent`, "the Oregon dialog");
    await client.evaluate(session, `document.querySelector("dialog.consent button.primary").click()`);
    await waitFor(client, session, `document.querySelectorAll("#publishers .opp").length >= 3`, "the Oregon rules");
    await client.evaluate(session, `document.getElementById("share-oregon:oregon_opportunity_grant_2027_28-citizenship").click()`);
    await sleep(200);
    await client.evaluate(session, `document.getElementById("share-oregon:oregon_opportunity_grant_2027_28-federalAidProblem").click()`);
    await sleep(200);
    await client.evaluate(session, `[...document.querySelectorAll("#publishers button")].filter((b) => b.textContent === "Check with Oregon Grant Rules Desk")[1].click()`);
    await waitFor(client, session, `document.querySelector("dialog.consent")`, "the Oregon send dialog");
    await client.evaluate(session, `document.querySelector("dialog.consent button.primary").click()`);
    await waitFor(client, session, `JSON.parse(sessionStorage.getItem("openaward.session.v1")).results["oregon:oregon_opportunity_grant_2027_28"]`, "the Oregon result");
    const compare = await client.evaluate(session, `(() => { const s = JSON.parse(sessionStorage.getItem("openaward.session.v1")).results; return { pell: s["pell:federal_pell_grant"].result.outcome, oregon: s["oregon:oregon_opportunity_grant_2027_28"].result.outcome, oregonCitizenship: s["oregon:oregon_opportunity_grant_2027_28"].result.rules.find((x) => x.id === "oog_not_admitted_for_education").status, oregonOrigin: s["oregon:oregon_opportunity_grant_2027_28"].peerOrigin, sources: s["oregon:oregon_opportunity_grant_2027_28"].result.rules.every((x) => x.source && x.source.url.startsWith("https://")) }; })()`);
    const oregonPaths = readLog(oregonLog).map((entry) => entry.path);
    check("E7", compare.pell === "not_eligible" && compare.oregon === "possibly_eligible" && compare.oregonCitizenship === "met" && compare.oregonOrigin === OREGON && compare.sources && oregonDialog.includes(OREGON) && oregonPaths.includes("/rules.json"),
      `Pell: ${compare.pell}; Oregon 2027-28: ${compare.oregon} (citizenship rule ${compare.oregonCitizenship}), computed at ${compare.oregonOrigin}; every rule sourced: ${compare.sources}`);
    await client.evaluate(session, `document.querySelector("#results").scrollIntoView()`);
    await shot(client, session, path.join(shots, "05-compare.png"), "#results");
    await shot(client, session, path.join(shots, "06-oregon-result.png"), "#publishers-section");

    // E8: the activity log.
    const activity = await client.evaluate(session, `JSON.parse(sessionStorage.getItem("openaward.session.v1")).activity.map((a) => a.decision + " " + a.purpose + " " + a.origin)`);
    check("E8", activity.length === 6 && activity[0].startsWith("declined read published rules") && activity.filter((a) => a.startsWith("allowed")).length === 5,
      `activity entries: ${activity.join(" | ")}`);
    await client.evaluate(session, `document.querySelector("#activity").scrollIntoView()`);
    await shot(client, session, path.join(shots, "07-what-left.png"), ".two");

    // E10: the privacy plan, worked out on the page from the published rules. Maya shares
    // five fields with Pell now; by Pell's published rules one field, citizenship, settles
    // the answer, so the plan says she can skip Pell and offers to turn the other four off.
    const pellBefore = readLog(pellLog).length;
    const oregonBefore = readLog(oregonLog).length;
    const planBox = (key) => `document.getElementById("plan-${key}").closest(".plan")`;
    const pellPlan = await client.evaluate(session, `(() => { const box = ${planBox("pell:federal_pell_grant")}; return { advice: box.dataset.advice, text: box.innerText }; })()`);
    await client.evaluate(session, `document.getElementById("opp-pell:federal_pell_grant").scrollIntoView({ behavior: "instant" })`);
    await shot(client, session, path.join(shots, "13-privacy-plan.png"), `section.opp[aria-labelledby="opp-pell:federal_pell_grant"]`);
    await client.evaluate(session, `document.getElementById("plan-apply-pell:federal_pell_grant").click()`);
    await sleep(300);
    const afterPlan = await client.evaluate(session, `(() => {
      const panel = document.querySelector('section.opp[aria-labelledby="opp-pell:federal_pell_grant"]');
      return { preview: JSON.parse(panel.querySelector(".preview pre").textContent).args.fields, button: !!document.getElementById("plan-apply-pell:federal_pell_grant") };
    })()`);
    const oregonPlan = await client.evaluate(session, `${planBox("oregon:oregon_opportunity_grant_2027_28")}.dataset.advice`);
    const contacted = readLog(pellLog).length - pellBefore + readLog(oregonLog).length - oregonBefore;
    check("E10", pellPlan.advice === "skip" && pellPlan.text.includes("skip this publisher") && pellPlan.text.includes("668.33") && pellPlan.text.includes("Nothing was sent")
      && JSON.stringify(Object.keys(afterPlan.preview)) === JSON.stringify(["citizenship"]) && !afterPlan.button && oregonPlan === "share_needed" && contacted === 0,
      `Pell plan: ${pellPlan.advice}, cites 668.33: ${pellPlan.text.includes("668.33")}; after "Share only what's needed" the request holds ${Object.keys(afterPlan.preview).join(", ")}; Oregon 2027-28 plan: ${oregonPlan}; publisher requests while planning: ${contacted}`);

    // E9: mobile layout and console errors.
    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, session);
    await sleep(600);
    // body hides horizontal overflow, so scrollWidth alone would miss a box that runs off
    // screen. Measure the right edge of every layout box outside a scroll container.
    const overflow = await client.evaluate(session, `Math.max(document.documentElement.scrollWidth - window.innerWidth,
      ...[...document.querySelectorAll("header, main, section, article, fieldset, .card, .publisher, .opp, .oa-result, dialog, footer, button")]
        .filter((node) => !node.closest(".table-scroll, #agent-app") && node.getClientRects().length)
        .map((node) => Math.ceil(node.getBoundingClientRect().right - window.innerWidth)))`);
    await client.evaluate(session, `window.scrollTo({ top: 0, behavior: "instant" })`);
    await sleep(300);
    await shot(client, session, path.join(shots, "08-mobile.png"));
    await shot(client, session, path.join(shots, "09-mobile-result.png"), "#publishers-section");
    const csp = await client.evaluate(session, `window.__csp`);
    check("E9", overflow <= 0 && consoleErrors.length === 0 && csp.length === 0,
      `horizontal overflow at 390 px: ${overflow}px; console errors: ${consoleErrors.length ? consoleErrors.join(" || ") : "none"}; CSP violations: ${csp.length ? csp.join(" || ") : "none"}`);
  } catch (error) {
    check("RUN", false, error.stack || String(error));
  } finally {
    client?.close();
    await chrome.stop().catch(() => {});
    for (const child of servers) {
      child.kill();
    }
    await sleep(300);
    const failed = results.filter((item) => !item.ok);
    writeFileSync(path.join(shots, "e2e-report.json"), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
    rmSync(path.join(work, "profile"), { recursive: true, force: true });
    console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots and report: ${shots}`);
    process.exit(failed.length ? 1 : 0);
  }
}

async function shot(client, session, file, selector) {
  let clip;
  if (selector) {
    const box = await client.evaluate(session, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.max(0, r.left + scrollX - 8), y: Math.max(0, r.top + scrollY - 8), width: Math.min(r.width + 16, document.documentElement.scrollWidth), height: Math.min(r.height + 16, 4000) }; })()`);
    clip = { ...box, scale: 1 };
  }
  const image = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: Boolean(clip), ...(clip ? { clip } : {}) }, session);
  writeFileSync(file, Buffer.from(image.data, "base64"));
}

main();
