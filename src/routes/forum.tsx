import { Hono } from 'hono'
import type { Context } from 'hono'
import { Pagination, parsePage } from '../components/Pagination'
import {
  BODY_MAX,
  BODY_MIN,
  REPORT_HIDE_AT,
  THREADS_PER_PAGE,
  TITLE_MAX,
  displayName,
  formatDateTime,
  getBoard,
  getThread,
  listBoards,
  listReplies,
  listThreads,
  nicknameError,
  takeQuota,
} from '../lib/forum'
import type { Board, ReplyRow, ThreadRow } from '../lib/forum'
import type { Member } from '../lib/members'
import type { AppEnv } from '../types'

// /dien-dan: みんなの相談広場. Ai cũng đọc được; thành viên mới đăng/trả lời/báo cáo.
// Nội dung người dùng luôn hiển thị dạng chữ thuần (JSX tự escape), không cho HTML hay Markdown.
const app = new Hono<AppEnv>()
const BASE = '/dien-dan'
const FORUM_NAME = 'みんなの相談広場'
type C = Context<AppEnv>

app.use('*', async (c, next) => {
  if (c.req.method === 'POST') {
    const origin = c.req.header('Origin')
    if (origin && origin !== new URL(c.req.url).origin) return c.text('Forbidden', 403)
  }
  await next()
  // Nội dung thay đổi liên tục và khác nhau theo người xem: không cho bộ nhớ đệm dùng chung giữ lại
  c.header('Cache-Control', 'private, no-cache')
})

const loginHref = (next: string) => `/thanh-vien/dang-nhap?next=${encodeURIComponent(next)}`
const signupHref = (next: string) => `/thanh-vien/dang-ky?next=${encodeURIComponent(next)}`
const threadHref = (id: number) => `${BASE}/chu-de/${id}`

// --- Thành phần hiển thị ---

/** Chữ thuần → đoạn văn; dòng trống tách đoạn, xuống dòng giữ nguyên */
const Body = ({ text }: { text: string }) => (
  <div class="forum-body">
    {text
      .split(/\n{2,}/)
      .filter((p) => p.trim())
      .map((p) => (
        <p>
          {p.split('\n').map((line, i) => (
            <>
              {i > 0 && <br />}
              {line}
            </>
          ))}
        </p>
      ))}
  </div>
)

const SafetyNote = () => (
  <aside class="forum-safety">
    <strong>つらい気持ちが続くときは</strong>
    この広場は会員どうしで経験や気持ちを分かち合う場所で、専門家の回答ではありません。命に関わるほどつらいとき、暴力を受けているときは、「いのちの電話」や厚生労働省「まもろうよ こころ」、内閣府「DV相談＋」など専門の相談窓口に、ひとりで抱え込まずにご相談ください。
  </aside>
)

const MemberCta = ({ next, text }: { next: string; text: string }) => (
  <div class="forum-cta">
    <p>{text}</p>
    <p class="member-lock-actions">
      <a class="btn" href={signupHref(next)}>無料で会員登録</a>
      <a class="btn btn-outline" href={loginHref(next)}>ログイン</a>
    </p>
  </div>
)

const ThreadList = ({ threads, showBoard }: { threads: ThreadRow[]; showBoard?: boolean }) =>
  threads.length ? (
    <ul class="forum-threads">
      {threads.map((t) => (
        <li>
          <a href={threadHref(t.id)} class="forum-thread-title">{t.title}</a>
          <div class="forum-thread-meta">
            {showBoard && <span class="forum-tag">{t.board_name}</span>}
            <span>{displayName(t)}</span>
            <span>返信 {t.reply_count}</span>
            <span>最終更新 {formatDateTime(t.last_post_at)}</span>
          </div>
        </li>
      ))}
    </ul>
  ) : (
    <p class="muted">まだ投稿がありません。最初の相談を書いてみませんか？</p>
  )

/** Ô biệt danh: chỉ hiện khi thành viên chưa đặt */
const NicknameField = ({ member, value }: { member: Member; value?: string }) =>
  member.nickname ? (
    <p class="muted">
      ニックネーム: <strong>{member.nickname}</strong>（<a href="/thanh-vien">マイページ</a>で変更できます）
    </p>
  ) : (
    <label>
      ニックネーム（広場で表示される名前・2〜20文字）
      <input type="text" name="nickname" value={value} required minlength={2} maxlength={20} autocomplete="nickname" />
      <small class="muted">メールアドレスやお名前は表示されません。本名は避けてください。</small>
    </label>
  )

