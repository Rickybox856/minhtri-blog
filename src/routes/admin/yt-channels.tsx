import { Hono } from 'hono'
import type { Context } from 'hono'
import { decrypt } from '../../lib/crypto'
import { accessToken, apiFetch, authUrl, getChannel, getOAuthConfig, OAUTH_CALLBACK_PATH, saveOAuthConfig } from '../../lib/google'
import type { ChannelRow, GEnv } from '../../lib/google'
import { normalizeTags, seoChecks, suggestSeo } from '../../lib/youtube-seo'
import { AdminShell, Badge, parseId } from './ui'

// /quan-tri/kenh-youtube: kết nối kênh YouTube (Google OAuth), xem video, sửa tiêu đề/mô tả/tag + gợi ý SEO, tải video lên.
const app = new Hono<{ Bindings: CloudflareBindings }>()
const BASE = '/quan-tri/kenh-youtube'
type C = Context<{ Bindings: CloudflareBindings }>
const genv = (c: C) => c.env as unknown as GEnv
const origin = (c: C) => new URL(c.req.url).origin

const CATEGORIES: [string, string][] = [
  ['22', 'Con người & Blog (People & Blogs)'],
  ['27', 'Giáo dục (Education)'],
  ['24', 'Giải trí (Entertainment)'],
  ['25', 'Tin tức & Chính trị (News & Politics)'],
  ['26', 'Hướng dẫn & Phong cách (Howto & Style)'],
  ['10', 'Âm nhạc (Music)'],
]
const PRIVACY: [string, string][] = [
  ['private', 'Riêng tư'],
  ['unlisted', 'Không công khai (ai có link mới xem được)'],
  ['public', 'Công khai'],
]

app.use('*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
})

const fmt = (n?: string | number) => (n == null ? '—' : Number(n).toLocaleString('vi-VN'))

// --- Trang chính: cấu hình + danh sách kênh ---

