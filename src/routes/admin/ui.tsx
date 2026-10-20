import type { Child } from 'hono/jsx'

const SECTIONS = [
  { href: '/quan-tri/bai-viet', label: 'Bài viết' },
  { href: '/quan-tri/chuyen-muc', label: 'Chuyên mục bài viết' },
  { href: '/quan-tri/san-pham', label: 'Sản phẩm' },
  { href: '/quan-tri/danh-muc-san-pham', label: 'Danh mục sản phẩm' },
  { href: '/quan-tri/trang', label: 'Trang' },
  { href: '/quan-tri/anh', label: 'Thư viện ảnh' },
  { href: '/quan-tri/cai-dat', label: 'Cài đặt site' },
  { href: '/quan-tri/lien-he', label: 'Lời nhắn' },
  { href: '/quan-tri/doi-mat-khau', label: 'Đổi mật khẩu' },
]

const FLASH: Record<string, string> = {
  created: 'Đã tạo mới.',
  saved: 'Đã lưu thay đổi.',
  deleted: 'Đã xoá.',
}

/** Khung chung của mọi trang quản trị: menu bên trái, tiêu đề, nút thao tác */
export const AdminShell = (props: {
  title: string
  active: string
  actions?: Child
  flash?: string
  error?: string
  children?: Child
}) => (
  <div class="admin-layout">
    <aside class="admin-side">
      <nav>
        {SECTIONS.map((s) => (
          <a href={s.href} class={props.active === s.href ? 'active' : undefined}>
            {s.label}
          </a>
        ))}
      </nav>
      <form method="post" action="/quan-tri/dang-xuat">
        <button class="btn btn-outline" type="submit">
          Đăng xuất
        </button>
      </form>
    </aside>
    <section class="admin-main">
      <div class="admin-bar">
        <h1>{props.title}</h1>
        {props.actions && <div class="admin-actions">{props.actions}</div>}
      </div>
      {props.flash && FLASH[props.flash] && <p class="notice success">{FLASH[props.flash]}</p>}
      {props.error && <p class="notice error">{props.error}</p>}
      {props.children}
    </section>
    <script src="/js/admin.js" defer></script>
  </div>
)

/** Nút xoá có hộp xác nhận */
export const DeleteButton = ({ action, label }: { action: string; label: string }) => (
  <form method="post" action={action} class="inline-form" onsubmit={`return confirm(${JSON.stringify(`Xoá ${label}? Không thể hoàn tác.`)})`}>
    <button class="btn btn-danger" type="submit">
      Xoá
    </button>
  </form>
)

export const Badge = ({ on, yes, no }: { on: boolean | number; yes: string; no: string }) => (
  <span class={`badge ${on ? 'badge-on' : 'badge-off'}`}>{on ? yes : no}</span>
)

/** Đọc form gửi lên: chuỗi đã trim, số, checkbox */
export async function readForm(req: { parseBody: () => Promise<Record<string, unknown>> }) {
  const f = await req.parseBody()
  const s = (k: string) => (typeof f[k] === 'string' ? (f[k] as string).trim() : '')
  return {
    s,
    /** Chuỗi rỗng → null */
    opt: (k: string) => s(k) || null,
    int: (k: string, fallback = 0) => {
      const n = Number.parseInt(s(k).replace(/[.\s,]/g, ''), 10)
      return Number.isFinite(n) ? n : fallback
    },
    intOrNull: (k: string) => {
      const n = Number.parseInt(s(k).replace(/[.\s,]/g, ''), 10)
      return Number.isFinite(n) ? n : null
    },
    bool: (k: string) => (f[k] === 'on' || f[k] === '1' ? 1 : 0),
    /** Các checkbox tên <prefix><id> được chọn → danh sách id, theo thứ tự trong form */
    ids: (prefix: string) =>
      Object.keys(f)
        .filter((k) => k.startsWith(prefix) && (f[k] === 'on' || f[k] === '1'))
        .map((k) => Number(k.slice(prefix.length)))
        .filter((n) => Number.isInteger(n) && n > 0),
    /** Giữ xuống dòng (cho textarea) */
    text: (k: string) => (typeof f[k] === 'string' ? (f[k] as string).replace(/\r\n/g, '\n').trim() : ''),
  }
}

export const parseId = (raw: string) => {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}
