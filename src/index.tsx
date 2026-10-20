import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { listNavCategories, listPosts, listPublishedPages, recordProductClick } from './lib/db'
import { getSetting } from './lib/auth'
import { loadEarlySettings } from './lib/early-settings'
import { mediaUrl } from './lib/format'
import { pageCache } from './lib/page-cache'
import { isoDate, siteOrigin } from './lib/seo'
import { loadNav, renderer } from './renderer'
import admin from './routes/admin'
import blog from './routes/blog'
import contact from './routes/contact'
import media from './routes/media'
import pages from './routes/pages'
import staticPages from './routes/static-pages'
import topics from './routes/topics'
import type { AppEnv } from './types'

const app = new Hono<AppEnv>()

app.use(loadEarlySettings)

// Chuẩn hoá về một địa chỉ duy nhất: https + tên miền chính (không www).
// Giao thức của khách lấy từ header CF-Visitor do Cloudflare gắn; wrangler dev
// không có header này nên không bị chuyển hướng.
app.use(async (c, next) => {
  const { siteUrl } = c.get('early')
  if (!siteUrl) return next()
  const url = new URL(c.req.url)
  const canonical = new URL(siteUrl)
  const isHttp = c.req.header('cf-visitor')?.includes('"scheme":"http"') ?? false
  if (url.hostname === `www.${canonical.hostname}` || (url.hostname === canonical.hostname && isHttp)) {
    url.protocol = canonical.protocol
    url.hostname = canonical.hostname
    return c.redirect(url.toString(), 301)
  }
  await next()
})

app.use(secureHeaders())

// /gioi-thieu/ → /gioi-thieu (một số ứng dụng tự thêm dấu / cuối đường dẫn)
app.use(async (c, next) => {
  const url = new URL(c.req.url)
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '')
    return c.redirect(url.toString(), 301)
  }
  await next()
})

app.use(pageCache)
app.route('/media', media)

// Link mua sản phẩm: đếm lượt bấm rồi chuyển sang trang bán hàng
app.get('/mua/:slug', async (c) => {
  if ((await getSetting(c.env.DB, 'site.products_enabled')) === '0') return c.notFound()
  const url = await recordProductClick(c.env.DB, c.req.param('slug'))
  if (!url) return c.redirect('/san-pham', 302)
  c.header('X-Robots-Tag', 'noindex, nofollow')
  return c.redirect(url, 302)
})

// Favicon có thể đổi trong trang quản trị nên không chuyển hướng vĩnh viễn
app.get('/favicon.ico', async (c) => {
  const key = await getSetting(c.env.DB, 'site.favicon_key')
  c.header('Cache-Control', 'public, max-age=86400')
  return c.redirect(key ? mediaUrl(key) : '/favicon.svg', 302)
})

// robots.txt sinh theo địa chỉ site để dùng được cho mọi tên miền
app.get('/robots.txt', (c) =>
  c.text(
    `User-agent: *\nAllow: /\nDisallow: /mua/\nDisallow: /quan-tri/\n\nSitemap: ${siteOrigin(c)}/sitemap.xml\n`
  )
)

app.get('/sitemap.xml', async (c) => {
  const base = siteOrigin(c)
  const [posts, categories, staticList, productsSetting] = await Promise.all([
    listPosts(c.env.DB, 5000),
    listNavCategories(c.env.DB),
    listPublishedPages(c.env.DB),
    getSetting(c.env.DB, 'site.products_enabled'),
  ])
  const entries: { path: string; lastmod?: string }[] = [
    { path: '/' },
    ...categories.map((cat) => ({ path: `/chu-de/${cat.slug}` })),
    { path: '/bai-viet' },
    ...(productsSetting === '0' ? [] : [{ path: '/san-pham' }]),
    ...staticList.map((p) => ({ path: `/${p.slug}`, lastmod: isoDate(p.updated_at) })),
    { path: '/lien-he' },
    ...posts.map((p) => ({ path: `/bai-viet/${p.slug}`, lastmod: isoDate(p.updated_at) })),
  ]
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries
      .map((e) => `  <url><loc>${base}${e.path}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`)
      .join('\n') +
    '\n</urlset>'
  return c.body(body, 200, { 'Content-Type': 'application/xml; charset=utf-8' })
})

app.use('*', loadNav, renderer)

app.route('/', pages)
app.route('/bai-viet', blog)
app.route('/chu-de', topics)
app.route('/lien-he', contact)
app.route('/quan-tri', admin)
// Trang tĩnh /<slug> đăng ký sau cùng
app.route('/', staticPages)

app.notFound((c) => {
  c.status(404)
  return c.render(
    <>
      <h1>Không tìm thấy trang</h1>
      <p>
        <a href="/">Về trang chủ</a>
      </p>
    </>,
    { title: 'Không tìm thấy', noindex: true }
  )
})

export default app
