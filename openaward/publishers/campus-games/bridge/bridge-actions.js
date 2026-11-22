import { getActivities } from "../activities.js";

export function registerActions(actions) {
  actions.register({
    name: "get_activities",
    description: "Read the public demo activity list from Campus Games. Returns activity names, descriptions, durations, sample costs, moods and settings. Takes no personal information and changes nothing.",
    effect: "read",
    availability: "bridge",
    callerOrigins: ["*"],
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: getActivities,
  });
}
