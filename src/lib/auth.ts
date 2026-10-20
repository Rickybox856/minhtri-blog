// Mật khẩu quản trị lưu trong bảng settings dưới dạng mã băm PBKDF2-SHA256:
//   pbkdf2$<iterations>$<salt base64>$<hash base64>
// scripts/set-admin-password.mjs tạo cùng định dạng này.

const ITERATIONS = 100_000 // mức tối đa Workers hỗ trợ cho PBKDF2
const KEY_LENGTH = 32

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, KEY_LENGTH * 8)
  return new Uint8Array(bits)
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(await pbkdf2(password, salt, ITERATIONS))}`
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iter, salt, hash] = stored.split('$')
  if (scheme !== 'pbkdf2' || !iter || !salt || !hash) return false
  const actual = await pbkdf2(password, fromB64(salt), Number(iter))
  const expected = fromB64(hash)
  // So sánh thời gian không đổi
  let diff = actual.length ^ expected.length
  for (let i = 0; i < Math.max(actual.length, expected.length); i++) diff |= (actual[i] ?? 0) ^ (expected[i] ?? 0)
  return diff === 0
}

export const newSessionKey = () => toB64(crypto.getRandomValues(new Uint8Array(32)))

export async function getSetting(db: D1Database, key: string) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  return row?.value ?? null
}

export async function setSettings(db: D1Database, entries: Record<string, string>) {
  await db.batch(
    Object.entries(entries).map(([key, value]) =>
      db
        .prepare(
          `INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
        )
        .bind(key, value)
    )
  )
}
