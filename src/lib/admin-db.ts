// Thêm/sửa/xoá dữ liệu cho trang quản trị
import type { Page, PostCategory, PostWithContent, ProductCategory } from './db'
import { POST_COLUMNS, PRODUCT_COLUMNS } from './db'

// ---------- Bài viết ----------

export type AdminPost = PostWithContent & { published: number }

export async function adminListPosts(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT ${POST_COLUMNS}, p.published FROM posts p LEFT JOIN post_categories c ON c.slug = p.category
       ORDER BY p.published, COALESCE(p.published_at, p.created_at) DESC`
    )
    .all<AdminPost>()
  return results
}

export function adminGetPost(db: D1Database, id: number) {
  return db
    .prepare(
      `SELECT ${POST_COLUMNS}, p.content_md, p.content_html, p.published
       FROM posts p LEFT JOIN post_categories c ON c.slug = p.category WHERE p.id = ?`
    )
    .bind(id)
    .first<AdminPost>()
}

export type PostInput = {
  slug: string
  title: string
  excerpt: string
  content_md: string
  content_html: string
  category: string
  cover_key: string | null
  author: string | null
  published: number
}

export async function adminCreatePost(db: D1Database, p: PostInput) {
  const row = await db
    .prepare(
      `INSERT INTO posts (slug, title, excerpt, content_md, content_html, category, cover_key, author, published, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') END) RETURNING id`
    )
    .bind(p.slug, p.title, p.excerpt, p.content_md, p.content_html, p.category, p.cover_key, p.author, p.published, p.published)
    .first<{ id: number }>()
  return row!.id
}

export async function adminUpdatePost(db: D1Database, id: number, p: PostInput) {
  await db
    .prepare(
      `UPDATE posts SET
         updated_at = CASE WHEN content_md IS NOT ?4 OR title IS NOT ?3 OR excerpt IS NOT ?5
                      THEN datetime('now') ELSE updated_at END,
         slug = ?2, title = ?3, excerpt = ?5, content_md = ?4, content_html = ?6, category = ?7,
         cover_key = ?8, author = ?9, published = ?10,
         published_at = CASE WHEN ?10 = 1 AND published_at IS NULL THEN datetime('now') ELSE published_at END
       WHERE id = ?1`
    )
    .bind(id, p.slug, p.title, p.content_md, p.excerpt, p.content_html, p.category, p.cover_key, p.author, p.published)
    .run()
}

/** id các sản phẩm đang được gợi ý cho bài, theo thứ tự */
export async function adminGetPostProductIds(db: D1Database, postId: number) {
  const { results } = await db
    .prepare('SELECT product_id FROM post_products WHERE post_id = ? ORDER BY position')
    .bind(postId)
    .all<{ product_id: number }>()
  return results.map((r) => r.product_id)
}

export async function adminSetPostProducts(db: D1Database, postId: number, productIds: number[]) {
  await db.batch([
    db.prepare('DELETE FROM post_products WHERE post_id = ?').bind(postId),
    ...productIds.map((productId, i) =>
      db.prepare('INSERT INTO post_products (post_id, product_id, position) VALUES (?, ?, ?)').bind(postId, productId, i)
    ),
  ])
}

/** Sản phẩm để chọn trong form bài viết (gồm cả sản phẩm đang ẩn) */
export async function adminListProductChoices(db: D1Database) {
  const { results } = await db
    .prepare('SELECT id, name, category, active FROM products ORDER BY category, sort_order, id')
    .all<{ id: number; name: string; category: string; active: number }>()
  return results
}

export async function adminDeletePost(db: D1Database, id: number) {
  await db.batch([
    db.prepare('DELETE FROM post_products WHERE post_id = ?').bind(id),
    db.prepare('DELETE FROM posts WHERE id = ?').bind(id),
  ])
}

// ---------- Chuyên mục bài viết ----------

export async function adminListPostCategories(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.description, c.sort_order, c.show_in_menu,
         (SELECT COUNT(*) FROM posts p WHERE p.category = c.slug) AS post_count,
         (SELECT COUNT(*) FROM posts p WHERE p.category = c.slug AND p.published = 1) AS published_count
       FROM post_categories c ORDER BY c.sort_order, c.id`
    )
    .all<PostCategory & { post_count: number; published_count: number }>()
  return results
}

export function adminGetPostCategory(db: D1Database, id: number) {
  return db.prepare('SELECT * FROM post_categories WHERE id = ?').bind(id).first<PostCategory>()
}

export type PostCategoryInput = { slug: string; name: string; description: string; sort_order: number; show_in_menu: number }

export async function adminCreatePostCategory(db: D1Database, c: PostCategoryInput) {
  await db
    .prepare('INSERT INTO post_categories (slug, name, description, sort_order, show_in_menu) VALUES (?, ?, ?, ?, ?)')
    .bind(c.slug, c.name, c.description, c.sort_order, c.show_in_menu)
    .run()
}

/** Đổi slug chuyên mục thì chuyển luôn các bài đang thuộc slug cũ */
export async function adminUpdatePostCategory(db: D1Database, id: number, c: PostCategoryInput) {
  const old = await adminGetPostCategory(db, id)
  if (!old) return
  await db.batch([
    db
      .prepare('UPDATE post_categories SET slug = ?, name = ?, description = ?, sort_order = ?, show_in_menu = ? WHERE id = ?')
      .bind(c.slug, c.name, c.description, c.sort_order, c.show_in_menu, id),
    db.prepare('UPDATE posts SET category = ? WHERE category = ?').bind(c.slug, old.slug),
  ])
}

export async function adminDeletePostCategory(db: D1Database, id: number) {
  await db.prepare('DELETE FROM post_categories WHERE id = ?').bind(id).run()
}

// ---------- Sản phẩm ----------

export type AdminProduct = {
  id: number
  slug: string
  name: string
  summary: string
  price: number | null
  image_url: string | null
  image_key: string | null
  buy_url: string | null
  category: string
  category_name: string | null
  sort_order: number
  active: number
  clicks: number
}

export async function adminListProducts(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.slug, p.name, p.summary, p.price, p.image_url, p.image_key, p.buy_url, p.category,
         c.name AS category_name, p.sort_order, p.active, p.clicks
       FROM products p LEFT JOIN product_categories c ON c.slug = p.category
       ORDER BY p.active DESC, p.sort_order, p.id`
    )
    .all<AdminProduct>()
  return results
}

