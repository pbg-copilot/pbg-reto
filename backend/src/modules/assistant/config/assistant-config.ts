export type AssistantConfig = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  externalDataAuthorized: boolean;
};

export function loadAssistantConfig(env: NodeJS.ProcessEnv = process.env): AssistantConfig {
  return {
    provider: env.LLM_PROVIDER || "openai-compatible",
    baseUrl: env.LLM_BASE_URL || "",
    model: env.LLM_MODEL || "",
    apiKey: env.LLM_API_KEY || "",
    externalDataAuthorized: env.LLM_EXTERNAL_DATA_AUTHORIZED === "true",
  };
}

export function isAssistantEnabled(config: AssistantConfig): boolean {
  if (
    config.provider !== "openai-compatible" ||
    !config.externalDataAuthorized ||
    !config.apiKey ||
    !config.model ||
    !config.baseUrl
  ) return false;

  try {
    const url = new URL(config.baseUrl);
    return (url.protocol === "https:" || ["localhost", "127.0.0.1"].includes(url.hostname)) &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}
