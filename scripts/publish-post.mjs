// Đăng/cập nhật bài viết từ file Markdown có front matter.
//
//   npm run post:local   -- content/posts/ten-bai.md   (D1 local)
//   npm run post:publish -- content/posts/ten-bai.md   (D1 thật)
//   npm run post:publish -- --all                      (đăng lại mọi bài trong content/posts)
//   thêm --force để ghi đè bài đã được sửa trên trang quản trị
//
// Front matter (giữa hai dòng ---): slug, title, excerpt, category, cover, author
// Markdown được render sẵn thành HTML ở đây (cột content_html) để Worker không
// phải parse lúc phục vụ, giữ CPU mỗi request dưới giới hạn gói miễn phí.
import { execSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { marked } from 'marked'

const DB = 'DB' // tên binding trong wrangler.jsonc
const POSTS_DIR = 'content/posts'

const args = process.argv.slice(2)
const remote = args.includes('--remote')
const force = args.includes('--force')
const files = args.includes('--all')
  ? readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md')).map((f) => join(POSTS_DIR, f))
  : args.filter((a) => !a.startsWith('--'))
if (!files.length) {
  console.error('Usage: node scripts/publish-post.mjs <file.md>... | --all [--remote]')
  process.exit(1)
}

const q = (s) => (s ? `'${s.replaceAll("'", "''")}'` : 'NULL')

// "products: slug-a, slug-b" trong front matter → sản phẩm gợi ý cuối bài (theo thứ tự).
// Không khai báo thì giữ nguyên lựa chọn đã có (vd. chọn trong trang quản trị).
function productsSql(meta) {
  if (meta.products === undefined) return ''
  const postId = `(SELECT id FROM posts WHERE slug = ${q(meta.slug)})`
  const slugs = meta.products.split(',').map((s) => s.trim()).filter(Boolean)
  return [
    `DELETE FROM post_products WHERE post_id = ${postId};`,
    ...slugs.map(
      (s, i) =>
        `INSERT OR IGNORE INTO post_products (post_id, product_id, position) SELECT ${postId}, id, ${i} FROM products WHERE slug = ${q(s)};`
    ),
  ].join('\n')
}

function toSql(file) {
  const raw = readFileSync(file, 'utf8').replaceAll('\r\n', '\n')
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) throw new Error(`${file}: thiếu front matter`)

  const meta = Object.fromEntries(
    match[1]
      .split('\n')
      .filter((line) => line.includes(':'))
      .map((line) => {
        const i = line.indexOf(':')
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()]
      })
  )
  for (const key of ['slug', 'title', 'excerpt', 'category']) {
    if (!meta[key]) throw new Error(`${file}: thiếu "${key}" trong front matter`)
  }

  const content = match[2].trim()
  const html = marked.parse(content)
  const sql = `INSERT INTO posts (slug, title, excerpt, content_md, content_html, category, cover_key, author, published, published_at)
VALUES (${q(meta.slug)}, ${q(meta.title)}, ${q(meta.excerpt)}, ${q(content)}, ${q(html)}, ${q(meta.category)}, ${q(meta.cover)}, ${q(meta.author)}, 1, datetime('now'))
ON CONFLICT(slug) DO UPDATE SET
  title = excluded.title,
  excerpt = excluded.excerpt,
  content_md = excluded.content_md,
  content_html = excluded.content_html,
  category = excluded.category,
  cover_key = excluded.cover_key,
  author = excluded.author,
  -- Chỉ đổi ngày cập nhật khi nội dung thực sự thay đổi
  updated_at = CASE
    WHEN posts.content_md IS NOT excluded.content_md OR posts.title IS NOT excluded.title
      OR posts.excerpt IS NOT excluded.excerpt THEN datetime('now')
    ELSE posts.updated_at END;
${productsSql(meta)}
-- Khách thấy ngay bản mới (xem src/lib/page-cache.ts)
INSERT INTO settings (key, value) VALUES ('cache_version', '1')
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = datetime('now');
`
  return { title: meta.title, slug: meta.slug, content, sql }
}

// D1 thỉnh thoảng trả lỗi tạm thời: thử lại vài lần
function execute(sqlFile) {
  const cmd = `npx wrangler d1 execute ${DB} ${remote ? '--remote' : '--local'} --file="${sqlFile}"`
  for (let attempt = 1; ; attempt++) {
    try {
      return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      if (attempt >= 3) throw err
      console.warn(`  D1 lỗi, thử lại (${attempt})...`)
    }
  }
}

// Bài có thể đã được sửa trên trang quản trị: không ghi đè nếu bản trong DB
// khác file và mới hơn lần sửa file gần nhất (trừ khi có --force)
function editedOnline(file, slug, content) {
  const out = execSync(
    `npx wrangler d1 execute ${DB} ${remote ? '--remote' : '--local'} --json --command "SELECT content_md, updated_at FROM posts WHERE slug = '${slug}'"`,
    { stdio: ['ignore', 'pipe', 'pipe'] }
  ).toString()
  const row = JSON.parse(out)[0]?.results?.[0]
  if (!row || row.content_md === content) return false
  const dbTime = new Date(row.updated_at.replace(' ', 'T') + 'Z').getTime()
  return dbTime > statSync(file).mtimeMs
}

const dir = mkdtempSync(join(tmpdir(), 'post-'))
for (const file of files) {
  const { title, slug, content, sql } = toSql(file)
  if (!force && editedOnline(file, slug, content)) {
    console.warn(`⚠ Bỏ qua "${title}": bài trên site đã được sửa sau file ${file}. Dùng --force để ghi đè.`)
    continue
  }
  const sqlFile = join(dir, 'post.sql')
  writeFileSync(sqlFile, sql)
  execute(sqlFile)
  console.log(`✔ Đã đăng "${title}" lên D1 ${remote ? 'thật' : 'local'}`)
}
