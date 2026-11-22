export function registerActions(actions) {
  actions.register({
    name: "get_sidequest_status",
    description: "Read the selected campus activity vibe, time and budget, and whether a plan is already on the page. Changes nothing.",
    effect: "read",
    availability: "bridge",
    callerOrigins: ["*"],
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => ({ ok: true, network: "campus_sidequest", available: true }),
  });
}
