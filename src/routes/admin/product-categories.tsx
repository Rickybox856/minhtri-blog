import { Hono } from 'hono'
import type { ProductCategoryInput } from '../../lib/admin-db'
import {
  adminCreateProductCategory,
  adminDeleteProductCategory,
  adminGetProductCategory,
  adminListProductCategories,
  adminUpdateProductCategory,
  isUniqueError,
} from '../../lib/admin-db'
import { isValidSlug, slugify } from '../../lib/slug'
import { AdminShell, DeleteButton, parseId, readForm } from './ui'

const app = new Hono<{ Bindings: CloudflareBindings }>()
const BASE = '/quan-tri/danh-muc-san-pham'

type FormValues = Partial<ProductCategoryInput> & { id?: number }

const CategoryForm = ({ values }: { values: FormValues }) => (
  <form method="post" action={values.id ? `${BASE}/${values.id}` : `${BASE}/moi`} class="form">
    <label>
      Tên danh mục
      <input name="name" required maxlength={80} value={values.name ?? ''} />
    </label>
    <label>
      Mã danh mục (slug)
      <input name="slug" value={values.slug ?? ''} placeholder="Để trống sẽ tạo từ tên" pattern="[a-z0-9]+(-[a-z0-9]+)*" />
    </label>
    <label>
      Thứ tự hiển thị (số nhỏ đứng trước)
      <input name="sort_order" type="number" value={String(values.sort_order ?? 0)} />
    </label>
    <div class="form-actions">
      <button class="btn" type="submit">
        {values.id ? 'Lưu thay đổi' : 'Tạo danh mục'}
      </button>
      <a href={BASE}>Huỷ</a>
    </div>
  </form>
)

async function parseCategoryForm(req: Parameters<typeof readForm>[0]) {
  const f = await readForm(req)
  const name = f.s('name')
  const values: ProductCategoryInput = { name, slug: f.s('slug') || slugify(name), sort_order: f.int('sort_order') }
  const error = !name
    ? 'Vui lòng nhập tên danh mục.'
    : !isValidSlug(values.slug)
      ? 'Mã danh mục chỉ gồm chữ thường không dấu, số và dấu gạch ngang.'
      : undefined
  return { values, error }
}

app.get('/', async (c) => {
  const categories = await adminListProductCategories(c.env.DB)
  return c.render(
    <AdminShell
      title="Danh mục sản phẩm"
      active={BASE}
      flash={c.req.query('ok')}
      error={c.req.query('err') === 'in-use' ? 'Không xoá được: danh mục vẫn còn sản phẩm.' : undefined}
      actions={
        <a class="btn" href={`${BASE}/moi`}>
          + Thêm danh mục
        </a>
      }
    >
      <p class="muted">
        Trang Sản phẩm nhóm sản phẩm theo danh mục. Bài viết sẽ hiện "Sản phẩm liên quan" thuộc danh mục có cùng mã với
        chuyên mục của bài (vd. mat-ong).
      </p>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Tên</th>
            <th>Mã</th>
            <th>Số sản phẩm</th>
            <th>Thứ tự</th>
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
              <td class="muted">{cat.slug}</td>
              <td>{cat.product_count}</td>
              <td>{cat.sort_order}</td>
              <td class="row-actions">
                <a href={`${BASE}/${cat.id}`}>Sửa</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminShell>,
    { title: 'Quản trị: Danh mục sản phẩm', noindex: true }
  )
})

app.get('/moi', (c) =>
  c.render(
    <AdminShell title="Thêm danh mục sản phẩm" active={BASE}>
      <CategoryForm values={{}} />
    </AdminShell>,
    { title: 'Thêm danh mục sản phẩm', noindex: true }
  )
)

app.post('/moi', async (c) => {
  const { values, error } = await parseCategoryForm(c.req)
  const fail = (msg: string) => {
    c.status(400)
    return c.render(
      <AdminShell title="Thêm danh mục sản phẩm" active={BASE} error={msg}>
        <CategoryForm values={values} />
      </AdminShell>,
      { title: 'Thêm danh mục sản phẩm', noindex: true }
    )
  }
  if (error) return fail(error)
  try {
    await adminCreateProductCategory(c.env.DB, values)
    return c.redirect(`${BASE}?ok=created`, 303)
  } catch (err) {
    if (isUniqueError(err)) return fail(`Mã "${values.slug}" đã được dùng.`)
    throw err
  }
})

app.get('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  const cat = id && (await adminGetProductCategory(c.env.DB, id))
  if (!cat) return c.notFound()
  return c.render(
    <AdminShell
      title="Sửa danh mục sản phẩm"
      active={BASE}
      flash={c.req.query('ok')}
      actions={<DeleteButton action={`${BASE}/${cat.id}/xoa`} label={`danh mục "${cat.name}"`} />}
    >
      <CategoryForm values={cat} />
    </AdminShell>,
    { title: `Sửa: ${cat.name}`, noindex: true }
  )
})

app.post('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id || !(await adminGetProductCategory(c.env.DB, id))) return c.notFound()
  const { values, error } = await parseCategoryForm(c.req)
  const fail = (msg: string) => {
    c.status(400)
    return c.render(
      <AdminShell title="Sửa danh mục sản phẩm" active={BASE} error={msg}>
        <CategoryForm values={{ ...values, id }} />
      </AdminShell>,
      { title: 'Sửa danh mục sản phẩm', noindex: true }
    )
  }
  if (error) return fail(error)
  try {
    await adminUpdateProductCategory(c.env.DB, id, values)
    return c.redirect(`${BASE}/${id}?ok=saved`, 303)
  } catch (err) {
    if (isUniqueError(err)) return fail(`Mã "${values.slug}" đã được dùng.`)
    throw err
  }
})

app.post('/:id/xoa', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id) {
    const used = (await adminListProductCategories(c.env.DB)).find((x) => x.id === id)
    if (used && used.product_count > 0) return c.redirect(`${BASE}?err=in-use`, 303)
    await adminDeleteProductCategory(c.env.DB, id)
  }
  return c.redirect(`${BASE}?ok=deleted`, 303)
})

export default app
