import { Hono } from 'hono'
import type { Context } from 'hono'
import { hashPassword, verifyPassword } from '../lib/auth'
import { nicknameError } from '../lib/forum'
import { MIN_PASSWORD, endMemberSession, safeNext, startMemberSession } from '../lib/members'
import type { AppEnv } from '../types'

// /thanh-vien: đăng ký, đăng nhập, trang của tôi (giao diện tiếng Nhật)
const app = new Hono<AppEnv>()
const BASE = '/thanh-vien'

const MAX_FAILS = 10
const LOCK_SECONDS = 15 * 60
const MAX_SIGNUPS = 5 // mỗi IP trong 1 giờ, chặn bot tạo tài khoản hàng loạt
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ip = (c: Context<AppEnv>) => c.req.header('cf-connecting-ip') ?? 'unknown'

app.use('*', async (c, next) => {
  // Chặn gửi form từ trang khác (CSRF)
  if (c.req.method === 'POST') {
    const origin = c.req.header('Origin')
    if (origin && origin !== new URL(c.req.url).origin) return c.text('Forbidden', 403)
  }
  await next()
  c.header('Cache-Control', 'private, no-store')
  c.header('X-Robots-Tag', 'noindex')
})

const Field = (p: { label: string; name: string; type?: string; value?: string; auto?: string; min?: number; required?: boolean; note?: string }) => (
  <label>
    {p.label}
    <input
      type={p.type ?? 'text'}
      name={p.name}
      value={p.value}
      autocomplete={p.auto}
      minlength={p.min}
      required={p.required ?? true}
    />
    {p.note && <small class="muted">{p.note}</small>}
  </label>
)

const SignupForm = (p: { next: string; error?: string; email?: string; name?: string }) => (
  <section class="login-box member-box">
    <h1>無料会員登録</h1>
    <p class="lead">登録すると、テレフォン人生相談の音声・動画をすべてお楽しみいただけます。登録は無料です。</p>
    {p.error && <p class="notice error">{p.error}</p>}
    <form method="post" action={`${BASE}/dang-ky`} class="form">
      <input type="hidden" name="next" value={p.next} />
      <Field label="お名前（ニックネーム可）" name="name" value={p.name} auto="nickname" required={false} />
      <Field label="メールアドレス" name="email" type="email" value={p.email} auto="email" />
      <Field label="パスワード" name="password" type="password" auto="new-password" min={MIN_PASSWORD} note={`${MIN_PASSWORD}文字以上`} />
      <Field label="パスワード（確認）" name="confirm" type="password" auto="new-password" min={MIN_PASSWORD} />
      {/* Bẫy bot: người thật không thấy ô này */}
      <div class="hp" aria-hidden="true">
        <input type="text" name="website" tabindex={-1} autocomplete="off" />
      </div>
      <button class="btn" type="submit">登録する</button>
    </form>
    <p class="member-switch">
      すでに会員の方は <a href={`${BASE}/dang-nhap?next=${encodeURIComponent(p.next)}`}>ログイン</a>
    </p>
  </section>
)

const LoginForm = (p: { next: string; error?: string; email?: string }) => (
  <section class="login-box member-box">
    <h1>ログイン</h1>
    {p.error && <p class="notice error">{p.error}</p>}
    <form method="post" action={`${BASE}/dang-nhap`} class="form">
      <input type="hidden" name="next" value={p.next} />
      <Field label="メールアドレス" name="email" type="email" value={p.email} auto="email" />
      <Field label="パスワード" name="password" type="password" auto="current-password" />
      <button class="btn" type="submit">ログイン</button>
    </form>
    <p class="member-switch">
      はじめての方は <a href={`${BASE}/dang-ky?next=${encodeURIComponent(p.next)}`}>無料会員登録</a>
    </p>
    <p class="member-switch muted">パスワードをお忘れの方は、お問い合わせページからご連絡ください。</p>
  </section>
)

const seo = (title: string) => ({ title, noindex: true })

// --- Đăng ký ---

app.get('/dang-ky', (c) => {
  if (c.get('member')) return c.redirect(safeNext(c.req.query('next')))
  return c.render(<SignupForm next={safeNext(c.req.query('next'))} />, seo('無料会員登録'))
})

