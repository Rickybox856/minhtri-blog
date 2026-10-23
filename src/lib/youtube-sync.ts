import { marked } from 'marked'
import { getSetting, setSettings } from './auth'
import { accessToken } from './google'
import type { ChannelRow } from './google'
import { bumpCacheVersion } from './page-cache'
import { buildVideoPost, isCompilationTitle } from './video-post'
import { fetchChannelVideos, fetchChannelVideosApi, fetchThumbnail } from './youtube'
import type { ChannelVideo } from './youtube'

// Theo dõi kênh YouTube: chạy mỗi giờ (Cron Trigger) hoặc khi bấm "Kiểm tra ngay" trong quản trị.
// Video mới → vào hàng chờ, mỗi video được xếp một giờ đăng cách nhau GAP_HOURS tiếng;
// đến giờ thì tạo bài giới thiệu từ mẫu và đăng vào chuyên mục 動画.

export const DEFAULT_CHANNEL = 'UCIhJnsL-r9Br9QT7M3wqfVA'
const CATEGORY = 'dong-video'
const PRODUCTS = ['radio-book', 'radio-book2']
const GAP_HOURS = 2 // khoảng cách giữa hai bài video tự đăng

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
  /** Số video mới đưa vào hàng chờ ở lần chạy này */
  queued?: number
  /** Số video còn trong hàng chờ */
  pending: number
  /** Giờ đăng tiếp theo (UTC, dạng YYYY-MM-DD HH:MM:SS) */
  next?: string
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
    const known = new Map(
      (
        await env.DB.prepare(`SELECT video_id, status FROM youtube_videos WHERE video_id IN (${placeholders})`)
          .bind(...videos.map((v) => v.id))
          .all<{ video_id: string; status: string }>()
      ).results.map((r) => [r.video_id, r.status])
    )
    // Video chưa có bài: chưa từng thấy, hoặc chỉ mới được ghi nhận "có sẵn"
    const fresh = videos.filter((v) => !known.has(v.id) || known.get(v.id) === 'baseline')

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

    // 1. Video mới: bản tổng hợp → bỏ qua, còn lại → hàng chờ. YouTube trả mới nhất trước,
    //    nên đảo lại để video cũ hơn được đăng trước (bài mới nhất luôn nằm trên cùng).
    const writes: D1PreparedStatement[] = []
    for (const v of [...fresh].reverse()) {
      const skip = isCompilationTitle(v.title)
      writes.push(
        env.DB.prepare(
          `INSERT INTO youtube_videos (video_id, title, status, note) VALUES (?, ?, ?, ?)
           ON CONFLICT(video_id) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = datetime('now') WHERE status = 'baseline'`
        ).bind(v.id, v.title, skip ? 'skipped' : 'queued', skip ? 'Tiêu đề chỉ là ngày tháng (bản tổng hợp)' : '')
      )
      if (skip) result.skipped++
      else result.queued = (result.queued ?? 0) + 1
    }
    // 2. Video kẹt "đang xử lý" quá 10 phút (lần chạy trước bị dừng giữa chừng) → về lại hàng chờ
    writes.push(
      env.DB.prepare(
        "UPDATE youtube_videos SET status = 'queued', updated_at = datetime('now') WHERE status = 'processing' AND updated_at < datetime('now', '-10 minutes')"
      )
    )
    await env.DB.batch(writes)

    // 3. Xếp giờ đăng cho video chờ chưa có lịch
    await scheduleQueued(env.DB)

    // 4. Đăng video đã đến giờ (mỗi lần chạy tối đa 1 bài)
    const due = await env.DB.prepare(
      "SELECT video_id, title FROM youtube_videos WHERE status = 'queued' AND scheduled_at <= datetime('now') ORDER BY scheduled_at, rowid LIMIT 1"
    ).first<{ video_id: string; title: string }>()
    if (due) {
      // Giành video trước khi làm, tránh hai lần chạy cùng lúc đăng trùng
      const claim = await env.DB.prepare(
        "UPDATE youtube_videos SET status = 'processing', updated_at = datetime('now') WHERE video_id = ? AND status = 'queued'"
      )
        .bind(due.video_id)
        .run()
      if (claim.meta.changes) {
        const post = await processClaimed(env, { id: due.video_id, title: due.title })
        result.posted.push({ id: due.video_id, slug: post.slug, title: post.title })
      }
    }

    const queue = await env.DB.prepare(
      "SELECT COUNT(*) AS n, MIN(scheduled_at) AS next FROM youtube_videos WHERE status = 'queued'"
    ).first<{ n: number; next: string | null }>()
    result.pending = queue?.n ?? 0
    if (queue?.next) result.next = queue.next
  } catch (err) {
    result.error = String(err instanceof Error ? err.message : err).slice(0, 300)
  }
  await setSettings(env.DB, { 'yt.last_run': JSON.stringify(result) })
  return result
}

// Giờ dạng SQLite (UTC): "YYYY-MM-DD HH:MM:SS"
const toSql = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')
const fromSql = (s: string) => new Date(`${s.replace(' ', 'T')}Z`)
const floorHour = (d: Date) => new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000)

/**
 * Xếp giờ đăng cho các video trong hàng chờ chưa có lịch: tròn giờ (khớp cron chạy đầu mỗi giờ),
 * cách bài gần nhất (đã đăng hoặc đã xếp lịch) ít nhất GAP_HOURS tiếng.
 */
async function scheduleQueued(db: D1Database) {
  const { results } = await db
    .prepare("SELECT video_id FROM youtube_videos WHERE status = 'queued' AND scheduled_at IS NULL ORDER BY created_at, rowid")
    .all<{ video_id: string }>()
  if (!results.length) return
  const last = await db
    .prepare(
      `SELECT MAX(CASE WHEN status = 'queued' THEN scheduled_at ELSE updated_at END) AS t
       FROM youtube_videos WHERE status = 'posted' OR (status = 'queued' AND scheduled_at IS NOT NULL)`
    )
    .first<{ t: string | null }>()
  const gap = GAP_HOURS * 3_600_000
  let slot = floorHour(new Date()).getTime()
  if (last?.t) slot = Math.max(slot, floorHour(fromSql(last.t)).getTime() + gap)
  await db.batch(
    results.map((r, i) =>
      db.prepare('UPDATE youtube_videos SET scheduled_at = ? WHERE video_id = ?').bind(toSql(new Date(slot + i * gap)), r.video_id)
    )
  )
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
