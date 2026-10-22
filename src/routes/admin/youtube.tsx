import { Hono } from 'hono'
import { getSetting, setSettings } from '../../lib/auth'
import { formatDateTime } from '../../lib/forum'
import { fetchChannelVideosApi } from '../../lib/youtube'
import { DEFAULT_CHANNEL, getApiKey, getChannelId, isEnabled, publishExisting, runYoutubeSync } from '../../lib/youtube-sync'
import type { SyncResult } from '../../lib/youtube-sync'
import { AdminShell, Badge } from './ui'

// /quan-tri/youtube: theo dõi kênh YouTube, tự đăng bài cho video mới
const app = new Hono<{ Bindings: CloudflareBindings }>()
const BASE = '/quan-tri/youtube'

type Row = { video_id: string; title: string; status: string; post_slug: string | null; note: string; created_at: string; updated_at: string }

const STATUS: Record<string, string> = {
  posted: 'Đã đăng bài',
  skipped: 'Bỏ qua',
  baseline: 'Có từ trước',
  processing: 'Đang xử lý',
  error: 'Lỗi',
}

const RunSummary = ({ r }: { r: SyncResult }) => (
  <p class={`notice ${r.error ? 'error' : 'success'}`}>
    Lần kiểm tra gần nhất: {formatDateTime(r.at.replace('T', ' ').slice(0, 19))} (giờ Nhật)
    {r.source === 'page' && <> · nguồn: trang kênh</>}
    {r.source === 'api' && <> · nguồn: <strong>API dự phòng</strong> (trang kênh lỗi: {r.fallbackReason})</>}
    {r.source === 'oauth' && <> · nguồn: <strong>kết nối Google của kênh đã liên kết</strong> (trang kênh lỗi: {r.fallbackReason})</>} · thấy {r.found} video
    {r.baseline > 0 && <> · ghi nhận {r.baseline} video có sẵn (lần đầu, không đăng)</>}
    {r.posted.length > 0 && <> · <strong>đăng {r.posted.length} bài mới</strong></>}
    {r.skipped > 0 && <> · bỏ qua {r.skipped} bản tổng hợp</>}
    {r.pending > 0 && <> · còn {r.pending} video chờ lần sau</>}
    {!r.error && !r.posted.length && !r.baseline && <> · không có video mới</>}
    {r.error && <> · Lỗi: {r.error}</>}
  </p>
)

