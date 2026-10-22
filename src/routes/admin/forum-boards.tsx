import { Hono } from 'hono'
import { isValidSlug, slugify } from '../../lib/slug'
import { AdminShell, parseId, readForm } from './ui'

// /quan-tri/chuyen-muc-dien-dan: thêm, sửa, sắp xếp, xoá chuyên mục của diễn đàn (/dien-dan/<slug>)
const app = new Hono<{ Bindings: CloudflareBindings }>()
const BASE = '/quan-tri/chuyen-muc-dien-dan'

// Các đường dẫn cố định của diễn đàn: slug chuyên mục không được trùng (xem routes/forum.tsx)
const RESERVED = new Set(['moi', 'quy-dinh', 'chu-de', 'bao-cao', 'xoa', 'trang'])

type BoardRow = {
  id: number
  slug: string
  name: string
  description: string
  sort_order: number
  thread_count: number
  visible_count: number
}
type Values = { id?: number; slug?: string; name?: string; description?: string; sort_order?: number }

const listBoards = async (db: D1Database) =>
  (
    await db
      .prepare(
        `SELECT b.*,
           (SELECT COUNT(*) FROM forum_threads t WHERE t.board_id = b.id) AS thread_count,
           (SELECT COUNT(*) FROM forum_threads t WHERE t.board_id = b.id AND t.status = 'visible') AS visible_count
         FROM forum_boards b ORDER BY b.sort_order, b.id`
      )
      .all<BoardRow>()
  ).results

const BoardForm = ({ values }: { values: Values }) => (
  <form method="post" action={values.id ? `${BASE}/${values.id}` : `${BASE}/moi`} class="form">
    <label>
      Tên chuyên mục (tiếng Nhật, hiện trên diễn đàn)
      <input name="name" required maxlength={40} value={values.name ?? ''} placeholder="例: 夫婦・恋愛" />
    </label>
    <label>
      Đường dẫn (slug) — trang chuyên mục sẽ là /dien-dan/&lt;slug&gt;
      <input name="slug" value={values.slug ?? ''} placeholder="vd. fuufu-renai" pattern="[a-z0-9]+(-[a-z0-9]+)*" />
      <small class="muted">Chữ thường không dấu, số và dấu gạch ngang. Để trống sẽ tự tạo từ tên (tên tiếng Nhật thì nên tự đặt).</small>
    </label>
    <label>
      Mô tả ngắn (hiện dưới tên chuyên mục)
      <textarea name="description" rows={2} maxlength={120}>
        {values.description ?? ''}
      </textarea>
    </label>
    <label>
      Thứ tự hiển thị (số nhỏ đứng trước)
      <input name="sort_order" type="number" value={String(values.sort_order ?? 0)} />
    </label>
    <div class="form-actions">
      <button class="btn" type="submit">{values.id ? 'Lưu thay đổi' : 'Tạo chuyên mục'}</button>
      <a href={BASE}>Huỷ</a>
    </div>
  </form>
)

async function parseForm(req: Parameters<typeof readForm>[0]) {
  const f = await readForm(req)
  const name = f.s('name')
  const values = {
    name,
    slug: f.s('slug') || slugify(name),
    description: f.s('description'),
    sort_order: f.int('sort_order'),
  }
  const error = !name
    ? 'Vui lòng nhập tên chuyên mục.'
    : !values.slug
      ? 'Tên tiếng Nhật không tự tạo được đường dẫn. Vui lòng tự nhập đường dẫn (vd. fuufu-renai).'
      : !isValidSlug(values.slug)
        ? 'Đường dẫn chỉ gồm chữ thường không dấu, số và dấu gạch ngang.'
        : RESERVED.has(values.slug)
          ? `Đường dẫn "${values.slug}" trùng với trang có sẵn của diễn đàn. Hãy chọn đường dẫn khác.`
          : undefined
  return { values, error }
}

const isUnique = (err: unknown) => String(err).includes('UNIQUE')

