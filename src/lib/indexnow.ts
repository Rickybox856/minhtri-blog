// IndexNow: báo cho Bing / Yandex / Seznam... ngay khi có trang mới hoặc vừa sửa, không cần chờ bot tự quét.
// Khoá công khai, phải có file /<khoá>.txt trả về đúng khoá (route trong index.tsx).
// Cron mỗi giờ gửi các bài / chủ đề diễn đàn đổi từ lần gửi trước (mốc lưu ở settings 'indexnow.last_run'),
// nên mọi cách đăng (quản trị, script, YouTube tự đăng, lịch diễn đàn) đều được báo.

export const INDEXNOW_KEY = '396308d96033888df29e3d0add85347b'

const LAST_RUN = 'indexnow.last_run'

export async function runIndexNow(env: CloudflareBindings) {
  const db = env.DB
  const siteUrl = (
    await db.prepare("SELECT value FROM settings WHERE key = 'site.site_url'").first<{ value: string }>()
  )?.value?.replace(/\/+$/, '')
  if (!siteUrl) return { skipped: 'no site_url' }

  const now = (await db.prepare("SELECT datetime('now') AS t").first<{ t: string }>())!.t
  const last = (await db.prepare('SELECT value FROM settings WHERE key = ?').bind(LAST_RUN).first<{ value: string }>())?.value
  // Lần chạy đầu: chỉ đặt mốc, không gửi lại toàn bộ site
  if (!last) {
    await saveLastRun(db, now)
    return { initialized: now }
  }

  const [posts, threads] = await Promise.all([
    db
      .prepare(
        `SELECT slug FROM posts WHERE published = 1 AND published_at <= ?2
           AND (updated_at > ?1 OR published_at > ?1) LIMIT 500`
      )
      .bind(last, now)
      .all<{ slug: string }>(),
    db
      .prepare("SELECT id FROM forum_threads WHERE status = 'visible' AND last_post_at > ? LIMIT 500")
      .bind(last)
      .all<{ id: number }>(),
  ])
  const urls = [
    ...posts.results.map((p) => `${siteUrl}/bai-viet/${p.slug}`),
    ...threads.results.map((t) => `${siteUrl}/dien-dan/chu-de/${t.id}`),
  ]
  if (urls.length === 0) {
    await saveLastRun(db, now)
    return { sent: 0 }
  }
  // Có trang mới thì trang chủ / danh sách cũng đổi
  urls.push(`${siteUrl}/`, `${siteUrl}/bai-viet`)

  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: new URL(siteUrl).host,
      key: INDEXNOW_KEY,
      keyLocation: `${siteUrl}/${INDEXNOW_KEY}.txt`,
      urlList: urls,
    }),
  })
  // 200/202 = đã nhận; lỗi thì giữ mốc cũ để lần sau gửi lại
  if (res.ok) await saveLastRun(db, now)
  return { sent: urls.length, status: res.status }
}

const saveLastRun = (db: D1Database, value: string) =>
  db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .bind(LAST_RUN, value)
    .run()