app.get('/', async (c) => {
  const [cfg, { results: channels }] = await Promise.all([
    getOAuthConfig(genv(c)).catch(() => null),
    c.env.DB.prepare('SELECT * FROM youtube_channels ORDER BY id').all<ChannelRow>(),
  ])
  const clientId = cfg?.clientId ?? ''
  const redirectUri = origin(c) + OAUTH_CALLBACK_PATH
  const msg = c.req.query('ok')
  const err = c.req.query('err')

  return c.render(
    <AdminShell title="Liên kết kênh YouTube" active={BASE} error={err}>
      {msg === 'connected' && <p class="notice success">Đã kết nối kênh “{c.req.query('name')}”.</p>}
      {msg === 'config' && <p class="notice success">Đã lưu cấu hình Google. Giờ bấm nút ở Bước 2 để đăng nhập kênh.</p>}
      {msg === 'removed' && <p class="notice success">Đã ngắt kết nối kênh.</p>}

      <section class="yt-steps">
        <p class="lead">Liên kết kênh YouTube để quản lý video, sửa SEO và tải video lên ngay trên website. Chỉ cần làm 2 bước:</p>
        <ol class="yt-step-list">
          <li class={cfg ? 'done' : 'todo'}>
            <strong>Bước 1 — Cấu hình Google {cfg ? '✅ Đã xong' : '(làm một lần, ~10 phút)'}</strong>
            <span>{cfg ? 'Đã lưu Client ID và Client secret.' : 'Tạo Client ID / Client secret trong Google Cloud rồi dán vào ô bên dưới.'}</span>
            {!cfg && <a class="btn btn-outline" href="#buoc-1">Làm bước 1 ↓</a>}
          </li>
          <li class={channels.length ? 'done' : 'todo'}>
            <strong>Bước 2 — Đăng nhập Google và chọn kênh {channels.length ? `✅ Đã liên kết ${channels.length} kênh` : ''}</strong>
            <span>Bấm nút, đăng nhập tài khoản Google sở hữu kênh, chọn kênh và bấm “Cho phép”. Lặp lại để liên kết thêm kênh.</span>
            {cfg ? (
              <a class="btn yt-connect" href={`${BASE}/ket-noi`}>🔗 Đăng nhập & liên kết kênh YouTube</a>
            ) : (
              <span class="btn yt-connect disabled" title="Làm bước 1 trước">🔗 Đăng nhập & liên kết kênh YouTube (làm bước 1 trước)</span>
            )}
          </li>
        </ol>
      </section>

      <h2>Kênh đã liên kết</h2>
      {channels.length ? (
        <div class="yt-channel-list">
          {channels.map((ch) => (
            <a class="card yt-channel" href={`${BASE}/${ch.id}`}>
              {ch.thumbnail && <img src={ch.thumbnail} alt="" width="48" height="48" />}
              <span>
                <strong>{ch.title}</strong>
                <Badge on={ch.status === 'ok'} yes="Đang kết nối" no="Cần kết nối lại" />
              </span>
            </a>
          ))}
        </div>
      ) : (
        <p class="muted">Chưa liên kết kênh nào.</p>
      )}

      <h2 id="buoc-1">Bước 1 — Cấu hình Google (làm một lần)</h2>
      <details class="yt-guide" open={!cfg}>
        <summary>Hướng dẫn tạo Client ID / Client secret</summary>
        <ol>
          <li>
            Vào <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a>, chọn (hoặc tạo) một
            project.
          </li>
          <li>
            <b>APIs &amp; Services → Library</b>: tìm <b>YouTube Data API v3</b> → <b>Enable</b>.
          </li>
          <li>
            <b>APIs &amp; Services → OAuth consent screen</b> (giao diện mới tên là <b>Google Auth Platform</b>, menu bên trái có Branding /
            Audience / Clients / Data Access):
            <ul>
              <li><b>Branding</b>: điền tên ứng dụng và email.</li>
              <li>
                <b>Audience</b>: chọn <b>External</b>, rồi bấm <b>Publish app</b> (chuyển sang <b>In production</b>) — nếu để “Testing”,
                Google tự ngắt kết nối sau 7 ngày. Nếu vẫn để “Testing” thì phải thêm email Google của bạn ở mục{' '}
                <b>Test users → Add users</b>, nếu không sẽ gặp lỗi <code>Error 403: access_denied</code> (“has not completed the
                Google verification process”).
              </li>
              <li>
                <b>Data Access</b> (Scopes) — <i>không bắt buộc</i>: <b>Add or remove scopes</b> → tick <code>.../auth/youtube.force-ssl</code>.
                Không thấy thì bỏ qua, website tự xin quyền khi liên kết.
              </li>
            </ul>
          </li>
          <li>
            <b>Clients → Create client</b> (giao diện cũ: <b>Credentials → Create credentials → OAuth client ID</b>), loại{' '}
            <b>Web application</b>. Ở <b>Authorized redirect URIs</b> dán đúng địa chỉ:
            <br />
            <code class="temp-pass">{redirectUri}</code>
          </li>
          <li>Bấm Create, copy <b>Client ID</b> và <b>Client secret</b> dán vào ô bên dưới.</li>
          <li>
            Khi kết nối, Google sẽ báo “ứng dụng chưa được xác minh” — đây là ứng dụng của chính bạn, bấm <b>Advanced → Go to … (unsafe)</b>{' '}
            để tiếp tục.
          </li>
        </ol>
      </details>
      <form method="post" action={`${BASE}/cau-hinh`} class="form">
        <label>
          Client ID
          <input name="client_id" value={clientId} required placeholder="xxxxxxxx.apps.googleusercontent.com" />
        </label>
        <label>
          Client secret
          <input name="client_secret" type="password" autocomplete="off" placeholder={cfg ? 'Đã lưu — để trống nếu không đổi' : 'GOCSPX-…'} required={!cfg} />
        </label>
        <button class="btn btn-outline" type="submit">Lưu cấu hình</button>
      </form>
      <p class="muted yt-note">
        ⚠️ Lưu ý của Google: video tải lên qua API từ ứng dụng <b>chưa qua kiểm duyệt (audit)</b> của YouTube sẽ bị khoá ở chế độ{' '}
        <b>Riêng tư</b>. Sửa tiêu đề/mô tả/tag của video có sẵn không bị ảnh hưởng. Muốn mở khoá, gửi{' '}
        <a href="https://support.google.com/youtube/contact/yt_api_form" target="_blank" rel="noopener">
          YouTube API Services Audit form
        </a>
        . Hạn mức miễn phí 10.000 đơn vị/ngày: sửa một video tốn ~50, tải lên một video tốn nhiều hơn (khoảng 1.600).
      </p>
    </AdminShell>,
    { title: 'Quản trị: Kênh YouTube', noindex: true }
  )
})

