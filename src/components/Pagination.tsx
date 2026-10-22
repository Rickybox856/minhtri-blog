export const PER_PAGE = 10

/** Số trang từ đường dẫn ".../trang/:n"; null nếu không hợp lệ */
export const parsePage = (raw: string | undefined) => {
  if (raw === undefined) return 1
  return /^[1-9]\d{0,4}$/.test(raw) ? Number(raw) : null
}

/** Link tới trang n: trang 1 là đường dẫn gốc, các trang sau là <gốc>/trang/n */
export const pageHref = (base: string, n: number) => (n <= 1 ? base : `${base}/trang/${n}`)

// Danh sách số trang cần hiện: luôn có trang đầu, cuối và 2 trang quanh trang hiện tại
function pageNumbers(current: number, last: number): (number | '…')[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1)
  const out: (number | '…')[] = [1]
  const from = Math.max(2, current - 2)
  const to = Math.min(last - 1, current + 2)
  if (from > 2) out.push('…')
  for (let i = from; i <= to; i++) out.push(i)
  if (to < last - 1) out.push('…')
  out.push(last)
  return out
}

export const Pagination = ({ base, page, total }: { base: string; page: number; total: number }) => {
  const last = Math.ceil(total / PER_PAGE)
  if (last <= 1) return null
  return (
    <nav class="pagination" aria-label="ページ送り">
      {page > 1 ? (
        <a class="pg-prev" href={pageHref(base, page - 1)} rel="prev">‹ 前へ</a>
      ) : (
        <span class="pg-prev disabled">‹ 前へ</span>
      )}
      {pageNumbers(page, last).map((n) =>
        n === '…' ? (
          <span class="pg-gap">…</span>
        ) : n === page ? (
          <span class="pg-num current" aria-current="page">{n}</span>
        ) : (
          <a class="pg-num" href={pageHref(base, n)}>{n}</a>
        )
      )}
      {page < last ? (
        <a class="pg-next" href={pageHref(base, page + 1)} rel="next">次へ ›</a>
      ) : (
        <span class="pg-next disabled">次へ ›</span>
      )}
      <p class="pg-info">
        全{total}件中 {(page - 1) * PER_PAGE + 1}〜{Math.min(page * PER_PAGE, total)}件を表示（{page}/{last}ページ）
      </p>
    </nav>
  )
}
