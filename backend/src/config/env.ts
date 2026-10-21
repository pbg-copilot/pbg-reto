import { z } from "zod";

const csvUrls = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url()).min(1));

const flag = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(8000),
    HOST: z.string().default("0.0.0.0"),
    DATABASE_URL: z.string().min(1),
    DATA_DIR: z.string().default("/app/data"),
    APP_ORIGIN: csvUrls.default(["http://localhost:8088"]),
    PUBLIC_APP_URL: z.url().default("http://localhost:8088"),
    SESSION_TTL_HOURS: z.coerce.number().positive().max(24).default(8),
    DEMO_PASSWORD: z.string().min(1).default("123456"),
    AI_PROVIDER: z.enum(["anthropic", "fake"]).optional(),
    AI_MODEL: z.string().min(1).default("claude-haiku-5-5"),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
    AI_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(8).default(4),
    AI_FAKE_FAILURE: flag.default(false),
    S3_ENDPOINT: z.url().default("http://s3:9000"),
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: z.string().min(3).default("reto-attachments"),
    S3_ACCESS_KEY: z.string().min(1).default("reto"),
    S3_SECRET_KEY: z.string().min(8).default("reto_local_only"),
    S3_FORCE_PATH_STYLE: flag.default(true),
    SMTP_HOST: z.string().default("mailpit"),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    MAIL_FROM: z.string().default("Soporte RETO <soporte@reto.local>"),
    EMAIL_NOTIFICATIONS: flag.default(true),
    UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
    UPLOAD_MAX_FILES: z.coerce.number().int().min(1).max(10).default(5),
    WORKER_POLL_MS: z.coerce.number().int().min(100).default(1000),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  })
  .transform((env) => ({
    ...env,
    // Sin key, el asistente usa el proveedor simulado: la app arranca igual.
    AI_PROVIDER: env.AI_PROVIDER ?? (env.ANTHROPIC_API_KEY ? "anthropic" : "fake"),
  }))
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY)
      ctx.addIssue({
        code: "custom",
        path: ["ANTHROPIC_API_KEY"],
        message: "is required when AI_PROVIDER=anthropic",
      });
  });

export type Env = z.output<typeof envSchema>;

// Nunca incluye valores en el mensaje: solo nombres de variables y el problema.
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const input = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ""),
  );
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
