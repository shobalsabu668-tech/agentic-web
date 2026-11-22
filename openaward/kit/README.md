# OpenAward publisher kit

Publish an award's eligibility rules on the open agentic web, so any OpenAward passport can
ask you to screen the fields a student chooses to share. The check runs with your code, on
your origin, and the student sees your source for every rule.

## What is in it

| File | What it does |
| --- | --- |
| `passport-fields.js` | The shared vocabulary, `openaward-passport/0.1`: 12 fields with short codes, labels, JSON Schemas, and a `sensitive` flag |
| `eligibility.js` | The rules engine: `validateRules`, `checkEligibility`, `publishedRules`, `checkInputSchema`. Deterministic: no model, no network, no storage |
| `disclosure.js` | The disclosure planner, for passports: `planDisclosure` works out on the student's device, from your published rules, the fewest fields that still get a definite answer from your check, before anything is sent |
| `publisher-core.js` | Your two actions over `<site>/rules.json`: `get_published_rules` and `check_eligibility` |
| `publisher/site-actions.js` | Registers them for your own page's assistant |
| `publisher/bridge-actions.js` | Shares them with every caller through your action bridge (`callerOrigins: ["*"]`) |
| `publisher/site.js` | Mounts the browser runtime's assistant on your page |
| `publisher-page.js` | Renders your published rules, quotes and links on your page |
| `result-view.js`, `kit.css` | Show a result safely on any site: checks its shape, uses `textContent` only, links only to http(s) |

## Publish an award in four steps

1. **Write `rules.json`** in the `openaward-rules/v1` format (below). Copy one of the
   demo publishers' files as a start.
2. **Add a page, a network and a manifest.** Copy `publishers/pell-desk/` and change
   `index.html`, the `.hocon` (name it after your network) and `agent-manifest.json`. Keep
   `actions.agentTools` as `get_published_rules` and `check_eligibility`, and keep the
   `openaward` block with `"role": "publisher"`.
3. **Add your site to `SITES` in `scripts/build.mjs`** and run `node scripts/build.mjs`. The
   build copies the runtime and this kit, validates your network with the runtime's own
   parser, and writes the action bridge.
4. **Host it** on its own origin with the `_headers` the build writes, then check it as any
   caller would:
   `node ../skills/agentify-website/scripts/check_partner.mjs https://<your host>/<network> --origin https://<a passport>`.

## The rules format

```json
{
  "format": "openaward-rules/v1",
  "profileVersion": "openaward-passport/0.1",
  "publisher": { "name": "...", "disclaimer": "...", "keepsData": "..." },
  "opportunities": [
    {
      "id": "lower_snake_case",
      "title": "...", "awardYear": "2027-28", "owner": "...",
      "officialUrl": "https://...", "summary": "...", "rulesCheckedAt": "YYYY-MM-DD",
      "requestedFields": ["residenceState", "sai"],
      "fieldReasons": { "sai": "Why you ask for it, shown before the student shares it." },
      "rules": [
        {
          "id": "unique_id",
          "title": "Student Aid Index at or below 8,000",
          "field": "sai",
          "check": { "type": "max", "value": 8000, "metReason": "...", "notMetReason": "..." },
          "source": { "title": "...", "url": "https://...", "section": "...", "quote": "verbatim text" },
          "nextStep": "optional"
        }
      ]
    }
  ]
}
```

Check types:

| `check.type` | Field type | Met when | Extra |
| --- | --- | --- | --- |
| `enum` | enum | per value, in `cases`: `met`, `not_met` or `verify`, each with a `reason` | every value needs a case, or give `otherwise` |
| `min` / `max` | integer | value ≥ / ≤ `value` | `metReason`, `notMetReason` |
| `onOrBefore` | date | value ≤ `value` (YYYY-MM-DD) | `metReason`, `notMetReason` |
| `verifyOnly` | none | never: always **to confirm** | `reason`. Use it for what a profile cannot settle, such as financial need, or a limit not yet published |

`exceptions` can soften a `not_met` into `verify` when another shared field is in a list, such
as "a bachelor's degree, unless the program is a teacher certification". Use `onlyFor` to
limit an exception to some values of the rule's own field. An exception never turns a
failure into a pass. If the field that decides an exception was not shared, the rule is
**not shared** (unknown), not "not met": the engine never claims a failure it cannot rule
out.

Outcomes, worst first: **not eligible** (a rule is not met) › **can't tell yet** (a needed
field was not shared) › **possibly eligible** (everything checkable is met, something must be
confirmed) › **meets published rules**.

## Planning the least to share (for passports)

`get_published_rules` returns your rules with their decision tables, as data, exactly as
your check uses them. `rules.json` is public on your origin anyway. A passport can then
call `planDisclosure(published, opportunityId, values, shared)` on the student's own
device. It contacts no one, and returns field ids, never values:

| `advice` | When | What the student learns |
| --- | --- | --- |
| `skip` | your rules would answer "not eligible", and every way to get that answer reveals a sensitive field | they need not tell you something sensitive just to hear "no" |
| `confirm_with_minimum` | "not eligible", and a few non-sensitive fields confirm it | the one or two fields that settle it |
| `share_needed` | "eligible" or "possibly eligible" | every field your rules need, which are sensitive, and which they would turn on |
| `fill_passport_first` | the passport lacks a field your answer needs | sharing now would only get "can't tell yet" |
| `rules_invalid` | the published rules fail `validateRules` | no plan; fails closed |

The plan is greedy and deterministic. It drops fields one at a time, sensitive ones first,
while the expected outcome stays the same. What is left is minimal: no single field can be
dropped without changing the answer. The unit tests check, for four test passports and
every demo opportunity, that your own `checkEligibility` gives the planned answer with the
planned fields, and a different answer without any one of them. A plan is a preview. Your
check, on your origin, stays the answer.

## What the validator refuses

The build and every check call `validateRules`. Any problem makes both actions refuse, so a
broken rules file can never answer a student. It refuses:

- a rule without an https source URL, a title and a verbatim quote;
- a field in `requestedFields` that no rule uses (ask only for what you check), and a rule
  field missing from `requestedFields`;
- an enum value without an explicit answer, unless the rule has `otherwise`;
- an exception or case value that is not a value of its field;
- duplicate ids, a non-https `officialUrl`, a missing `rulesCheckedAt`.
