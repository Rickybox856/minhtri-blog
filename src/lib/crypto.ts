// Mã hoá AES-GCM cho dữ liệu nhạy cảm lưu trong D1 (mã truy cập Google, client secret).
// Khoá 32 byte (base64) nằm trong secret TOKEN_ENC_KEY của Worker, không nằm trong DB:
// lộ DB cũng không giải mã được.

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function importKey(secret: string | undefined) {
  if (!secret) throw new Error('Thiếu secret TOKEN_ENC_KEY trên Worker.')
  const raw = fromB64(secret)
  if (raw.length !== 32) throw new Error('TOKEN_ENC_KEY phải là 32 byte (base64).')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encrypt(secret: string | undefined, text: string) {
  const key = await importKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)))
  return `${toB64(iv)}:${toB64(data)}`
}

export async function decrypt(secret: string | undefined, packed: string) {
  const [iv, data] = packed.split(':')
  const key = await importKey(secret)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(data))
  return new TextDecoder().decode(plain)
}
