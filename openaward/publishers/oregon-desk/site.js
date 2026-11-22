// Mounts this publisher's assistant inside its rules page. Load it with:
//   <script type="module" src="site.js"></script>
// The page needs the mount markup with #assistant-status and #agent-app.
//
// A publisher has no irreversible actions: its two reads run without a dialog, and it
// calls no other site. So this mount only boots the runtime, greets, and keeps focus
// sensible. From the OpenAward publisher kit (kit/publisher/site.js), copied by scripts/build.mjs.

export class AssistantMount {
  static GREETING = "I can explain the rules this desk publishes, quote their sources, and screen OpenAward passport fields against them. I can't decide eligibility or work out award amounts.";

  /**
   * Boot the runtime and report the result in the status line.
   *
   * :return: The runtime engine, or null when boot failed.
   */
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
      const needsKey = !booted.engine.mockLLM && (!booted.engine.byokKey || booted.engine.byokKey === "demo");
      status.textContent = needsKey
        ? "The assistant needs your AI provider key. Add it in AI model settings below. The rules above work without it."
        : "Assistant connected to this page.";
      if (!needsKey) {
        const first = document.querySelector("#ns-msgs .ns-msg.bot");
        if (first) {
          first.textContent = AssistantMount.GREETING;
        }
      }
      return booted.engine;
    } catch (error) {
      // The page must keep working without the assistant.
      status.textContent = "The assistant could not load. The published rules above still work.";
      console.error("Assistant startup failed", error);
      return null;
    }
  }
}

// Boot only in a browser. Node tests import this file.
if (typeof window !== "undefined") {
  await AssistantMount.start();
}
