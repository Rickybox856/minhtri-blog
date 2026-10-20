import { Hono } from 'hono'
import type { ProductInput } from '../../lib/admin-db'
import {
  adminCreateProduct,
  adminDeleteProduct,
  adminGetProduct,
  adminListProducts,
  adminUpdateProduct,
  isUniqueError,
} from '../../lib/admin-db'
import type { ProductCategory } from '../../lib/db'
import { listProductCategories } from '../../lib/db'
import { formatPrice, mediaUrl } from '../../lib/format'
import { isValidSlug, slugify } from '../../lib/slug'
import { AdminShell, Badge, DeleteButton, parseId, readForm } from './ui'

const app = new Hono<{ Bindings: CloudflareBindings }>()
const BASE = '/quan-tri/san-pham'

type FormValues = Partial<ProductInput> & { id?: number; clicks?: number }

const ProductForm = ({ values, categories }: { values: FormValues; categories: ProductCategory[] }) => (
  <form method="post" action={values.id ? `${BASE}/${values.id}` : `${BASE}/moi`} class="form admin-form-wide">
    <label>
      Tên sản phẩm
      <input name="name" required maxlength={200} value={values.name ?? ''} />
    </label>
    <div class="form-row">
      <label>
        Mã (slug) — link mua sẽ là /mua/&lt;slug&gt;
        <input name="slug" value={values.slug ?? ''} placeholder="Để trống sẽ tạo từ tên" pattern="[a-z0-9]+(-[a-z0-9]+)*" />
      </label>
      <label>
        Danh mục
        <select name="category" required>
          {categories.map((c) => (
            <option value={c.slug} selected={values.category === c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </div>
    <label>
      Mô tả ngắn (hiện trên thẻ sản phẩm; không ghi công dụng chữa bệnh)
      <textarea name="summary" rows={3} maxlength={400}>
        {values.summary ?? ''}
      </textarea>
    </label>
    <div class="form-row">
      <label>
        Giá tham khảo (đồng, để trống nếu "Liên hệ")
        <input name="price" inputmode="numeric" value={values.price != null ? String(values.price) : ''} />
      </label>
      <label>
        Thứ tự hiển thị
        <input name="sort_order" type="number" value={String(values.sort_order ?? 0)} />
      </label>
    </div>
    <label>
      Link mua (link affiliate tới trang bán hàng)
      <input name="buy_url" type="url" value={values.buy_url ?? ''} placeholder="https://s.shopee.vn/..." />
    </label>
    <label>
      Link ảnh sản phẩm (ảnh trên trang bán hàng)
      <input name="image_url" type="url" value={values.image_url ?? ''} placeholder="https://down-vn.img.susercontent.com/file/...@resize_w600_nl" />
    </label>
    <label>
      Hoặc ảnh tự tải lên (key trong R2; được ưu tiên hơn link ảnh ở trên)
      <input name="image_key" value={values.image_key ?? ''} data-preview-for="product-image-preview" />
    </label>
    <div class="upload-widget" data-mode="key" data-target="image_key">
      <input type="file" accept="image/*" />
      <span class="upload-status muted"></span>
    </div>
    <img
      id="product-image-preview"
      class="admin-thumb-lg upload-preview"
      src={values.image_key ? mediaUrl(values.image_key) : (values.image_url ?? '')}
      alt=""
      hidden={!values.image_key && !values.image_url}
    />
    <label class="checkbox">
      <input type="checkbox" name="active" checked={values.active === 1} /> Hiện trên site
    </label>
    <div class="form-actions">
      <button class="btn" type="submit">
        {values.id ? 'Lưu thay đổi' : 'Tạo sản phẩm'}
      </button>
      <a href={BASE}>Huỷ</a>
    </div>
  </form>
)

async function parseProductForm(req: Parameters<typeof readForm>[0]) {
  const f = await readForm(req)
  const name = f.s('name')
  const values: ProductInput = {
    name,
    slug: f.s('slug') || slugify(name),
    summary: f.s('summary'),
    price: f.intOrNull('price'),
    image_url: f.opt('image_url'),
    image_key: f.opt('image_key'),
    buy_url: f.opt('buy_url'),
    category: f.s('category'),
    sort_order: f.int('sort_order'),
    active: f.bool('active'),
  }
  const error = !name
    ? 'Vui lòng nhập tên sản phẩm.'
    : !isValidSlug(values.slug)
      ? 'Mã chỉ gồm chữ thường không dấu, số và dấu gạch ngang.'
      : values.buy_url && !/^https:\/\//.test(values.buy_url)
        ? 'Link mua phải bắt đầu bằng https://'
        : undefined
  return { values, error }
}

app.get('/', async (c) => {
  const products = await adminListProducts(c.env.DB)
  const totalClicks = products.reduce((sum, p) => sum + p.clicks, 0)
  return c.render(
    <AdminShell
      title="Sản phẩm"
      active={BASE}
      flash={c.req.query('ok')}
      actions={
        <a class="btn" href={`${BASE}/moi`}>
          + Thêm sản phẩm
        </a>
      }
    >
      <p class="muted">Tổng lượt bấm nút mua: {totalClicks}</p>
      <table class="admin-table">
        <thead>
          <tr>
            <th></th>
            <th>Sản phẩm</th>
            <th>Danh mục</th>
            <th>Giá</th>
            <th>Lượt bấm</th>
            <th>Trạng thái</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const image = p.image_key ? mediaUrl(p.image_key) : p.image_url
            return (
              <tr class={p.active ? undefined : 'row-muted'}>
                <td>{image && <img class="admin-thumb" src={image} alt="" loading="lazy" />}</td>
                <td>
                  <a href={`${BASE}/${p.id}`}>
                    <strong>{p.name}</strong>
                  </a>
                </td>
                <td>{p.category_name ?? <span class="muted">{p.category}</span>}</td>
                <td>{formatPrice(p.price)}</td>
                <td>{p.clicks}</td>
                <td>
                  <Badge on={p.active} yes="Đang hiện" no="Đã ẩn" />
                </td>
                <td class="row-actions">
                  <a href={`${BASE}/${p.id}`}>Sửa</a>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </AdminShell>,
    { title: 'Quản trị: Sản phẩm', noindex: true }
  )
})

app.get('/moi', async (c) => {
  const categories = await listProductCategories(c.env.DB)
  return c.render(
    <AdminShell title="Thêm sản phẩm" active={BASE}>
      <ProductForm values={{ active: 1, category: categories[0]?.slug }} categories={categories} />
    </AdminShell>,
    { title: 'Thêm sản phẩm', noindex: true }
  )
})

app.post('/moi', async (c) => {
  const { values, error } = await parseProductForm(c.req)
  const categories = await listProductCategories(c.env.DB)
  const fail = (msg: string) => {
    c.status(400)
    return c.render(
      <AdminShell title="Thêm sản phẩm" active={BASE} error={msg}>
        <ProductForm values={values} categories={categories} />
      </AdminShell>,
      { title: 'Thêm sản phẩm', noindex: true }
    )
  }
  if (error) return fail(error)
  try {
    await adminCreateProduct(c.env.DB, values)
    return c.redirect(`${BASE}?ok=created`, 303)
  } catch (err) {
    if (isUniqueError(err)) return fail(`Mã "${values.slug}" đã có sản phẩm khác dùng.`)
    throw err
  }
})

app.get('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  const product = id && (await adminGetProduct(c.env.DB, id))
  if (!product) return c.notFound()
  const categories = await listProductCategories(c.env.DB)
  return c.render(
    <AdminShell
      title="Sửa sản phẩm"
      active={BASE}
      flash={c.req.query('ok')}
      actions={<DeleteButton action={`${BASE}/${product.id}/xoa`} label={`sản phẩm "${product.name}"`} />}
    >
      <p class="muted">Lượt bấm nút mua: {product.clicks}</p>
      <ProductForm values={product} categories={categories} />
    </AdminShell>,
    { title: `Sửa: ${product.name}`, noindex: true }
  )
})

app.post('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id || !(await adminGetProduct(c.env.DB, id))) return c.notFound()
  const { values, error } = await parseProductForm(c.req)
  const categories = await listProductCategories(c.env.DB)
  const fail = (msg: string) => {
    c.status(400)
    return c.render(
      <AdminShell title="Sửa sản phẩm" active={BASE} error={msg}>
        <ProductForm values={{ ...values, id }} categories={categories} />
      </AdminShell>,
      { title: 'Sửa sản phẩm', noindex: true }
    )
  }
  if (error) return fail(error)
  try {
    await adminUpdateProduct(c.env.DB, id, values)
    return c.redirect(`${BASE}/${id}?ok=saved`, 303)
  } catch (err) {
    if (isUniqueError(err)) return fail(`Mã "${values.slug}" đã có sản phẩm khác dùng.`)
    throw err
  }
})

app.post('/:id/xoa', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id) await adminDeleteProduct(c.env.DB, id)
  return c.redirect(`${BASE}?ok=deleted`, 303)
})

export default app
