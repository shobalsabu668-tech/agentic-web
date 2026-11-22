// Mounts the passport's assistant inside the page. Load it with:
//   <script type="module" src="site.js"></script>
//
// Based on the agentify-website skill's templates/site.js. The passport has no
// irreversible actions. Its two writes, following a disclosure plan and adding a checklist
// item, show the page's own dialog with the destination and arguments before they run
// (js/app.js). This mount keeps the template's consent handling, and adds one thing: the
// runtime's consent card shows only the first 140 characters of a request, so it adds the
// whole request, word for word, to the card before the student answers.

export class AssistantMount {
  static GREETING = "I work for your privacy. I can plan the least you need to share with each publisher, have a publisher check exactly what you choose to share, and explain and compare the results. You approve every publisher contact, and every change to this page, first.";

  static async start() {
    const status = document.querySelector("#assistant-status");
    const siteBase = new URL("./", import.meta.url).href;
    try {
      const { boot } = await import("./runtime/index.js");
      const booted = await boot("#agent-app", {
        originUrl: siteBase,
        sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href,
      });
      AssistantMount.engine = booted.engine;
      AssistantMount.defaultConsent = booted.engine.onConsent;
      booted.engine.onConsent = AssistantMount.consent;
      const needsKey = !booted.engine.mockLLM && (!booted.engine.byokKey || booted.engine.byokKey === "demo");
      status.textContent = needsKey
        ? "The assistant needs your AI provider key. Add it in AI model settings below. Everything above works without it."
        : "Assistant connected to this page.";
      if (!needsKey) {
        const first = document.querySelector("#ns-msgs .ns-msg.bot");
        if (first) {
          first.textContent = AssistantMount.GREETING;
        }
      }
      return booted.engine;
    } catch (error) {
      status.textContent = "The assistant could not load. Everything above still works without it.";
      console.error("Assistant startup failed", error);
      return null;
    }
  }

  /**
   * Show the runtime's consent card, add the full request to it, and focus it.
   *
   * :param info: What the card shows: the partner's label, host and the request.
   * :return: The card's answer, unchanged.
   */
  static async consent(info) {
    const answer = AssistantMount.defaultConsent(info);
    AssistantMount.decorateConsentCard(info);
    const decision = await answer;
    if (document.activeElement === document.body || document.activeElement === null) {
      document.querySelector("#ns-input")?.focus();
    }
    return decision;
  }

  /**
   * Name the newest card for screen readers, add the full request text, and move focus to
   * its title unless the student is typing in the page's own form.
   *
   * :param info: The consent info.
   */
  static decorateConsentCard(info) {
    const cards = document.querySelectorAll("#ns-msgs .ns-consent");
    const card = cards[cards.length - 1];
    const title = card ? card.querySelector(".ns-consent-title") : null;
    if (!card || !title) {
      return;
    }
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", title.textContent);
    const request = String(info?.requestText || "");
    if (request && !card.querySelector(".oa-full-request")) {
      const box = document.createElement("details");
      box.className = "oa-full-request";
      box.open = request.length > 140;
      const summary = document.createElement("summary");
      summary.textContent = `Full request the publisher will receive (${request.length} characters)`;
      const text = document.createElement("pre");
      text.textContent = request;
      box.append(summary, text);
      const actions = card.querySelector(".ns-consent-actions");
      card.insertBefore(box, actions || null);
    }
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest("#agent-app")) {
      return;
    }
    title.tabIndex = -1;
    title.focus();
  }
}

// Boot only in a browser. Node tests import this file.
if (typeof window !== "undefined") {
  await AssistantMount.start();
}
