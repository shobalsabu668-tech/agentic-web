// Unit tests for the OpenAward kit, the two publishers' rules, and the passport's logic.
// Run from openaward/: node --test "tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkEligibility, checkInputSchema, evaluateRule, overallOutcome, publishedRules, validateRules } from "../kit/eligibility.js";
import { ADVICE, planDisclosure, publishedProblems } from "../kit/disclosure.js";
import { PASSPORT_FIELDS, fieldError, fieldSchema } from "../kit/passport-fields.js";
import { resultProblem, safeUrl } from "../kit/result-view.js";

const load = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const PELL = load("../publishers/pell-desk/rules.json");
const OREGON = load("../publishers/oregon-desk/rules.json");
const NOW = { now: new Date("2026-11-20T12:00:00Z") };

const statusOf = (outcome, id) => outcome.result.rules.find((rule) => rule.id === id).status;
const pell = (fields) => checkEligibility(PELL, { opportunityId: "federal_pell_grant", fields }, NOW);
const oog26 = (fields) => checkEligibility(OREGON, { opportunityId: "oregon_opportunity_grant_2026_27", fields }, NOW);
const oog27 = (fields) => checkEligibility(OREGON, { opportunityId: "oregon_opportunity_grant_2027_28", fields }, NOW);

const PELL_OK = { citizenship: "us_citizen_or_national", highSchool: "diploma", highestDegree: "none", plannedProgram: "undergraduate", pellLifetimeUsed: 0, federalAidProblem: "no" };
const OOG_OK = { residenceState: "OR", residenceMonths: 24, citizenship: "us_citizen_or_national", highestDegree: "none", plannedProgram: "undergraduate", collegeState: "OR", religiousDegree: "no", sai: 0, aidApplicationDate: "2026-01-15", federalAidProblem: "no" };

test("both published rules documents validate", () => {
  assert.deepEqual(validateRules(PELL), []);
  assert.deepEqual(validateRules(OREGON), []);
});

test("every rule cites an https source with a verbatim quote and a checked date", () => {
  for (const doc of [PELL, OREGON]) {
    for (const opp of doc.opportunities) {
      assert.match(opp.rulesCheckedAt, /^\d{4}-\d{2}-\d{2}$/);
      for (const rule of opp.rules) {
        assert.match(rule.source.url, /^https:\/\//, rule.id);
        assert.ok(rule.source.quote.length > 20, rule.id);
      }
    }
  }
});

test("the validator fails closed on unsourced, unused and incomplete rules", () => {
  const broken = structuredClone(PELL);
  const opp = broken.opportunities[0];
  delete opp.rules[0].source.quote;
  opp.requestedFields.push("sai");
  delete opp.rules[1].check.cases.none;
  opp.rules[2].exceptions[0].in = ["not_a_program"];
  const problems = validateRules(broken).join("\n");
  assert.match(problems, /verbatim quote/);
  assert.match(problems, /requestedFields lists "sai", which no rule uses/);
  assert.match(problems, /no case for "none"/);
  assert.match(problems, /exception value "not_a_program"/);
  const refused = checkEligibility(broken, { opportunityId: "federal_pell_grant", fields: PELL_OK });
  assert.equal(refused.ok, false);
});

test("outcome precedence: not met beats not shared beats to confirm", () => {
  assert.equal(overallOutcome(["met", "verify", "unknown", "not_met"]), "not_eligible");
  assert.equal(overallOutcome(["met", "verify", "unknown"]), "unknown");
  assert.equal(overallOutcome(["met", "verify"]), "possibly_eligible");
  assert.equal(overallOutcome(["met"]), "eligible");
});

test("Pell: a typical eligible student is possibly eligible, because need and progress are the school's to confirm", () => {
  const outcome = pell(PELL_OK);
  assert.equal(outcome.result.outcome, "possibly_eligible");
  assert.equal(statusOf(outcome, "pell_award_amount"), "verify");
  assert.equal(statusOf(outcome, "pell_academic_progress"), "verify");
  assert.deepEqual(outcome.result.counts, { met: 6, not_met: 0, unknown: 0, verify: 2 });
});

test("Pell citizenship follows 34 CFR 668.33", () => {
  for (const value of ["us_citizen_or_national", "permanent_resident", "freely_associated_states"]) {
    assert.equal(statusOf(pell({ ...PELL_OK, citizenship: value }), "pell_citizenship"), "met", value);
  }
  for (const value of ["daca_or_undocumented", "student_visa", "other_temporary"]) {
    assert.equal(pell({ ...PELL_OK, citizenship: value }).result.outcome, "not_eligible", value);
  }
  assert.equal(statusOf(pell({ ...PELL_OK, citizenship: "not_sure" }), "pell_citizenship"), "verify");
});

test("Pell degree rule and its exceptions follow 34 CFR 668.32(c)(2)", () => {
  assert.equal(pell({ ...PELL_OK, highestDegree: "bachelor" }).result.outcome, "not_eligible");
  assert.equal(statusOf(pell({ ...PELL_OK, highestDegree: "bachelor", plannedProgram: "teacher_postbacc" }), "pell_no_prior_degree"), "verify");
  assert.equal(statusOf(pell({ ...PELL_OK, highestDegree: "bachelor", plannedProgram: "workforce_short_term" }), "pell_no_prior_degree"), "verify");
  // The workforce exception requires no graduate credential: (B)(2)(ii).
  assert.equal(statusOf(pell({ ...PELL_OK, highestDegree: "graduate_or_professional", plannedProgram: "workforce_short_term" }), "pell_no_prior_degree"), "not_met");
  assert.equal(statusOf(pell({ ...PELL_OK, highestDegree: "associate" }), "pell_no_prior_degree"), "met");
});

test("Pell lifetime limit: 599% leaves eligibility, 600% is the six-award limit", () => {
  assert.equal(statusOf(pell({ ...PELL_OK, pellLifetimeUsed: 599 }), "pell_lifetime_limit"), "met");
  assert.equal(statusOf(pell({ ...PELL_OK, pellLifetimeUsed: 600 }), "pell_lifetime_limit"), "not_met");
});

test("a withheld field leaves its rule unknown, never met or not met", () => {
  const { citizenship, ...rest } = PELL_OK;
  const outcome = pell(rest);
  assert.equal(statusOf(outcome, "pell_citizenship"), "unknown");
  assert.equal(outcome.result.outcome, "unknown");
  assert.deepEqual(outcome.result.received.sort(), Object.keys(rest).sort());
});

test("fields a publisher did not ask for are dropped before any rule runs", () => {
  const outcome = oog27({ ...OOG_OK });
  assert.deepEqual(outcome.result.notRequested.sort(), ["aidApplicationDate", "sai"]);
  assert.ok(!outcome.result.received.includes("sai"));
});

test("invalid values are refused, not guessed", () => {
  const outcome = pell({ ...PELL_OK, pellLifetimeUsed: 12.5 });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.field, "pellLifetimeUsed");
  assert.equal(pell({ ...PELL_OK, citizenship: "martian" }).ok, false);
  assert.equal(checkEligibility(PELL, { opportunityId: "nope", fields: {} }).ok, false);
});

