import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * The AI provider seam (roadmap #15).
 *
 * Two providers:
 *  - "anthropic" (default) — the Anthropic API via the official SDK (in ai.ts).
 *  - "openai-compatible"   — any server speaking the OpenAI /v1/chat/completions
 *    dialect: vLLM, Ollama, LM Studio, llama.cpp, LiteLLM, TGI… Configured with
 *    AI_BASE_URL (e.g. http://localhost:11434/v1) and an optional AI_API_KEY.
 *
 * This module is deliberately free of DB imports so the transport and the
 * parse/validate helpers can be unit-tested without a database.
 *
 * Validation authority: regardless of what either provider claims about
 * "structured outputs", the zod contracts in aiSchemas.ts are ALWAYS applied
 * locally (parseStructured below). A provider's schema enforcement is treated
 * as a hint that improves output quality, never as a guarantee.
 */

export type AiProvider = "anthropic" | "openai-compatible";

export function getProvider(): AiProvider {
  const raw = (process.env.AI_PROVIDER || "anthropic").trim().toLowerCase();
  if (raw === "openai-compatible" || raw === "openai_compatible" || raw === "openai") {
    return "openai-compatible";
  }
  return "anthropic";
}

/**
 * True when the active provider transmits document text OFF the deployment.
 * The Anthropic provider is external; the openai-compatible provider points at an
 * operator-run endpoint (local vLLM/Ollama/…) and is treated as in-boundary.
 */
export function providerIsExternal(): boolean {
  return getProvider() === "anthropic";
}

/**
 * True when the operator has explicitly acknowledged (P0.4) that an external
 * provider may be used — i.e. that extracted board-document text, including
 * passages the classifier flags as privileged, will leave the deployment.
 */
export function externalProviderAllowed(): boolean {
  return process.env.AI_ALLOW_EXTERNAL_PROVIDER === "true";
}

/** True when the active provider has enough configuration to make calls. */
export function aiConfigured(): boolean {
  if (getProvider() === "openai-compatible") {
    return !!process.env.AI_BASE_URL;
  }
  // Anthropic is EXTERNAL: document text leaves the deployment. A key alone is
  // not enough — the operator must also set AI_ALLOW_EXTERNAL_PROVIDER=true, so
  // the default (key present, no acknowledgement) sends nothing off-box.
  const hasKey = !!(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
  return hasKey && externalProviderAllowed();
}

/**
 * True when an Anthropic key is present but the external-provider acknowledgement
 * is missing — AI is effectively DISABLED and no text leaves. Used to warn the
 * operator at boot that their key is doing nothing until they opt in.
 */
export function externalProviderKeyPresentButNotAllowed(): boolean {
  if (getProvider() !== "anthropic") return false;
  const hasKey = !!(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
  return hasKey && !externalProviderAllowed();
}

/**
 * Convert a zod contract to a plain JSON schema, used both for Anthropic's
 * `output_config.format` and the OpenAI-compatible `response_format`.
 * (The SDK's zodOutputFormat() requires zod v4 internals and throws on this
 * repo's zod v3 schemas, so we build the schema ourselves.)
 */
export function buildJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/**
 * Parse model output into a schema-validated object. Tolerates a ```json fence
 * around the payload (common when a server ignored response_format). This is
 * the single validation gate for structured AI output on every provider.
 */
export function parseStructured<T extends z.ZodTypeAny>(
  text: string,
  schema: T
): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  const fenced = text.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  const raw = (fenced ? fenced[1] : text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `not valid JSON: ${(err as Error).message}` };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `schema validation failed: ${issues}` };
  }
  return { ok: true, data: result.data };
}

/**
 * Conservative token estimate for endpoints that return no usage block.
 * English averages ~4 chars/token; dividing by 3 deliberately OVER-estimates so
 * the daily token budget errs on the side of refusing, never overspending.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** Error carrying the upstream HTTP status so callAI can map 401/429 like the SDK does. */
export class OpenAiCompatError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface OpenAiChatRequest {
  baseUrl: string;
  apiKey?: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  /** When set, sent as response_format json_schema (dropped + retried on a 400). */
  jsonSchema?: Record<string, unknown>;
  schemaName?: string;
  timeoutMs?: number;
}

export interface OpenAiChatResult {
  text: string;
  /** null when the endpoint returned no usable usage block — caller estimates. */
  usage: { inputTokens: number; outputTokens: number } | null;
  /** false when the server rejected response_format and the retry succeeded without it. */
  usedResponseFormat: boolean;
}

function mapUsage(u: unknown): OpenAiChatResult["usage"] {
  if (!u || typeof u !== "object") return null;
  const usage = u as Record<string, unknown>;
  // OpenAI dialect: prompt_tokens/completion_tokens. Some servers use the
  // newer input_tokens/output_tokens names — accept both.
  const input = usage.prompt_tokens ?? usage.input_tokens;
  const output = usage.completion_tokens ?? usage.output_tokens;
  if (typeof input !== "number" || typeof output !== "number") return null;
  return { inputTokens: input, outputTokens: output };
}

/**
 * One /v1/chat/completions call against an OpenAI-compatible server.
 * No Anthropic-specific features here: no cache_control breakpoints (prompt
 * caching degrades gracefully to "none"), no thinking config.
 */
export async function openAiChatCompletion(req: OpenAiChatRequest): Promise<OpenAiChatResult> {
  const url = `${req.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (req.apiKey) headers.authorization = `Bearer ${req.apiKey}`;

  const baseBody = {
    model: req.model,
    max_tokens: req.maxTokens,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
  };

  const attempt = async (withFormat: boolean): Promise<Response> =>
    fetch(url, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(req.timeoutMs ?? Number(process.env.AI_TIMEOUT_MS || 120_000)),
      body: JSON.stringify(
        withFormat && req.jsonSchema
          ? {
              ...baseBody,
              response_format: {
                type: "json_schema",
                json_schema: { name: req.schemaName || "response", schema: req.jsonSchema },
              },
            }
          : baseBody
      ),
    });

  let usedResponseFormat = !!req.jsonSchema;
  let res = await attempt(usedResponseFormat);

  // Servers that don't implement json_schema response_format reply 400 —
  // degrade to a plain completion (the prompt already demands JSON, and
  // parseStructured validates regardless).
  if (!res.ok && usedResponseFormat && res.status === 400) {
    usedResponseFormat = false;
    res = await attempt(false);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OpenAiCompatError(res.status, `openai-compatible endpoint returned ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json().catch(() => {
    throw new OpenAiCompatError(502, "openai-compatible endpoint returned a non-JSON body");
  })) as Record<string, unknown>;

  const choices = data.choices as Array<{ message?: { content?: unknown } }> | undefined;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new OpenAiCompatError(502, "openai-compatible endpoint returned no message content");
  }

  return { text: content, usage: mapUsage(data.usage), usedResponseFormat };
}