const AnonymousField = ({ checked }: { checked?: boolean }) => (
  <label class="checkbox">
    <input type="checkbox" name="anonymous" value="1" checked={checked} />
    匿名で投稿する（「匿名さん」と表示されます）
  </label>
)

// --- Trang chính ---

app.get('/', async (c) => {
  const [boards, recent] = await Promise.all([listBoards(c.env.DB), listThreads(c.env.DB, 1, 10)])
  const member = c.get('member')
  return c.render(
    <>
      <section class="forum-hero">
        <h1>{FORUM_NAME}</h1>
        <p class="lead">
          夫婦のこと、家族のこと、仕事や心の悩み――。テレフォン人生相談を聴いて感じたことや、日々の悩みを、会員どうしで分かち合う場所です。読むのはどなたでも、投稿は無料会員の方ができます。
        </p>
        <p class="forum-actions">
          {member ? (
            <a class="btn" href={`${BASE}/moi`}>✏️ 相談を投稿する</a>
          ) : (
            <a class="btn" href={signupHref(`${BASE}/moi`)}>✏️ 無料登録して相談する</a>
          )}
          <a class="btn btn-outline" href={`${BASE}/quy-dinh`}>広場のルール</a>
        </p>
      </section>

      <h2>テーマから探す</h2>
      <div class="forum-boards">
        {boards.map((b) => (
          <a class="forum-board" href={`${BASE}/${b.slug}`}>
            <strong>{b.name}</strong>
            <span>{b.description}</span>
            <small>相談 {b.thread_count}件</small>
          </a>
        ))}
      </div>

      <h2>新着の相談</h2>
      <ThreadList threads={recent.threads} showBoard />
      <SafetyNote />
    </>,
    {
      title: FORUM_NAME,
      description: '人生の悩みを分かち合う会員どうしの相談広場。夫婦・家族・仕事・心の悩みを気軽に投稿できます。',
      breadcrumbs: [
        { name: 'ホーム', path: '/' },
        { name: FORUM_NAME, path: BASE },
      ],
    }
  )
})

// --- Nội quy ---

app.get('/quy-dinh', (c) =>
  c.render(
    <article class="post">
      <h1>広場のルール</h1>
      <div class="prose">
        <p>{FORUM_NAME}は、人生の悩みや経験を分かち合い、互いに支え合うための場所です。みなさんが安心して利用できるよう、次のルールをお守りください。</p>
        <h2>投稿の前に</h2>
        <ul>
          <li>相手の気持ちを思いやり、否定や攻撃ではなく、寄り添う言葉を心がけましょう。</li>
          <li>本名・住所・電話番号・勤務先など、個人が特定できる情報は書かないでください（ご自身のものも、他人のものも）。</li>
          <li>特定の人物や団体への誹謗中傷、差別的な表現は禁止です。</li>
          <li>宣伝・勧誘・営業目的の投稿、外部サイトへの誘導は禁止です。</li>
          <li>医療・法律に関する内容は、あくまで個人の経験としてお書きください。最終的な判断は専門家にご相談ください。</li>
        </ul>
        <h2>通報と削除について</h2>
        <ul>
          <li>ルールに反する投稿を見つけたら「通報」ボタンでお知らせください。複数の通報があった投稿は、管理者が確認するまで自動的に非表示になります。</li>
          <li>管理者の判断で、予告なく投稿の非表示・削除や、アカウントの利用停止を行うことがあります。</li>
          <li>ご自身の投稿は、いつでも削除できます。</li>
        </ul>
        <h2>つらいときは</h2>
        <p>この広場は専門家による相談窓口ではありません。命に関わるほどつらいとき、暴力を受けているときは、「いのちの電話」や厚生労働省「まもろうよ こころ」、内閣府「DV相談＋」など、専門の相談窓口にご相談ください。</p>
      </div>
      <p>
        <a class="btn" href={BASE}>← 広場に戻る</a>
      </p>
    </article>,
    {
      title: `広場のルール | ${FORUM_NAME}`,
      breadcrumbs: [
        { name: 'ホーム', path: '/' },
        { name: FORUM_NAME, path: BASE },
        { name: '広場のルール', path: `${BASE}/quy-dinh` },
      ],
    }
  )
)

