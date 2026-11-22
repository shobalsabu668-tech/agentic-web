// Registers the passport's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
//
// Data minimization is the design: the model never reads the passport's values in bulk.
// get_passport_status names which fields are filled, not what they hold. A disclosure plan
// names fields and what the publisher's published rules would decide, never values. Values
// reach the model only through prepare_publisher_request, for one opportunity, and only
// the fields the student turned on for that publisher on the page.
//
// The assistant can share less, never more: apply_disclosure_plan only turns sharing off,
// and turning a field on is always the student's click. Every change the assistant makes
// to the page (apply_disclosure_plan, add_checklist_item) is shown to the student, with
// its destination and arguments, before it runs. Every contact with a publisher needs the
// student's OK first: the page's dialog for reading rules, the runtime's card for a check.
import { PUBLISHERS } from "./js/publisher-directory.js";
import { App } from "./js/app.js";

const OPPORTUNITY_KEY = {
  type: "string",
  minLength: 3,
  maxLength: 120,
  description: "The opportunity key from website_get_passport_status or website_plan_disclosure, such as pell:federal_pell_grant.",
};

class SiteActions {
  static registerActions(actions) {
    actions.register(SiteActions.statusAction());
    actions.register(SiteActions.readRulesAction());
    actions.register(SiteActions.planAction());
    actions.register(SiteActions.applyPlanAction());
    actions.register(SiteActions.prepareAction());
    actions.register(SiteActions.checklistAction());
  }

  static statusAction() {
    return {
      name: "get_passport_status",
      description: "Read the passport's state on this page: today's date, which fields are filled (names only, never values), each publisher with its page link and partner tool, the opportunities the student has loaded with what they share and withhold, the latest screening result of each (outcome, headline, each rule's status, reason, source and next step), and the checklist. Changes nothing. Call it before answering about results, publishers or next steps, and again in each turn that needs it: the student also uses the page.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => App.page.getStatus(),
    };
  }

  static readRulesAction() {
    return {
      name: "read_publisher_rules",
      description: "Read the published rules of publishers in this passport's directory whose rules are not read yet, so their opportunities can be planned and checked. It sends nothing about the student. The page first shows one dialog that names each publisher's origin, and the student decides. Returns which were read, or ok false if the student declined.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          publisherIds: {
            type: "array",
            maxItems: PUBLISHERS.length,
            items: { type: "string", enum: PUBLISHERS.map((publisher) => publisher.id) },
            description: "Publisher ids from website_get_passport_status. Leave out to read every publisher not read yet.",
          },
        },
      },
      execute: (args) => App.page.assistantReadRules(args.publisherIds || []),
    };
  }

  static planAction() {
    return {
      name: "plan_disclosure",
      description: "Work out, on this device, the least the student needs to share with each publisher. For each loaded opportunity: advice (skip, confirm_with_minimum, share_needed, fill_passport_first or rules_invalid), a one-sentence summary, the answer the publisher's published rules would give, the fewest fields for a definite answer and which are sensitive, fields not needed, fields missing from the passport, what the student shares now, what the plan would turn off, what the student would have to turn on, and the rules that decide it with sources. It also lists publishers whose rules are not read yet. Sends nothing, changes nothing, and holds field names, never values. It is a preview from published rules: only the publisher's own check is its answer.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { opportunityKey: { ...OPPORTUNITY_KEY, description: "Optional. One opportunity key; leave out for every loaded opportunity." } },
      },
      execute: (args) => App.page.getPlans(args.opportunityKey),
    };
  }

  static applyPlanAction() {
    return {
      name: "apply_disclosure_plan",
      description: "Call it only when the student asks to follow a plan. Turns off sharing of the fields the plan does not need, for one opportunity. It never turns sharing on: tell the student which fields they would turn on themselves on the page. The page shows the change and asks the student first. Returns what was turned off and what is shared now, or ok false if the student kept their choices.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["opportunityKey"],
        properties: { opportunityKey: OPPORTUNITY_KEY },
      },
      execute: (args) => App.page.assistantApplyPlan(args.opportunityKey),
    };
  }

  static prepareAction() {
    return {
      name: "prepare_publisher_request",
      description: "Get the exact check request the student approved for one opportunity: the partner tool to call and requestText, which holds only the fields the student chose to share with that publisher. Call it in the same turn, right before you call that partner tool, and send requestText unchanged. If it returns ok false, tell the student the reason: they choose what to share on the page. Changes nothing.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["opportunityKey"],
        properties: { opportunityKey: OPPORTUNITY_KEY },
      },
      execute: (args) => App.page.prepareRequest(args.opportunityKey),
    };
  }

  static checklistAction() {
    return {
      name: "add_checklist_item",
      description: "Call it only when the student asks. Add one next step to the checklist on this page, with an optional source link from a result. The page shows the item and asks the student first; they can remove it later. Returns the checklist, or ok false with a reason.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: { type: "string", minLength: 1, maxLength: 300, description: "The next step, in the student's words or from a result's next step." },
          sourceUrl: { type: "string", maxLength: 500, description: "Optional http(s) source link from a result." },
        },
      },
      execute: (args) => App.page.assistantAddChecklist(args),
    };
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;
