// OpenAward Passport profile vocabulary, version 0.1.
//
// This is the shared language between a student's passport and award publishers. A
// publisher's rules name these field ids, so any passport that speaks this vocabulary can
// ask any publisher that publishes rules in it. Values are short codes, so a request fits
// on the runtime's consent card and a publisher never has to parse free text.
//
// Part of the OpenAward publisher kit. Copied unchanged into each site by scripts/build.mjs.

export const PROFILE_VERSION = "openaward-passport/0.1";

const STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN",
  "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
  "VT", "VA", "WA", "WV", "WI", "WY", "AS", "GU", "MP", "PR", "VI", "outside_us",
];

/**
 * Every passport field. `sensitive` fields are never shared unless the student turns them
 * on for one request. `options` give each code a label the student reads.
 */
export const PASSPORT_FIELDS = [
  {
    id: "residenceState",
    label: "State where you live",
    help: "Two-letter code, or outside the U.S.",
    type: "enum",
    options: STATES.map((code) => [code, code === "outside_us" ? "Outside the U.S." : code]),
    sensitive: false,
  },
  {
    id: "residenceMonths",
    label: "Months you will have lived in that state when classes start",
    help: "A whole number of months.",
    type: "integer",
    minimum: 0,
    maximum: 1200,
    sensitive: false,
  },
  {
    id: "citizenship",
    label: "Citizenship or immigration status",
    help: "Used by aid programs with citizenship rules. Shared only if you turn it on.",
    type: "enum",
    options: [
      ["us_citizen_or_national", "U.S. citizen or U.S. national"],
      ["permanent_resident", "U.S. permanent resident (green card)"],
      ["other_eligible_noncitizen", "In the U.S. for other than a temporary purpose, intending to become a citizen or permanent resident"],
      ["freely_associated_states", "Citizen of Micronesia, the Marshall Islands or Palau"],
      ["daca_or_undocumented", "DACA recipient or undocumented"],
      ["student_visa", "In the U.S. on a student visa"],
      ["other_temporary", "Other temporary status"],
      ["not_sure", "Not sure"],
    ],
    sensitive: true,
  },
  {
    id: "highSchool",
    label: "High school completion",
    type: "enum",
    options: [
      ["diploma", "High school diploma"],
      ["state_equivalent", "GED or other state-recognized equivalent"],
      ["homeschool_completed", "Completed home school"],
      ["in_high_school", "Still in high school"],
      ["none", "None of these"],
    ],
    sensitive: false,
  },
  {
    id: "highestDegree",
    label: "Highest college degree you already have",
    type: "enum",
    options: [
      ["none", "No college degree yet"],
      ["associate", "Associate degree"],
      ["bachelor", "Bachelor's degree"],
      ["graduate_or_professional", "Graduate or first professional degree"],
    ],
    sensitive: false,
  },
  {
    id: "plannedProgram",
    label: "Program you plan to enroll in",
    type: "enum",
    options: [
      ["undergraduate", "Undergraduate degree or certificate"],
      ["teacher_postbacc", "Post-bachelor's teacher certification (no graduate degree)"],
      ["workforce_short_term", "Short-term workforce training program"],
      ["graduate", "Graduate or professional degree"],
      ["not_enrolling", "Not enrolling"],
    ],
    sensitive: false,
  },
  {
    id: "collegeState",
    label: "State of the college you plan to attend",
    type: "enum",
    options: STATES.map((code) => [code, code === "outside_us" ? "Outside the U.S." : code]),
    sensitive: false,
  },
  {
    id: "religiousDegree",
    label: "Is your degree in theology, divinity or religious education?",
    type: "enum",
    options: [["no", "No"], ["yes", "Yes"]],
    sensitive: false,
  },
  {
    id: "sai",
    label: "Student Aid Index (SAI) from your FAFSA or ORSAA",
    help: "From your FAFSA Submission Summary. Can be as low as -1500.",
    type: "integer",
    minimum: -1500,
    maximum: 999999,
    sensitive: true,
  },
  {
    id: "aidApplicationDate",
    label: "Date you first submitted this year's FAFSA or ORSAA",
    type: "date",
    sensitive: false,
  },
  {
    id: "pellLifetimeUsed",
    label: "Pell Grant Lifetime Eligibility Used (percent)",
    help: "0 if you never received a Pell Grant. Shown on your StudentAid.gov dashboard.",
    type: "integer",
    minimum: 0,
    maximum: 600,
    sensitive: false,
  },
  {
    id: "federalAidProblem",
    label: "In default on a federal student loan, or owe a refund on a federal grant?",
    type: "enum",
    options: [["no", "No"], ["yes", "Yes"], ["not_sure", "Not sure"]],
    sensitive: true,
  },
];

export const FIELD_BY_ID = Object.fromEntries(PASSPORT_FIELDS.map((field) => [field.id, field]));

/**
 * The JSON Schema of one field, in the subset the browser runtime validates.
 *
 * :param id: A passport field id.
 * :return: The schema.
 */
export function fieldSchema(id) {
  const field = FIELD_BY_ID[id];
  if (!field) {
    throw new Error(`Unknown passport field "${id}".`);
  }
  if (field.type === "enum") {
    return { type: "string", enum: field.options.map(([code]) => code), description: field.label };
  }
  if (field.type === "integer") {
    return { type: "integer", minimum: field.minimum, maximum: field.maximum, description: field.label };
  }
  return { type: "string", format: "date", description: `${field.label} (YYYY-MM-DD)` };
}

/**
 * The readable label of a field's value, such as "Bachelor's degree" for "bachelor".
 *
 * :param id: A passport field id.
 * :param value: The value.
 * :return: The label, or the value as text.
 */
export function valueLabel(id, value) {
  const field = FIELD_BY_ID[id];
  if (field && field.type === "enum") {
    const match = field.options.find(([code]) => code === value);
    if (match) {
      return match[1];
    }
  }
  return String(value);
}

/**
 * Check one value against its field, the way a publisher must before it uses it.
 *
 * :param id: A passport field id.
 * :param value: The value.
 * :return: null when the value is valid, else the reason.
 */
export function fieldError(id, value) {
  const field = FIELD_BY_ID[id];
  if (!field) {
    return `Unknown field "${id}".`;
  }
  if (field.type === "enum") {
    return field.options.some(([code]) => code === value) ? null : `${field.label}: not one of the listed choices.`;
  }
  if (field.type === "integer") {
    if (!Number.isInteger(value)) {
      return `${field.label}: must be a whole number.`;
    }
    return value < field.minimum || value > field.maximum ? `${field.label}: must be from ${field.minimum} to ${field.maximum}.` : null;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    return `${field.label}: must be a date as YYYY-MM-DD.`;
  }
  return null;
}
