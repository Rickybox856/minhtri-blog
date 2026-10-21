import { Hono } from 'hono'
import { raw } from 'hono/html'
import { createContact } from '../lib/db'
import { phoneDisplay, phoneIntl, zaloUrl } from '../lib/site-config'
import type { AppEnv } from '../types'

const app = new Hono<AppEnv>()

// Chấp nhận số Nhật (09012345678), số Việt Nam và số quốc tế có dấu +
const PHONE_RE = /^(\+\d{1,3}|0)\d{9,10}$/

app.get('/', (c) => {
  const site = c.get('site')
  const ok = c.req.query('ok') === '1'
  const error = c.req.query('error') === '1'
  return c.render(
    <>
      <h1>お問い合わせ</h1>
      {site.contact_intro_html && <div class="prose">{raw(site.contact_intro_html)}</div>}
      <ul class="contact-list">
        {site.phone && (
          <li>
            電話{site.zalo === '1' && ' / Zalo'}: <a href={`tel:${phoneIntl(site.phone)}`}>{phoneDisplay(site.phone)}</a>
            {site.zalo === '1' && (
              <>
                {' '}
                ·{' '}
                <a href={zaloUrl(site.phone)} target="_blank" rel="noopener">
                  Zaloでメッセージ
                </a>
              </>
            )}
          </li>
        )}
        {site.email && (
          <li>
            メール: <a href={`mailto:${site.email}`}>{site.email}</a>
          </li>
        )}
        {site.facebook && (
          <li>
            Facebook:{' '}
            <a href={site.facebook} target="_blank" rel="noopener">
              {site.facebook.replace(/^https:\/\/(www\.)?/, '')}
            </a>
          </li>
        )}
        {site.address && <li>住所: {site.address}</li>}
      </ul>
      {site.contact_form === '1' && (
        <>
      <p>または、以下のフォームからメッセージをお送りください。折り返しご連絡いたします。</p>
      {ok && <p class="notice success">お問い合わせありがとうございます。折り返しご連絡いたします。</p>}
      {error && <p class="notice error">お名前と正しい電話番号を入力してください。</p>}
      <form method="post" action="/lien-he" class="form">
        <label>
          お名前
          <input name="name" required maxlength={100} />
        </label>
        <label>
          電話番号
          <input name="phone" type="tel" required maxlength={15} />
        </label>
        <label>
          お問い合わせ内容
          <textarea name="message" rows={5} maxlength={2000} />
        </label>
        <button class="btn" type="submit">
          送信
        </button>
      </form>
        </>
      )}
    </>,
    {
      title: 'お問い合わせ',
      description:
        [`${site.name}へのお問い合わせ`, site.phone && `電話 ${phoneDisplay(site.phone)}`, site.email && `メール ${site.email}`]
          .filter(Boolean)
          .join('、') + '。',
      breadcrumbs: [
        { name: 'ホーム', path: '/' },
        { name: 'お問い合わせ', path: '/lien-he' },
      ],
    }
  )
})

app.post('/', async (c) => {
  if (c.get('site').contact_form !== '1') return c.notFound()
  const form = await c.req.parseBody()
  const name = String(form.name ?? '').trim().slice(0, 100)
  const phone = String(form.phone ?? '').replace(/[\s.-]/g, '')
  const message = String(form.message ?? '').trim().slice(0, 2000)

  if (!name || !PHONE_RE.test(phone)) {
    return c.redirect('/lien-he?error=1', 303)
  }

  await createContact(c.env.DB, { name, phone, message })
  return c.redirect('/lien-he?ok=1', 303)
})

export default app
