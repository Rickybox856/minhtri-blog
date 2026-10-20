import type { Child } from 'hono/jsx'
import { raw } from 'hono/html'
import { mediaUrl } from '../lib/format'
import type { Crumb } from '../lib/seo'
import type { SiteConfig } from '../lib/site-config'
import { copyrightText, faviconUrl, phoneDisplay, phoneIntl, productsEnabled } from '../lib/site-config'
import type { SiteNav } from '../types'

export type SeoProps = {
  title?: string
  description?: string
  /** Đường dẫn hoặc URL tuyệt đối của ảnh chia sẻ */
  image?: string
  type?: 'website' | 'article'
  jsonLd?: object[]
  breadcrumbs?: Crumb[]
  noindex?: boolean
  /** Mục menu cần làm nổi khi đường dẫn không tự khớp (vd. bài viết → /chu-de/mat-ong) */
  section?: string
}

type Props = SeoProps & {
  site: SiteConfig
  siteUrl: string
  path: string
  googleVerification?: string
  /** Gắn vào link CSS để trình duyệt cache lâu dài, đổi mỗi lần deploy */
  assetVersion: string
  nav: SiteNav
  children?: Child
}

// Menu: Trang chủ, các chuyên mục bài viết, Sản phẩm, các trang tĩnh bật "hiện ở menu", Liên hệ
const menuItems = (nav: SiteNav, site: SiteConfig) => [
  { href: '/', label: 'Trang chủ' },
  ...nav.postCategories.map((c) => ({ href: `/chu-de/${c.slug}`, label: c.name })),
  ...(productsEnabled(site) ? [{ href: '/san-pham', label: 'Sản phẩm' }] : []),
  ...nav.pages.filter((p) => p.show_in_menu).map((p) => ({ href: `/${p.slug}`, label: p.title })),
  { href: '/lien-he', label: 'Liên hệ' },
]


// Chặn chuỗi "</script>" trong JSON làm vỡ thẻ script
const jsonScript = (data: object) =>
  raw(`<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`)

export const Breadcrumbs = ({ items }: { items: Crumb[] }) => (
  <nav class="breadcrumbs" aria-label="Breadcrumb">
    {items.map((c, i) =>
      i < items.length - 1 ? (
        <>
          <a href={c.path}>{c.name}</a>
          <span aria-hidden="true"> › </span>
        </>
      ) : (
        <span aria-current="page">{c.name}</span>
      )
    )}
  </nav>
)

export const Layout = (props: Props) => {
  const { site, siteUrl, path, title, description, children } = props
  const siteName = site.name
  const icon = faviconUrl(site)
  const fullTitle = title ? `${title} | ${siteName}` : siteName
  const canonical = new URL(path, siteUrl).toString()
  const shareImage = props.image ?? (site.hero_image_key ? mediaUrl(site.hero_image_key) : undefined)
  const image = shareImage && new URL(shareImage, siteUrl).toString()

  return (
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{fullTitle}</title>
        {description && <meta name="description" content={description} />}
        {props.noindex && <meta name="robots" content="noindex" />}
        <link rel="canonical" href={canonical} />
        <link rel="icon" href={icon} />
        <link rel="apple-touch-icon" href={icon} />
        <meta name="theme-color" content="#c98a12" />

        <meta property="og:site_name" content={siteName} />
        <meta property="og:locale" content="vi_VN" />
        <meta property="og:type" content={props.type ?? 'website'} />
        <meta property="og:title" content={title ?? siteName} />
        {description && <meta property="og:description" content={description} />}
        <meta property="og:url" content={canonical} />
        {image && <meta property="og:image" content={image} />}
        <meta name="twitter:card" content="summary_large_image" />

        {props.googleVerification && <meta name="google-site-verification" content={props.googleVerification} />}
        <link rel="stylesheet" href={`/css/style.css?v=${props.assetVersion}`} />
        {(props.jsonLd ?? []).map(jsonScript)}
      </head>
      <body>
        <header class="site-header">
          <div class="container">
            <a href="/" class="logo">
              <img src={icon} alt="" width="34" height="34" />
              {siteName}
            </a>
            <nav class="main-nav" aria-label="Menu chính">
              {menuItems(props.nav, site).map((item) => {
                const active =
                  item.href === props.section || (item.href === '/' ? path === '/' : path.startsWith(item.href))
                return (
                  <a href={item.href} class={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
                    {item.label}
                  </a>
                )
              })}
            </nav>
          </div>
        </header>
        <main class="container">
          {props.breadcrumbs && <Breadcrumbs items={props.breadcrumbs} />}
          {children}
        </main>
        <footer class="site-footer">
          <div class="container footer-grid">
            <div>
              <strong>{siteName}</strong>
              <div class="footer-about">{raw(site.footer_html)}</div>
              {site.footer_contact === '1' && (site.phone || site.email) && (
              <p>
                {site.phone && (
                  <>
                    Điện thoại{site.zalo === '1' && ' / Zalo'}: <a href={`tel:${phoneIntl(site.phone)}`}>{phoneDisplay(site.phone)}</a>
                    <br />
                  </>
                )}
                {site.email && (
                  <>
                    Email: <a href={`mailto:${site.email}`}>{site.email}</a>
                  </>
                )}
              </p>
              )}
            </div>
            <div class="footer-links">
              <a href="/bai-viet">Tất cả bài viết</a>
              {props.nav.pages
                .filter((p) => p.show_in_footer)
                .map((p) => (
                  <a href={`/${p.slug}`}>{p.title}</a>
                ))}
              <a href="/lien-he">Liên hệ</a>
            </div>
          </div>
          <div class="container copyright">
            {copyrightText(site)}
          </div>
        </footer>
      </body>
    </html>
  )
}