app.post('/cau-hinh', async (c) => {
  const f = await c.req.parseBody()
  const clientId = String(f.client_id ?? '').trim()
  const secret = String(f.client_secret ?? '').trim()
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId))
    return c.redirect(`${BASE}?err=${encodeURIComponent('Client ID không đúng định dạng (…apps.googleusercontent.com).')}`, 303)
  try {
    await saveOAuthConfig(genv(c), clientId, secret || undefined)
  } catch (e) {
    return c.redirect(`${BASE}?err=${encodeURIComponent(String((e as Error).message))}`, 303)
  }
  return c.redirect(`${BASE}?ok=config`, 303)
})

app.get('/ket-noi', async (c) => {
  try {
    return c.redirect(await authUrl(genv(c), origin(c)))
  } catch (e) {
    return c.redirect(`${BASE}?err=${encodeURIComponent((e as Error).message)}`, 303)
  }
})

// --- Một kênh ---

async function loadChannel(c: C) {
  const id = parseId(c.req.param('id') ?? '')
  return id ? getChannel(c.env.DB, id) : null
}

type VideoItem = {
  id: string
  snippet: { title: string; description: string; tags?: string[]; categoryId: string; publishedAt: string; defaultLanguage?: string; defaultAudioLanguage?: string; thumbnails?: { medium?: { url: string } } }
  status: { privacyStatus: string; uploadStatus?: string; embeddable?: boolean; license?: string; publicStatsViewable?: boolean; selfDeclaredMadeForKids?: boolean; madeForKids?: boolean }
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
}

const ErrorPage = (c: C, ch: ChannelRow | null, e: unknown) =>
  c.render(
    <AdminShell title={ch?.title ?? 'Kênh YouTube'} active={BASE} error={String((e as Error).message ?? e)}>
      <p>
        {ch && <a class="btn" href={`${BASE}/ket-noi`}>Kết nối lại kênh</a>} <a href={BASE}>← Danh sách kênh</a>
      </p>
    </AdminShell>,
    { title: 'Quản trị: Kênh YouTube', noindex: true }
  )

