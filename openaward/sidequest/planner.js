// Campus Sidequest's planning logic, with no page or network access, so Node tests can
// import it.
//
//   parseMessage(text, state)  reads one key-free chat message: what the visitor wants
//                              to do, and their time and budget
//   searchTerms(request)       the listing words an activity request stands for
//   findPlans(lists, choices)  ranks plans from the groups' public lists
//
// Words are matched whole ("art" does not match "start"), and an unknown or off-topic
// message never starts a plan: it gets a short reply instead.

export const MOODS = {
  meet: { label: "Meet people", noun: "meeting people", adjective: "social" },
  make: { label: "Make something", noun: "making something", adjective: "creative" },
  move: { label: "Get moving", noun: "getting moving", adjective: "active" },
};
export const TIME_OPTIONS = [30, 60, 90];
export const BUDGET_OPTIONS = [0, 5, 10];

// What a request word stands for in the groups' listings. Keys are singular; plurals and
// -ing forms are folded in wordKey().
const ACTIVITY_WORDS = {
  zine: ["zine"], magazine: ["zine"], comic: ["zine", "doodle"],
  badge: ["badge"], button: ["badge"], pin: ["badge"],
  photo: ["photo"], photograph: ["photo"], photography: ["photo"], picture: ["photo"], pic: ["photo"], camera: ["photo"],
  sketch: ["sketch", "doodle"], doodle: ["doodle", "sketch"], draw: ["sketch", "doodle", "draw"], drawing: ["sketch", "doodle", "draw"],
  paint: ["sketch", "doodle", "collage"], painting: ["sketch", "doodle", "collage"], art: ["sketch", "doodle", "collage", "zine"],
  postcard: ["postcard"], print: ["print", "postcard"], printing: ["print", "postcard"],
  collage: ["collage"], sticker: ["sticker", "collage"], paper: ["paper"],
  weave: ["weave", "key tag"], weaving: ["weave", "key tag"], cord: ["cord"], knot: ["weave", "cord"], keychain: ["key tag"], keytag: ["key tag"], bracelet: ["weave", "cord"],
  craft: ["make"], crafty: ["make"], diy: ["make"], handmade: ["make"],
  card: ["card"], cardgame: ["card"], poker: ["card"], uno: ["card"],
  game: ["game", "puzzle", "card", "trivia", "mystery"], boardgame: ["game", "puzzle", "card"], play: ["game", "puzzle", "card", "trivia", "mystery"], playing: ["game", "puzzle", "card", "trivia", "mystery"],
  puzzle: ["puzzle"], jigsaw: ["puzzle"], brainteaser: ["puzzle", "mystery"],
  trivia: ["trivia"], quiz: ["trivia", "question"],
  mystery: ["mystery", "clue"], clue: ["clue", "mystery"], detective: ["mystery", "clue"], riddle: ["mystery", "puzzle"], escape: ["mystery", "puzzle"],
  scavenger: ["scavenger", "bingo"], hunt: ["scavenger", "bingo"], bingo: ["bingo"], challenge: ["challenge"],
  walk: ["walk", "trail"], walking: ["walk", "trail"], stroll: ["walk"], wander: ["walk"], hike: ["trail", "walk"], trail: ["trail", "walk"],
  snack: ["snack"], food: ["snack"], eat: ["snack"], drink: ["drink"], coffee: ["drink"], tea: ["drink"],
  team: ["team"], teamwork: ["team"],
};

const MOOD_WORDS = {
  meet: ["meet", "social", "socialize", "people", "friend", "friends", "together", "connect", "someone", "hang", "chat", "company", "new people", "lonely"],
  make: ["make", "making", "creative", "create", "craft", "crafts", "crafty", "art", "arts", "draw", "build", "hands on", "hands-on", "diy"],
  move: ["move", "moving", "walk", "walking", "outside", "outdoors", "active", "explore", "fresh air", "stretch", "exercise", "legs", "hike"],
};

// Words that mean "give me something" without naming an activity.
const OPEN_REQUEST = /\b(surprise me|anything|something|suggest|suggestion|recommend|idea|ideas|bored|plan|break|kill time|free time|free hour|what can i do|what should i do|sidequest|quest|activity|activities|fun)\b/;
const GREETING = /^(hi|hey|hello|yo|hiya|howdy|sup|good (morning|afternoon|evening))\b[\s!.,?]*(there|sidequest)?[\s!.,?]*$/;
const THANKS = /^(thanks|thank you|thx|ty|cheers|great|cool|nice|awesome|perfect)\b[\s!.,]*(a lot|so much)?[\s!.,]*$/;
const HELP = /\b(help|what can you do|how does this work|how do you work|who are you)\b/;
const BOOKING = /\b(book|booking|reserve|reservation|register|sign me up|sign up|pay|payment|buy|ticket|tickets)\b/;
const RESET = /\b(start over|reset|clear (?:my )?(?:choices|filters|plan)|new plan|forget (?:that|it))\b/;

