import assert from "node:assert/strict";
import test from "node:test";
import { Notifier } from "../src/notifier.js";
import type { Match } from "../src/domain.js";
import nodemailer from "nodemailer";
import { dueReportSlot, type StockReport } from "../src/stock-report.js";

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

test("stock reports use the selected channel and render counts in Telegram and email", async (t) => {
  const config = {enabled:true,timezone:"Europe/Berlin",times:["08:00"],notify:{telegram:true,email:true}};
  const now = Date.parse("2026-10-07T06:00:00Z");
  const report: StockReport = {slot:dueReportSlot(config,now)!,createdAt:new Date(now).toISOString(),
    inventory:{m3:{count:12,asOf:new Date(now).toISOString()},my:{count:0,asOf:new Date(now).toISOString()}}};
  const telegram: string[] = [];
  const emails: Array<{subject:string;text:string}> = [];
  t.mock.method(globalThis,"fetch",async (_: unknown, options: RequestInit) => {
    telegram.push(JSON.parse(String(options.body)).text);
    return new Response(JSON.stringify({ok:true}),{status:200});
  });
  t.mock.method(nodemailer,"createTransport",() => ({async sendMail(mail: {subject:string;text:string}) {emails.push(mail);}}));
  const notifier = new Notifier({telegramBotToken:"FAKE",telegramChatId:"FAKE",
    smtp:{host:"invalid.example",port:587,secure:false,from:"from@example.invalid",to:"to@example.invalid"}});
  await notifier.sendStockReport(report,"telegram");
  assert.equal(telegram.length,1); assert.equal(emails.length,0);
  await notifier.sendStockReport(report,"email");
  assert.equal(telegram.length,1); assert.equal(emails.length,1);
  assert.match(emails[0].subject,/Tesla-Bestandsbericht/);
  assert.equal(emails[0].text,telegram[0]);
  assert.match(telegram[0],/Model 3: 12 Fahrzeuge/); assert.match(telegram[0],/Model Y: 0 Fahrzeuge/);
  assert.match(telegram[0],/Gesamt: 12 Fahrzeuge/);
});