app.get('/', async (c) => {
  const [channel, enabled, lastRaw, { results }, apiKey] = await Promise.all([
    getChannelId(c.env.DB),
    isEnabled(c.env.DB),
    getSetting(c.env.DB, 'yt.last_run'),
    c.env.DB.prepare('SELECT * FROM youtube_videos ORDER BY created_at DESC, rowid DESC LIMIT 100').all<Row>(),
    getApiKey(c.env),
  ])
  const last = lastRaw ? (JSON.parse(lastRaw) as SyncResult) : null
  const msg = c.req.query('ok')
  const keyFromSecret = Boolean((c.env as { YOUTUBE_API_KEY?: string }).YOUTUBE_API_KEY)

  return c.render(
    <AdminShell title="Theo dõi YouTube" active={BASE}>
      <p class="lead">
        Mỗi giờ trang tự kiểm tra kênh YouTube. Video mới (trừ bản tổng hợp chỉ ghi ngày tháng) được tự viết bài giới thiệu theo mẫu
        và đăng ngay vào chuyên mục <a href="/chu-de/dong-video" target="_blank" rel="noopener">動画</a>. Bạn sửa/ẩn bài trong mục
        Bài viết như bình thường.
      </p>
      <p class="notice">
        Muốn đăng nhập kênh YouTube để quản lý video, sửa SEO và tải video lên? Vào{' '}
        <a href="/quan-tri/kenh-youtube">
          <strong>🔗 Liên kết kênh YouTube</strong>
        </a>
        .
      </p>
      {msg === 'run' && <p class="notice success">Đã kiểm tra xong. Kết quả bên dưới.</p>}
      {msg === 'posted' && <p class="notice success">Đã đăng bài cho video.</p>}
      {msg === 'saved' && <p class="notice success">Đã lưu cài đặt.</p>}
      {last ? <RunSummary r={last} /> : <p class="muted">Chưa kiểm tra lần nào.</p>}

      <div class="admin-actions yt-actions">
        <form method="post" action={`${BASE}/chay`} class="inline-form">
          <button class="btn" type="submit">🔄 Kiểm tra ngay</button>
        </form>
      </div>

      <form method="post" action={`${BASE}/cai-dat`} class="form yt-settings">
        <label class="checkbox">
          <input type="checkbox" name="enabled" checked={enabled} /> Tự động kiểm tra mỗi giờ và đăng 1 bài cho video mới nhất chưa có bài
        </label>
        <label>
          Mã kênh YouTube (bắt đầu bằng UC…)
          <input name="channel" value={channel} pattern="UC[\w-]{22}" required />
          <small class="muted">
            Mặc định: {DEFAULT_CHANNEL}. Đổi kênh thì lần kiểm tra đầu tiên chỉ ghi nhận các video đang có, không đăng hàng loạt.
          </small>
        </label>
        <label>
          API key YouTube Data API v3 (dự phòng khi không đọc được trang kênh)
          <input
            name="api_key"
            type="password"
            autocomplete="off"
            placeholder={apiKey ? `Đã lưu (…${apiKey.slice(-4)}) — để trống nếu không đổi` : 'Dán API key (bắt đầu bằng AIza…)'}
            disabled={keyFromSecret}
          />
          <small class="muted">
            {keyFromSecret
              ? 'Đang dùng key trong secret YOUTUBE_API_KEY của Worker.'
              : apiKey
                ? 'Đã có key dự phòng. Muốn xoá key, đánh dấu ô bên dưới.'
                : 'Chưa có key: nếu YouTube đổi giao diện, việc tự đăng bài sẽ tạm dừng cho tới khi có key.'}
          </small>
        </label>
        {apiKey && !keyFromSecret && (
          <label class="checkbox">
            <input type="checkbox" name="clear_key" /> Xoá API key đã lưu
          </label>
        )}
        <button class="btn btn-outline" type="submit">Lưu cài đặt</button>
      </form>

      {apiKey && (
        <form method="post" action={`${BASE}/thu-api`} class="inline-form yt-test">
          <button class="btn btn-outline" type="submit">🧪 Thử API dự phòng</button>
          <small class="muted"> Chỉ đọc danh sách video qua API (tốn 2/10.000 đơn vị hạn mức ngày), không đăng bài.</small>
        </form>
      )}
      {c.req.query('api') && <p class={`notice ${c.req.query('api') === 'ok' ? 'success' : 'error'}`}>{c.req.query('api_msg')}</p>}

      <h2>Video đã thấy</h2>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Video</th>
            <th>Trạng thái</th>
            <th>Thấy lúc</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {results.map((v) => (
            <tr>
              <td>
                <a href={`https://www.youtube.com/watch?v=${v.video_id}`} target="_blank" rel="noopener">
                  {v.title}
                </a>
                {v.note && <div class="muted">{v.note}</div>}
              </td>
              <td>
                <Badge on={v.status === 'posted'} yes={STATUS.posted} no={STATUS[v.status] ?? v.status} />
              </td>
              <td>{formatDateTime(v.created_at)}</td>
              <td class="row-actions">
                {v.status === 'posted' && v.post_slug ? (
                  <a href={`/bai-viet/${v.post_slug}`} target="_blank" rel="noopener">
                    Xem bài
                  </a>
                ) : (
                  <form method="post" action={`${BASE}/dang/${v.video_id}`} class="inline-form">
                    <button class="btn btn-outline" type="submit">
                      {v.status === 'error' || v.status === 'processing' ? 'Thử lại' : 'Đăng bài'}
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminShell>,
    { title: 'Quản trị: Theo dõi YouTube', noindex: true }
  )
})

app.post('/chay', async (c) => {
  await runYoutubeSync(c.env, { force: true })
  return c.redirect(`${BASE}?ok=run`, 303)
})

app.post('/cai-dat', async (c) => {
  const form = await c.req.parseBody()
  const channel = String(form.channel ?? '').trim()
  if (!/^UC[\w-]{22}$/.test(channel)) return c.redirect(BASE, 303)
  const changed = channel !== (await getChannelId(c.env.DB))
  const newKey = String(form.api_key ?? '').trim()
  if (newKey && !/^[\w-]{30,60}$/.test(newKey)) return c.redirect(`${BASE}?api=err&api_msg=${encodeURIComponent('API key không đúng định dạng.')}`, 303)
  await setSettings(c.env.DB, {
    'yt.enabled': form.enabled ? '1' : '0',
    'yt.channel_id': channel,
    ...(newKey ? { 'yt.api_key': newKey } : form.clear_key ? { 'yt.api_key': '' } : {}),
    // Đổi kênh: lần đầu chỉ ghi nhận, không đăng hàng loạt video cũ của kênh mới
    ...(changed ? { 'yt.baseline_done': '' } : {}),
  })
  return c.redirect(`${BASE}?ok=saved`, 303)
})

app.post('/thu-api', async (c) => {
  const key = await getApiKey(c.env)
  let api: 'ok' | 'err' = 'err'
  let msg = 'Chưa có API key.'
  if (key) {
    try {
      const videos = await fetchChannelVideosApi(await getChannelId(c.env.DB), { key })
      api = 'ok'
      msg = `API hoạt động: đọc được ${videos.length} video (đã bỏ Shorts/livestream). Mới nhất: ${videos[0]?.title ?? '—'}`
    } catch (err) {
      msg = `API lỗi: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  return c.redirect(`${BASE}?api=${api}&api_msg=${encodeURIComponent(msg.slice(0, 300))}`, 303)
})

app.post('/dang/:id', async (c) => {
  const id = c.req.param('id')
  if (!/^[\w-]{11}$/.test(id)) return c.notFound()
  // waitUntil: vẫn làm xong dù trình duyệt huỷ yêu cầu (bấm nhiều nút liên tiếp) — tránh video kẹt ở "đang xử lý"
  // Lỗi đã được ghi vào cột note của video
  const job = publishExisting(c.env, id).catch(() => null)
  c.executionCtx.waitUntil(job)
  await job
  return c.redirect(`${BASE}?ok=posted`, 303)
})

export default app
