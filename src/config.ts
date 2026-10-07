import { readFile } from "node:fs/promises";
import type { AppConfig, Profile } from "./domain.js";

const allowedModels = new Set(["m3", "my"]);
const allowedConditions = new Set(["new", "used"]);

export async function loadConfig(path: string): Promise<AppConfig> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isObject(parsed) || !Array.isArray(parsed.profiles)) {
    throw new Error("Configuration must contain a profiles array.");
  }

  const profiles = parsed.profiles.map(validateProfile);
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id)) throw new Error(`Duplicate profile id: ${profile.id}`);
    ids.add(profile.id);
  }
  return { profiles };
}

function validateProfile(value: unknown): Profile {
  if (!isObject(value)) throw new Error("Each profile must be an object.");
  const id = requireString(value, "id");
  const market = requireString(value, "market").toLowerCase();
  if (market !== "de") throw new Error(`${id}: only the German market (de) is supported.`);
  const model = requireString(value, "model").toLowerCase();
  const condition = requireString(value, "condition").toLowerCase();
  if (!allowedModels.has(model)) throw new Error(`${id}: model must be m3 or my.`);
  if (!allowedConditions.has(condition)) throw new Error(`${id}: condition must be new or used.`);
  if (!isObject(value.notify) || typeof value.notify.telegram !== "boolean" || typeof value.notify.email !== "boolean") {
    throw new Error(`${id}: notify.telegram and notify.email must be booleans.`);
  }
  if (!value.notify.telegram && !value.notify.email) throw new Error(`${id}: at least one notification channel must be enabled.`);

  const maxPriceEur = optionalNumber(value, "maxPriceEur");
  if (maxPriceEur !== undefined && maxPriceEur <= 0) throw new Error(`${id}: maxPriceEur must be positive.`);

  return {
    id,
    enabled: value.enabled !== false,
    market,
    model: model as Profile["model"],
    condition: condition as Profile["condition"],
    trim: optionalStringArray(value, "trim"),
    exteriorColors: optionalStringArray(value, "exteriorColors"),
    interiorColors: optionalStringArray(value, "interiorColors"),
    maxPriceEur,
    notify: { telegram: value.notify.telegram, email: value.notify.email }
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== "string" || value[key].trim() === "") throw new Error(`${key} must be a non-empty string.`);
  return value[key].trim();
}

function optionalStringArray(value: Record<string, unknown>, key: string): string[] | undefined {
  if (value[key] === undefined) return undefined;
  if (!Array.isArray(value[key]) || !value[key].every((entry) => typeof entry === "string" && entry.trim())) {
    throw new Error(`${key} must be an array of non-empty strings.`);
  }
  return (value[key] as string[]).map((entry) => entry.trim());
}

function optionalNumber(value: Record<string, unknown>, key: string): number | undefined {
  if (value[key] === undefined) return undefined;
  if (typeof value[key] !== "number" || !Number.isFinite(value[key])) throw new Error(`${key} must be a finite number.`);
  return value[key];
}
