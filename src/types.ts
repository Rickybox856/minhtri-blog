import type { PageLink, PostCategory } from './lib/db'
import type { EarlySettings } from './lib/early-settings'
import type { SiteConfig } from './lib/site-config'

// Dữ liệu dùng chung cho mọi trang HTML (menu, footer), nạp một lần mỗi request
export type SiteNav = {
  postCategories: PostCategory[]
  pages: PageLink[]
}

export type AppEnv = {
  Bindings: CloudflareBindings
  Variables: { nav: SiteNav; site: SiteConfig; early: EarlySettings }
}
