// Campus Sidequest's page: the planner form, the key-free quick chat, the switch to the AI
// agent, the consent dialog, the reads of both groups' public lists, and the quest view.
//
// The AI agent is this site's own network (campus_sidequest.network.json), run in the
// visitor's browser by the runtime on the visitor's AI key. It is loaded only when the
// visitor switches the chat to it (site.js), and it drives the same planner through the
// actions in site-actions.js.
import { ActionBridgeClient, sameOriginAsset } from "./runtime/action-transport.js";
import { MOODS, TIME_OPTIONS, BUDGET_OPTIONS, parseMessage, findPlans } from "./planner.js";

// scripts/retarget-sidequest.mjs rewrites these two base URLs for hosting.
const PEERS = [
  { id: "maker", name: "Makers Studio", base: "http://localhost:8081", network: "maker_studio", color: "maker" },
  { id: "games", name: "Campus Games", base: "http://[::1]:8083", network: "campus_games", color: "games" },
];
const PROGRESS_KEY = "campus-sidequest-progress-v1";
const CONSENT_KEY = "campus-sidequest-read-consent";
const MODE_KEY = "campus-sidequest-chat-mode";
const $ = (selector) => document.querySelector(selector);

let lastPlan = null;
let building = null;
let hasChatActivity = false;

const storage = {
  get(area, key) { try { return window[area].getItem(key); } catch { return null; } },
  set(area, key, value) { try { if (value === null) window[area].removeItem(key); else window[area].setItem(key, value); } catch {} },
};

// ---- Progress ---------------------------------------------------------------------------

function readProgress() {
  try { return JSON.parse(storage.get("localStorage", PROGRESS_KEY) || '{"completed":0,"badges":[]}'); }
  catch { return { completed: 0, badges: [] }; }
}
function renderProgress() {
  const progress = readProgress();
  $("#quests-completed").textContent = String(progress.completed || 0);
  const badges = progress.badges || [];
  $("#quest-badges").textContent = badges.length ? `Badges earned: ${badges.join(" · ")}` : "Finish your first quest to earn the First Steps badge.";
}

// ---- Planner choices ----------------------------------------------------------------------

function currentChoices() {
  const form = $("#quest-form");
  if (!form) return { mood: "meet", timeMinutes: 60, budget: 0, activityRequest: "" };
  const data = new FormData(form);
  return {
    mood: String(data.get("mood") || "meet"),
    activityRequest: String(data.get("activityRequest") || "").trim(),
    timeMinutes: Number(data.get("time") || 60),
    budget: Number(data.get("budget") || 0),
  };
}

