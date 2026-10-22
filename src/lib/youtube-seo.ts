import { analyzeTitle, pickVariants } from './video-post'

// Gợi ý tiêu đề, mô tả, tag, hashtag cho video YouTube (tiếng Nhật, theo mẫu, không dùng AI)
// và chấm điểm SEO cơ bản. Dùng chung bộ phân tích tiêu đề với bài tự đăng (lib/video-post.ts).

export type SeoInput = { title: string; notes?: string; footer?: string; defaultTags?: string }
export type SeoSuggestion = { titles: string[]; description: string; tags: string[]; hashtags: string[] }

const BASE_TAGS = ['テレフォン人生相談', '人生相談', '電話相談', '悩み相談', 'ラジオ']
const TOPIC_TAGS: Record<string, string[]> = {
  souzoku: ['相続', '遺産', 'お金の悩み', '家族トラブル'],
  fuufu: ['夫婦関係', '夫婦の悩み', '離婚', '恋愛相談'],
  oyako: ['親子関係', '家族の悩み', '子育て', '親子問題'],
  shigoto: ['人間関係', '職場の悩み', '仕事の悩み'],
  kokoro: ['心の悩み', '生き方', '不安', '心理学'],
  general: ['人生', '悩み'],
}
const TOPIC_HASHTAG: Record<string, string> = {
  souzoku: '#相続',
  fuufu: '#夫婦関係',
  oyako: '#親子関係',
  shigoto: '#人間関係',
  kokoro: '#心の悩み',
  general: '#人生',
}

const TITLE_MAX = 100 // giới hạn của YouTube
const TAGS_MAX_CHARS = 500 // tổng độ dài tag YouTube cho phép

