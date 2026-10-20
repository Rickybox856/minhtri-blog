import type { Context } from 'hono'
import type { AppEnv } from '../types'
import type { Post } from './db'
import { mediaUrl } from './format'
import type { SiteConfig } from './site-config'
import { phoneIntl } from './site-config'

export type Crumb = { name: string; path: string }

/** Địa chỉ gốc của site: tên miền chính đã cài đặt, không có thì theo địa chỉ đang truy cập (vd. <tên>.workers.dev) */
export const siteOrigin = (c: Context<AppEnv>) => c.get('early').siteUrl || new URL(c.req.url).origin

export const absoluteUrl = (siteUrl: string, path: string) => new URL(path, siteUrl).toString()

// D1 lưu "YYYY-MM-DD HH:MM:SS" theo UTC
export const isoDate = (value: string | null) => (value ? value.replace(' ', 'T') + 'Z' : undefined)

const ownerJsonLd = (siteUrl: string, site: SiteConfig) => ({
  '@type': 'Person',
  '@id': `${siteUrl}/#owner`,
  name: site.owner_name,
  jobTitle: site.owner_role || undefined,
  url: absoluteUrl(siteUrl, '/gioi-thieu#tac-gia'),
})

export const organizationJsonLd = (siteUrl: string, site: SiteConfig, logo: string) => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${siteUrl}/#organization`,
  name: site.name,
  url: siteUrl,
  logo: absoluteUrl(siteUrl, logo),
  email: site.email || undefined,
  telephone: phoneIntl(site.phone) || undefined,
  founder: site.owner_name ? ownerJsonLd(siteUrl, site) : undefined,
  contactPoint:
    site.phone || site.email
      ? {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          telephone: phoneIntl(site.phone) || undefined,
          email: site.email || undefined,
          availableLanguage: 'vi',
        }
      : undefined,
})

export const websiteJsonLd = (siteUrl: string, siteName: string) => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${siteUrl}/#website`,
  name: siteName,
  url: siteUrl,
  inLanguage: 'vi',
  publisher: { '@id': `${siteUrl}/#organization` },
})

export const breadcrumbJsonLd = (siteUrl: string, crumbs: Crumb[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: crumbs.map((c, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: c.name,
    item: absoluteUrl(siteUrl, c.path),
  })),
})

export const articleJsonLd = (siteUrl: string, post: Post, site: SiteConfig) => ({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: post.title,
  description: post.excerpt,
  inLanguage: 'vi',
  mainEntityOfPage: absoluteUrl(siteUrl, `/bai-viet/${post.slug}`),
  datePublished: isoDate(post.published_at),
  dateModified: isoDate(post.updated_at),
  image: post.cover_key ? [absoluteUrl(siteUrl, mediaUrl(post.cover_key))] : undefined,
  author:
    post.author && post.author !== site.owner_name
      ? { '@type': 'Person', name: post.author }
      : site.owner_name
        ? ownerJsonLd(siteUrl, site)
        : undefined,
  publisher: { '@id': `${siteUrl}/#organization` },
})