function checkRadio(name, value) {
  const input = document.querySelector(`#quest-form input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

/**
 * Set any of the planner's choices. Values outside the planner's options are refused.
 *
 * :param patch: {mood?, timeMinutes?, budget?, activityRequest?}.
 * :return: {ok: true, choices} or {ok: false, reason}.
 */
function setChoices(patch = {}) {
  if (patch.mood !== undefined && !(patch.mood in MOODS)) return { ok: false, reason: `Mood must be one of ${Object.keys(MOODS).join(", ")}.` };
  if (patch.timeMinutes !== undefined && !TIME_OPTIONS.includes(Number(patch.timeMinutes))) return { ok: false, reason: `Time must be one of ${TIME_OPTIONS.join(", ")} minutes.` };
  if (patch.budget !== undefined && !BUDGET_OPTIONS.includes(Number(patch.budget))) return { ok: false, reason: `Budget must be one of ${BUDGET_OPTIONS.join(", ")} dollars.` };
  if (patch.activityRequest !== undefined && (typeof patch.activityRequest !== "string" || patch.activityRequest.length > 100)) return { ok: false, reason: "The activity must be text of at most 100 characters." };
  if (patch.mood !== undefined) checkRadio("mood", patch.mood);
  if (patch.timeMinutes !== undefined) checkRadio("time", String(Number(patch.timeMinutes)));
  if (patch.budget !== undefined) checkRadio("budget", String(Number(patch.budget)));
  if (patch.activityRequest !== undefined) $("#activity-request").value = patch.activityRequest.trim();
  return { ok: true, choices: currentChoices() };
}

function resetChoices() {
  setChoices({ mood: "meet", timeMinutes: 60, budget: 0, activityRequest: "" });
  hasChatActivity = false;
}

const formatCost = (cost) => (cost === 0 ? "Free" : `$${cost}`);
const budgetText = (budget) => (budget === 0 ? "free" : `up to $${budget}`);
const requestLabel = (choices) => choices.activityRequest || MOODS[choices.mood]?.noun || "a campus break";
const routeText = (plan) => plan.stops.map(({ item }) => item.title).join(" → ");

// ---- Consent ------------------------------------------------------------------------------

const consentRemembered = () => storage.get("sessionStorage", CONSENT_KEY) === "allowed";

function renderConsentMemory() {
  const forget = $("#forget-consent");
  if (forget) forget.hidden = !consentRemembered();
}

/**
 * Ask before reading both groups' public lists, unless the visitor allowed it for this tab.
 *
 * :return: True when allowed.
 */
function askConsent() {
  if (consentRemembered()) return Promise.resolve(true);
  const dialog = $("#contact-dialog");
  if (!dialog) return Promise.resolve(false);
  const list = $("#contact-sites");
  list.replaceChildren();
  for (const peer of PEERS) {
    const row = document.createElement("div");
    row.className = "contact-site";
    const name = document.createElement("span");
    const title = document.createElement("strong");
    const origin = document.createElement("small");
    title.textContent = peer.name;
    origin.textContent = new URL(peer.base).origin;
    name.append(title, origin);
    const badge = document.createElement("b");
    badge.textContent = "READ ONLY";
    row.append(name, badge);
    list.append(row);
  }
  $("#remember-consent").checked = false;
  dialog.returnValue = "cancel";
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener("close", () => {
    const allowed = dialog.returnValue === "allow";
    if (allowed && $("#remember-consent").checked) {
      storage.set("sessionStorage", CONSENT_KEY, "allowed");
      renderConsentMemory();
    }
    resolve(allowed);
  }, { once: true }));
}

// ---- Reading the groups' lists ------------------------------------------------------------

async function fetchPeer(peer) {
  const url = `${peer.base}/agent-manifest.json`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(url, { credentials: "omit", cache: "no-store", signal: controller.signal });
  } catch (error) {
    throw new Error(`${peer.name} did not respond${error.name === "AbortError" ? " within 10 seconds" : ". Check that its site is running and allows public agent files"}.`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`${peer.name} returned HTTP ${response.status}.`);
  if (!response.url || new URL(response.url).origin !== new URL(peer.base).origin) throw new Error(`${peer.name} redirected to a different website.`);
  const manifest = await response.json();
  if (!manifest.networks?.some((network) => network?.name === peer.network)) throw new Error(`${peer.name} does not publish the expected ${peer.network} network.`);
  if (!manifest.actions?.bridge) throw new Error(`${peer.name} has no public read bridge.`);
  const client = new ActionBridgeClient(sameOriginAsset(peer.base, manifest.actions.bridge), manifest.brand || peer.name);
  try {
    await client.connect(false);
    const catalog = await client.request("catalog");
    const action = Array.isArray(catalog) ? catalog.find((entry) => entry.name === "get_activities" && entry.effect === "read") : null;
    if (!action) throw new Error(`${peer.name} does not share the read-only activity list.`);
    const requestId = crypto.randomUUID?.() || `sidequest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    // Nothing about the visitor is sent: the read takes no arguments.
    const result = await client.request("execute", { name: action.name, args: {}, requestId });
    if (!Array.isArray(result?.activities)) throw new Error(`${peer.name} returned an invalid activity list.`);
    return { peer, activities: result.activities };
  } finally {
    client.dispose();
  }
}

function setAgentStep(id, state, text) {
  const row = $(`#agent-step-${id}`);
  if (!row) return;
  row.dataset.state = state;
  const description = row.querySelector(".agent-step-copy");
  if (description && text) description.textContent = text;
}

const planSummary = (plan) => ({
  label: plan.label,
  minutes: plan.minutes,
  cost: plan.cost,
  stops: plan.stops.map(({ peer, item }) => ({ title: item.title, source: peer.name, duration: item.duration, cost: item.cost, setting: item.setting || "", url: `${peer.base}/` })),
});

/**
 * Build plans from the current choices: ask, read both public lists, rank them here.
 *
 * :return: {ok: true, choices, options} or {ok: false, reason, declined?}.
 */
function build() {
  if (building) return building;
  building = runBuild().finally(() => { building = null; });
  return building;
}

