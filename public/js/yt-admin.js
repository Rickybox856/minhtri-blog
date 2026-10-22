// Trang quản trị Kênh YouTube: gợi ý SEO, chấm điểm khi gõ, tải video lên thẳng YouTube (resumable upload).
(() => {
  const meta = document.querySelector('.yt-meta')
  if (!meta) return
  const form = meta.closest('form')
  const $ = (name) => form.querySelector(`[name="${name}"]`)
  const suggestUrl = meta.dataset.suggestUrl

  const post = (url, body) =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())

  // --- Đếm ký tự + chấm điểm SEO (đợi người dùng ngừng gõ) ---
  const counts = () => {
    form.querySelector('[data-count="title"]').textContent = `(${$('title').value.length}/100)`
    form.querySelector('[data-count="description"]').textContent = `(${$('description').value.length}/5000)`
  }
  const renderScore = (r) => {
    const el = form.querySelector('[data-seo-score]')
    el.textContent = r.score
    el.className = `seo-score ${r.score >= 80 ? 'good' : r.score >= 50 ? 'mid' : 'bad'}`
    const ul = form.querySelector('[data-seo-checks]')
    ul.replaceChildren(
      ...r.checks.map((c) => {
        const li = document.createElement('li')
        li.className = c.ok ? 'ok' : 'no'
        li.textContent = `${c.ok ? '✅' : '⚠️'} ${c.label}`
        if (!c.ok) {
          const small = document.createElement('small')
          small.textContent = ` — ${c.tip}`
          li.append(small)
        }
        return li
      })
    )
  }
  let timer
  const rescore = () => {
    counts()
    clearTimeout(timer)
    timer = setTimeout(async () => {
      try {
        renderScore(await post(suggestUrl, { mode: 'score', title: $('title').value, description: $('description').value, tags: $('tags').value }))
      } catch {}
    }, 500)
  }
  for (const n of ['title', 'description', 'tags']) $(n).addEventListener('input', rescore)

  // --- Nút Gợi ý SEO ---
  form.querySelector('[data-action="suggest"]').addEventListener('click', async (e) => {
    const title = $('title').value.trim()
    if (!title) {
      alert('Hãy nhập tiêu đề (hoặc nội dung chính của video) trước.')
      $('title').focus()
      return
    }
    if ($('description').value.trim() && !confirm('Thay mô tả và tag hiện tại bằng nội dung gợi ý?')) return
    e.target.disabled = true
    try {
      const s = await post(suggestUrl, { title })
      $('description').value = s.description
      $('tags').value = s.tags.join(', ')
      const box = form.querySelector('.yt-title-options')
      box.replaceChildren()
      const label = document.createElement('p')
      label.className = 'muted'
      label.textContent = 'Tiêu đề gợi ý (bấm để dùng):'
      box.append(label)
      for (const t of s.titles) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'yt-title-option'
        b.textContent = t
        b.addEventListener('click', () => {
          $('title').value = t
          rescore()
        })
        box.append(b)
      }
      box.hidden = false
      rescore()
    } finally {
      e.target.disabled = false
    }
  })

  // --- Tải video lên ---
  if (form.id !== 'yt-upload') return
  const base = form.dataset.base
  const CHUNK = 16 * 1024 * 1024 // bội số của 256 KB theo yêu cầu của Google
  const bar = form.querySelector('.yt-progress')
  const progress = bar.querySelector('progress')
  const progressText = bar.querySelector('[data-progress-text]')
  const errBox = form.querySelector('[data-upload-error]')
  let busy = false

  const getToken = async () => {
    const r = await fetch(`${base}/token`, { method: 'POST' }).then((x) => x.json())
    if (!r.token) throw new Error(r.error || 'Không lấy được quyền truy cập kênh.')
    return r.token
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const show = (pct, text) => {
    progress.value = pct
    progressText.textContent = text
  }

  window.addEventListener('beforeunload', (e) => {
    if (busy) e.preventDefault()
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (busy) return
    const file = $('file').files[0]
    if (!file) return
    busy = true
    errBox.hidden = true
    bar.hidden = false
    const submit = form.querySelector('button[type="submit"]')
    submit.disabled = true
    try {
      let token = await getToken()
      const metadata = {
        snippet: {
          title: $('title').value.trim().slice(0, 100) || file.name.replace(/\.[^.]+$/, ''),
          description: $('description').value.slice(0, 5000),
          tags: $('tags').value.split(/[,、\n]/).map((t) => t.trim()).filter(Boolean),
          categoryId: $('category_id').value,
        },
        status: { privacyStatus: $('privacy').value, selfDeclaredMadeForKids: $('made_for_kids').checked },
      }
      // 1) Mở phiên tải lên (resumable)
      show(0, 'Đang chuẩn bị…')
      const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(file.size),
          'X-Upload-Content-Type': file.type || 'video/*',
        },
        body: JSON.stringify(metadata),
      })
      if (!init.ok) {
        const j = await init.json().catch(() => ({}))
        throw new Error(j.error?.message || `YouTube trả mã ${init.status}`)
      }
      const session = init.headers.get('Location')
      if (!session) throw new Error('YouTube không trả địa chỉ tải lên.')

      // 2) Gửi từng phần; lỗi mạng thì hỏi YouTube đã nhận tới đâu rồi gửi tiếp
      let offset = 0
      let result = null
      let failures = 0
      const askOffset = async () => {
        const r = await fetch(session, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Range': `bytes */${file.size}` } })
        if (r.status === 200 || r.status === 201) return { done: await r.json() }
        const range = r.headers.get('Range')
        return { offset: range ? Number(range.split('-')[1]) + 1 : offset }
      }
      while (!result) {
        const end = Math.min(offset + CHUNK, file.size)
        try {
          const r = await fetch(session, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Range': `bytes ${offset}-${end - 1}/${file.size}` },
            body: file.slice(offset, end),
          })
          if (r.status === 200 || r.status === 201) {
            result = await r.json()
            break
          }
          if (r.status === 308) {
            const range = r.headers.get('Range')
            offset = range ? Number(range.split('-')[1]) + 1 : end
            failures = 0
          } else if (r.status === 401) {
            token = await getToken()
          } else if (r.status >= 500) {
            throw new Error(`YouTube tạm lỗi (${r.status})`)
          } else {
            const j = await r.json().catch(() => ({}))
            throw Object.assign(new Error(j.error?.message || `YouTube trả mã ${r.status}`), { fatal: true })
          }
        } catch (err) {
          if (err.fatal || ++failures > 8) throw err
          show(Math.round((offset / file.size) * 100), `Mất kết nối, thử lại lần ${failures}…`)
          await sleep(Math.min(30000, 1000 * 2 ** failures))
          const s = await askOffset().catch(() => ({ offset }))
          if (s.done) {
            result = s.done
            break
          }
          offset = s.offset
          continue
        }
        const pct = Math.round((offset / file.size) * 100)
        show(pct, `${pct}% (${(offset / 1048576).toFixed(0)} / ${(file.size / 1048576).toFixed(0)} MB)`)
      }

      // 3) Ghi nhận và chuyển sang trang sửa video
      show(100, 'Đã tải xong! YouTube đang xử lý video…')
      busy = false
      const done = await post(`${base}/da-tai-len`, { videoId: result.id, title: metadata.snippet.title, privacy: result.status?.privacyStatus })
      location.href = done.next || base
    } catch (err) {
      busy = false
      errBox.textContent = `Tải lên thất bại: ${err.message}`
      errBox.hidden = false
      submit.disabled = false
    }
  })
})()
