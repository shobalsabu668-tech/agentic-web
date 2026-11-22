// OpenAward Passport page.
//
// One page object, App.page, holds the passport and the tab's working state. The page's
// own controls and the assistant's website_* tools (site-actions.js) both call it, so they
// follow one set of rules. Contacting a publisher always goes through askConsent() first.

import { FIELD_BY_ID, PASSPORT_FIELDS, fieldError, valueLabel } from "../kit/passport-fields.js";
import { ADVICE, planDisclosure } from "../kit/disclosure.js";
import { OUTCOME_TEXT, STATUS_TEXT, outcomeBadge, renderResult, resultProblem, safeUrl } from "../kit/result-view.js";
import { BridgeGuard } from "./bridge-guard.js";
import { PassportStore } from "./passport-store.js";
import { PUBLISHERS, parseNetworkUrl } from "./publisher-directory.js";
import { PublisherLink } from "./publisher-link.js";

const RULES_FORMAT = "openaward-rules/v1";
const PLAN_NOTE = "Calculated here from published rules. Nothing was sent. Only a publisher check is a screening result.";

export const SAMPLES = [
  {
    id: "maya",
    label: "Maya",
    fields: {
      residenceState: "OR", residenceMonths: 60, citizenship: "daca_or_undocumented", highSchool: "in_high_school",
      highestDegree: "none", plannedProgram: "undergraduate", collegeState: "OR", religiousDegree: "no",
      sai: 1200, pellLifetimeUsed: 0, federalAidProblem: "no",
    },
  },
  {
    id: "jordan",
    label: "Jordan",
    fields: {
      residenceState: "WA", residenceMonths: 30, citizenship: "us_citizen_or_national", highSchool: "diploma",
      highestDegree: "bachelor", plannedProgram: "workforce_short_term", collegeState: "WA", religiousDegree: "no",
      sai: 3000, aidApplicationDate: "2026-03-01", pellLifetimeUsed: 400, federalAidProblem: "no",
    },
  },
];

const GROUPS = [
  ["Where you live", ["residenceState", "residenceMonths"]],
  ["Status", ["citizenship"]],
  ["Education", ["highSchool", "highestDegree", "plannedProgram", "collegeState", "religiousDegree"]],
  ["Financial aid", ["sai", "aidApplicationDate", "pellLifetimeUsed", "federalAidProblem"]],
];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    if (key === "class") {
      node.className = value;
    } else if (key === "text") {
      node.textContent = String(value);
    } else if (key.startsWith("on")) {
      node.addEventListener(key.slice(2), value);
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) {
      node.append(child);
    }
  }
  return node;
}

let dialogQueue = Promise.resolve();

/**
 * Ask before any contact with another origin, or before the assistant changes this page.
 * Names the destination, the purpose and exactly what will be sent or changed. Escape and
 * the decline button both decline. Dialogs queue, so two requests never stack.
 *
 * :param info: {title, origin, purpose, sends: [[label, value]], allow, decline}.
 * :return: A promise of true when the student allows it.
 */
export function askConsent(info) {
  const shown = dialogQueue.then(() => showConsent(info));
  dialogQueue = shown.catch(() => false);
  return shown;
}

function showConsent(info) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const dialog = el("dialog", { class: "consent", "aria-labelledby": "consent-title" });
    const heading = el("h2", { id: "consent-title", tabindex: "-1", text: info.title });
    const where = el("p", { class: "consent-origin" }, "Destination: ", el("strong", { text: info.origin }));
    const list = el("dl", { class: "consent-sends" });
    for (const [label, value] of info.sends) {
      list.append(el("dt", { text: label }), el("dd", { text: value }));
    }
    const allow = el("button", { type: "button", class: "primary", text: info.allow });
    const decline = el("button", { type: "button", class: "ghost", text: info.decline || "Don't contact" });
    const finish = (answer) => {
      dialog.close();
      dialog.remove();
      if (previous && typeof previous.focus === "function" && document.contains(previous)) {
        previous.focus();
      }
      resolve(answer);
    };
    allow.addEventListener("click", () => finish(true));
    decline.addEventListener("click", () => finish(false));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.append(heading, where, el("p", { text: info.purpose }), list, el("div", { class: "consent-actions" }, allow, decline));
    document.body.append(dialog);
    dialog.showModal();
    // Start on the heading, which Enter cannot activate, so a stray Enter allows nothing.
    heading.focus();
  });
}

export class App {
  static page = null;

  constructor() {
    const loaded = PassportStore.load();
    this.fields = loaded.fields;
    this.mode = loaded.mode;
    this.session = loaded.session;
    this.session.rules ||= {};
    this.links = new Map();
    this.busy = new Set();
    // Bridge calls the page flow makes itself, which it records itself.
    this.pageCalls = new Set();
  }

  // ---- state the assistant reads --------------------------------------------------

  /**
   * Keep only what this page can use safely from a publisher's published rules: other-origin
   * data, so drop opportunities with odd ids and requested fields outside the vocabulary.
   *
   * :param rules: The publisher's get_published_rules result.
   * :return: The cleaned rules.
   */
  static cleanPublished(rules) {
    const text = (value, max = 2000) => String(value ?? "").slice(0, max);
    const opportunities = (Array.isArray(rules?.opportunities) ? rules.opportunities : [])
      .filter((opp) => opp && /^[a-z][a-z0-9_]{1,63}$/.test(opp.id || ""))
      .slice(0, 20)
      .map((opp) => ({
        id: opp.id,
        title: text(opp.title, 200),
        awardYear: text(opp.awardYear, 40),
        owner: text(opp.owner, 200),
        officialUrl: safeUrl(opp.officialUrl) || "",
        summary: text(opp.summary),
        rulesCheckedAt: text(opp.rulesCheckedAt, 20),
        requestedFields: (Array.isArray(opp.requestedFields) ? opp.requestedFields : [])
          .filter((field) => field && FIELD_BY_ID[field.id])
          .map((field) => ({ id: field.id, label: FIELD_BY_ID[field.id].label, sensitive: FIELD_BY_ID[field.id].sensitive, why: text(field.why, 400) })),
        rules: (Array.isArray(opp.rules) ? opp.rules : []).slice(0, 60).map(App.cleanRule).filter(Boolean),
      }));
    return {
      format: rules?.format,
      profileVersion: text(rules?.profileVersion, 40),
      publisher: { name: text(rules?.publisher?.name, 200), disclaimer: text(rules?.publisher?.disclaimer), keepsData: text(rules?.publisher?.keepsData, 400) },
      opportunities,
    };
  }

