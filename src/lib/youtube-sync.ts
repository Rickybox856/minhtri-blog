import { marked } from 'marked'
import { getSetting, setSettings } from './auth'
import { accessToken } from './google'
import type { ChannelRow } from './google'
import { bumpCacheVersion } from './page-cache'
import { buildVideoPost, isCompilationTitle } from './video-post'
import { fetchChannelVideos, fetchChannelVideosApi, fetchThumbnail } from './youtube'
import type { ChannelVideo } from './youtube'

// Theo dõi kênh YouTube: chạy mỗi giờ (Cron Trigger) hoặc khi bấm "Kiểm tra ngay" trong quản trị.
// Video mới → tạo bài giới thiệu từ mẫu, đăng ngay vào chuyên mục 動画.

export const DEFAULT_CHANNEL = 'UCIhJnsL-r9Br9QT7M3wqfVA'
const CATEGORY = 'dong-video'
const PRODUCTS = ['radio-book', 'radio-book2']
const MAX_PER_RUN = 3 // giữ mỗi lần chạy nhẹ; video còn lại sẽ được xử lý ở lần sau

// YOUTUBE_API_KEY: secret của Worker (tuỳ chọn); nếu không có thì dùng key lưu trong trang quản trị.
// CACHE + TOKEN_ENC_KEY: để dùng kết nối Google của kênh đã liên kết khi không có API key.
type Env = { DB: D1Database; MEDIA: R2Bucket; CACHE: KVNamespace; YOUTUBE_API_KEY?: string; TOKEN_ENC_KEY?: string }

export type SyncResult = {
  at: string
  /** Nguồn đọc danh sách video: trang kênh, hoặc API dự phòng */
  source?: 'page' | 'api' | 'oauth'
  /** Lỗi của trang kênh khi đã phải chuyển sang API */
  fallbackReason?: string
  found: number
  posted: { id: string; slug: string; title: string }[]
  skipped: number
  baseline: number
  pending: number
  error?: string
}

export const getChannelId = async (db: D1Database) => (await getSetting(db, 'yt.channel_id')) || DEFAULT_CHANNEL
export const isEnabled = async (db: D1Database) => (await getSetting(db, 'yt.enabled')) !== '0'
export const getApiKey = async (env: Env) => env.YOUTUBE_API_KEY || (await getSetting(env.DB, 'yt.api_key')) || ''

/**
 * Danh sách video mới nhất: đọc trang kênh trước (không tốn hạn mức),
 * lỗi hoặc không đọc được video nào thì chuyển sang YouTube Data API.
 */
async function listVideos(env: Env, channelId: string, result: SyncResult) {
  try {
    const videos = await fetchChannelVideos(channelId)
    result.source = 'page'
    return videos
  } catch (err) {
    const pageError = String(err instanceof Error ? err.message : err)
    result.fallbackReason = pageError.slice(0, 200)
    const key = await getApiKey(env)
    if (key) {
      const videos = await fetchChannelVideosApi(channelId, { key })
      result.source = 'api'
      return videos
    }
    const token = await linkedChannelToken(env, channelId)
    if (!token) throw new Error(`${pageError} Chưa có API key dự phòng và chưa liên kết kênh YouTube nào.`)
    const videos = await fetchChannelVideosApi(channelId, { token })
    result.source = 'oauth'
    return videos
  }
}

/** Mã truy cập của một kênh đã liên kết (ưu tiên chính kênh đang theo dõi) */
async function linkedChannelToken(env: Env, channelId: string) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM youtube_channels WHERE status = 'ok' ORDER BY channel_id = ? DESC, id"
  )
    .bind(channelId)
    .all<ChannelRow>()
  for (const ch of results) {
    try {
      return await accessToken(env, ch)
    } catch {
      // kênh này hết hạn → thử kênh khác
    }
  }
  return null
}

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
    const videos = await listVideos(env, await getChannelId(env.DB), result)
    result.found = videos.length
    if (!videos.length) {
      await setSettings(env.DB, { 'yt.last_run': JSON.stringify(result) })
      return result
    }
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
