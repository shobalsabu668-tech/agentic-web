// OpenAward publisher kit: the disclosure planner.
//
// A passport runs this on the student's own device, over a publisher's *published* rules,
// before anything is sent. For one opportunity it works out the fewest passport fields
// that still give the publisher's check a definite answer, and what that answer should be
// by the published rules. It contacts no one and stores nothing.
//
// It is a preview, used only to decide what to share. The publisher's own check, on its
// own origin, stays the answer.
//
// The plan is greedy and deterministic: start from every filled field the opportunity
// requests, then drop fields one at a time, sensitive fields first, while the expected
// outcome stays the same. What is left is a minimal set: no single field can be dropped
// without changing the answer. It is not always the smallest possible set, but it never
// keeps a sensitive field that a non-sensitive one could replace.
//
// Advice:
//   skip                  expected "not eligible", and every way to get a definite answer
//                         reveals a sensitive field
//   confirm_with_minimum  expected "not eligible"; a few non-sensitive fields confirm it
//   share_needed          expected "eligible" or "possibly eligible"; these fields are needed
//   fill_passport_first   the passport lacks fields the answer needs; sharing now only
//                         gets "can't tell yet"
//   rules_invalid         the published rules did not validate, so there is no plan
//
// Part of the OpenAward publisher kit. Copied unchanged into each site by scripts/build.mjs.

import { FIELD_BY_ID } from "./passport-fields.js";
import { OUTCOMES, evaluateRule, overallOutcome, validateRules } from "./eligibility.js";

export const ADVICE = {
  skip: "skip",
  confirm: "confirm_with_minimum",
  share: "share_needed",
  fill: "fill_passport_first",
  invalid: "rules_invalid",
};

/**
 * Check a published opportunity with the publisher kit's own validator, so a plan is
 * never built on rules a publisher could not publish. Fails closed.
 *
 * :param published: A get_published_rules document (requestedFields as objects).
 * :param opp: One of its opportunities.
 * :return: The problems; empty when the opportunity is usable.
 */
export function publishedProblems(published, opp) {
  const doc = {
    format: published?.format,
    profileVersion: published?.profileVersion,
    publisher: published?.publisher,
    opportunities: [{ ...opp, requestedFields: (opp?.requestedFields || []).map((field) => field?.id ?? field) }],
  };
  return validateRules(doc);
}

function pick(values, ids) {
  return Object.fromEntries(ids.map((id) => [id, values[id]]));
}

function evaluate(opp, values, ids) {
  const fields = pick(values, ids);
  const rules = opp.rules.map((rule) => ({ rule, ...evaluateRule(rule, fields) }));
  return { rules, outcome: overallOutcome(rules.map((item) => item.status)) };
}

/**
 * Plan the fewest fields to share for one opportunity.
 *
 * :param published: The publisher's published rules (from get_published_rules).
 * :param opportunityId: The opportunity id.
 * :param values: The student's passport fields, already valid.
 * :param shared: The ids the student shares with this publisher for it now.
 * :return: {ok: true, plan} or {ok: false, reason}. The plan holds field ids, never values.
 */
export function planDisclosure(published, opportunityId, values, shared = []) {
  const opp = (published?.opportunities || []).find((item) => item.id === opportunityId);
  if (!opp) {
    return { ok: false, reason: `The publisher has no opportunity "${opportunityId}".` };
  }
  const problems = publishedProblems(published, opp);
  if (problems.length) {
    return { ok: true, plan: { advice: ADVICE.invalid, problem: problems[0] } };
  }
  const requested = opp.requestedFields.map((field) => field.id ?? field);
  const filled = requested.filter((id) => Object.hasOwn(values, id));
  const missing = requested.filter((id) => !Object.hasOwn(values, id));
  const full = evaluate(opp, values, filled);

  // Drop sensitive fields first, so the plan reveals as little sensitive data as it can.
  // Within each group, drop later fields first, so the publisher's earlier rules decide.
  const order = [...filled].reverse().sort((a, b) => Number(Boolean(FIELD_BY_ID[b]?.sensitive)) - Number(Boolean(FIELD_BY_ID[a]?.sensitive)));
  const keep = new Set(filled);
  for (const id of order) {
    const trial = filled.filter((other) => keep.has(other) && other !== id);
    if (evaluate(opp, values, trial).outcome === full.outcome) {
      keep.delete(id);
    }
  }
  const needed = filled.filter((id) => keep.has(id));
  const planned = evaluate(opp, values, needed);
  const sensitiveNeeded = needed.filter((id) => FIELD_BY_ID[id]?.sensitive);
  const sharedNow = requested.filter((id) => shared.includes(id));
  const current = evaluate(opp, values, sharedNow.filter((id) => Object.hasOwn(values, id)));

  let advice;
  let decidingStatus;
  if (full.outcome === OUTCOMES.notEligible) {
    advice = sensitiveNeeded.length ? ADVICE.skip : ADVICE.confirm;
    decidingStatus = "not_met";
  } else if (full.outcome === OUTCOMES.unknown) {
    advice = ADVICE.fill;
    decidingStatus = "unknown";
  } else {
    advice = ADVICE.share;
    decidingStatus = "verify";
  }
  const describe = ({ rule, status, reason }) => ({
    id: rule.id, title: rule.title, status, reason, sourceTitle: rule.source?.title || "", section: rule.source?.section || "", sourceUrl: rule.source?.url || "",
  });
  // A passport that lacks fields gets the rules those fields would settle.
  const basis = advice === ADVICE.fill ? full : planned;
  return {
    ok: true,
    plan: {
      advice,
      expectedOutcome: planned.outcome,
      currentOutcome: current.outcome,
      needed,
      sensitiveNeeded,
      notNeeded: filled.filter((id) => !keep.has(id)),
      missing,
      sharedNow,
      turnOff: sharedNow.filter((id) => !keep.has(id)),
      turnOn: needed.filter((id) => !sharedNow.includes(id)),
      decidingRules: basis.rules.filter((item) => item.status === decidingStatus).map(describe),
    },
  };
}
