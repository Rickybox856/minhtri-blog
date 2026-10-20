import { Hono } from 'hono'
import { mediaUrl } from '../../lib/format'
import { slugify } from '../../lib/slug'
import { AdminShell } from './ui'

const app = new Hono<{ Bindings: CloudflareBindings }>()
const BASE = '/quan-tri/anh'

const ALLOWED: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/avif': 'avif',
}
// Ảnh đã được trình duyệt thu nhỏ trước khi gửi; giới hạn này chỉ để chặn file bất thường
const MAX_BYTES = 8 * 1024 * 1024

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

/** Snippet Markdown/HTML để chèn ảnh vào bài; luôn lưu dạng /media/... (lúc hiển thị mới đổi sang tên miền ảnh) */
const contentPath = (key: string) => `/media/${key.split('/').map(encodeURIComponent).join('/')}`

export const figureSnippet = (key: string, width?: string, height?: string) =>
  `<figure>\n  <img src="${contentPath(key)}"${width ? ` width="${width}"` : ''}${height ? ` height="${height}"` : ''} alt="" loading="lazy">\n  <figcaption>Chú thích ảnh</figcaption>\n</figure>`

// Tải ảnh lên R2: uploads/<năm>/<tháng>/<tên-file>-<ngẫu nhiên>.<đuôi>
app.post('/tai-len', async (c) => {
  const form = await c.req.parseBody()
  const file = form.file
  if (!(file instanceof File)) return c.json({ error: 'Không nhận được file ảnh.' }, 400)
  const ext = ALLOWED[file.type]
  if (!ext) return c.json({ error: 'Chỉ nhận ảnh WebP, JPEG, PNG, GIF hoặc AVIF.' }, 400)
  if (file.size > MAX_BYTES) return c.json({ error: 'Ảnh quá lớn (tối đa 8 MB).' }, 400)

  const original = typeof form.name === 'string' ? form.name : file.name
  const base = slugify(original.replace(/\.[^.]+$/, '')).slice(0, 60) || 'anh'
  const now = new Date()
  const folder = `uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const key = `${folder}/${base}-${crypto.randomUUID().slice(0, 8)}.${ext}`
  const width = typeof form.width === 'string' ? form.width.replace(/\D/g, '') : ''
  const height = typeof form.height === 'string' ? form.height.replace(/\D/g, '') : ''

  await c.env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
    customMetadata: { width, height, originalName: original.slice(0, 200) },
  })
  return c.json({ key, url: mediaUrl(key), width, height, snippet: figureSnippet(key, width, height) })
})

// Ảnh đang được dùng ở đâu (để chặn xoá nhầm)
async function findUsage(db: D1Database, key: string) {
  const like = `%${key}%`
  const [posts, pages, products, settings] = await Promise.all([
    db.prepare('SELECT title FROM posts WHERE cover_key = ? OR content_md LIKE ?').bind(key, like).all<{ title: string }>(),
    db.prepare('SELECT title FROM pages WHERE content_md LIKE ?').bind(like).all<{ title: string }>(),
    db.prepare('SELECT name AS title FROM products WHERE image_key = ?').bind(key).all<{ title: string }>(),
    db.prepare("SELECT key AS title FROM settings WHERE key LIKE 'site.%' AND value LIKE ?").bind(like).all<{ title: string }>(),
  ])
  return [
    ...posts.results.map((r) => `bài "${r.title}"`),
    ...pages.results.map((r) => `trang "${r.title}"`),
    ...products.results.map((r) => `sản phẩm "${r.title}"`),
    ...(settings.results.length ? ['Cài đặt site'] : []),
  ]
}

app.get('/', async (c) => {
  // Mặc định chỉ hiện ảnh tải lên từ trang quản trị; ?tat-ca=1 hiện cả ảnh của các bài cũ
  const all = c.req.query('tat-ca') === '1'
  const cursor = c.req.query('tiep')
  const listed = await c.env.MEDIA.list({
    prefix: all ? undefined : 'uploads/',
    limit: 200,
    cursor,
    include: ['httpMetadata', 'customMetadata'],
  })
  const objects = [...listed.objects].sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime())
  const notice = c.req.query('ok') === 'deleted' ? 'deleted' : undefined
  const blocked = c.req.query('dang-dung')

  return c.render(
    <AdminShell title="Thư viện ảnh" active={BASE} flash={notice} error={blocked ? `Không xoá được: ảnh đang được dùng ở ${blocked}.` : undefined}>
      <div class="card upload-panel">
        <p>
          <strong>Tải ảnh lên</strong>: ảnh được thu nhỏ (rộng tối đa 1600px) và chuyển sang WebP ngay trên trình duyệt
          trước khi gửi.
        </p>
        <div class="upload-widget" data-mode="library">
          <input type="file" accept="image/*" multiple />
          <span class="upload-status muted"></span>
        </div>
      </div>
      <p class="muted">
        {all ? (
          <>
            Đang hiện mọi ảnh trong kho. <a href={BASE}>Chỉ hiện ảnh tải lên từ trang quản trị</a>
          </>
        ) : (
          <>
            Đang hiện ảnh tải lên từ trang quản trị. <a href={`${BASE}?tat-ca=1`}>Hiện cả ảnh của các bài viết cũ</a>
          </>
        )}
      </p>
      <div class="media-grid">
        {objects.map((o) => {
          const meta = o.customMetadata ?? {}
          const snippet = figureSnippet(o.key, meta.width, meta.height)
          return (
            <figure class="media-item">
              <a href={mediaUrl(o.key)} target="_blank" rel="noopener">
                <img src={mediaUrl(o.key)} alt="" loading="lazy" />
              </a>
              <figcaption>
                <code>{o.key}</code>
                <span class="muted">
                  {formatSize(o.size)}
                  {meta.width && ` · ${meta.width}×${meta.height}`}
                </span>
                <span class="media-actions">
                  <button type="button" class="btn btn-outline btn-sm" data-copy={o.key}>
                    Chép key
                  </button>
                  <button type="button" class="btn btn-outline btn-sm" data-copy={snippet}>
                    Chép mã chèn
                  </button>
                  <form method="post" action={`${BASE}/xoa`} class="inline-form" onsubmit="return confirm('Xoá ảnh này? Không thể hoàn tác.')">
                    <input type="hidden" name="key" value={o.key} />
                    <button class="btn btn-danger btn-sm" type="submit">
                      Xoá
                    </button>
                  </form>
                </span>
              </figcaption>
            </figure>
          )
        })}
      </div>
      {!objects.length && <p class="empty">Chưa có ảnh nào.</p>}
      {listed.truncated && (
        <p>
          <a class="btn btn-outline" href={`${BASE}?${all ? 'tat-ca=1&' : ''}tiep=${encodeURIComponent(listed.cursor)}`}>
            Xem thêm ›
          </a>
        </p>
      )}
    </AdminShell>,
    { title: 'Quản trị: Thư viện ảnh', noindex: true }
  )
})

app.post('/xoa', async (c) => {
  const form = await c.req.parseBody()
  const key = typeof form.key === 'string' ? form.key : ''
  if (!key) return c.redirect(BASE, 303)
  const usage = await findUsage(c.env.DB, key)
  if (usage.length) return c.redirect(`${BASE}?dang-dung=${encodeURIComponent(usage.join(', '))}`, 303)
  await c.env.MEDIA.delete(key)
  return c.redirect(`${BASE}?ok=deleted`, 303)
})

export default app
