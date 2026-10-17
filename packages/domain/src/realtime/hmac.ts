/**
 * HMAC-SHA256 與 base64url:只用 WebCrypto(`crypto.subtle`)、`TextEncoder`、`btoa` / `atob`,
 * Node(api)與 Cloudflare Worker(V8)都有這些全域,所以本檔不 import 任何 Node 模組。
 */

const encoder = new TextEncoder();

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/** 不是合法 base64url 時回 `null`(不拋錯:呼叫端把它當格式錯誤處理)。 */
export function decodeBase64Url(text: string): Uint8Array | null {
  if (!/^[\w-]*$/.test(text)) {
    return null;
  }
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  try {
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
  } catch {
    return null;
  }
}

export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text);
}

async function importHmacKey(secret: string) {
  if (secret.length === 0) {
    throw new Error("即時通道的 HMAC 密鑰不可為空");
  }
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** 對 `message` 簽 HMAC-SHA256,回 base64url。 */
export async function signHmac(
  secret: string,
  message: string,
): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

/** 用 `crypto.subtle.verify` 比對(常數時間),簽章格式錯誤也回 `false`。 */
export async function verifyHmac(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const bytes = decodeBase64Url(signature);
  if (bytes === null || bytes.length === 0) {
    return false;
  }
  const key = await importHmacKey(secret);
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(message));
}
