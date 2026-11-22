// The reads this publisher shares with other agent sites, through its action bridge.
// The build names this file in bridge/agent-manifest.json. When another site's page or
// assistant calls this publisher, the bridge loads it in a hidden frame on this
// publisher's origin, so the check runs here, with this publisher's own rules code.
//
// Both reads are shared with every origin ("*"). That is the point of a publisher: any
// passport may ask. Neither read returns stored data or another person's record: one
// returns the public rules, the other screens only the fields the caller sends and keeps
// nothing.
//
// From the OpenAward publisher kit (kit/publisher/bridge-actions.js), copied by scripts/build.mjs.
import { PublisherDesk } from "../kit/publisher-core.js";

// The bridge calls the module's registerActions export.
export function registerActions(actions) {
  for (const definition of PublisherDesk.actionDefinitions({ availability: "bridge", callerOrigins: ["*"] })) {
    actions.register(definition);
  }
}
