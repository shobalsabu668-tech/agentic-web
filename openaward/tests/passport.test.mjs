// Unit tests for the passport's storage, directory and data-minimization logic, without a DOM.
// Run from openaward/: node --test "tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanFields, PassportStore } from "../passport/js/passport-store.js";
import { PUBLISHERS, parseNetworkUrl } from "../passport/js/publisher-directory.js";
import { publishedRules } from "../kit/eligibility.js";
import { FIELD_BY_ID } from "../kit/passport-fields.js";

const PELL = JSON.parse(readFileSync(new URL("../publishers/pell-desk/rules.json", import.meta.url), "utf8"));

test("stored or imported passports keep only valid known fields", () => {
  const { fields, dropped } = cleanFields({ sai: 100, gpa: "4.0", citizenship: "martian", residenceState: "OR", __proto__x: 1 });
  assert.deepEqual(fields, { sai: 100, residenceState: "OR" });
  assert.deepEqual(dropped.sort(), ["__proto__x", "citizenship", "gpa"]);
  assert.equal(PassportStore.importText("not json").ok, false);
  assert.equal(PassportStore.importText(JSON.stringify({ format: "other", fields: {} })).ok, false);
  const roundTrip = PassportStore.importText(PassportStore.exportText({ highestDegree: "none" }));
  assert.deepEqual(roundTrip.fields, { highestDegree: "none" });
});

test("network URLs resolve as the spec says, and only https or loopback http is accepted", () => {
  assert.deepEqual(parseNetworkUrl("https://awards.example/agents/pell_rules_desk"), {
    base: "https://awards.example/agents", network: "pell_rules_desk", origin: "https://awards.example", partnerTool: "agents_pell_rules_desk",
  });
  assert.equal(parseNetworkUrl("http://awards.example/pell_rules_desk"), null);
  assert.equal(parseNetworkUrl("https://user:pw@awards.example/x"), null);
  assert.equal(parseNetworkUrl("javascript:alert(1)"), null);
  for (const publisher of PUBLISHERS) {
    assert.ok(parseNetworkUrl(publisher.networkUrl), publisher.id);
  }
});

