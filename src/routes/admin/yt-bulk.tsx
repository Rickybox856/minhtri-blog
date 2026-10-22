import { Hono } from 'hono'
import type { Context } from 'hono'
import { accessToken, apiFetch, getChannel } from '../../lib/google'
import type { GEnv } from '../../lib/google'
import { AdminShell, parseId } from './ui'

// /quan-tri/kenh-youtube/:id/hang-loat — quản lý hàng loạt: đổi chế độ hiển thị, đặt lịch đăng cho video nháp, huỷ lịch.
// Danh sách tải hết video của kênh (tối đa MAX_PAGES × 50), lọc bằng JS; thay đổi gửi theo từng đợt nhỏ (CHUNK video / request)
// để không vượt giới hạn số request con của Cloudflare Workers.
const app = new Hono<{ Bindings: CloudflareBindings }>()
const BASE = '/quan-tri/kenh-youtube'
type C = Context<{ Bindings: CloudflareBindings }>
const genv = (c: C) => c.env as unknown as GEnv

const MAX_PAGES = 20 // 1.000 video
const CHUNK = 20
const PRIVACY = ['private', 'unlisted', 'public'] as const

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
type Video = {
  id: string
  snippet: { title: string; publishedAt: string; thumbnails?: { default?: { url: string } } }
  status: Status
  statistics?: { viewCount?: string }
}

app.use('*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
})

/** Nhóm hiển thị của video: nháp = riêng tư chưa có lịch */
const kind = (s: Status) => (s.privacyStatus === 'private' ? (s.publishAt ? 'scheduled' : 'draft') : s.privacyStatus)
const KIND_LABEL: Record<string, string> = { draft: 'Nháp (riêng tư)', scheduled: 'Đã lên lịch', public: 'Công khai', unlisted: 'Không công khai' }

/** Hiển thị giờ theo múi giờ cố định (mặc định giờ Nhật); JS sẽ đổi theo múi giờ người dùng chọn */
const fmtTime = (iso: string, offsetMin = 540) => new Date(Date.parse(iso) + offsetMin * 60_000).toISOString().slice(0, 16).replace('T', ' ')

