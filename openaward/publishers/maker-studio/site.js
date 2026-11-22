export class AssistantMount {
  static GREETING = "I can explain the Makers Studio demo activity list. These are sample ideas, not scheduled events. I cannot reserve a place or confirm current availability.";
  static async start() {
    const status = document.querySelector("#assistant-status");
    const siteBase = new URL("./", import.meta.url).href;
    try {
      const { boot } = await import("./runtime/index.js");
      const booted = await boot("#agent-app", { originUrl: siteBase, sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href });
      AssistantMount.engine = booted.engine;
      const needsKey = !booted.engine.mockLLM && (!booted.engine.byokKey || booted.engine.byokKey === "demo");
      status.textContent = needsKey ? "The activity list is ready. Add a key only if you want optional AI chat." : "Optional AI chat is ready.";
      if (!needsKey) { const first = document.querySelector("#ns-msgs .ns-msg.bot"); if (first) first.textContent = AssistantMount.GREETING; }
      return booted.engine;
    } catch (error) { status.textContent = "The optional guide could not load. The activity list still works."; console.error("Makers Studio guide startup failed", error); return null; }
  }
}
if (typeof window !== "undefined") await AssistantMount.start();
