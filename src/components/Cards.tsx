import type { Post, Product } from '../lib/db'
import { formatDate, formatPrice, mediaUrl } from '../lib/format'

export const PostCard = ({ post }: { post: Post }) => (
  <article class="post-card">
    {post.cover_key && (
      <a href={`/bai-viet/${post.slug}`} class="post-card-image">
        <img src={mediaUrl(post.cover_key)} alt="" loading="lazy" />
      </a>
    )}
    <div class="post-card-body">
      <a class="tag" href={`/chu-de/${post.category}`}>
        {post.category_name ?? post.category}
      </a>
      <h3>
        <a href={`/bai-viet/${post.slug}`}>{post.title}</a>
      </h3>
      <p>{post.excerpt}</p>
      <time datetime={post.published_at ?? undefined}>{formatDate(post.published_at)}</time>
    </div>
  </article>
)

export const PostGrid = ({ posts }: { posts: Post[] }) =>
  posts.length ? (
    <div class="post-grid">
      {posts.map((p) => (
        <PostCard post={p} />
      ))}
    </div>
  ) : (
    <p class="empty">Bài viết đang được biên soạn, mời bạn quay lại sau.</p>
  )

// Thẻ lớn nằm ngang cho bài nổi bật ở trang chủ
export const FeaturedPost = ({ post }: { post: Post }) => (
  <article class="featured-post">
    {post.cover_key && (
      <a href={`/bai-viet/${post.slug}`} class="featured-image">
        <img src={mediaUrl(post.cover_key)} alt="" />
      </a>
    )}
    <div class="featured-body">
      <a class="tag" href={`/chu-de/${post.category}`}>
        {post.category_name ?? post.category}
      </a>
      <h3>
        <a href={`/bai-viet/${post.slug}`}>{post.title}</a>
      </h3>
      <p>{post.excerpt}</p>
      <a class="read-more" href={`/bai-viet/${post.slug}`}>
        Đọc bài viết ›
      </a>
    </div>
  </article>
)

// Danh sách gọn (ảnh nhỏ + tiêu đề) cho các cột chuyên mục
export const PostList = ({ posts }: { posts: Post[] }) =>
  posts.length ? (
    <ul class="post-list-compact">
      {posts.map((p) => (
        <li>
          <a href={`/bai-viet/${p.slug}`}>
            {p.cover_key ? <img src={mediaUrl(p.cover_key)} alt="" loading="lazy" /> : <span class="thumb-placeholder" />}
            <span>
              <strong>{p.title}</strong>
              <time datetime={p.published_at ?? undefined}>{formatDate(p.published_at)}</time>
            </span>
          </a>
        </li>
      ))}
    </ul>
  ) : (
    <p class="empty">Bài viết đang được biên soạn.</p>
  )

const productImage =(p: Product) => (p.image_key ? mediaUrl(p.image_key) : p.image_url)

export const ProductCard = ({ product, shop }: { product: Product; shop?: string }) => {
  const image = productImage(product)
  return (
    <article class="card product-card">
      {image && <img src={image} alt={product.name} loading="lazy" />}
      <h3>{product.name}</h3>
      <p>{product.summary}</p>
      <strong class="price">{formatPrice(product.price)}</strong>
      {product.buy_url && product.price != null && <small class="price-note">Giá tham khảo, có thể thay đổi{shop ? ` trên ${shop}` : ''}</small>}
      {product.buy_url && (
        <a class="btn btn-shopee" href={`/mua/${product.slug}`} target="_blank" rel="sponsored nofollow noopener">
          {shop ? `Mua trên ${shop}` : 'Mua ngay'}
        </a>
      )}
    </article>
  )
}

export const ProductGrid = ({ products, shop }: { products: Product[]; shop?: string }) => (
  <div class="grid">
    {products.map((p) => (
      <ProductCard product={p} shop={shop} />
    ))}
  </div>
)
