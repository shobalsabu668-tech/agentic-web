# Rule sources

Every rule in the two publishers' `rules.json` quotes its source verbatim and links to it.
This file records where those sources came from, when, and how, so a reviewer can check
them.

## Federal Pell Grant (Pell Rules Desk)

- **Source:** Electronic Code of Federal Regulations, Title 34 (Education).
- **Retrieved:** 2026-11-20, through the eCFR renderer API
  (`https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-34?section=<section>`).
  The eCFR titles API reported Title 34 "up to date as of 2026-11-18" and last amended on
  2026-11-16.
- **Sections used:**

| Rule | Section | Link |
| --- | --- | --- |
| Citizenship or eligible noncitizen | 34 CFR 668.33(a), with (b) for the Freely Associated States and (c) for the FAFSA data match | <https://www.ecfr.gov/current/title-34/section-668.33> |
| High school diploma or equivalent | 34 CFR 668.32(e)(1), with (b) on secondary-school enrollment and (e)(2) to (5) for exceptions | <https://www.ecfr.gov/current/title-34/section-668.32> |
| No bachelor's or first professional degree, with the teacher-certification and workforce exceptions | 34 CFR 668.32(c)(2), amended at 91 FR 29333 (May 19, 2026) | <https://www.ecfr.gov/current/title-34/section-668.32> |
| Enrolled in an eligible undergraduate program | 34 CFR 690.75(a)(2), with 690.6(c), (d) and (f) | <https://www.ecfr.gov/current/title-34/section-690.75> |
| Lifetime limit of six Scheduled Awards | 34 CFR 690.6(e), amended at 91 FR 29334 (May 19, 2026) | <https://www.ecfr.gov/current/title-34/section-690.6> |
| Not in default, no grant overpayment | 34 CFR 668.32(g), with 668.35 | <https://www.ecfr.gov/current/title-34/section-668.32> |
| Award amount (to confirm) | 34 CFR 690.62(a) | <https://www.ecfr.gov/current/title-34/section-690.62> |
| Satisfactory academic progress (to confirm) | 34 CFR 668.32(f) | <https://www.ecfr.gov/current/title-34/section-668.32> |

- **Not used:** studentaid.gov renders its pages with JavaScript, so its text could not be
  retrieved as a document. The Pell desk links to it as the program's official page, but
  every rule cites the regulation instead.
- **Not screened:** the Pell award amount and SAI cut-offs. They depend on the payment
  schedule published each award year, so the desk marks them **to confirm**.

## Oregon Opportunity Grant (Oregon Grant Rules Desk)

- **Source:** Oregon Office of Student Access and Completion (OSAC), *Oregon Opportunity
  Grant*, <https://oregonstudentaid.gov/grants/oregon-opportunity-grant/>, marked "Last
  Updated October 2026".
- **Retrieved:** 2026-11-20, as HTML, with text extracted for quoting.
- **Quoted passages:** "Who is eligible?" (residency, education-purpose admission, DACA,
  undergraduate status, participating institution, financial need, defaults and refunds,
  first-come first-served), "Conditions of the Award" (theology, divinity or religious
  education), "SAI Limit" (8,000 for 2026-27), "Cut-Off Date" (May 15, 2026 for 2026-27), and
  "How much money will I receive?" (no forecast of future limits).
- **2027-28:** OSAC's page says both the SAI limit and the cut-off date "are determined
  annually, based on application rates and available funds". It has not published them for
  2027-28, so that opportunity marks them **to confirm** and does not ask for the SAI or
  filing date.

## Tried and not used

- California Student Aid Commission (Cal Grant) pages and the California Education Code on
  leginfo.legislature.ca.gov refused automated retrieval (HTTP 405 behind a bot check, and
  403). The earlier prototype's Cal Grant rules were not verified, so Cal Grant was dropped
  instead of being published unsourced.
- The earlier prototype's Gates Scholarship and RMHC rules were not verified against current
  sources and are not used.

## Keeping it current

Each opportunity carries `rulesCheckedAt`, and the passport shows it with every result. When
a source changes, update the rule's `check`, `source.quote` and `rulesCheckedAt` together.
The validator refuses a rule without a quote.
