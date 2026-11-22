// The publishers this passport knows. Each is an independent agent site that publishes an
// OpenAward rules network. Only the label and the network URL are known before the
// student agrees to contact a publisher; everything else comes from the publisher itself.
//
// These are the local-development addresses: three host names on purpose (127.0.0.1 for
// this passport, localhost and [::1] for the publishers), so they are three origins and the
// runtime's loopback key cookie never reaches a publisher. scripts/retarget.mjs rewrites
// them, here and in the network and manifest, for a hosted deployment.

export const PUBLISHERS = [
  {
    id: "pell",
    label: "Pell Rules Desk",
    networkUrl: "http://localhost:8081/pell_rules_desk",
    blurb: "Federal Pell Grant rules · Unofficial demo publisher.",
  },
  {
    id: "oregon",
    label: "Oregon Grant Rules Desk",
    networkUrl: "http://[::1]:8083/oregon_grant_desk",
    blurb: "Oregon Opportunity Grant rules for 2026-27 and 2027-28 · Unofficial demo publisher.",
  },
];

/**
 * Split a network URL into its site base and network name (spec section 3.2: the final
 * path component is the network name; the rest is the site base).
 *
 * :param networkUrl: An http(s) network URL.
 * :return: {base, network, origin, partnerTool} or null when the URL is not usable.
 */
export function parseNetworkUrl(networkUrl) {
  let url;
  try {
    url = new URL(networkUrl);
  } catch {
    return null;
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const network = parts.pop();
  if (!network || !/^[A-Za-z][\w-]{0,79}$/.test(network)) {
    return null;
  }
  const base = `${url.origin}${parts.length ? `/${parts.join("/")}` : ""}`;
  // The runtime names a partner tool after the URL's whole path (runtime/runner.js, safeName).
  const partnerTool = url.pathname.split("/").filter(Boolean).join("_").replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "").slice(0, 60);
  return { base, network, origin: url.origin, partnerTool };
}
