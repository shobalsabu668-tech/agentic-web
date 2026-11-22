// Unit tests for Campus Sidequest: the key-free chat parser, the matcher and plan ranking
// (sidequest/planner.js), the agent's page actions, and the agent files staying in step.
//
//   node --test tests/sidequest.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMessage, searchTerms, hasTerm, findPlans, fitTime, fitBudget, relevanceScore, TIME_OPTIONS, BUDGET_OPTIONS } from "../sidequest/planner.js";
import { ACTIVITIES as MAKER } from "../publishers/maker-studio/activities.js";
import { ACTIVITIES as GAMES } from "../publishers/campus-games/activities.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LISTS = [
  { peer: { id: "maker", name: "Makers Studio", base: "http://localhost:8081" }, activities: MAKER },
  { peer: { id: "games", name: "Campus Games", base: "http://[::1]:8083" }, activities: GAMES },
];
const json = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));

test("off-topic and unknown messages get a reply and never start a plan", () => {
  for (const message of ["What's the weather like today?", "tell me a joke", "who is the president", "basketball", "asdf qwerty", "I'd like to know the time"]) {
    const parsed = parseMessage(message);
    assert.equal(parsed.kind, "unknown", message);
    assert.deepEqual(parsed.patch, {}, message);
    assert.match(parsed.reply, /campus/i, message);
  }
});

test("apostrophes leave no one-letter fragments behind", () => {
  // "what's" used to leave "s", which matched every listing.
  assert.deepEqual(searchTerms("what's"), ["whats"]);
  assert.deepEqual(searchTerms("I'm bored"), ["bored"]);
  assert.equal(findPlans(LISTS, { mood: "meet", timeMinutes: 90, budget: 10, activityRequest: "what's the weather" }).length, 0);
});

test("the chat reads activity, mood, time and budget", () => {
  assert.deepEqual(parseMessage("play cards for 30 minutes, free").patch, { timeMinutes: 30, budget: 0, activityRequest: "play card" });
  assert.deepEqual(parseMessage("45 mins, no money, make a zine").patch, { timeMinutes: 30, budget: 0, mood: "make", activityRequest: "zine" });
  assert.deepEqual(parseMessage("an hour and a half up to 10 bucks, a walk").patch, { timeMinutes: 90, budget: 10, mood: "move", activityRequest: "walk" });
  assert.deepEqual(parseMessage("something social, up to $5").patch, { budget: 5, mood: "meet" });
  assert.equal(parseMessage("I'd love to paint").patch.activityRequest, "paint");
  assert.equal(parseMessage("I'm bored").kind, "plan");
});

test("limits round down so a plan never exceeds what the visitor has", () => {
  assert.deepEqual(TIME_OPTIONS, [30, 60, 90]);
  assert.deepEqual(BUDGET_OPTIONS, [0, 5, 10]);
  assert.equal(fitTime(45), 30);
  assert.equal(fitTime(60), 60);
  assert.equal(fitTime(240), 90);
  assert.equal(fitTime(20), 30); // the smallest setting; the note says to pick a one-stop option
  assert.equal(fitBudget(3), 0);
  assert.equal(fitBudget(7), 5);
  assert.equal(fitBudget(50), 10);
  assert.match(parseMessage("45 minutes, something creative").notes.join(" "), /within 30 minutes so it fits your 45/);
  assert.match(parseMessage("I have $3, something creative").notes.join(" "), /free so it stays under \$3/);
});

test("time words are not read as a budget, and a free hour is not a free budget", () => {
  assert.deepEqual(parseMessage("under 30 minutes, something creative").patch, { timeMinutes: 30, mood: "make" });
  assert.deepEqual(parseMessage("I have a free hour, play a game").patch, { timeMinutes: 60, activityRequest: "play game" });
  assert.equal(parseMessage("free time, cards").patch.budget, undefined);
  assert.equal(parseMessage("cards, free").patch.budget, 0);
});

test("greetings, thanks, help, booking and reset get replies without changing choices", () => {
  assert.equal(parseMessage("hey there").kind, "greeting");
  assert.equal(parseMessage("thanks!").kind, "thanks");
  assert.equal(parseMessage("what can you do?").kind, "help");
  const booking = parseMessage("can you book it for me?");
  assert.equal(booking.kind, "booking");
  assert.match(booking.reply, /can’t book/);
  assert.equal(parseMessage("start over").kind, "reset");
  for (const message of ["hey there", "thanks!", "can you book it for me?", "start over"]) assert.deepEqual(parseMessage(message).patch, {});
});

test("time or budget alone asks for an activity, then plans once one is known", () => {
  const first = parseMessage("I have 30 minutes and $5");
  assert.equal(first.kind, "need-activity");
  assert.deepEqual(first.patch, { timeMinutes: 30, budget: 5 });
  assert.equal(parseMessage("actually 60 minutes", { hasActivity: true }).kind, "plan");
});

test("terms match whole words only, with plurals", () => {
  assert.equal(hasTerm("Restart the studio", "art"), false);
  assert.equal(hasTerm("Learn a fast card game", "card"), true);
  assert.equal(hasTerm("Photo challenge cards", "card"), true);
  assert.equal(hasTerm("Courtyard micro-walk", "walk"), true);
  assert.equal(hasTerm("Weave a color key tag", "key tag"), true);
  assert.deepEqual(searchTerms("cards"), ["card"]);
  assert.ok(searchTerms("paint").includes("sketch"));
});

