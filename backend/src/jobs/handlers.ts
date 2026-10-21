import type { Kysely } from "kysely";
import type { Env } from "../config/env.js";
import type { DB } from "../db/types.js";
import { createDeliverEmailHandler, createSmtpMailer, type Mailer } from "../modules/notifications/email.js";
import { DELIVER_EMAIL_JOB } from "../modules/notifications/listener.js";
import type { Handlers } from "./runner.js";

// Registro tipo → handler. Cada spec agrega los suyos.
export function createJobHandlers({ db, env, mailer }: { db: Kysely<DB>; env: Env; mailer?: Mailer }): Handlers {
  return {
    noop: { run: async () => {} },
    [DELIVER_EMAIL_JOB]: createDeliverEmailHandler({ db, env, mailer: mailer ?? createSmtpMailer(env) }),
  };
}