  /**
   * Keep one published rule's decision table in the kit's shape, from other-origin data.
   * Values outside the passport vocabulary are dropped. The kit's validator then checks
   * the result before any plan uses it, so anything malformed fails closed.
   *
   * :param rule: A rule from get_published_rules.
   * :return: The cleaned rule, or null.
   */
  static cleanRule(rule) {
    const text = (value, max = 600) => String(value ?? "").slice(0, max);
    if (!rule || typeof rule !== "object" || !/^[a-z][a-z0-9_]{0,63}$/.test(rule.id || "")) {
      return null;
    }
    const field = FIELD_BY_ID[rule.field] ? rule.field : null;
    const check = rule.check && typeof rule.check === "object" ? rule.check : {};
    const answer = (value) => (value && typeof value === "object" ? { status: text(value.status, 20), reason: text(value.reason) } : null);
    let clean;
    if (check.type === "enum") {
      const cases = {};
      for (const [value, outcome] of Object.entries(check.cases && typeof check.cases === "object" ? check.cases : {})) {
        if (field && !fieldError(field, value)) {
          cases[value] = answer(outcome);
        }
      }
      clean = { type: "enum", cases };
      if (check.otherwise) {
        clean.otherwise = answer(check.otherwise);
      }
    } else if (["min", "max", "onOrBefore"].includes(check.type)) {
      clean = { type: check.type, value: check.type === "onOrBefore" ? text(check.value, 10) : Number(check.value), metReason: text(check.metReason), notMetReason: text(check.notMetReason) };
    } else if (check.type === "verifyOnly") {
      clean = { type: "verifyOnly", reason: text(check.reason) };
    } else {
      clean = { type: "unsupported" };
    }
    const values = (list) => (Array.isArray(list) ? list.slice(0, 20).map((value) => text(value, 64)) : []);
    const exceptions = (Array.isArray(rule.exceptions) ? rule.exceptions : []).slice(0, 10)
      .filter((exception) => exception && FIELD_BY_ID[exception.field])
      .map((exception) => ({
        field: exception.field, in: values(exception.in), ...(Array.isArray(exception.onlyFor) ? { onlyFor: values(exception.onlyFor) } : {}),
        status: text(exception.status, 20), reason: text(exception.reason),
      }));
    const source = rule.source && typeof rule.source === "object" ? rule.source : {};
    return {
      id: rule.id, title: text(rule.title, 200), field, check: clean, exceptions,
      source: { title: text(source.title, 200), url: safeUrl(source.url) || "", section: text(source.section, 80), quote: text(source.quote, 2000) },
      nextStep: text(rule.nextStep, 400),
    };
  }

  /**
   * Opportunity key, unique across publishers.
   */
  static key(publisherId, opportunityId) {
    return `${publisherId}:${opportunityId}`;
  }

  /**
   * Every opportunity the student has loaded from a publisher.
   *
   * :return: [{publisher, opp, key}].
   */
  opportunities() {
    const out = [];
    for (const publisher of PUBLISHERS) {
      const rules = this.session.rules[publisher.id];
      for (const opp of rules?.opportunities || []) {
        out.push({ publisher, opp, key: App.key(publisher.id, opp.id) });
      }
    }
    return out;
  }

  /**
   * Which requested fields are shared for one opportunity. The default shares filled,
   * non-sensitive fields; a sensitive field is shared only when the student turns it on.
   *
   * :param key: Opportunity key.
   * :param opp: The opportunity from the publisher's rules.
   * :return: {shared: [ids], withheld: [ids], empty: [ids]}.
   */
  sharingFor(key, opp) {
    const choices = this.session.sharing[key] || {};
    const shared = [];
    const withheld = [];
    const empty = [];
    for (const field of opp.requestedFields) {
      if (!Object.hasOwn(this.fields, field.id)) {
        empty.push(field.id);
        continue;
      }
      const on = Object.hasOwn(choices, field.id) ? choices[field.id] === true : !FIELD_BY_ID[field.id]?.sensitive;
      (on ? shared : withheld).push(field.id);
    }
    return { shared, withheld, empty };
  }

  /**
   * The status the assistant reads. It names which fields are filled but never their
   * values: values reach the model only through prepareRequest, for one approved request.
   *
   * :return: Plain JSON data.
   */
  getStatus() {
    const filled = PASSPORT_FIELDS.filter((field) => Object.hasOwn(this.fields, field.id)).map((field) => field.label);
    const empty = PASSPORT_FIELDS.filter((field) => !Object.hasOwn(this.fields, field.id)).map((field) => field.label);
    const publishers = PUBLISHERS.map((publisher) => {
      const parsed = parseNetworkUrl(publisher.networkUrl);
      const rules = this.session.rules[publisher.id];
      return {
        id: publisher.id,
        label: publisher.label,
        pageUrl: parsed ? `${parsed.base}/` : "",
        partnerTool: parsed ? parsed.partnerTool : "",
        rulesLoaded: Boolean(rules),
        opportunities: (rules?.opportunities || []).map((opp) => {
          const key = App.key(publisher.id, opp.id);
          const sharing = this.sharingFor(key, opp);
          const saved = this.session.results[key];
          return {
            key,
            title: opp.title,
            awardYear: opp.awardYear,
            officialUrl: opp.officialUrl,
            sharedFields: sharing.shared.map((id) => FIELD_BY_ID[id].label),
            withheldFields: sharing.withheld.map((id) => FIELD_BY_ID[id].label),
            emptyFields: sharing.empty.map((id) => FIELD_BY_ID[id].label),
            lastResult: saved ? {
              outcome: saved.result.outcome,
              headline: saved.result.headline,
              checkedAt: saved.at,
              checkedFrom: saved.via === "assistant" ? "the assistant" : "the page",
              rules: saved.result.rules.map((rule) => ({ title: rule.title, status: rule.status, reason: rule.reason, sourceUrl: rule.source?.url || "", nextStep: rule.nextStep })),
            } : null,
          };
        }),
      };
    });
    return {
      today: new Date().toISOString().slice(0, 10),
      passport: { storedIn: this.mode === "device" ? "this device" : "this tab only", filledFields: filled, emptyFields: empty },
      publishers,
      checklist: this.session.checklist.map(({ id, text, done, sourceUrl }) => ({ id, text, done, sourceUrl })),
    };
  }