export function adminGetProduct(db: D1Database, id: number) {
  return db
    .prepare(`SELECT ${PRODUCT_COLUMNS}, sort_order, active, clicks FROM products WHERE id = ?`)
    .bind(id)
    .first<AdminProduct>()
}

export type ProductInput = {
  slug: string
  name: string
  summary: string
  price: number | null
  image_url: string | null
  image_key: string | null
  buy_url: string | null
  category: string
  sort_order: number
  active: number
}

export async function adminCreateProduct(db: D1Database, p: ProductInput) {
  await db
    .prepare(
      `INSERT INTO products (slug, name, summary, price, image_url, image_key, buy_url, category, sort_order, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(p.slug, p.name, p.summary, p.price, p.image_url, p.image_key, p.buy_url, p.category, p.sort_order, p.active)
    .run()
}

export async function adminUpdateProduct(db: D1Database, id: number, p: ProductInput) {
  await db
    .prepare(
      `UPDATE products SET slug = ?, name = ?, summary = ?, price = ?, image_url = ?, image_key = ?, buy_url = ?,
         category = ?, sort_order = ?, active = ? WHERE id = ?`
    )
    .bind(p.slug, p.name, p.summary, p.price, p.image_url, p.image_key, p.buy_url, p.category, p.sort_order, p.active, id)
    .run()
}

export async function adminDeleteProduct(db: D1Database, id: number) {
  await db.batch([
    db.prepare('DELETE FROM post_products WHERE product_id = ?').bind(id),
    db.prepare('DELETE FROM products WHERE id = ?').bind(id),
  ])
}

// ---------- Danh mục sản phẩm ----------

export async function adminListProductCategories(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.sort_order,
         (SELECT COUNT(*) FROM products p WHERE p.category = c.slug) AS product_count
       FROM product_categories c ORDER BY c.sort_order, c.id`
    )
    .all<ProductCategory & { product_count: number }>()
  return results
}

export function adminGetProductCategory(db: D1Database, id: number) {
  return db.prepare('SELECT * FROM product_categories WHERE id = ?').bind(id).first<ProductCategory>()
}

export type ProductCategoryInput = { slug: string; name: string; sort_order: number }

export async function adminCreateProductCategory(db: D1Database, c: ProductCategoryInput) {
  await db
    .prepare('INSERT INTO product_categories (slug, name, sort_order) VALUES (?, ?, ?)')
    .bind(c.slug, c.name, c.sort_order)
    .run()
}

export async function adminUpdateProductCategory(db: D1Database, id: number, c: ProductCategoryInput) {
  const old = await adminGetProductCategory(db, id)
  if (!old) return
  await db.batch([
    db
      .prepare('UPDATE product_categories SET slug = ?, name = ?, sort_order = ? WHERE id = ?')
      .bind(c.slug, c.name, c.sort_order, id),
    db.prepare('UPDATE products SET category = ? WHERE category = ?').bind(c.slug, old.slug),
  ])
}

export async function adminDeleteProductCategory(db: D1Database, id: number) {
  await db.prepare('DELETE FROM product_categories WHERE id = ?').bind(id).run()
}

// ---------- Trang tĩnh ----------

export async function adminListPages(db: D1Database) {
  const { results } = await db.prepare('SELECT * FROM pages ORDER BY sort_order, id').all<Page>()
  return results
}

export function adminGetPage(db: D1Database, id: number) {
  return db.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<Page>()
}

export type PageInput = {
  slug: string
  title: string
  description: string
  content_md: string
  content_html: string
  published: number
  show_in_menu: number
  show_in_footer: number
  sort_order: number
}

export async function adminCreatePage(db: D1Database, p: PageInput) {
  await db
    .prepare(
      `INSERT INTO pages (slug, title, description, content_md, content_html, published, show_in_menu, show_in_footer, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(p.slug, p.title, p.description, p.content_md, p.content_html, p.published, p.show_in_menu, p.show_in_footer, p.sort_order)
    .run()
}

export async function adminUpdatePage(db: D1Database, id: number, p: PageInput) {
  await db
    .prepare(
      `UPDATE pages SET slug = ?, title = ?, description = ?, content_md = ?, content_html = ?, published = ?,
         show_in_menu = ?, show_in_footer = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .bind(p.slug, p.title, p.description, p.content_md, p.content_html, p.published, p.show_in_menu, p.show_in_footer, p.sort_order, id)
    .run()
}

export async function adminDeletePage(db: D1Database, id: number) {
  await db.prepare('DELETE FROM pages WHERE id = ?').bind(id).run()
}

/** Lỗi UNIQUE của SQLite khi slug bị trùng */
export const isUniqueError = (err: unknown) => String(err).includes('UNIQUE constraint failed')
