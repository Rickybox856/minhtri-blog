import { Hono } from 'hono'
import { isMemberOnlyMedia } from '../lib/members'
import type { AppEnv } from '../types'

const app = new Hono<AppEnv>()

// Phục vụ ảnh/âm thanh từ R2: /media/<key>
app.get('/*', async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/media\//, ''))
  if (!key) return c.notFound()

  // File âm thanh chỉ dành cho thành viên đã đăng nhập
  const memberOnly = isMemberOnlyMedia(key)
  if (memberOnly && !c.get('member')) {
    return c.text('会員限定のコンテンツです。ログインしてください。', 401, { 'Cache-Control': 'no-store' })
  }

  const object = await c.env.MEDIA.get(key, {
    onlyIf: c.req.raw.headers,
    range: c.req.raw.headers,
  })
  if (!object) return c.notFound()

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('ETag', object.httpEtag)
  // File của thành viên: chỉ trình duyệt của họ được giữ, không để bộ nhớ đệm dùng chung lưu lại
  headers.set('Cache-Control', memberOnly ? 'private, max-age=86400' : 'public, max-age=31536000, immutable')
  headers.set('Accept-Ranges', 'bytes')

  if (!('body' in object)) {
    return new Response(null, { status: 304, headers })
  }

  // Trình phát âm thanh/video tải từng đoạn (Range); Safari cần 206 + Content-Range mới tua được
  const r = object.range as { offset?: number; length?: number; suffix?: number } | undefined
  if (r && c.req.header('Range')) {
    const offset = r.suffix != null ? object.size - r.suffix : (r.offset ?? 0)
    const length = r.suffix != null ? r.suffix : (r.length ?? object.size - offset)
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
    headers.set('Content-Length', String(length))
    return new Response(object.body, { status: 206, headers })
  }
  return new Response(object.body, { headers })
})

export default app
