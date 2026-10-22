import { Hono } from 'hono'
import type { Context } from 'hono'
import { getChannel } from '../../lib/google'
import type { ChannelRow, GEnv } from '../../lib/google'
import { getConfig, parseTimes, runForChannel, slots } from '../../lib/yt-autoschedule'
import type { AutoConfig, RunResult } from '../../lib/yt-autoschedule'
import { AdminShell, parseId } from './ui'

// /quan-tri/kenh-youtube/:id/tu-dong-len-lich — cài đặt tự động đặt lịch đăng cho video nháp.
const app = new Hono<{ Bindings: CloudflareBindings }>()
const BASE = '/quan-tri/kenh-youtube'
type C = Context<{ Bindings: CloudflareBindings }>
const genv = (c: C) => c.env as unknown as GEnv

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const TZ: [number, string][] = [
  [540, 'Giờ Nhật (JST, UTC+9)'],
  [420, 'Giờ Việt Nam (UTC+7)'],
]

app.use('*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
})

const fmt = (iso: string | number, off: number) => {
  const d = new Date((typeof iso === 'number' ? iso : Date.parse(iso)) + off * 60_000)
  return `${WEEKDAYS[d.getUTCDay()]} ${d.toISOString().slice(0, 16).replace('T', ' ')}`
}

async function load(c: C) {
  const id = parseId(c.req.param('id') ?? '')
  const ch = id ? await getChannel(c.env.DB, id) : null
  return ch ? { ch, cfg: await getConfig(c.env.DB, ch.id) } : null
}