app.get('/:id', async (c) => {
  const ch = await loadChannel(c)
  if (!ch) return c.notFound()
  try {
    const token = await accessToken(genv(c), ch)
    const info = await apiFetch<{ items?: { statistics: { subscriberCount?: string; viewCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean }; contentDetails: { relatedPlaylists: { uploads: string } } }[] }>(
      token,
      'channels',
      { part: 'statistics,contentDetails', id: ch.channel_id }
    )
    const stats = info.items?.[0]?.statistics
    const uploads = info.items?.[0]?.contentDetails.relatedPlaylists.uploads
    let videos: VideoItem[] = []
    if (uploads) {
      const list = await apiFetch<{ items?: { contentDetails: { videoId: string } }[] }>(token, 'playlistItems', {
        part: 'contentDetails',
        playlistId: uploads,
        maxResults: '25',
      })
      const ids = (list.items ?? []).map((i) => i.contentDetails.videoId)
      if (ids.length) {
        // Danh sách tải lên có cả video riêng tư khi dùng quyền của chủ kênh
        const v = await apiFetch<{ items?: VideoItem[] }>(token, 'videos', { part: 'snippet,status,statistics', id: ids.join(',') })
        const byId = new Map((v.items ?? []).map((x) => [x.id, x]))
        videos = ids.map((i) => byId.get(i)).filter((x): x is VideoItem => !!x)
      }
    }

    return c.render(
      <AdminShell
        title={ch.title}
        active={BASE}
        flash={c.req.query('ok') === 'saved' ? 'saved' : undefined}
        actions={<a class="btn" href={`${BASE}/${ch.id}/tai-len`}>⬆ Tải video lên</a>}
      >
        {c.req.query('ok') === 'video' && <p class="notice success">Đã lưu thay đổi video lên YouTube.</p>}
        <div class="yt-stats">
          <div class="card"><strong>{stats?.hiddenSubscriberCount ? 'Ẩn' : fmt(stats?.subscriberCount)}</strong><span>Người đăng ký</span></div>
          <div class="card"><strong>{fmt(stats?.viewCount)}</strong><span>Lượt xem</span></div>
          <div class="card"><strong>{fmt(stats?.videoCount)}</strong><span>Video</span></div>
        </div>

        <h2>Video mới nhất</h2>
        <table class="admin-table yt-videos">
          <thead>
            <tr>
              <th></th>
              <th>Tiêu đề</th>
              <th>Trạng thái</th>
              <th>Lượt xem</th>
              <th>SEO</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {videos.map((v) => {
              const seo = seoChecks({ title: v.snippet.title, description: v.snippet.description, tags: v.snippet.tags ?? [] })
              return (
                <tr>
                  <td>{v.snippet.thumbnails?.medium && <img src={v.snippet.thumbnails.medium.url} alt="" width="120" loading="lazy" />}</td>
                  <td>
                    <a href={`${BASE}/${ch.id}/video/${v.id}`}><strong>{v.snippet.title}</strong></a>
                    <div class="muted">{v.snippet.publishedAt.slice(0, 10)}</div>
                  </td>
                  <td>{PRIVACY.find(([k]) => k === v.status.privacyStatus)?.[1].split(' (')[0] ?? v.status.privacyStatus}</td>
                  <td>{fmt(v.statistics?.viewCount)}</td>
                  <td>
                    <span class={`seo-score ${seo.score >= 80 ? 'good' : seo.score >= 50 ? 'mid' : 'bad'}`}>{seo.score}</span>
                  </td>
                  <td class="row-actions">
                    <a href={`${BASE}/${ch.id}/video/${v.id}`}>Sửa / SEO</a>
                    <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener">Xem</a>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!videos.length && <p class="muted">Kênh chưa có video.</p>}

        <h2>Mặc định cho mô tả &amp; tag</h2>
        <form method="post" action={`${BASE}/${ch.id}/cai-dat`} class="form">
          <label>
            Đoạn cuối mô tả (thêm vào khi bấm “Gợi ý SEO”: link kênh, website, lời chào…)
            <textarea name="desc_footer" rows={4} maxlength={1500}>{ch.desc_footer}</textarea>
          </label>
          <label>
            Tag mặc định (cách nhau bởi dấu phẩy)
            <input name="default_tags" value={ch.default_tags} maxlength={400} />
          </label>
          <button class="btn btn-outline" type="submit">Lưu</button>
        </form>

        <form method="post" action={`${BASE}/${ch.id}/xoa`} class="danger-zone" onsubmit="return confirm('Ngắt kết nối kênh này khỏi trang web? (Kênh YouTube không bị ảnh hưởng)')">
          <h2>Ngắt kết nối</h2>
          <p class="muted">Xoá quyền truy cập đã lưu. Kênh và video trên YouTube không bị ảnh hưởng.</p>
          <button class="btn btn-danger" type="submit">Ngắt kết nối kênh</button>
        </form>
      </AdminShell>,
      { title: `Quản trị: ${ch.title}`, noindex: true }
    )
  } catch (e) {
    return ErrorPage(c, ch, e)
  }
})

app.post('/:id/cai-dat', async (c) => {
  const ch = await loadChannel(c)
  if (!ch) return c.notFound()
  const f = await c.req.parseBody()
  await c.env.DB.prepare('UPDATE youtube_channels SET desc_footer = ?, default_tags = ? WHERE id = ?')
    .bind(String(f.desc_footer ?? '').slice(0, 1500), String(f.default_tags ?? '').slice(0, 400), ch.id)
    .run()
  return c.redirect(`${BASE}/${ch.id}?ok=saved`, 303)
})

app.post('/:id/xoa', async (c) => {
  const ch = await loadChannel(c)
  if (!ch) return c.notFound()
  // Thu hồi quyền phía Google (bỏ qua lỗi nếu đã bị thu hồi)
  try {
    const refresh = await decrypt(genv(c).TOKEN_ENC_KEY, ch.refresh_token_enc)
    await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token: refresh }) })
  } catch {
    // không sao
  }
  await c.env.DB.prepare('DELETE FROM youtube_channels WHERE id = ?').bind(ch.id).run()
  return c.redirect(`${BASE}?ok=removed`, 303)
})

