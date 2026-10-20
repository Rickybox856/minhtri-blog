import { Hono } from 'hono'
import { raw } from 'hono/html'
import { createContact } from '../lib/db'
import { phoneDisplay, phoneIntl, zaloUrl } from '../lib/site-config'
import type { AppEnv } from '../types'

const app = new Hono<AppEnv>()

const PHONE_RE = /^(\+?84|0)\d{9,10}$/

app.get('/', (c) => {
  const site = c.get('site')
  const ok = c.req.query('ok') === '1'
  const error = c.req.query('error') === '1'
  return c.render(
    <>
      <h1>Liên hệ</h1>
      {site.contact_intro_html && <div class="prose">{raw(site.contact_intro_html)}</div>}
      <ul class="contact-list">
        {site.phone && (
          <li>
            Điện thoại{site.zalo === '1' && ' / Zalo'}: <a href={`tel:${phoneIntl(site.phone)}`}>{phoneDisplay(site.phone)}</a>
            {site.zalo === '1' && (
              <>
                {' '}
                ·{' '}
                <a href={zaloUrl(site.phone)} target="_blank" rel="noopener">
                  Nhắn Zalo
                </a>
              </>
            )}
          </li>
        )}
        {site.email && (
          <li>
            Email: <a href={`mailto:${site.email}`}>{site.email}</a>
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
        {site.address && <li>Địa chỉ: {site.address}</li>}
      </ul>
      {site.contact_form === '1' && (
        <>
      <p>Hoặc để lại lời nhắn, chúng tôi sẽ gọi lại cho bạn:</p>
      {ok && <p class="notice success">Cảm ơn bạn! Chúng tôi sẽ liên hệ lại sớm.</p>}
      {error && <p class="notice error">Vui lòng nhập họ tên và số điện thoại hợp lệ.</p>}
      <form method="post" action="/lien-he" class="form">
        <label>
          Họ tên
          <input name="name" required maxlength={100} />
        </label>
        <label>
          Số điện thoại
          <input name="phone" type="tel" required maxlength={15} />
        </label>
        <label>
          Nội dung
          <textarea name="message" rows={5} maxlength={2000} />
        </label>
        <button class="btn" type="submit">
          Gửi
        </button>
      </form>
        </>
      )}
    </>,
    {
      title: 'Liên hệ',
      description:
        [`Liên hệ ${site.name}`, site.phone && `điện thoại ${phoneDisplay(site.phone)}`, site.email && `email ${site.email}`]
          .filter(Boolean)
          .join(', ') + '.',
      breadcrumbs: [
        { name: 'Trang chủ', path: '/' },
        { name: 'Liên hệ', path: '/lien-he' },
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