test("Oregon 2026-27 boundaries match OSAC's published numbers", () => {
  assert.equal(oog26(OOG_OK).result.outcome, "possibly_eligible");
  assert.equal(statusOf(oog26({ ...OOG_OK, sai: 8000 }), "oog_sai_limit_2026_27"), "met");
  assert.equal(statusOf(oog26({ ...OOG_OK, sai: 8001 }), "oog_sai_limit_2026_27"), "not_met");
  assert.equal(statusOf(oog26({ ...OOG_OK, aidApplicationDate: "2026-05-15" }), "oog_cutoff_2026_27"), "met");
  assert.equal(statusOf(oog26({ ...OOG_OK, aidApplicationDate: "2026-05-16" }), "oog_cutoff_2026_27"), "not_met");
  assert.equal(statusOf(oog26({ ...OOG_OK, residenceMonths: 12 }), "oog_residency_12_months"), "met");
  assert.equal(statusOf(oog26({ ...OOG_OK, residenceMonths: 11 }), "oog_residency_12_months"), "not_met");
  assert.equal(statusOf(oog26({ ...OOG_OK, residenceState: "WA" }), "oog_oregon_resident"), "not_met");
  assert.equal(statusOf(oog26({ ...OOG_OK, religiousDegree: "yes" }), "oog_religious_degree"), "not_met");
});

test("Oregon accepts DACA students and refuses student visas, unlike Pell for DACA", () => {
  assert.equal(statusOf(oog27({ ...OOG_OK, citizenship: "daca_or_undocumented" }), "oog_not_admitted_for_education"), "met");
  assert.equal(statusOf(oog27({ ...OOG_OK, citizenship: "student_visa" }), "oog_not_admitted_for_education"), "not_met");
  assert.equal(statusOf(pell({ ...PELL_OK, citizenship: "daca_or_undocumented" }), "pell_citizenship"), "not_met");
});

test("Oregon 2027-28 asks for less and says the unpublished limit is to confirm", () => {
  const opp = OREGON.opportunities.find((item) => item.id === "oregon_opportunity_grant_2027_28");
  assert.ok(!opp.requestedFields.includes("sai"));
  assert.ok(!opp.requestedFields.includes("aidApplicationDate"));
  assert.equal(statusOf(oog27(OOG_OK), "oog_sai_limit_unpublished"), "verify");
});

