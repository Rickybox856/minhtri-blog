// Tự đăng bài diễn đàn viết sẵn (bảng forum_scheduled) khi đến giờ, dưới tên 相談広場スタッフ.
// Chạy trong cron mỗi giờ; mỗi lần tối đa MAX_PER_RUN bài để lỡ cron vẫn không dồn cục.

export const STAFF_EMAIL = 'forum-staff@nipponbroadcastingsystem.invalid'
export const STAFF_NAME = '相談広場スタッフ'
const MAX_PER_RUN = 1

type Env = { DB: D1Database }
export type ScheduledRow = { id: number; board_slug: string; title: string; body: string; publish_at: string; thread_id: number | null }

/** Tài khoản đăng bài của ban quản trị: bị khoá, không đăng nhập được */
async function staffId(db: D1Database) {
  await db
    .prepare(
      `INSERT INTO members (email, name, password_hash, disabled, nickname) SELECT ?, ?, '!', 1, ?
       WHERE NOT EXISTS (SELECT 1 FROM members WHERE email = ?)`
    )
    .bind(STAFF_EMAIL, STAFF_NAME, STAFF_NAME, STAFF_EMAIL)
    .run()
  const row = await db.prepare('SELECT id FROM members WHERE email = ?').bind(STAFF_EMAIL).first<{ id: number }>()
  return row!.id
}

/** Đăng một bài chờ thành chủ đề diễn đàn. Trả về id chủ đề, hoặc null nếu bài đã được đăng */
export async function publishScheduled(db: D1Database, row: ScheduledRow) {
  const board = await db.prepare('SELECT id FROM forum_boards WHERE slug = ?').bind(row.board_slug).first<{ id: number }>()
  if (!board) throw new Error(`Không có chuyên mục ${row.board_slug}`)
  // Giành bài trước (thread_id = 0) để hai lần chạy cùng lúc không đăng trùng
  const claim = await db.prepare('UPDATE forum_scheduled SET thread_id = 0 WHERE id = ? AND thread_id IS NULL').bind(row.id).run()
  if (!claim.meta.changes) return null
  try {
    const t = await db
      .prepare('INSERT INTO forum_threads (board_id, member_id, title, body, anonymous) VALUES (?, ?, ?, ?, 0) RETURNING id')
      .bind(board.id, await staffId(db), row.title, row.body)
      .first<{ id: number }>()
    await db.prepare('UPDATE forum_scheduled SET thread_id = ? WHERE id = ?').bind(t!.id, row.id).run()
    return t!.id
  } catch (err) {
    await db.prepare('UPDATE forum_scheduled SET thread_id = NULL WHERE id = ?').bind(row.id).run()
    throw err
  }
}

export async function runForumSchedule(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM forum_scheduled WHERE thread_id IS NULL AND publish_at <= datetime('now') ORDER BY publish_at, id LIMIT ${MAX_PER_RUN}`
  ).all<ScheduledRow>()
  const posted: number[] = []
  for (const row of results) {
    const id = await publishScheduled(env.DB, row)
    if (id) posted.push(id)
  }
  return { posted }
}
