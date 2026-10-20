// Truy vấn cho các trang công khai. Thêm/sửa/xoá cho trang quản trị: admin-db.ts

// Thông tin bài dùng cho danh sách (không kèm nội dung để truy vấn nhẹ)
export type Post = {
  id: number
  slug: string
  title: string
  excerpt: string
  cover_key: string | null
  category: string
  /** Tên chuyên mục (JOIN post_categories), null nếu chuyên mục không còn */
  category_name: string | null
  author: string | null
  published_at: string | null
  updated_at: string
}

export type PostWithContent = Post & {
  content_md: string
  /** HTML render sẵn lúc lưu; null thì render lúc xem lần đầu */
  content_html: string | null
}

export type Product = {
  id: number
  slug: string
  name: string
  summary: string
  description_md: string
  price: number | null
  image_key: string | null
  image_url: string | null
  buy_url: string | null
  category: string
}

export type PostCategory = {
  id: number
  slug: string
  name: string
  description: string
  sort_order: number
  show_in_menu: number
}

export type ProductCategory = {
  id: number
  slug: string
  name: string
  sort_order: number
}

export type PageLink = { slug: string; title: string; show_in_menu: number; show_in_footer: number }

export type Page = PageLink & {
  id: number
  description: string
  content_md: string
  content_html: string | null
  published: number
  sort_order: number
  updated_at: string
}

export const POST_COLUMNS =
  'p.id, p.slug, p.title, p.excerpt, p.cover_key, p.category, c.name AS category_name, p.author, p.published_at, p.updated_at'
const POST_FROM = 'posts p LEFT JOIN post_categories c ON c.slug = p.category'
export const PRODUCT_COLUMNS =
  'id, slug, name, summary, description_md, price, image_key, image_url, buy_url, category'

export async function listPosts(db: D1Database, limit = 20, category?: string): Promise<Post[]> {
  const where = category ? 'p.published = 1 AND p.category = ?' : 'p.published = 1'
  const stmt = db.prepare(`SELECT ${POST_COLUMNS} FROM ${POST_FROM} WHERE ${where} ORDER BY p.published_at DESC LIMIT ?`)
  const { results } = await (category ? stmt.bind(category, limit) : stmt.bind(limit)).all<Post>()
  return results
}

export function getPost(db: D1Database, slug: string): Promise<PostWithContent | null> {
  return db
    .prepare(`SELECT ${POST_COLUMNS}, p.content_md, p.content_html FROM ${POST_FROM} WHERE p.slug = ? AND p.published = 1`)
    .bind(slug)
    .first<PostWithContent>()
}

export async function listProducts(db: D1Database, category?: string): Promise<Product[]> {
  const where = category ? 'active = 1 AND category = ?' : 'active = 1'
  const stmt = db.prepare(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE ${where} ORDER BY sort_order, id`)
  const { results } = await (category ? stmt.bind(category) : stmt).all<Product>()
  return results
}

/** Sản phẩm cuối bài: sản phẩm được chọn cho bài trước, thiếu thì lấy thêm sản phẩm cùng danh mục */
export async function listPostProducts(db: D1Database, post: { id: number; category: string }, limit = 3) {
  const [picked, sameCategory] = await Promise.all([
    db
      .prepare(
        `SELECT ${PRODUCT_COLUMNS} FROM products JOIN post_products ON product_id = id
         WHERE post_id = ? AND active = 1 ORDER BY position`
      )
      .bind(post.id)
      .all<Product>()
      .then((r) => r.results),
    listProducts(db, post.category),
  ])
  const ids = new Set(picked.map((p) => p.id))
  return [...picked, ...sameCategory.filter((p) => !ids.has(p.id))].slice(0, limit)
}

export async function listPostCategories(db: D1Database): Promise<PostCategory[]> {
  const { results } = await db
    .prepare('SELECT id, slug, name, description, sort_order, show_in_menu FROM post_categories ORDER BY sort_order, id')
    .all<PostCategory>()
  return results
}

/** Chuyên mục hiện trên menu và trang chủ: đang bật "Hiện trên menu" và có ít nhất một bài đã đăng */
export async function listNavCategories(db: D1Database): Promise<PostCategory[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.description, c.sort_order, c.show_in_menu FROM post_categories c
       WHERE c.show_in_menu = 1 AND EXISTS (SELECT 1 FROM posts p WHERE p.category = c.slug AND p.published = 1)
       ORDER BY c.sort_order, c.id`
    )
    .all<PostCategory>()
  return results
}

export function getPostCategory(db: D1Database, slug: string): Promise<PostCategory | null> {
  return db
    .prepare('SELECT id, slug, name, description, sort_order, show_in_menu FROM post_categories WHERE slug = ?')
    .bind(slug)
    .first<PostCategory>()
}

export async function listProductCategories(db: D1Database): Promise<ProductCategory[]> {
  const { results } = await db
    .prepare('SELECT id, slug, name, sort_order FROM product_categories ORDER BY sort_order, id')
    .all<ProductCategory>()
  return results
}

/** Các trang đã xuất bản cần hiện ở menu hoặc footer */
export async function listNavPages(db: D1Database): Promise<PageLink[]> {
  const { results } = await db
    .prepare(
      `SELECT slug, title, show_in_menu, show_in_footer FROM pages
       WHERE published = 1 AND (show_in_menu = 1 OR show_in_footer = 1) ORDER BY sort_order, id`
    )
    .all<PageLink>()
  return results
}

export async function listPublishedPages(db: D1Database): Promise<{ slug: string; updated_at: string }[]> {
  const { results } = await db
    .prepare('SELECT slug, updated_at FROM pages WHERE published = 1 ORDER BY sort_order, id')
    .all<{ slug: string; updated_at: string }>()
  return results
}

export function getPage(db: D1Database, slug: string): Promise<Page | null> {
  return db.prepare('SELECT * FROM pages WHERE slug = ? AND published = 1').bind(slug).first<Page>()
}

/** Tăng lượt bấm và trả về link mua của sản phẩm. */
export async function recordProductClick(db: D1Database, slug: string): Promise<string | null> {
  const row = await db
    .prepare('UPDATE products SET clicks = clicks + 1 WHERE slug = ? AND active = 1 AND buy_url IS NOT NULL RETURNING buy_url')
    .bind(slug)
    .first<{ buy_url: string }>()
  return row?.buy_url ?? null
}

export type Contact = {
  id: number
  name: string
  phone: string
  message: string
  created_at: string
}

export async function listContacts(db: D1Database, limit = 200): Promise<Contact[]> {
  const { results } = await db
    .prepare('SELECT id, name, phone, message, created_at FROM contacts ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all<Contact>()
  return results
}

export async function createContact(
  db: D1Database,
  data: { name: string; phone: string; message: string }
): Promise<void> {
  await db
    .prepare('INSERT INTO contacts (name, phone, message) VALUES (?, ?, ?)')
    .bind(data.name, data.phone, data.message)
    .run()
}
