// End-to-end check of the assistant path, in headless Chrome, against the three real sites
// and a scripted router (tests/e2e/scripted-router.mjs) with a fake key. No real model.
//
//   node tests/e2e/run-assistant-e2e.mjs [--chrome <path>] [--screenshots <folder>]
//
// The student (Maya) asks the passport's assistant what is the least she needs to share.
// It reads both publishers' rules and plans, on the page. She has it follow the plan for
// Pell, which leaves nothing shared, then turns on the one field Pell needs and asks for
// Pell's check. The passport agent gets the page-prepared request, the runtime shows its
// consent card, and after Allow it loads the publisher's network from the publisher's
// origin and runs it in this browser: the publisher's front agent hands off to its
// checker, whose website_check_eligibility runs the publisher's own code in a frame on
// its origin.
//
//   A7  Planning: one page dialog names both publishers' origins before any contact; the
//       plan says skip Pell, share what Oregon 2027-28 needs, and fill the passport first
//       for Oregon 2026-27; no model request holds a passport value.
//   A8  Following the plan: the page shows the destination (this page), the action and
//       the fields to turn off before it runs; afterwards nothing is shared with Pell.
//   A1  The card names the publisher and its host, shows the full request, and nothing
//       reaches the publisher before the student answers.
//   A2  After Allow, the publisher served its manifest, network, links.json and bridge, and
//       no request to it carried an Authorization header or a cookie.
//   A3  Every model request went to the visitor's router, with the key, on the visitor's
//       model, for all three agents. The publisher's agents were offered exactly its two
//       shared reads.
//   A4  The answer came back through both agents of the publisher, from its rules code:
//       the outcome, and exactly the fields the student shares.
//   A5  A passport value the student never shared with this publisher (the SAI) reached
//       no model request.
//   A9  The page recorded the assistant's check like its own: result, origin, and the
//       fields that actually crossed, from the bridge request itself.
//   A10 A bridge request holding a field the student did not share is refused by the page
//       before it is posted, and logged.
//   A6  No CSP violations along the whole path.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChromeLauncher } from "../../../tests/linking/chrome/chrome_launcher.mjs";
import { CdpClient } from "../../../tests/linking/chrome/cdp_client.mjs";
import { startFallback as startAll } from "../../scripts/serve-all.mjs";
import { ScriptedRouter } from "./scripted-router.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const PASSPORT = "http://127.0.0.1:8080/";
const KEY = "sk-test-not-a-real-key";
const ROUTER_PORT = 8792;
const MODEL = "gpt-4.1-mini";

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readLog = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);

