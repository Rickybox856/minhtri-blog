// Diễn đàn みんなの相談広場: truy vấn và quy tắc chung (xem migrations/0009_forum.sql)

export const THREADS_PER_PAGE = 20
export const REPORT_HIDE_AT = 3 // số báo cáo khác nhau để tự ẩn bài chờ quản trị xem
export const TITLE_MAX = 80
export const BODY_MAX = 5000
export const BODY_MIN = 10
export const LIMITS = { thread: 5, reply: 30 } // số bài tối đa mỗi thành viên trong 1 giờ

export type Board = { id: number; slug: string; name: string; description: string; sort_order: number }
export type BoardSummary = Board & { thread_count: number }

export type ThreadRow = {
  id: number
  board_id: number
  board_slug: string
  board_name: string
  member_id: number | null
  title: string
  body: string
  anonymous: number
  status: 'visible' | 'hidden' | 'deleted'
  reply_count: number
  last_post_at: string
  created_at: string
  nickname: string | null
}

export type ReplyRow = {
  id: number
  member_id: number | null
  body: string
  anonymous: number
  status: 'visible' | 'hidden' | 'deleted'
  created_at: string
  nickname: string | null
}

/** Tên hiển thị: không bao giờ lộ email */
export const displayName = (p: { anonymous: number; nickname: string | null }) =>
  p.anonymous ? '匿名さん' : p.nickname || '会員さん'

/** Giờ Nhật, dạng 2026/10/22 14:05 */
export const formatDateTime = (value: string) =>
  new Date(value.replace(' ', 'T') + 'Z').toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

/** Biệt danh hợp lệ: 2–20 ký tự, không có @, không mạo danh 匿名/管理人 */
export function nicknameError(nick: string) {
  if (nick.length < 2 || nick.length > 20) return 'ニックネームは2〜20文字で入力してください。'
  if (/[@<>\s]/.test(nick)) return 'ニックネームに空白や記号（@ < >）は使えません。'
  if (/匿名|管理|運営|admin|加藤諦三/i.test(nick)) return 'このニックネームは使用できません。'
  return null
}

const THREAD_COLS = `t.id, t.board_id, b.slug AS board_slug, b.name AS board_name, t.member_id, t.title, t.body,
  t.anonymous, t.status, t.reply_count, t.last_post_at, t.created_at, m.nickname`
const THREAD_FROM = `forum_threads t JOIN forum_boards b ON b.id = t.board_id LEFT JOIN members m ON m.id = t.member_id`

export async function listBoards(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM forum_threads t WHERE t.board_id = b.id AND t.status = 'visible') AS thread_count
       FROM forum_boards b ORDER BY b.sort_order, b.id`
    )
    .all<BoardSummary>()
  return results
}

export const getBoard = (db: D1Database, slug: string) =>
  db.prepare('SELECT * FROM forum_boards WHERE slug = ?').bind(slug).first<Board>()

/** Chủ đề đang hiện, mới hoạt động nhất trước; boardId bỏ trống = mọi chuyên mục */
export async function listThreads(db: D1Database, page: number, perPage: number, boardId?: number) {
  const where = boardId ? "t.status = 'visible' AND t.board_id = ?" : "t.status = 'visible'"
  const args = boardId ? [boardId] : []
  const [rows, count] = await db.batch([
    db
      .prepare(`SELECT ${THREAD_COLS} FROM ${THREAD_FROM} WHERE ${where} ORDER BY t.last_post_at DESC, t.id DESC LIMIT ? OFFSET ?`)
      .bind(...args, perPage, (page - 1) * perPage),
    db.prepare(`SELECT COUNT(*) AS n FROM forum_threads t WHERE ${where}`).bind(...args),
  ])
  return { threads: rows.results as ThreadRow[], total: (count.results[0] as { n: number }).n }
}

export const getThread = (db: D1Database, id: number) =>
  db.prepare(`SELECT ${THREAD_COLS} FROM ${THREAD_FROM} WHERE t.id = ?`).bind(id).first<ThreadRow>()

export async function listReplies(db: D1Database, threadId: number) {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.member_id, r.body, r.anonymous, r.status, r.created_at, m.nickname
       FROM forum_replies r LEFT JOIN members m ON m.id = r.member_id
       WHERE r.thread_id = ? ORDER BY r.id LIMIT 1000`
    )
    .bind(threadId)
    .all<ReplyRow>()
  return results
}

export async function listThreadsForSitemap(db: D1Database) {
  const { results } = await db
    .prepare("SELECT id, last_post_at FROM forum_threads WHERE status = 'visible' ORDER BY id DESC LIMIT 5000")
    .all<{ id: number; last_post_at: string }>()
  return results
}

/** Giới hạn tốc độ đăng bài theo thành viên (KV, cửa sổ 1 giờ). Trả về true nếu còn được đăng */
export async function takeQuota(kv: KVNamespace, kind: keyof typeof LIMITS, memberId: number) {
  const key = `forum-${kind}:${memberId}`
  const n = Number((await kv.get(key)) ?? 0)
  if (n >= LIMITS[kind]) return false
  await kv.put(key, String(n + 1), { expirationTtl: 3600 })
  return true
}