test("a title match outranks a passing mention", () => {
  const cards = GAMES.find((item) => item.id === "quick-cards");
  const bingo = GAMES.find((item) => item.id === "photo-bingo");
  assert.ok(relevanceScore(cards, ["card"]) > relevanceScore(bingo, ["card"]));
  const plans = findPlans(LISTS, { mood: "meet", timeMinutes: 30, budget: 10, activityRequest: "cards" });
  assert.equal(plans[0].stops[0].item.id, "quick-cards");
});

test("every plan stays within time and budget, for every setting", () => {
  for (const mood of ["meet", "make", "move"]) {
    for (const timeMinutes of TIME_OPTIONS) {
      for (const budget of BUDGET_OPTIONS) {
        for (const activityRequest of ["", "zine", "cards", "walk", "puzzle", "paint"]) {
          const plans = findPlans(LISTS, { mood, timeMinutes, budget, activityRequest });
          assert.ok(plans.length <= 3);
          const signatures = new Set();
          for (const plan of plans) {
            const label = `${mood}/${timeMinutes}/${budget}/${activityRequest}`;
            assert.ok(plan.minutes <= timeMinutes, label);
            assert.ok(plan.cost <= budget, label);
            assert.equal(plan.minutes, plan.stops.reduce((sum, stop) => sum + stop.item.duration, 0), label);
            assert.equal(plan.cost, plan.stops.reduce((sum, stop) => sum + stop.item.cost, 0), label);
            if (!activityRequest) for (const stop of plan.stops) assert.ok(stop.item.moods.includes(mood), label);
            const signature = plan.stops.map((stop) => stop.item.id).join("+");
            assert.ok(!signatures.has(signature), `duplicate plan ${signature} for ${label}`);
            signatures.add(signature);
          }
        }
      }
    }
  }
});

test("the three options vary instead of repeating one stop", () => {
  const plans = findPlans(LISTS, { mood: "make", timeMinutes: 60, budget: 5, activityRequest: "" });
  assert.equal(plans.length, 3);
  assert.deepEqual(plans.map((plan) => plan.label), ["FREE", "A LITTLE EXTRA", "MORE TO TRY"]);
  const stops = plans.flatMap((plan) => plan.stops.map((stop) => stop.item.id));
  assert.equal(new Set(stops).size, stops.length, `repeated stop in ${stops.join(", ")}`);
});

test("nothing fits gives no plans; malformed listings are skipped", () => {
  assert.equal(findPlans(LISTS, { mood: "meet", timeMinutes: 30, budget: 0, activityRequest: "basketball" }).length, 0);
  const broken = [{ peer: LISTS[0].peer, activities: [{ title: "No numbers" }, { title: "Negative", duration: 10, cost: -1, moods: ["meet"] }, null] }, { peer: LISTS[1].peer, activities: "not a list" }];
  assert.deepEqual(findPlans(broken, { mood: "meet", timeMinutes: 90, budget: 10, activityRequest: "" }), []);
});

test("the agent's page actions match the manifest and the planner's options", async () => {
  const { registerActions } = await import("../sidequest/site-actions.js");
  const registered = [];
  registerActions({ register: (definition) => registered.push(definition) });
  const manifest = json("sidequest/agent-manifest.json");
  assert.deepEqual(registered.map((action) => action.name).sort(), [...manifest.actions.agentTools].sort());
  const set = registered.find((action) => action.name === "set_sidequest_choices");
  assert.equal(set.effect, "write");
  assert.deepEqual(set.inputSchema.properties.timeMinutes.enum, TIME_OPTIONS);
  assert.deepEqual(set.inputSchema.properties.budget.enum, BUDGET_OPTIONS);
  assert.equal(set.inputSchema.additionalProperties, false);
  for (const action of registered) assert.notEqual(action.effect, "irreversible");
  // Out-of-range values are refused before the page is touched.
  assert.equal(set.execute({ timeMinutes: 45 }).ok, false);
  assert.equal(set.execute({ budget: 3 }).ok, false);
  assert.equal(set.execute({ mood: "party" }).ok, false);
  assert.equal(set.execute({ activityRequest: "x".repeat(101) }).ok, false);
});

test("the hub's network, manifest and page name the same two partners", () => {
  const manifest = json("sidequest/agent-manifest.json");
  const network = json("sidequest/campus_sidequest.network.json");
  const guide = network.tools.find((tool) => tool.name === "sidequest_guide");
  const page = readFileSync(path.join(ROOT, "sidequest/sidequest.js"), "utf8");
  const bases = [...page.matchAll(/base: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(bases.map((base) => new URL(base).origin).sort(), [...manifest.allowed_peers].sort());
  assert.deepEqual(guide.tools.sort(), bases.map((base, index) => `${base}/${["maker_studio", "campus_games"][index]}`).sort());
  assert.match(guide.instructions, /website_set_sidequest_choices/);
  assert.match(guide.instructions, /website_build_sidequest/);
  assert.match(guide.instructions, /never claim to book/i);
  for (const site of ["sidequest", "publishers/maker-studio", "publishers/campus-games"]) {
    assert.equal(json(`${site}/links.json`).version, 1, site);
  }
});