app.get('/:id/hang-loat', async (c) => {
  const id = parseId(c.req.param('id'))
  const ch = id ? await getChannel(c.env.DB, id) : null
  if (!ch) return c.notFound()
  let videos: Video[] = []
  let truncated = false
  try {
    const token = await accessToken(genv(c), ch)
    const info = await apiFetch<{ items?: { contentDetails: { relatedPlaylists: { uploads: string } } }[] }>(token, 'channels', {
      part: 'contentDetails',
      id: ch.channel_id,
    })
    const uploads = info.items?.[0]?.contentDetails.relatedPlaylists.uploads
    let pageToken = ''
    for (let i = 0; uploads && i < MAX_PAGES; i++) {
      const list = await apiFetch<{ items?: { contentDetails: { videoId: string } }[]; nextPageToken?: string }>(token, 'playlistItems', {
        part: 'contentDetails',
        playlistId: uploads,
        maxResults: '50',
        ...(pageToken ? { pageToken } : {}),
      })
      const ids = (list.items ?? []).map((x) => x.contentDetails.videoId)
      if (ids.length) {
        const v = await apiFetch<{ items?: Video[] }>(token, 'videos', { part: 'snippet,status,statistics', id: ids.join(',') })
        const byId = new Map((v.items ?? []).map((x) => [x.id, x]))
        videos.push(...ids.map((x) => byId.get(x)).filter((x): x is Video => !!x))
      }
      pageToken = list.nextPageToken ?? ''
      if (!pageToken) break
      if (i === MAX_PAGES - 1) truncated = true
    }
  } catch (e) {
    return c.render(
      <AdminShell title={ch.title} active={BASE} error={(e as Error).message}>
        <p>
          <a class="btn" href={`${BASE}/ket-noi`}>Kết nối lại kênh</a> <a href={`${BASE}/${ch.id}`}>← {ch.title}</a>
        </p>
      </AdminShell>,
      { title: 'Quản trị: Quản lý hàng loạt', noindex: true }
    )
  }

  const counts: Record<string, number> = { all: videos.length, draft: 0, scheduled: 0, public: 0, unlisted: 0 }
  for (const v of videos) counts[kind(v.status)] = (counts[kind(v.status)] ?? 0) + 1

  return c.render(
    <AdminShell title={`Quản lý hàng loạt: ${ch.title}`} active={BASE}>
      <p>
        <a href={`${BASE}/${ch.id}`}>← {ch.title}</a> · <a href={`${BASE}/${ch.id}/tu-dong-len-lich`}>⏰ Tự động đặt lịch video nháp</a>
      </p>
      {truncated && <p class="notice error">Kênh có hơn {MAX_PAGES * 50} video, trang này chỉ hiện {MAX_PAGES * 50} video mới nhất.</p>}

      <div id="yt-bulk" data-url={`${BASE}/${ch.id}/hang-loat/ap-dung`} data-chunk={String(CHUNK)}>
        <nav class="yt-tabs" role="tablist">
          {(['draft', 'scheduled', 'all', 'public', 'unlisted'] as const).map((k) => (
            <button type="button" class={k === 'draft' ? 'active' : undefined} data-filter={k}>
              {k === 'all' ? 'Tất cả' : KIND_LABEL[k]} <span class="muted">({counts[k] ?? 0})</span>
            </button>
          ))}
        </nav>

        <section class="yt-bulk-bar">
          <div class="yt-bulk-row">
            <strong data-selected-count>Đã chọn 0 video</strong>
            <label class="inline">
              Múi giờ
              <select name="tz">
                <option value="540">Giờ Nhật (JST, UTC+9)</option>
                <option value="420">Giờ Việt Nam (UTC+7)</option>
              </select>
            </label>
          </div>
          <div class="yt-bulk-row">
            <label class="inline">
              Thao tác
              <select name="action">
                <option value="schedule">📅 Đặt lịch đăng (công khai tự động)</option>
                <option value="privacy">👁 Đổi chế độ hiển thị</option>
                <option value="unschedule">✖ Huỷ lịch (giữ Riêng tư)</option>
              </select>
            </label>
            <span data-for="privacy" hidden>
              <label class="inline">
                Thành
                <select name="privacy">
                  <option value="public">Công khai</option>
                  <option value="unlisted">Không công khai</option>
                  <option value="private">Riêng tư</option>
                </select>
              </label>
            </span>
            <span data-for="schedule">
              <label class="inline">
                Bắt đầu lúc
                <input type="datetime-local" name="start" />
              </label>
              <label class="inline">
                mỗi video cách nhau
                <input type="number" name="every" value="1" min="0" max="999" />
                <select name="unit">
                  <option value="1440">ngày</option>
                  <option value="60">giờ</option>
                  <option value="1">phút</option>
                </select>
              </label>
              <label class="inline">
                Thứ tự
                <select name="order">
                  <option value="oldest">Video cũ nhất đăng trước</option>
                  <option value="newest">Video mới nhất đăng trước</option>
                </select>
              </label>
            </span>
          </div>
          <div class="yt-bulk-row">
            <button type="button" class="btn btn-outline" data-preview>Xem trước</button>
            <button type="button" class="btn" data-apply disabled>Áp dụng lên YouTube</button>
            <small class="muted" data-quota></small>
          </div>
          <p class="notice error" data-bulk-error hidden></p>
        </section>

        <table class="admin-table yt-videos yt-bulk-table">
          <thead>
            <tr>
              <th><input type="checkbox" data-check-all title="Chọn tất cả video đang hiển thị" /></th>
              <th></th>
              <th>Tiêu đề</th>
              <th>Hiện tại</th>
              <th>Sẽ đổi thành</th>
              <th>Kết quả</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((v) => {
              const k = kind(v.status)
              return (
                <tr data-id={v.id} data-kind={k} data-published={v.snippet.publishedAt} data-title={v.snippet.title}>
                  <td><input type="checkbox" data-check /></td>
                  <td>{v.snippet.thumbnails?.default && <img src={v.snippet.thumbnails.default.url} alt="" width="80" loading="lazy" />}</td>
                  <td>
                    <a href={`${BASE}/${ch.id}/video/${v.id}`}>{v.snippet.title}</a>
                    <div class="muted">
                      Tải lên {v.snippet.publishedAt.slice(0, 10)}
                      {v.status.uploadStatus && v.status.uploadStatus !== 'processed' && ` · ${v.status.uploadStatus}`}
                      {v.statistics?.viewCount && ` · ${Number(v.statistics.viewCount).toLocaleString('vi-VN')} lượt xem`}
                    </div>
                  </td>
                  <td data-current>
                    <span class={`yt-kind ${k}`}>{KIND_LABEL[k] ?? k}</span>
                    {v.status.publishAt && (
                      <div class="muted" data-time={v.status.publishAt}>
                        {fmtTime(v.status.publishAt)}
                      </div>
                    )}
                  </td>
                  <td data-plan></td>
                  <td data-result></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p class="muted" data-empty hidden>Không có video nào trong mục này.</p>
      </div>

      <p class="muted yt-note">
        • Chỉ đặt lịch được cho video <b>chưa từng công khai</b>. Tới giờ hẹn, YouTube tự chuyển video sang <b>Công khai</b>.
        <br />• Mỗi video thay đổi tốn 50 đơn vị hạn mức (10.000 đơn vị/ngày, tức khoảng 190 video/ngày). Mở trang này tốn khoảng{' '}
        {2 + Math.ceil(videos.length / 50) * 2} đơn vị.
        <br />• Video tải lên từ ứng dụng chưa qua kiểm duyệt (audit) của YouTube bị khoá ở chế độ Riêng tư, nên không đổi được.
      </p>
      <script src="/js/yt-bulk.js" defer></script>
    </AdminShell>,
    { title: 'Quản trị: Quản lý hàng loạt', noindex: true }
  )
})

type Item = { id: string; privacy: string; publishAt?: string | null }

/** Áp dụng một đợt thay đổi (tối đa CHUNK video). Trả kết quả từng video */
app.post('/:id/hang-loat/ap-dung', async (c) => {
  const id = parseId(c.req.param('id'))
  const ch = id ? await getChannel(c.env.DB, id) : null
  if (!ch) return c.json({ error: 'Không tìm thấy kênh' }, 404)
  const body = (await c.req.json().catch(() => ({}))) as { items?: Item[] }
  const items = (body.items ?? []).filter((x) => x && /^[\w-]{11}$/.test(String(x.id))).slice(0, CHUNK)
  if (!items.length) return c.json({ error: 'Chưa chọn video' }, 400)

  try {
    const token = await accessToken(genv(c), ch)
    // Lấy trạng thái hiện tại để giữ các trường không sửa (nhúng, giấy phép, dành cho trẻ em…)
    const cur = await apiFetch<{ items?: Video[] }>(token, 'videos', { part: 'status', id: items.map((x) => x.id).join(',') })
    const byId = new Map((cur.items ?? []).map((v) => [v.id, v]))
    const minTime = Date.now() + 5 * 60_000

    const results = []
    for (const it of items) {
      const v = byId.get(it.id)
      if (!v) {
        results.push({ id: it.id, ok: false, error: 'Không tìm thấy video (đã xoá?)' })
        continue
      }
      let privacy = PRIVACY.includes(it.privacy as (typeof PRIVACY)[number]) ? it.privacy : v.status.privacyStatus
      let publishAt: string | undefined
      if (it.publishAt) {
        const t = Date.parse(it.publishAt)
        if (!Number.isFinite(t) || t < minTime) {
          results.push({ id: it.id, ok: false, error: 'Giờ đăng phải sau thời điểm hiện tại ít nhất 5 phút' })
          continue
        }
        publishAt = new Date(t).toISOString()
        privacy = 'private' // YouTube chỉ nhận lịch đăng khi video đang Riêng tư
      }
      const s = v.status
      const status = {
        privacyStatus: privacy,
        ...(publishAt ? { publishAt } : {}), // không gửi publishAt = huỷ lịch
        ...(s.embeddable != null ? { embeddable: s.embeddable } : {}),
        ...(s.license ? { license: s.license } : {}),
        ...(s.publicStatsViewable != null ? { publicStatsViewable: s.publicStatsViewable } : {}),
        selfDeclaredMadeForKids: s.selfDeclaredMadeForKids ?? s.madeForKids ?? false,
        ...(s.containsSyntheticMedia != null ? { containsSyntheticMedia: s.containsSyntheticMedia } : {}),
      }
      try {
        const r = await apiFetch<Video>(token, 'videos', { part: 'status' }, {
          method: 'PUT',
          body: JSON.stringify({ id: it.id, status }),
          headers: { 'Content-Type': 'application/json' },
        })
        const kept = r.status?.privacyStatus ?? privacy
        // YouTube trả 200 nhưng vẫn giữ Riêng tư nếu video bị khoá do ứng dụng chưa audit
        const locked = kept !== privacy || (publishAt && !r.status?.publishAt)
        results.push({
          id: it.id,
          ok: !locked,
          error: locked ? 'YouTube không cho đổi (video có thể bị khoá Riêng tư vì ứng dụng chưa qua audit)' : undefined,
          privacy: kept,
          publishAt: r.status?.publishAt ?? null,
        })
      } catch (e) {
        const msg = (e as Error).message
        results.push({
          id: it.id,
          ok: false,
          error: /publishAt|publish/i.test(msg) ? `Không đặt lịch được: video này đã từng công khai, hoặc giờ không hợp lệ. (${msg})` : msg,
        })
        if (/hạn mức/.test(msg)) break // hết quota: dừng luôn
      }
    }
    return c.json({ results })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

export default app
