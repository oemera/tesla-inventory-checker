import nodemailer from "nodemailer";
import type { Channel, Match, Profile } from "./domain.js";
import { formatStockReport, type StockReport } from "./stock-report.js";
import type { ReportConfig } from "./report-config.js";

export interface AlertSender {
  sendMatch(match: Match): Promise<void>;
  sendChannel(match: Match, channel: Channel): Promise<void>;
  sendTechnicalError(message: string): Promise<void>;
}

export interface NotificationSettings {
  telegramBotToken?: string;
  telegramChatId?: string;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    from: string;
    to: string;
  };
}

export class Notifier implements AlertSender {
  constructor(private readonly settings: NotificationSettings) {}

  async sendStockReport(report: StockReport, channel: Channel): Promise<void> {
    const body = formatStockReport(report);
    if (channel === "telegram") await this.sendTelegram(body);
    else await this.sendEmail("Tesla-Bestandsbericht: Model 3 und Model Y", body);
  }

  validateReports(config: ReportConfig | undefined): void {
    if (!config?.enabled) return;
    if (config.notify.telegram && !this.hasTelegram()) throw new Error("Stock reports use Telegram, but its configuration is incomplete.");
    if (config.notify.email && !this.settings.smtp) throw new Error("Stock reports use email, but SMTP configuration is incomplete.");
  }

  async sendChannel(match: Match, channel: Channel): Promise<void> {
    const body = formatMatch(match);
    if (channel === "telegram") await this.sendTelegram(body);
    else await this.sendEmail(`Tesla-Treffer: ${match.profile.id}`, body);
  }

  async sendMatch(match: Match): Promise<void> {
    const body = formatMatch(match);
    const deliveries: Promise<void>[] = [];
    if (match.profile.notify.telegram) deliveries.push(this.sendTelegram(body));
    if (match.profile.notify.email) deliveries.push(this.sendEmail(`Tesla-Treffer: ${match.profile.id}`, body));
    await Promise.all(deliveries);
  }

  async sendTechnicalError(message: string): Promise<void> {
    const body = `Tesla Inventory Checker: ${message}`;
    const deliveries: Promise<void>[] = [];
    if (this.hasTelegram()) deliveries.push(this.sendTelegram(body));
    if (this.settings.smtp) deliveries.push(this.sendEmail("Tesla Inventory Checker: Fehler", body));
    await Promise.all(deliveries);
  }

  validateFor(profiles: Profile[]): void {
    const enabled = profiles.filter((profile) => profile.enabled);
    if (enabled.some((profile) => profile.notify.telegram) && !this.hasTelegram()) {
      throw new Error("At least one profile uses Telegram, but TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing.");
    }
    if (enabled.some((profile) => profile.notify.email) && !this.settings.smtp) {
      throw new Error("At least one profile uses email, but SMTP configuration is incomplete.");
    }
  }

  private hasTelegram(): boolean {
    return Boolean(this.settings.telegramBotToken && this.settings.telegramChatId);
  }

  private async sendTelegram(body: string): Promise<void> {
    if (!this.settings.telegramBotToken || !this.settings.telegramChatId) throw new Error("Telegram is not configured.");
    const response = await fetch(`https://api.telegram.org/bot${this.settings.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.settings.telegramChatId, text: body, disable_web_page_preview: false }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`Telegram notification failed: HTTP ${response.status}`);
    const result = await response.json() as {ok?: boolean};
    if (result.ok !== true) throw new Error("Telegram rejected the message.");
  }

  private async sendEmail(subject: string, text: string): Promise<void> {
    const smtp = this.settings.smtp;
    if (!smtp) throw new Error("Email is not configured.");
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
      auth: smtp.user && smtp.password ? { user: smtp.user, pass: smtp.password } : undefined
    });
    await transporter.sendMail({ from: smtp.from, to: smtp.to, subject, text });
  }
}

export function settingsFromEnv(env: NodeJS.ProcessEnv): NotificationSettings {
  const smtpConfigured = [env.SMTP_HOST, env.SMTP_PORT, env.EMAIL_FROM, env.EMAIL_TO].every(Boolean);
  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramChatId: env.TELEGRAM_CHAT_ID,
    smtp: smtpConfigured ? {
      host: env.SMTP_HOST!,
      port: Number(env.SMTP_PORT),
      secure: env.SMTP_SECURE === "true",
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      from: env.EMAIL_FROM!,
      to: env.EMAIL_TO!
    } : undefined
  };
}

function formatMatch(match: Match): string {
  const vehicle = match.vehicle;
  const details = [
    `${vehicle.id === "TEST-NOTIFICATION-ONLY" ? "🧪 TEST – kein echtes Fahrzeug" : "🚗 Neuer Treffer"}: ${match.profile.id}`,
    vehicle.trim && `Variante: ${vehicle.trim}`,
    vehicle.exteriorColor && `Lack: ${vehicle.exteriorColor}`,
    vehicle.interiorColor && `Innenraum: ${vehicle.interiorColor}`,
    vehicle.priceEur !== undefined && `Preis: ${formatEur(vehicle.priceEur)}`,
    vehicle.location && `Standort: ${vehicle.location}`,
    vehicle.vin && `VIN: ${vehicle.vin}`,
    "",
    vehicle.orderUrl.includes("/inventory/") ? "Tesla-Inventarseite (kein Fahrzeug-Direktlink):" : "Fahrzeug bei Tesla ansehen:",
    vehicle.orderUrl
  ];
  return details.filter((value): value is string => Boolean(value)).join("\n");
}

function formatEur(amount: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(amount);
}
