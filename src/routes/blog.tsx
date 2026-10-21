import { Hono } from 'hono'
import { raw } from 'hono/html'
import { marked } from 'marked'
import { PostGrid, ProductGrid } from '../components/Cards'
import { getPost, listPostProducts, listPosts } from '../lib/db'
import { productsEnabled } from '../lib/site-config'
import type { AppEnv } from '../types'
import { mediaUrl, withMediaBase } from '../lib/format'
import { articleJsonLd, siteOrigin } from '../lib/seo'

const app = new Hono<AppEnv>()

app.get('/', async (c) => {
  const posts = await listPosts(c.env.DB, 100)
  return c.render(
    <>
      <h1>記事一覧</h1>
      <PostGrid posts={posts} />
    </>,
    {
      title: '記事一覧',
      description: `${c.get('site').name}の記事一覧です。`,
      breadcrumbs: [
        { name: 'ホーム', path: '/' },
        { name: '記事一覧', path: '/bai-viet' },
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

  return c.render(
    <>
      <article class="post">
        <header class="post-header">
          <h1>{post.title}</h1>
          {post.author && post.author !== c.get('site').owner_name ? (
            <p class="post-meta">著者: {post.author}</p>
          ) : c.get('site').owner_name ? (
            <p class="post-meta">
              著者: <a href="/gioi-thieu#tac-gia">{c.get('site').owner_name}</a>
            </p>
          ) : null}
        </header>
        <div class="prose">{raw(withMediaBase(html))}</div>
      </article>

      {products.length > 0 && (
        <section class="related">
          <h2>関連商品</h2>
          <ProductGrid products={products} shop={c.get('site').shop_name} />
        </section>
      )}

      {related.filter((p) => p.slug !== post.slug).length > 0 && (
        <section class="related">
          <h2>同じテーマの記事</h2>
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
        { name: 'ホーム', path: '/' },
        ...(post.category_name ? [{ name: post.category_name, path: `/chu-de/${post.category}` }] : []),
        { name: post.title, path: `/bai-viet/${post.slug}` },
      ],
    }
  )
})

export default app