async function runBuild() {
  const status = $("#planner-status");
  const button = $("#build-quest");
  const choices = currentChoices();
  if (button) button.disabled = true;
  status.dataset.kind = "";
  status.textContent = "";
  try {
    const remembered = consentRemembered();
    if (!(await askConsent())) {
      status.textContent = "No activity sites were contacted.";
      lastPlan = null;
      return { ok: false, declined: true, reason: "The visitor declined to let Sidequest read the activity lists. Nothing was contacted." };
    }
    $("#agent-steps")?.removeAttribute("hidden");
    setAgentStep("maker", "waiting", "Makers Studio");
    setAgentStep("games", "waiting", "Campus Games");
    setAgentStep("match", "waiting", "Match your choices");
    status.dataset.kind = "loading";
    status.textContent = remembered ? "Reading both public lists (you allowed this for this tab)." : "Reading both public lists. Your choices stay on this page.";
    const lists = await Promise.all(PEERS.map(async (peer) => {
      setAgentStep(peer.id, "working", `Reading ${peer.name}’s public list…`);
      try {
        const response = await fetchPeer(peer);
        setAgentStep(peer.id, "done", `${peer.name}: ${response.activities.length} listings read`);
        return response;
      } catch (error) {
        setAgentStep(peer.id, "error", `${peer.name}: could not be reached`);
        throw error;
      }
    }));

    setAgentStep("match", "working", "Matching your choices…");
    const plans = findPlans(lists, choices);
    if (!plans.length) {
      setAgentStep("match", "error", "Nothing fits those limits");
      throw new Error(choices.activityRequest
        ? `No listing matched “${choices.activityRequest}” within ${choices.timeMinutes} minutes, ${budgetText(choices.budget)}. Try other words, more time or a bigger budget.`
        : "No activities fit those choices. Try more time, a bigger budget or another vibe.");
    }
    setAgentStep("match", "done", `${plans.length} option${plans.length === 1 ? "" : "s"} fit your limits`);
    lastPlan = { ...plans[0], choices, options: plans };
    renderPlans(plans, choices);
    status.dataset.kind = "success";
    status.textContent = "Done. Pick an option below to start your quest.";
    return { ok: true, choices, options: plans.map(planSummary), note: "Demo listings, not scheduled events. The visitor starts a quest with “Choose this quest” on the page." };
  } catch (error) {
    status.dataset.kind = "error";
    status.textContent = error.message || "The activity lists could not be read. Please try again.";
    lastPlan = null;
    return { ok: false, reason: status.textContent };
  } finally {
    if (button) button.disabled = false;
  }
}

// ---- Results and the active quest ---------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function groupLink(peer, text) {
  const link = el("a", "", text);
  link.href = `${peer.base}/`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function renderPlans(plans, choices) {
  const root = $("#quest-result");
  root.replaceChildren();
  root.hidden = false;
  const heading = el("div", "quest-result-head");
  const copy = el("div");
  const summary = `${choices.activityRequest ? `For “${choices.activityRequest}”` : MOODS[choices.mood]?.label || "Your break"} · ${choices.timeMinutes} min · ${choices.budget === 0 ? "Free only" : `up to $${choices.budget}`}`;
  copy.append(el("p", "quest-kicker", "YOUR SIDEQUEST OPTIONS"), el("h3", "", "Pick the break that feels right."), el("p", "quest-summary", summary));
  heading.append(copy);
  root.append(heading);

  const grid = el("div", "plan-grid");
  plans.forEach((plan) => {
    const card = el("article", "plan-card");
    const head = el("div", "plan-card-head");
    head.append(el("span", "plan-label", plan.label), el("strong", "plan-total", formatCost(plan.cost)));
    const list = el("ol", "plan-stops");
    plan.stops.forEach(({ peer, item }) => {
      const row = el("li");
      row.append(el("strong", "", item.title), el("span", "", `${peer.name} · ${item.duration} min · ${formatCost(item.cost)}`), groupLink(peer, "View group ↗"));
      list.append(row);
    });
    const choose = el("button", "choose-quest-button", "Choose this quest →");
    choose.type = "button";
    choose.addEventListener("click", () => startQuest(plan, choices));
    card.append(head, el("p", "plan-time", `${plan.minutes} min · ${plan.stops.length === 1 ? "1 activity" : `${plan.stops.length} stops`}`), list, choose);
    grid.append(card);
  });
  root.append(grid);
  const why = choices.activityRequest ? "Ranked by how closely each listing matches your request" : `Matched to your ${MOODS[choices.mood]?.adjective || ""} vibe`;
  root.append(el("p", "quest-why", `${why}, from both groups’ public sample lists. Each group lists its own access and hours.`));
}

