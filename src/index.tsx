import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { listNavCategories, listPosts, listPublishedPages, recordProductClick } from './lib/db'
import { getSetting } from './lib/auth'
import { loadEarlySettings } from './lib/early-settings'
import { listBoards, listThreadsForSitemap } from './lib/forum'
import { runYoutubeSync } from './lib/youtube-sync'
import { runForumSchedule } from './lib/forum-schedule'
import { runAutoSchedule } from './lib/yt-autoschedule'
import type { GEnv } from './lib/google'
import { mediaUrl } from './lib/format'
import { loadMember } from './lib/members'
import { pageCache } from './lib/page-cache'
import { isoDate, siteOrigin } from './lib/seo'
import { loadNav, renderer } from './renderer'
import admin from './routes/admin'
import blog from './routes/blog'
import contact from './routes/contact'
import forum from './routes/forum'
import media from './routes/media'
import members from './routes/members'
import oauth from './routes/oauth'
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

// YouTube nhúng (iframe) cần biết trang gốc, "no-referrer" mặc định gây lỗi 153
app.use(secureHeaders({ referrerPolicy: 'strict-origin-when-cross-origin' }))

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
// Thành viên đang đăng nhập (chỉ truy vấn DB khi có cookie)
app.use(loadMember)
app.route('/media', media)
app.route('/oauth', oauth)

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
    `User-agent: *\nAllow: /\nDisallow: /mua/\nDisallow: /quan-tri/\nDisallow: /thanh-vien/\nDisallow: /oauth/\n\nSitemap: ${siteOrigin(c)}/sitemap.xml\n`
  )
)

app.get('/sitemap.xml', async (c) => {
  const base = siteOrigin(c)
  const [posts, categories, staticList, productsSetting, boards, threads] = await Promise.all([
    listPosts(c.env.DB, 5000),
    listNavCategories(c.env.DB),
    listPublishedPages(c.env.DB),
    getSetting(c.env.DB, 'site.products_enabled'),
    listBoards(c.env.DB),
    listThreadsForSitemap(c.env.DB),
  ])
  const entries: { path: string; lastmod?: string }[] = [
    { path: '/' },
    ...categories.map((cat) => ({ path: `/chu-de/${cat.slug}` })),
    { path: '/bai-viet' },
    ...(productsSetting === '0' ? [] : [{ path: '/san-pham' }]),
    ...staticList.map((p) => ({ path: `/${p.slug}`, lastmod: isoDate(p.updated_at) })),
    { path: '/lien-he' },
    ...posts.map((p) => ({ path: `/bai-viet/${p.slug}`, lastmod: isoDate(p.updated_at) })),
    { path: '/dien-dan' },
    ...boards.map((b) => ({ path: `/dien-dan/${b.slug}` })),
    ...threads.map((t) => ({ path: `/dien-dan/chu-de/${t.id}`, lastmod: isoDate(t.last_post_at) })),
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
app.route('/thanh-vien', members)
app.route('/dien-dan', forum)
app.route('/quan-tri', admin)
// Trang tĩnh /<slug> đăng ký sau cùng
app.route('/', staticPages)

app.notFound((c) => {
  c.status(404)
  return c.render(
    <>
      <h1>ページが見つかりません</h1>
      <p>
        <a href="/">ホームに戻る</a>
      </p>
    </>,
    { title: 'ページが見つかりません', noindex: true }
  )
})

export default {
  fetch: app.fetch,
  // Cron Trigger (wrangler.jsonc → triggers.crons): mỗi giờ kiểm tra kênh YouTube và đăng bài cho video mới
  async scheduled(_event: ScheduledController, env: CloudflareBindings, ctx: ExecutionContext) {
    // Chạy lần lượt để không cùng lúc dùng hết giới hạn số request của Worker
    ctx.waitUntil(
      (async () => {
        await runYoutubeSync(env)
          .then((r) => console.log('youtube-sync', JSON.stringify(r)))
          .catch((e) => console.error('youtube-sync', e))
        await runAutoSchedule(env as unknown as GEnv)
          .then((r) => console.log('yt-autoschedule', JSON.stringify(r)))
          .catch((e) => console.error('yt-autoschedule', e))
        await runForumSchedule(env)
          .then((r) => console.log('forum-schedule', JSON.stringify(r)))
          .catch((e) => console.error('forum-schedule', e))
      })()
    )
  },
} satisfies ExportedHandler<CloudflareBindings>

