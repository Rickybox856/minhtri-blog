import { accessToken, apiFetch, getChannel } from './google'
import type { ChannelRow, GEnv } from './google'

// Tự động đặt lịch đăng video nháp: chạy trong cron mỗi giờ (và nút "Chạy ngay" / "Xem trước" trong trang quản trị).
// Video nháp = riêng tư, chưa có lịch. Mỗi video được xếp vào khung giờ trống tiếp theo; YouTube tự công khai khi tới giờ.
// Giữ số request nhỏ (giới hạn của Workers): chỉ quét SCAN_PAGES × 50 video mới nhất, mỗi lần tối đa max_per_run video.

export type AutoConfig = {
  channel_id: number
  enabled: number
  tz_offset: number
  times: string
  weekdays: string
  order_by: string
  min_age_min: number
  lead_hours: number
  max_per_run: number
  skip_marker: string
  last_run: string | null
}

export const DEFAULT_CONFIG: Omit<AutoConfig, 'channel_id'> = {
  enabled: 0,
  tz_offset: 540,
  times: '20:00',
  weekdays: '0123456',
  order_by: 'oldest',
  min_age_min: 60,
  lead_hours: 2,
  max_per_run: 5,
  skip_marker: '[giữ]',
  last_run: null,
}

const SCAN_PAGES = 2
const HORIZON_DAYS = 120

type Status = {
  privacyStatus: string
  publishAt?: string
  uploadStatus?: string
  embeddable?: boolean
  license?: string
  publicStatsViewable?: boolean
  selfDeclaredMadeForKids?: boolean
  madeForKids?: boolean
  containsSyntheticMedia?: boolean
}
type Video = { id: string; snippet: { title: string; publishedAt: string }; status: Status }

export type PlanItem = { videoId: string; title: string; publishAt: string; ok?: boolean; error?: string }
export type RunResult = {
  at: string
  dryRun: boolean
  drafts: number // số video nháp đủ điều kiện tìm thấy
  skipped: { videoId: string; title: string; reason: string }[]
  items: PlanItem[]
  error?: string
}

export const getConfig = async (db: D1Database, channelId: number): Promise<AutoConfig> =>
  (await db.prepare('SELECT * FROM youtube_autoschedule WHERE channel_id = ?').bind(channelId).first<AutoConfig>()) ?? {
    channel_id: channelId,
    ...DEFAULT_CONFIG,
  }

/** "20:00, 7:30" → [[20,0],[7,30]] (sắp xếp, bỏ trùng, bỏ giá trị sai) */
export function parseTimes(s: string): [number, number][] {
  const seen = new Set<number>()
  for (const part of s.split(/[,、\s]+/)) {
    const m = /^(\d{1,2})[:h](\d{2})?$/.exec(part.trim())
    if (!m) continue
    const h = Number(m[1])
    const min = Number(m[2] ?? 0)
    if (h < 24 && min < 60) seen.add(h * 60 + min)
  }
  return [...seen].sort((a, b) => a - b).map((x) => [Math.floor(x / 60), x % 60])
}

/** Các khung giờ (ms UTC) theo thứ tự thời gian, bắt đầu từ `from` */
export function* slots(cfg: Pick<AutoConfig, 'tz_offset' | 'times' | 'weekdays'>, from: number) {
  const times = parseTimes(cfg.times)
  if (!times.length || !cfg.weekdays) return
  const off = cfg.tz_offset * 60_000
  const local = new Date(from + off) // ngày theo múi giờ đã chọn (đọc bằng getUTC*)
  for (let d = 0; d <= HORIZON_DAYS; d++) {
    const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + d))
    if (!cfg.weekdays.includes(String(day.getUTCDay()))) continue
    for (const [h, m] of times) {
      const t = day.getTime() + (h * 60 + m) * 60_000 - off
      if (t >= from) yield t
    }
  }
}

const minuteKey = (ms: number) => Math.floor(ms / 60_000)

