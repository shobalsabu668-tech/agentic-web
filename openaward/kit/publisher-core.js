// OpenAward publisher kit: a publisher's two actions over its own rules.json.
//
// The publisher's page (site-actions.js) and its action bridge (bridge/bridge-actions.js)
// both register these, so the publisher's own assistant and every caller site run the
// same rules code, on the publisher's origin. Nothing here reads or changes a page, so the
// bridge frame, which has none, can load it.
//
// Part of the OpenAward publisher kit. Copied unchanged into each publisher site by
// scripts/build.mjs, which expects the site's rules in <site>/rules.json.

import RULES from "../rules.json" with { type: "json" };
import { checkEligibility, checkInputSchema, publishedRules, validateRules } from "./eligibility.js";

export class PublisherDesk {
  static RULES = RULES;

  /**
   * Problems with this site's rules. A non-empty list makes both actions refuse.
   */
  static PROBLEMS = validateRules(RULES);

  /**
   * The read of this publisher's public rules.
   *
   * :return: {ok, rules} or {ok: false, reason}.
   */
  static getPublishedRules() {
    if (PublisherDesk.PROBLEMS.length) {
      return { ok: false, reason: `This publisher's rules failed validation: ${PublisherDesk.PROBLEMS[0]}` };
    }
    return { ok: true, rules: publishedRules(RULES) };
  }

  /**
   * Check shared passport fields against one opportunity.
   *
   * :param args: {opportunityId, fields}, already validated against the input schema.
   * :return: {ok: true, result} or {ok: false, reason}.
   */
  static check(args) {
    return checkEligibility(RULES, args);
  }

  /**
   * The two action definitions. The page registers them local-only; the bridge shares
   * them with other origins.
   *
   * :param extra: Fields to add to each definition, such as availability and callerOrigins.
   * :return: The definitions.
   */
  static actionDefinitions(extra = {}) {
    const ids = RULES.opportunities.map((opp) => opp.id).join(", ");
    return [
      {
        name: "get_published_rules",
        description: `Read this publisher's published award rules: each opportunity's id (${ids}), title, award year, owner, official link, the passport fields it asks for and why, and every rule with its verbatim source quote and link. Changes nothing. Call it before answering about the rules, and to find an opportunity id.`,
        effect: "read",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute: PublisherDesk.getPublishedRules,
        ...extra,
      },
      {
        name: "check_eligibility",
        description: "Screen passport fields against one opportunity's published rules, with this publisher's own deterministic rules code. Pass only the fields the request gives, with their exact codes. Never add, guess or change a field. Returns the outcome (eligible, possibly_eligible, unknown or not_eligible), each rule's status, reason and source, and which fields were received. Changes nothing and stores nothing.",
        effect: "read",
        inputSchema: checkInputSchema(RULES),
        execute: PublisherDesk.check,
        ...extra,
      },
    ];
  }
}
