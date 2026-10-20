import { Hono } from 'hono'
import type { PostCategoryInput } from '../../lib/admin-db'
import {
  adminCreatePostCategory,
  adminDeletePostCategory,
  adminGetPostCategory,
  adminListPostCategories,
  adminUpdatePostCategory,
  isUniqueError,
} from '../../lib/admin-db'
import { isValidSlug, slugify } from '../../lib/slug'
import { AdminShell, Badge, DeleteButton, parseId, readForm } from './ui'

const app = new Hono<{ Bindings: CloudflareBindings }>()
const BASE = '/quan-tri/chuyen-muc'

type FormValues = Partial<PostCategoryInput> & { id?: number }

const CategoryForm = ({ values }: { values: FormValues }) => (
  <form method="post" action={values.id ? `${BASE}/${values.id}` : `${BASE}/moi`} class="form">
    <label>
      Tên chuyên mục
      <input name="name" required maxlength={80} value={values.name ?? ''} />
    </label>
    <label>
      Đường dẫn (slug) — trang chuyên mục sẽ là /chu-de/&lt;slug&gt;
      <input name="slug" value={values.slug ?? ''} placeholder="Để trống sẽ tạo từ tên" pattern="[a-z0-9]+(-[a-z0-9]+)*" />
    </label>
    <label>
      Mô tả (hiện dưới tiêu đề trang chuyên mục và trên Google)
      <textarea name="description" rows={3} maxlength={300}>
        {values.description ?? ''}
      </textarea>
    </label>
    <label>
      Thứ tự hiển thị trên menu (số nhỏ đứng trước)
      <input name="sort_order" type="number" value={String(values.sort_order ?? 0)} />
    </label>
    <label class="checkbox">
      <input type="checkbox" name="show_in_menu" checked={values.show_in_menu !== 0} /> Hiện trên menu và trang chủ (chỉ hiện khi
      đã có bài đăng)
    </label>
    <div class="form-actions">
      <button class="btn" type="submit">
        {values.id ? 'Lưu thay đổi' : 'Tạo chuyên mục'}
      </button>
      <a href={BASE}>Huỷ</a>
    </div>
  </form>
)

async function parseCategoryForm(req: Parameters<typeof readForm>[0]) {
  const f = await readForm(req)
  const name = f.s('name')
  const values: PostCategoryInput = {
    name,
    slug: f.s('slug') || slugify(name),
    description: f.s('description'),
    sort_order: f.int('sort_order'),
    show_in_menu: f.bool('show_in_menu'),
  }
  const error = !name
    ? 'Vui lòng nhập tên chuyên mục.'
    : !isValidSlug(values.slug)
      ? 'Đường dẫn chỉ gồm chữ thường không dấu, số và dấu gạch ngang.'
      : undefined
  return { values, error }
}

app.get('/', async (c) => {
  const categories = await adminListPostCategories(c.env.DB)
  return c.render(
    <AdminShell
      title="Chuyên mục bài viết"
      active={BASE}
      flash={c.req.query('ok')}
      error={c.req.query('err') === 'in-use' ? 'Không xoá được: chuyên mục vẫn còn bài viết. Hãy chuyển bài sang chuyên mục khác trước.' : undefined}
      actions={
        <a class="btn" href={`${BASE}/moi`}>
          + Thêm chuyên mục
        </a>
      }
    >
      <p class="muted">
        Chuyên mục tự xuất hiện trên menu và trang chủ khi đã có bài đăng (trừ khi bỏ chọn "Hiện trên menu").
      </p>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Tên</th>
            <th>Đường dẫn</th>
            <th>Số bài</th>
            <th>Thứ tự</th>
            <th>Trên menu</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => (
            <tr>
              <td>
                <a href={`${BASE}/${cat.id}`}>
                  <strong>{cat.name}</strong>
                </a>
              </td>
              <td class="muted">/chu-de/{cat.slug}</td>
              <td>{cat.post_count}</td>
              <td>{cat.sort_order}</td>
              <td>
                {!cat.show_in_menu ? (
                  <Badge on={false} yes="" no="Đã ẩn" />
                ) : cat.published_count > 0 ? (
                  <Badge on yes="Đang hiện" no="" />
                ) : (
                  <span class="muted">Chờ có bài đăng</span>
                )}
              </td>
              <td class="row-actions">
                <a href={`${BASE}/${cat.id}`}>Sửa</a>
                <a href={`/chu-de/${cat.slug}`} target="_blank" rel="noopener">
                  Xem
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminShell>,
    { title: 'Quản trị: Chuyên mục', noindex: true }
  )
})

app.get('/moi', (c) =>
  c.render(
    <AdminShell title="Thêm chuyên mục" active={BASE}>
      <CategoryForm values={{ show_in_menu: 1 }} />
    </AdminShell>,
    { title: 'Thêm chuyên mục', noindex: true }
  )
)

app.post('/moi', async (c) => {
  const { values, error } = await parseCategoryForm(c.req)
  const fail = (msg: string) => {
    c.status(400)
    return c.render(
      <AdminShell title="Thêm chuyên mục" active={BASE} error={msg}>
        <CategoryForm values={values} />
      </AdminShell>,
      { title: 'Thêm chuyên mục', noindex: true }
    )
  }
  if (error) return fail(error)
  try {
    await adminCreatePostCategory(c.env.DB, values)
    return c.redirect(`${BASE}?ok=created`, 303)
  } catch (err) {
    if (isUniqueError(err)) return fail(`Đường dẫn "${values.slug}" đã được dùng.`)
    throw err
  }
})

app.get('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  const cat = id && (await adminGetPostCategory(c.env.DB, id))
  if (!cat) return c.notFound()
  return c.render(
    <AdminShell
      title="Sửa chuyên mục"
      active={BASE}
      flash={c.req.query('ok')}
      actions={<DeleteButton action={`${BASE}/${cat.id}/xoa`} label={`chuyên mục "${cat.name}"`} />}
    >
      <p class="muted">Đổi đường dẫn thì các bài trong chuyên mục được chuyển theo, nhưng link cũ /chu-de/{cat.slug} sẽ không còn.</p>
      <CategoryForm values={cat} />
    </AdminShell>,
    { title: `Sửa: ${cat.name}`, noindex: true }
  )
})

app.post('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id || !(await adminGetPostCategory(c.env.DB, id))) return c.notFound()
  const { values, error } = await parseCategoryForm(c.req)
  const fail = (msg: string) => {
    c.status(400)
    return c.render(
      <AdminShell title="Sửa chuyên mục" active={BASE} error={msg}>
        <CategoryForm values={{ ...values, id }} />
      </AdminShell>,
      { title: 'Sửa chuyên mục', noindex: true }
    )
  }
  if (error) return fail(error)
  try {
    await adminUpdatePostCategory(c.env.DB, id, values)
    return c.redirect(`${BASE}/${id}?ok=saved`, 303)
  } catch (err) {
    if (isUniqueError(err)) return fail(`Đường dẫn "${values.slug}" đã được dùng.`)
    throw err
  }
})

app.post('/:id/xoa', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id) {
    const used = (await adminListPostCategories(c.env.DB)).find((x) => x.id === id)
    if (used && used.post_count > 0) return c.redirect(`${BASE}?err=in-use`, 303)
    await adminDeletePostCategory(c.env.DB, id)
  }
  return c.redirect(`${BASE}?ok=deleted`, 303)
})

export default app
