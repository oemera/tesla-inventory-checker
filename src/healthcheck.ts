import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const statePath = process.env.STATE_PATH ?? "/app/state/watcher.sqlite";
const maxAgeSeconds = Number(process.env.HEALTH_MAX_AGE_SECONDS ?? "180");
if (!existsSync(statePath)) process.exit(1);

const db = new DatabaseSync(statePath, {readOnly: true});
const lastSuccess = (db.prepare("SELECT value FROM metadata WHERE key='heartbeat'").get() as {value: string} | undefined)?.value;
db.close();
if (!lastSuccess || Number.isNaN(maxAgeSeconds) || Date.now() - Date.parse(lastSuccess) > maxAgeSeconds * 1_000) process.exit(1);
