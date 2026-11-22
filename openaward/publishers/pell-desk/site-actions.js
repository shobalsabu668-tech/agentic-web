// Registers this publisher's two reads with its own page's assistant.
// agent-manifest.json loads this module through "actions.module". The names in
// "actions.agentTools" become the tools website_get_published_rules and
// website_check_eligibility.
//
// From the OpenAward publisher kit (kit/publisher/site-actions.js), copied by scripts/build.mjs.
import { PublisherDesk } from "./kit/publisher-core.js";

// The runtime calls the module's registerActions export.
export function registerActions(actions) {
  for (const definition of PublisherDesk.actionDefinitions()) {
    actions.register(definition);
  }
}
