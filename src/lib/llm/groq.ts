/**
 * Groq API client. OpenAI-compatible chat completions endpoint.
 * Used for less-critical LLM tasks (post re-categorization) to keep paid
 * Gemini usage limited to the main weekly-summary call.
 *
 * Docs: https://console.groq.com/docs/api-reference
 */

export interface GroqCallOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  systemPrompt?: string;
}

// Fast & cheap default — great for classification, structuring, short prose.
const DEFAULT_MODEL = "llama-3.1-8b-instant";

export function hasGroqKey(): boolean {
  return !!process.env.GROQ_API_KEY;
}

export async function callGroq(
  prompt: string,
  opts: GroqCallOptions = {},
): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");

  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: prompt });

  const body: Record<string, unknown> = {
    model: opts.model ?? DEFAULT_MODEL,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 1024,
  };
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(
      `Groq API error ${res.status}: ${data.error?.message ?? JSON.stringify(data)}`,
    );
  }

  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error(`Groq returned no text: ${JSON.stringify(data)}`);
  }
  return text.trim();
}

/**
 * JSON-mode convenience wrapper. Returns parsed JSON or throws.
 */
export async function callGroqJson<T = unknown>(
  prompt: string,
  opts: Omit<GroqCallOptions, "jsonMode"> = {},
): Promise<T> {
  const raw = await callGroq(prompt, { ...opts, jsonMode: true });
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new Error(
      `Groq JSON parse failed: ${e instanceof Error ? e.message : e}\nRaw: ${raw.slice(0, 500)}`,
    );
  }
}
