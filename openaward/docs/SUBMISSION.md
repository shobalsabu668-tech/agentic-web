# Submission kit

Everything here describes what the code does today. Re-check it against the live
deployment before you submit.

## Challenge facts (from the Devpost Overview, 2026-11-20)

- **Open Agentic Web Challenge** on Devpost: <https://cognizant-agenticweb.devpost.com/>.
- **Deadline: January 11, 2027 at 16:00 UTC** (9:30 pm IST, 8:00 am PST).
- **Prizes:** $10,000 in cash, as $5,000, $3,000 and $2,000, plus Otari credit.
- **Judges:** Babak Hodjat (Cognizant), Ramesh Raskar (MIT, Project NANDA) and Risto
  Miikkulainen (UT Austin).
- **Criteria:** Technological Implementation, Design, Potential Impact and Quality of the
  Idea. The full wording is in `../../docs/CHALLENGE_RESEARCH.md`.
- The **Rules** tab has not been read yet. Read it in a browser before you submit,
  especially for licensing and eligibility.

## Submission checklist (Devpost requirements, then what only you can do)

1. **Publish the code** in a public repository under Apache-2.0. Devpost says "Everything
   you build is open source". This folder is not under version control yet.
2. **Deploy** the three folders to three origins, such as three Netlify or Cloudflare Pages
   sites. Then run `node scripts/retarget.mjs --passport … --pell … --oregon …` and
   redeploy. Hosting may need accounts; I have not created any. **Submit the passport's URL.**
   Its `openaward_passport.network.json` is the required conforming `.json` file, and
   `runtime/` holds the runtime file.
3. **Check the hosted sites:** run `check_partner.mjs` on each publisher's https network URL
   from the passport's origin, then click through the demo once.
4. **Run the assistant live on an Otari key** (registrants can claim free credits). Ask the
   sample queries, and check that the consent card and a decline work as described. Use a
   key with a low limit, then delete the setup.
5. **Otari fields on the form:**
   - the email on your Otari account;
   - one or two sentences on a real problem you hit with Otari and how it could improve.
     Write these from your own experience in step 4. Don't let anyone invent them for you.
6. **Record the video yourself:**
   - under 2 minutes;
   - the project running in a browser;
   - **your own voice explaining it**; AI narration is not allowed;
   - public on YouTube;
   - no music you lack rights to, and no third-party logos.
7. **Screenshots:** use `docs/screenshots/`, or retake them on the hosted sites.
8. **List the extra tool:** describe and link the OpenAward publisher kit under the
   optional "additional tools" item. It counts toward Potential Impact.
9. **Submit** on Devpost. Optionally, open a pull request adding the sites to
   `docs/agentic_websites.md` in the agentic-web repository, which publishes them.

## Devpost project description (draft)

**OpenAward Passport: check grants without handing over your whole profile.**

Students looking for aid fill in the same personal details on site after site, or hand one
matching service everything and get back an opaque score. OpenAward Passport tries the
opposite, using the open agentic web.

The student keeps an eligibility passport in their own browser. Award publishers are
independent agent sites on their own origins. Each one publishes its rules as data, with a
verbatim quote and link to the official source for every rule. When the student wants a
check, they see the publisher's origin and exactly which fields will be sent. Sensitive
fields such as citizenship and Student Aid Index start off. After the student agrees, the
publisher's own code screens those fields, on the publisher's origin, and returns each rule
as **met**, **not met**, **not shared** or **to confirm**, with its source and next step.
Nothing is guessed: a withheld field stays "not shared", and anything only a school can
decide stays "to confirm".

Before anything is sent, the passport plans. From each publisher's published rules, on the
student's own device, it works out the fewest fields that still get a definite answer. It
also says when a publisher is not worth telling something sensitive. Its assistant works for
the student's privacy:

- it reads the publishers' rules (one dialog, nothing personal sent);
- it explains each plan with its sources;
- it can follow a plan, but only by turning sharing off, never on;
- it asks publishers, and explains why their answers differ.

Whatever a model writes, the page refuses to send a publisher any field the student did not
share.

We built three linked sites on the MVP spec's reference runtime:

- the **passport**, with that BYOK assistant. It sees which fields are filled and what
  published rules would decide, never the values, until the student approves a request
  the page builds from what they chose to share;
- a **Pell Rules Desk**, with Federal Pell Grant rules from 34 CFR;
- an **Oregon Grant Rules Desk**, with Oregon Opportunity Grant rules for 2026-27 and
  2027-28 from OSAC. For 2027-28 it does not even ask for your SAI, because OSAC has not
  published that year's limit.

