# Campus Sidequest

**Status:** Implemented and tested locally (unit tests, plus headless-Chrome checks across three origins, including the AI agent path with a scripted router). Public hosting, a live check with a real model, and student feedback remain.

## The product

Campus Sidequest turns a gap between classes into a small, low-cost campus plan. Visitors tell Sidequest what they feel like doing and how much time or money they have, or set the planner directly. Two independent campus sites publish their own activity lists. The hub asks permission before reading those lists, then matches and ranks suitable activities in the browser.

The interface stays plain: **say what you want, approve the read, choose a plan**. It avoids accounts, location tracking, sign-ups, bookings and payments. All current listings are clearly marked as demo examples rather than scheduled events.

## User journey

1. Tell Sidequest what you want to do and any time or budget limit, in the chat or the planner (one vibe choice, an optional activity, time and budget).
2. Review a dialog naming Makers Studio and Campus Games with their origins, then allow or cancel. "Don't ask again in this tab" is optional and can be undone with "Ask me each time".
3. If allowed, Sidequest reads each site's public manifest and its read-only `get_activities` action through the site's action bridge, with an empty argument object. Nothing about the visitor is sent.
4. Sidequest ranks plans locally: up to three, each different, within the time and budget. Every stop links to its group. Choosing a plan opens its route, checkboxes, a wildcard challenge and a completion recap with a badge.

## The chat panel

One panel, two modes:

- **Quick chat** (default, no key). A bounded parser in `sidequest/planner.js` reads activity words, mood, time and budget, matched as whole words. Greetings, thanks, help, booking requests and off-topic messages get a short reply and never open the dialog. Limits round down to the planner's options, and the reply says so.
- **AI agent** (visitor's key). The hub's own network, `campus_sidequest`, runs in the browser through the agentic-web runtime with bring-your-own-key (Otari by default; any OpenAI-compatible provider). Its front agent uses three page actions: `website_get_sidequest_status`, `website_set_sidequest_choices` (write; validated against the planner's options) and `website_build_sidequest` (shows the page's dialog before any read). For "what does this group offer?" it calls the group's own network (`maker_studio` or `campus_games`) with a fixed, generic request after the runtime's consent card; that network loads from the group's origin and runs on the visitor's model. The runtime loads only when the visitor switches to the agent.

## Architecture

- `openaward/sidequest/`: hub page (`index.html`, `sidequest.js`), planning logic (`planner.js`), agent mount (`site.js`), the agent's page actions (`site-actions.js`), the network source (`campus_sidequest.hocon`) and the consent dialog. A static site.
- `openaward/publishers/maker-studio/`: independent creative activity page, `maker_studio` network and read-only bridge.
- `openaward/publishers/campus-games/`: independent play activity page, `campus_games` network and read-only bridge.
- `openaward/scripts/build.mjs`: bundles all three Sidequest sites and the preserved OpenAward sites, and validates every network.
- `openaward/scripts/serve-all.mjs`: starts Sidequest's three static sites on three loopback origins, with CORS on the public agent files.
- `openaward/scripts/serve-openaward-fallback.mjs`: starts the original scholarship demo (stop the Sidequest servers first).
- `openaward/scripts/retarget-sidequest.mjs`: points the sites at three separate HTTPS origins and rebuilds.

Activity lists are small fixed demo data, not live campus inventory.

## Checks

- `node --test tests/sidequest.test.mjs`: 14 unit tests (parser, matching, ranking, limits, the agent's action definitions and files).
- `node tests/e2e/run-sidequest-e2e.mjs`: 10 headless-Chrome checks on three origins, including the AI agent and site composition with a scripted router.

## Judging story

- **Technical implementation:** one browser-run hub agent drives the page through validated actions, reads two independent sites through their own action bridges after consent, and composes with each group's own agent network, loaded from its origin and run on the visitor's model.
- **Design:** one clear promise, one panel with a key-free mode and an agent mode, three varied choices, visible progress, source links and a responsive identity.
- **Potential impact:** a campus planner can surface small, free activities from clubs that students may not find otherwise. Validate this with student interviews and campus life offices before claiming impact.
- **Idea:** club-owned agent sites contribute to one plan without handing their listings to a central directory.

A possible future business model is campus licensing for branded activity pages and publishing tools, while keeping the student experience free. That is unvalidated and is not built into the prototype. No product plan can guarantee a prize.

## Next work

1. Choose three HTTPS origins, run `node scripts/retarget-sidequest.mjs --sidequest <hub> --maker <makers> --games <games>`, and deploy the three folders.
2. Try the AI agent with a real key (Otari's challenge credits, or another provider) and tune the agent's instructions if the model strays.
3. Review the hosted flow in a clean browser on desktop and mobile.
4. Gather student feedback and refine the first-use flow.
5. Capture honest screenshots and a sub-two-minute demo after the hosted flow works.
