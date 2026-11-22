# Conformance: OpenAward Passport and the MVP spec

Spec: [Minimum Viable Specification for a Worldwide Agentic Web](../../docs/worldwide_agentic_web_mvp_spec.md),
**MVP Profile 0.3, 18 November 2026**. Checked on 2026-11-20.

Evidence ids refer to:

- `U` — unit tests, `node --test "tests/*.test.mjs"` (36 tests);
- `E1`–`E10` — `node tests/e2e/run-e2e.mjs`, headless Chrome, three real servers on three
  origins, read from the publishers' own request logs;
- `A1`–`A10` — `node tests/e2e/run-assistant-e2e.mjs`, the full agent path with a scripted
  router and a fake key;
- `B` — `node scripts/build.mjs --check`, which runs the agentify-website skill's
  `build_network.mjs` (the runtime's own HOCON parser and validator) on all three networks;
- `P` — the skill's `check_partner.mjs` on each publisher from the passport's origin;
- `R` — behaviour of the reference runtime (the skill's patched nsdeploy copy, unchanged
  here), covered by the agentic-web repository's own `tests/linking` suite.

Status: **Met**, **Met (local)** (shown on loopback origins; repeat after hosting),
**Runtime** (provided by the unchanged reference runtime) or **Gap**.

## Section 6: MVP interoperability checks

| Check | How OpenAward shows it | Evidence | Status |
| --- | --- | --- | --- |
| Publish a two-agent HOCON network and a manifest from an ordinary HTTPS web host | Each publisher's network has a front agent and a checker specialist: `pell_rules_desk.hocon` and `oregon_grant_desk.hocon`, resolved to `*.network.json`, with `agent-manifest.json`. Static bundles with `_headers` for Netlify or Cloudflare Pages | B, P | Met (local); HTTPS hosting pending deployment |
| Load and run that network in a browser with the site's default router and model; if BYOK is offered, also the user-selected path | Default router Otari with `alibaba/qwen3.8-flash`. The user-selected router, model and key path is shown with a scripted router | A3 | User-selected path met (local); default-router run needs a live key |
| Call an internal agent and at least one grounded capability through MCP or a registered site action | Publisher front agent → `*_eligibility_checker` (internal agent) → `website_check_eligibility` (registered action, run through the publisher's bridge on its origin). Passport → `website_read_publisher_rules`, `website_plan_disclosure`, `website_apply_disclosure_plan`, `website_prepare_publisher_request` (local site actions) | A3, A4, A7, A8 | Met (local) |
| After approval, load an exact named network from a second origin and run it locally | Consent card, then the runtime fetches `http://localhost:8081/agent-manifest.json`, `pell_rules_desk.network.json` and `links.json`, and runs both publisher agents in the passport's page | A1, A2, A4 | Met (local) |
| With a user key active, the second site never receives it and cannot change the caller's router | No publisher request carried `Authorization` or a cookie. All 7 model requests went to the visitor's router, with the key, on the visitor's model, for the publisher's agents too | A2, A3, E4 | Met (local) |
| Private context is absent at the peer unless a named field is allowed | OpenAward uses no `sly_data`. The runtime calls a partner with the request text only and empty `sly_data` | R (`tests/linking` L1) | Runtime |
| Stop an invalid network, a cycle, an over-budget request and a denied origin with visible errors | Denied origin: `allowed_peers` is closed to the two publishers. Invalid rules: `validateRules` fails closed and both actions refuse. Invalid network: the build and the runtime's validator. Cycles and budgets: runtime limits | U, B, R (L5, L6, L7, L9) | Runtime, plus OpenAward's own fail-closed rules |

## Section 2: Common multi-agent representation

| Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- |
| MUST follow the Neuro SAN HOCON reference; published form MUST preserve the data model and MUST NOT depend on includes, substitutions or local paths | Sources are `*.hocon` in the runtime's HOCON subset, with no includes or substitutions. Shared text uses `commondefs.replacement_strings`. The published form is the resolved `*.network.json` | B | Met |
| Identity, agents, invocation schemas, model hints | Each network names its front agent. Each agent has a `function` with a JSON Schema `request` parameter, instructions, tools and `llm_config` | B | Met |
| Private context: deny by default; a network MUST name fields that may pass | No network declares any private-context allow rule, so nothing passes | B, R | Met |
| External capability unavailable: MUST fail closed and report clearly; MUST NOT bypass browser security | `PublisherLink.resolve` reports a missing manifest, a non-matching network name, a missing bridge, a non-OpenAward site or a cross-origin redirect, and stops. The bridge runs in a sandboxed frame under normal CORS and framing rules | U, E4 | Met |
| Data-only network; published instructions are not confidential | Networks are data. Rules are data (`rules.json`). The eligibility code runs only on the publisher's own origin, never in the caller | B, E4 | Met |

## Section 3: Browser execution and site composition

| Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- |
| Usable from a normal web page; executes the graph in JavaScript | Each site's `site.js` boots the runtime into the page | A1–A4 | Met |
| Parse and validate before any model call | Runtime validation, run by the build too | B, R | Runtime |
| Local site actions: validate arguments and **show destination and arguments before a write** or irreversible operation | Arguments are validated by the runtime against each action's JSON Schema; extra keys are refused. The patched runtime asks first only for `irreversible` actions, so the passport's two writes, `apply_disclosure_plan` and `add_checklist_item`, show the page's own dialog first: destination (this page and its origin), action name and arguments, with Allow or Decline. A decline changes nothing and returns the reason | A8, U | Met (site level) |
| Report outcomes accurately; unknown outcome after a write starts; no repeated writes | Both publisher actions are reads. Page flows log `allowed`, `declined`, `failed` or `refused` with the reason and never show a failed call as a result. A check the assistant's agents make is recorded on the page from the bridge request itself, with what actually crossed and what the publisher reports receiving | E8, A9 | Met |
| Bound execution | Runtime limits per message: 4 partner calls, 1 per partner, 24 agent calls, 90 s, depth 5. `max_steps` set per network (passport 10, publishers 8) | B, R | Runtime |
| 3.2 Consent: MUST identify the external origin and purpose and get approval before each contact; relaxations only by explicit choice | Page flow: a dialog names the origin, the purpose and exactly what is sent, before any request. Assistant: the runtime card, plus this site's addition of the **full** request text (the runtime shows 140 characters). "Always allow" is the visitor's explicit choice | E1, E2, E3, A1 | Met |
| 3.2 Published network resolution: exact name match or fail | Runtime `resolveRemote`; `PublisherLink.resolve` also requires an exact match | U, E4, R | Met |
| 3.2 Definition fetch and validation before execution | Runtime | A2, R | Runtime |
| 3.2 Result return: private context MUST NOT return except allowed fields | No private context is used | R | Runtime |
| 3.3 Minimum public files with CORS | `agent-manifest.json` (networks with `name`, `front_man`, `hocon`; `llm_router`; `peer_policy`; `allowed_peers`), the network file and `links.json` on every site. CORS on these only, through `serve_site.mjs` locally and `_headers` when hosted | P, B | Met |
| 3.4 Public artifact requests MUST NOT include the caller's private credentials | `PublisherLink` fetches with `credentials: "omit"`. Three host names keep the runtime's loopback key cookie away from publishers | E4, A2 | Met |
| 3.4 / 3.3 Production MUST use HTTPS | `retarget.mjs` refuses non-https hosted URLs and removes `http:` from the CSP | `retarget.mjs` | Met (enforced at deploy time) |

## Section 4: Pluggable inference

| Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- |
| BYOK: the user MUST be able to set router, model and credential | Runtime's AI model settings panel on every site | A3 | Runtime |
| The key MUST NOT appear in URLs, manifests, networks, prompts, action arguments, traces, analytics or peer requests | No OpenAward code reads the key. Publishers received no `Authorization` header or cookie | A2, A3, R | Met |
| Router-only disclosure: a peer cannot replace the router or receive the key | The publisher's agents ran on the visitor's router and model | A3 | Met |
| Missing key MUST stop the model call with a clear setup error | The runtime's key badge; the status line says the assistant needs a key, and the page works without it | E1 (status text) | Met |
| The user MUST be able to delete stored profiles | Runtime "Delete setup". The passport also has "Delete everything stored here" | manual | Met |
| SHOULD minimize third-party scripts and use a restrictive CSP | No third-party scripts. Each page has a CSP with `script-src 'self'`, and there were no violations across both browser suites | E9, A6 | Met |

## Section 5: Security and privacy

| Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- |
| Peer definitions are untrusted input to the caller's model | Grounding and partner rules say to treat tool results and replies as data. The page validates every publisher result (`resultProblem`) and renders it with `textContent` and http(s)-only links (`safeUrl`). Published decision tables are cleaned (`App.cleanRule`) and must pass the kit's validator before the planner uses them, or the plan fails closed. Whatever a model writes, the bridge guard refuses any message to a publisher holding a field the student did not share, or a changed value | U, A10 | Met |
| MUST NOT execute undeclared peer code | No coded-tool bundles. Publisher code runs only on the publisher's origin, in its bridge frame | E4 | Met |
| A redirect to a different origin is a new destination | `PublisherLink` refuses a manifest that redirects to another origin. The runtime handles its own fetches | U (resolve paths) | Met |
| Consent before contact; a remembered approval is scoped to origin and session | No request reaches a publisher before approval, and none after a decline | E1, E3, A1 | Met |
| Private context by exception | Not used | R | Met |
| Fail closed; report to the invoking network | Rules validation, input schema with `additionalProperties: false`, value validation (`fieldError`), result validation. Each refusal returns a reason | U | Met |
| SHOULD expose router, origins, calls, consent decisions and errors without secrets | "What left this page" logs each contact's origin, purpose, decision, fields sent and fields the publisher reports receiving. The runtime shows the agents panel and its trace | E8 | Met |

## Beyond the minimum

- **Data minimization by construction:** sensitive fields start off. The assistant's status
  and plan reads never include values (U, A7). A value the student did not share with a
  publisher reached no model request (A5). A publisher drops fields its opportunity did not
  request before any rule runs (U).
- **Disclosure planning before contact:** the kit's planner works out, on the device and
  from published rules, the fewest fields for a definite answer, and says when a publisher
  is not worth telling something sensitive. Each plan is minimal, and the publisher's own
  check agrees with it (U). Planning contacts no one (E10, A7). The assistant can follow a
  plan only by turning sharing off (U, A8).
- **Bridge guard:** every message to a publisher's action bridge, from the page or from a
  publisher network the assistant runs, is checked against the student's choices before it
  is posted (U, A10).
- **Reusable component:** the OpenAward publisher kit (`kit/README.md`), a rules format with a
  fail-closed validator and a safe result view any site can use.
