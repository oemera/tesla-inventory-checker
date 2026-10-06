import { existsSync } from "node:fs";
import { Store } from "./store.js";

const statePath = process.env.STATE_PATH ?? "/app/state/watcher.sqlite";
const maxAgeSeconds = Number(process.env.HEALTH_MAX_AGE_SECONDS ?? "180");
if (!existsSync(statePath)) process.exit(1);

const store = new Store(statePath);
const lastSuccess = store.lastSuccessfulPoll();
store.close();
if (!lastSuccess || Number.isNaN(maxAgeSeconds) || Date.now() - Date.parse(lastSuccess) > maxAgeSeconds * 1_000) process.exit(1);
