// OpenAward publisher kit: shows an eligibility result with its evidence.
//
// A result comes from another origin, so it is untrusted data. This module checks its
// shape, builds every element with textContent (never innerHTML), and links only to
// http(s) URLs. Any site can use it to show results from any OpenAward publisher.
//
// Part of the OpenAward publisher kit. Copied unchanged into each site by scripts/build.mjs.

import { RESULT_FORMAT } from "./eligibility.js";

export const OUTCOME_TEXT = {
  eligible: { label: "Meets published rules", tone: "good" },
  possibly_eligible: { label: "Possibly eligible", tone: "maybe" },
  unknown: { label: "Can't tell yet", tone: "unknown" },
  not_eligible: { label: "Not eligible", tone: "bad" },
};

export const STATUS_TEXT = {
  met: { label: "Met", icon: "✓" },
  not_met: { label: "Not met", icon: "✕" },
  unknown: { label: "Not shared", icon: "?" },
  verify: { label: "To confirm", icon: "!" },
};

const MAX_RULES = 60;
const MAX_TEXT = 2000;

/**
 * Check that a value is a result this module can show safely.
 *
 * :param result: The value a publisher returned.
 * :return: null when it can be shown, else the reason.
 */
export function resultProblem(result) {
  if (!result || typeof result !== "object") {
    return "The publisher returned no result.";
  }
  if (result.format !== RESULT_FORMAT) {
    return `The publisher's result is not in the ${RESULT_FORMAT} format.`;
  }
  if (!Object.hasOwn(OUTCOME_TEXT, result.outcome)) {
    return "The publisher's result has an unknown outcome.";
  }
  if (!Array.isArray(result.rules) || result.rules.length > MAX_RULES) {
    return "The publisher's result has no valid rule list.";
  }
  for (const rule of result.rules) {
    if (!rule || !Object.hasOwn(STATUS_TEXT, rule.status) || typeof rule.title !== "string") {
      return "A rule in the publisher's result is malformed.";
    }
  }
  return null;
}

/**
 * Return the URL when it is http or https, else null, so a result cannot add a
 * javascript: or data: link.
 *
 * :param value: A URL from the result.
 * :return: The URL or null.
 */
export function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function text(value) {
  return String(value ?? "").slice(0, MAX_TEXT);
}

function el(doc, tag, className, content) {
  const node = doc.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (content !== undefined) {
    node.textContent = text(content);
  }
  return node;
}

function link(doc, href, label) {
  const url = safeUrl(href);
  if (!url) {
    return el(doc, "span", "", label);
  }
  const anchor = el(doc, "a", "", label);
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

/**
 * Build the outcome badge.
 *
 * :param doc: The document.
 * :param outcome: The outcome code.
 * :return: The element.
 */
export function outcomeBadge(doc, outcome) {
  const info = OUTCOME_TEXT[outcome] || OUTCOME_TEXT.unknown;
  return el(doc, "span", `oa-badge oa-${info.tone}`, info.label);
}

/**
 * Build the full view of one result: outcome, headline, provenance, and each rule with
 * its status, reason, verbatim source quote and link.
 *
 * :param doc: The document.
 * :param result: A result that passed resultProblem().
 * :param context: {peerOrigin, sent, withheld}: where it came from and what was shared.
 * :return: The element.
 */
export function renderResult(doc, result, context = {}) {
  const root = el(doc, "article", "oa-result");
  const problem = resultProblem(result);
  if (problem) {
    root.append(el(doc, "p", "oa-error", `${problem} Nothing from it is shown.`));
    return root;
  }
  const head = el(doc, "header", "oa-result-head");
  head.append(outcomeBadge(doc, result.outcome));
  const title = el(doc, "h4", "oa-result-title", `${result.opportunity?.title || ""}${result.opportunity?.awardYear ? ` · ${result.opportunity.awardYear}` : ""}`);
  head.append(title);
  root.append(head);
  root.append(el(doc, "p", "oa-headline", result.headline));

  const facts = el(doc, "dl", "oa-provenance");
  const addFact = (label, value) => {
    facts.append(el(doc, "dt", "", label));
    const dd = el(doc, "dd");
    if (value && typeof value === "object") {
      dd.append(value);
    } else {
      dd.textContent = text(value);
    }
    facts.append(dd);
  };
  addFact("Checked by", `${result.publisher}${context.peerOrigin ? ` at ${context.peerOrigin}` : ""}`);
  addFact("How", result.evaluatedBy);
  addFact("Rules checked against sources on", result.rulesCheckedAt);
  if (Array.isArray(context.sent)) {
    addFact("You shared", context.sent.length ? context.sent.join(", ") : "nothing");
  }
  if (Array.isArray(context.withheld) && context.withheld.length) {
    addFact("You withheld", context.withheld.join(", "));
  }
  if (Array.isArray(result.notRequested) && result.notRequested.length) {
    addFact("Dropped by the publisher (not asked for)", result.notRequested.join(", "));
  }
  if (result.opportunity?.officialUrl) {
    addFact("Official page", link(doc, result.opportunity.officialUrl, result.opportunity.owner || result.opportunity.officialUrl));
  }
  root.append(facts);

  const list = el(doc, "ol", "oa-rules");
  // Problems first, so the student sees what to act on.
  const order = { not_met: 0, unknown: 1, verify: 2, met: 3 };
  const rules = [...result.rules].sort((a, b) => order[a.status] - order[b.status]);
  for (const rule of rules) {
    const item = el(doc, "li", `oa-rule oa-rule-${rule.status}`);
    const status = STATUS_TEXT[rule.status];
    const line = el(doc, "p", "oa-rule-line");
    const mark = el(doc, "span", "oa-rule-status", `${status.icon} ${status.label}`);
    line.append(mark, el(doc, "strong", "", ` ${rule.title}`));
    item.append(line);
    if (rule.reason) {
      item.append(el(doc, "p", "oa-rule-reason", rule.reason));
    }
    if (rule.source) {
      const source = el(doc, "details", "oa-source");
      const summary = el(doc, "summary", "", `Source: ${rule.source.section || rule.source.title || "link"}`);
      source.append(summary);
      if (rule.source.quote) {
        source.append(el(doc, "blockquote", "", rule.source.quote));
      }
      const cite = el(doc, "p", "oa-cite");
      cite.append(link(doc, rule.source.url, rule.source.title || rule.source.url));
      source.append(cite);
      item.append(source);
    }
    if (rule.nextStep) {
      item.append(el(doc, "p", "oa-next", `Next step: ${rule.nextStep}`));
    }
    list.append(item);
  }
  root.append(list);
  root.append(el(doc, "p", "oa-disclaimer", result.disclaimer));
  return root;
}
