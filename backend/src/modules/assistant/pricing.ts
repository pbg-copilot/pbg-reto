// Precios en US$ por millón de tokens (docs/costos-ia.md, consultados el 2026-10-20).
// claude-haiku-5-5: tarifa para prompts de hasta 100K tokens (nuestras llamadas son menores).
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export function costUsd(model: string, usage: Usage) {
  const price = PRICES[model];
  if (!price) return 0;
  const perToken = (value: number | undefined, rate: number) => ((value ?? 0) * rate) / 1_000_000;
  return (
    perToken(usage.input_tokens, price.input) +
    perToken(usage.output_tokens, price.output) +
    perToken(usage.cache_read_input_tokens, price.cacheRead) +
    perToken(usage.cache_creation_input_tokens, price.cacheWrite)
  );
}
