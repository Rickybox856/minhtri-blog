import { Hono } from 'hono'
import { marked } from 'marked'
import type { PageInput } from '../../lib/admin-db'
import {
  adminCreatePage,
  adminDeletePage,
  adminGetPage,
  adminListPages,
  adminUpdatePage,
  isUniqueError,
} from '../../lib/admin-db'
import { formatDate } from '../../lib/format'
import { isValidSlug, slugify } from '../../lib/slug'
import { AdminShell, Badge, DeleteButton, parseId, readForm } from './ui'

const app = new Hono<{ Bindings: CloudflareBindings }>()
const BASE = '/quan-tri/trang'

// Đường dẫn đã có chức năng riêng, trang tĩnh không được dùng
const RESERVED = new Set([
  'bai-viet', 'chu-de', 'san-pham', 'lien-he', 'quan-tri', 'media', 'mua', 'css',
  'sitemap-xml', 'robots-txt', 'favicon-ico', 'favicon-svg',
])

type FormValues = Partial<Omit<PageInput, 'content_html'>> & { id?: number }

const PageForm = ({ values }: { values: FormValues }) => (
  <form method="post" action={values.id ? `${BASE}/${values.id}` : `${BASE}/moi`} class="form admin-form-wide">
    <div class="form-row">
      <label>
        Tiêu đề
        <input name="title" required maxlength={150} value={values.title ?? ''} />
      </label>
      <label>
        Đường dẫn — trang sẽ ở /&lt;slug&gt;
        <input name="slug" value={values.slug ?? ''} placeholder="Để trống sẽ tạo từ tiêu đề" pattern="[a-z0-9]+(-[a-z0-9]+)*" />
      </label>
    </div>
    <label>
      Mô tả ngắn (hiện trên Google)
      <textarea name="description" rows={2} maxlength={300}>
        {values.description ?? ''}
      </textarea>
    </label>
    <label>
      Nội dung (Markdown; có thể chèn HTML, vd. &lt;h2 id="tac-gia"&gt;)
      <textarea name="content_md" rows={24} class="markdown-input">
        {values.content_md ?? ''}
      </textarea>
    </label>
    <div class="form-row">
      <label>
        Thứ tự (số nhỏ đứng trước)
        <input name="sort_order" type="number" value={String(values.sort_order ?? 0)} />
      </label>
      <div class="checkbox-group">
        <label class="checkbox">
          <input type="checkbox" name="published" checked={values.published === 1} /> Xuất bản
        </label>
        <label class="checkbox">
          <input type="checkbox" name="show_in_menu" checked={values.show_in_menu === 1} /> Hiện trên menu
        </label>
        <label class="checkbox">
          <input type="checkbox" name="show_in_footer" checked={values.show_in_footer === 1} /> Hiện ở chân trang
        </label>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn" type="submit">
        {values.id ? 'Lưu thay đổi' : 'Tạo trang'}
      </button>
      <a href={BASE}>Huỷ</a>
    </div>
  </form>
)

async function parsePageForm(req: Parameters<typeof readForm>[0]) {
  const f = await readForm(req)
  const title = f.s('title')
  const content_md = f.text('content_md')
  const values: PageInput = {
    title,
    slug: f.s('slug') || slugify(title),
    description: f.s('description'),
    content_md,
    content_html: '',
    published: f.bool('published'),
    show_in_menu: f.bool('show_in_menu'),
    show_in_footer: f.bool('show_in_footer'),
    sort_order: f.int('sort_order'),
  }
  let error: string | undefined
  if (!title) error = 'Vui lòng nhập tiêu đề.'
  else if (!isValidSlug(values.slug)) error = 'Đường dẫn chỉ gồm chữ thường không dấu, số và dấu gạch ngang.'
  else if (RESERVED.has(values.slug)) error = `Đường dẫn "${values.slug}" đã được site dùng cho chức năng khác.`
  if (!error) values.content_html = await marked.parse(content_md)
  return { values, error }
}

