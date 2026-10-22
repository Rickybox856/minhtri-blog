import { Hono } from 'hono'
import { formatDateTime } from '../../lib/forum'
import { AdminShell, Badge } from './ui'

// /quan-tri/dien-dan: kiểm duyệt diễn đàn (bài bị báo cáo / bị ẩn, bài mới), ẩn – hiện – xoá
const app = new Hono<{ Bindings: CloudflareBindings }>()
const BASE = '/quan-tri/dien-dan'

type Item = {
  type: 'thread' | 'reply'
  id: number
  thread_id: number
  title: string
  body: string
  status: 'visible' | 'hidden' | 'deleted'
  report_count: number
  anonymous: number
  created_at: string
  email: string | null
  nickname: string | null
  reasons: string | null
}

const STATUS_LABEL = { visible: 'Đang hiện', hidden: 'Đang ẩn', deleted: 'Đã xoá' }

const ITEMS_SQL = (where: string) => `
  SELECT * FROM (
    SELECT 'thread' AS type, t.id, t.id AS thread_id, t.title, t.body, t.status, t.report_count, t.anonymous, t.created_at,
      m.email, m.nickname,
      (SELECT group_concat(reason, '、') FROM forum_reports WHERE target_type = 'thread' AND target_id = t.id) AS reasons
    FROM forum_threads t LEFT JOIN members m ON m.id = t.member_id
    UNION ALL
    SELECT 'reply', r.id, r.thread_id, t.title, r.body, r.status, r.report_count, r.anonymous, r.created_at,
      m.email, m.nickname,
      (SELECT group_concat(reason, '、') FROM forum_reports WHERE target_type = 'reply' AND target_id = r.id)
    FROM forum_replies r JOIN forum_threads t ON t.id = r.thread_id LEFT JOIN members m ON m.id = r.member_id
  ) ${where}
  ORDER BY created_at DESC LIMIT 200`

app.get('/', async (c) => {
  const tab = c.req.query('xem') === 'moi' ? 'moi' : 'can-xem'
  const where = tab === 'moi' ? '' : "WHERE status = 'hidden' OR (status = 'visible' AND report_count > 0)"
  const [{ results }, pending] = await Promise.all([
    c.env.DB.prepare(ITEMS_SQL(where)).all<Item>(),
    c.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM forum_threads WHERE status = 'hidden' OR (status = 'visible' AND report_count > 0))
            + (SELECT COUNT(*) FROM forum_replies WHERE status = 'hidden' OR (status = 'visible' AND report_count > 0)) AS n`
    ).first<{ n: number }>(),
  ])

  const act = (it: Item, path: string, label: string, cls = 'btn btn-outline', confirmText?: string) => (
    <form
      method="post"
      action={`${BASE}/${it.type}/${it.id}/${path}`}
      class="inline-form"
      onsubmit={confirmText ? `return confirm(${JSON.stringify(confirmText)})` : undefined}
    >
      <button class={cls} type="submit">{label}</button>
    </form>
  )

  return c.render(
    <AdminShell title="Diễn đàn" active={BASE} flash={c.req.query('ok')}>
      <p class="lead">
        Diễn đàn công khai tại{' '}
        <a href="/dien-dan" target="_blank" rel="noopener">/dien-dan</a>. Bài hiện ngay khi đăng; bài bị 3 thành viên khác nhau báo
        cáo sẽ tự ẩn chờ bạn xem.
      </p>
      <p class="admin-tabs">
        <a href={BASE} class={tab === 'can-xem' ? 'btn' : 'btn btn-outline'}>Cần xem ({pending?.n ?? 0})</a>{' '}
        <a href={`${BASE}?xem=moi`} class={tab === 'moi' ? 'btn' : 'btn btn-outline'}>Bài mới nhất</a>
      </p>
      {!results.length && <p class="muted">{tab === 'moi' ? 'Chưa có bài nào.' : 'Không có bài nào cần xem. 👍'}</p>}
      <div class="forum-mod-list">
        {results.map((it) => (
          <article class="card forum-mod-item">
            <div class="forum-mod-head">
              <strong>{it.type === 'thread' ? 'Chủ đề' : 'Trả lời'}</strong>
              <span>
                trong{' '}
                <a href={`/dien-dan/chu-de/${it.thread_id}`} target="_blank" rel="noopener">
                  {it.title}
                </a>
              </span>
              <Badge on={it.status === 'visible'} yes={STATUS_LABEL.visible} no={STATUS_LABEL[it.status]} />
              {it.report_count > 0 && <span class="badge badge-off">Báo cáo: {it.report_count}</span>}
            </div>
            <p class="muted">
              {it.anonymous ? 'Ẩn danh' : it.nickname || '(chưa đặt biệt danh)'} · {it.email ?? '(tài khoản đã xoá)'} ·{' '}
              {formatDateTime(it.created_at)} (giờ Nhật)
              {it.reasons && <> · Lý do: {it.reasons}</>}
            </p>
            <p class="forum-mod-body">{it.body.length > 400 ? `${it.body.slice(0, 400)}…` : it.body}</p>
            <div class="row-actions forum-mod-actions">
              {it.status !== 'visible' && act(it, 'hien', 'Hiện lại')}
              {it.status === 'visible' && act(it, 'an', 'Ẩn')}
              {it.status === 'visible' && it.report_count > 0 && act(it, 'bo-qua', 'Bỏ qua báo cáo')}
              {it.status !== 'deleted' && act(it, 'xoa', 'Xoá', 'btn btn-danger', 'Xoá bài này? Người đọc sẽ thấy "đã bị xoá".')}
              {it.email && (
                <a class="btn btn-outline" href={`/quan-tri/thanh-vien?q=${encodeURIComponent(it.email)}`}>
                  Xem thành viên
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </AdminShell>,
    { title: 'Quản trị: Diễn đàn', noindex: true }
  )
})

const TABLES = { thread: 'forum_threads', reply: 'forum_replies' } as const

app.post('/:type/:id/:action', async (c) => {
  const table = TABLES[c.req.param('type') as keyof typeof TABLES]
  const id = Number(c.req.param('id'))
  const sql = {
    an: `UPDATE ${table} SET status = 'hidden' WHERE id = ?`,
    hien: `UPDATE ${table} SET status = 'visible', report_count = 0 WHERE id = ?`,
    'bo-qua': `UPDATE ${table} SET report_count = 0 WHERE id = ?`,
    xoa: `UPDATE ${table} SET status = 'deleted' WHERE id = ?`,
  }[c.req.param('action')]
  if (!table || !sql || !Number.isInteger(id)) return c.notFound()
  await c.env.DB.batch([
    c.env.DB.prepare(sql).bind(id),
    // Hiện lại / bỏ qua: xoá các báo cáo cũ để bài không bị ẩn lại ngay
    ...(['hien', 'bo-qua'].includes(c.req.param('action'))
      ? [c.env.DB.prepare('DELETE FROM forum_reports WHERE target_type = ? AND target_id = ?').bind(c.req.param('type'), id)]
      : []),
  ])
  return c.redirect(`${BASE}?ok=saved`, 303)
})

export default app
