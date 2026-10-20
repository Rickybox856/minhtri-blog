const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' })

export const formatPrice = (price: number | null) => (price == null ? 'Liên hệ' : vnd.format(price))

// D1 lưu datetime('now') dạng "YYYY-MM-DD HH:MM:SS" theo UTC
export const formatDate = (value: string | null) =>
  value
    ? new Date(value.replace(' ', 'T') + 'Z').toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    : ''

// Ảnh đi thẳng từ R2 qua tên miền riêng (biến MEDIA_BASE, vd. https://anh.tenmien.com):
// được CDN Cloudflare cache và không tốn request Worker (gói miễn phí: 100.000 request/ngày).
// MEDIA_BASE trống (wrangler dev, site chưa gắn tên miền ảnh) thì dùng /media/<key> qua Worker.
let mediaBase = '/media'

export const setMediaBase = (base: string | undefined) => {
  mediaBase = base ? base.replace(/\/+$/, '') : '/media'
}

export const mediaUrl = (key: string) => `${mediaBase}/${key.split('/').map(encodeURIComponent).join('/')}`

/** Nội dung bài/trang lưu link dạng /media/...; đổi sang tên miền ảnh lúc hiển thị */
export const withMediaBase = (html: string) =>
  mediaBase === '/media' ? html : html.replaceAll('"/media/', `"${mediaBase}/`)