app.get('/', async (c) => {
  const boards = await listBoards(c.env.DB)
  return c.render(
    <AdminShell
      title="Chuyên mục diễn đàn"
      active={BASE}
      flash={c.req.query('ok')}
      actions={<a class="btn" href={`${BASE}/moi`}>+ Thêm chuyên mục</a>}
    >
      <p class="muted">
        Các chuyên mục hiện trên trang <a href="/dien-dan" target="_blank" rel="noopener">/dien-dan</a> theo thứ tự bên dưới.
        Thành viên chọn chuyên mục khi đăng chủ đề mới.
      </p>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Tên</th>
            <th>Đường dẫn</th>
            <th>Chủ đề (đang hiện)</th>
            <th>Thứ tự</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {boards.map((b) => (
            <tr>
              <td>
                <a href={`${BASE}/${b.id}`}><strong>{b.name}</strong></a>
                {b.description && <div class="muted">{b.description}</div>}
              </td>
              <td class="muted">/dien-dan/{b.slug}</td>
              <td>
                {b.thread_count} ({b.visible_count})
              </td>
              <td>{b.sort_order}</td>
              <td class="row-actions">
                <a href={`${BASE}/${b.id}`}>Sửa</a>
                <a href={`/dien-dan/${b.slug}`} target="_blank" rel="noopener">Xem</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!boards.length && <p class="muted">Chưa có chuyên mục nào. Thành viên cần ít nhất một chuyên mục để đăng bài.</p>}
    </AdminShell>,
    { title: 'Quản trị: Chuyên mục diễn đàn', noindex: true }
  )
})

app.get('/moi', (c) =>
  c.render(
    <AdminShell title="Thêm chuyên mục diễn đàn" active={BASE}>
      <BoardForm values={{}} />
    </AdminShell>,
    { title: 'Thêm chuyên mục diễn đàn', noindex: true }
  )
)

app.post('/moi', async (c) => {
  const { values, error } = await parseForm(c.req)
  const fail = (msg: string) => {
    c.status(400)
    return c.render(
      <AdminShell title="Thêm chuyên mục diễn đàn" active={BASE} error={msg}>
        <BoardForm values={values} />
      </AdminShell>,
      { title: 'Thêm chuyên mục diễn đàn', noindex: true }
    )
  }
  if (error) return fail(error)
  try {
    await c.env.DB.prepare('INSERT INTO forum_boards (slug, name, description, sort_order) VALUES (?, ?, ?, ?)')
      .bind(values.slug, values.name, values.description, values.sort_order)
      .run()
    return c.redirect(`${BASE}?ok=created`, 303)
  } catch (err) {
    if (isUnique(err)) return fail(`Đường dẫn "${values.slug}" đã được dùng.`)
    throw err
  }
})

/** Form xoá: nếu còn chủ đề thì bắt buộc chọn chuyên mục nhận chủ đề */
const DeleteForm = ({ board, others }: { board: BoardRow; others: BoardRow[] }) => (
  <section class="danger-zone">
    <h2>Xoá chuyên mục</h2>
    {board.thread_count > 0 && !others.length ? (
      <p class="muted">Chuyên mục còn {board.thread_count} chủ đề và không có chuyên mục khác để chuyển sang, nên chưa xoá được.</p>
    ) : (
      <form
        method="post"
        action={`${BASE}/${board.id}/xoa`}
        class="form"
        onsubmit={`return confirm(${JSON.stringify(`Xoá chuyên mục "${board.name}"? Không thể hoàn tác.`)})`}
      >
        {board.thread_count > 0 && (
          <label>
            Chuyển {board.thread_count} chủ đề hiện có sang
            <select name="move_to" required>
              {others.map((o) => (
                <option value={String(o.id)}>{o.name}</option>
              ))}
            </select>
          </label>
        )}
        <button class="btn btn-danger" type="submit">Xoá chuyên mục</button>
      </form>
    )}
  </section>
)

const getBoardRow = async (db: D1Database, id: number) => (await listBoards(db)).find((b) => b.id === id)

app.get('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  const boards = id ? await listBoards(c.env.DB) : []
  const board = boards.find((b) => b.id === id)
  if (!board) return c.notFound()
  return c.render(
    <AdminShell title="Sửa chuyên mục diễn đàn" active={BASE} flash={c.req.query('ok')}>
      <p class="muted">
        Đổi đường dẫn thì các chủ đề vẫn giữ nguyên, nhưng link cũ /dien-dan/{board.slug} sẽ không còn.
      </p>
      <BoardForm values={board} />
      <DeleteForm board={board} others={boards.filter((b) => b.id !== board.id)} />
    </AdminShell>,
    { title: `Sửa: ${board.name}`, noindex: true }
  )
})

app.post('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id || !(await getBoardRow(c.env.DB, id))) return c.notFound()
  const { values, error } = await parseForm(c.req)
  const fail = (msg: string) => {
    c.status(400)
    return c.render(
      <AdminShell title="Sửa chuyên mục diễn đàn" active={BASE} error={msg}>
        <BoardForm values={{ ...values, id }} />
      </AdminShell>,
      { title: 'Sửa chuyên mục diễn đàn', noindex: true }
    )
  }
  if (error) return fail(error)
  try {
    await c.env.DB.prepare('UPDATE forum_boards SET slug = ?, name = ?, description = ?, sort_order = ? WHERE id = ?')
      .bind(values.slug, values.name, values.description, values.sort_order, id)
      .run()
    return c.redirect(`${BASE}/${id}?ok=saved`, 303)
  } catch (err) {
    if (isUnique(err)) return fail(`Đường dẫn "${values.slug}" đã được dùng.`)
    throw err
  }
})

app.post('/:id/xoa', async (c) => {
  const id = parseId(c.req.param('id'))
  const board = id ? await getBoardRow(c.env.DB, id) : undefined
  if (!board) return c.redirect(BASE, 303)
  const moveTo = parseId(String((await c.req.parseBody()).move_to ?? ''))
  if (board.thread_count > 0) {
    // Phải chuyển chủ đề sang một chuyên mục khác còn tồn tại
    if (!moveTo || moveTo === board.id || !(await getBoardRow(c.env.DB, moveTo))) return c.redirect(`${BASE}/${board.id}`, 303)
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE forum_threads SET board_id = ? WHERE board_id = ?').bind(moveTo, board.id),
      c.env.DB.prepare('DELETE FROM forum_boards WHERE id = ?').bind(board.id),
    ])
  } else {
    await c.env.DB.prepare('DELETE FROM forum_boards WHERE id = ?').bind(board.id).run()
  }
  return c.redirect(`${BASE}?ok=deleted`, 303)
})

export default app