  /**
   * Build the exact check request the student approved for one opportunity, for the
   * assistant to send to that publisher's partner tool. Read-only.
   *
   * :param key: Opportunity key.
   * :return: {ok, partnerTool, requestText, sharedFields, withheldFields} or {ok: false, reason}.
   */
  prepareRequest(key) {
    const found = this.opportunities().find((item) => item.key === key);
    if (!found) {
      return { ok: false, reason: "That opportunity is not loaded. On the page, connect to its publisher first, then choose what to share." };
    }
    const { shared, withheld, empty } = this.sharingFor(key, found.opp);
    if (!shared.length) {
      return { ok: false, reason: "The student shares no fields for this opportunity yet. They choose what to share on the page." };
    }
    const parsed = parseNetworkUrl(found.publisher.networkUrl);
    const pairs = shared.map((id) => `${id}=${this.fields[id]}`);
    return {
      ok: true,
      publisher: found.publisher.label,
      partnerTool: parsed.partnerTool,
      requestText: `Check ${found.opp.id}: ${pairs.join(" ")}`,
      sharedFields: shared.map((id) => FIELD_BY_ID[id].label),
      withheldFields: [...withheld, ...empty].map((id) => FIELD_BY_ID[id].label),
    };
  }

  // ---- disclosure plans -------------------------------------------------------------

  static labels(ids = []) {
    return ids.map((id) => FIELD_BY_ID[id]?.label || id);
  }

  /**
   * The kit's disclosure plan for one loaded opportunity, worked out here from the
   * publisher's published rules. Contacts no one.
   *
   * :param key: Opportunity key.
   * :return: {ok, found, plan} or {ok: false, reason}.
   */
  rawPlan(key) {
    const found = this.opportunities().find((item) => item.key === key);
    if (!found) {
      return { ok: false, reason: "That opportunity is not loaded. Read its publisher's rules first." };
    }
    const { shared } = this.sharingFor(key, found.opp);
    const outcome = planDisclosure(this.session.rules[found.publisher.id], found.opp.id, this.fields, shared);
    return outcome.ok ? { ok: true, found, plan: outcome.plan } : outcome;
  }

  /**
   * One sentence of advice for a plan, the same on the page and for the assistant.
   *
   * :param name: The publisher's name.
   * :param plan: A plan from rawPlan.
   * :return: The sentence.
   */
  static adviceText(name, plan) {
    const list = (ids) => App.labels(ids).join(", ");
    const rule = plan.decidingRules?.[0];
    const cite = rule ? `${rule.title}${rule.section ? ` (${rule.section})` : ""}` : "";
    const count = plan.needed?.length || 0;
    switch (plan.advice) {
      case ADVICE.skip:
        return `By ${name}'s published rules, the answer would be "Not eligible": ${cite}. The only way to get its answer is to share ${list(plan.sensitiveNeeded)}, which is sensitive. You can skip this publisher.`;
      case ADVICE.confirm:
        return `By ${name}'s published rules, the answer would be "Not eligible": ${cite}. You can confirm that by sharing only ${list(plan.needed)}.`;
      case ADVICE.share:
        return `By ${name}'s published rules, the answer would be "${OUTCOME_TEXT[plan.expectedOutcome]?.label || plan.expectedOutcome}". A definite answer needs ${count} field${count === 1 ? "" : "s"}: ${list(plan.needed)}.${plan.notNeeded.length ? ` Not needed: ${list(plan.notNeeded)}.` : ""}`;
      case ADVICE.fill:
        return plan.missing.length
          ? `${name} needs ${list(plan.missing)} for a definite result. Sharing now would return "Can't tell yet".`
          : `${name} can't give a definite result from your profile. Sharing now would return "Can't tell yet".`;
      default:
        return `${name}'s published rules did not pass the kit's checks, so there is no plan. ${plan.problem || ""}`.trim();
    }
  }

  /**
   * A plan as the assistant reads it: field names, never values.
   *
   * :param key: Opportunity key.
   * :return: Plain JSON data, or {ok: false, reason}.
   */
  planFor(key) {
    const raw = this.rawPlan(key);
    if (!raw.ok) {
      return raw;
    }
    const { found, plan } = raw;
    const outcomeLabel = (outcome) => OUTCOME_TEXT[outcome]?.label || "";
    return {
      ok: true,
      key,
      publisher: found.publisher.label,
      opportunity: `${found.opp.title} ${found.opp.awardYear}`.trim(),
      advice: plan.advice,
      summary: App.adviceText(found.publisher.label, plan),
      expectedOutcome: outcomeLabel(plan.expectedOutcome),
      outcomeWithWhatIsSharedNow: outcomeLabel(plan.currentOutcome),
      fewestFieldsForDefiniteAnswer: App.labels(plan.needed),
      sensitiveAmongThem: App.labels(plan.sensitiveNeeded),
      notNeeded: App.labels(plan.notNeeded),
      missingFromPassport: App.labels(plan.missing),
      sharedNow: App.labels(plan.sharedNow),
      planTurnsOff: App.labels(plan.turnOff),
      studentWouldTurnOn: App.labels(plan.turnOn),
      decidingRules: (plan.decidingRules || []).map((rule) => ({
        title: rule.title, status: STATUS_TEXT[rule.status]?.label || rule.status, reason: rule.reason, source: `${rule.sourceTitle}${rule.section ? `, ${rule.section}` : ""}`, sourceUrl: rule.sourceUrl,
      })),
    };
  }

  /**
   * Plans for every loaded opportunity, or for one.
   *
   * :param opportunityKey: Optional opportunity key.
   * :return: {ok, note, plans, publishersNotRead} or {ok: false, reason}.
   */
  getPlans(opportunityKey) {
    const loaded = this.opportunities();
    const chosen = opportunityKey ? loaded.filter((item) => item.key === opportunityKey) : loaded;
    if (opportunityKey && !chosen.length) {
      return { ok: false, reason: `"${String(opportunityKey).slice(0, 120)}" is not loaded. Read its publisher's rules first.` };
    }
    return {
      ok: true,
      note: PLAN_NOTE,
      plans: chosen.map((item) => this.planFor(item.key)),
      publishersNotRead: PUBLISHERS.filter((publisher) => !this.session.rules[publisher.id]).map((publisher) => ({ id: publisher.id, label: publisher.label })),
    };
  }

  /**
   * Follow a plan: turn off sharing of fields the plan does not need. It never turns
   * sharing on: that is always the student's own click.
   *
   * :param key: Opportunity key.
   * :return: {ok, turnedOff, sharedNow, studentWouldTurnOn, note} or {ok: false, reason}.
   */
  applyPlan(key) {
    const raw = this.rawPlan(key);
    if (!raw.ok) {
      return raw;
    }
    const { found, plan } = raw;
    if (plan.advice === ADVICE.invalid) {
      return { ok: false, reason: App.adviceText(found.publisher.label, plan) };
    }
    if (plan.turnOff.length) {
      const choices = { ...(this.session.sharing[key] || {}) };
      for (const id of plan.turnOff) {
        choices[id] = false;
      }
      this.session.sharing[key] = choices;
      this.saveSession();
      this.render();
    }
    return {
      ok: true,
      turnedOff: App.labels(plan.turnOff),
      sharedNow: App.labels(this.sharingFor(key, found.opp).shared),
      studentWouldTurnOn: App.labels(plan.turnOn),
      note: plan.turnOn.length && plan.advice !== ADVICE.skip
        ? "A plan never turns sharing on. For a definite answer the student turns these on themselves, in the share table on the page."
        : "",
    };
  }