const Plan = ({ r, off }: { r: RunResult; off: number }) => (
  <section class="card yt-auto-plan">
    <h3>
      {r.dryRun ? '👀 Xem trước (chưa thay đổi gì trên YouTube)' : '✅ Kết quả chạy'} — {r.drafts} video nháp đủ điều kiện
    </h3>
    {r.error && <p class="notice error">{r.error}</p>}
    {r.items.length ? (
      <table class="admin-table">
        <thead>
          <tr>
            <th>Video</th>
            <th>Đăng lúc</th>
            {!r.dryRun && <th>Kết quả</th>}
          </tr>
        </thead>
        <tbody>
          {r.items.map((it) => (
            <tr>
              <td>{it.title}</td>
              <td>{fmt(it.publishAt, off)}</td>
              {!r.dryRun && <td class={it.ok ? 'yt-ok' : 'yt-fail'}>{it.ok ? '✅ Đã đặt lịch' : `❌ ${it.error ?? ''}`}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      !r.error && <p class="muted">Không có video nháp nào cần đặt lịch.</p>
    )}
    {r.drafts > r.items.length && r.items.length > 0 && (
      <p class="muted">Còn {r.drafts - r.items.length} video nháp nữa sẽ được xếp ở các lần chạy sau (mỗi giờ tối đa “số video mỗi lần”).</p>
    )}
    {r.skipped.length > 0 && (
      <details>
        <summary>{r.skipped.length} video nháp bị bỏ qua</summary>
        <ul>
          {r.skipped.map((s) => (
            <li>
              {s.title} — <span class="muted">{s.reason}</span>
            </li>
          ))}
        </ul>
      </details>
    )}
  </section>
)

const Page = async (c: C, ch: ChannelRow, cfg: AutoConfig, extra?: { result?: RunResult; ok?: string; err?: string }) => {
  const { results: log } = await c.env.DB.prepare(
    'SELECT * FROM youtube_autoschedule_log WHERE channel_id = ? ORDER BY id DESC LIMIT 30'
  )
    .bind(ch.id)
    .all<{ id: number; video_id: string; title: string; publish_at: string | null; ok: number; error: string; created_at: string }>()
  const off = cfg.tz_offset
  const next: number[] = []
  for (const t of slots(cfg, Date.now() + cfg.lead_hours * 3600_000)) {
    next.push(t)
    if (next.length >= 6) break
  }
  const last = cfg.last_run ? (JSON.parse(cfg.last_run) as { at: string; drafts: number; scheduled: number; failed: number; error?: string }) : null

  return c.render(
    <AdminShell title={`Tự động đặt lịch: ${ch.title}`} active={BASE} error={extra?.err}>
      <p>
        <a href={`${BASE}/${ch.id}`}>← {ch.title}</a> · <a href={`${BASE}/${ch.id}/hang-loat`}>Quản lý hàng loạt</a>
      </p>
      {extra?.ok === 'saved' && <p class="notice success">Đã lưu cài đặt.</p>}
      {extra?.ok === 'retry' && <p class="notice success">Video sẽ được thử đặt lịch lại ở lần chạy sau.</p>}

      <p class="lead">
        Mỗi giờ website kiểm tra các video <b>nháp</b> (Riêng tư, chưa có lịch) trong kênh và tự xếp vào khung giờ trống tiếp theo. Tới giờ, YouTube tự
        chuyển video sang <b>Công khai</b>{' '}— và website sẽ tự đăng bài giới thiệu video nếu kênh đang được theo dõi.
      </p>

      <p class={`notice ${cfg.enabled ? 'success' : 'error'}`}>
        {cfg.enabled ? '🟢 Đang BẬT' : '⚪ Đang TẮT'}
        {last &&
          ` · Lần chạy gần nhất: ${fmt(last.at, off)} — đặt lịch ${last.scheduled} video${last.failed ? `, ${last.failed} lỗi` : ''}${last.error ? ` (lỗi: ${last.error})` : ''}`}
      </p>

      {extra?.result && <Plan r={extra.result} off={off} />}

      <form method="post" action={`${BASE}/${ch.id}/tu-dong-len-lich`} class="form yt-form">
        <label class="checkbox">
          <input type="checkbox" name="enabled" checked={!!cfg.enabled} /> <b>Bật tự động đặt lịch cho kênh này</b>
        </label>
        <div class="yt-row">
          <label>
            Múi giờ
            <select name="tz_offset">
              {TZ.map(([v, n]) => (
                <option value={String(v)} selected={v === cfg.tz_offset}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            Khung giờ đăng trong ngày (cách nhau bởi dấu phẩy)
            <input name="times" value={cfg.times} required placeholder="12:00, 20:00" />
          </label>
        </div>
        <fieldset class="yt-weekdays">
          <legend>Ngày đăng trong tuần</legend>
          {WEEKDAYS.map((d, i) => (
            <label class="checkbox">
              <input type="checkbox" name="weekdays" value={String(i)} checked={cfg.weekdays.includes(String(i))} /> {d}
            </label>
          ))}
        </fieldset>
        <div class="yt-row">
          <label>
            Thứ tự
            <select name="order_by">
              <option value="oldest" selected={cfg.order_by === 'oldest'}>Video tải lên trước → đăng trước</option>
              <option value="newest" selected={cfg.order_by === 'newest'}>Video mới tải lên → đăng trước</option>
            </select>
          </label>
          <label>
            Số video tối đa mỗi lần chạy (mỗi giờ)
            <input type="number" name="max_per_run" value={String(cfg.max_per_run)} min="1" max="20" />
          </label>
        </div>
        <div class="yt-row">
          <label>
            Chỉ xếp video đã tải lên ít nhất (phút)
            <input type="number" name="min_age_min" value={String(cfg.min_age_min)} min="0" max="10080" />
            <small class="muted">Để bạn kịp sửa tiêu đề, mô tả, thumbnail trước khi video được xếp lịch.</small>
          </label>
          <label>
            Khung giờ sớm nhất cách hiện tại ít nhất (giờ)
            <input type="number" name="lead_hours" value={String(cfg.lead_hours)} min="0" max="720" />
          </label>
        </div>
        <label>
          Bỏ qua video có tiêu đề chứa
          <input name="skip_marker" value={cfg.skip_marker} maxlength={40} placeholder="[giữ]" />
          <small class="muted">Thêm chữ này vào tiêu đề video trên YouTube nếu chưa muốn đăng. Để trống = không bỏ qua video nào.</small>
        </label>

        {next.length > 0 ? (
          <p class="muted">
            Các khung giờ sắp tới: {next.map((t) => fmt(t, off)).join(' · ')} (khung đã có video hẹn đăng sẽ được bỏ qua)
          </p>
        ) : (
          <p class="notice error">Chưa có khung giờ hợp lệ — kiểm tra lại giờ (dạng 20:00) và ngày trong tuần.</p>
        )}

        <div class="form-actions">
          <button class="btn" type="submit">Lưu cài đặt</button>
          <button class="btn btn-outline" type="submit" formaction={`${BASE}/${ch.id}/tu-dong-len-lich/xem-truoc`}>
            👀 Xem trước
          </button>
          <button
            class="btn btn-outline"
            type="submit"
            formaction={`${BASE}/${ch.id}/tu-dong-len-lich/chay`}
            onclick="return confirm('Lưu cài đặt và đặt lịch ngay cho video nháp trên YouTube?')"
          >
            ▶ Lưu &amp; chạy ngay
          </button>
        </div>
        <small class="muted">“Xem trước” dùng cài đặt đang nhập (chưa lưu) và không thay đổi gì trên YouTube.</small>
      </form>

      <h2>Nhật ký</h2>
      {log.length ? (
        <table class="admin-table">
          <thead>
            <tr>
              <th>Lúc chạy</th>
              <th>Video</th>
              <th>Hẹn đăng</th>
              <th>Kết quả</th>
            </tr>
          </thead>
          <tbody>
            {log.map((l) => (
              <tr>
                <td class="muted">{fmt(l.created_at.replace(' ', 'T') + 'Z', off)}</td>
                <td>
                  <a href={`${BASE}/${ch.id}/video/${l.video_id}`}>{l.title}</a>
                </td>
                <td>{l.publish_at ? fmt(l.publish_at, off) : '—'}</td>
                <td class={l.ok ? 'yt-ok' : 'yt-fail'}>
                  {l.ok ? (
                    '✅ Đã đặt lịch'
                  ) : (
                    <>
                      ❌ {l.error}{' '}
                      <form method="post" action={`${BASE}/${ch.id}/tu-dong-len-lich/thu-lai`} class="inline-form">
                        <input type="hidden" name="video_id" value={l.video_id} />
                        <button class="btn btn-outline btn-small" type="submit">Thử lại</button>
                      </form>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="muted">Chưa có video nào được tự động đặt lịch.</p>
      )}

      <p class="muted yt-note">
        • Chỉ đặt lịch được video <b>chưa từng công khai</b>. Video YouTube từ chối sẽ không bị thử lại mỗi giờ (bấm “Thử lại” trong nhật ký).
        <br />• Mỗi lần chạy tốn khoảng 4 đơn vị hạn mức + 50 đơn vị cho mỗi video được đặt lịch (10.000 đơn vị/ngày).
        <br />• Website chỉ quét 100 video mới nhất của kênh.
      </p>
    </AdminShell>,
    { title: 'Quản trị: Tự động đặt lịch', noindex: true }
  )
}

/** Đọc cài đặt từ form (giới hạn giá trị hợp lệ) */
async function readForm(c: C, base: AutoConfig): Promise<AutoConfig> {
  const f = await c.req.parseBody({ all: true })
  const num = (v: unknown, min: number, max: number, dflt: number) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt
  }
  const wd = ([] as unknown[]).concat(f.weekdays ?? []).map(String).filter((x) => /^[0-6]$/.test(x))
  const times = parseTimes(String(f.times ?? ''))
  return {
    ...base,
    enabled: f.enabled ? 1 : 0,
    tz_offset: TZ.some(([v]) => String(v) === f.tz_offset) ? Number(f.tz_offset) : base.tz_offset,
    times: times.map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`).join(', '),
    weekdays: [...new Set(wd)].sort().join(''),
    order_by: f.order_by === 'newest' ? 'newest' : 'oldest',
    min_age_min: num(f.min_age_min, 0, 10080, 60),
    lead_hours: num(f.lead_hours, 0, 720, 2),
    max_per_run: num(f.max_per_run, 1, 20, 5),
    skip_marker: String(f.skip_marker ?? '').trim().slice(0, 40),
  }
}

const save = (db: D1Database, cfg: AutoConfig) =>
  db
    .prepare(
      `INSERT INTO youtube_autoschedule (channel_id, enabled, tz_offset, times, weekdays, order_by, min_age_min, lead_hours, max_per_run, skip_marker, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(channel_id) DO UPDATE SET enabled = excluded.enabled, tz_offset = excluded.tz_offset, times = excluded.times,
         weekdays = excluded.weekdays, order_by = excluded.order_by, min_age_min = excluded.min_age_min, lead_hours = excluded.lead_hours,
         max_per_run = excluded.max_per_run, skip_marker = excluded.skip_marker, updated_at = excluded.updated_at`
    )
    .bind(cfg.channel_id, cfg.enabled, cfg.tz_offset, cfg.times, cfg.weekdays, cfg.order_by, cfg.min_age_min, cfg.lead_hours, cfg.max_per_run, cfg.skip_marker)
    .run()

const invalid = (cfg: AutoConfig) =>
  !cfg.times ? 'Khung giờ không hợp lệ — nhập dạng 20:00 hoặc 12:00, 20:00.' : !cfg.weekdays ? 'Hãy chọn ít nhất một ngày trong tuần.' : ''

app.get('/:id/tu-dong-len-lich', async (c) => {
  const x = await load(c)
  if (!x) return c.notFound()
  return Page(c, x.ch, x.cfg, { ok: c.req.query('ok'), err: c.req.query('err') })
})

app.post('/:id/tu-dong-len-lich', async (c) => {
  const x = await load(c)
  if (!x) return c.notFound()
  const cfg = await readForm(c, x.cfg)
  const err = invalid(cfg)
  if (err) return Page(c, x.ch, { ...x.cfg, ...cfg, times: cfg.times || x.cfg.times }, { err })
  await save(c.env.DB, cfg)
  return c.redirect(`${BASE}/${x.ch.id}/tu-dong-len-lich?ok=saved`, 303)
})

app.post('/:id/tu-dong-len-lich/xem-truoc', async (c) => {
  const x = await load(c)
  if (!x) return c.notFound()
  const cfg = await readForm(c, x.cfg)
  const err = invalid(cfg)
  if (err) return Page(c, x.ch, x.cfg, { err })
  const result = await runForChannel(genv(c), x.ch, cfg, true)
  return Page(c, x.ch, cfg, { result })
})

app.post('/:id/tu-dong-len-lich/chay', async (c) => {
  const x = await load(c)
  if (!x) return c.notFound()
  const cfg = await readForm(c, x.cfg)
  const err = invalid(cfg)
  if (err) return Page(c, x.ch, x.cfg, { err })
  await save(c.env.DB, cfg)
  const result = await runForChannel(genv(c), x.ch, cfg, false)
  return Page(c, x.ch, await getConfig(c.env.DB, x.ch.id), { result })
})

app.post('/:id/tu-dong-len-lich/thu-lai', async (c) => {
  const x = await load(c)
  if (!x) return c.notFound()
  const f = await c.req.parseBody()
  await c.env.DB.prepare('DELETE FROM youtube_autoschedule_log WHERE channel_id = ? AND video_id = ? AND ok = 0')
    .bind(x.ch.id, String(f.video_id ?? ''))
    .run()
  return c.redirect(`${BASE}/${x.ch.id}/tu-dong-len-lich?ok=retry`, 303)
})

export default app
