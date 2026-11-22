// OpenAward publisher kit: the rules engine.
//
// A publisher runs this on its own origin, over its own published rules document, with
// only the passport fields a student chose to send. It is deterministic: no model, no
// network, no storage. The same rules and fields always give the same result.
//
// Each rule ends in one of four statuses:
//   met      the shared value satisfies the published rule
//   not_met  the shared value fails the published rule
//   unknown  the rule needs a field the student did not share
//   verify   the rule cannot be settled from a profile (a school or the award office decides)
// The overall outcome follows from them, worst first:
//   not_eligible > unknown > possibly_eligible > eligible
//
// Part of the OpenAward publisher kit. Copied unchanged into each site by scripts/build.mjs.

import { FIELD_BY_ID, PROFILE_VERSION, fieldError, fieldSchema } from "./passport-fields.js";

export const RULES_FORMAT = "openaward-rules/v1";
export const RESULT_FORMAT = "openaward-result/v1";

export const OUTCOMES = {
  eligible: "eligible",
  possibly: "possibly_eligible",
  unknown: "unknown",
  notEligible: "not_eligible",
};

const STATUSES = new Set(["met", "not_met", "unknown", "verify"]);
const CHECK_TYPES = new Set(["enum", "min", "max", "onOrBefore", "verifyOnly"]);

/**
 * Check a rules document before it is published or used. Fails closed: a document with any
 * problem must not be used to answer a student.
 *
 * :param doc: The parsed rules document.
 * :return: A list of problems; empty when the document is usable.
 */
export function validateRules(doc) {
  const problems = [];
  if (!doc || doc.format !== RULES_FORMAT) {
    problems.push(`format must be "${RULES_FORMAT}".`);
    return problems;
  }
  if (doc.profileVersion !== PROFILE_VERSION) {
    problems.push(`profileVersion must be "${PROFILE_VERSION}".`);
  }
  if (!doc.publisher || !doc.publisher.name || !doc.publisher.disclaimer) {
    problems.push("publisher needs a name and a disclaimer.");
  }
  const ids = new Set();
  for (const opp of doc.opportunities || []) {
    const where = `opportunity ${opp.id || "(no id)"}`;
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(opp.id || "")) {
      problems.push(`${where}: id must be lower_snake_case.`);
    }
    if (ids.has(opp.id)) {
      problems.push(`${where}: duplicate id.`);
    }
    ids.add(opp.id);
    for (const key of ["title", "owner", "officialUrl", "rulesCheckedAt", "summary"]) {
      if (!opp[key]) {
        problems.push(`${where}: missing ${key}.`);
      }
    }
    if (opp.officialUrl && !/^https:\/\//.test(opp.officialUrl)) {
      problems.push(`${where}: officialUrl must be https.`);
    }
    const ruleIds = new Set();
    const used = new Set();
    for (const rule of opp.rules || []) {
      const at = `${where} rule ${rule.id || "(no id)"}`;
      if (!rule.id || ruleIds.has(rule.id)) {
        problems.push(`${at}: needs a unique id.`);
      }
      ruleIds.add(rule.id);
      if (!rule.title) {
        problems.push(`${at}: missing title.`);
      }
      if (!rule.source || !/^https:\/\//.test(rule.source.url || "") || !rule.source.title || !rule.source.quote) {
        problems.push(`${at}: source needs an https url, a title and a verbatim quote.`);
      }
      const check = rule.check || {};
      if (!CHECK_TYPES.has(check.type)) {
        problems.push(`${at}: check.type must be one of ${[...CHECK_TYPES].join(", ")}.`);
        continue;
      }
      if (check.type === "verifyOnly") {
        if (!check.reason) {
          problems.push(`${at}: a verifyOnly check needs a reason.`);
        }
        continue;
      }
      const field = FIELD_BY_ID[rule.field];
      if (!field) {
        problems.push(`${at}: unknown passport field "${rule.field}".`);
        continue;
      }
      used.add(rule.field);
      if (check.type === "enum") {
        if (field.type !== "enum") {
          problems.push(`${at}: an enum check needs an enum field.`);
        }
        for (const [value, outcome] of Object.entries(check.cases || {})) {
          if (fieldError(rule.field, value)) {
            problems.push(`${at}: case "${value}" is not a value of ${rule.field}.`);
          }
          if (!STATUSES.has(outcome.status) || outcome.status === "unknown" || !outcome.reason) {
            problems.push(`${at}: case "${value}" needs status met, not_met or verify, and a reason.`);
          }
        }
        if (check.otherwise && (!["not_met", "verify"].includes(check.otherwise.status) || !check.otherwise.reason)) {
          problems.push(`${at}: otherwise needs status not_met or verify, and a reason.`);
        }
        if (field.type === "enum" && !check.otherwise) {
          for (const [code] of field.options) {
            if (!check.cases || !check.cases[code]) {
              problems.push(`${at}: no case for "${code}". Every value needs an explicit answer, or add "otherwise".`);
            }
          }
        }
      } else {
        const numeric = check.type === "min" || check.type === "max";
        if (numeric && (field.type !== "integer" || !Number.isFinite(check.value))) {
          problems.push(`${at}: a ${check.type} check needs an integer field and a numeric value.`);
        }
        if (check.type === "onOrBefore" && (field.type !== "date" || fieldError(rule.field, check.value))) {
          problems.push(`${at}: an onOrBefore check needs a date field and a YYYY-MM-DD value.`);
        }
        if (!check.metReason || !check.notMetReason) {
          problems.push(`${at}: needs metReason and notMetReason.`);
        }
      }
      for (const exception of rule.exceptions || []) {
        if (!FIELD_BY_ID[exception.field] || !Array.isArray(exception.in) || exception.status !== "verify" || !exception.reason) {
          problems.push(`${at}: an exception needs a field, an "in" list, status verify and a reason.`);
        } else {
          used.add(exception.field);
        }
        for (const value of [...(exception.in || []), ...(exception.onlyFor || [])]) {
          const id = (exception.in || []).includes(value) ? exception.field : rule.field;
          if (fieldError(id, value)) {
            problems.push(`${at}: exception value "${value}" is not a value of ${id}.`);
          }
        }
      }
    }
    const requested = new Set(opp.requestedFields || []);
    for (const id of used) {
      if (!requested.has(id)) {
        problems.push(`${where}: rule field "${id}" is not in requestedFields.`);
      }
    }
    for (const id of requested) {
      if (!used.has(id)) {
        problems.push(`${where}: requestedFields lists "${id}", which no rule uses. Ask only for what you check.`);
      }
    }
    if (!(opp.rules || []).length) {
      problems.push(`${where}: has no rules.`);
    }
  }
  if (!ids.size) {
    problems.push("no opportunities.");
  }
  return problems;
}

