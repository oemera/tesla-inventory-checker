import assert from "node:assert/strict";
import test from "node:test";
import { Notifier } from "../src/notifier.js";
import type { Match } from "../src/domain.js";

const match: Match = {
  profile: {id:"test", enabled:true, market:"de", model:"m3", condition:"new", notify:{telegram:true, email:false}},
  vehicle:{id:"TEST-NOTIFICATION-ONLY", model:"m3", orderUrl:"https://www.tesla.com/de_DE/inventory/new/m3", raw:{}}
};
test("Telegram success requires ok=true; test messages and fallback URLs are clearly labelled", async () => {
  const previous = globalThis.fetch;
  const bodies: string[] = [];
  let ok = true;
  globalThis.fetch = async (_, options) => {
    bodies.push(String(options?.body));
    return new Response(JSON.stringify({ok}), {status:200});
  };
  try {
    const notifier = new Notifier({telegramBotToken:"FAKE-NOT-A-TOKEN", telegramChatId:"FAKE"});
    await notifier.sendChannel(match, "telegram");
    assert.match(bodies[0], /kein echtes Fahrzeug/); assert.match(bodies[0], /kein Fahrzeug-Direktlink/);
    ok = false; await assert.rejects(() => notifier.sendChannel(match, "telegram"), /rejected/);
  } finally { globalThis.fetch = previous; }
});
