// Trang quản trị: tải ảnh lên R2 (thu nhỏ + WebP ngay trên trình duyệt) và nút sao chép.
(() => {
  const MAX_WIDTH = 1600
  const QUALITY = 0.82

  // Thu nhỏ ảnh về rộng tối đa MAX_WIDTH và mã hoá WebP (JPEG nếu trình duyệt không hỗ trợ WebP).
  // GIF giữ nguyên để không mất hiệu ứng động.
  // format "png-square" (favicon): cắt giữa thành hình vuông cạnh tối đa maxWidth, lưu PNG.
  async function prepareImage(file, { maxWidth = MAX_WIDTH, format } = {}) {
    if (file.type === 'image/gif' && !format) return { blob: file, width: '', height: '' }
    const bitmap = await createImageBitmap(file)
    const square = format === 'png-square'
    const side = Math.min(bitmap.width, bitmap.height)
    const sw = square ? side : bitmap.width
    const sh = square ? side : bitmap.height
    const scale = Math.min(1, maxWidth / sw)
    const width = Math.round(sw * scale)
    const height = Math.round(sh * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, width, height)
    bitmap.close?.()
    if (square) {
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
      return { blob, width: String(width), height: String(height) }
    }
    let blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', QUALITY))
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
    return { blob, width: String(width), height: String(height) }
  }

  async function upload(file, options) {
    const { blob, width, height } = await prepareImage(file, options)
    const data = new FormData()
    data.append('file', blob, file.name)
    data.append('name', file.name)
    data.append('width', width)
    data.append('height', height)
    const res = await fetch('/quan-tri/anh/tai-len', { method: 'POST', body: data, credentials: 'same-origin' })
    const json = await res.json().catch(() => ({ error: `Lỗi máy chủ (${res.status})` }))
    if (!res.ok || json.error) throw new Error(json.error || `Lỗi ${res.status}`)
    return json
  }

  // Chèn đoạn văn bản vào textarea tại vị trí con trỏ
  function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart ?? textarea.value.length
    const end = textarea.selectionEnd ?? start
    const before = textarea.value.slice(0, start)
    const block = (before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '') + text + '\n\n'
    textarea.setRangeText(block, start, end, 'end')
    textarea.focus()
  }

  // <div class="upload-widget" data-mode="key|url|markdown|library" data-target="tên ô input">
  for (const widget of document.querySelectorAll('.upload-widget')) {
    const input = widget.querySelector('input[type=file]')
    const status = widget.querySelector('.upload-status')
    const mode = widget.dataset.mode
    const target = widget.dataset.target && document.querySelector(`[name="${widget.dataset.target}"]`)
    const preview = widget.querySelector('.upload-preview') || (widget.nextElementSibling?.classList.contains('upload-preview') ? widget.nextElementSibling : null)
    const options = { maxWidth: Number(widget.dataset.max) || undefined, format: widget.dataset.format }

    input.addEventListener('change', async () => {
      const files = [...input.files]
      if (!files.length) return
      input.disabled = true
      try {
        for (const [i, file] of files.entries()) {
          status.textContent = `Đang xử lý ${files.length > 1 ? `${i + 1}/${files.length}: ` : ''}${file.name}...`
          const result = await upload(file, options)
          if (mode === 'key' && target) target.value = result.key
          if (mode === 'url' && target) target.value = result.url
          if (mode === 'markdown' && target) insertAtCursor(target, result.snippet)
          if (preview) {
            preview.src = result.url
            preview.hidden = false
          }
        }
        status.textContent = mode === 'markdown' ? 'Đã chèn ảnh vào nội dung. Nhớ sửa chú thích.' : 'Đã tải lên.'
        if (mode === 'library') location.reload()
      } catch (err) {
        status.textContent = `Lỗi: ${err.message}`
      } finally {
        input.disabled = false
        input.value = ''
      }
    })
  }

  // Nút sao chép (thư viện ảnh)
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]')
    if (!btn) return
    await navigator.clipboard.writeText(btn.dataset.copy)
    const label = btn.textContent
    btn.textContent = 'Đã chép!'
    setTimeout(() => (btn.textContent = label), 1500)
  })

  // Xem trước ảnh bìa khi gõ key tay
  for (const field of document.querySelectorAll('[data-preview-for]')) {
    const img = document.getElementById(field.dataset.previewFor)
    field.addEventListener('change', () => {
      const v = field.value.trim()
      img.hidden = !v
      if (v) img.src = /^https?:\/\//.test(v) ? v : `/media/${v.split('/').map(encodeURIComponent).join('/')}`
    })
  }
})()
