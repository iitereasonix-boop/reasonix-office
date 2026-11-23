// Any provider with an OpenAI-style chat API can run the assistant. Anthropic keeps its own
// SDK path in agent.ts because it has features the shared path does not use.
export type Provider = { id: string; label: string; base: string; prefixes: string[]; preferred: RegExp[]; vision?: boolean };

export const ANTHROPIC = "anthropic";

export const PROVIDERS: Provider[] = [
  { id: "openrouter", label: "OpenRouter", base: "https://openrouter.ai/api/v1", prefixes: ["sk-or-"], preferred: [/^anthropic\/claude-opus/, /^openai\/gpt/], vision: true },
  { id: "openai", label: "OpenAI", base: "https://api.openai.com/v1", prefixes: ["sk-"], preferred: [/^gpt-\d+(\.\d+)?$/, /^gpt-\d/], vision: true },
  { id: "deepseek", label: "DeepSeek", base: "https://api.deepseek.com/v1", prefixes: ["sk-"], preferred: [/^deepseek-chat/] },
  { id: "cohere", label: "Cohere", base: "https://api.cohere.ai/compatibility/v1", prefixes: ["cohere_", ""], preferred: [/^command-a-plus/, /^command-a-\d/, /^command-r-plus/] },
  { id: "gemini", label: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", prefixes: ["AIza"], preferred: [/^gemini-[\d.]+-pro$/, /^gemini-[\d.]+-flash$/, /^gemini/], vision: true },
  { id: "groq", label: "Groq", base: "https://api.groq.com/openai/v1", prefixes: ["gsk_"], preferred: [/llama.*versatile/, /llama/] },
  { id: "xai", label: "xAI", base: "https://api.x.ai/v1", prefixes: ["xai-"], preferred: [/^grok-\d+$/, /^grok/], vision: true },
  { id: "mistral", label: "Mistral", base: "https://api.mistral.ai/v1", prefixes: [""], preferred: [/^mistral-large-latest/, /^mistral-large/] },
];

const NOT_CHAT = /embed|rerank|moderation|whisper|tts|audio|image|dall-e|transcribe|realtime|search|translate|vision|code/i;

export const providerBase = (provider: Provider) => process.env.AI_COMPAT_BASE || provider.base;
export const providerById = (id: string) => PROVIDERS.find((provider) => provider.id === id);
export const providerLabel = (id: string | null | undefined) => (id === ANTHROPIC ? "Anthropic" : providerById(id ?? "")?.label ?? null);

/** The longest matching prefix wins, and the key only ever goes to providers it could belong to. */
export function candidateProviders(key: string) {
  const known = PROVIDERS.filter((provider) => provider.prefixes.some((prefix) => prefix && key.startsWith(prefix)));
  const longest = Math.max(0, ...known.flatMap((provider) => provider.prefixes.filter((prefix) => key.startsWith(prefix)).map((prefix) => prefix.length)));
  const matched = known.filter((provider) => provider.prefixes.some((prefix) => prefix.length === longest && key.startsWith(prefix)));
  return matched.length ? matched : PROVIDERS.filter((provider) => provider.prefixes.includes(""));
}

export function chooseModel(provider: Provider, ids: string[]) {
  const names = ids.map((id) => id.replace(/^models\//, ""));
  for (const pattern of provider.preferred) {
    const found = names.filter((name) => pattern.test(name)).sort().at(-1);
    if (found) return found;
  }
  return names.find((name) => !NOT_CHAT.test(name)) ?? null;
}

/** Listing models proves the key works, costs nothing, and shows which model to use. */
export async function detectProvider(key: string) {
  if (key.startsWith("sk-ant-")) {
    const base = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
    const response = await fetch(`${base}/v1/models`, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } }).catch(() => null);
    return response?.ok ? { provider: ANTHROPIC, model: null } : null;
  }
  for (const provider of candidateProviders(key)) {
    const response = await fetch(`${providerBase(provider)}/models`, { headers: { Authorization: `Bearer ${key}` } }).catch(() => null);
    if (!response?.ok) continue;
    const body = await response.json().catch(() => null) as { data?: { id: string }[] } | null;
    const model = chooseModel(provider, body?.data?.map((row) => row.id) ?? []);
    if (model) return { provider: provider.id, model };
  }
  return null;
}

export class ProviderError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string | object[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Cohere wraps cited phrases in <co> tags, which must not reach a lawyer's draft. */
export const stripProviderMarkup = (text: string) => text.replace(/<\/?co(?::[^>]*)?>/g, "");

export async function chatCompletion(
  config: { provider: Provider; key: string; model: string },
  messages: ChatMessage[],
  options: { tools?: object[]; json?: boolean; signal?: AbortSignal } = {},
) {
  const response = await fetch(`${providerBase(config.provider)}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      model: config.model,
      messages,
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!response.ok) throw new ProviderError(`AI provider returned ${response.status}`, response.status);
  const body = await response.json() as { choices?: { message?: { content?: string | { text?: string }[] | null; tool_calls?: ToolCall[] } }[] };
  const message = body.choices?.[0]?.message;
  const text = Array.isArray(message?.content) ? message.content.map((part) => part.text ?? "").join("") : message?.content ?? "";
  const toolCalls = (message?.tool_calls ?? []).map((call) => ({ ...call, function: { ...call.function, arguments: stripProviderMarkup(call.function.arguments) } }));
  return { text: stripProviderMarkup(text), toolCalls };
}
