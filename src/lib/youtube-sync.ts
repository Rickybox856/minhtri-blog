import { marked } from 'marked'
import { getSetting, setSettings } from './auth'
import { bumpCacheVersion } from './page-cache'
import { buildVideoPost, isCompilationTitle } from './video-post'
import { fetchChannelVideos, fetchThumbnail } from './youtube'
import type { ChannelVideo } from './youtube'

// Theo dõi kênh YouTube: chạy mỗi giờ (Cron Trigger) hoặc khi bấm "Kiểm tra ngay" trong quản trị.
// Video mới → tạo bài giới thiệu từ mẫu, đăng ngay vào chuyên mục 動画.

export const DEFAULT_CHANNEL = 'UCIhJnsL-r9Br9QT7M3wqfVA'
const CATEGORY = 'dong-video'
const PRODUCTS = ['radio-book', 'radio-book2']
const MAX_PER_RUN = 3 // giữ mỗi lần chạy nhẹ; video còn lại sẽ được xử lý ở lần sau

type Env = { DB: D1Database; MEDIA: R2Bucket }

export type SyncResult = {
  at: string
  found: number
  posted: { id: string; slug: string; title: string }[]
  skipped: number
  baseline: number
  pending: number
  error?: string
}

export const getChannelId = async (db: D1Database) => (await getSetting(db, 'yt.channel_id')) || DEFAULT_CHANNEL
export const isEnabled = async (db: D1Database) => (await getSetting(db, 'yt.enabled')) !== '0'

/** Tạo và đăng bài cho một video. Trả về slug */
export async function publishVideoPost(env: Env, video: ChannelVideo) {
  const post = buildVideoPost(video)
  const now = new Date()
  const coverKey = `uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/yt-${video.id}.jpg`
  const thumb = await fetchThumbnail(video.id)
  if (thumb) {
    await env.MEDIA.put(coverKey, thumb, {
      httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { originalName: `youtube-${video.id}.jpg` },
    })
  }
  const html = await marked.parse(post.markdown)
  const postId = `(SELECT id FROM posts WHERE slug = ?)`
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO posts (slug, title, excerpt, content_md, content_html, category, cover_key, published, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now')) ON CONFLICT(slug) DO NOTHING`
    ).bind(post.slug, post.title, post.excerpt, post.markdown, html, CATEGORY, thumb ? coverKey : null),
    ...PRODUCTS.map((p, i) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO post_products (post_id, product_id, position) SELECT ${postId}, id, ? FROM products WHERE slug = ?`
      ).bind(post.slug, i, p)
    ),
  ])
  await bumpCacheVersion(env.DB)
  return post
}

/** Xử lý một video đã "giành" được (status = processing) */
async function processClaimed(env: Env, video: ChannelVideo) {
  try {
    const post = await publishVideoPost(env, video)
    await env.DB.prepare(
      "UPDATE youtube_videos SET status = 'posted', post_slug = ?, note = '', updated_at = datetime('now') WHERE video_id = ?"
    )
      .bind(post.slug, video.id)
      .run()
    return post
  } catch (err) {
    await env.DB.prepare("UPDATE youtube_videos SET status = 'error', note = ?, updated_at = datetime('now') WHERE video_id = ?")
      .bind(String(err).slice(0, 300), video.id)
      .run()
    throw err
  }
}

export async function runYoutubeSync(env: Env, opts: { force?: boolean } = {}): Promise<SyncResult> {
  const result: SyncResult = { at: new Date().toISOString(), found: 0, posted: [], skipped: 0, baseline: 0, pending: 0 }
  try {
    if (!opts.force && !(await isEnabled(env.DB))) {
      result.error = 'Đang tắt tự động.'
      return result
    }
    const videos = await fetchChannelVideos(await getChannelId(env.DB))
    result.found = videos.length
    const placeholders = videos.map(() => '?').join(',')
    const known = new Set(
      (
        await env.DB.prepare(`SELECT video_id FROM youtube_videos WHERE video_id IN (${placeholders})`)
          .bind(...videos.map((v) => v.id))
          .all<{ video_id: string }>()
      ).results.map((r) => r.video_id)
    )
    const fresh = videos.filter((v) => !known.has(v.id)).reverse() // cũ trước, để bài đăng đúng thứ tự

    // Lần chạy đầu: chỉ ghi nhận các video đang có, không đăng hàng loạt
    if (!(await getSetting(env.DB, 'yt.baseline_done'))) {
      if (fresh.length) {
        await env.DB.batch(
          fresh.map((v) =>
            env.DB.prepare("INSERT OR IGNORE INTO youtube_videos (video_id, title, status, note) VALUES (?, ?, 'baseline', 'Có sẵn trước khi bật theo dõi')").bind(v.id, v.title)
          )
        )
      }
      await setSettings(env.DB, { 'yt.baseline_done': '1', 'yt.last_run': JSON.stringify({ ...result, baseline: fresh.length }) })
      result.baseline = fresh.length
      return result
    }

    let done = 0
    for (const v of fresh) {
      if (isCompilationTitle(v.title)) {
        await env.DB.prepare("INSERT OR IGNORE INTO youtube_videos (video_id, title, status, note) VALUES (?, ?, 'skipped', 'Tiêu đề chỉ là ngày tháng (bản tổng hợp)')")
          .bind(v.id, v.title)
          .run()
        result.skipped++
        continue
      }
      if (done >= MAX_PER_RUN) {
        result.pending++
        continue
      }
      // Giành video trước khi làm, tránh hai lần chạy cùng lúc đăng trùng
      const claim = await env.DB.prepare("INSERT OR IGNORE INTO youtube_videos (video_id, title, status) VALUES (?, ?, 'processing')")
        .bind(v.id, v.title)
        .run()
      if (!claim.meta.changes) continue
      const post = await processClaimed(env, v)
      result.posted.push({ id: v.id, slug: post.slug, title: post.title })
      done++
    }
  } catch (err) {
    result.error = String(err instanceof Error ? err.message : err).slice(0, 300)
  }
  await setSettings(env.DB, { 'yt.last_run': JSON.stringify(result) })
  return result
}

/** Đăng thủ công một video đã bị bỏ qua / lỗi (từ trang quản trị) */
export async function publishExisting(env: Env, videoId: string) {
  const row = await env.DB.prepare('SELECT video_id, title, status FROM youtube_videos WHERE video_id = ?')
    .bind(videoId)
    .first<{ video_id: string; title: string; status: string }>()
  if (!row || row.status === 'posted') return null
  // "processing" quá 10 phút coi như bị kẹt (lần chạy trước bị dừng giữa chừng) → cho làm lại
  const claim = await env.DB.prepare(
    `UPDATE youtube_videos SET status = 'processing', updated_at = datetime('now')
     WHERE video_id = ? AND status != 'posted' AND (status != 'processing' OR updated_at < datetime('now', '-10 minutes'))`
  )
    .bind(videoId)
    .run()
  if (!claim.meta.changes) return null
  return processClaimed(env, { id: row.video_id, title: row.title })
}