  /**
   * The assistant's way to follow a plan: the page shows what will change and where, and
   * asks first.
   *
   * :param key: Opportunity key.
   * :return: As applyPlan, or {ok: false, reason} when the student keeps their choices.
   */
  async assistantApplyPlan(key) {
    const raw = this.rawPlan(key);
    if (!raw.ok || raw.plan.advice === ADVICE.invalid || !raw.plan.turnOff.length) {
      return raw.ok ? { ...this.applyPlan(key), note: raw.plan.turnOff.length ? "" : "Nothing to turn off: the student already shares only what the plan needs." } : raw;
    }
    const { found, plan } = raw;
    const allowed = await askConsent({
      title: `Let the assistant share less with ${found.publisher.label}?`,
      origin: `This page (${globalThis.location?.origin || "this site"})`,
      purpose: `Turn off ${plan.turnOff.length} field${plan.turnOff.length === 1 ? "" : "s"} in the share table for ${found.opp.title} ${found.opp.awardYear}. Nothing is sent. You can turn them back on.`,
      sends: [["Action", "apply_disclosure_plan"], ["Opportunity", key], ["Turn off", App.labels(plan.turnOff).join(", ")]],
      allow: "Share less",
      decline: "Keep as is",
    });
    if (!allowed) {
      return { ok: false, reason: "The student kept their sharing choices. Nothing changed." };
    }
    return this.applyPlan(key);
  }

  /**
   * Read the published rules of several publishers after one consent dialog that names
   * every origin. Sends nothing about the student. For the assistant.
   *
   * :param ids: Publisher ids, or empty for every publisher not read yet.
   * :return: {ok, read, failed, note} or {ok: false, reason}.
   */
  async assistantReadRules(ids = []) {
    const wanted = PUBLISHERS.filter((publisher) => (!ids.length || ids.includes(publisher.id)) && !this.session.rules[publisher.id]);
    if (!wanted.length) {
      return { ok: true, read: [], failed: [], note: "These publishers' rules are already read. Call website_plan_disclosure." };
    }
    return this.connectMany(wanted);
  }

  // ---- what crosses to a publisher --------------------------------------------------

  /**
   * The passport's check on every request this page sends to a publisher's action bridge,
   * from the page flow or from a publisher network the assistant runs here. A publisher
   * gets only get_published_rules with no arguments, or check_eligibility with fields the
   * student shares for that opportunity, holding the passport's own values.
   *
   * :param url: The bridge URL.
   * :param type: The bridge message type.
   * :param payload: The message payload.
   * :return: {ok, record} or {ok: false, reason}.
   */
  inspectBridgeRequest(url, type, payload) {
    if (type !== "execute") {
      // The handshake and the action catalog carry no passport data.
      return { ok: true };
    }
    const refuse = (why) => ({ ok: false, reason: `OpenAward's privacy check blocked this request: ${why}. Nothing was sent.` });
    let origin;
    try {
      origin = new URL(url).origin;
    } catch {
      return refuse("the bridge address is not a URL");
    }
    const publisher = PUBLISHERS.find((entry) => parseNetworkUrl(entry.networkUrl)?.origin === origin);
    if (!publisher) {
      return refuse(`${origin} is not a publisher in OpenAward's directory`);
    }
    const name = String(payload?.name || "");
    const args = payload?.args && typeof payload.args === "object" ? payload.args : {};
    if (name === "get_published_rules") {
      return Object.keys(args).length ? refuse("reading published rules takes no arguments") : { ok: true, record: { kind: "rules", publisher } };
    }
    if (name !== "check_eligibility") {
      return refuse(`publishers can only receive a rules request or an eligibility check, not "${name.slice(0, 60)}"`);
    }
    const opportunityId = String(args.opportunityId || "").slice(0, 64);
    const key = App.key(publisher.id, opportunityId);
    const found = this.opportunities().find((item) => item.key === key);
    if (!found) {
      return refuse(`it has not read ${publisher.label}'s rules for "${opportunityId}", so it cannot tell what the student chose to share`);
    }
    const { shared } = this.sharingFor(key, found.opp);
    const fields = args.fields && typeof args.fields === "object" ? args.fields : {};
    for (const [id, value] of Object.entries(fields)) {
      const label = FIELD_BY_ID[id]?.label || id.slice(0, 64);
      if (!shared.includes(id)) {
        return refuse(`the request holds "${label}", which the student did not choose to share with ${publisher.label} for ${found.opp.title}`);
      }
      if (this.fields[id] !== value) {
        return refuse(`the value of "${label}" in the request does not match the student's profile`);
      }
    }
    return { ok: true, record: { kind: "check", publisher, key, opp: found.opp, sent: Object.keys(fields) } };
  }

  /**
   * Log a request the bridge check refused.
   */
  onBridgeRefused(url, payload, reason) {
    let origin = "";
    try {
      origin = new URL(url).origin;
    } catch {
      origin = "";
    }
    this.log({ origin, purpose: String(payload?.name || "bridge request").slice(0, 60), decision: "refused", sent: [], error: reason });
    this.render();
  }

  /**
   * Record what a publisher answered to a bridge request the assistant's agents made, so
   * the page shows it like its own results. The page flow records its own calls.
   *
   * :param verdict: From inspectBridgeRequest.
   * :param value: The bridge's answer, or null.
   * :param error: The failure, or null.
   */
  recordBridgeOutcome(verdict, value, error) {
    const record = verdict?.record;
    if (!record || this.pageCalls.has(record.kind === "check" ? record.key : record.publisher.id)) {
      return;
    }
    const origin = parseNetworkUrl(record.publisher.networkUrl).origin;
    if (record.kind === "rules") {
      const ok = !error && value?.ok && value.rules?.format === RULES_FORMAT;
      if (ok) {
        this.session.rules[record.publisher.id] = App.cleanPublished(value.rules);
      }
      this.log({ origin, purpose: "read published rules (assistant)", decision: ok ? "allowed" : "failed", sent: [], via: "assistant", ...(ok ? {} : { error: String(error?.message || error || value?.reason || "No rules returned.") }) });
    } else {
      const problem = error ? String(error.message || error) : !value?.ok ? String(value?.reason || "The publisher refused the check.") : resultProblem(value.result);
      if (!problem) {
        const requested = record.opp.requestedFields.map((field) => field.id);
        this.session.results[record.key] = {
          result: value.result,
          at: new Date().toISOString(),
          peerOrigin: origin,
          sent: App.labels(record.sent),
          withheld: App.labels(requested.filter((id) => !record.sent.includes(id))),
          via: "assistant",
        };
      }
      this.log({ origin, purpose: `screen ${record.opp.id} (assistant)`, decision: problem ? "failed" : "allowed", sent: record.sent, via: "assistant", ...(problem ? { error: problem } : { received: value.result.received }) });
    }
    this.saveSession();
    this.render();
  }

