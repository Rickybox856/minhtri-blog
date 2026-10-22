// Quản lý hàng loạt video YouTube: lọc, chọn nhiều, xem trước lịch đăng, gửi thay đổi theo từng đợt.
(() => {
  const root = document.getElementById('yt-bulk')
  if (!root) return
  const url = root.dataset.url
  const chunk = Number(root.dataset.chunk) || 20
  const $ = (sel) => root.querySelector(sel)
  const field = (name) => root.querySelector(`[name="${name}"]`)
  const rows = [...root.querySelectorAll('tbody tr')]
  const LABEL = { draft: 'Nháp (riêng tư)', scheduled: 'Đã lên lịch', public: 'Công khai', unlisted: 'Không công khai', private: 'Riêng tư' }
  const applyBtn = $('[data-apply]')
  const errBox = $('[data-bulk-error]')
  let filter = 'draft'
  let plan = null // [{row, privacy, publishAt}]

  // --- Múi giờ: lưu lựa chọn trên máy này ---
  const tz = field('tz')
  const store = {
    get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
    set: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
  }
  const browserOffset = String(-new Date().getTimezoneOffset())
  tz.value = store.get('yt-bulk-tz') || ([...tz.options].some((o) => o.value === browserOffset) ? browserOffset : '540')
  const off = () => Number(tz.value) * 60_000
  /** ISO (UTC) → chuỗi cho ô datetime-local theo múi giờ đã chọn */
  const toLocal = (iso) => new Date(Date.parse(iso) + off()).toISOString().slice(0, 16)
  /** Giá trị ô datetime-local → ISO (UTC) */
  const fromLocal = (v) => {
    const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(v || '')
    return m ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) - off()).toISOString() : null
  }
  const show = (iso) => toLocal(iso).replace('T', ' ')
  const renderTimes = () => root.querySelectorAll('[data-time]').forEach((el) => (el.textContent = show(el.dataset.time)))

  // Giờ bắt đầu mặc định: ngày mai 20:00
  const t = new Date(Date.now() + off() + 86_400_000)
  field('start').value = `${t.toISOString().slice(0, 10)}T20:00`

  tz.addEventListener('change', () => {
    store.set('yt-bulk-tz', tz.value)
    renderTimes()
    resetPlan()
  })
  renderTimes()

  // --- Lọc theo tab ---
  const visible = () => rows.filter((r) => !r.hidden)
  const applyFilter = () => {
    for (const r of rows) r.hidden = !(filter === 'all' || r.dataset.kind === filter)
    $('[data-empty]').hidden = visible().length > 0
    root.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('active', b.dataset.filter === filter))
    updateCount()
  }
  root.querySelectorAll('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.filter
      applyFilter()
      // Bỏ chọn video không còn hiển thị để không áp dụng nhầm
      for (const r of rows) if (r.hidden) r.querySelector('[data-check]').checked = false
      updateCount()
      resetPlan()
    })
  )

  // --- Chọn ---
  const selected = () => visible().filter((r) => r.querySelector('[data-check]').checked)
  const checkAll = $('[data-check-all]')
  function updateCount() {
    const n = selected().length
    $('[data-selected-count]').textContent = `Đã chọn ${n} video`
    checkAll.checked = n > 0 && n === visible().length
    checkAll.indeterminate = n > 0 && n < visible().length
  }
  checkAll.addEventListener('change', () => {
    for (const r of visible()) r.querySelector('[data-check]').checked = checkAll.checked
    updateCount()
    resetPlan()
  })
  root.querySelector('tbody').addEventListener('change', (e) => {
    if (e.target.matches('[data-check]')) {
      updateCount()
      resetPlan()
    }
  })

  // --- Thao tác ---
  const action = field('action')
  const syncAction = () => root.querySelectorAll('[data-for]').forEach((el) => (el.hidden = el.dataset.for !== action.value))
  action.addEventListener('change', () => {
    syncAction()
    resetPlan()
  })
  syncAction()
  root.querySelectorAll('[name="privacy"],[name="start"],[name="every"],[name="unit"],[name="order"]').forEach((el) => el.addEventListener('change', resetPlan))

  const error = (msg) => {
    errBox.textContent = msg
    errBox.hidden = !msg
  }
  function resetPlan() {
    plan = null
    applyBtn.disabled = true
    $('[data-quota]').textContent = ''
    for (const r of rows) r.querySelector('[data-plan]').replaceChildren()
    error('')
  }

  $('[data-preview]').addEventListener('click', () => {
    resetPlan()
    let list = selected()
    if (!list.length) return error('Hãy tick chọn ít nhất một video.')
    const a = action.value
    if (a === 'schedule') {
      const start = fromLocal(field('start').value)
      if (!start) return error('Hãy chọn ngày giờ bắt đầu.')
      if (Date.parse(start) < Date.now() + 5 * 60_000) return error('Giờ bắt đầu phải ở tương lai (sau ít nhất 5 phút).')
      const step = Math.max(0, Number(field('every').value) || 0) * Number(field('unit').value) * 60_000
      const bad = list.filter((r) => r.dataset.kind === 'public' || r.dataset.kind === 'unlisted')
      if (bad.length) return error(`Có ${bad.length} video đã công khai/không công khai — YouTube chỉ cho đặt lịch video chưa từng công khai. Bỏ chọn các video đó.`)
      list = [...list].sort((x, y) => {
        const d = Date.parse(x.dataset.published) - Date.parse(y.dataset.published)
        return field('order').value === 'oldest' ? d : -d
      })
      plan = list.map((row, i) => ({ row, privacy: 'private', publishAt: new Date(Date.parse(start) + i * step).toISOString() }))
    } else if (a === 'privacy') {
      plan = list.map((row) => ({ row, privacy: field('privacy').value, publishAt: null }))
    } else {
      plan = list.map((row) => ({ row, privacy: 'private', publishAt: null }))
    }

    for (const p of plan) {
      const cell = p.row.querySelector('[data-plan]')
      if (p.publishAt) {
        // Cho sửa riêng giờ của từng video
        const input = document.createElement('input')
        input.type = 'datetime-local'
        input.value = toLocal(p.publishAt)
        input.addEventListener('change', () => (p.publishAt = fromLocal(input.value)))
        const label = document.createElement('span')
        label.className = 'yt-kind scheduled'
        label.textContent = '📅 Đăng lúc'
        cell.append(label, input)
      } else {
        const label = document.createElement('span')
        label.className = `yt-kind ${p.privacy === 'private' ? 'draft' : p.privacy}`
        label.textContent = LABEL[p.privacy] + (a === 'unschedule' ? ' (bỏ lịch)' : '')
        cell.append(label)
      }
    }
    $('[data-quota]').textContent = `${plan.length} video × 50 = ${(plan.length * 50).toLocaleString('vi-VN')} / 10.000 đơn vị hạn mức hôm nay. Có thể sửa giờ từng video trước khi áp dụng.`
    applyBtn.disabled = false
  })

  // --- Gửi theo từng đợt ---
  const setResult = (row, ok, text) => {
    const cell = row.querySelector('[data-result]')
    cell.textContent = text
    cell.className = ok === null ? 'muted' : ok ? 'yt-ok' : 'yt-fail'
  }

  applyBtn.addEventListener('click', async () => {
    if (!plan?.length) return
    if (plan.some((p) => p.publishAt === null && action.value === 'schedule')) return error('Có ô giờ đăng bị trống.')
    if (!confirm(`Áp dụng thay đổi cho ${plan.length} video trên YouTube?`)) return
    error('')
    applyBtn.disabled = true
    $('[data-preview]').disabled = true
    for (const p of plan) setResult(p.row, null, '⏳ Đang chờ…')

    let ok = 0
    let fail = 0
    for (let i = 0; i < plan.length; i += chunk) {
      const part = plan.slice(i, i + chunk)
      part.forEach((p) => setResult(p.row, null, '⏳ Đang gửi…'))
      let data
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: part.map((p) => ({ id: p.row.dataset.id, privacy: p.privacy, publishAt: p.publishAt })) }),
        })
        data = await res.json()
        if (data.error) throw new Error(data.error)
      } catch (e) {
        part.forEach((p) => setResult(p.row, false, '❌ ' + e.message))
        fail += part.length
        error(`Dừng lại vì lỗi: ${e.message}`)
        break
      }
      const byId = new Map(data.results.map((r) => [r.id, r]))
      for (const p of part) {
        const r = byId.get(p.row.dataset.id)
        if (!r) {
          setResult(p.row, false, '⏸ Chưa chạy (dừng do hết hạn mức)')
          fail++
          continue
        }
        if (!r.ok) {
          setResult(p.row, false, '❌ ' + r.error)
          fail++
          continue
        }
        ok++
        const k = r.privacy === 'private' ? (r.publishAt ? 'scheduled' : 'draft') : r.privacy
        p.row.dataset.kind = k
        const cur = p.row.querySelector('[data-current]')
        const label = document.createElement('span')
        label.className = `yt-kind ${k}`
        label.textContent = LABEL[k]
        cur.replaceChildren(label)
        if (r.publishAt) {
          const d = document.createElement('div')
          d.className = 'muted'
          d.dataset.time = r.publishAt
          d.textContent = show(r.publishAt)
          cur.append(d)
        }
        setResult(p.row, true, '✅ Xong')
      }
    }
    $('[data-preview]').disabled = false
    plan = null
    $('[data-quota]').textContent = `Hoàn tất: ${ok} thành công${fail ? `, ${fail} lỗi` : ''}. Tải lại trang để cập nhật số đếm.`
  })

  applyFilter()
})()
