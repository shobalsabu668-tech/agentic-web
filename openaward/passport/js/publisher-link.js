// Talks to one publisher, on the publisher's origin, only after the student agreed.
//
// 1. Resolve (spec section 3.2): fetch <site base>/agent-manifest.json without credentials,
//    pick the network whose name matches exactly or fail, and require an OpenAward
//    publisher with an action bridge. A redirect to another origin is refused.
// 2. Call: open the publisher's bridge/action-bridge.html in a hidden, sandboxed frame on
//    the publisher's origin with the runtime's own ActionBridgeClient, read the catalog,
//    and run one shared read there. The publisher's code does the work, in its own origin.
//
// Nothing in this module runs before the page's consent dialog returns "allow".

import { ActionBridgeClient, sameOriginAsset } from "../runtime/action-transport.js";
import { parseNetworkUrl } from "./publisher-directory.js";

const MANIFEST_TIMEOUT_MS = 10000;

export class PublisherLink {
  /**
   * :param entry: A directory entry with networkUrl.
   */
  constructor(entry) {
    this.entry = entry;
    this.parsed = parseNetworkUrl(entry.networkUrl);
    this.manifest = null;
    this.bridgeUrl = null;
  }

  /**
   * Resolve the publisher's manifest. Fails closed with a reason.
   *
   * :return: {ok, brand, bridgeUrl, rulesFormat} or {ok: false, reason}.
   */
  async resolve() {
    if (!this.parsed) {
      return { ok: false, reason: "That is not a usable network URL. Use https, or http on localhost for development." };
    }
    const manifestUrl = `${this.parsed.base}/agent-manifest.json`;
    let response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);
    try {
      response = await fetch(manifestUrl, { credentials: "omit", cache: "no-store", signal: controller.signal });
    } catch (error) {
      return { ok: false, reason: `Could not read ${manifestUrl}: ${error.name === "AbortError" ? "no answer in 10 s" : "the site is down or sends no CORS header"}.` };
    } finally {
      clearTimeout(timer);
    }
    if (new URL(response.url).origin !== this.parsed.origin) {
      return { ok: false, reason: `The manifest redirected to ${new URL(response.url).origin}, a different origin you did not agree to contact.` };
    }
    if (!response.ok) {
      return { ok: false, reason: `${manifestUrl} answered HTTP ${response.status}.` };
    }
    let manifest;
    try {
      manifest = await response.json();
    } catch {
      return { ok: false, reason: "The publisher's manifest is not valid JSON." };
    }
    const networks = Array.isArray(manifest?.networks) ? manifest.networks : [];
    if (!networks.some((item) => item && item.name === this.parsed.network)) {
      return { ok: false, reason: `The publisher's manifest lists no network named exactly "${this.parsed.network}".` };
    }
    if (manifest.openaward?.role !== "publisher" || manifest.openaward?.rulesFormat !== "openaward-rules/v1") {
      return { ok: false, reason: "That site does not publish OpenAward rules (no openaward publisher block in its manifest)." };
    }
    if (!manifest.actions?.bridge) {
      return { ok: false, reason: "The publisher's manifest names no action bridge." };
    }
    try {
      this.bridgeUrl = sameOriginAsset(this.parsed.base, manifest.actions.bridge);
    } catch (error) {
      return { ok: false, reason: error.message };
    }
    this.manifest = manifest;
    return { ok: true, brand: String(manifest.brand || this.entry.label), bridgeUrl: this.bridgeUrl };
  }

  /**
   * Run one read the publisher shares, on the publisher's origin.
   *
   * :param name: The action name, such as "check_eligibility".
   * :param args: Its arguments.
   * :return: The action's return value.
   * :raises Error: When the bridge is unavailable, the action is not shared, or it fails.
   */
  async call(name, args) {
    if (!this.bridgeUrl) {
      const resolved = await this.resolve();
      if (!resolved.ok) {
        throw new Error(resolved.reason);
      }
    }
    const client = new ActionBridgeClient(this.bridgeUrl, this.entry.label);
    try {
      // A hidden frame only. Reads never need the publisher's own window.
      await client.connect(false);
      const catalog = await client.request("catalog");
      const entry = Array.isArray(catalog) ? catalog.find((item) => item && item.name === name) : null;
      if (!entry || entry.effect !== "read") {
        throw new Error(`The publisher does not share a read named ${name} with this site.`);
      }
      const requestId = globalThis.crypto?.randomUUID ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return await client.request("execute", { name, args, requestId });
    } finally {
      client.dispose();
    }
  }
}