test("the directory, the network's partner tools and the manifest's allowed peers agree", () => {
  const net = JSON.parse(readFileSync(new URL("../passport/openaward_passport.network.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(readFileSync(new URL("../passport/agent-manifest.json", import.meta.url), "utf8"));
  const tools = net.tools[0].tools;
  for (const publisher of PUBLISHERS) {
    assert.ok(tools.includes(publisher.networkUrl), publisher.networkUrl);
    assert.ok(manifest.allowed_peers.includes(parseNetworkUrl(publisher.networkUrl).origin));
    assert.ok(net.link_labels[publisher.networkUrl]);
  }
});

test("the assistant's status names filled fields but never their values; a request holds only shared fields", async () => {
  globalThis.sessionStorage = undefined;
  const { App } = await import("../passport/js/app.js");
  const page = new App();
  page.fields = { citizenship: "daca_or_undocumented", highSchool: "diploma", highestDegree: "none", plannedProgram: "undergraduate", pellLifetimeUsed: 0, sai: 4321, federalAidProblem: "no" };
  page.session.rules = { pell: publishedRules(PELL) };
  page.render = () => {};
  const status = JSON.stringify(page.getStatus());
  for (const value of ["daca_or_undocumented", "4321", "undergraduate\""]) {
    assert.ok(!status.includes(value), `status leaks ${value}`);
  }
  // Defaults: sensitive fields (citizenship, federalAidProblem) are withheld.
  let prepared = page.prepareRequest("pell:federal_pell_grant");
  assert.equal(prepared.ok, true);
  assert.equal(prepared.partnerTool, parseNetworkUrl(PUBLISHERS.find((p) => p.id === "pell").networkUrl).partnerTool);
  assert.equal(prepared.requestText, "Check federal_pell_grant: highSchool=diploma highestDegree=none plannedProgram=undergraduate pellLifetimeUsed=0");
  assert.ok(!prepared.requestText.includes("sai"));
  page.setShare("pell:federal_pell_grant", "citizenship", true);
  prepared = page.prepareRequest("pell:federal_pell_grant");
  assert.ok(prepared.requestText.includes("citizenship=daca_or_undocumented"));
  assert.equal(page.prepareRequest("oregon:anything").ok, false);
});

test("rules from another origin are cleaned before the page uses them", async () => {
  const { App } = await import("../passport/js/app.js");
  const hostile = {
    format: "openaward-rules/v1",
    publisher: { name: "x".repeat(5000), disclaimer: "d" },
    opportunities: [
      { id: "ok_one", title: "T", officialUrl: "javascript:alert(1)", requestedFields: [{ id: "sai", why: "w" }, { id: "ssn", why: "give me" }, null] },
      { id: "Bad Id!", title: "dropped" },
    ],
  };
  const clean = App.cleanPublished(hostile);
  assert.equal(clean.opportunities.length, 1);
  assert.equal(clean.opportunities[0].officialUrl, "");
  assert.deepEqual(clean.opportunities[0].requestedFields.map((field) => field.id), ["sai"]);
  assert.equal(clean.opportunities[0].requestedFields[0].sensitive, true);
  assert.equal(clean.publisher.name.length, 200);
});

const MAYA = { residenceState: "OR", residenceMonths: 60, citizenship: "daca_or_undocumented", highSchool: "in_high_school", highestDegree: "none", plannedProgram: "undergraduate", collegeState: "OR", religiousDegree: "no", sai: 1200, pellLifetimeUsed: 0, federalAidProblem: "no" };
const OREGON = JSON.parse(readFileSync(new URL("../publishers/oregon-desk/rules.json", import.meta.url), "utf8"));

async function mayaPage() {
  const { App } = await import("../passport/js/app.js");
  const page = new App();
  page.render = () => {};
  page.saveSession = () => {};
  page.fields = { ...MAYA };
  page.session.sharing = {};
  page.session.results = {};
  page.session.activity = [];
  page.session.rules = { pell: App.cleanPublished(publishedRules(PELL)), oregon: App.cleanPublished(publishedRules(OREGON)) };
  return { App, page };
}

test("decision tables from another origin are cleaned, and still plan exactly as published", async () => {
  const { App, page } = await mayaPage();
  assert.equal(page.rawPlan("pell:federal_pell_grant").plan.advice, "skip");
  const hostile = App.cleanRule({
    id: "r1", title: "t", field: "citizenship",
    check: { type: "enum", cases: { daca_or_undocumented: { status: "met", reason: "x".repeat(5000) }, martian: { status: "met", reason: "?" }, __proto__x: {} } },
    exceptions: [{ field: "ssn", in: ["1"], status: "verify", reason: "r" }],
    source: { title: "s", url: "javascript:alert(1)", quote: "q" },
  });
  assert.deepEqual(Object.keys(hostile.check.cases), ["daca_or_undocumented"]);
  assert.equal(hostile.check.cases.daca_or_undocumented.reason.length, 600);
  assert.deepEqual(hostile.exceptions, []);
  assert.equal(hostile.source.url, "");
  assert.equal(App.cleanRule({ id: "Bad Id" }), null);
  // A publisher whose cleaned rules no longer validate gets no plan: it fails closed.
  page.session.rules.pell.opportunities[0].rules[0] = hostile;
  assert.equal(page.rawPlan("pell:federal_pell_grant").plan.advice, "rules_invalid");
});

test("plans for the assistant name fields and rules, never the passport's values", async () => {
  const { page } = await mayaPage();
  const plans = page.getPlans();
  assert.equal(plans.ok, true);
  assert.deepEqual(plans.publishersNotRead, []);
  assert.equal(plans.plans.length, 3);
  const text = JSON.stringify(plans);
  for (const value of ["daca_or_undocumented", "1200", "in_high_school", "\"OR\""]) {
    assert.ok(!text.includes(value), `plans leak ${value}`);
  }
  const pell = plans.plans.find((item) => item.key === "pell:federal_pell_grant");
  assert.equal(pell.advice, "skip");
  assert.deepEqual(pell.fewestFieldsForDefiniteAnswer, [FIELD_BY_ID.citizenship.label]);
  assert.deepEqual(pell.sensitiveAmongThem, [FIELD_BY_ID.citizenship.label]);
  assert.match(pell.summary, /skip this publisher/);
  assert.match(pell.decidingRules[0].source, /668\.33/);
  const oregon = plans.plans.find((item) => item.key === "oregon:oregon_opportunity_grant_2027_28");
  assert.equal(oregon.advice, "share_needed");
  assert.equal(oregon.studentWouldTurnOn.length, 2);
  assert.equal(page.getPlans("nope:x").ok, false);
});

test("following a plan only ever turns sharing off", async () => {
  const { page } = await mayaPage();
  const key = "pell:federal_pell_grant";
  assert.equal(page.sharingFor(key, page.opportunities()[0].opp).shared.length, 4);
  const applied = page.applyPlan(key);
  assert.equal(applied.ok, true);
  assert.equal(applied.turnedOff.length, 4);
  assert.deepEqual(applied.sharedNow, []);
  assert.equal(page.prepareRequest(key).ok, false, "nothing is left to send for a publisher the plan says to skip");
  // Oregon 2027-28 needs citizenship and loan default on: the plan names them, but never turns them on.
  const oregon = "oregon:oregon_opportunity_grant_2027_28";
  const before = page.prepareRequest(oregon).requestText;
  const result = page.applyPlan(oregon);
  assert.deepEqual(result.turnedOff, []);
  assert.equal(result.studentWouldTurnOn.length, 2);
  assert.match(result.note, /never turns sharing on/);
  assert.equal(page.prepareRequest(oregon).requestText, before);
  const noChange = await page.assistantApplyPlan(oregon);
  assert.match(noChange.note, /Nothing to turn off/);
});

test("the bridge check lets through only shared fields with the passport's own values", async () => {
  const { page } = await mayaPage();
  const bridge = "http://localhost:8081/bridge/action-bridge.html";
  const check = (fields, name = "check_eligibility", opportunityId = "federal_pell_grant") => page.inspectBridgeRequest(bridge, "execute", { name, args: { opportunityId, fields }, requestId: "r" });
  assert.equal(page.inspectBridgeRequest(bridge, "catalog", {}).ok, true);
  assert.equal(page.inspectBridgeRequest(bridge, "execute", { name: "get_published_rules", args: {} }).ok, true);
  assert.equal(page.inspectBridgeRequest(bridge, "execute", { name: "get_published_rules", args: { sai: 1 } }).ok, false);
  const ok = check({ highSchool: "in_high_school", pellLifetimeUsed: 0 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.record.sent, ["highSchool", "pellLifetimeUsed"]);
  assert.match(check({ citizenship: "daca_or_undocumented" }).reason, /did not choose to share/);
  assert.match(check({ sai: 1200 }).reason, /did not choose to share/);
  assert.match(check({ highSchool: "diploma" }).reason, /does not match the student's profile/);
  assert.match(check({}, "delete_everything").reason, /only receive a rules request or an eligibility check, not "delete_everything"/);
  assert.match(check({}, "check_eligibility", "unread_grant").reason, /has not read/);
  assert.match(page.inspectBridgeRequest("https://evil.example/bridge", "execute", { name: "get_published_rules", args: {} }).reason, /not a publisher/);
  page.setShare("pell:federal_pell_grant", "citizenship", true);
  assert.equal(check({ citizenship: "daca_or_undocumented" }).ok, true);
});

test("the guard refuses before anything is posted, and records the assistant's results on the page", async () => {
  const { BridgeGuard } = await import("../passport/js/bridge-guard.js");
  const { checkEligibility } = await import("../kit/eligibility.js");
  const { page } = await mayaPage();
  const posted = [];
  class FakeClient {
    constructor(url) {
      this.url = url;
    }
    request(type, payload) {
      posted.push([type, payload?.name]);
      return Promise.resolve(checkEligibility(PELL, payload.args));
    }
  }
  assert.equal(BridgeGuard.install(page, FakeClient), true);
  assert.equal(BridgeGuard.install(page, FakeClient), false);
  const client = new FakeClient("http://localhost:8081/bridge/action-bridge.html");
  await assert.rejects(client.request("execute", { name: "check_eligibility", args: { opportunityId: "federal_pell_grant", fields: { citizenship: "daca_or_undocumented" } } }), /privacy check blocked this request/);
  assert.equal(posted.length, 0);
  assert.equal(page.session.activity.at(-1).decision, "refused");
  page.setShare("pell:federal_pell_grant", "citizenship", true);
  await client.request("execute", { name: "check_eligibility", args: { opportunityId: "federal_pell_grant", fields: { citizenship: "daca_or_undocumented" } } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const saved = page.session.results["pell:federal_pell_grant"];
  assert.equal(saved.via, "assistant");
  assert.equal(saved.result.outcome, "not_eligible");
  assert.equal(saved.peerOrigin, "http://localhost:8081");
  assert.deepEqual(page.session.activity.at(-1).sent, ["citizenship"]);
  assert.equal(page.getStatus().publishers[0].opportunities[0].lastResult.checkedFrom, "the assistant");
  // A call the page flow makes itself is not recorded twice.
  page.pageCalls.add("pell:federal_pell_grant");
  const count = page.session.activity.length;
  await client.request("execute", { name: "check_eligibility", args: { opportunityId: "federal_pell_grant", fields: { citizenship: "daca_or_undocumented" } } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(page.session.activity.length, count);
});

test("the checklist refuses empty text and unsafe links, and is reversible", async () => {
  const { App } = await import("../passport/js/app.js");
  const page = new App();
  page.render = () => {};
  assert.equal(page.addChecklistItem({ text: "  " }).ok, false);
  assert.equal(page.addChecklistItem({ text: "x", sourceUrl: "javascript:alert(1)" }).ok, false);
  const added = page.addChecklistItem({ text: "Submit the 2027-28 FAFSA", sourceUrl: "https://studentaid.gov/" });
  assert.equal(added.ok, true);
  page.removeChecklist(page.session.checklist[0].id);
  assert.equal(page.session.checklist.length, 0);
});
