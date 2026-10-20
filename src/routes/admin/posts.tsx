import { Hono } from 'hono'
import { marked } from 'marked'
import type { AdminPost, PostInput } from '../../lib/admin-db'
import {
  adminCreatePost,
  adminDeletePost,
  adminGetPost,
  adminGetPostProductIds,
  adminListProductChoices,
  adminListPosts,
  adminSetPostProducts,
  adminUpdatePost,
  isUniqueError,
} from '../../lib/admin-db'
import type { PostCategory, ProductCategory } from '../../lib/db'
import { listPostCategories, listProductCategories } from '../../lib/db'
import { formatDate, mediaUrl } from '../../lib/format'
import { isValidSlug, slugify } from '../../lib/slug'
import { AdminShell, Badge, DeleteButton, parseId, readForm } from './ui'

const app = new Hono<{ Bindings: CloudflareBindings }>()
const BASE = '/quan-tri/bai-viet'

type FormValues = Partial<Omit<PostInput, 'content_html'>> & { id?: number; product_ids?: number[] }
type ProductChoice = Awaited<ReturnType<typeof adminListProductChoices>>[number]
type FormData = { categories: PostCategory[]; products: ProductChoice[]; productCategories: ProductCategory[] }

const PRODUCT_PREFIX = 'product_'

// Chọn sản phẩm gợi ý cuối bài; không chọn thì tự lấy sản phẩm cùng danh mục
const ProductPicker = ({ data, selected }: { data: FormData; selected: number[] }) => {
  const name = (slug: string) => data.productCategories.find((c) => c.slug === slug)?.name ?? slug
  const groups = [...new Set(data.products.map((p) => p.category))]
  return (
    <fieldset class="admin-fieldset">
      <legend>Sản phẩm gợi ý cuối bài</legend>
      <p class="muted">
        Chọn tối đa 3 sản phẩm hợp với nội dung bài. Chọn ít hơn hoặc không chọn thì các ô còn lại tự lấy sản phẩm cùng
        danh mục với chuyên mục của bài.
      </p>
      {groups.map((g) => (
        <div class="product-picker">
          <strong>{name(g)}</strong>
          {data.products
            .filter((p) => p.category === g)
            .map((p) => (
              <label class="checkbox">
                <input type="checkbox" name={`${PRODUCT_PREFIX}${p.id}`} checked={selected.includes(p.id)} /> {p.name}
                {!p.active && <span class="muted"> (đang ẩn)</span>}
              </label>
            ))}
        </div>
      ))}
      {!data.products.length && <p class="muted">Chưa có sản phẩm nào.</p>}
    </fieldset>
  )
}

async function loadFormData(db: D1Database): Promise<FormData> {
  const [categories, products, productCategories] = await Promise.all([
    listPostCategories(db),
    adminListProductChoices(db),
    listProductCategories(db),
  ])
  return { categories, products, productCategories }
}