async function waitFor(client, session, expression, label, timeoutMs = 20000) {
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
  const work = mkdtempSync(path.join(os.tmpdir(), "openaward-assistant-"));
  const logDir = path.join(work, "logs");
  const shots = path.resolve(option("--screenshots") || path.join(ROOT, "docs", "screenshots"));
  mkdirSync(shots, { recursive: true });
  const servers = startAll({ logDir, quiet: true });
  const router = new ScriptedRouter(KEY);
  await router.listen(ROUTER_PORT);
  const chrome = new ChromeLauncher(chromePath, 9784, path.join(work, "profile"), path.join(work, "chrome.log"));
  let client = null;
  const pellLog = path.join(logDir, "pell.jsonl");
  const oregonLog = path.join(logDir, "oregon.jsonl");
  try {
    await sleep(1200);
    await chrome.start();
    client = await CdpClient.connect(9784);
    const target = await client.send("Target.createTarget", { url: "about:blank" });
    const { sessionId: session } = await client.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    await client.send("Page.enable", {}, session);
    await client.send("Runtime.enable", {}, session);
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));` }, session);
    await client.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
    await client.send("Page.navigate", { url: PASSPORT }, session);
    await waitFor(client, session, `document.querySelectorAll("#passport-form fieldset").length === 4 && !!document.querySelector("#ns-key")`, "the page and the assistant");

    // The student's part on the page: a passport, nothing read yet.
    await client.evaluate(session, `[...document.querySelectorAll("#samples button")].find((b) => b.textContent.includes("Maya")).click()`);
    await sleep(300);

    // The visitor's own router, key and model, as in the AI model settings panel.
    await client.evaluate(session, `{
      const set = (id, value) => { const input = document.querySelector(id); input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); };
      set("#ns-key", ${JSON.stringify(KEY)});
      set("#ns-router", "http://127.0.0.1:${ROUTER_PORT}/v1");
      set("#ns-model", ${JSON.stringify(MODEL)});
      document.querySelector("#ns-apply").click();
      "applied";
    }`);
    await waitFor(client, session, `window.__nsweb?.engine?.byokKey === ${JSON.stringify(KEY)} && !!document.querySelector("#ns-send")`, "the saved setup");
    await waitFor(client, session, `document.querySelector("#filled-count").textContent.startsWith("11 of 12")`, "the page after the setup reload");
    const ask = (text) => client.evaluate(session, `{
      const input = document.querySelector("#ns-input");
      input.value = ${JSON.stringify(text)};
      document.querySelector("#ns-send").click();
      "sent";
    }`);
    const answer = (marker) => waitFor(client, session, `[...document.querySelectorAll("#ns-msgs .ns-msg")].map((m) => m.innerText).find((t) => t.includes(${JSON.stringify(marker)}))`, `the ${marker} answer`, 45000);
    const app = `(await import("./js/app.js")).App.page`;

    // A7: the assistant plans. Reading both rule sets takes one page dialog that names both
    // origins; nothing reaches either publisher before the student answers, and the plan
    // turns hold field names, never the passport's values.
    await ask("Which publishers are worth asking, and what is the least I need to share with each?");
    const readDialog = await waitFor(client, session, `document.querySelector("dialog.consent")?.innerText`, "the read-rules dialog");
    await sleep(800);
    const beforeAllow = readLog(pellLog).length + readLog(oregonLog).length;
    await client.evaluate(session, `document.querySelector("dialog.consent button.primary").click()`);
    const planned = await answer("PASSPORT_PLAN:");
    const planChats = router.chats().map((record) => record.body);
    const valueLeak = planChats.filter((body) => body.includes("daca_or_undocumented") || body.includes("sai=1200") || body.includes('\\"sai\\":1200'));
    check("A7", readDialog.includes("http://localhost:8081") && readDialog.includes("http://[::1]:8083") && readDialog.includes("Your profile is not sent") && beforeAllow === 0
      && planned.includes("pell:federal_pell_grant=skip") && planned.includes("oregon:oregon_opportunity_grant_2027_28=share_needed") && planned.includes("oregon:oregon_opportunity_grant_2026_27=fill_passport_first") && valueLeak.length === 0,
      `one dialog named both origins; publisher requests before Allow: ${beforeAllow}; plan: ${planned.replace(/\s+/g, " ").slice(planned.indexOf("PASSPORT_PLAN:"), planned.indexOf("PASSPORT_PLAN:") + 200)}; model requests holding a passport value: ${valueLeak.length}`);
    await client.evaluate(session, `document.querySelector("#assistant").scrollIntoView({ behavior: "instant" })`);
    await shot(client, session, path.join(shots, "14-assistant-plan.png"), "#assistant");

    // A8: following the plan changes the page, so the page shows the destination and the
    // arguments and asks first. It turns sharing off only.
    await ask("Follow the plan for the Federal Pell Grant.");
    const applyDialog = await waitFor(client, session, `document.querySelector("dialog.consent")?.innerText`, "the apply-plan dialog");
    await client.evaluate(session, `document.querySelector("dialog.consent button.primary").click()`);
    const applied = await answer("PASSPORT_APPLIED:");
    const sharedAfterPlan = await client.evaluate(session, `${app}.sharingFor("pell:federal_pell_grant", ${app}.opportunities().find((item) => item.key === "pell:federal_pell_grant").opp).shared`);
    check("A8", applyDialog.includes("This page (http://127.0.0.1:8080)") && applyDialog.includes("apply_disclosure_plan") && applyDialog.includes("Turn off") && applied.includes('"ok":true') && sharedAfterPlan.length === 0,
      `dialog showed this page as destination with the action and the fields to turn off; Pell fields shared after the plan: ${sharedAfterPlan.length ? sharedAfterPlan.join(", ") : "none"}`);

    // The student decides to hear Pell's answer anyway, and turns on the one field it needs.
    await client.evaluate(session, `document.getElementById("share-pell:federal_pell_grant-citizenship").click()`);
    await sleep(300);
    const expectedRequest = await client.evaluate(session, `${app}.prepareRequest("pell:federal_pell_grant").requestText`);
    const before = readLog(pellLog).length;

    await ask("Ask the Pell Rules Desk to check the Federal Pell Grant with what I chose to share.");
    const card = await waitFor(client, session, `(() => { const a = document.querySelector(".ns-consent:not(.ns-action-window) .ns-consent-actions"); if (!a) return null; const c = a.closest(".ns-consent"); return { text: c.innerText, full: c.querySelector(".oa-full-request pre")?.textContent || "" }; })()`, "the consent card");
    await sleep(800);
    const duringCard = readLog(pellLog).length - before;
    await client.evaluate(session, `document.querySelector("#assistant").scrollIntoView({ behavior: "instant" })`);
    await shot(client, session, path.join(shots, "10-assistant-consent-card.png"), "#assistant");
    check("A1", card.text.includes("Pell Rules Desk (unofficial demo publisher)") && card.text.includes("localhost:8081") && card.full === expectedRequest && duringCard === 0,
      `card names the publisher and localhost:8081, shows the full ${expectedRequest.length}-character request (${card.full === expectedRequest ? "exact" : "MISMATCH"}), publisher requests while the card waited: ${duringCard}`);

    await client.evaluate(session, `document.querySelector('.ns-consent:not(.ns-action-window) .ns-consent-actions [data-d="allow"]').click()`);
    const final = await waitFor(client, session, `[...document.querySelectorAll("#ns-msgs .ns-msg")].map((m) => m.innerText).find((t) => t.includes("PASSPORT_FINAL:"))`, "the final answer", 45000);
    await sleep(500);
    await shot(client, session, path.join(shots, "11-assistant-answer.png"), "#assistant");

    const after = readLog(pellLog).slice(before);
    const paths = after.map((entry) => entry.path);
    const needed = ["/agent-manifest.json", "/pell_rules_desk.network.json", "/links.json", "/bridge/action-bridge.html", "/bridge/bridge-actions.js"];
    const leaked = readLog(pellLog).filter((entry) => entry.authorization || (entry.cookies && entry.cookies.length));
    check("A2", needed.every((p) => paths.includes(p)) && leaked.length === 0,
      `publisher served ${needed.filter((p) => paths.includes(p)).join(", ")}; requests with Authorization or cookies: ${leaked.length}`);

    const chats = router.chats();
    const roles = [...new Set(chats.map((record) => record.role))].sort();
    const partnerTools = router.chats("pell_front").concat(router.chats("pell_checker")).map((record) => record.tools.filter((name) => name.startsWith("website_")).sort().join(","));
    check("A3", chats.length > 0 && chats.every((record) => record.keyOk && record.model === MODEL) && JSON.stringify(roles) === JSON.stringify(["passport", "pell_checker", "pell_front"]) && partnerTools.every((tools) => tools === "website_check_eligibility,website_get_published_rules"),
      `${chats.length} model requests, all with the key: ${chats.every((r) => r.keyOk)}, all on ${MODEL}: ${chats.every((r) => r.model === MODEL)}; agents: ${roles.join(", ")}; publisher agents offered: ${[...new Set(partnerTools)].join(" | ")}`);

    // After the plan, the request holds one field: citizenship.
    const expectedFields = ["citizenship"];
    check("A4", final.includes("PELL_FRONT: CHECKER: outcome=not_eligible") && final.includes(`received=${expectedFields.join(",")};`) && final.includes("No model was used"),
      `final answer: ${final.replace(/\s+/g, " ").slice(final.indexOf("PASSPORT_FINAL:"), final.indexOf("PASSPORT_FINAL:") + 260)}`);

    const saiLeak = chats.filter((record) => record.body.includes("sai=1200") || record.body.includes('"sai":1200') || record.body.includes("\\\"sai\\\":1200"));
    check("A5", saiLeak.length === 0, `model requests holding the unshared SAI value: ${saiLeak.length}`);

    // A9: the page records the assistant's check like its own: the result, the publisher's
    // origin, and what actually crossed to it, read from the bridge request itself.
    const recorded = await client.evaluate(session, `(() => {
      const s = JSON.parse(sessionStorage.getItem("openaward.session.v1"));
      const saved = s.results["pell:federal_pell_grant"];
      const entry = s.activity.filter((a) => a.via === "assistant" && a.purpose.startsWith("screen")).at(-1);
      return { via: saved?.via, outcome: saved?.result?.outcome, origin: saved?.peerOrigin, sent: entry?.sent, received: entry?.received, compare: document.querySelector("#compare")?.innerText || "" };
    })()`);
    check("A9", recorded.via === "assistant" && recorded.outcome === "not_eligible" && recorded.origin === "http://localhost:8081" && JSON.stringify(recorded.sent) === '["citizenship"]' && JSON.stringify(recorded.received) === '["citizenship"]' && recorded.compare.includes("Not eligible"),
      `page result via ${recorded.via}: ${recorded.outcome} from ${recorded.origin}; logged as sent ${JSON.stringify(recorded.sent)}, publisher received ${JSON.stringify(recorded.received)}; compare table updated: ${recorded.compare.includes("Not eligible")}`);

    // A10: whatever a model writes, the page refuses a field the student did not share,
    // before the bridge request is posted.
    const refused = await client.evaluate(session, `{
      const { ActionBridgeClient } = await import("./runtime/action-transport.js");
      const bridge = new ActionBridgeClient("http://localhost:8081/bridge/action-bridge.html", "test");
      await bridge.connect(false);
      let message = "SENT";
      try {
        await bridge.request("execute", { name: "check_eligibility", args: { opportunityId: "federal_pell_grant", fields: { citizenship: "daca_or_undocumented", highSchool: "in_high_school" } }, requestId: "guard-test" });
      } catch (error) {
        message = error.message;
      } finally {
        bridge.dispose();
      }
      message;
    }`);
    const lastEntry = await client.evaluate(session, `JSON.parse(sessionStorage.getItem("openaward.session.v1")).activity.at(-1).decision`);
    check("A10", refused.startsWith("OpenAward's privacy check blocked this request") && refused.includes("High school") && lastEntry === "refused",
      `a bridge request with an unshared field: ${refused.slice(0, 200)}; logged as ${lastEntry}`);

    const csp = await client.evaluate(session, `window.__csp`);
    check("A6", csp.length === 0, `CSP violations with the page's Content-Security-Policy while the whole agent path ran: ${csp.length ? csp.join(" || ") : "none"}`);
  } catch (error) {
    check("RUN", false, error.stack || String(error));
  } finally {
    client?.close();
    await chrome.stop().catch(() => {});
    await router.close();
    for (const child of servers) {
      child.kill();
    }
    await sleep(300);
    const failed = results.filter((item) => !item.ok);
    writeFileSync(path.join(shots, "assistant-e2e-report.json"), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
    rmSync(path.join(work, "profile"), { recursive: true, force: true });
    console.log(`\n${results.length - failed.length}/${results.length} passed.`);
    process.exit(failed.length ? 1 : 0);
  }
}

async function shot(client, session, file, selector) {
  const box = await client.evaluate(session, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.max(0, r.left + scrollX - 8), y: Math.max(0, r.top + scrollY - 8), width: r.width + 16, height: Math.min(r.height + 16, 3000) }; })()`);
  const image = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...box, scale: 1 } }, session);
  writeFileSync(file, Buffer.from(image.data, "base64"));
}

main();
