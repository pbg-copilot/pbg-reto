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

export function renderEmail(notification: { title: string; body: string; link: string }, appUrl: string) {
  const url = new URL(notification.link, appUrl).toString();
  const footer = "Este es un aviso automático del soporte de RETO. Para responder, entra al ticket.";
  const text = [notification.title, notification.body, `Ver el ticket: ${url}`, footer].filter(Boolean).join("\n\n");
  const html = `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;color:#111">
<h1 style="font-size:18px">${escapeHtml(notification.title)}</h1>
${notification.body ? `<p>${escapeHtml(notification.body)}</p>` : ""}
<p><a href="${escapeHtml(url)}">Ver el ticket</a></p>
<p style="color:#666;font-size:12px">${footer}</p>
</body></html>`;
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
        .select(["d.id", "d.status", "d.channel", "n.id as notification_id", "n.title", "n.body", "n.link", "a.email"])
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

      const { text, html } = renderEmail(row, env.PUBLIC_APP_URL);
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