The same sample student, a DACA recipient in Oregon, gets **not eligible** from the Pell
desk, citing 34 CFR 668.33, and **possibly eligible** from the Oregon desk, citing OSAC's "DACA
students are eligible". Each publisher gives its own citation, and the student decides what
each one sees. Before she shares anything, her passport tells her that the only way to get
Pell's answer is to reveal her immigration status, for an expected "no", so she can skip
Pell. For Oregon it names the exact fields needed, and the SAI is not one of them.

How it uses the spec: each site publishes a Neuro SAN HOCON network and manifest. Each
publisher's network has two agents and shares two reads through its action bridge. The
passport's agent loads a publisher's exact network from its origin after a consent card,
which we extended to show the full request, and runs it in the student's browser on the
student's own router and key. The eligibility decision uses no model at all.

Evidence:

- **36 unit tests.** For instance, every plan is minimal, and the publisher's own check
  agrees with it.
- **10 headless-Chrome checks of the page flow across three origins**, read from the
  publishers' own request logs: no contact before consent, none after a decline, none
  while planning, and only chosen fields sent.
- **10 checks of the full agent path with a scripted router:**
  - plan, share less, check;
  - the key never reaches a publisher;
  - the publisher runs on the visitor's model;
  - an unshared field is refused at the page.

The page has a strict CSP.

We also ship the **OpenAward kit**. It has:

- a rules engine any award owner can use to publish rules the same way, with a validator
  that refuses unsourced rules;
- the disclosure planner any passport can use.

Limits: the publishers are unofficial demos that transcribe official rules on the dates
shown. A screening result is not an award decision.

## Demo video script (under 2 minutes)

Record it in your own voice; Devpost does not allow AI narration. The script uses the
assistant on a real Otari key, so rehearse it once on the hosted sites. Real models phrase
answers differently from run to run. If the model fumbles a step, use the page-only version
below.

| Time | Show | Say |
| --- | --- | --- |
| 0:00 | Passport hero | "Applying for aid means handing your whole profile to every site, or to one service that gives you a score. OpenAward Passport keeps your profile in your browser, and shares as little as it can." |
| 0:12 | Load sample Maya | "Maya is an Oregon high-school senior with DACA status." |
| 0:17 | Ask: "Which publishers are worth asking, and what is the least I need to share with each?" → one dialog naming both origins | "Award publishers are independent agent sites. Her assistant works for her privacy. To plan, it reads their published rules, and that sends nothing about her." |
| 0:30 | The assistant's answer, and the plan box on the Pell card | "Worked out on her own device: by Pell's own rule, the only way to get Pell's answer is to reveal her immigration status, for a 'not eligible'. So it says: skip Pell. For Oregon next year, it names exactly the fields needed, and her income index isn't one." |
| 0:50 | Ask: "Follow the plan for the Federal Pell Grant." → page dialog → fields switch off | "It can share less, never more. The page shows exactly what changes, and asks first." |
| 1:00 | Turn on citizenship and loan default for Oregon 2027-28 (her clicks) | "Turning a field on is always her own click." |
| 1:06 | Ask: "Ask the Oregon Grant Rules Desk to check the 2027-28 grant with what I chose to share." → consent card with the full request → answer | "To ask a publisher, the assistant loads Oregon's own agents from its site, after her OK, and runs them here on her key. Oregon's code checks the fields on its own site: possibly eligible, quoting 'DACA students are eligible'." |
| 1:26 | Compare results + What left this page | "The answer lands on the page with its source, and every contact is logged. Whatever a model writes, the page won't send a field she didn't share." |
| 1:40 | Publisher page | "Any award office can publish its rules this way with our open kit, and any passport can plan against them." |
| 1:50 | End card | "OpenAward Passport: your profile, your choice, their rules, with sources." |

**Page-only version (no key):**

1. Load Maya.
2. Read Pell's rules (the dialog says nothing is sent).
3. Show the **Least you need to share** box saying "skip".
4. Read Oregon's rules, turn on the two fields its plan names, and check: **Possibly
   eligible**.
5. Show **Compare** and **What left this page**.
6. End on the publisher page.

Screenshots for the page are in `docs/screenshots/`, produced by the end-to-end tests on
real servers. `10-`, `11-` and `14-assistant-*.png` come from the scripted test router, and
the "real LLM" badge in them is the runtime's label for a non-mock router. **Do not use them
as product shots**: take the assistant's screenshots on the hosted site with a real model.
