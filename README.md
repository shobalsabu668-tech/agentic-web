# Campus Sidequest

**Turn a gap between classes into a small campus adventure.**

Campus Sidequest reads public activity lists from two independent campus groups and
builds up to three short plans in your browser. You choose what to share with the
planner; your mood, time and budget stay on your device. The listings are demo examples,
not scheduled events. There are no accounts, bookings or payments.

## Run it locally

Requires Node.js 22 or newer. From the repository root:

```shell
cd openaward
node scripts/build.mjs
node scripts/serve-all.mjs
```

Open <http://127.0.0.1:8080/>. The Makers Studio and Campus Games sites run on separate
origins at `http://localhost:8081/` and `http://[::1]:8083/`.

Quick chat works without an API key. The optional AI agent runs in your browser using
your own provider key. Sidequest asks before reading either group's public activity
list; the request contains no planner choices or personal data.

## Project files

- [`openaward/README.md`](openaward/README.md) — setup, product details, tests and the
  preserved OpenAward Passport demo.
- [`docs/SIDEQUEST_PLAN.md`](docs/SIDEQUEST_PLAN.md) — user flow, architecture, privacy
  boundary and remaining release work.
- [`openaward/sidequest/`](openaward/sidequest/) — Sidequest hub.
- [`openaward/publishers/maker-studio/`](openaward/publishers/maker-studio/) and
  [`openaward/publishers/campus-games/`](openaward/publishers/campus-games/) — independent
  activity sites.

The three sites are static and can be hosted separately. See the project README for the
retargeting command and deployment notes.