/**
 * Settle one rule against the shared fields.
 *
 * :param rule: A rule from the document.
 * :param fields: The shared fields, already validated.
 * :return: {status, reason}.
 */
export function evaluateRule(rule, fields) {
  const check = rule.check;
  if (check.type === "verifyOnly") {
    return { status: "verify", reason: check.reason };
  }
  if (!Object.hasOwn(fields, rule.field)) {
    return { status: "unknown", reason: `You did not share "${FIELD_BY_ID[rule.field].label}", so this rule cannot be checked.` };
  }
  const value = fields[rule.field];
  let settled;
  if (check.type === "enum") {
    settled = { ...((check.cases || {})[value] || check.otherwise) };
  } else if (check.type === "min") {
    settled = value >= check.value ? { status: "met", reason: check.metReason } : { status: "not_met", reason: check.notMetReason };
  } else if (check.type === "max") {
    settled = value <= check.value ? { status: "met", reason: check.metReason } : { status: "not_met", reason: check.notMetReason };
  } else {
    settled = value <= check.value ? { status: "met", reason: check.metReason } : { status: "not_met", reason: check.notMetReason };
  }
  // An exception can only soften a failure into "verify": it never turns a failure into a pass.
  // When the field that decides an exception was not shared, the failure is not settled:
  // the rule stays "unknown" rather than claiming "not met".
  if (settled.status === "not_met") {
    let undecided = null;
    for (const exception of rule.exceptions || []) {
      if (exception.onlyFor && !exception.onlyFor.includes(value)) {
        continue;
      }
      if (!Object.hasOwn(fields, exception.field)) {
        undecided ||= exception.field;
      } else if (exception.in.includes(fields[exception.field])) {
        return { status: "verify", reason: exception.reason };
      }
    }
    if (undecided) {
      return { status: "unknown", reason: `Not met as shared, unless an exception applies. You did not share "${FIELD_BY_ID[undecided].label}", which decides the exception.` };
    }
  }
  return settled;
}

/**
 * Work out the overall outcome from the rule statuses, worst first.
 *
 * :param statuses: The status of every rule.
 * :return: One of OUTCOMES.
 */
export function overallOutcome(statuses) {
  if (statuses.includes("not_met")) {
    return OUTCOMES.notEligible;
  }
  if (statuses.includes("unknown")) {
    return OUTCOMES.unknown;
  }
  if (statuses.includes("verify")) {
    return OUTCOMES.possibly;
  }
  return OUTCOMES.eligible;
}

/**
 * A one-sentence headline for an outcome, with the counts behind it.
 *
 * :param outcome: One of OUTCOMES.
 * :param counts: How many rules ended in each status.
 * :return: The headline.
 */
export function headline(outcome, counts) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (outcome === OUTCOMES.notEligible) {
    return `Does not meet ${plural(counts.not_met, "published rule")}, based on what you shared.`;
  }
  if (outcome === OUTCOMES.unknown) {
    return `Can't tell yet: ${plural(counts.unknown, "rule")} need${counts.unknown === 1 ? "s" : ""} a field you did not share.`;
  }
  if (outcome === OUTCOMES.possibly) {
    return `Meets every rule that can be checked from what you shared. ${plural(counts.verify, "rule")} must be confirmed by your school or the award office.`;
  }
  return "Meets every published screening rule. This is a screening result, not an award decision.";
}

