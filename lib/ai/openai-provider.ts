// OpenAI provider using Chat Completions with strict Structured Outputs.
// Server-only: the API key is read from the environment and never leaves the server.

import type OpenAI from "openai";
import { AiProviderError, type AIProvider, type AiRequest, type AiResponse } from "./provider";

export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly model: string;
  private client: OpenAI | undefined;

  constructor(
    private readonly apiKey: string,
    model?: string,
  ) {
    this.model = model || DEFAULT_OPENAI_MODEL;
  }

  private async getClient(): Promise<OpenAI> {
    if (!this.client) {
      // Imported lazily so the mock provider path never loads the SDK.
      const { default: OpenAIClient } = await import("openai");
      this.client = new OpenAIClient({ apiKey: this.apiKey, timeout: 90_000, maxRetries: 1 });
    }
    return this.client;
  }

  async generate(request: AiRequest): Promise<AiResponse> {
    const client = await this.getClient();
    const { zodResponseFormat } = await import("openai/helpers/zod");

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ];
    if (request.retry) {
      messages.push(
        { role: "assistant", content: request.retry.previousOutput },
        {
          role: "user",
          content: `Your previous response was rejected: ${request.retry.error}\nReturn a corrected response that matches the schema exactly.`,
        },
      );
    }

    let completion: OpenAI.Chat.ChatCompletion;
    try {
      completion = await client.chat.completions.create({
        model: this.model,
        messages,
        response_format: zodResponseFormat(request.schema, request.schemaName),
      });
    } catch (err) {
      // SDK errors carry status and type, never the API key.
      const status = (err as { status?: number }).status;
      throw new AiProviderError(`OpenAI request failed${status ? ` (HTTP ${status})` : ""}`, { cause: err });
    }

    const message = completion.choices[0]?.message;
    if (message?.refusal) throw new AiProviderError(`Model refused: ${message.refusal}`);
    return {
      rawText: message?.content ?? "",
      model: completion.model,
      usage: completion.usage
        ? { promptTokens: completion.usage.prompt_tokens, completionTokens: completion.usage.completion_tokens }
        : undefined,
    };
  }
}
