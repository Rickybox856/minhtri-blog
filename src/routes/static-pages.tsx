import { Hono } from 'hono'
import { withMediaBase } from '../lib/format'
import { raw } from 'hono/html'
import { marked } from 'marked'
import { getPage } from '../lib/db'
import { AUTHOR_PAGE_SLUG, authorPageJsonLd } from '../lib/author'
import { absoluteUrl, siteOrigin } from '../lib/seo'
import type { AppEnv } from '../types'

const app = new Hono<AppEnv>()

// Trang tĩnh quản lý trong /quan-tri/trang, phục vụ ở /<slug>.
// Đăng ký sau cùng để không che các đường dẫn khác.
app.get('/:slug', async (c, next) => {
  const page = await getPage(c.env.DB, c.req.param('slug'))
  if (!page) return next()

  let html = page.content_html
  if (html == null) {
    html = await marked.parse(page.content_md)
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE pages SET content_html = ? WHERE id = ?').bind(html, page.id).run()
    )
  }

  return c.render(
    <article class="prose">
      <h1>{page.title}</h1>
      {raw(withMediaBase(html))}
    </article>,
    {
      title: page.title,
      description: page.description || undefined,
      jsonLd: page.slug === AUTHOR_PAGE_SLUG ? [authorPageJsonLd(absoluteUrl(siteOrigin(c), `/${page.slug}`))] : undefined,
      breadcrumbs: [
        { name: 'ホーム', path: '/' },
        { name: page.title, path: `/${page.slug}` },
      ],
    }
  )
})

export default app
