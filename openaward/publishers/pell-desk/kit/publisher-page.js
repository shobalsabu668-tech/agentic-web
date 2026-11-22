// OpenAward publisher kit: renders a publisher's published rules on its own page, so a
// student, a reviewer or another developer can read every rule, its verbatim source and
// the fields it asks for, without an assistant or a key.
//
// Part of the OpenAward publisher kit. Copied unchanged into each publisher site by scripts/build.mjs.

import { PublisherDesk } from "./publisher-core.js";

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (content !== undefined) {
    node.textContent = String(content);
  }
  return node;
}

function link(href, label) {
  const anchor = el("a", "", label);
  anchor.href = href;
  anchor.rel = "noopener noreferrer";
  return anchor;
}

/**
 * Render the rules into #rules and the network URL into #network-url.
 */
export function renderPublisherPage() {
  const mount = document.querySelector("#rules");
  const published = PublisherDesk.getPublishedRules();
  if (!published.ok) {
    mount.replaceChildren(el("p", "oa-error", published.reason));
    return;
  }
  const { rules } = published;
  const network = document.body.dataset.network;
  const base = new URL("./", location.href).href.replace(/\/$/, "");
  const networkUrl = document.querySelector("#network-url");
  if (networkUrl && network) {
    networkUrl.textContent = `${base}/${network}`;
  }
  const disclaimer = document.querySelector("#publisher-disclaimer");
  if (disclaimer) {
    disclaimer.textContent = `${rules.publisher.disclaimer} ${rules.publisher.keepsData || ""}`.trim();
  }
  const sections = [];
  for (const opp of rules.opportunities) {
    const section = el("section", "opp");
    section.id = opp.id;
    const heading = el("h2", "", `${opp.title}${opp.awardYear ? ` · ${opp.awardYear}` : ""}`);
    section.append(heading);
    const meta = el("p", "opp-meta");
    meta.append(`Owner: ${opp.owner}. Rules checked against sources on ${opp.rulesCheckedAt}. `);
    meta.append(link(opp.officialUrl, "Official page"));
    meta.append(". Opportunity id: ");
    meta.append(el("code", "", opp.id));
    section.append(meta, el("p", "", opp.summary));

    section.append(el("h3", "", "Passport fields this check asks for"));
    const asks = el("ul", "asks");
    for (const field of opp.requestedFields) {
      const item = el("li");
      item.append(el("strong", "", field.label));
      if (field.sensitive) {
        item.append(" ", el("span", "tag", "sensitive"));
      }
      item.append(el("span", "why", ` ${field.why}`));
      asks.append(item);
    }
    section.append(asks);

    section.append(el("h3", "", `Rules (${opp.rules.length})`));
    const list = el("ol", "rule-list");
    for (const rule of opp.rules) {
      const item = el("li");
      item.append(el("strong", "", rule.title));
      if (!rule.field) {
        item.append(" ", el("span", "tag", "confirmed by school or award office"));
      }
      const quote = el("blockquote", "", rule.source.quote);
      const cite = el("p", "cite");
      cite.append(`${rule.source.section} · `, link(rule.source.url, rule.source.title));
      item.append(quote, cite);
      if (rule.nextStep) {
        item.append(el("p", "next", `Next step: ${rule.nextStep}`));
      }
      list.append(item);
    }
    section.append(list);
    sections.push(section);
  }
  mount.replaceChildren(...sections);
}

if (typeof document !== "undefined") {
  renderPublisherPage();
}