const PostForm = ({ values, data }: { values: FormValues; data: FormData }) => (
  <form method="post" action={values.id ? `${BASE}/${values.id}` : `${BASE}/moi`} class="form admin-form-wide">
    <label>
      Tiêu đề
      <input name="title" required maxlength={200} value={values.title ?? ''} />
    </label>
    <div class="form-row">
      <label>
        Đường dẫn (slug)
        <input name="slug" value={values.slug ?? ''} placeholder="Để trống sẽ tạo từ tiêu đề" pattern="[a-z0-9]+(-[a-z0-9]+)*" />
      </label>
      <label>
        Chuyên mục
        <select name="category" required>
          {data.categories.map((c) => (
            <option value={c.slug} selected={values.category === c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </div>
    <label>
      Mô tả ngắn (hiện trên Google, khi chia sẻ)
      <textarea name="excerpt" rows={2} maxlength={300} required>
        {values.excerpt ?? ''}
      </textarea>
    </label>
    <div class="form-row">
      <label>
        Ảnh bìa (key trong R2, vd. posts/mat-ong/01-nectar.webp)
        <input name="cover_key" value={values.cover_key ?? ''} data-preview-for="cover-preview" />
      </label>
      <label>
        Tác giả (để trống = tác giả chính trong Cài đặt site)
        <input name="author" value={values.author ?? ''} />
      </label>
    </div>
    <div class="upload-widget" data-mode="key" data-target="cover_key">
      <span>Tải ảnh bìa lên:</span>
      <input type="file" accept="image/*" />
      <span class="upload-status muted"></span>
    </div>
    <img
      id="cover-preview"
      class="admin-thumb-lg upload-preview"
      src={values.cover_key ? mediaUrl(values.cover_key) : ''}
      alt=""
      hidden={!values.cover_key}
    />
    <label>
      Nội dung (Markdown)
      <textarea name="content_md" rows={28} class="markdown-input" required>
        {values.content_md ?? ''}
      </textarea>
    </label>
    <div class="upload-widget" data-mode="markdown" data-target="content_md">
      <span>Chèn ảnh vào nội dung (tại vị trí con trỏ):</span>
      <input type="file" accept="image/*" multiple />
      <span class="upload-status muted"></span>
    </div>
    <ProductPicker data={data} selected={values.product_ids ?? []} />
    <label class="checkbox">
      <input type="checkbox" name="published" checked={values.published === 1} /> Đăng lên site (bỏ chọn để lưu nháp)
    </label>
    <div class="form-actions">
      <button class="btn" type="submit">
        {values.id ? 'Lưu thay đổi' : 'Tạo bài viết'}
      </button>
      <a href={BASE}>Huỷ</a>
    </div>
  </form>
)

// Đọc và kiểm tra form; trả về lỗi (nếu có) cùng giá trị để hiện lại
async function parsePostForm(req: Parameters<typeof readForm>[0]) {
  const f = await readForm(req)
  const title = f.s('title')
  const content_md = f.text('content_md')
  const values: PostInput = {
    title,
    slug: f.s('slug') || slugify(title),
    excerpt: f.s('excerpt'),
    content_md,
    content_html: '',
    category: f.s('category'),
    cover_key: f.opt('cover_key'),
    author: f.opt('author'),
    published: f.bool('published'),
  }
  let error: string | undefined
  if (!title) error = 'Vui lòng nhập tiêu đề.'
  else if (!isValidSlug(values.slug)) error = 'Đường dẫn chỉ gồm chữ thường không dấu, số và dấu gạch ngang.'
  else if (!content_md) error = 'Vui lòng nhập nội dung.'
  const product_ids = f.ids(PRODUCT_PREFIX)
  if (!error && product_ids.length > 3) error = 'Chỉ chọn tối đa 3 sản phẩm gợi ý.'
  if (!error) values.content_html = await marked.parse(content_md)
  return { values, product_ids, error }
}

app.get('/', async (c) => {
  const posts = await adminListPosts(c.env.DB)
  return c.render(
    <AdminShell
      title="Bài viết"
      active={BASE}
      flash={c.req.query('ok')}
      actions={
        <a class="btn" href={`${BASE}/moi`}>
          + Viết bài mới
        </a>
      }
    >
      <table class="admin-table">
        <thead>
          <tr>
            <th>Tiêu đề</th>
            <th>Chuyên mục</th>
            <th>Trạng thái</th>
            <th>Cập nhật</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {posts.map((p: AdminPost) => (
            <tr>
              <td>
                <a href={`${BASE}/${p.id}`}>
                  <strong>{p.title}</strong>
                </a>
                <div class="muted">/bai-viet/{p.slug}</div>
              </td>
              <td>{p.category_name ?? <span class="muted">{p.category} (không còn)</span>}</td>
              <td>
                <Badge on={p.published} yes="Đã đăng" no="Nháp" />
              </td>
              <td>{formatDate(p.updated_at)}</td>
              <td class="row-actions">
                <a href={`${BASE}/${p.id}`}>Sửa</a>
                {p.published === 1 && (
                  <a href={`/bai-viet/${p.slug}`} target="_blank" rel="noopener">
                    Xem
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminShell>,
    { title: 'Quản trị: Bài viết', noindex: true }
  )
})

app.get('/moi', async (c) => {
  const data = await loadFormData(c.env.DB)
  return c.render(
    <AdminShell title="Viết bài mới" active={BASE}>
      <PostForm values={{ published: 0, category: data.categories[0]?.slug }} data={data} />
    </AdminShell>,
    { title: 'Viết bài mới', noindex: true }
  )
})

app.post('/moi', async (c) => {
  const { values, product_ids, error } = await parsePostForm(c.req)
  const data = await loadFormData(c.env.DB)
  const fail = (msg: string) => {
    c.status(400)
    return c.render(
      <AdminShell title="Viết bài mới" active={BASE} error={msg}>
        <PostForm values={{ ...values, product_ids }} data={data} />
      </AdminShell>,
      { title: 'Viết bài mới', noindex: true }
    )
  }
  if (error) return fail(error)
  try {
    const id = await adminCreatePost(c.env.DB, values)
    await adminSetPostProducts(c.env.DB, id, product_ids)
    return c.redirect(`${BASE}/${id}?ok=created`, 303)
  } catch (err) {
    if (isUniqueError(err)) return fail(`Đường dẫn "${values.slug}" đã có bài khác dùng.`)
    throw err
  }
})

app.get('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  const post = id && (await adminGetPost(c.env.DB, id))
  if (!post) return c.notFound()
  const [data, product_ids] = await Promise.all([loadFormData(c.env.DB), adminGetPostProductIds(c.env.DB, post.id)])
  return c.render(
    <AdminShell
      title="Sửa bài viết"
      active={BASE}
      flash={c.req.query('ok')}
      actions={
        <>
          {post.published === 1 && (
            <a class="btn btn-outline" href={`/bai-viet/${post.slug}`} target="_blank" rel="noopener">
              Xem trên site
            </a>
          )}
          <DeleteButton action={`${BASE}/${post.id}/xoa`} label={`bài "${post.title}"`} />
        </>
      }
    >
      <PostForm values={{ ...post, product_ids }} data={data} />
    </AdminShell>,
    { title: `Sửa: ${post.title}`, noindex: true }
  )
})

app.post('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id || !(await adminGetPost(c.env.DB, id))) return c.notFound()
  const { values, product_ids, error } = await parsePostForm(c.req)
  const data = await loadFormData(c.env.DB)
  const fail = (msg: string) => {
    c.status(400)
    return c.render(
      <AdminShell title="Sửa bài viết" active={BASE} error={msg}>
        <PostForm values={{ ...values, id, product_ids }} data={data} />
      </AdminShell>,
      { title: 'Sửa bài viết', noindex: true }
    )
  }
  if (error) return fail(error)
  try {
    await adminUpdatePost(c.env.DB, id, values)
    await adminSetPostProducts(c.env.DB, id, product_ids)
    return c.redirect(`${BASE}/${id}?ok=saved`, 303)
  } catch (err) {
    if (isUniqueError(err)) return fail(`Đường dẫn "${values.slug}" đã có bài khác dùng.`)
    throw err
  }
})

app.post('/:id/xoa', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id) await adminDeletePost(c.env.DB, id)
  return c.redirect(`${BASE}?ok=deleted`, 303)
})

export default app
