import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { z } from "zod";
import {
  getProvider,
  aiConfigured,
  externalProviderKeyPresentButNotAllowed,
  buildJsonSchema,
  parseStructured,
  estimateTokens,
  openAiChatCompletion,
  OpenAiCompatError,
} from "./aiProvider";

// ---------------------------------------------------------------------------
// Fake OpenAI-compatible server
// ---------------------------------------------------------------------------

type Handler = (body: Record<string, unknown>, res: http.ServerResponse) => void;

let server: http.Server | null = null;

async function startFakeServer(handler: Handler): Promise<{ baseUrl: string; requests: Array<Record<string, unknown>> }> {
  const requests: Array<Record<string, unknown>> = [];
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      requests.push({ ...body, __url: req.url, __auth: req.headers.authorization });
      handler(body, res);
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests };
}

function jsonReply(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function clearAiEnv(): void {
  delete process.env.AI_PROVIDER;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  delete process.env.AI_ALLOW_EXTERNAL_PROVIDER;
}

beforeEach(clearAiEnv);

afterEach(() => {
  server?.close();
  server = null;
  clearAiEnv();
});

const testSchema = z.object({ verdict: z.enum(["approved", "rejected"]), reasoning: z.string() });

// ---------------------------------------------------------------------------

describe("getProvider / aiConfigured", () => {
  it("defaults to anthropic", () => {
    expect(getProvider()).toBe("anthropic");
  });

  it("recognizes openai-compatible (and tolerant spellings)", () => {
    for (const v of ["openai-compatible", "OPENAI_COMPATIBLE", "openai"]) {
      process.env.AI_PROVIDER = v;
      expect(getProvider()).toBe("openai-compatible");
    }
  });

  it("openai-compatible (local) is configured by AI_BASE_URL alone", () => {
    process.env.AI_PROVIDER = "openai-compatible";
    expect(aiConfigured()).toBe(false);
    process.env.AI_BASE_URL = "http://localhost:11434/v1";
    expect(aiConfigured()).toBe(true);
  });

  it("P0.4: the external Anthropic provider needs a key AND an explicit acknowledgement", () => {
    // A key alone is NOT enough — the default must not egress document text.
    expect(aiConfigured()).toBe(false);
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(aiConfigured()).toBe(false); // key set, but not acknowledged → AI disabled
    expect(externalProviderKeyPresentButNotAllowed()).toBe(true);

    process.env.AI_ALLOW_EXTERNAL_PROVIDER = "true";
    expect(aiConfigured()).toBe(true); // now acknowledged
    expect(externalProviderKeyPresentButNotAllowed()).toBe(false);

    // The acknowledgement without a key still doesn't enable it.
    delete process.env.ANTHROPIC_API_KEY;
    expect(aiConfigured()).toBe(false);
  });
});

describe("buildJsonSchema", () => {
  it("produces an inline JSON schema without a $schema header", () => {
    const json = buildJsonSchema(testSchema);
    expect(json.$schema).toBeUndefined();
    expect(json.type).toBe("object");
    expect((json.properties as Record<string, unknown>).verdict).toBeDefined();
  });
});

describe("parseStructured", () => {
  it("accepts plain JSON", () => {
    const r = parseStructured('{"verdict":"approved","reasoning":"ok"}', testSchema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.verdict).toBe("approved");
  });

  it("accepts fenced ```json output", () => {
    const r = parseStructured('```json\n{"verdict":"rejected","reasoning":"nope"}\n```', testSchema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.verdict).toBe("rejected");
  });

  it("rejects malformed JSON", () => {
    const r = parseStructured("The verdict is: approved!", testSchema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not valid JSON/);
  });

  it("rejects JSON that violates the zod contract — even if the provider claimed schema enforcement", () => {
    const r = parseStructured('{"verdict":"maybe","reasoning":"?"}', testSchema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/schema validation failed/);
  });
});

describe("openAiChatCompletion", () => {
  it("happy path: sends response_format json_schema, maps text and usage", async () => {
    const { baseUrl, requests } = await startFakeServer((_body, res) =>
      jsonReply(res, 200, {
        choices: [{ message: { content: '{"verdict":"approved","reasoning":"fine"}' } }],
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      })
    );

    const result = await openAiChatCompletion({
      baseUrl,
      apiKey: "local-key",
      model: "llama3.1:70b",
      system: "You are a test.",
      user: "Review this.",
      maxTokens: 500,
      jsonSchema: buildJsonSchema(testSchema),
      schemaName: "review_response",
    });

    expect(result.text).toBe('{"verdict":"approved","reasoning":"fine"}');
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    expect(result.usedResponseFormat).toBe(true);

    expect(requests).toHaveLength(1);
    expect(requests[0].__url).toBe("/v1/chat/completions");
    expect(requests[0].__auth).toBe("Bearer local-key");
    expect(requests[0].model).toBe("llama3.1:70b");
    const rf = requests[0].response_format as Record<string, any>;
    expect(rf.type).toBe("json_schema");
    expect(rf.json_schema.name).toBe("review_response");
    expect(rf.json_schema.schema.type).toBe("object");
  });

  it("retries once WITHOUT response_format when the server 400s on it", async () => {
    const { baseUrl, requests } = await startFakeServer((body, res) => {
      if (body.response_format) {
        jsonReply(res, 400, { error: { message: "response_format is not supported" } });
      } else {
        jsonReply(res, 200, {
          choices: [{ message: { content: '```json\n{"verdict":"approved","reasoning":"ok"}\n```' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
      }
    });

    const result = await openAiChatCompletion({
      baseUrl,
      model: "m",
      system: "s",
      user: "u",
      maxTokens: 100,
      jsonSchema: buildJsonSchema(testSchema),
    });

    expect(requests).toHaveLength(2);
    expect(requests[1].response_format).toBeUndefined();
    expect(result.usedResponseFormat).toBe(false);
    // …and the fenced fallback text still passes the local zod gate:
    const parsed = parseStructured(result.text, testSchema);
    expect(parsed.ok).toBe(true);
  });

  it("returns usage: null when the endpoint sends no usage fields", async () => {
    const { baseUrl } = await startFakeServer((_body, res) =>
      jsonReply(res, 200, { choices: [{ message: { content: "prose answer" } }] })
    );
    const result = await openAiChatCompletion({ baseUrl, model: "m", system: "s", user: "u", maxTokens: 100 });
    expect(result.usage).toBeNull();
    expect(result.text).toBe("prose answer");
  });

  it("maps the alternative input_tokens/output_tokens usage names", async () => {
    const { baseUrl } = await startFakeServer((_body, res) =>
      jsonReply(res, 200, {
        choices: [{ message: { content: "x" } }],
        usage: { input_tokens: 7, output_tokens: 3 },
      })
    );
    const result = await openAiChatCompletion({ baseUrl, model: "m", system: "s", user: "u", maxTokens: 100 });
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it("throws a status-carrying error on auth failure (no retry loop)", async () => {
    const { baseUrl, requests } = await startFakeServer((_body, res) =>
      jsonReply(res, 401, { error: { message: "bad key" } })
    );
    await expect(
      openAiChatCompletion({ baseUrl, model: "m", system: "s", user: "u", maxTokens: 100 })
    ).rejects.toSatisfy((e: unknown) => e instanceof OpenAiCompatError && e.status === 401);
    expect(requests).toHaveLength(1);
  });

  it("throws on a body with no message content", async () => {
    const { baseUrl } = await startFakeServer((_body, res) => jsonReply(res, 200, { choices: [] }));
    await expect(
      openAiChatCompletion({ baseUrl, model: "m", system: "s", user: "u", maxTokens: 100 })
    ).rejects.toSatisfy((e: unknown) => e instanceof OpenAiCompatError && e.status === 502);
  });
});

describe("estimateTokens", () => {
  it("over-estimates relative to the ~4 chars/token average", () => {
    const text = "a".repeat(4000); // ~1000 real tokens
    expect(estimateTokens(text)).toBeGreaterThanOrEqual(1333);
    expect(estimateTokens("")).toBe(0);
  });
});
