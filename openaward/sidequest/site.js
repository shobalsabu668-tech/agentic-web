// Mounts Campus Sidequest's AI agent (the campus_sidequest network) in the chat panel.
//
// sidequest.js imports this file only when the visitor switches the chat to "AI agent",
// so the key-free page never loads the runtime. The runtime runs the network in this
// browser on the visitor's own AI provider key (bring your own key; Otari is the default
// router, and OpenAI, OpenRouter and other OpenAI-compatible providers work too). The
// agent drives the planner through site-actions.js. Reading the groups' lists still asks
// the visitor first, and calling a group's own agent shows the runtime's consent card.

export class AssistantMount {
  static GREETING = "I'm the Sidequest agent. Tell me what you feel like doing and how much time or money you have. I'll set up the planner, then ask you before I read the campus groups' public lists.";
  static KEY_NEEDED = "To start, add an AI provider key in ⚙ AI model settings below. Otari is the default; OpenAI, OpenRouter, Google AI Studio, Groq and Anthropic work too. Your key is saved in this browser only.";
  static engine = null;
  static starting = null;

  /** Boot the runtime once; later calls get the same promise. */
  static start() {
    AssistantMount.starting ||= AssistantMount.boot();
    return AssistantMount.starting;
  }

  static async boot() {
    const status = document.querySelector("#assistant-status");
    const siteBase = new URL("./", import.meta.url).href;
    try {
      const { boot } = await import("./runtime/index.js");
      const booted = await boot("#agent-app", { originUrl: siteBase, sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href });
      AssistantMount.engine = booted.engine;
      const needsKey = !booted.engine.mockLLM && (!booted.engine.byokKey || booted.engine.byokKey === "demo");
      status.dataset.state = needsKey ? "needs-key" : "ready";
      status.textContent = needsKey
        ? "Needs your AI key. No key? Quick chat works without one."
        : "Ready. Your messages go to your AI provider; the groups' lists are read only after you approve.";
      // The runtime's first message repeats the network's description; say what to do instead.
      const first = document.querySelector("#ns-msgs .ns-msg.bot");
      if (first) first.textContent = needsKey ? AssistantMount.KEY_NEEDED : AssistantMount.GREETING;
      return booted.engine;
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = "The AI agent could not load. Quick chat and the planner still work.";
      console.error("Sidequest agent startup failed", error);
      return null;
    }
  }
}
