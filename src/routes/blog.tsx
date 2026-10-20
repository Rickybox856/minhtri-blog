import { Hono } from 'hono'
import { raw } from 'hono/html'
import { marked } from 'marked'
import { PostGrid, ProductGrid } from '../components/Cards'
import { getPost, listPostProducts, listPosts } from '../lib/db'
import { productsEnabled } from '../lib/site-config'
import type { AppEnv } from '../types'
import { formatDate, mediaUrl, withMediaBase } from '../lib/format'
import { articleJsonLd, siteOrigin } from '../lib/seo'

const app = new Hono<AppEnv>()

app.get('/', async (c) => {
  const posts = await listPosts(c.env.DB, 100)
  return c.render(
    <>
      <h1>Tất cả bài viết</h1>
      <PostGrid posts={posts} />
    </>,
    {
      title: 'Bài viết',
      description: `Tất cả bài viết trên ${c.get('site').name}.`,
      breadcrumbs: [
        { name: 'Trang chủ', path: '/' },
        { name: 'Bài viết', path: '/bai-viet' },
      ],
    }
  )
})

app.get('/:slug', async (c) => {
  const post = await getPost(c.env.DB, c.req.param('slug'))
  if (!post) return c.notFound()

  const [related, products] = await Promise.all([
    listPosts(c.env.DB, 4, post.category),
    productsEnabled(c.get('site')) ? listPostProducts(c.env.DB, post) : [],
  ])

  // Nội dung do quản trị viên viết nên được tin cậy; nếu sau này cho người dùng
  // nhập Markdown thì cần lọc HTML trước khi render.
  // HTML được render sẵn lúc lưu; nếu còn trống thì render một lần rồi lưu lại
  let html = post.content_html
  if (html == null) {
    html = await marked.parse(post.content_md)
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE posts SET content_html = ? WHERE id = ?').bind(html, post.id).run()
    )
  }
  const updated = formatDate(post.updated_at) !== formatDate(post.published_at)

  return c.render(
    <>
      <article class="post">
        <header class="post-header">
          <h1>{post.title}</h1>
          <p class="post-meta">
            {post.author && post.author !== c.get('site').owner_name ? (
              <>Tác giả: {post.author} · </>
            ) : c.get('site').owner_name ? (
              <>
                Tác giả: <a href="/gioi-thieu#tac-gia">{c.get('site').owner_name}</a> ·{' '}
              </>
            ) : null}
            Đăng ngày <time datetime={post.published_at ?? undefined}>{formatDate(post.published_at)}</time>
            {updated && <> · Cập nhật {formatDate(post.updated_at)}</>}
          </p>
        </header>
        <div class="prose">{raw(withMediaBase(html))}</div>
      </article>

      {products.length > 0 && (
        <section class="related">
          <h2>Sản phẩm liên quan</h2>
          <ProductGrid products={products} shop={c.get('site').shop_name} />
        </section>
      )}

      {related.filter((p) => p.slug !== post.slug).length > 0 && (
        <section class="related">
          <h2>Bài viết cùng chủ đề</h2>
          <PostGrid posts={related.filter((p) => p.slug !== post.slug).slice(0, 3)} />
        </section>
      )}
    </>,
    {
      title: post.title,
      description: post.excerpt,
      type: 'article',
      section: `/chu-de/${post.category}`,
      image: post.cover_key ? mediaUrl(post.cover_key) : undefined,
      jsonLd: [articleJsonLd(siteOrigin(c), post, c.get('site'))],
      breadcrumbs: [
        { name: 'Trang chủ', path: '/' },
        ...(post.category_name ? [{ name: post.category_name, path: `/chu-de/${post.category}` }] : []),
        { name: post.title, path: `/bai-viet/${post.slug}` },
      ],
    }
  )
})

export default app
