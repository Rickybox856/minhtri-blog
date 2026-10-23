import { Hono } from 'hono'
import type { Context } from 'hono'
import { PostGrid } from '../components/Cards'
import { WithSidebar, sidebarData } from '../components/Sidebar'
import { PER_PAGE, Pagination, pageHref, parsePage } from '../components/Pagination'
import { getPostCategory, listPostsPage } from '../lib/db'
import type { AppEnv } from '../types'

const app = new Hono<AppEnv>()

// /chu-de/:slug (trang 1) và /chu-de/:slug/trang/:n: danh sách bài theo chuyên mục, 10 bài mỗi trang
async function categoryPage(c: Context<AppEnv>) {
  const slug = c.req.param('slug') ?? ''
  const base = `/chu-de/${slug}`
  const page = parsePage(c.req.param('n'))
  if (page === null) return c.notFound()
  if (page === 1 && c.req.param('n')) return c.redirect(base, 301)

  const category = await getPostCategory(c.env.DB, slug)
  if (!category) return c.notFound()

  const [{ posts, total }, side] = await Promise.all([listPostsPage(c.env.DB, page, PER_PAGE, category.slug), sidebarData(c)])
  if (!posts.length && page > 1) return c.notFound()

  const suffix = page > 1 ? `（${page}ページ目）` : ''
  return c.render(
    <WithSidebar c={c} data={side} currentCategory={category.slug}>
      <h1>
        {category.name}
        {suffix && <small class="pg-title">{suffix}</small>}
      </h1>
      {category.description && page === 1 && <p class="lead">{category.description}</p>}
      <PostGrid posts={posts} />
      <Pagination base={base} page={page} total={total} />
    </WithSidebar>,
    {
      title: category.name + suffix,
      description: category.description || undefined,
      breadcrumbs: [
        { name: 'ホーム', path: '/' },
        { name: category.name, path: base },
        ...(page > 1 ? [{ name: `${page}ページ目`, path: pageHref(base, page) }] : []),
      ],
    }
  )
}

app.get('/:slug', categoryPage)
app.get('/:slug/trang/:n', categoryPage)

export default app
