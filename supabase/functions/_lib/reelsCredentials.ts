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
  const target = provider === "pexels"
    ? "https://api.pexels.com/v1/videos/search?query=business&orientation=portrait&per_page=1"
    : "https://api.kie.ai/api/v1/user/credits";
  const headers = provider === "pexels"
    ? { Authorization: apiKey }
    : { Authorization: `Bearer ${apiKey}` };
  const response = await fetch(target, { headers });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`${provider === "pexels" ? "Pexels" : "Kie.ai"}: ключ не принят (${response.status})${detail ? ` — ${detail}` : ""}`);
  }
}