test("the check action's input schema refuses extra keys and lists real ids", () => {
  const schema = checkInputSchema(OREGON);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.fields.additionalProperties, false);
  assert.deepEqual(schema.properties.opportunityId.enum, ["oregon_opportunity_grant_2026_27", "oregon_opportunity_grant_2027_28"]);
  assert.equal(schema.properties.fields.properties.sai.type, "integer");
});

test("published rules carry the exact decision tables the publisher checks with", () => {
  for (const doc of [PELL, OREGON]) {
    const published = publishedRules(doc);
    for (const [index, opp] of published.opportunities.entries()) {
      const own = doc.opportunities[index];
      assert.ok(opp.requestedFields.every((field) => field.label && typeof field.sensitive === "boolean" && field.why));
      assert.ok(opp.rules.every((rule) => rule.source.quote));
      assert.deepEqual(opp.rules.map((rule) => rule.check), own.rules.map((rule) => rule.check), opp.id);
      assert.deepEqual(opp.rules.map((rule) => rule.exceptions), own.rules.map((rule) => rule.exceptions || []), opp.id);
      // What a passport plans with passes the same validator the publisher uses.
      assert.deepEqual(publishedProblems(published, opp), [], opp.id);
    }
  }
});

test("a failure whose exception field was withheld stays unknown, never not met", () => {
  // Jordan: a bachelor's degree, starting a workforce program. With the program shared, the
  // workforce exception applies; withheld, the rule cannot be settled.
  const { plannedProgram, ...withheld } = { ...PELL_OK, highestDegree: "bachelor", plannedProgram: "workforce_short_term" };
  assert.equal(statusOf(pell({ ...withheld, plannedProgram }), "pell_no_prior_degree"), "verify");
  assert.equal(statusOf(pell(withheld), "pell_no_prior_degree"), "unknown");
  assert.notEqual(pell(withheld).result.outcome, "not_eligible");
  // An exception that cannot apply to the value (graduate degree, workforce) leaves "not met".
  const { plannedProgram: _p, ...graduate } = { ...PELL_OK, highestDegree: "graduate_or_professional" };
  const rule = PELL.opportunities[0].rules.find((item) => item.id === "pell_no_prior_degree");
  assert.equal(evaluateRule({ ...rule, exceptions: rule.exceptions.filter((item) => item.in.includes("workforce_short_term")) }, graduate).status, "not_met");
});

const MAYA = { residenceState: "OR", residenceMonths: 60, citizenship: "daca_or_undocumented", highSchool: "in_high_school", highestDegree: "none", plannedProgram: "undergraduate", collegeState: "OR", religiousDegree: "no", sai: 1200, pellLifetimeUsed: 0, federalAidProblem: "no" };
const JORDAN = { residenceState: "WA", residenceMonths: 30, citizenship: "us_citizen_or_national", highSchool: "diploma", highestDegree: "bachelor", plannedProgram: "workforce_short_term", collegeState: "WA", religiousDegree: "no", sai: 3000, aidApplicationDate: "2026-03-01", pellLifetimeUsed: 400, federalAidProblem: "no" };
const plan = (doc, id, values, shared) => planDisclosure(publishedRules(doc), id, values, shared).plan;

test("disclosure plan: a 'no' that only a sensitive field can confirm is advice to skip", () => {
  const shared = ["highSchool", "highestDegree", "plannedProgram", "pellLifetimeUsed"];
  const result = plan(PELL, "federal_pell_grant", MAYA, shared);
  assert.equal(result.advice, ADVICE.skip);
  assert.equal(result.expectedOutcome, "not_eligible");
  assert.deepEqual(result.needed, ["citizenship"]);
  assert.deepEqual(result.sensitiveNeeded, ["citizenship"]);
  assert.deepEqual(result.turnOff, shared);
  assert.deepEqual(result.decidingRules.map((rule) => [rule.id, rule.section]), [["pell_citizenship", "§ 668.33(a)"]]);
  // With the plan's one field, the publisher's own check gives the expected answer.
  assert.equal(pell({ citizenship: MAYA.citizenship }).result.outcome, "not_eligible");
});

test("disclosure plan: a 'yes' needs every field its rules check, and names what to turn on", () => {
  const result = plan(OREGON, "oregon_opportunity_grant_2027_28", MAYA, ["residenceState", "residenceMonths", "highestDegree", "plannedProgram", "collegeState", "religiousDegree"]);
  assert.equal(result.advice, ADVICE.share);
  assert.equal(result.expectedOutcome, "possibly_eligible");
  assert.deepEqual(result.turnOn, ["citizenship", "federalAidProblem"]);
  assert.deepEqual(result.turnOff, []);
  assert.ok(!result.needed.includes("sai"), "2027-28 does not ask for the SAI");
  const fields = Object.fromEntries(result.needed.map((id) => [id, MAYA[id]]));
  assert.equal(oog27(fields).result.outcome, "possibly_eligible");
});

