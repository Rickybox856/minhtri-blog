// Tự đăng bài viết hẹn giờ (posts.scheduled_at, UTC) khi đến giờ. Chạy trong cron mỗi giờ.
// Hẹn giờ bằng "publish_at: YYYY-MM-DD HH:MM" (giờ Nhật) trong front matter, xem scripts/publish-post.mjs.
import { bumpCacheVersion } from './page-cache'

export async function runPostSchedule(env: { DB: D1Database }) {
  const { results } = await env.DB.prepare(
    `UPDATE posts SET published = 1, published_at = datetime('now'), updated_at = datetime('now'), scheduled_at = NULL
     WHERE published = 0 AND scheduled_at IS NOT NULL AND scheduled_at <= datetime('now')
     RETURNING slug`
  ).all<{ slug: string }>()
  if (results.length) await bumpCacheVersion(env.DB)
  return { published: results.map((r) => r.slug) }
}
