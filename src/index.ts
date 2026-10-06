import { loadConfig } from "./config.js";
import { Notifier, settingsFromEnv } from "./notifier.js";
import { Store } from "./store.js";
import { TeslaInventoryClient } from "./tesla-client.js";
import { Worker } from "./worker.js";

const intervalSeconds = readInterval(process.env.POLL_INTERVAL_SECONDS);
const configPath = process.env.CONFIG_PATH ?? "/app/config/profiles.json";
const statePath = process.env.STATE_PATH ?? "/app/state/watcher.sqlite";
const notifyOnFirstSeen = process.env.NOTIFY_ON_FIRST_SEEN === "true";

const config = await loadConfig(configPath);
const notifier = new Notifier(settingsFromEnv(process.env));
notifier.validateFor(config.profiles);
const store = new Store(statePath);
const worker = new Worker(config, new TeslaInventoryClient(), store, notifier, notifyOnFirstSeen);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    console.info(`Received ${signal}; stopping after the current cycle.`);
  });
}

let consecutiveFailures = 0;
while (!stopping) {
  try {
    const result = await worker.runOnce();
    consecutiveFailures = 0;
    console.info(JSON.stringify({ event: "poll_complete", ...result }));
  } catch (error) {
    consecutiveFailures += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: "poll_failed", consecutiveFailures, message }));
    if (consecutiveFailures === 3 || consecutiveFailures % 10 === 0) {
      try {
        await notifier.sendTechnicalError(`${consecutiveFailures} aufeinanderfolgende Abrufe fehlgeschlagen. ${message}`);
      } catch (notificationError) {
        console.error(`Could not send technical alert: ${String(notificationError)}`);
      }
    }
  }
  if (!stopping) await wait((intervalSeconds + Math.floor(Math.random() * 11)) * 1_000);
}

store.close();

function readInterval(value: string | undefined): number {
  const interval = Number(value ?? "60");
  if (!Number.isInteger(interval) || interval < 30) throw new Error("POLL_INTERVAL_SECONDS must be an integer of at least 30 seconds.");
  return interval;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
