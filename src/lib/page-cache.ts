import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../types'

// Cache trang công khai ngay tại máy chủ Cloudflare (Cache API: miễn phí, không giới hạn ghi).
//
// Khoá cache gồm "phiên bản nội dung" (settings.cache_version) và mã bản deploy, nên:
// - lưu/xoá bất cứ gì trong trang quản trị (hoặc đăng bài bằng script) → tăng cache_version → khách thấy ngay bản mới
// - deploy code mới → mã bản deploy đổi → không dùng lại HTML cũ
// Bản cũ không cần xoá, tự hết hạn sau CACHE_SECONDS.
//
// Số phiên bản được đọc sẵn cùng các cài đặt sớm (lib/early-settings.ts): trúng cache thì không cần thêm truy vấn nào.

const CACHE_SECONDS = 7 * 86400

/** SQL tăng phiên bản nội dung; dùng chung cho trang quản trị và các script ghi thẳng vào D1 */
export const BUMP_CACHE_VERSION_SQL = `INSERT INTO settings (key, value) VALUES ('cache_version', '1')
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = datetime('now')`

export const bumpCacheVersion = (db: D1Database) => db.prepare(BUMP_CACHE_VERSION_SQL).run()

// Không cache: trang quản trị, link mua (phải đếm lượt bấm), ảnh (đã có cache riêng), link có ?tham-số
const SKIP = /^\/(quan-tri|mua|media)(\/|$)/

export const pageCache: MiddlewareHandler<AppEnv> = async (c, next) => {
  const url = new URL(c.req.url)
  if (c.req.method !== 'GET' || url.search || SKIP.test(url.pathname)) return next()

  const version = c.get('early').cacheVersion
  const deploy = c.env.CF_VERSION_METADATA?.id ?? 'dev'
  const key = new Request(`${url.origin}${url.pathname}?__v=${version ?? 0}-${deploy}`)
  const cache = caches.default

  const hit = await cache.match(key)
  if (hit) {
    const res = new Response(hit.body, hit)
    res.headers.set('Cache-Control', 'public, max-age=0, must-revalidate')
    res.headers.set('X-Page-Cache', 'HIT')
    return res
  }

  await next()

  const type = c.res.headers.get('Content-Type') ?? ''
  if (c.res.status !== 200 || !/text\/html|application\/xml/.test(type) || c.res.headers.has('Set-Cookie')) return
  const stored = new Response(c.res.clone().body, c.res)
  stored.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`)
  c.executionCtx.waitUntil(cache.put(key, stored))
  // Trình duyệt luôn hỏi lại (rất nhanh khi trúng cache) để thấy ngay bài vừa sửa
  c.res.headers.set('Cache-Control', 'public, max-age=0, must-revalidate')
  c.res.headers.set('X-Page-Cache', 'MISS')
}
