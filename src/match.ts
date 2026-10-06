import type { Match, Profile, Vehicle } from "./domain.js";

export function matchVehicle(profile: Profile, vehicle: Vehicle): Match | undefined {
  if (!profile.enabled || profile.model !== vehicle.model) return undefined;
  if (!matchesAny(vehicle.trim, profile.trim)) return undefined;
  if (!matchesAny(vehicle.exteriorColor, profile.exteriorColors)) return undefined;
  if (!matchesAny(vehicle.interiorColor, profile.interiorColors)) return undefined;
  if (profile.maxPriceEur !== undefined && (vehicle.priceEur === undefined || vehicle.priceEur > profile.maxPriceEur)) return undefined;
  return { profile, vehicle };
}

function matchesAny(actual: string | undefined, expected: string[] | undefined): boolean {
  if (!expected || expected.length === 0) return true;
  if (!actual) return false;
  const normalizedActual = normalize(actual);
  return expected.some((item) => {
    const normalizedExpected = normalize(item);
    return normalizedActual.includes(normalizedExpected) || normalizedExpected.includes(normalizedActual);
  });
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("de-DE").replace(/[^a-z0-9]+/g, " ").trim();
}