test("disclosure plan: a missing passport field means fill it first, and a 'no' keeps the earliest rule", () => {
  const missing = plan(OREGON, "oregon_opportunity_grant_2026_27", MAYA, []);
  assert.equal(missing.advice, ADVICE.fill);
  assert.deepEqual(missing.missing, ["aidApplicationDate"]);
  assert.deepEqual(missing.needed, []);
  const jordan = plan(OREGON, "oregon_opportunity_grant_2027_28", JORDAN, ["residenceState", "collegeState"]);
  assert.equal(jordan.advice, ADVICE.confirm);
  assert.deepEqual(jordan.needed, ["residenceState"]);
  assert.deepEqual(jordan.turnOff, ["collegeState"]);
  // Jordan's Pell answer depends on the workforce exception, so the plan keeps the program.
  const jordanPell = plan(PELL, "federal_pell_grant", JORDAN, []);
  assert.equal(jordanPell.advice, ADVICE.share);
  assert.ok(jordanPell.needed.includes("plannedProgram") && jordanPell.needed.includes("highestDegree"));
});

test("disclosure plan: every plan is minimal, and the publisher's check agrees with it", () => {
  const cases = [[PELL, "federal_pell_grant"], [OREGON, "oregon_opportunity_grant_2026_27"], [OREGON, "oregon_opportunity_grant_2027_28"]];
  for (const values of [MAYA, JORDAN, { ...MAYA, citizenship: "permanent_resident" }, { ...JORDAN, highestDegree: "none", plannedProgram: "undergraduate" }]) {
    for (const [doc, id] of cases) {
      const result = plan(doc, id, values, []);
      const fields = (ids) => Object.fromEntries(ids.map((field) => [field, values[field]]));
      const actual = checkEligibility(doc, { opportunityId: id, fields: fields(result.needed) }, NOW).result.outcome;
      assert.equal(actual, result.expectedOutcome, `${id}: the publisher's check matches the preview`);
      if (result.advice !== ADVICE.fill) {
        for (const field of result.needed) {
          const fewer = checkEligibility(doc, { opportunityId: id, fields: fields(result.needed.filter((other) => other !== field)) }, NOW).result.outcome;
          assert.notEqual(fewer, result.expectedOutcome, `${id}: ${field} is needed`);
        }
      }
    }
  }
});

test("disclosure plan fails closed on rules the kit's validator rejects", () => {
  const published = publishedRules(PELL);
  delete published.opportunities[0].rules[0].source.quote;
  assert.equal(planDisclosure(published, "federal_pell_grant", MAYA, []).plan.advice, ADVICE.invalid);
  assert.equal(planDisclosure(published, "nope", MAYA, []).ok, false);
});

test("passport fields: schemas and validation agree", () => {
  for (const field of PASSPORT_FIELDS) {
    const schema = fieldSchema(field.id);
    assert.ok(schema.type, field.id);
  }
  assert.equal(fieldError("sai", -1500), null);
  assert.notEqual(fieldError("sai", -1501), null);
  assert.notEqual(fieldError("aidApplicationDate", "2026-13-40"), null);
  assert.equal(fieldError("aidApplicationDate", "2026-05-15"), null);
});

test("result view rejects malformed results and unsafe links", () => {
  assert.equal(resultProblem(pell(PELL_OK).result), null);
  assert.notEqual(resultProblem({ format: "openaward-result/v1", outcome: "hacked", rules: [] }), null);
  assert.notEqual(resultProblem({ format: "other" }), null);
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,x"), null);
  assert.equal(safeUrl("https://www.ecfr.gov/x"), "https://www.ecfr.gov/x");
});

test("the publisher's real action definitions register in the browser runtime", async () => {
  const { ActionRegistry } = await import("../publishers/pell-desk/runtime/actions.js");
  const { PublisherDesk } = await import("../publishers/pell-desk/kit/publisher-core.js");
  const registry = new ActionRegistry();
  const scope = { base: "http://localhost:8081", network: "pell_rules_desk" };
  for (const definition of PublisherDesk.actionDefinitions({ availability: "bridge", callerOrigins: ["*"] })) {
    registry.register(scope, definition);
  }
  assert.deepEqual(registry.catalog(scope).map((entry) => entry.name).sort(), ["check_eligibility", "get_published_rules"]);
  assert.equal(PublisherDesk.getPublishedRules().ok, true);
  assert.equal(PublisherDesk.check({ opportunityId: "federal_pell_grant", fields: PELL_OK }).result.outcome, "possibly_eligible");
});
