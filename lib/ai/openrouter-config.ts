/**
 * Parsed OpenRouter configuration required by metadata generation routes.
 * @property apiKey - Trimmed API key from OPENROUTER_API_KEY.
 * @property model - Primary model from OPENROUTER_MODEL.
 * @property fallbackModels - Optional fallback models parsed from OPENROUTER_MODEL.
 */
export interface OpenRouterModelConfig {
  apiKey: string;
  model: string;
  fallbackModels: string[];
}

/**
 * Parses and validates OpenRouter env configuration for metadata generation.
 * @returns Parsed config when both API key and model list are configured; otherwise null.
 */
export function getOpenRouterModelConfig(): OpenRouterModelConfig | null {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim() ?? '';
  const modelList = (process.env.OPENROUTER_MODEL ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  if (!apiKey || modelList.length === 0) {
    return null;
  }

  const [model, ...fallbackModels] = modelList;
  return { apiKey, model, fallbackModels };
}