const WILDCARDS = {
  meet: ["Invite someone to join your next stop, or share one thing you enjoyed about it.", "Ask someone at your stop for their favourite spot on campus."],
  make: ["Collect a color or shape from your surroundings to inspire your next tiny creation.", "Leave one small thing you made somewhere it might make someone smile."],
  move: ["Take the scenic path to your next stop and notice one detail you usually miss.", "Find a spot on campus you have never stood in before."],
};

function startQuest(plan, choices) {
  const root = $("#quest-result");
  root.querySelector(".active-quest")?.remove();
  const checked = new Set();
  const quest = el("section", "active-quest");
  quest.setAttribute("aria-label", "Active Sidequest");
  const head = el("div", "active-quest-head");
  const share = el("button", "share-quest-button", "Invite a friend");
  share.type = "button";
  share.addEventListener("click", async () => {
    const text = `${MOODS[choices.mood]?.label || "Campus"} Sidequest: ${routeText(plan)} (${plan.minutes} min, ${formatCost(plan.cost)}).`;
    try {
      if (navigator.share) await navigator.share({ title: "My Campus Sidequest", text, url: location.href.split("#")[0] });
      else { await navigator.clipboard.writeText(text); share.textContent = "Invite copied!"; }
    } catch (error) { if (error.name !== "AbortError") share.textContent = "Could not share"; }
  });
  head.append(el("h3", "", "Your quest is on."), share);
  quest.append(head);

  const finish = el("button", "finish-quest-button", "Finish quest");
  finish.type = "button";
  finish.disabled = true;
  const route = el("ol", "quest-route-list");
  plan.stops.forEach(({ peer, item }, index) => {
    const row = el("li");
    const label = el("label", "quest-stop-check");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const copy = el("span");
    copy.append(
      el("b", "", `${index + 1}. ${item.title}`),
      el("small", "", `${item.duration} min · ${item.setting || "See the group's page for the place"} · ${formatCost(item.cost)}`),
      el("small", "", item.description || ""),
      groupLink(peer, `Check hours, access & details at ${peer.name} ↗`),
    );
    label.append(checkbox, copy);
    row.append(label);
    route.append(row);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) checked.add(index); else checked.delete(index);
      finish.disabled = checked.size !== plan.stops.length;
    });
  });
  quest.append(route);

  const cards = WILDCARDS[choices.mood] || WILDCARDS.move;
  let wildcardIndex = 0;
  const wildcard = el("div", "wildcard-card");
  const wildcardText = el("p", "", `Wildcard challenge: ${cards[0]}`);
  const reroll = el("button", "", "Give me another wildcard");
  reroll.type = "button";
  reroll.addEventListener("click", () => {
    wildcardIndex = (wildcardIndex + 1) % cards.length;
    wildcardText.textContent = `Wildcard challenge: ${cards[wildcardIndex]}`;
  });
  wildcard.append(wildcardText, reroll);
  quest.append(wildcard);

  const recap = el("p", "quest-recap");
  recap.hidden = true;
  finish.addEventListener("click", () => {
    const progress = readProgress();
    progress.completed = (progress.completed || 0) + 1;
    progress.badges ||= [];
    const earned = { 1: "First Steps", 3: "Campus Regular", 5: "Quest Collector" }[progress.completed] || null;
    if (earned && !progress.badges.includes(earned)) progress.badges.push(earned);
    storage.set("localStorage", PROGRESS_KEY, JSON.stringify(progress));
    renderProgress();
    recap.hidden = false;
    recap.textContent = `Quest complete! ${earned ? `You earned the ${earned} badge. ` : ""}${routeText(plan)} · ${plan.minutes} min · ${formatCost(plan.cost)}.`;
    finish.disabled = true;
    finish.textContent = "Completed ✓";
  });
  quest.append(finish, recap);
  root.append(quest);
  quest.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---- Quick chat (no key) ------------------------------------------------------------------

function addChatMessage(message, sender = "assistant", pending = false) {
  const line = el("p", `chat-message ${sender}-message${pending ? " pending-message" : ""}`, message);
  $("#chat-messages").append(line);
  line.scrollIntoView({ block: "nearest" });
  return line;
}