app.get('/', async (c) => {
  const pages = await adminListPages(c.env.DB)
  return c.render(
    <AdminShell
      title="Trang"
      active={BASE}
      flash={c.req.query('ok')}
      actions={
        <a class="btn" href={`${BASE}/moi`}>
          + Thêm trang
        </a>
      }
    >
      <table class="admin-table">
        <thead>
          <tr>
            <th>Tiêu đề</th>
            <th>Trạng thái</th>
            <th>Menu</th>
            <th>Chân trang</th>
            <th>Cập nhật</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pages.map((p) => (
            <tr>
              <td>
                <a href={`${BASE}/${p.id}`}>
                  <strong>{p.title}</strong>
                </a>
                <div class="muted">/{p.slug}</div>
              </td>
              <td>
                <Badge on={p.published} yes="Xuất bản" no="Ẩn" />
              </td>
              <td>{p.show_in_menu ? '✔' : ''}</td>
              <td>{p.show_in_footer ? '✔' : ''}</td>
              <td>{formatDate(p.updated_at)}</td>
              <td class="row-actions">
                <a href={`${BASE}/${p.id}`}>Sửa</a>
                {p.published === 1 && (
                  <a href={`/${p.slug}`} target="_blank" rel="noopener">
                    Xem
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminShell>,
    { title: 'Quản trị: Trang', noindex: true }
  )
})

app.get('/moi', (c) =>
  c.render(
    <AdminShell title="Thêm trang" active={BASE}>
      <PageForm values={{ published: 1 }} />
    </AdminShell>,
    { title: 'Thêm trang', noindex: true }
  )
)

app.post('/moi', async (c) => {
  const { values, error } = await parsePageForm(c.req)
  const fail = (msg: string) => {
    c.status(400)
    return c.render(
      <AdminShell title="Thêm trang" active={BASE} error={msg}>
        <PageForm values={values} />
      </AdminShell>,
      { title: 'Thêm trang', noindex: true }
    )
  }
  if (error) return fail(error)
  try {
    await adminCreatePage(c.env.DB, values)
    return c.redirect(`${BASE}?ok=created`, 303)
  } catch (err) {
    if (isUniqueError(err)) return fail(`Đường dẫn "${values.slug}" đã có trang khác dùng.`)
    throw err
  }
})

app.get('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  const page = id && (await adminGetPage(c.env.DB, id))
  if (!page) return c.notFound()
  return c.render(
    <AdminShell
      title="Sửa trang"
      active={BASE}
      flash={c.req.query('ok')}
      actions={
        <>
          {page.published === 1 && (
            <a class="btn btn-outline" href={`/${page.slug}`} target="_blank" rel="noopener">
              Xem trên site
            </a>
          )}
          <DeleteButton action={`${BASE}/${page.id}/xoa`} label={`trang "${page.title}"`} />
        </>
      }
    >
      <PageForm values={page} />
    </AdminShell>,
    { title: `Sửa: ${page.title}`, noindex: true }
  )
})

app.post('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id || !(await adminGetPage(c.env.DB, id))) return c.notFound()
  const { values, error } = await parsePageForm(c.req)
  const fail = (msg: string) => {
    c.status(400)
    return c.render(
      <AdminShell title="Sửa trang" active={BASE} error={msg}>
        <PageForm values={{ ...values, id }} />
      </AdminShell>,
      { title: 'Sửa trang', noindex: true }
    )
  }
  if (error) return fail(error)
  try {
    await adminUpdatePage(c.env.DB, id, values)
    return c.redirect(`${BASE}/${id}?ok=saved`, 303)
  } catch (err) {
    if (isUniqueError(err)) return fail(`Đường dẫn "${values.slug}" đã có trang khác dùng.`)
    throw err
  }
})

app.post('/:id/xoa', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id) await adminDeletePage(c.env.DB, id)
  return c.redirect(`${BASE}?ok=deleted`, 303)
})

export default app