// --- Form chung: tiêu đề / mô tả / tag / danh mục / quyền xem ---

type MetaValues = { title: string; description: string; tags: string; categoryId: string; privacy: string }

const MetaFields = ({ v, suggestUrl }: { v: MetaValues; suggestUrl: string }) => {
  const seo = seoChecks({ title: v.title, description: v.description, tags: normalizeTags(v.tags.split(',')) })
  return (
    <div class="yt-meta" data-suggest-url={suggestUrl}>
      <label>
        Tiêu đề <small class="muted" data-count="title">({v.title.length}/100)</small>
        <input name="title" value={v.title} required maxlength={100} />
      </label>
      <div class="yt-suggest-bar">
        <button type="button" class="btn btn-outline" data-action="suggest">✨ Gợi ý SEO từ tiêu đề</button>
        <small class="muted">Điền mô tả, tag và gợi ý tiêu đề theo mẫu. Bạn xem lại rồi mới lưu.</small>
      </div>
      <div class="yt-title-options" hidden></div>
      <label>
        Mô tả <small class="muted" data-count="description">({v.description.length}/5000)</small>
        <textarea name="description" rows={14} maxlength={5000}>{v.description}</textarea>
      </label>
      <label>
        Tag (cách nhau bởi dấu phẩy, tổng tối đa 500 ký tự)
        <textarea name="tags" rows={3}>{v.tags}</textarea>
      </label>
      <div class="yt-row">
        <label>
          Danh mục
          <select name="category_id">
            {CATEGORIES.map(([id, name]) => (
              <option value={id} selected={id === v.categoryId}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Quyền xem
          <select name="privacy">
            {PRIVACY.map(([id, name]) => (
              <option value={id} selected={id === v.privacy}>{name}</option>
            ))}
          </select>
        </label>
      </div>
      <section class="seo-panel">
        <h3>
          Điểm SEO cơ bản: <span class={`seo-score ${seo.score >= 80 ? 'good' : seo.score >= 50 ? 'mid' : 'bad'}`} data-seo-score>{seo.score}</span>
        </h3>
        <ul data-seo-checks>
          {seo.checks.map((ch) => (
            <li class={ch.ok ? 'ok' : 'no'}>
              {ch.ok ? '✅' : '⚠️'} {ch.label}
              {!ch.ok && <small> — {ch.tip}</small>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/** JSON gợi ý SEO + chấm điểm (dùng cho nút "Gợi ý" và chấm điểm trực tiếp khi gõ) */
app.post('/:id/goi-y', async (c) => {
  const ch = await loadChannel(c)
  if (!ch) return c.notFound()
  const body = (await c.req.json().catch(() => ({}))) as { title?: string; description?: string; tags?: string; mode?: string }
  if (body.mode === 'score') {
    return c.json(seoChecks({ title: body.title ?? '', description: body.description ?? '', tags: normalizeTags((body.tags ?? '').split(',')) }))
  }
  const s = suggestSeo({ title: body.title ?? '', footer: ch.desc_footer, defaultTags: ch.default_tags })
  return c.json({ ...s, ...seoChecks({ title: s.titles[0], description: s.description, tags: s.tags }) })
})

// --- Sửa video có sẵn ---

app.get('/:id/video/:vid', async (c) => {
  const ch = await loadChannel(c)
  const vid = c.req.param('vid')
  if (!ch || !/^[\w-]{11}$/.test(vid)) return c.notFound()
  try {
    const token = await accessToken(genv(c), ch)
    const data = await apiFetch<{ items?: VideoItem[] }>(token, 'videos', { part: 'snippet,status', id: vid })
    const v = data.items?.[0]
    if (!v) return c.notFound()
    return c.render(
      <AdminShell title="Sửa video & SEO" active={BASE} error={c.req.query('err')}>
        <p>
          <a href={`${BASE}/${ch.id}`}>← {ch.title}</a> ·{' '}
          <a href={`https://www.youtube.com/watch?v=${vid}`} target="_blank" rel="noopener">Xem trên YouTube</a>
        </p>
        <form method="post" action={`${BASE}/${ch.id}/video/${vid}`} class="form yt-form">
          <MetaFields
            suggestUrl={`${BASE}/${ch.id}/goi-y`}
            v={{
              title: v.snippet.title,
              description: v.snippet.description,
              tags: (v.snippet.tags ?? []).join(', '),
              categoryId: v.snippet.categoryId,
              privacy: v.status.privacyStatus,
            }}
          />
          <div class="form-actions">
            <button class="btn" type="submit">Lưu lên YouTube</button>
            <a href={`${BASE}/${ch.id}`}>Huỷ</a>
          </div>
        </form>
        <script src="/js/yt-admin.js" defer></script>
      </AdminShell>,
      { title: 'Quản trị: Sửa video', noindex: true }
    )
  } catch (e) {
    return ErrorPage(c, ch, e)
  }
})

app.post('/:id/video/:vid', async (c) => {
  const ch = await loadChannel(c)
  const vid = c.req.param('vid')
  if (!ch || !/^[\w-]{11}$/.test(vid)) return c.notFound()
  const f = await c.req.parseBody()
  const back = `${BASE}/${ch.id}/video/${vid}`
  try {
    const token = await accessToken(genv(c), ch)
    // Lấy bản hiện tại để giữ các trường không sửa (ngôn ngữ, giấy phép, dành cho trẻ em…)
    const cur = (await apiFetch<{ items?: VideoItem[] }>(token, 'videos', { part: 'snippet,status', id: vid })).items?.[0]
    if (!cur) return c.notFound()
    const privacy = PRIVACY.some(([k]) => k === f.privacy) ? String(f.privacy) : cur.status.privacyStatus
    const body = {
      id: vid,
      snippet: {
        title: String(f.title ?? '').trim().slice(0, 100) || cur.snippet.title,
        description: String(f.description ?? '').slice(0, 5000),
        tags: normalizeTags(String(f.tags ?? '').split(/[,、\n]/)),
        categoryId: CATEGORIES.some(([k]) => k === f.category_id) ? String(f.category_id) : cur.snippet.categoryId,
        ...(cur.snippet.defaultLanguage ? { defaultLanguage: cur.snippet.defaultLanguage } : {}),
        ...(cur.snippet.defaultAudioLanguage ? { defaultAudioLanguage: cur.snippet.defaultAudioLanguage } : {}),
      },
      status: {
        privacyStatus: privacy,
        embeddable: cur.status.embeddable,
        license: cur.status.license,
        publicStatsViewable: cur.status.publicStatsViewable,
        selfDeclaredMadeForKids: cur.status.selfDeclaredMadeForKids ?? cur.status.madeForKids ?? false,
      },
    }
    await apiFetch(token, 'videos', { part: 'snippet,status' }, { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
    return c.redirect(`${BASE}/${ch.id}?ok=video`, 303)
  } catch (e) {
    return c.redirect(`${back}?err=${encodeURIComponent((e as Error).message)}`, 303)
  }
})

// --- Tải video lên (trình duyệt gửi thẳng lên YouTube, không qua máy chủ) ---

app.get('/:id/tai-len', async (c) => {
  const ch = await loadChannel(c)
  if (!ch) return c.notFound()
  return c.render(
    <AdminShell title={`Tải video lên: ${ch.title}`} active={BASE}>
      <p>
        <a href={`${BASE}/${ch.id}`}>← {ch.title}</a>
      </p>
      <p class="notice error yt-note">
        ⚠️ Nếu ứng dụng Google của bạn chưa qua kiểm duyệt (audit) của YouTube, video tải lên qua đây sẽ bị YouTube khoá ở chế độ{' '}
        <b>Riêng tư</b> dù bạn chọn gì. Tải lên tốn khoảng 1.600/10.000 đơn vị hạn mức mỗi ngày.
      </p>
      <form class="form yt-form" id="yt-upload" data-channel={String(ch.id)} data-base={`${BASE}/${ch.id}`}>
        <label>
          File video (MP4, MOV… tối đa 256 GB)
          <input type="file" name="file" accept="video/*" required />
        </label>
        <MetaFields suggestUrl={`${BASE}/${ch.id}/goi-y`} v={{ title: '', description: '', tags: '', categoryId: '22', privacy: 'private' }} />
        <label class="checkbox">
          <input type="checkbox" name="made_for_kids" /> Video dành cho trẻ em (Made for kids)
        </label>
        <div class="yt-progress" hidden>
          <progress max="100" value="0"></progress>
          <span data-progress-text>0%</span>
        </div>
        <p class="notice error" data-upload-error hidden></p>
        <div class="form-actions">
          <button class="btn" type="submit">⬆ Tải lên YouTube</button>
          <small class="muted">Giữ trang này mở cho tới khi tải xong. Mạng chập chờn sẽ tự gửi tiếp.</small>
        </div>
      </form>
      <script src="/js/yt-admin.js" defer></script>
    </AdminShell>,
    { title: 'Quản trị: Tải video lên', noindex: true }
  )
})

/** Mã truy cập ngắn hạn cho trình duyệt của quản trị viên tự tải video lên YouTube */
app.post('/:id/token', async (c) => {
  const ch = await loadChannel(c)
  if (!ch) return c.notFound()
  try {
    const token = await accessToken(genv(c), ch)
    return c.json({ token, expiresAt: ch.access_expires_at })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

app.post('/:id/da-tai-len', async (c) => {
  const ch = await loadChannel(c)
  if (!ch) return c.notFound()
  const b = (await c.req.json().catch(() => ({}))) as { videoId?: string; title?: string; privacy?: string }
  if (!b.videoId || !/^[\w-]{11}$/.test(b.videoId)) return c.json({ error: 'Thiếu mã video' }, 400)
  await c.env.DB.prepare('INSERT INTO youtube_uploads (channel_id, video_id, title, privacy) VALUES (?, ?, ?, ?)')
    .bind(ch.channel_id, b.videoId, String(b.title ?? '').slice(0, 200), String(b.privacy ?? ''))
    .run()
  return c.json({ next: `${BASE}/${ch.id}/video/${b.videoId}` })
})

export default app