const NUMBER_WORDS = { ten: 10, fifteen: 15, twenty: 20, "twenty five": 25, thirty: 30, forty: 40, "forty five": 45, fifty: 50, sixty: 60, ninety: 90, one: 1, two: 2, three: 3, five: 5 };

export const HELP_REPLY = "I plan short campus breaks from two student groups' public lists: making things (zines, badges, sketching), games (cards, puzzles, trivia) or short walks. Try “cards for 30 minutes, free” or “something creative with friends, up to $5”.";

/**
 * Lower-case a message, fold curly quotes, drop apostrophes inside words ("what's" ->
 * "whats") and spell out number words, so no stray one-letter fragment is left behind.
 */
function normalize(text) {
  let out = String(text || "").toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/(\w)'(\w)/g, "$1$2");
  for (const [word, value] of Object.entries(NUMBER_WORDS).sort((a, b) => b[0].length - a[0].length)) {
    out = out.replace(new RegExp(`\\b${word.replace(" ", "[ -]")}\\b`, "g"), String(value));
  }
  return out.replace(/\s+/g, " ").trim();
}

/** The largest option that does not exceed the value, or the smallest option. */
function fitDown(value, options) {
  const fits = options.filter((option) => option <= value);
  return fits.length ? fits[fits.length - 1] : options[0];
}

export const fitTime = (minutes) => fitDown(minutes, TIME_OPTIONS);
export const fitBudget = (dollars) => fitDown(dollars, BUDGET_OPTIONS);

/**
 * Find a time limit. Returns {minutes, rest} where rest is the text without it, so a
 * number like the 30 in "under 30 minutes" is not read again as a budget.
 */
function readTime(text) {
  const patterns = [
    [/\b(an?|1) hour and (a )?half\b|\bhour and a half\b|\b1\.5 ?(hours?|hrs?|h)\b/, () => 90],
    [/\bhalf (an )?hour\b/, () => 30],
    [/\b(a |an |1 )?free hour\b/, () => 60],
    [/\b(\d{1,3}(?:\.\d)?) ?(hours?|hrs?|h)\b/, (m) => Math.round(Number(m[1]) * 60)],
    [/\b(\d{1,3}) ?(minutes?|mins?|m)\b/, (m) => Number(m[1])],
    [/\b(an|one) hour\b/, () => 60],
  ];
  for (const [pattern, toMinutes] of patterns) {
    const match = text.match(pattern);
    if (match) return { minutes: toMinutes(match), rest: text.replace(match[0], " ") };
  }
  return { minutes: null, rest: text };
}

function readBudget(text) {
  // "a free hour" or "free time" is about time, not money.
  text = text.replace(/\bfree (time|hour|period|block|slot|moment|afternoon|morning|evening)\b/g, " ");
  if (/\b(free|no money|no cash|broke|no budget|nothing to spend|zero dollars|0 dollars|\$0|for nothing|without spending)\b/.test(text) || /\$0\b/.test(text)) return 0;
  const match = text.match(/\$ ?(\d{1,4})\b/)
    || text.match(/\b(\d{1,4}) ?(dollars?|bucks|usd)\b/)
    || text.match(/\b(?:up to|under|below|less than|max(?:imum)?|at most|budget(?: of| is)?|spend|spending)\s+(\d{1,4})\b/);
  return match ? Number(match[1]) : null;
}

function readMood(text) {
  for (const [mood, words] of Object.entries(MOOD_WORDS)) {
    if (words.some((word) => new RegExp(`\\b${word}\\b`).test(text))) return mood;
  }
  return "";
}

/** Fold a word to its dictionary key: "cards" -> "card", "puzzles" -> "puzzle". */
function wordKey(word) {
  if (ACTIVITY_WORDS[word]) return word;
  for (const ending of ["es", "s"]) {
    const stem = word.slice(0, -ending.length);
    if (word.endsWith(ending) && ACTIVITY_WORDS[stem]) return stem;
  }
  return null;
}

