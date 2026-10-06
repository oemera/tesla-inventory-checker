import { loadConfig } from "./config.js";
import { Notifier, settingsFromEnv } from "./notifier.js";
import type { Match } from "./domain.js";

const configPath = process.env.CONFIG_PATH ?? "/app/config/profiles.json";
const config = await loadConfig(configPath);
const profile = config.profiles.find((entry) => entry.enabled);
if (!profile) throw new Error("No enabled profile is configured.");

const notifier = new Notifier(settingsFromEnv(process.env));
notifier.validateFor([profile]);
const match: Match = {
  profile,
  vehicle: {
    id: "TEST-NOTIFICATION-ONLY",
    model: profile.model,
    trim: profile.trim?.[0] ?? "Testfahrzeug",
    exteriorColor: profile.exteriorColors?.[0],
    interiorColor: profile.interiorColors?.[0],
    priceEur: profile.maxPriceEur,
    location: "Lokaler Test",
    orderUrl: `https://www.tesla.com/de_DE/inventory/new/${profile.model}`,
    raw: { test: true }
  }
};

await notifier.sendMatch(match);
console.info(`Test notification sent for profile ${profile.id}.`);
