import { Hono } from 'hono'
import { hashPassword } from '../../lib/auth'
import { formatDate } from '../../lib/format'
import { AdminShell, Badge, DeleteButton } from './ui'

// /quan-tri/thanh-vien: xem, khoá/mở khoá, đặt lại mật khẩu, xoá thành viên
const app = new Hono<{ Bindings: CloudflareBindings }>()
const BASE = '/quan-tri/thanh-vien'

type Row = { id: number; email: string; name: string; nickname: string | null; disabled: number; created_at: string; last_login_at: string | null }

// Mật khẩu tạm dễ đọc (bỏ các ký tự dễ nhầm như 0/O, 1/l)
function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return [...crypto.getRandomValues(new Uint8Array(12))].map((b) => chars[b % chars.length]).join('')
}

app.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim()
  const where = q ? 'WHERE email LIKE ?1 OR name LIKE ?1 OR nickname LIKE ?1' : ''
  const stmt = c.env.DB.prepare(
    `SELECT id, email, name, nickname, disabled, created_at, last_login_at FROM members ${where} ORDER BY id DESC LIMIT 500`
  )
  const [{ results }, total] = await Promise.all([
    (q ? stmt.bind(`%${q}%`) : stmt).all<Row>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM members').first<{ n: number }>(),
  ])
  return c.render(
    <AdminShell title="Thành viên" active={BASE} flash={c.req.query('ok')}>
      <p class="lead">
        Tổng cộng {total?.n ?? 0} thành viên. Khách tự đăng ký miễn phí tại{' '}
        <a href="/thanh-vien/dang-ky" target="_blank" rel="noopener">/thanh-vien/dang-ky</a> để nghe âm thanh và xem video.
      </p>
      <form method="get" action={BASE} class="admin-search">
        <input type="search" name="q" value={q} placeholder="Tìm theo email hoặc tên" />
        <button class="btn btn-outline" type="submit">Tìm</button>
      </form>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Email / Tên</th>
            <th>Trạng thái</th>
            <th>Đăng ký</th>
            <th>Đăng nhập gần nhất</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {results.map((m) => (
            <tr>
              <td>
                <strong>{m.email}</strong>
                {m.name && <div class="muted">{m.name}</div>}
                {m.nickname && <div class="muted">Biệt danh: {m.nickname}</div>}
              </td>
              <td>
                <Badge on={!m.disabled} yes="Hoạt động" no="Đã khoá" />
              </td>
              <td>{formatDate(m.created_at)}</td>
              <td>{m.last_login_at ? formatDate(m.last_login_at) : <span class="muted">Chưa</span>}</td>
              <td class="row-actions">
                <form method="post" action={`${BASE}/${m.id}/khoa`} class="inline-form">
                  <button class="btn btn-outline" type="submit">{m.disabled ? 'Mở khoá' : 'Khoá'}</button>
                </form>{' '}
                <form
                  method="post"
                  action={`${BASE}/${m.id}/dat-lai-mat-khau`}
                  class="inline-form"
                  onsubmit={`return confirm(${JSON.stringify(`Đặt lại mật khẩu cho ${m.email}?`)})`}
                >
                  <button class="btn btn-outline" type="submit">Đặt lại mật khẩu</button>
                </form>{' '}
                <DeleteButton action={`${BASE}/${m.id}/xoa`} label={`thành viên ${m.email}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!results.length && <p class="muted">{q ? 'Không tìm thấy thành viên nào.' : 'Chưa có thành viên nào.'}</p>}
    </AdminShell>,
    { title: 'Quản trị: Thành viên', noindex: true }
  )
})

// Khoá thì đăng xuất luôn mọi thiết bị của người đó
app.post('/:id/khoa', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE members SET disabled = 1 - disabled WHERE id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM member_sessions WHERE member_id = ? AND (SELECT disabled FROM members WHERE id = ?) = 1').bind(id, id),
  ])
  return c.redirect(`${BASE}?ok=saved`, 303)
})

app.post('/:id/dat-lai-mat-khau', async (c) => {
  const id = Number(c.req.param('id'))
  const m = await c.env.DB.prepare('SELECT email FROM members WHERE id = ?').bind(id).first<{ email: string }>()
  if (!m) return c.redirect(BASE, 303)
  const pass = tempPassword()
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE members SET password_hash = ? WHERE id = ?').bind(await hashPassword(pass), id),
    c.env.DB.prepare('DELETE FROM member_sessions WHERE member_id = ?').bind(id),
  ])
  // Hiện thẳng trên trang (không đưa vào URL để khỏi lưu trong lịch sử trình duyệt)
  return c.render(
    <AdminShell title="Đặt lại mật khẩu" active={BASE}>
      <p class="notice success">
        Đã đặt lại mật khẩu cho <strong>{m.email}</strong>. Mật khẩu tạm: <code class="temp-pass">{pass}</code>
      </p>
      <p>
        Hãy gửi mật khẩu này cho thành viên và nhắc họ đổi lại trong マイページ. Mật khẩu chỉ hiện một lần, các thiết bị
        của họ đã bị đăng xuất.
      </p>
      <p>
        <a class="btn" href={BASE}>← Về danh sách thành viên</a>
      </p>
    </AdminShell>,
    { title: 'Quản trị: Đặt lại mật khẩu', noindex: true }
  )
})

app.post('/:id/xoa', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM member_sessions WHERE member_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM members WHERE id = ?').bind(id),
  ])
  return c.redirect(`${BASE}?ok=deleted`, 303)
})

export default app
