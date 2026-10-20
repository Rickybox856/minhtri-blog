import type { MiddlewareHandler } from 'hono'
import { jsxRenderer } from 'hono/jsx-renderer'
import type { SeoProps } from './components/Layout'
import { Layout } from './components/Layout'
import { listNavCategories, listNavPages } from './lib/db'
import { optionalEnv } from './lib/early-settings'
import { breadcrumbJsonLd, organizationJsonLd, siteOrigin, websiteJsonLd } from './lib/seo'
import { DEFAULT_SITE_CONFIG, faviconUrl, getSiteConfig } from './lib/site-config'
import type { AppEnv } from './types'

declare module 'hono' {
  interface ContextRenderer {
    (content: string | Promise<string>, props?: SeoProps): Response | Promise<Response>
  }
}

// Nạp cấu hình site, chuyên mục và trang tĩnh cho menu/footer
export const loadNav: MiddlewareHandler<AppEnv> = async (c, next) => {
  const [site, postCategories, pages] = await Promise.all([
    getSiteConfig(c.env.DB, c.env.SITE_NAME),
    listNavCategories(c.env.DB),
    listNavPages(c.env.DB),
  ])
  c.set('site', site)
  c.set('nav', { postCategories, pages })
  await next()
}

export const renderer = jsxRenderer<AppEnv>(
  ({ children, ...seo }, c) => {
    const SITE_URL = siteOrigin(c)
    const site = c.get('site') ?? { ...DEFAULT_SITE_CONFIG, name: c.env.SITE_NAME }
    const jsonLd = [
      organizationJsonLd(SITE_URL, site, faviconUrl(site)),
      websiteJsonLd(SITE_URL, site.name),
      ...(seo.breadcrumbs ? [breadcrumbJsonLd(SITE_URL, seo.breadcrumbs)] : []),
      ...(seo.jsonLd ?? []),
    ]
    return (
      <Layout
        {...seo}
        jsonLd={jsonLd}
        site={site}
        siteUrl={SITE_URL}
        path={new URL(c.req.url).pathname}
        googleVerification={optionalEnv(c.env, 'GOOGLE_SITE_VERIFICATION') || site.google_verification}
        assetVersion={c.env.CF_VERSION_METADATA?.id.slice(0, 8) ?? 'dev'}
        nav={c.get('nav') ?? { postCategories: [], pages: [] }}
      >
        {children}
      </Layout>
    )
  },
  { docType: true }
)
