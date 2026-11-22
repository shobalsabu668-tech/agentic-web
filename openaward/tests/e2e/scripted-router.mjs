// A scripted, OpenAI-compatible LLM router for the assistant end-to-end check.
//
// It plays each agent by the first line of its system prompt, so the whole agent path runs
// in the browser runtime exactly as it would with a real model, but deterministically:
//
//   passport_assistant       -> for "the least I need to share": website_read_publisher_rules,
//                               then website_plan_disclosure, then each plan's advice;
//                               for "Follow the plan": website_apply_disclosure_plan;
//                               otherwise website_prepare_publisher_request, then the
//                               publisher's partner tool with requestText unchanged, then a
//                               final answer
//   pell_desk_assistant      -> pell_eligibility_checker with the request, then an answer
//   pell_eligibility_checker -> website_check_eligibility with the request's fields, then
//                               an answer with the outcome and the fields received
//
// It records, per request, which agent asked, the tools offered, the model, and whether the
// Authorization header carried the expected key (a flag, never the key).
import http from "node:http";
import { once } from "node:events";

const INTEGER_FIELDS = new Set(["residenceMonths", "sai", "pellLifetimeUsed"]);

export class ScriptedRouter {
  static MODELS = ["gpt-4.1-mini", "gpt-4.1-nano"];

  constructor(key) {
    this.key = key;
    this.records = [];
    this.calls = 0;
    this.server = null;
  }

  static role(system) {
    const first = system.split("\n")[0];
    if (first.startsWith("You are the assistant on OpenAward Passport") || first.startsWith("You are OpenAward's private student-funding guide")) {
      return "passport";
    }
    if (first.startsWith("You are the assistant of the Pell Rules Desk")) {
      return "pell_front";
    }
    if (first.startsWith("You screen passport fields for the Pell Rules Desk")) {
      return "pell_checker";
    }
    // Campus Sidequest (tests/e2e/run-sidequest-e2e.mjs).
    if (system.includes("You are the Campus Sidequest agent")) {
      return "sidequest";
    }
    if (system.includes("You are the Makers Studio guide")) {
      return "maker_front";
    }
    return "other";
  }

