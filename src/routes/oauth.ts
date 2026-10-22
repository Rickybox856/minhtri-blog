import { Hono } from 'hono'
import { connectChannel, consumeState } from '../lib/google'
import type { GEnv } from '../lib/google'

// Google chuyển về đây sau khi chủ kênh cho phép. Nằm ngoài /quan-tri vì cookie quản trị (SameSite=Strict)
// không được gửi kèm khi Google chuyển hướng về; an toàn nhờ "state" ngẫu nhiên chỉ trang quản trị tạo được.
const app = new Hono<{ Bindings: CloudflareBindings }>()
const ADMIN = '/quan-tri/kenh-youtube'

app.get('/google/callback', async (c) => {
  c.header('Cache-Control', 'no-store')
  c.header('X-Robots-Tag', 'noindex')
  const fail = (msg: string) => c.redirect(`${ADMIN}?err=${encodeURIComponent(msg)}`, 303)
  const env = c.env as unknown as GEnv
  if (!(await consumeState(env, c.req.query('state') ?? ''))) return fail('Phiên kết nối không hợp lệ hoặc đã hết hạn. Hãy bấm “Kết nối kênh” lại.')
  const error = c.req.query('error')
  if (error) return fail(error === 'access_denied' ? 'Bạn đã huỷ cấp quyền.' : `Google báo lỗi: ${error}`)
  try {
    const name = await connectChannel(env, new URL(c.req.url).origin, c.req.query('code') ?? '')
    return c.redirect(`${ADMIN}?ok=connected&name=${encodeURIComponent(name)}`, 303)
  } catch (e) {
    return fail((e as Error).message)
  }
})

export default app
