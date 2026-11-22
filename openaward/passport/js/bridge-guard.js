// The passport's last word on what crosses to a publisher.
//
// A publisher's network runs in this page, on the visitor's own model, and it reaches the
// publisher's origin only through the runtime's ActionBridgeClient: the hidden, sandboxed
// frame on the publisher's origin, and its message port. The page flow uses the same
// client. This module wraps ActionBridgeClient.prototype.request, so every message is
// checked by App.inspectBridgeRequest before it is posted:
//
//   - the handshake and the action catalog pass: they carry no passport data;
//   - get_published_rules passes with no arguments;
//   - check_eligibility passes only with fields the student shares for that opportunity,
//     each holding the passport's own value.
//
// Anything else is refused before it leaves the page, and logged in "What left this page".
// Whatever a model writes, a publisher cannot receive a field the student kept off. The
// answers to the assistant's calls are recorded on the page like the page's own results.
// The runtime itself is unchanged.

import { ActionBridgeClient } from "../runtime/action-transport.js";

export class BridgeGuard {
  /**
   * Install the check once.
   *
   * :param page: The App, which implements inspectBridgeRequest, onBridgeRefused and
   *     recordBridgeOutcome.
   * :param Client: The bridge client class; tests pass a stand-in.
   * :return: True when installed by this call.
   */
  static install(page, Client = ActionBridgeClient) {
    const proto = Client.prototype;
    if (proto.openawardGuarded) {
      return false;
    }
    const original = proto.request;
    proto.request = function guardedRequest(type, payload = {}) {
      const verdict = page.inspectBridgeRequest(this.url, type, payload);
      if (!verdict.ok) {
        page.onBridgeRefused(this.url, payload, verdict.reason);
        return Promise.reject(new Error(verdict.reason));
      }
      const pending = original.call(this, type, payload);
      if (verdict.record) {
        pending.then((value) => page.recordBridgeOutcome(verdict, value, null), (error) => page.recordBridgeOutcome(verdict, null, error));
      }
      return pending;
    };
    Object.defineProperty(proto, "openawardGuarded", { value: true });
    return true;
  }
}