/** The activity words a message names, in order, as dictionary keys. */
export function activityWords(text) {
  const words = normalize(text).match(/[a-z]+/g) || [];
  const found = [];
  for (const word of words) {
    const key = wordKey(word);
    if (key && !found.includes(key)) found.push(key);
  }
  return found;
}

/**
 * Read one key-free chat message.
 *
 * :param message: The visitor's text.
 * :param state: {hasActivity}: whether an earlier message already said what to do.
 * :return: {kind, patch, reply?}. kind is "reset", "greeting", "thanks", "help",
 *     "booking", "unknown", "need-activity" or "plan". patch holds the planner choices
 *     the message sets: mood, timeMinutes, budget, activityRequest. Only "plan" builds.
 */
export function parseMessage(message, state = {}) {
  const text = normalize(message);
  if (!text) return { kind: "unknown", patch: {}, reply: HELP_REPLY };
  if (RESET.test(text)) return { kind: "reset", patch: {}, reply: "Fresh start. What would you like to do?" };
  if (GREETING.test(text)) return { kind: "greeting", patch: {}, reply: "Hey! What do you feel like doing, and how much time do you have? For example: “a card game for 30 minutes, free”." };
  if (THANKS.test(text)) return { kind: "thanks", patch: {}, reply: "Have a good break! Message me any time you want another plan." };

  const { minutes, rest } = readTime(text);
  const dollars = readBudget(rest);
  const mood = readMood(rest);
  const words = activityWords(rest);
  const patch = {};
  if (minutes !== null && minutes > 0) patch.timeMinutes = fitTime(minutes);
  if (dollars !== null) patch.budget = fitBudget(dollars);
  if (mood) patch.mood = mood;
  if (words.length) patch.activityRequest = words.join(" ");

  if (BOOKING.test(text) && !words.length && !mood) {
    return { kind: "booking", patch: {}, reply: "I can’t book, register or pay for anything. These are demo listings, so check the group’s own page for current details. I can still plan a break for you." };
  }
  const wantsPlan = words.length > 0 || Boolean(mood) || OPEN_REQUEST.test(rest);
  if (wantsPlan) return { kind: "plan", patch, notes: notes(minutes, dollars, patch) };
  if ("timeMinutes" in patch || "budget" in patch) {
    if (state.hasActivity) return { kind: "plan", patch, notes: notes(minutes, dollars, patch) };
    return { kind: "need-activity", patch, notes: notes(minutes, dollars, patch), reply: "Got it. What would you like to do: make something, play a game, or take a short walk?" };
  }
  if (HELP.test(text)) return { kind: "help", patch: {}, reply: HELP_REPLY };
  return { kind: "unknown", patch: {}, reply: `I couldn’t match that to the campus groups’ activities. ${HELP_REPLY}` };
}

