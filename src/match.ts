import type { Match, Profile, Vehicle } from "./domain.js";

export function matchVehicle(profile: Profile, vehicle: Vehicle): Match | undefined {
  if (!profile.enabled || profile.model !== vehicle.model) return undefined;
  if (vehicle.condition && profile.condition !== vehicle.condition) return undefined;
  if (!matchesAny([vehicle.trim, vehicle.trimCode], profile.trim)) return undefined;
  if (!matchesAny([vehicle.exteriorColor, vehicle.exteriorCode], profile.exteriorColors)) return undefined;
  if (!matchesAny([vehicle.interiorColor, vehicle.interiorCode], profile.interiorColors)) return undefined;
  if (profile.maxPriceEur !== undefined && (vehicle.priceEur === undefined || vehicle.priceEur > profile.maxPriceEur)) return undefined;
  return { profile, vehicle };
}

function matchesAny(actual: Array<string | undefined>, expected: string[] | undefined): boolean {
  if (!expected || expected.length === 0) return true;
  return actual.some((value) => value !== undefined && expected.some((item) => normalize(value) === normalize(item)));
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("de-DE").replace(/[^a-z0-9]+/g, " ").trim();
}
