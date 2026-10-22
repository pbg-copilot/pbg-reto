import nodemailer from "nodemailer";
import { sql, type Kysely } from "kysely";
import type { Env } from "../../config/env.js";
import type { DB, Job } from "../../db/types.js";
import type { JobHandler } from "../../jobs/runner.js";

export type MailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
  headers: Record<string, string>;
};

// Lo mínimo que el handler necesita del transporte: los tests inyectan uno simulado.
export type Mailer = { send: (message: MailMessage) => Promise<void> };

export function createSmtpMailer(env: Pick<Env, "SMTP_HOST" | "SMTP_PORT">): Mailer {
  // Mailpit no usa TLS ni autenticación. Timeouts cortos: un SMTP caído no bloquea al worker.
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false,
    ignoreTLS: true,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });
  return {
    async send(message) {
      await transport.sendMail(message);
    },
  };
}

// El error se guarda en la entrega y en los logs: sin direcciones de correo.
export const safeError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error))
    .replace(/[^\s<>@]+@[^\s<>@]+/g, "[correo]")
    .slice(0, 300);

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

// Criticidad en el correo (la misma escala de la app). Texto + color, nunca solo color. Los
// clientes de correo no leen hojas de estilo: todo va en línea y con tablas.
const PRIORITY_EMAIL: Record<string, { bg: string; fg: string; level: string }> = {
  low: { bg: "#eef2f4", fg: "#5b7480", level: "1 de 4" },
  medium: { bg: "#e6f4f7", fg: "#14768c", level: "2 de 4" },
  high: { bg: "#f7efd9", fg: "#7a5c17", level: "3 de 4" },
  urgent: { bg: "#fde8e8", fg: "#aa151b", level: "4 de 4" },
};

export type EmailNotification = { title: string; body: string; link: string; priority?: { code: string; name: string } | null };

export function renderEmail(notification: EmailNotification, appUrl: string) {
  const url = new URL(notification.link, appUrl).toString();
  const footer = "Este es un aviso automático del soporte de RETO. Para responder, entra al ticket.";
  const priority = notification.priority ? { ...notification.priority, ...(PRIORITY_EMAIL[notification.priority.code] ?? PRIORITY_EMAIL.medium!) } : null;
  const priorityText = priority ? `Prioridad: ${priority.name} (${priority.level})` : "";
  const text = [notification.title, priorityText, notification.body, `Ver el ticket: ${url}`, footer].filter(Boolean).join("\n\n");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(notification.title)}</title></head>
<body style="margin:0;padding:0;background:#f3f7f9;font-family:Arial,Helvetica,sans-serif;color:#0b2430">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f7f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e1eaee;border-radius:16px">
<tr><td style="padding:24px 28px 4px;font-size:14px;font-weight:bold;letter-spacing:4px">RETO<span style="color:#1fa3c4">.</span> <span style="font-size:11px;letter-spacing:2px;color:#5b7480;font-weight:normal">SOPORTE</span></td></tr>
<tr><td style="padding:12px 28px 0"><h1 style="margin:0;font-size:20px;line-height:1.35;color:#0b2430">${escapeHtml(notification.title)}</h1></td></tr>
${priority ? `<tr><td style="padding:12px 28px 0"><span style="display:inline-block;background:${priority.bg};color:${priority.fg};border:1px solid ${priority.fg}33;border-radius:999px;padding:4px 12px;font-size:13px;font-weight:bold">Prioridad: ${escapeHtml(priority.name)} · ${priority.level}</span></td></tr>` : ""}
${notification.body ? `<tr><td style="padding:12px 28px 0;font-size:15px;line-height:1.5;color:#0b2430">${escapeHtml(notification.body)}</td></tr>` : ""}
<tr><td style="padding:20px 28px 24px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#14768c;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:999px;font-weight:bold;font-size:14px">Ver el ticket</a></td></tr>
<tr><td style="padding:16px 28px 20px;border-top:1px solid #e1eaee;color:#5b7480;font-size:12px;line-height:1.5">${footer}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

type Options = {
  db: Kysely<DB>;
  env: Pick<Env, "MAIL_FROM" | "MAIL_ALLOWED_DOMAINS" | "PUBLIC_APP_URL">;
  mailer: Mailer;
};

// Handler del job deliver_email. Idempotente: una entrega ya entregada no se reenvía.
// Política at-least-once: si el proceso muere entre el envío y el UPDATE, el correo
// se repite con el mismo Message-ID (los clientes lo agrupan).
export function createDeliverEmailHandler({ db, env, mailer }: Options): JobHandler {
  const deliveryId = (job: Job) => String((job.payload as { delivery_id?: unknown }).delivery_id ?? "");

  return {
    async run(job) {
      const id = deliveryId(job);
      const row = await db
        .selectFrom("helpdesk.notification_deliveries as d")
        .innerJoin("helpdesk.notifications as n", "n.id", "d.notification_id")
        .innerJoin("reto.agents as a", "a.id", "n.recipient_id")
        .select(["d.id", "d.status", "d.channel", "n.id as notification_id", "n.title", "n.body", "n.link", "n.payload", "a.email"])
        .where("d.id", "=", id)
        .executeTakeFirst();
      // El ticket se borró (por ejemplo, limpieza de tests) o ya se entregó: nada que hacer.
      if (!row || row.channel !== "email" || row.status === "delivered") return;

      const domain = row.email.split("@").pop()?.toLowerCase() ?? "";
      if (!env.MAIL_ALLOWED_DOMAINS.includes(domain)) {
        // Error permanente: no se reintenta ni se intenta enviar.
        await db
          .updateTable("helpdesk.notification_deliveries")
          .set({ status: "failed", last_error: "recipient_domain_not_allowed", updated_at: sql`now()` })
          .where("id", "=", id)
          .execute();
        return;
      }

      // La prioridad viaja en el payload de la notificación (hoy, solo en las asignaciones).
      const payload = (row.payload ?? {}) as { priority?: string; priority_name?: string };
      const priority = payload.priority && payload.priority_name ? { code: payload.priority, name: payload.priority_name } : null;
      const { text, html } = renderEmail({ ...row, priority }, env.PUBLIC_APP_URL);
      try {
        await mailer.send({
          from: env.MAIL_FROM,
          to: row.email,
          subject: row.title,
          text,
          html,
          messageId: `<${row.id}@reto.local>`,
          headers: { "X-Reto-Notification": row.notification_id },
        });
      } catch (error) {
        await db
          .updateTable("helpdesk.notification_deliveries")
          .set({ attempts: sql`attempts + 1`, last_error: safeError(error), updated_at: sql`now()` })
          .where("id", "=", id)
          .execute();
        throw error;
      }
      await db
        .updateTable("helpdesk.notification_deliveries")
        .set({
          status: "delivered",
          attempts: sql`attempts + 1`,
          last_error: null,
          delivered_at: sql`now()`,
          updated_at: sql`now()`,
        })
        .where("id", "=", id)
        .execute();
    },

    // Se agotaron los reintentos: la entrega queda fallida y visible para el admin.
    async onFinalFailure(job, error) {
      await db
        .updateTable("helpdesk.notification_deliveries")
        .set({ status: "failed", last_error: safeError(error), updated_at: sql`now()` })
        .where("id", "=", deliveryId(job))
        .where("status", "=", "pending")
        .execute();
    },
  };
}
