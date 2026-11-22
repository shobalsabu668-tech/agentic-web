// Where the passport lives: in this browser only.
//
// By default everything is in sessionStorage, so it disappears when the tab closes. The
// student can choose "keep on this device", which moves only the passport fields to
// localStorage. Nothing is ever sent to a server by this module. Every storage call is
// wrapped, because storage can be missing or blocked (private windows, previews).

import { FIELD_BY_ID, PROFILE_VERSION, fieldError } from "../kit/passport-fields.js";

const PASSPORT_KEY = "openaward.passport.v1";
const SESSION_KEY = "openaward.session.v1";

function storage(kind) {
  try {
    const store = kind === "local" ? globalThis.localStorage : globalThis.sessionStorage;
    return store || null;
  } catch {
    return null;
  }
}

function readJson(kind, key) {
  try {
    const raw = storage(kind)?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(kind, key, value) {
  try {
    storage(kind)?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(kind, key) {
  try {
    storage(kind)?.removeItem(key);
  } catch {
    // Nothing to remove.
  }
}

/**
 * Keep only valid passport fields, so a stored or imported file can never inject
 * unknown keys or bad values.
 *
 * :param fields: Any object.
 * :return: {fields, dropped}.
 */
export function cleanFields(fields) {
  const clean = {};
  const dropped = [];
  for (const [id, value] of Object.entries(fields && typeof fields === "object" ? fields : {})) {
    if (FIELD_BY_ID[id] && fieldError(id, value) === null) {
      clean[id] = value;
    } else {
      dropped.push(id);
    }
  }
  return { fields: clean, dropped };
}

export class PassportStore {
  /**
   * Load what this browser holds.
   *
   * :return: {fields, mode, session}.
   */
  static load() {
    const device = readJson("local", PASSPORT_KEY);
    const tab = readJson("session", PASSPORT_KEY);
    const source = device || tab;
    const session = readJson("session", SESSION_KEY) || {};
    return {
      fields: cleanFields(source?.fields).fields,
      mode: device ? "device" : "tab",
      session: {
        sharing: session.sharing && typeof session.sharing === "object" ? session.sharing : {},
        results: session.results && typeof session.results === "object" ? session.results : {},
        checklist: Array.isArray(session.checklist) ? session.checklist : [],
        activity: Array.isArray(session.activity) ? session.activity.slice(-100) : [],
        connected: Array.isArray(session.connected) ? session.connected : [],
        // Public rules a publisher returned after the student agreed, kept for this tab so a
        // reload does not ask again. Results are re-checked by resultProblem before display.
        rules: session.rules && typeof session.rules === "object" ? session.rules : {},
      },
    };
  }

  /**
   * Save the passport fields where the student chose.
   *
   * :param fields: Valid fields.
   * :param mode: "tab" or "device".
   */
  static saveFields(fields, mode) {
    const doc = { profileVersion: PROFILE_VERSION, fields };
    if (mode === "device") {
      writeJson("local", PASSPORT_KEY, doc);
      remove("session", PASSPORT_KEY);
    } else {
      writeJson("session", PASSPORT_KEY, doc);
      remove("local", PASSPORT_KEY);
    }
  }

  /**
   * Save the tab's working state: sharing choices, results, checklist, activity log.
   *
   * :param session: The state.
   */
  static saveSession(session) {
    writeJson("session", SESSION_KEY, session);
  }

  /**
   * Delete everything this site stored, in both storages.
   */
  static deleteAll() {
    for (const kind of ["local", "session"]) {
      remove(kind, PASSPORT_KEY);
      remove(kind, SESSION_KEY);
    }
  }

  /**
   * The portable passport file a student can download and load elsewhere.
   *
   * :param fields: Valid fields.
   * :return: The file's text.
   */
  static exportText(fields) {
    return JSON.stringify({ format: PROFILE_VERSION, exportedAt: new Date().toISOString(), fields }, null, 2);
  }

  /**
   * Read a passport file.
   *
   * :param text: The file's text.
   * :return: {ok, fields, dropped} or {ok: false, reason}.
   */
  static importText(text) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      return { ok: false, reason: "That file is not JSON." };
    }
    if (!doc || doc.format !== PROFILE_VERSION) {
      return { ok: false, reason: "That file isn't a supported OpenAward profile file." };
    }
    return { ok: true, ...cleanFields(doc.fields) };
  }
}