/** Say when a stated limit had to be rounded down to the planner's options. */
function notes(minutes, dollars, patch) {
  const out = [];
  if (minutes !== null && minutes > 0 && patch.timeMinutes !== minutes) {
    out.push(minutes < patch.timeMinutes ? `The shortest setting is ${patch.timeMinutes} minutes, so pick a one-stop option for your ${minutes}.` : `I’ll keep it within ${patch.timeMinutes} minutes so it fits your ${minutes}.`);
  }
  if (dollars !== null && patch.budget !== dollars && dollars > 0) {
    out.push(patch.budget === 0 ? `I’ll keep it free so it stays under $${dollars}.` : `I’ll keep it within $${patch.budget}.`);
  }
  return out;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when the term appears in the text as whole words, allowing a plural ending. */
export function hasTerm(text, term) {
  return new RegExp(`\\b${escapeRegExp(term)}(?:s|es)?\\b`, "i").test(text);
}

/**
 * The listing words a free-text request stands for. Known activity words map through
 * the dictionary; any other word of three or more letters is searched as typed.
 */
export function searchTerms(request) {
  const words = normalize(request).match(/[a-z0-9]+/g) || [];
  const ignore = new Set(["the", "and", "for", "with", "some", "something", "anything", "want", "would", "like", "try", "please", "can", "activity", "quick", "fun", "campus"]);
  const terms = [];
  for (const word of words) {
    const key = wordKey(word);
    const mapped = key ? ACTIVITY_WORDS[key] : word.length >= 3 && !ignore.has(word) ? [word] : [];
    for (const term of mapped) if (!terms.includes(term)) terms.push(term);
  }
  return terms;
}

/**
 * How well one listing fits the terms: a term in the title counts 3, in the description
 * 2, in the setting or mood tags 1. Zero means no term appears.
 */
export function relevanceScore(item, terms) {
  const fields = [[item.title, 3], [item.description, 2], [`${item.setting || ""} ${(item.moods || []).join(" ")}`, 1]];
  return terms.reduce((total, term) => total + Math.max(0, ...fields.map(([text, weight]) => (hasTerm(String(text || ""), term) ? weight : 0))), 0);
}

function usable(item, budget) {
  return item && typeof item.title === "string" && Number.isFinite(item.duration) && Number.isFinite(item.cost) && item.duration > 0 && item.cost >= 0 && item.cost <= budget;
}

/**
 * Rank up to three plans from the groups' lists.
 *
 * A plan pairs one activity from each group when both fit; otherwise it is one activity.
 * With an activity request, listings are ranked by relevanceScore(); without one, they
 * must suit the chosen mood. The three picks differ: a free one first,
 * then a paid one near half the budget and a fuller one, each preferring activities the
 * earlier picks did not use.
 *
 * :param lists: [{peer, activities}], one per group, in a fixed order.
 * :param choices: {mood, timeMinutes, budget, activityRequest}.
 * :return: [{label, stops: [{peer, item}], minutes, cost}].
 */
export function findPlans(lists, choices) {
  const terms = searchTerms(choices.activityRequest || "");
  const score = (item) => relevanceScore(item, terms);
  const eligible = lists.map(({ peer, activities }) => ({
    peer,
    items: (Array.isArray(activities) ? activities : []).filter((item) => usable(item, choices.budget)
      && item.duration <= choices.timeMinutes
      && (terms.length ? score(item) > 0 : Array.isArray(item.moods) && item.moods.includes(choices.mood))),
  }));

  const pairs = [];
  for (const first of eligible[0]?.items || []) {
    for (const second of eligible[1]?.items || []) {
      const minutes = first.duration + second.duration;
      const cost = first.cost + second.cost;
      if (minutes <= choices.timeMinutes && cost <= choices.budget) {
        pairs.push({ stops: [{ peer: eligible[0].peer, item: first }, { peer: eligible[1].peer, item: second }], minutes, cost });
      }
    }
  }
  const singles = eligible.flatMap(({ peer, items }) => items.map((item) => ({ stops: [{ peer, item }], minutes: item.duration, cost: item.cost })));
  // Pairs make the fuller plan; with an activity request, a single exact match can beat a pair.
  const candidates = pairs.length >= 3 && !terms.length ? pairs : [...pairs, ...singles];

  const key = (stop) => `${stop.peer.id}:${stop.item.id || stop.item.title}`;
  const signature = (plan) => plan.stops.map(key).join("+");
  const relevance = (plan) => (terms.length ? plan.stops.reduce((total, stop) => total + score(stop.item), 0) / plan.stops.length : 0);
  const stable = (a, b) => signature(a).localeCompare(signature(b));

  const selected = [];
  const used = new Set();
  const overlap = (plan) => plan.stops.filter((stop) => used.has(key(stop))).length;
  const pick = (list, label, order) => {
    const pool = list.filter((plan) => !selected.some((entry) => signature(entry) === signature(plan)));
    pool.sort((a, b) => overlap(a) - overlap(b) || relevance(b) - relevance(a) || order(a, b) || stable(a, b));
    const plan = pool[0];
    if (!plan) return false;
    selected.push({ ...plan, label: typeof label === "function" ? label(plan) : label });
    plan.stops.forEach((stop) => used.add(key(stop)));
    return true;
  };

  const free = candidates.filter((plan) => plan.cost === 0);
  const paid = candidates.filter((plan) => plan.cost > 0);
  pick(free, "FREE", (a, b) => b.stops.length - a.stops.length || b.minutes - a.minutes);
  pick(paid, "A LITTLE EXTRA", (a, b) => Math.abs(a.cost - choices.budget * 0.45) - Math.abs(b.cost - choices.budget * 0.45) || a.cost - b.cost);
  pick(paid, "MORE TO TRY", (a, b) => b.cost - a.cost || b.minutes - a.minutes);
  const another = (plan) => (plan.cost === 0 ? "ANOTHER FREE IDEA" : "ANOTHER OPTION");
  while (selected.length < 3 && pick(candidates, another, (a, b) => a.cost - b.cost || b.stops.length - a.stops.length || b.minutes - a.minutes));
  return selected;
}