  // ---- operations -------------------------------------------------------------------

  /**
   * Set or clear one passport field.
   *
   * :param id: Field id.
   * :param value: The value, or "" / null to clear.
   * :return: {ok} or {ok: false, reason, field}.
   */
  setField(id, value) {
    if (!FIELD_BY_ID[id]) {
      return { ok: false, reason: `Unknown field ${id}.`, field: id };
    }
    if (value === "" || value === null || value === undefined) {
      delete this.fields[id];
    } else {
      const error = fieldError(id, value);
      if (error) {
        return { ok: false, reason: error, field: id };
      }
      this.fields[id] = value;
    }
    PassportStore.saveFields(this.fields, this.mode);
    this.render();
    return { ok: true };
  }

  /**
   * Replace the passport with a sample or an imported file.
   *
   * :param fields: Valid fields.
   */
  replaceFields(fields) {
    this.fields = { ...fields };
    this.session.sharing = {};
    PassportStore.saveFields(this.fields, this.mode);
    this.saveSession();
    this.render();
  }

  setMode(mode) {
    this.mode = mode === "device" ? "device" : "tab";
    PassportStore.saveFields(this.fields, this.mode);
    this.render();
  }

  deleteAll() {
    PassportStore.deleteAll();
    this.fields = {};
    this.session = { sharing: {}, results: {}, checklist: [], activity: [], connected: [], rules: {} };
    this.render();
  }

  setShare(key, fieldId, on) {
    this.session.sharing[key] = { ...(this.session.sharing[key] || {}), [fieldId]: Boolean(on) };
    this.saveSession();
    this.render();
  }

  /**
   * Add a checklist item. Reversible: the student can remove it on the page.
   *
   * :param args: {text, sourceUrl}.
   * :return: {ok, checklist} or {ok: false, reason}.
   */
  /**
   * Validate a checklist item.
   *
   * :param args: {text, sourceUrl}.
   * :return: {ok, text, sourceUrl} or {ok: false, reason, field}.
   */
  static checklistItem(args) {
    const text = String(args?.text || "").trim();
    if (!text) {
      return { ok: false, reason: "The checklist item needs text.", field: "text" };
    }
    if (text.length > 300) {
      return { ok: false, reason: "Keep a checklist item under 300 characters.", field: "text" };
    }
    const sourceUrl = args?.sourceUrl ? safeUrl(args.sourceUrl) : "";
    if (args?.sourceUrl && !sourceUrl) {
      return { ok: false, reason: "The source must be an http or https link.", field: "sourceUrl" };
    }
    return { ok: true, text, sourceUrl: sourceUrl || "" };
  }

  /**
   * The assistant's way to add a checklist item: the page shows the item and asks first.
   *
   * :param args: {text, sourceUrl}.
   * :return: As addChecklistItem, or {ok: false, reason} when the student says no.
   */
  async assistantAddChecklist(args) {
    const item = App.checklistItem(args);
    if (!item.ok) {
      return item;
    }
    if (this.session.checklist.some((entry) => entry.text === item.text)) {
      return this.addChecklistItem(item);
    }
    const allowed = await askConsent({
      title: "Add this to your checklist?",
      origin: `This page (${globalThis.location?.origin || "this site"})`,
      purpose: "The assistant asks to add one line to the checklist on this page. Nothing is sent anywhere, and you can remove it.",
      sends: [["Action", "add_checklist_item"], ["Text", item.text], ["Source", item.sourceUrl || "none"]],
      allow: "Add it",
      decline: "Don't add",
    });
    if (!allowed) {
      return { ok: false, reason: "The student did not add it. Nothing changed." };
    }
    return this.addChecklistItem(item);
  }

  addChecklistItem(args) {
    const item = App.checklistItem(args);
    if (!item.ok) {
      return item;
    }
    const { text, sourceUrl } = item;
    if (this.session.checklist.some((item) => item.text === text)) {
      return { ok: true, note: "Already on the checklist.", checklist: this.getStatus().checklist };
    }
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.session.checklist.push({ id, text, sourceUrl: sourceUrl || "", done: false });
    this.saveSession();
    this.render();
    return { ok: true, checklist: this.getStatus().checklist };
  }

  toggleChecklist(id) {
    const item = this.session.checklist.find((entry) => entry.id === id);
    if (item) {
      item.done = !item.done;
      this.saveSession();
      this.render();
    }
  }

  removeChecklist(id) {
    this.session.checklist = this.session.checklist.filter((entry) => entry.id !== id);
    this.saveSession();
    this.render();
  }

  log(entry) {
    this.session.activity.push({ at: new Date().toISOString(), ...entry });
    this.session.activity = this.session.activity.slice(-100);
    this.saveSession();
  }

  saveSession() {
    PassportStore.saveSession(this.session);
  }

  link(publisher) {
    if (!this.links.has(publisher.id)) {
      this.links.set(publisher.id, new PublisherLink(publisher));
    }
    return this.links.get(publisher.id);
  }

