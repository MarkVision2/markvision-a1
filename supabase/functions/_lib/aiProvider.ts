type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

interface ChatOptions {
  messages: ChatMessage[];
  responseFormat?: { type: "json_object" };
  temperature?: number;
  lovableModel?: string;
  openAiModel?: string;
  timeoutMs?: number;
}

function provider() {
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (openAiKey) {
    return {
      key: openAiKey,
      base: "https://api.openai.com/v1",
      kind: "openai" as const,
    };
  }
  if (lovableKey) {
    return {
      key: lovableKey,
      base: "https://ai.gateway.lovable.dev/v1",
      kind: "lovable" as const,
    };
  }
  throw new Error("Не настроен AI-ключ (LOVABLE_API_KEY или OPENAI_API_KEY)");
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function aiChatCompletion(options: ChatOptions) {
  const current = provider();
  const response = await fetchWithTimeout(
    `${current.base}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${current.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: current.kind === "lovable"
          ? (options.lovableModel ?? "google/gemini-2.5-flash")
          : (options.openAiModel ?? "gpt-4o-mini"),
        messages: options.messages,
        ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
        ...(options.temperature != null ? { temperature: options.temperature } : {}),
      }),
    },
    options.timeoutMs ?? 60_000,
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`AI HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  return await response.json();
}

export async function aiTranscription(formData: FormData, timeoutMs = 90_000) {
  const current = provider();
  // OpenAI expects plain "whisper-1"; Lovable's gateway expects the routed name.
  formData.set("model", current.kind === "lovable" ? "openai/whisper-1" : "whisper-1");
  const response = await fetchWithTimeout(
    `${current.base}/audio/transcriptions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${current.key}` },
      body: formData,
    },
    timeoutMs,
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Whisper HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  return await response.json();
}

export function hasAiProvider(): boolean {
  return Boolean(Deno.env.get("LOVABLE_API_KEY") || Deno.env.get("OPENAI_API_KEY"));
}

export function aiModelName(
  lovableModel = "google/gemini-2.5-flash",
  openAiModel = "gpt-4o-mini",
): string {
  return Deno.env.get("OPENAI_API_KEY") ? openAiModel : lovableModel;
}
