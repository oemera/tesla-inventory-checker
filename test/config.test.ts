import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("loads a valid profile configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tesla-config-"));
  const path = join(directory, "profiles.json");
  await writeFile(path, JSON.stringify({ profiles: [{ id: "m3", market: "DE", model: "m3", condition: "new", notify: { telegram: true, email: false } }] }));
  const config = await loadConfig(path);
  assert.equal(config.profiles[0].market, "de");
});

test("rejects duplicate profile ids", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tesla-config-"));
  const path = join(directory, "profiles.json");
  const profile = { id: "duplicate", market: "de", model: "m3", condition: "new", notify: { telegram: true, email: false } };
  await writeFile(path, JSON.stringify({ profiles: [profile, profile] }));
  await assert.rejects(() => loadConfig(path), /Duplicate profile id/);
});
