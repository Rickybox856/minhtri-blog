import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AppEnv } from '../types'

// Thành viên miễn phí: đăng nhập để nghe âm thanh / xem video trong bài.
// Cookie giữ mã phiên ngẫu nhiên; DB chỉ lưu SHA-256 của mã nên lộ DB cũng không dùng lại được phiên.

export const MEMBER_COOKIE = 'mb_session'
const SESSION_DAYS = 30
export const MIN_PASSWORD = 8

export type Member = { id: number; email: string; name: string; nickname: string | null }

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const sha256 = async (s: string) => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')

/** Có cookie thành viên hay không (không tốn truy vấn); dùng để bỏ qua cache trang */
export const hasMemberCookie = (c: Context) => Boolean(getCookie(c, MEMBER_COOKIE))

// Đọc thành viên từ cookie; chỉ truy vấn DB khi có cookie
export const loadMember: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, MEMBER_COOKIE)
  let member: Member | null = null
  if (token) {
    member = await c.env.DB.prepare(
      `SELECT m.id, m.email, m.name, m.nickname FROM member_sessions s JOIN members m ON m.id = s.member_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND m.disabled = 0`
    )
      .bind(await sha256(token))
      .first<Member>()
    if (!member) deleteCookie(c, MEMBER_COOKIE, { path: '/', secure: true })
  }
  c.set('member', member)
  await next()
}

export async function startMemberSession(c: Context<AppEnv>, memberId: number) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)).buffer)
  const expires = Date.now() + SESSION_DAYS * 86400_000
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO member_sessions (token_hash, member_id, expires_at) VALUES (?, ?, ?)').bind(
      await sha256(token),
      memberId,
      sqlTime(expires)
    ),
    c.env.DB.prepare("UPDATE members SET last_login_at = datetime('now') WHERE id = ?").bind(memberId),
    // Dọn phiên hết hạn của người này
    c.env.DB.prepare("DELETE FROM member_sessions WHERE member_id = ? AND expires_at <= datetime('now')").bind(memberId),
  ])
  setCookie(c, MEMBER_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: SESSION_DAYS * 86400,
  })
}

export async function endMemberSession(c: Context<AppEnv>) {
  const token = getCookie(c, MEMBER_COOKIE)
  if (token) await c.env.DB.prepare('DELETE FROM member_sessions WHERE token_hash = ?').bind(await sha256(token)).run()
  deleteCookie(c, MEMBER_COOKIE, { path: '/', secure: true })
}

/** Chỉ cho chuyển về đường dẫn nội bộ (chặn chuyển hướng ra trang ngoài) */
export const safeNext = (raw: unknown) => {
  const s = typeof raw === 'string' ? raw : ''
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') && !s.startsWith('/thanh-vien') ? s : '/'
}

// --- Khoá trình phát trong bài cho khách chưa đăng nhập ---

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i
/** File âm thanh trong kho media chỉ dành cho thành viên */
export const isMemberOnlyMedia = (key: string) => AUDIO_EXT.test(key)

/** Bài có trình phát âm thanh cần khoá hay không (video thì ai cũng xem được) */
export const hasMemberMedia = (html: string) => /class="audio-player"/.test(html)

const lockBox = (kind: '音声', next: string) => {
  const q = `?next=${encodeURIComponent(next)}`
  return `<div class="member-lock"><p class="member-lock-title">🔒 この${kind}は会員限定です</p><p>無料の会員登録（メールアドレスとパスワードだけ）で、すべての音声をお楽しみいただけます。</p><p class="member-lock-actions"><a class="btn" href="/thanh-vien/dang-ky${q}">無料で会員登録</a><a class="btn btn-outline" href="/thanh-vien/dang-nhap${q}">ログイン</a></p></div>`
}

/** Thay trình phát âm thanh bằng khung mời đăng nhập */
export function lockMemberMedia(html: string, next: string) {
  return html.replace(/<div class="audio-player">[\s\S]*?<\/audio><\/div>/g, () => lockBox('音声', next))
}