// --- Đăng chủ đề mới ---

type NewForm = { board?: string; title?: string; body?: string; nickname?: string; anonymous?: boolean }

const NewThreadPage = (p: { member: Member; boards: Board[]; form: NewForm; error?: string }) => (
  <section class="forum-form">
    <h1>相談を投稿する</h1>
    <p class="muted">
      投稿の前に<a href={`${BASE}/quy-dinh`} target="_blank" rel="noopener">広場のルール</a>
      をお読みください。個人が特定できる情報は書かないでください。
    </p>
    {p.error && <p class="notice error">{p.error}</p>}
    <form method="post" action={`${BASE}/moi`} class="form">
      <NicknameField member={p.member} value={p.form.nickname} />
      <label>
        テーマ
        <select name="board" required>
          <option value="">選んでください</option>
          {p.boards.map((b) => (
            <option value={b.slug} selected={b.slug === p.form.board}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        タイトル（{TITLE_MAX}文字まで）
        <input type="text" name="title" value={p.form.title} required maxlength={TITLE_MAX} />
      </label>
      <label>
        相談内容（{BODY_MIN}〜{BODY_MAX}文字）
        <textarea name="body" rows={10} required minlength={BODY_MIN} maxlength={BODY_MAX}>
          {p.form.body}
        </textarea>
      </label>
      <AnonymousField checked={p.form.anonymous} />
      <button class="btn" type="submit">投稿する</button>
    </form>
    <SafetyNote />
  </section>
)

const newSeo = { title: `相談を投稿する | ${FORUM_NAME}`, noindex: true }

app.get('/moi', async (c) => {
  const member = c.get('member')
  if (!member) return c.redirect(loginHref(`${BASE}/moi`))
  const boards = await listBoards(c.env.DB)
  return c.render(<NewThreadPage member={member} boards={boards} form={{ board: c.req.query('board') }} />, newSeo)
})

/** Đặt biệt danh lần đầu (nếu form có gửi). Trả về thông báo lỗi hoặc null */
async function saveNickname(c: C, member: Member, raw: unknown) {
  if (member.nickname) return null
  const nick = String(raw ?? '').trim()
  const err = nicknameError(nick)
  if (err) return err
  const taken = await c.env.DB.prepare('SELECT 1 FROM members WHERE nickname = ? COLLATE NOCASE AND id != ?')
    .bind(nick, member.id)
    .first()
  if (taken) return 'このニックネームはすでに使われています。別のニックネームをお選びください。'
  await c.env.DB.prepare('UPDATE members SET nickname = ? WHERE id = ?').bind(nick, member.id).run()
  member.nickname = nick
  return null
}

/** Chuẩn hoá nội dung: bỏ khoảng trắng thừa, gộp quá nhiều dòng trống */
const cleanText = (raw: unknown) =>
  String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

app.post('/moi', async (c) => {
  const member = c.get('member')
  if (!member) return c.redirect(loginHref(`${BASE}/moi`), 303)
  const f = await c.req.parseBody()
  const form: NewForm = {
    board: String(f.board ?? ''),
    title: String(f.title ?? '').trim(),
    body: cleanText(f.body),
    nickname: String(f.nickname ?? '').trim(),
    anonymous: f.anonymous === '1',
  }
  const boards = await listBoards(c.env.DB)
  const fail = (error: string, status: 400 | 409 | 429 = 400) => {
    c.status(status)
    return c.render(<NewThreadPage member={member} boards={boards} form={form} error={error} />, newSeo)
  }

  const board = boards.find((b) => b.slug === form.board)
  if (!board) return fail('テーマを選んでください。')
  if (!form.title || form.title.length > TITLE_MAX) return fail(`タイトルは1〜${TITLE_MAX}文字で入力してください。`)
  if (form.body!.length < BODY_MIN || form.body!.length > BODY_MAX)
    return fail(`相談内容は${BODY_MIN}〜${BODY_MAX}文字で入力してください。`)
  const nickErr = await saveNickname(c, member, f.nickname)
  if (nickErr) return fail(nickErr, 409)
  if (!(await takeQuota(c.env.CACHE, 'thread', member.id)))
    return fail('短時間に多くの投稿がありました。しばらくしてからお試しください。', 429)

  const row = await c.env.DB.prepare(
    'INSERT INTO forum_threads (board_id, member_id, title, body, anonymous) VALUES (?, ?, ?, ?, ?) RETURNING id'
  )
    .bind(board.id, member.id, form.title, form.body, form.anonymous ? 1 : 0)
    .first<{ id: number }>()
  return c.redirect(threadHref(row!.id), 303)
})

// --- Trang chủ đề ---

const ReportForm = ({ type, id, next }: { type: 'thread' | 'reply'; id: number; next: string }) => (
  <details class="forum-report">
    <summary>通報</summary>
    <form method="post" action={`${BASE}/bao-cao`}>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="id" value={String(id)} />
      <input type="hidden" name="next" value={next} />
      <select name="reason">
        <option value="誹謗中傷">誹謗中傷・攻撃的な内容</option>
        <option value="個人情報">個人情報が書かれている</option>
        <option value="宣伝・スパム">宣伝・スパム</option>
        <option value="その他">その他ルール違反</option>
      </select>
      <button class="btn btn-outline" type="submit">送信</button>
    </form>
  </details>
)

const DeleteOwn = ({ type, id, next }: { type: 'thread' | 'reply'; id: number; next: string }) => (
  <form
    method="post"
    action={`${BASE}/xoa`}
    class="inline-form"
    onsubmit="return confirm('この投稿を削除しますか？元に戻すことはできません。')"
  >
    <input type="hidden" name="type" value={type} />
    <input type="hidden" name="id" value={String(id)} />
    <input type="hidden" name="next" value={next} />
    <button class="link-button" type="submit">削除</button>
  </form>
)

function Post(p: {
  n: number
  name: string
  isOp?: boolean
  at: string
  body: string
  status: string
  actions?: unknown
}) {
  return (
    <article class={`forum-post${p.isOp ? ' is-op' : ''}`} id={`p${p.n}`}>
      <header>
        <span class="forum-no">#{p.n}</span>
        <strong>{p.name}</strong>
        {p.isOp && <span class="forum-tag">相談者</span>}
        <time>{formatDateTime(p.at)}</time>
      </header>
      {p.status === 'visible' ? (
        <Body text={p.body} />
      ) : (
        <p class="muted forum-removed">
          {p.status === 'deleted' ? '（この投稿は削除されました）' : '（この投稿は管理者の確認待ちのため、非表示になっています）'}
        </p>
      )}
      {p.status === 'visible' && p.actions ? <footer>{p.actions as never}</footer> : null}
    </article>
  )
}

const ReplyForm = ({ thread, member, body, anonymous, error }: { thread: ThreadRow; member: Member; body?: string; anonymous?: boolean; error?: string }) => (
  <section class="forum-reply-form" id="reply">
    <h2>返信する</h2>
    {error && <p class="notice error">{error}</p>}
    <form method="post" action={`${threadHref(thread.id)}/tra-loi`} class="form">
      <NicknameField member={member} />
      <label>
        返信内容（{BODY_MAX}文字まで）
        <textarea name="body" rows={6} required minlength={2} maxlength={BODY_MAX}>
          {body}
        </textarea>
      </label>
      <AnonymousField checked={anonymous ?? (thread.member_id === member.id && thread.anonymous === 1)} />
      <button class="btn" type="submit">返信する</button>
    </form>
  </section>
)

async function renderThread(c: C, id: number, replyError?: { body: string; anonymous: boolean; error: string }) {
  const thread = await getThread(c.env.DB, id)
  if (!thread || thread.status === 'deleted') return c.notFound()
  const member = c.get('member')
  const here = threadHref(thread.id)

  // Chủ đề bị ẩn (do báo cáo hoặc quản trị): không hiện cả tiêu đề
  if (thread.status === 'hidden') {
    c.status(404)
    return c.render(
      <section class="forum-form">
        <h1>この相談は現在表示できません</h1>
        <p>管理者が内容を確認しています。しばらくしてから、もう一度ご覧ください。</p>
        <p>
          <a class="btn" href={BASE}>← 広場に戻る</a>
        </p>
      </section>,
      { title: FORUM_NAME, noindex: true }
    )
  }
  const replies = thread.status === 'visible' ? await listReplies(c.env.DB, thread.id) : []

  // Người hỏi trả lời trong chủ đề của mình: hiện cùng tên với bài gốc (không lộ danh tính khi bài gốc ẩn danh)
  const replyName = (r: ReplyRow) =>
    r.member_id != null && r.member_id === thread.member_id ? displayName(thread) : displayName(r)
  const actions = (type: 'thread' | 'reply', pid: number, authorId: number | null) =>
    member ? (
      <>
        {authorId === member.id ? <DeleteOwn type={type} id={pid} next={here} /> : <ReportForm type={type} id={pid} next={here} />}
      </>
    ) : null

  return c.render(
    <>
      <article class="forum-thread">
        <p class="forum-thread-board">
          <a href={`${BASE}/${thread.board_slug}`} class="forum-tag">{thread.board_name}</a>
        </p>
        <h1>{thread.title}</h1>
        <Post
          n={1}
          name={displayName(thread)}
          isOp
          at={thread.created_at}
          body={thread.body}
          status={thread.status}
          actions={actions('thread', thread.id, thread.member_id)}
        />
        {replies.map((r, i) => (
          <Post
            n={i + 2}
            name={replyName(r)}
            isOp={r.member_id != null && r.member_id === thread.member_id}
            at={r.created_at}
            body={r.body}
            status={r.status}
            actions={actions('reply', r.id, r.member_id)}
          />
        ))}
      </article>

      {thread.status === 'visible' &&
        (member ? (
          <ReplyForm
            thread={thread}
            member={member}
            body={replyError?.body}
            anonymous={replyError?.anonymous}
            error={replyError?.error}
          />
        ) : (
          <MemberCta next={here} text="返信するには、無料の会員登録またはログインが必要です。" />
        ))}
      <SafetyNote />
    </>,
    {
      title: `${thread.title} | ${FORUM_NAME}`,
      description: thread.status === 'visible' ? thread.body.replace(/\s+/g, ' ').slice(0, 120) : undefined,
      noindex: thread.status !== 'visible',
      breadcrumbs: [
        { name: 'ホーム', path: '/' },
        { name: FORUM_NAME, path: BASE },
        { name: thread.board_name, path: `${BASE}/${thread.board_slug}` },
        { name: thread.title, path: here },
      ],
      jsonLd:
        thread.status === 'visible'
          ? [
              {
                '@context': 'https://schema.org',
                '@type': 'DiscussionForumPosting',
                headline: thread.title,
                text: thread.body.slice(0, 500),
                url: new URL(here, c.req.url).toString(),
                datePublished: new Date(thread.created_at.replace(' ', 'T') + 'Z').toISOString(),
                author: { '@type': 'Person', name: displayName(thread) },
                interactionStatistic: {
                  '@type': 'InteractionCounter',
                  interactionType: 'https://schema.org/CommentAction',
                  userInteractionCount: thread.reply_count,
                },
              },
            ]
          : undefined,
    }
  )
}

const threadId = (c: C) => {
  const raw = c.req.param('id') ?? ''
  return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null
}

app.get('/chu-de/:id', async (c) => {
  const id = threadId(c)
  return id ? renderThread(c, id) : c.notFound()
})

app.post('/chu-de/:id/tra-loi', async (c) => {
  const id = threadId(c)
  if (!id) return c.notFound()
  const member = c.get('member')
  if (!member) return c.redirect(loginHref(threadHref(id)), 303)
  const f = await c.req.parseBody()
  const body = cleanText(f.body)
  const anonymous = f.anonymous === '1'
  const fail = (error: string, status: 400 | 409 | 429 = 400) => {
    c.status(status)
    return renderThread(c, id, { body, anonymous, error })
  }

  const thread = await getThread(c.env.DB, id)
  if (!thread || thread.status !== 'visible') return c.notFound()
  if (body.length < 2 || body.length > BODY_MAX) return fail(`返信は2〜${BODY_MAX}文字で入力してください。`)
  const nickErr = await saveNickname(c, member, f.nickname)
  if (nickErr) return fail(nickErr, 409)
  if (!(await takeQuota(c.env.CACHE, 'reply', member.id)))
    return fail('短時間に多くの投稿がありました。しばらくしてからお試しください。', 429)

  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO forum_replies (thread_id, member_id, body, anonymous) VALUES (?, ?, ?, ?)').bind(
      id,
      member.id,
      body,
      anonymous ? 1 : 0
    ),
    c.env.DB.prepare("UPDATE forum_threads SET reply_count = reply_count + 1, last_post_at = datetime('now') WHERE id = ?").bind(id),
  ])
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM forum_replies WHERE thread_id = ?').bind(id).first<{ n: number }>()
  return c.redirect(`${threadHref(id)}#p${(count?.n ?? 0) + 1}`, 303)
})