/** Lập kế hoạch và (nếu không phải dryRun) đặt lịch lên YouTube cho một kênh */
export async function runForChannel(env: GEnv, ch: ChannelRow, cfg: AutoConfig, dryRun: boolean): Promise<RunResult> {
  const result: RunResult = { at: new Date().toISOString(), dryRun, drafts: 0, skipped: [], items: [] }
  try {
    const token = await accessToken(env, ch)
    // Danh sách "Video tải lên" của kênh: UCxxxx → UUxxxx
    const uploads = ch.channel_id.replace(/^UC/, 'UU')
    const videos: Video[] = []
    let pageToken = ''
    for (let i = 0; i < SCAN_PAGES; i++) {
      const list = await apiFetch<{ items?: { contentDetails: { videoId: string } }[]; nextPageToken?: string }>(token, 'playlistItems', {
        part: 'contentDetails',
        playlistId: uploads,
        maxResults: '50',
        ...(pageToken ? { pageToken } : {}),
      })
      const ids = (list.items ?? []).map((x) => x.contentDetails.videoId)
      if (ids.length) {
        const v = await apiFetch<{ items?: Video[] }>(token, 'videos', { part: 'snippet,status', id: ids.join(',') })
        videos.push(...(v.items ?? []))
      }
      pageToken = list.nextPageToken ?? ''
      if (!pageToken) break
    }

    // Khung giờ đã có video hẹn đăng → không xếp trùng
    const taken = new Set(videos.filter((v) => v.status.publishAt).map((v) => minuteKey(Date.parse(v.status.publishAt!))))

    // Video từng bị YouTube từ chối đặt lịch → không thử lại (xoá dòng nhật ký để thử lại)
    const { results: failed } = await env.DB.prepare('SELECT DISTINCT video_id FROM youtube_autoschedule_log WHERE channel_id = ? AND ok = 0')
      .bind(cfg.channel_id)
      .all<{ video_id: string }>()
    const failedIds = new Set(failed.map((r) => r.video_id))

    const now = Date.now()
    const marker = cfg.skip_marker.trim().toLowerCase()
    const drafts: Video[] = []
    for (const v of videos) {
      const s = v.status
      if (s.privacyStatus !== 'private' || s.publishAt) continue
      const skip = (reason: string) => result.skipped.push({ videoId: v.id, title: v.snippet.title, reason })
      if (s.uploadStatus && !['uploaded', 'processed'].includes(s.uploadStatus)) skip(`Video lỗi xử lý (${s.uploadStatus})`)
      else if (marker && v.snippet.title.toLowerCase().includes(marker)) skip(`Tiêu đề có chữ “${cfg.skip_marker}”`)
      else if (failedIds.has(v.id)) skip('YouTube đã từ chối trước đó (xem nhật ký)')
      else if (now - Date.parse(v.snippet.publishedAt) < cfg.min_age_min * 60_000) skip(`Mới tải lên chưa đủ ${cfg.min_age_min} phút`)
      else drafts.push(v)
    }
    result.drafts = drafts.length
    drafts.sort((a, b) => {
      const d = Date.parse(a.snippet.publishedAt) - Date.parse(b.snippet.publishedAt)
      return cfg.order_by === 'newest' ? -d : d
    })

    const gen = slots(cfg, now + Math.max(cfg.lead_hours, 0) * 3600_000 + 5 * 60_000)
    for (const v of drafts.slice(0, Math.max(1, cfg.max_per_run))) {
      // Gọi next() thủ công: break trong for…of sẽ đóng generator
      let t: number | undefined
      for (let n = gen.next(); !n.done; n = gen.next()) {
        if (!taken.has(minuteKey(n.value))) {
          t = n.value
          break
        }
      }
      if (t == null) {
        result.error = 'Hết khung giờ trống trong 120 ngày tới — hãy thêm khung giờ.'
        break
      }
      taken.add(minuteKey(t))
      result.items.push({ videoId: v.id, title: v.snippet.title, publishAt: new Date(t).toISOString() })
    }
    if (dryRun) return result

    const byId = new Map(drafts.map((v) => [v.id, v]))
    for (const it of result.items) {
      const s = byId.get(it.videoId)!.status
      const status = {
        privacyStatus: 'private',
        publishAt: it.publishAt,
        ...(s.embeddable != null ? { embeddable: s.embeddable } : {}),
        ...(s.license ? { license: s.license } : {}),
        ...(s.publicStatsViewable != null ? { publicStatsViewable: s.publicStatsViewable } : {}),
        selfDeclaredMadeForKids: s.selfDeclaredMadeForKids ?? s.madeForKids ?? false,
        ...(s.containsSyntheticMedia != null ? { containsSyntheticMedia: s.containsSyntheticMedia } : {}),
      }
      let quota = false
      try {
        const r = await apiFetch<Video>(token, 'videos', { part: 'status' }, {
          method: 'PUT',
          body: JSON.stringify({ id: it.videoId, status }),
          headers: { 'Content-Type': 'application/json' },
        })
        it.ok = !!r.status?.publishAt
        if (!it.ok) it.error = 'YouTube không nhận lịch (video có thể bị khoá Riêng tư vì ứng dụng chưa qua audit)'
      } catch (e) {
        it.ok = false
        it.error = (e as Error).message
        quota = /hạn mức/.test(it.error)
      }
      // Hết hạn mức thì không ghi là "bị từ chối" để lần sau thử lại
      if (quota) {
        result.error = it.error
        result.items = result.items.filter((x) => x.ok !== undefined)
        break
      }
      await env.DB.prepare('INSERT INTO youtube_autoschedule_log (channel_id, video_id, title, publish_at, ok, error) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(cfg.channel_id, it.videoId, it.title.slice(0, 200), it.publishAt, it.ok ? 1 : 0, it.error ?? '')
        .run()
    }
  } catch (e) {
    result.error = (e as Error).message
  }
  if (!dryRun) {
    await env.DB.prepare('UPDATE youtube_autoschedule SET last_run = ? WHERE channel_id = ?')
      .bind(JSON.stringify({ at: result.at, drafts: result.drafts, scheduled: result.items.filter((x) => x.ok).length, failed: result.items.filter((x) => x.ok === false).length, error: result.error }), cfg.channel_id)
      .run()
  }
  return result
}

/** Cron: chạy cho mọi kênh đã bật tự động đặt lịch */
export async function runAutoSchedule(env: GEnv) {
  const { results: configs } = await env.DB.prepare('SELECT * FROM youtube_autoschedule WHERE enabled = 1').all<AutoConfig>()
  const out = []
  for (const cfg of configs) {
    const ch = await getChannel(env.DB, cfg.channel_id)
    if (!ch || ch.status !== 'ok') continue
    const r = await runForChannel(env, ch, cfg, false)
    out.push({ channel: ch.title, scheduled: r.items.filter((x) => x.ok).length, error: r.error })
  }
  return out
}
