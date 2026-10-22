import { Hono } from 'hono'

const app = new Hono<{ Bindings: CloudflareBindings }>()

// Phục vụ ảnh từ R2: /media/<key>
app.get('/*', async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/media\//, ''))
  if (!key) return c.notFound()

  const object = await c.env.MEDIA.get(key, {
    onlyIf: c.req.raw.headers,
    range: c.req.raw.headers,
  })
  if (!object) return c.notFound()

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('ETag', object.httpEtag)
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
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
