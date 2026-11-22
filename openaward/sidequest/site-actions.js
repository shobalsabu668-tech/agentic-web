// The page actions Campus Sidequest's agent may use, as website_<name> tools
// (agent-manifest.json actions.agentTools). None of them can book or pay: Sidequest has no
// such function. build_sidequest asks the visitor before it reads the groups' lists.
import { Sidequest } from "./sidequest.js";
import { MOODS, TIME_OPTIONS, BUDGET_OPTIONS } from "./planner.js";

export function registerActions(actions) {
  actions.register({
    name: "get_sidequest_status",
    description: "Read the planner's current choices (mood, time, budget, activity), the two activity groups with their links, and a summary of the plan on the page, if any. Changes nothing.",
    effect: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: Sidequest.status,
  });
  actions.register({
    name: "set_sidequest_choices",
    description: "Set the planner's choices on the page from what the visitor said. Give only the choices to change. Time and budget must be one of the planner's options: use the largest option that does not exceed the visitor's limit. Contacts no one.",
    effect: "write",
    inputSchema: {
      type: "object",
      properties: {
        mood: { type: "string", enum: Object.keys(MOODS), description: "meet = social, make = creative, move = active." },
        timeMinutes: { type: "integer", enum: TIME_OPTIONS, description: "Minutes available." },
        budget: { type: "integer", enum: BUDGET_OPTIONS, description: "Dollars the visitor will spend; 0 means free only." },
        activityRequest: { type: "string", maxLength: 100, description: "A few activity keywords, such as \"zine\", \"card game\" or \"photo walk\". Empty string to clear." },
      },
      additionalProperties: false,
    },
    execute: (args) => Sidequest.setChoices(args),
  });
  actions.register({
    name: "build_sidequest",
    description: "Build up to three plans from the planner's current choices. The page first shows the visitor both groups' names and origins and asks to read their public activity lists; nothing about the visitor is sent to them. Returns ok false with a reason if the visitor declined or nothing fits. Never claim a plan was made unless ok is true.",
    effect: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => Sidequest.build(),
  });
}
