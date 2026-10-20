import { mediaUrl } from './format'

// Cấu hình site sửa được trong /quan-tri/cai-dat, lưu ở bảng settings với key "site.<tên>".
// Chỉ đọc các key "site.*" để không bao giờ lẫn mã băm mật khẩu / khoá phiên ra trang công khai.
export type SiteConfig = {
  name: string
  favicon_key: string
  home_description: string
  hero_eyebrow: string
  hero_title: string
  hero_lead: string
  hero_image_key: string
  hero_image_alt: string
  home_products: string
  products_enabled: string
  footer_md: string
  footer_html: string
  footer_contact: string
  copyright: string
  owner_name: string
  owner_role: string
  phone: string
  email: string
  zalo: string
  address: string
  facebook: string
  contact_intro_md: string
  contact_intro_html: string
  contact_form: string
  shop_name: string
  products_intro: string
  site_url: string
  media_base: string
  google_verification: string
}

export const DEFAULT_SITE_CONFIG: Omit<SiteConfig, 'name'> = {
  favicon_key: '',
  home_description: 'Blog cá nhân: ghi chép, chia sẻ kinh nghiệm và những câu chuyện.',
  hero_eyebrow: 'Ghi chép · Chia sẻ · Câu chuyện',
  hero_title: '',
  hero_lead:
    'Chào mừng bạn! Đây là nơi chia sẻ bài viết, kinh nghiệm và câu chuyện. Sửa đoạn này trong Quản trị → Cài đặt site.',
  hero_image_key: '',
  hero_image_alt: '',
  home_products: '4',
  products_enabled: '0',
  footer_md:
    'Blog dựng bằng [MinhTri Blog Cloudflare](https://github.com/nhakhtn/minhtri-blog-cloudflare), chạy miễn phí trên Cloudflare.',
  footer_html:
    '<p>Blog dựng bằng <a href="https://github.com/nhakhtn/minhtri-blog-cloudflare">MinhTri Blog Cloudflare</a>, chạy miễn phí trên Cloudflare.</p>\n',
  footer_contact: '1',
  copyright: '© {năm} {tên}.',
  owner_name: '',
  owner_role: '',
  phone: '',
  email: '',
  zalo: '0',
  address: '',
  facebook: '',
  contact_intro_md: '',
  contact_intro_html: '',
  contact_form: '1',
  shop_name: '',
  products_intro: 'Các sản phẩm được chúng tôi lựa chọn.',
  site_url: '',
  media_base: '',
  google_verification: '',
}

export const SITE_CONFIG_KEYS = ['name', ...Object.keys(DEFAULT_SITE_CONFIG)] as (keyof SiteConfig)[]

/** Đọc cấu hình; key chưa lưu thì dùng mặc định (tên site mặc định lấy từ biến SITE_NAME) */
export async function getSiteConfig(db: D1Database, fallbackName: string): Promise<SiteConfig> {
  const { results } = await db
    .prepare("SELECT key, value FROM settings WHERE key LIKE 'site.%'")
    .all<{ key: string; value: string }>()
  const config: SiteConfig = { ...DEFAULT_SITE_CONFIG, name: fallbackName }
  for (const row of results) {
    const k = row.key.slice(5) as keyof SiteConfig
    if (SITE_CONFIG_KEYS.includes(k)) config[k] = row.value
  }
  if (!config.name) config.name = fallbackName
  return config
}

export const faviconUrl = (config: Pick<SiteConfig, 'favicon_key'>) =>
  config.favicon_key ? mediaUrl(config.favicon_key) : '/favicon.svg'

export const productsEnabled = (config: Pick<SiteConfig, 'products_enabled'>) => config.products_enabled !== '0'

const phoneDigits = (phone: string) => phone.replace(/D/g, '')

/** 0901234567 → "0901 234 567" */
export const phoneDisplay = (phone: string) => {
  const d = phoneDigits(phone)
  return d.length === 10 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : phone
}

/** 0901234567 → "+84901234567" (dùng cho tel: và dữ liệu Google) */
export const phoneIntl = (phone: string) => {
  const d = phoneDigits(phone)
  return d.startsWith('0') ? `+84${d.slice(1)}` : d ? `+${d}` : ''
}

export const zaloUrl = (phone: string) => `https://zalo.me/${phoneDigits(phone)}`

/** Thay {năm} và {tên} trong dòng copyright */
export const copyrightText = (config: SiteConfig) =>
  config.copyright.replaceAll('{năm}', String(new Date().getFullYear())).replaceAll('{tên}', config.name)