  static receipt(content) {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  static text(content) {
    const parsed = ScriptedRouter.receipt(content);
    return parsed && typeof parsed.text === "string" ? parsed.text : String(content);
  }

  /**
   * Parse "Check <id>: a=b c=1" into {opportunityId, fields}.
   */
  static parseCheck(request) {
    const match = /Check ([a-z0-9_]+):\s*(.*)$/s.exec(String(request));
    if (!match) {
      return null;
    }
    const fields = {};
    for (const pair of match[2].trim().split(/\s+/)) {
      const [key, value] = pair.split("=");
      if (key && value !== undefined) {
        fields[key] = INTEGER_FIELDS.has(key) ? Number(value) : value;
      }
    }
    return { opportunityId: match[1], fields };
  }

  decide(role, messages, tools = []) {
    const results = messages.filter((message) => message.role === "tool").map((message) => String(message.content));
    const lastUser = [...messages].reverse().find((message) => message.role === "user")?.content || "";
    if (role === "sidequest" && /zine/.test(lastUser)) {
      // Plays the hub agent: set the planner from the message, build, then report.
      if (results.length === 0) {
        return { tool: "website_set_sidequest_choices", args: { mood: "make", timeMinutes: 30, budget: 0, activityRequest: "zine" } };
      }
      if (results.length === 1) {
        return { tool: "website_build_sidequest", args: {} };
      }
      const built = ScriptedRouter.receipt(results[1])?.result;
      const top = built?.options?.[0];
      return { text: `SIDEQUEST_PLAN: ok=${built?.ok}; options=${built?.options?.length ?? 0}; top=${top ? top.stops.map((stop) => `${stop.title} (${stop.source})`).join(" + ") : built?.reason}` };
    }
    if (role === "sidequest" && /Makers Studio offer/.test(lastUser)) {
      if (results.length === 0) {
        const partner = tools.find((name) => name.includes("maker_studio"));
        return partner
          ? { tool: partner, args: { request: "Summarize your public demo activity list with names, times and costs." } }
          : { text: `SIDEQUEST_PARTNER: no maker_studio tool in ${tools.join(",")}` };
      }
      return { text: `SIDEQUEST_PARTNER: ${ScriptedRouter.text(results[results.length - 1])}` };
    }
    if (role === "maker_front") {
      if (results.length === 0) {
        return { tool: "website_get_activities", args: {} };
      }
      const list = ScriptedRouter.receipt(results[0])?.result?.activities || [];
      return { text: `MAKER_FRONT: ${list.length} activities, first ${list[0]?.title || "none"}; asked "${lastUser.slice(0, 80)}"` };
    }
    if (role === "passport" && /least I need to share/.test(lastUser)) {
      if (results.length === 0) {
        return { tool: "website_read_publisher_rules", args: {} };
      }
      if (results.length === 1) {
        return { tool: "website_plan_disclosure", args: {} };
      }
      const plans = ScriptedRouter.receipt(results[1])?.result?.plans || [];
      return { text: `PASSPORT_PLAN: ${plans.map((plan) => `${plan.key}=${plan.advice}`).join("; ")}` };
    }
    if (role === "passport" && /Follow the plan/.test(lastUser)) {
      if (results.length === 0) {
        return { tool: "website_apply_disclosure_plan", args: { opportunityKey: "pell:federal_pell_grant" } };
      }
      return { text: `PASSPORT_APPLIED: ${JSON.stringify(ScriptedRouter.receipt(results[0])?.result ?? results[0])}` };
    }
    if (role === "passport") {
      if (results.length === 0) {
        return { tool: "website_prepare_publisher_request", args: { opportunityKey: "pell:federal_pell_grant" } };
      }
      if (results.length === 1) {
        const receipt = ScriptedRouter.receipt(results[0]);
        const prepared = receipt?.result;
        if (!prepared?.ok) {
          return { text: `PASSPORT_FINAL: could not prepare: ${prepared?.reason || results[0]}` };
        }
        return { tool: prepared.partnerTool, args: { request: prepared.requestText } };
      }
      return { text: `PASSPORT_FINAL: ${ScriptedRouter.text(results[results.length - 1])}` };
    }
    if (role === "pell_front") {
      if (results.length === 0) {
        return { tool: "pell_eligibility_checker", args: { request: lastUser } };
      }
      return { text: `PELL_FRONT: ${ScriptedRouter.text(results[results.length - 1])}` };
    }
    if (role === "pell_checker") {
      if (results.length === 0) {
        const parsed = ScriptedRouter.parseCheck(lastUser);
        if (!parsed) {
          return { text: `CHECKER: no check request in "${lastUser}"` };
        }
        return { tool: "website_check_eligibility", args: parsed };
      }
      const receipt = ScriptedRouter.receipt(results[0]);
      const outcome = receipt?.result?.result;
      if (receipt?.status !== "succeeded" || !outcome) {
        return { text: `CHECKER: check failed: ${results[0].slice(0, 300)}` };
      }
      return { text: `CHECKER: outcome=${outcome.outcome}; received=${outcome.received.join(",")}; evaluatedBy=${outcome.evaluatedBy}` };
    }
    return { text: "UNSCRIPTED" };
  }

  stream(model, reply) {
    let delta;
    if (reply.tool) {
      this.calls += 1;
      delta = { role: "assistant", tool_calls: [{ index: 0, id: `call_scripted_${this.calls}`, type: "function", function: { name: reply.tool, arguments: JSON.stringify(reply.args) } }] };
    } else {
      delta = { role: "assistant", content: reply.text };
    }
    const chunk = { id: "chatcmpl-scripted", object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: reply.tool ? "tool_calls" : "stop" }] };
    const usage = { id: "chatcmpl-scripted", object: "chat.completion.chunk", model, choices: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
    return `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(usage)}\n\ndata: [DONE]\n\n`;
  }

  respond(method, path, headers, body) {
    const authorization = typeof headers.authorization === "string" ? headers.authorization : null;
    const record = { method, path, origin: headers.origin || null, authorization: authorization !== null, keyOk: authorization === `Bearer ${this.key}` };
    this.records.push(record);
    if (method === "OPTIONS") {
      return { status: 204, type: "text/plain", body: "" };
    }
    if (method === "GET" && path === "/v1/models") {
      return { status: 200, type: "application/json", body: JSON.stringify({ object: "list", data: ScriptedRouter.MODELS.map((id) => ({ id, object: "model" })) }) };
    }
    if (method === "POST" && path === "/v1/chat/completions") {
      const parsed = JSON.parse(body);
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      const system = typeof messages[0]?.content === "string" ? messages[0].content : "";
      record.kind = "chat";
      record.model = parsed.model;
      record.role = ScriptedRouter.role(system);
      record.tools = (parsed.tools || []).map((tool) => tool.function?.name);
      record.body = body;
      record.reply = this.decide(record.role, messages, record.tools);
      return { status: 200, type: "text/event-stream", body: this.stream(parsed.model, record.reply) };
    }
    return { status: 404, type: "text/plain", body: "Not found" };
  }

  async handle(request, response) {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    let answer;
    try {
      answer = this.respond(request.method, new URL(request.url, "http://127.0.0.1").pathname, request.headers, Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      answer = { status: 500, type: "text/plain", body: String(error.message || error) };
    }
    response.writeHead(answer.status, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, content-type, anthropic-dangerous-direct-browser-access",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Cache-Control": "no-store",
      "Content-Type": answer.type,
    });
    response.end(answer.body);
  }

  async listen(port) {
    this.server = http.createServer(this.handle.bind(this));
    this.server.listen(port, "127.0.0.1");
    await once(this.server, "listening");
    return port;
  }

  async close() {
    if (this.server) {
      this.server.close();
      this.server.closeAllConnections();
    }
  }

  chats(role) {
    return this.records.filter((record) => record.kind === "chat" && (!role || record.role === role));
  }
}
