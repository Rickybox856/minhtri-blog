import { getSetting, setSettings } from './auth'
import { decrypt, encrypt } from './crypto'

// Google OAuth 2.0 + YouTube Data API cho các kênh được kết nối.
// Client ID / Client secret nhập trong trang quản trị (secret được mã hoá); khoá mã hoá là secret TOKEN_ENC_KEY.

export type GEnv = { DB: D1Database; CACHE: KVNamespace; TOKEN_ENC_KEY?: string }

export const OAUTH_CALLBACK_PATH = '/oauth/google/callback'
// youtube.force-ssl: xem, sửa và tải video lên kênh (đủ cho videos.insert / videos.update)
const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl'
const API = 'https://www.googleapis.com/youtube/v3'

export type ChannelRow = {
  id: number
  channel_id: string
  title: string
  thumbnail: string
  refresh_token_enc: string
  access_token_enc: string | null
  access_expires_at: number
  status: string
  desc_footer: string
  default_tags: string
  connected_at: string
}

export async function getOAuthConfig(env: GEnv) {
  const [clientId, secretEnc] = await Promise.all([getSetting(env.DB, 'google.client_id'), getSetting(env.DB, 'google.client_secret')])
  if (!clientId || !secretEnc) return null
  return { clientId, clientSecret: await decrypt(env.TOKEN_ENC_KEY, secretEnc) }
}

export async function saveOAuthConfig(env: GEnv, clientId: string, clientSecret?: string) {
  await setSettings(env.DB, {
    'google.client_id': clientId,
    ...(clientSecret ? { 'google.client_secret': await encrypt(env.TOKEN_ENC_KEY, clientSecret) } : {}),
  })
}

/** Link đăng nhập Google; state ngẫu nhiên lưu 10 phút để chống giả mạo */
export async function authUrl(env: GEnv, origin: string) {
  const cfg = await getOAuthConfig(env)
  if (!cfg) throw new Error('Chưa nhập Client ID / Client secret.')
  const state = crypto.randomUUID()
  await env.CACHE.put(`oauth-state:${state}`, '1', { expirationTtl: 600 })
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: origin + OAUTH_CALLBACK_PATH,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline', // để nhận refresh token
    prompt: 'consent select_account', // luôn hỏi chọn tài khoản/kênh và luôn trả refresh token
    include_granted_scopes: 'true',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`
}

export async function consumeState(env: GEnv, state: string) {
  const key = `oauth-state:${state}`
  if (!state || !(await env.CACHE.get(key))) return false
  await env.CACHE.delete(key)
  return true
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; error?: string; error_description?: string }

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const data = (await res.json()) as TokenResponse
  if (!res.ok || data.error) throw Object.assign(new Error(data.error_description || data.error || `Google trả mã ${res.status}`), { code: data.error })
  return data
}

/** Đổi mã đăng nhập lấy token, đọc thông tin kênh rồi lưu (mã hoá) */
export async function connectChannel(env: GEnv, origin: string, code: string) {
  const cfg = await getOAuthConfig(env)
  if (!cfg) throw new Error('Chưa cấu hình Google OAuth.')
  const tok = await tokenRequest({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: origin + OAUTH_CALLBACK_PATH,
    grant_type: 'authorization_code',
  })
  if (!tok.refresh_token) throw new Error('Google không trả refresh token. Hãy thử kết nối lại.')
  const info = await apiFetch<{ items?: { id: string; snippet: { title: string; thumbnails?: { default?: { url: string } } } }[] }>(
    tok.access_token,
    'channels',
    { part: 'snippet', mine: 'true' }
  )
  const ch = info.items?.[0]
  if (!ch) throw new Error('Tài khoản này chưa có kênh YouTube.')
  await env.DB.prepare(
    `INSERT INTO youtube_channels (channel_id, title, thumbnail, refresh_token_enc, access_token_enc, access_expires_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'ok')
     ON CONFLICT(channel_id) DO UPDATE SET title = excluded.title, thumbnail = excluded.thumbnail,
       refresh_token_enc = excluded.refresh_token_enc, access_token_enc = excluded.access_token_enc,
       access_expires_at = excluded.access_expires_at, status = 'ok'`
  )
    .bind(
      ch.id,
      ch.snippet.title,
      ch.snippet.thumbnails?.default?.url ?? '',
      await encrypt(env.TOKEN_ENC_KEY, tok.refresh_token),
      await encrypt(env.TOKEN_ENC_KEY, tok.access_token),
      Date.now() + tok.expires_in * 1000
    )
    .run()
  return ch.snippet.title
}

/** Mã truy cập còn hạn (tự làm mới khi sắp hết). Refresh token bị thu hồi → đánh dấu cần kết nối lại */
export async function accessToken(env: GEnv, ch: ChannelRow) {
  if (ch.access_token_enc && ch.access_expires_at > Date.now() + 60_000) return decrypt(env.TOKEN_ENC_KEY, ch.access_token_enc)
  const cfg = await getOAuthConfig(env)
  if (!cfg) throw new Error('Chưa cấu hình Google OAuth.')
  try {
    const tok = await tokenRequest({
      refresh_token: await decrypt(env.TOKEN_ENC_KEY, ch.refresh_token_enc),
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
    })
    const expires = Date.now() + tok.expires_in * 1000
    await env.DB.prepare("UPDATE youtube_channels SET access_token_enc = ?, access_expires_at = ?, status = 'ok' WHERE id = ?")
      .bind(await encrypt(env.TOKEN_ENC_KEY, tok.access_token), expires, ch.id)
      .run()
    ch.access_expires_at = expires
    return tok.access_token
  } catch (err) {
    if ((err as { code?: string }).code === 'invalid_grant') {
      await env.DB.prepare("UPDATE youtube_channels SET status = 'expired' WHERE id = ?").bind(ch.id).run()
      throw new Error('Quyền truy cập kênh đã hết hạn hoặc bị thu hồi. Hãy bấm "Kết nối lại".')
    }
    throw err
  }
}

type ApiErr = { error?: { message?: string; errors?: { reason?: string }[] } }

/** Gọi YouTube Data API bằng mã truy cập; lỗi được dịch sang câu dễ hiểu */
export async function apiFetch<T>(token: string, path: string, params: Record<string, string>, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.headers ?? {}) },
  })
  const data = (await res.json().catch(() => ({}))) as T & ApiErr
  if (!res.ok) {
    const reason = data.error?.errors?.[0]?.reason
    const msg =
      reason === 'quotaExceeded'
        ? 'Đã hết hạn mức YouTube API trong ngày (reset lúc 0 giờ giờ Mỹ Thái Bình Dương). Thử lại sau.'
        : res.status === 401
          ? 'Quyền truy cập kênh không còn hợp lệ. Hãy bấm "Kết nối lại" để đăng nhập Google lần nữa.'
        : reason === 'forbidden' || res.status === 403
          ? `YouTube từ chối: ${data.error?.message ?? 'không có quyền'}`
          : data.error?.message ?? `YouTube API trả mã ${res.status}`
    throw new Error(msg)
  }
  return data
}

export const getChannel = (db: D1Database, id: number) =>
  db.prepare('SELECT * FROM youtube_channels WHERE id = ?').bind(id).first<ChannelRow>()