async function handleQuickChat(message) {
  const parsed = parseMessage(message, { hasActivity: hasChatActivity });
  if (parsed.kind === "reset") {
    resetChoices();
    addChatMessage(parsed.reply);
    return;
  }
  if (parsed.kind !== "plan" && parsed.kind !== "need-activity") {
    addChatMessage(parsed.reply);
    return;
  }
  setChoices(parsed.patch);
  if (parsed.kind === "plan") hasChatActivity = true;
  const notes = parsed.notes?.length ? ` ${parsed.notes.join(" ")}` : "";
  if (parsed.kind === "need-activity") {
    addChatMessage(`${parsed.reply}${notes}`);
    return;
  }
  const choices = currentChoices();
  const pending = addChatMessage(`Looking for ${requestLabel(choices)} · ${choices.timeMinutes} min · ${budgetText(choices.budget)}.${notes} ${consentRemembered() ? "Reading both groups’ public lists…" : "I’ll read both groups’ public lists after you approve."}`, "assistant", true);
  const result = await build();
  pending.classList.remove("pending-message");
  if (result.ok) {
    const top = result.options[0];
    const more = result.options.length - 1;
    const widen = result.options.length < 3 ? " More time or budget would give you more options." : "";
    addChatMessage(`Top pick: ${top.stops.map((stop) => `${stop.title} (${stop.source})`).join(" → ")}, ${top.minutes} min, ${formatCost(top.cost).toLowerCase()}.${more ? ` ${more} more option${more === 1 ? "" : "s"} below.` : ""} Tap “Choose this quest” to start.${widen}`);
  } else if (result.declined) {
    addChatMessage("No problem. I didn’t contact either group. Message me again whenever you’re ready.");
  } else {
    addChatMessage(result.reason || "The activity lists could not be read. Please try again.");
  }
}

// ---- Chat mode: quick chat or the AI agent ------------------------------------------------

let agentStart = null;

async function setMode(mode) {
  const ai = mode === "ai";
  $("#mode-quick").setAttribute("aria-pressed", String(!ai));
  $("#mode-ai").setAttribute("aria-pressed", String(ai));
  $("#quick-pane").hidden = ai;
  $("#ai-pane").hidden = !ai;
  $(".side-agent").dataset.mode = ai ? "ai" : "quick";
  storage.set("sessionStorage", MODE_KEY, ai ? "ai" : null);
  if (ai && !agentStart) {
    agentStart = import("./site.js").then(({ AssistantMount }) => AssistantMount.start());
  }
  if (ai) await agentStart;
}

// ---- Wiring -------------------------------------------------------------------------------

export const Sidequest = {
  currentChoices,
  setChoices,
  build,
  status: () => ({
    choices: currentChoices(),
    sources: PEERS.map((peer) => ({ name: peer.name, url: `${peer.base}/`, network: peer.network })),
    lastPlan: lastPlan ? { minutes: lastPlan.minutes, cost: lastPlan.cost, route: routeText(lastPlan), optionCount: lastPlan.options.length } : null,
    readsAllowedForThisTab: consentRemembered(),
  }),
};

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.Sidequest = Sidequest;
  renderProgress();
  renderConsentMemory();
  $("#forget-consent")?.addEventListener("click", () => {
    storage.set("sessionStorage", CONSENT_KEY, null);
    renderConsentMemory();
    $("#planner-status").dataset.kind = "";
    $("#planner-status").textContent = "Sidequest will ask again before reading the activity lists.";
  });
  $("#quest-form")?.addEventListener("submit", async (event) => { event.preventDefault(); await build(); });
  $("#mode-quick")?.addEventListener("click", () => setMode("quick"));
  $("#mode-ai")?.addEventListener("click", () => setMode("ai"));
  if (storage.get("sessionStorage", MODE_KEY) === "ai") setMode("ai");
  $("#chat-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#chat-input");
    const send = $("#chat-send");
    const message = input.value.trim();
    if (!message || send.disabled) return;
    addChatMessage(message, "user");
    input.value = "";
    send.disabled = true;
    try {
      await handleQuickChat(message);
    } catch (error) {
      addChatMessage(`Something went wrong: ${error.message || "please try again"}`);
    } finally {
      send.disabled = false;
      input.focus();
    }
  });
}
