import { readFile } from "node:fs/promises";
import type { Channel } from "./domain.js";

export interface ReportConfig {
  enabled: boolean;
  timezone: string;
  times: string[];
  notify: Record<Channel, boolean>;
}

export async function loadReportConfig(path: string): Promise<ReportConfig | undefined> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return validateReportConfig(JSON.parse(text));
}

export function validateReportConfig(value: unknown): ReportConfig {
  if (!record(value) || typeof value.enabled !== "boolean") throw new Error("Reports: enabled must be a boolean.");
  if (Object.keys(value).some((key) => !["enabled", "timezone", "times", "notify"].includes(key))) {
    throw new Error("Reports: unknown configuration field.");
  }
  if (typeof value.timezone !== "string" || !value.timezone) throw new Error("Reports: timezone is required.");
  try { new Intl.DateTimeFormat("en-GB", {timeZone: value.timezone}).format(); }
  catch { throw new Error("Reports: invalid IANA timezone."); }
  if (!Array.isArray(value.times) || value.times.length > 24 || (value.enabled && value.times.length === 0)
      || !value.times.every((time) => typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    throw new Error("Reports: times must contain up to 24 daily HH:mm times (at least one when enabled).");
  }
  if (new Set(value.times).size !== value.times.length) throw new Error("Reports: duplicate times are not allowed.");
  if (!record(value.notify) || typeof value.notify.telegram !== "boolean" || typeof value.notify.email !== "boolean"
      || Object.keys(value.notify).some((key) => !["telegram", "email"].includes(key))) {
    throw new Error("Reports: notify.telegram and notify.email must be booleans.");
  }
  if (value.enabled && !value.notify.telegram && !value.notify.email) throw new Error("Reports: enable at least one notification channel.");
  return {enabled: value.enabled, timezone: value.timezone, times: [...value.times].sort(),
    notify: {telegram: value.notify.telegram, email: value.notify.email}};
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