app.post('/dang-ky', async (c) => {
  const form = await c.req.parseBody()
  const next = safeNext(form.next)
  const email = String(form.email ?? '').trim().toLowerCase()
  const name = String(form.name ?? '').trim().slice(0, 50)
  const password = String(form.password ?? '')
  const fail = (error: string, status: 400 | 409 | 429 = 400) => {
    c.status(status)
    return c.render(<SignupForm next={next} error={error} email={email} name={name} />, seo('無料会員登録'))
  }

  if (form.website) return c.redirect(next, 303) // bot điền ô bẫy: giả vờ thành công
  if (!EMAIL_RE.test(email) || email.length > 200) return fail('メールアドレスの形式が正しくありません。')
  if (password.length < MIN_PASSWORD) return fail(`パスワードは${MIN_PASSWORD}文字以上で入力してください。`)
  if (password.length > 200) return fail('パスワードが長すぎます。')
  if (password !== String(form.confirm ?? '')) return fail('確認用パスワードが一致しません。')

  const limitKey = `signup:${ip(c)}`
  const count = Number((await c.env.CACHE.get(limitKey)) ?? 0)
  if (count >= MAX_SIGNUPS) return fail('短時間に多くの登録がありました。しばらくしてからお試しください。', 429)

  const exists = await c.env.DB.prepare('SELECT 1 FROM members WHERE email = ?').bind(email).first()
  if (exists) return fail('このメールアドレスはすでに登録されています。ログインしてください。', 409)

  const row = await c.env.DB.prepare('INSERT INTO members (email, name, password_hash) VALUES (?, ?, ?) RETURNING id')
    .bind(email, name, await hashPassword(password))
    .first<{ id: number }>()
  await c.env.CACHE.put(limitKey, String(count + 1), { expirationTtl: 3600 })
  await startMemberSession(c, row!.id)
  return c.redirect(next, 303)
})

// --- Đăng nhập / đăng xuất ---

app.get('/dang-nhap', (c) => {
  if (c.get('member')) return c.redirect(safeNext(c.req.query('next')))
  return c.render(<LoginForm next={safeNext(c.req.query('next'))} />, seo('ログイン'))
})

app.post('/dang-nhap', async (c) => {
  const form = await c.req.parseBody()
  const next = safeNext(form.next)
  const email = String(form.email ?? '').trim().toLowerCase()
  const fail = (error: string, status: 401 | 403 | 429) => {
    c.status(status)
    return c.render(<LoginForm next={next} error={error} email={email} />, seo('ログイン'))
  }

  const failKey = `member-fail:${ip(c)}`
  const fails = Number((await c.env.CACHE.get(failKey)) ?? 0)
  if (fails >= MAX_FAILS) return fail('ログインの失敗が続いたため、15分ほどお待ちください。', 429)

  const m = await c.env.DB.prepare('SELECT id, password_hash, disabled FROM members WHERE email = ?')
    .bind(email)
    .first<{ id: number; password_hash: string; disabled: number }>()
  if (!m || !(await verifyPassword(String(form.password ?? ''), m.password_hash))) {
    await c.env.CACHE.put(failKey, String(fails + 1), { expirationTtl: LOCK_SECONDS })
    return fail('メールアドレスまたはパスワードが正しくありません。', 401)
  }
  if (m.disabled) return fail('このアカウントは現在ご利用いただけません。お問い合わせください。', 403)

  await startMemberSession(c, m.id)
  return c.redirect(next, 303)
})

app.post('/dang-xuat', async (c) => {
  await endMemberSession(c)
  return c.redirect('/', 303)
})

// --- Trang của tôi ---

