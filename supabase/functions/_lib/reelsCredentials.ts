export type ReelsProvider = "pexels" | "kie";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey(): Promise<CryptoKey> {
  const material = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!material) throw new Error("Encryption key unavailable");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptProviderKey(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(value),
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptProviderKey(value: string): Promise<string> {
  const [ivPart, dataPart] = value.split(".");
  if (!ivPart || !dataPart) throw new Error("Invalid encrypted credential");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivPart) },
    await encryptionKey(),
    base64ToBytes(dataPart),
  );
  return new TextDecoder().decode(decrypted);
}

export async function testProviderKey(provider: ReelsProvider, apiKey: string): Promise<void> {
  if (provider === "pexels") {
    const response = await fetch(
      "https://api.pexels.com/v1/videos/search?query=business&orientation=portrait&per_page=1",
      { headers: { Authorization: apiKey } },
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Pexels: ключ не принят (${response.status})${detail ? ` — ${detail}` : ""}`);
    }
    return;
  }

  // Kie.ai: проверка баланса. Гейт отвечает HTTP 200 даже при неверном ключе,
  // фактический статус лежит в поле `code` тела ответа.
  const response = await fetch("https://api.kie.ai/api/v1/chat/credit", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const raw = (await response.text()).slice(0, 300);
  if (!response.ok) {
    throw new Error(`Kie.ai: ключ не принят (${response.status})${raw ? ` — ${raw}` : ""}`);
  }
  let code = 0;
  let msg = "";
  try {
    const parsed = JSON.parse(raw) as { code?: number; msg?: string };
    code = Number(parsed.code ?? 0);
    msg = String(parsed.msg ?? "");
  } catch {
    throw new Error(`Kie.ai: неожиданный ответ сервиса — ${raw}`);
  }
  if (code !== 200) {
    throw new Error(`Kie.ai: ключ не принят (${code})${msg ? ` — ${msg}` : ""}`);
  }
}