/** Cắt tag về giới hạn của YouTube: mỗi tag ≤ 30 ký tự, tổng ≤ 500, không trùng */
export function normalizeTags(tags: string[]) {
  const out: string[] = []
  let total = 0
  for (const raw of tags) {
    const t = raw.replace(/[<>,#]/g, '').trim().slice(0, 30)
    if (!t || out.some((x) => x.toLowerCase() === t.toLowerCase())) continue
    const cost = t.length + (t.includes(' ') ? 2 : 0) + (out.length ? 1 : 0)
    if (total + cost > TAGS_MAX_CHARS) break
    out.push(t)
    total += cost
  }
  return out
}

/** Từ khoá trong tiêu đề: câu trích + các cụm 2–12 ký tự tách theo dấu câu */
function keywords(core: string, quote?: string) {
  const parts = core
    .replace(/「[^」]*」/g, ' ')
    .split(/[！!？?。、・…“”"『』（）()\s]+|が|を|に|で|と|の|は|も/)
    .map((s) => s.trim())
    // Chỉ giữ cụm toàn chữ Hán/Katakana (danh từ rõ nghĩa như 土地共有, 危険性), bỏ mảnh câu cụt
    .filter((s) => /^[\p{Script=Han}\p{Script=Katakana}ー]{2,10}$/u.test(s))
  return [...(quote ? [quote.slice(0, 30)] : []), ...parts].slice(0, 8)
}

export function suggestSeo(input: SeoInput): SeoSuggestion {
  const a = analyzeTitle(input.title)
  const names = a.people.map((p) => p.name)
  const peopleText = a.people.map((p) => `${p.role}の${p.name}`).join('、')
  const topicKey = a.topic.key

  // Tiêu đề: giữ từ khoá chính ở đầu, tên người ở cuối
  const nameTail = names.filter((n) => !a.core.includes(n)).join('＆')
  const titles = [
    `【テレフォン人生相談】${a.core}${nameTail ? ` ${nameTail}` : ''}`,
    `${a.quote ? `「${a.quote}」` : ''}${a.quote ? a.core.replace(`「${a.quote}」`, '') : a.core}【テレフォン人生相談】`,
    `${a.core}｜${names.length ? names.join('・') : '人生相談'}【テレフォン人生相談】`,
  ]
    .map((t) => t.replace(/\s{2,}/g, ' ').trim().slice(0, TITLE_MAX))
    .filter((t, i, arr) => arr.indexOf(t) === i)

  const opener = pickVariants(a.topic.openers, 1, a.seed)[0]
  const points = pickVariants(a.topic.points, 3, a.seed).map(([h]) => h)
  const targets = pickVariants(a.topic.targets, 3, a.seed)
  const hashtags = ['#テレフォン人生相談', '#人生相談', TOPIC_HASHTAG[topicKey] ?? '#人生']
  const notes = input.notes?.trim()

  const description = [
    a.quote && !a.core.startsWith(`「${a.quote}」`) ? `「${a.quote}」` : opener,
    `${a.core}${/[。！!？?」]$/.test(a.core) ? '' : '。'}${peopleText ? `${peopleText}が、相談者の悩みに向き合います。` : ''}`,
    ...(notes ? ['', notes] : []),
    '',
    '▼この動画のポイント',
    ...points.map((p) => `・${p}`),
    '',
    '▼こんな方におすすめ',
    ...targets.map((t) => `・${t}`),
    '',
    'チャンネル登録・高評価で、新しい相談回をいち早くお届けします。',
    ...(input.footer?.trim() ? ['', input.footer.trim()] : []),
    '',
    hashtags.join(' '),
  ].join('\n')

  const tags = normalizeTags([
    ...BASE_TAGS,
    ...names,
    ...(TOPIC_TAGS[topicKey] ?? []),
    ...(a.second ? (TOPIC_TAGS[a.second.key] ?? []).slice(0, 2) : []),
    ...keywords(a.core, a.quote),
    ...(input.defaultTags ?? '').split(/[,、]/),
  ])

  return { titles, description, tags, hashtags }
}

// --- Chấm điểm SEO cơ bản ---

export type SeoCheck = { ok: boolean; label: string; tip: string }

export function seoChecks(v: { title: string; description: string; tags: string[] }): { score: number; checks: SeoCheck[] } {
  const title = v.title.trim()
  const desc = v.description.trim()
  const firstLines = desc.split('\n').slice(0, 3).join('')
  const hashtags = desc.match(/#[^\s#]+/g) ?? []
  const tagChars = v.tags.join(',').length
  const main = 'テレフォン人生相談'
  const checks: SeoCheck[] = [
    {
      ok: title.length >= 20 && title.length <= 70,
      label: `Độ dài tiêu đề: ${title.length} ký tự`,
      tip: 'Nên 20–70 ký tự; phần quan trọng nằm trong ~40 ký tự đầu (trên điện thoại tiêu đề bị cắt).',
    },
    { ok: title.includes(main) || title.includes('人生相談'), label: 'Tiêu đề có từ khoá chính', tip: `Nên có 「${main}」 hoặc 「人生相談」 trong tiêu đề.` },
    { ok: desc.length >= 200, label: `Độ dài mô tả: ${desc.length} ký tự`, tip: 'Nên từ 200 ký tự trở lên để YouTube hiểu nội dung video.' },
    {
      ok: firstLines.includes('人生相談') || keywords(title).some((k) => firstLines.includes(k)),
      label: 'Từ khoá xuất hiện ở đầu mô tả',
      tip: '1–2 dòng đầu mô tả hiện trong kết quả tìm kiếm: nên nhắc lại chủ đề chính.',
    },
    {
      ok: hashtags.length >= 1 && hashtags.length <= 15,
      label: `Hashtag: ${hashtags.length}`,
      tip: 'Nên có 1–3 hashtag (3 cái đầu hiện trên tiêu đề). Quá 15 hashtag YouTube sẽ bỏ qua tất cả.',
    },
    {
      ok: v.tags.length >= 5 && tagChars <= TAGS_MAX_CHARS,
      label: `Tag: ${v.tags.length} (${tagChars}/${TAGS_MAX_CHARS} ký tự)`,
      tip: 'Nên có 5–15 tag gồm từ khoá chính, tên người tư vấn và chủ đề.',
    },
    { ok: /チャンネル登録|登録/.test(desc), label: 'Có lời mời đăng ký kênh', tip: 'Thêm một câu mời đăng ký kênh ở cuối mô tả.' },
  ]
  return { score: Math.round((checks.filter((c) => c.ok).length / checks.length) * 100), checks }
}