const MyPage = (p: {
  email: string
  name: string
  nickname: string | null
  error?: string
  ok?: boolean
  nickError?: string
  nickOk?: boolean
}) => (
  <section class="login-box member-box">
    <h1>マイページ</h1>
    <p>
      {p.name ? `${p.name} さん、` : ''}ようこそ。会員として、すべての音声・動画をお楽しみいただけます。
    </p>
    <p class="muted">登録メールアドレス: {p.email}</p>
    <p class="member-links">
      <a class="btn" href="/chu-de/am-thanh">🎧 音声を聴く</a>
      <a class="btn" href="/chu-de/dong-video">▶ 動画を見る</a>
      <a class="btn" href="/dien-dan">💬 相談広場</a>
    </p>

    <h2>相談広場のニックネーム</h2>
    {p.nickOk && <p class="notice success">ニックネームを保存しました。</p>}
    {p.nickError && <p class="notice error">{p.nickError}</p>}
    <form method="post" action={`${BASE}/biet-danh`} class="form">
      <Field
        label="ニックネーム（2〜20文字）"
        name="nickname"
        value={p.nickname ?? ''}
        auto="nickname"
        note="相談広場で表示される名前です。メールアドレスは表示されません。"
      />
      <button class="btn" type="submit">保存する</button>
    </form>

    <h2>パスワードの変更</h2>
    {p.ok && <p class="notice success">パスワードを変更しました。</p>}
    {p.error && <p class="notice error">{p.error}</p>}
    <form method="post" action={`${BASE}/doi-mat-khau`} class="form">
      <Field label="現在のパスワード" name="current" type="password" auto="current-password" />
      <Field label="新しいパスワード" name="password" type="password" auto="new-password" min={MIN_PASSWORD} note={`${MIN_PASSWORD}文字以上`} />
      <Field label="新しいパスワード（確認）" name="confirm" type="password" auto="new-password" min={MIN_PASSWORD} />
      <button class="btn" type="submit">変更する</button>
    </form>

    <form method="post" action={`${BASE}/dang-xuat`} class="member-logout">
      <button class="btn btn-outline" type="submit">ログアウト</button>
    </form>
  </section>
)

app.get('/', (c) => {
  const m = c.get('member')
  if (!m) return c.redirect(`${BASE}/dang-nhap`)
  return c.render(
    <MyPage email={m.email} name={m.name} nickname={m.nickname} ok={c.req.query('ok') === '1'} nickOk={c.req.query('ok') === 'nick'} />,
    seo('マイページ')
  )
})

app.post('/biet-danh', async (c) => {
  const m = c.get('member')
  if (!m) return c.redirect(`${BASE}/dang-nhap`, 303)
  const nick = String((await c.req.parseBody()).nickname ?? '').trim()
  const fail = (nickError: string) => {
    c.status(400)
    return c.render(<MyPage email={m.email} name={m.name} nickname={nick} nickError={nickError} />, seo('マイページ'))
  }
  const err = nicknameError(nick)
  if (err) return fail(err)
  const taken = await c.env.DB.prepare('SELECT 1 FROM members WHERE nickname = ? COLLATE NOCASE AND id != ?').bind(nick, m.id).first()
  if (taken) return fail('このニックネームはすでに使われています。別のニックネームをお選びください。')
  await c.env.DB.prepare('UPDATE members SET nickname = ? WHERE id = ?').bind(nick, m.id).run()
  return c.redirect(`${BASE}?ok=nick`, 303)
})

app.post('/doi-mat-khau', async (c) => {
  const m = c.get('member')
  if (!m) return c.redirect(`${BASE}/dang-nhap`, 303)
  const form = await c.req.parseBody()
  const password = String(form.password ?? '')
  const fail = (error: string) => {
    c.status(400)
    return c.render(<MyPage email={m.email} name={m.name} nickname={m.nickname} error={error} />, seo('マイページ'))
  }
  const row = await c.env.DB.prepare('SELECT password_hash FROM members WHERE id = ?').bind(m.id).first<{ password_hash: string }>()
  if (!row || !(await verifyPassword(String(form.current ?? ''), row.password_hash))) return fail('現在のパスワードが正しくありません。')
  if (password.length < MIN_PASSWORD || password.length > 200) return fail(`パスワードは${MIN_PASSWORD}文字以上で入力してください。`)
  if (password !== String(form.confirm ?? '')) return fail('確認用パスワードが一致しません。')

  // Đổi mật khẩu: đăng xuất mọi thiết bị khác, giữ phiên hiện tại
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE members SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), m.id),
    c.env.DB.prepare('DELETE FROM member_sessions WHERE member_id = ?').bind(m.id),
  ])
  await startMemberSession(c, m.id)
  return c.redirect(`${BASE}?ok=1`, 303)
})

export default app