// --- Báo cáo và xoá bài của mình ---

const tableOf = (type: unknown) => (type === 'thread' ? 'forum_threads' : type === 'reply' ? 'forum_replies' : null)
const safeBack = (raw: unknown) => {
  const s = String(raw ?? '')
  return s.startsWith(`${BASE}/`) ? s : BASE
}

app.post('/bao-cao', async (c) => {
  const f = await c.req.parseBody()
  const back = safeBack(f.next)
  const member = c.get('member')
  if (!member) return c.redirect(loginHref(back), 303)
  const table = tableOf(f.type)
  const id = Number(f.id)
  if (!table || !Number.isInteger(id)) return c.redirect(back, 303)
  const reason = String(f.reason ?? '').slice(0, 50)

  const res = await c.env.DB.prepare(
    'INSERT OR IGNORE INTO forum_reports (target_type, target_id, member_id, reason) VALUES (?, ?, ?, ?)'
  )
    .bind(f.type, id, member.id, reason)
    .run()
  if (res.meta.changes) {
    // Đủ số báo cáo khác nhau thì tự ẩn chờ quản trị xem
    await c.env.DB.prepare(
      `UPDATE ${table} SET report_count = report_count + 1,
         status = CASE WHEN status = 'visible' AND report_count + 1 >= ? THEN 'hidden' ELSE status END
       WHERE id = ?`
    )
      .bind(REPORT_HIDE_AT, id)
      .run()
  }
  return c.render(
    <section class="forum-form">
      <h1>通報を受け付けました</h1>
      <p>ご協力ありがとうございます。管理者が内容を確認し、必要に応じて対応します。</p>
      <p>
        <a class="btn" href={back}>← 元のページに戻る</a>
      </p>
    </section>,
    { title: `通報 | ${FORUM_NAME}`, noindex: true }
  )
})