  /**
   * Read a publisher's published rules, after the student agrees. Sends nothing about them.
   *
   * :param publisher: Directory entry.
   * :return: {ok} or {ok: false, reason}.
   */
  async connect(publisher) {
    const outcome = await this.connectMany([publisher]);
    return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason || outcome.failed?.[0]?.reason || "The rules could not be read." };
  }

  /**
   * Read the published rules of one or more publishers, after one dialog that names every
   * origin. Sends nothing about the student.
   *
   * :param publishers: Directory entries.
   * :return: {ok, read, failed} or {ok: false, reason} when the student declines.
   */
  async connectMany(publishers) {
    const parsedAll = publishers.map((publisher) => parseNetworkUrl(publisher.networkUrl));
    const one = publishers.length === 1;
    const allowed = await askConsent({
      title: one ? `Read ${publishers[0].label}'s published rules?` : `Read the published rules of ${publishers.length} publishers?`,
      origin: parsedAll.map((parsed, index) => (parsed ? parsed.origin : publishers[index].networkUrl)).join(" and "),
      purpose: one
        ? "Read this publisher's rules. Your profile is not sent."
        : "Read these publishers' rules. Your profile is not sent.",
      sends: [[one ? "Network" : "Networks", publishers.map((publisher) => publisher.networkUrl).join(", ")], ["Action", "get_published_rules (no arguments)"], ["Your data sent", "None"]],
      allow: "Read the rules",
    });
    if (!allowed) {
      for (const parsed of parsedAll) {
        this.log({ origin: parsed?.origin || "", purpose: "read published rules", decision: "declined", sent: [] });
      }
      this.render();
      return { ok: false, reason: "The student declined. Nothing was contacted." };
    }
    const read = [];
    const failed = [];
    for (const [index, publisher] of publishers.entries()) {
      const parsed = parsedAll[index];
      this.busy.add(publisher.id);
      this.pageCalls.add(publisher.id);
      this.render();
      try {
        const link = this.link(publisher);
        const resolved = await link.resolve();
        if (!resolved.ok) {
          throw new Error(resolved.reason);
        }
        const answer = await link.call("get_published_rules", {});
        if (!answer?.ok || answer.rules?.format !== RULES_FORMAT) {
          throw new Error(answer?.reason || "The publisher returned no rules.");
        }
        this.session.rules[publisher.id] = App.cleanPublished(answer.rules);
        this.log({ origin: parsed.origin, purpose: "read published rules", decision: "allowed", sent: [], brand: resolved.brand });
        read.push(publisher.label);
      } catch (error) {
        this.log({ origin: parsed?.origin || "", purpose: "read published rules", decision: "failed", sent: [], error: String(error.message || error) });
        failed.push({ publisher: publisher.label, reason: String(error.message || error) });
      } finally {
        this.busy.delete(publisher.id);
        this.pageCalls.delete(publisher.id);
        this.saveSession();
        this.render();
      }
    }
    return { ok: failed.length === 0, read, failed, ...(failed.length ? { reason: failed.map((item) => `${item.publisher}: ${item.reason}`).join(" ") } : {}) };
  }

  /**
   * Ask a publisher to screen the shared fields for one opportunity, after the student
   * agrees to the exact fields and values shown.
   *
   * :param key: Opportunity key.
   * :return: {ok} or {ok: false, reason}.
   */
  async check(key) {
    const found = this.opportunities().find((item) => item.key === key);
    if (!found) {
      return { ok: false, reason: "Unknown opportunity." };
    }
    const { publisher, opp } = found;
    const parsed = parseNetworkUrl(publisher.networkUrl);
    const { shared, withheld, empty } = this.sharingFor(key, opp);
    const fields = Object.fromEntries(shared.map((id) => [id, this.fields[id]]));
    const sends = shared.map((id) => [FIELD_BY_ID[id].label, valueLabel(id, this.fields[id])]);
    if (!sends.length) {
      sends.push(["Your data sent", "None. The publisher will say what it needs."]);
    }
    const allowed = await askConsent({
      title: `Send ${shared.length} field${shared.length === 1 ? "" : "s"} to ${publisher.label}?`,
      origin: parsed.origin,
      purpose: `The publisher's own code will screen these values against its published rules for ${opp.title} ${opp.awardYear}, in a hidden frame on its origin. Only the fields listed below leave this page.`,
      sends,
      allow: `Send ${shared.length} field${shared.length === 1 ? "" : "s"}`,
    });
    if (!allowed) {
      this.log({ origin: parsed.origin, purpose: `screen ${opp.id}`, decision: "declined", sent: [] });
      this.render();
      return { ok: false, reason: "You declined. Nothing was sent." };
    }
    this.busy.add(key);
    this.pageCalls.add(key);
    this.render();
    try {
      const answer = await this.link(publisher).call("check_eligibility", { opportunityId: opp.id, fields });
      if (!answer?.ok) {
        throw new Error(answer?.reason || "The publisher refused the check.");
      }
      const problem = resultProblem(answer.result);
      if (problem) {
        throw new Error(problem);
      }
      this.session.results[key] = {
        result: answer.result,
        at: new Date().toISOString(),
        peerOrigin: parsed.origin,
        sent: shared.map((id) => FIELD_BY_ID[id].label),
        withheld: [...withheld, ...empty].map((id) => FIELD_BY_ID[id].label),
      };
      this.log({ origin: parsed.origin, purpose: `screen ${opp.id}`, decision: "allowed", sent: shared, received: answer.result.received });
      return { ok: true };
    } catch (error) {
      this.log({ origin: parsed.origin, purpose: `screen ${opp.id}`, decision: "failed", sent: shared, error: String(error.message || error) });
      return { ok: false, reason: String(error.message || error) };
    } finally {
      this.busy.delete(key);
      this.pageCalls.delete(key);
      this.saveSession();
      this.render();
    }
  }

  // ---- rendering --------------------------------------------------------------------

  render() {
    if (typeof document === "undefined" || !document.querySelector("#passport-form")) {
      return;
    }
    this.renderPassport();
    this.renderPublishers();
    this.renderCompare();
    this.renderChecklist();
    this.renderActivity();
  }

  renderPassport() {
    const form = document.querySelector("#passport-form");
    // Keep the student's focus and partial input: only re-render when the field set changed.
    for (const [title, ids] of GROUPS) {
      let group = form.querySelector(`fieldset[data-group="${title}"]`);
      if (!group) {
        group = el("fieldset", { "data-group": title }, el("legend", { text: title }));
        for (const id of ids) {
          group.append(this.fieldControl(FIELD_BY_ID[id]));
        }
        form.append(group);
      }
      for (const id of ids) {
        const input = form.querySelector(`[name="${id}"]`);
        if (input && document.activeElement !== input) {
          input.value = Object.hasOwn(this.fields, id) ? String(this.fields[id]) : "";
        }
        const badge = form.querySelector(`[data-filled="${id}"]`);
        if (badge) {
          badge.hidden = !Object.hasOwn(this.fields, id);
        }
      }
    }
    const mode = document.querySelector(`input[name="storage-mode"][value="${this.mode}"]`);
    if (mode) {
      mode.checked = true;
    }
    const count = document.querySelector("#filled-count");
    if (count) {
      count.textContent = `${Object.keys(this.fields).length} of ${PASSPORT_FIELDS.length} fields filled. Stored in ${this.mode === "device" ? "this device's storage" : "this tab only"}.`;
    }
  }

  fieldControl(field) {
    const id = `f-${field.id}`;
    const help = field.help ? el("span", { class: "help", id: `${id}-help`, text: field.help }) : null;
    let input;
    if (field.type === "enum") {
      input = el("select", { id, name: field.id, "aria-describedby": help ? `${id}-help` : null },
        el("option", { value: "", text: "Not set" }),
        field.options.map(([code, label]) => el("option", { value: code, text: label })));
    } else {
      input = el("input", {
        id, name: field.id, type: field.type === "date" ? "date" : "number", inputmode: field.type === "integer" ? "numeric" : null,
        min: field.minimum, max: field.maximum, step: field.type === "integer" ? "1" : null, "aria-describedby": help ? `${id}-help` : null,
      });
    }
    const error = el("span", { class: "field-error", id: `${id}-error`, role: "alert" });
    input.addEventListener("change", () => {
      const raw = input.value.trim();
      const value = raw === "" ? "" : field.type === "integer" ? Number(raw) : raw;
      const outcome = this.setField(field.id, value);
      error.textContent = outcome.ok ? "" : outcome.reason;
      input.setAttribute("aria-invalid", outcome.ok ? "false" : "true");
    });
    return el("div", { class: "field" },
      el("label", { for: id }, field.label, field.sensitive ? el("span", { class: "tag sensitive", text: "sensitive" }) : null,
        el("span", { class: "tag filled", "data-filled": field.id, text: "filled", hidden: true })),
      help, input, error);
  }

  renderPublishers() {
    const mount = document.querySelector("#publishers");
    const cards = PUBLISHERS.map((publisher) => {
      const parsed = parseNetworkUrl(publisher.networkUrl);
      const rules = this.session.rules[publisher.id];
      const card = el("article", { class: "publisher", "aria-labelledby": `pub-${publisher.id}` });
      const head = el("header", { class: "publisher-head" },
        el("h3", { id: `pub-${publisher.id}`, text: publisher.label }),
        el("code", { class: "origin", text: parsed ? parsed.origin : "invalid URL" }));
      card.append(head, el("p", { class: "muted", text: publisher.blurb }));
      if (!rules) {
        const busy = this.busy.has(publisher.id);
        const button = el("button", {
          type: "button", class: "primary", disabled: busy,
          text: busy ? "Reading rules…" : `Read ${publisher.label}'s rules`,
          onclick: async () => {
            const outcome = await this.connect(publisher);
            if (!outcome.ok) {
              this.flash(publisher.id, outcome.reason);
            }
          },
        });
        card.append(el("p", { class: "muted small", text: "Reading rules sends no profile details." }), button,
          el("p", { class: "flash", id: `flash-${publisher.id}`, role: "status" }));
        return card;
      }
      card.append(el("p", { class: "muted small" }, `Rules read from ${parsed.origin}. `, el("a", { href: `${parsed.base}/`, target: "_blank", rel: "noopener noreferrer", text: "Publisher's page" }),
        ". ", rules.publisher?.disclaimer ? el("span", { text: rules.publisher.disclaimer }) : null));
      for (const opp of rules.opportunities) {
        card.append(this.opportunityPanel(publisher, opp));
      }
      return card;
    });
    mount.replaceChildren(...cards);
  }

  opportunityPanel(publisher, opp) {
    const key = App.key(publisher.id, opp.id);
    const { shared, withheld, empty } = this.sharingFor(key, opp);
    const panel = el("section", { class: "opp", "aria-labelledby": `opp-${key}` });
    panel.append(el("h4", { id: `opp-${key}`, text: `${opp.title} · ${opp.awardYear}` }),
      el("p", { class: "muted small" }, `${opp.owner}. Rules checked against sources on ${opp.rulesCheckedAt}. `,
        el("a", { href: safeUrl(opp.officialUrl) || "#", target: "_blank", rel: "noopener noreferrer", text: "Official page" })),
      el("p", { class: "small", text: opp.summary }));
    panel.append(this.planBox(publisher, key));

    const table = el("table", { class: "share" },
      el("caption", { text: "Choose which details to share. Sensitive fields start off." }),
      el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Share" }), el("th", { scope: "col", text: "Field" }), el("th", { scope: "col", text: "Your value" }), el("th", { scope: "col", text: "Why it asks" }))));
    const body = el("tbody");
    for (const field of opp.requestedFields) {
      const has = Object.hasOwn(this.fields, field.id);
      const checkbox = el("input", {
        type: "checkbox", id: `share-${key}-${field.id}`, checked: shared.includes(field.id), disabled: !has,
        onchange: (event) => this.setShare(key, field.id, event.target.checked),
      });
      body.append(el("tr", { class: shared.includes(field.id) ? "on" : "" },
        el("td", {}, checkbox),
        el("td", {}, el("label", { for: `share-${key}-${field.id}`, text: field.label }), FIELD_BY_ID[field.id]?.sensitive ? el("span", { class: "tag sensitive", text: "sensitive" }) : null),
        el("td", { text: has ? valueLabel(field.id, this.fields[field.id]) : "Not in your profile" }),
        el("td", { class: "muted small", text: field.why })));
    }
    table.append(body);
    panel.append(el("div", { class: "table-scroll" }, table));

    const preview = el("details", { class: "preview" },
      el("summary", { text: `Exactly what would be sent (${shared.length} field${shared.length === 1 ? "" : "s"})` }),
      el("pre", { text: JSON.stringify({ action: "check_eligibility", destination: parseNetworkUrl(publisher.networkUrl).origin, args: { opportunityId: opp.id, fields: Object.fromEntries(shared.map((id) => [id, this.fields[id]])) } }, null, 2) }));
    panel.append(preview);
    if (withheld.length || empty.length) {
      panel.append(el("p", { class: "muted small" }, "Not sent: ",
        ...[...withheld, ...empty].flatMap((id, index) => [index ? " · " : "", el("span", { text: FIELD_BY_ID[id].label })])));
    }
    const busy = this.busy.has(key);
    const run = el("button", {
      type: "button", class: "primary", disabled: busy,
      text: busy ? "Checking…" : `Check with ${publisher.label}`,
      onclick: async () => {
        const outcome = await this.check(key);
        if (!outcome.ok) {
          this.flash(key, outcome.reason);
        }
      },
    });
    panel.append(el("div", { class: "row" }, run), el("p", { class: "flash", id: `flash-${key}`, role: "status" }));
    const saved = this.session.results[key];
    if (saved) {
      const view = renderResult(document, saved.result, { peerOrigin: saved.peerOrigin, sent: saved.sent, withheld: saved.withheld });
      const steps = saved.result.rules.filter((rule) => rule.nextStep || rule.status !== "met");
      if (steps.length) {
        view.append(el("button", {
          type: "button", class: "ghost small",
          text: "Add next steps to my checklist",
          onclick: () => {
            for (const rule of steps) {
              const text = rule.nextStep || `${opp.title} ${opp.awardYear}: ${rule.title}. ${rule.reason}`;
              this.addChecklistItem({ text: text.slice(0, 300), sourceUrl: rule.source?.url });
            }
          },
        }));
      }
      panel.append(view);
    }
    return panel;
  }

  /**
   * The privacy plan for one opportunity: the fewest fields for a definite answer, worked
   * out on this device. Its button only ever turns sharing off.
   */
  planBox(publisher, key) {
    const box = el("section", { class: "plan", "aria-labelledby": `plan-${key}` }, el("h5", { id: `plan-${key}`, text: "Least you need to share" }));
    const raw = this.rawPlan(key);
    if (!raw.ok) {
      box.append(el("p", { class: "small", text: raw.reason }));
      return box;
    }
    const { plan } = raw;
    box.dataset.advice = plan.advice;
    box.append(el("p", { class: "small advice", text: App.adviceText(publisher.label, plan) }));
    const rule = plan.decidingRules?.[0];
    if (rule?.sourceUrl && [ADVICE.skip, ADVICE.confirm].includes(plan.advice)) {
      box.append(el("p", { class: "small" }, el("a", { href: safeUrl(rule.sourceUrl) || "#", target: "_blank", rel: "noopener noreferrer", text: `Source: ${rule.sourceTitle}` })));
    }
    if (plan.turnOn.length && [ADVICE.share, ADVICE.confirm].includes(plan.advice)) {
      box.append(el("p", { class: "small", text: `To get this answer, turn on ${App.labels(plan.turnOn).join(", ")} yourself in the table below. A plan never turns sharing on.` }));
    }
    if (plan.turnOff.length) {
      box.append(el("div", { class: "row" }, el("button", {
        type: "button", class: "ghost small", id: `plan-apply-${key}`,
        text: `Share only what's needed (turn off ${plan.turnOff.length} field${plan.turnOff.length === 1 ? "" : "s"})`,
        onclick: () => this.applyPlan(key),
      })));
    }
      box.append(el("p", { class: "muted small", text: "Calculated here from published rules. Nothing was sent. Only the publisher can return a screening result." }));
    return box;
  }

  flash(id, message) {
    const node = document.querySelector(`#flash-${CSS.escape(id)}`);
    if (node) {
      node.textContent = message;
    }
  }

  renderCompare() {
    const mount = document.querySelector("#compare");
    const rows = this.opportunities().filter(({ key }) => this.session.results[key]);
    if (!rows.length) {
      mount.replaceChildren(el("p", { class: "muted", text: "No results yet. Read the rules, choose what to share, then run a check." }));
      return;
    }
    const table = el("table", { class: "compare" },
      el("caption", { text: "Each publisher checks its own rules." }),
      el("thead", {}, el("tr", {}, ["Opportunity", "Result", "Publisher", "Rule summary"].map((label) => el("th", { scope: "col", text: label })))));
    const body = el("tbody");
    for (const { publisher, opp, key } of rows) {
      const saved = this.session.results[key];
      const counts = saved.result.counts || {};
      body.append(el("tr", {},
        el("th", { scope: "row", text: `${opp.title} ${opp.awardYear}` }),
        el("td", {}, outcomeBadge(document, saved.result.outcome)),
        el("td", { text: publisher.label }),
        el("td", { text: `${counts.met ?? 0} met · ${counts.not_met ?? 0} not met · ${counts.unknown ?? 0} not shared · ${counts.verify ?? 0} to confirm` })));
    }
    table.append(body);
    mount.replaceChildren(el("div", { class: "table-scroll" }, table));
  }

  renderChecklist() {
    const mount = document.querySelector("#checklist-items");
    if (!this.session.checklist.length) {
      mount.replaceChildren(el("li", { class: "muted", text: "Nothing yet. Add next steps from a result, or type one below." }));
      return;
    }
    mount.replaceChildren(...this.session.checklist.map((item) => {
      const box = el("input", { type: "checkbox", id: `todo-${item.id}`, checked: item.done, onchange: () => this.toggleChecklist(item.id) });
      return el("li", { class: item.done ? "done" : "" }, box,
        el("label", { for: `todo-${item.id}`, text: item.text }),
        item.sourceUrl ? el("a", { href: item.sourceUrl, target: "_blank", rel: "noopener noreferrer", class: "small", text: "source" }) : null,
        el("button", { type: "button", class: "ghost small", "aria-label": `Remove: ${item.text}`, text: "Remove", onclick: () => this.removeChecklist(item.id) }));
    }));
  }

  renderActivity() {
    const mount = document.querySelector("#activity-items");
    if (!this.session.activity.length) {
      mount.replaceChildren(el("li", { class: "muted", text: "No other site has been contacted from this page." }));
      return;
    }
    mount.replaceChildren(...[...this.session.activity].reverse().map((entry) => el("li", {},
      el("time", { datetime: entry.at, text: new Date(entry.at).toLocaleTimeString() }), " ",
      el("strong", { text: entry.decision }), ` · ${entry.purpose} · ${entry.origin || "no origin"} · sent: ${entry.sent?.length ? entry.sent.join(", ") : "nothing"}`,
      entry.received ? ` · publisher received: ${entry.received.join(", ") || "nothing"}` : "",
      entry.error ? ` · ${entry.error}` : "")));
  }

  // ---- page wiring ------------------------------------------------------------------

  wire() {
    for (const radio of document.querySelectorAll('input[name="storage-mode"]')) {
      radio.addEventListener("change", () => this.setMode(radio.value));
    }
    const samples = document.querySelector("#samples");
    for (const sample of SAMPLES) {
      samples.append(el("button", { type: "button", class: "ghost", text: `Try sample: ${sample.label}`, onclick: () => this.replaceFields(sample.fields) }));
    }
    document.querySelector("#export").addEventListener("click", () => {
      const blob = new Blob([PassportStore.exportText(this.fields)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = el("a", { href: url, download: "openaward-passport.json" });
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const importInput = document.querySelector("#import");
    importInput.addEventListener("change", async () => {
      const file = importInput.files?.[0];
      const status = document.querySelector("#passport-status");
      if (!file) {
        return;
      }
      const outcome = PassportStore.importText(await file.text());
      importInput.value = "";
      if (!outcome.ok) {
        status.textContent = outcome.reason;
        return;
      }
      this.replaceFields(outcome.fields);
      status.textContent = `Loaded ${Object.keys(outcome.fields).length} fields.${outcome.dropped.length ? ` Ignored ${outcome.dropped.length} unknown or invalid fields.` : ""}`;
    });
    document.querySelector("#delete").addEventListener("click", () => {
      this.deleteAll();
      document.querySelector("#passport-status").textContent = "Deleted everything this page stored in this browser.";
    });
    document.querySelector("#checklist-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.querySelector("#checklist-text");
      const outcome = this.addChecklistItem({ text: input.value });
      if (outcome.ok) {
        input.value = "";
      }
      document.querySelector("#checklist-status").textContent = outcome.ok ? "" : outcome.reason;
    });
  }
}

App.page = new App();
if (typeof window !== "undefined") {
  BridgeGuard.install(App.page);
}
if (typeof document !== "undefined" && document.querySelector("#passport-form")) {
  App.page.wire();
  App.page.render();
}

export { OUTCOME_TEXT, STATUS_TEXT };