/**
 * The input schema of a publisher's check action: the opportunity, and the passport
 * fields any of its opportunities use. Extra keys are refused.
 *
 * :param doc: A valid rules document.
 * :return: The JSON Schema.
 */
export function checkInputSchema(doc) {
  const fieldIds = [...new Set(doc.opportunities.flatMap((opp) => opp.requestedFields))];
  return {
    type: "object",
    additionalProperties: false,
    required: ["opportunityId", "fields"],
    properties: {
      opportunityId: {
        type: "string",
        enum: doc.opportunities.map((opp) => opp.id),
        description: "The opportunity id from this publisher's rules.",
      },
      fields: {
        type: "object",
        additionalProperties: false,
        description: "Only the passport fields the student chose to share. Leave out anything they did not share.",
        properties: Object.fromEntries(fieldIds.map((id) => [id, fieldSchema(id)])),
      },
    },
  };
}

/**
 * Check one student's shared fields against one opportunity's published rules.
 *
 * :param doc: A valid rules document.
 * :param request: {opportunityId, fields}.
 * :param options: {now}, the evaluation time, for tests.
 * :return: {ok: true, result} or {ok: false, reason} when the request is refused.
 */
export function checkEligibility(doc, request, options = {}) {
  const problems = validateRules(doc);
  if (problems.length) {
    return { ok: false, reason: `This publisher's rules failed validation, so no result was given: ${problems[0]}` };
  }
  const opp = doc.opportunities.find((item) => item.id === request?.opportunityId);
  if (!opp) {
    return { ok: false, reason: `Unknown opportunity "${request?.opportunityId}". Read the published rules for the ids.` };
  }
  const shared = request.fields && typeof request.fields === "object" ? request.fields : {};
  const fields = {};
  const notRequested = [];
  for (const [id, value] of Object.entries(shared)) {
    if (!opp.requestedFields.includes(id)) {
      // Data the publisher did not ask for is dropped before any rule runs.
      notRequested.push(id);
      continue;
    }
    const error = fieldError(id, value);
    if (error) {
      return { ok: false, reason: error, field: id };
    }
    fields[id] = value;
  }
  const counts = { met: 0, not_met: 0, unknown: 0, verify: 0 };
  const rules = opp.rules.map((rule) => {
    const settled = evaluateRule(rule, fields);
    counts[settled.status] += 1;
    return {
      id: rule.id,
      title: rule.title,
      field: rule.field || null,
      status: settled.status,
      reason: settled.reason,
      source: { title: rule.source.title, url: rule.source.url, section: rule.source.section || "", quote: rule.source.quote },
      nextStep: rule.nextStep || "",
    };
  });
  const outcome = overallOutcome(rules.map((rule) => rule.status));
  return {
    ok: true,
    result: {
      format: RESULT_FORMAT,
      publisher: doc.publisher.name,
      opportunity: { id: opp.id, title: opp.title, awardYear: opp.awardYear || "", owner: opp.owner, officialUrl: opp.officialUrl },
      outcome,
      headline: headline(outcome, counts),
      counts,
      rules,
      received: Object.keys(fields),
      notRequested,
      rulesCheckedAt: opp.rulesCheckedAt,
      evaluatedAt: (options.now || new Date()).toISOString(),
      evaluatedBy: "Deterministic publisher kit on the publisher's origin. No model was used.",
      disclaimer: doc.publisher.disclaimer,
    },
  };
}

/**
 * The public part of a rules document that a passport needs before it asks: each
 * opportunity, the fields it requests and why, and its rules with their decision tables
 * and sources. The decision tables let a passport plan, on the student's device, the
 * fewest fields worth sharing (kit/disclosure.js) before it sends anything.
 *
 * :param doc: A valid rules document.
 * :return: Plain JSON data, a copy: changing it never changes the publisher's rules.
 */
export function publishedRules(doc) {
  return structuredClone({
    format: doc.format,
    profileVersion: doc.profileVersion,
    publisher: doc.publisher,
    opportunities: doc.opportunities.map((opp) => ({
      id: opp.id,
      title: opp.title,
      awardYear: opp.awardYear || "",
      owner: opp.owner,
      officialUrl: opp.officialUrl,
      summary: opp.summary,
      rulesCheckedAt: opp.rulesCheckedAt,
      requestedFields: opp.requestedFields.map((id) => ({ id, label: FIELD_BY_ID[id].label, sensitive: FIELD_BY_ID[id].sensitive, why: (opp.fieldReasons || {})[id] || "" })),
      rules: opp.rules.map((rule) => ({
        id: rule.id, title: rule.title, field: rule.field || null, check: rule.check, exceptions: rule.exceptions || [], source: rule.source, nextStep: rule.nextStep || "",
      })),
    })),
  });
}