app.post('/xoa', async (c) => {
  const f = await c.req.parseBody()
  const back = safeBack(f.next)
  const member = c.get('member')
  if (!member) return c.redirect(loginHref(back), 303)
  const table = tableOf(f.type)
  const id = Number(f.id)
  if (!table || !Number.isInteger(id)) return c.redirect(back, 303)
  await c.env.DB.prepare(`UPDATE ${table} SET status = 'deleted' WHERE id = ? AND member_id = ?`).bind(id, member.id).run()
  return c.redirect(f.type === 'thread' ? BASE : back, 303)
})

// --- Chuyên mục (đặt cuối để không nuốt các đường dẫn cố định ở trên) ---

async function boardPage(c: C) {
  const slug = c.req.param('board') ?? ''
  const base = `${BASE}/${slug}`
  const page = parsePage(c.req.param('n'))
  if (page === null) return c.notFound()
  if (page === 1 && c.req.param('n')) return c.redirect(base, 301)
  const board = await getBoard(c.env.DB, slug)
  if (!board) return c.notFound()
  const { threads, total } = await listThreads(c.env.DB, page, THREADS_PER_PAGE, board.id)
  if (!threads.length && page > 1) return c.notFound()
  const member = c.get('member')
  const suffix = page > 1 ? `（${page}ページ目）` : ''

  return c.render(
    <>
      <h1>
        {board.name}
        {suffix && <small class="pg-title">{suffix}</small>}
      </h1>
      <p class="lead">{board.description}</p>
      <p class="forum-actions">
        {member ? (
          <a class="btn" href={`${BASE}/moi?board=${board.slug}`}>✏️ このテーマで相談する</a>
        ) : (
          <a class="btn" href={signupHref(`${BASE}/moi?board=${board.slug}`)}>✏️ 無料登録して相談する</a>
        )}
      </p>
      <ThreadList threads={threads} />
      <Pagination base={base} page={page} total={total} perPage={THREADS_PER_PAGE} />
    </>,
    {
      title: `${board.name}${suffix} | ${FORUM_NAME}`,
      description: board.description,
      breadcrumbs: [
        { name: 'ホーム', path: '/' },
        { name: FORUM_NAME, path: BASE },
        { name: board.name, path: base },
      ],
    }
  )
}

app.get('/:board', boardPage)
app.get('/:board/trang/:n', boardPage)

export default app
