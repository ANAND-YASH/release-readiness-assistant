import { ApiError } from "@/lib/errors";
import { MockProvider } from "./mock-provider";
import { OpenAIProvider } from "./openai-provider";
import type { AIProvider } from "./provider";

/**
 * Selects the provider from AI_PROVIDER. Defaults to "mock" so the app works
 * without an API key. "openai" requires OPENAI_API_KEY (OPENAI_MODEL optional).
 */
export function getAIProvider(env: NodeJS.ProcessEnv = process.env): AIProvider {
  const name = (env.AI_PROVIDER || "mock").toLowerCase();
  if (name === "mock") return new MockProvider();
  if (name === "openai") {
    if (!env.OPENAI_API_KEY) {
      throw new ApiError(503, "SERVICE_UNAVAILABLE", "AI_PROVIDER is openai but OPENAI_API_KEY is not configured.");
    }
    return new OpenAIProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL);
  }
  throw new ApiError(503, "SERVICE_UNAVAILABLE", `Unknown AI_PROVIDER "${name}". Use "mock" or "openai".`);
}
