// Tạo bài giới thiệu video (tiếng Nhật) từ tiêu đề YouTube, không dùng AI.
// Để các bài không giống hệt nhau: nhận diện chủ đề + người tư vấn + câu trích 「…」 trong tiêu đề,
// rồi chọn câu chữ từ nhiều biến thể theo mã video (cùng video luôn ra cùng một bài).

export type VideoPost = { slug: string; title: string; excerpt: string; markdown: string }

// --- Người trong chương trình ---
const PEOPLE: Record<string, string> = {
  加藤諦三: 'パーソナリティ',
  今井通子: 'パーソナリティ',
  勝野洋: 'パーソナリティ',
  柴田理恵: 'パーソナリティ',
  ドリアン助川: 'パーソナリティ',
  玉置妙憂: 'パーソナリティ',
  市川森一: 'パーソナリティ',
  中川潤: '弁護士',
  坂井眞: '弁護士',
  大迫恵美子: '弁護士',
  塩谷崇之: '弁護士',
  野島梨恵: '弁護士',
  高中正彦: '弁護士',
  高橋龍太郎: '精神科医',
  大原敬子: '幼児教育研究家',
  'マドモアゼル・愛': 'エッセイスト',
  マドモアゼル愛: 'エッセイスト',
  三石由起子: '作家',
}
const LAWYER = '弁護士'

/** Tiêu đề chỉ là ngày tháng (bản tổng hợp) → bỏ qua, không có gì để viết */
export function isCompilationTitle(raw: string) {
  const core = stripPrefix(raw)
  return /\d{4}\s*[年./]\s*\d{1,2}\s*[月./]\s*\d{1,2}\s*日?\s*$/.test(core) || core.replace(/[\p{Extended_Pictographic}\s]/gu, '').length < 8
}

const stripPrefix = (raw: string) =>
  raw
    .replace(/【\s*テレフォン人生相談\s*】/g, '')
    .replace(/テレフォン人生相談[、,\s-]*悩み/g, '')
    .replace(/#\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const NAMES = Object.keys(PEOPLE).sort((a, b) => b.length - a.length)
const SEP = /^[\s　＆&・、,|｜!！-]+/u

/**
 * Người trong tiêu đề (theo thứ tự xuất hiện) + phần tiêu đề chính.
 * Chỉ cắt khối tên ở CUỐI tiêu đề ("…構造！加藤諦三＆中川潤"); tên nằm giữa câu
 * ("加藤諦三が突く…") giữ nguyên để câu không bị hỏng.
 */
function splitPeople(text: string) {
  const found: { name: string; at: number }[] = []
  for (const name of NAMES) {
    const at = text.indexOf(name)
    if (at !== -1 && !found.some((f) => at >= f.at && at < f.at + f.name.length)) found.push({ name, at })
  }
  const people = found
    .sort((a, b) => a.at - b.at)
    .map((f) => f.name)
    .filter((n, i, arr) => arr.findIndex((m) => m.replace('・', '') === n.replace('・', '')) === i)

  // Cắt dần từ cuối: [dấu nối][tên] lặp lại
  let core = text.trim()
  for (;;) {
    const name = NAMES.find((n) => core.endsWith(n))
    if (!name) break
    core = core.slice(0, -name.length).replace(/[\s　＆&・、,|｜-]+$/u, '').trim()
  }
  core = core.replace(SEP, '').replace(/[\s　]{2,}/g, ' ').trim()
  return { core: core || text.trim(), people }
}

// --- Chủ đề ---
type Topic = {
  key: string
  re: RegExp
  openers: string[]
  points: [string, string][]
  targets: string[]
  link?: [string, string]
}

const TOPICS: Topic[] = [
  {
    key: 'souzoku',
    re: /相続|遺産|遺言|土地|財産|借金|お金|債務|養育費|金銭|貸し|騙/,
    openers: [
      'お金や財産のことになると、家族でさえ思いがけずこじれてしまうもの。',
      '「まさか自分の家族が」――お金をめぐるもめごとは、どの家庭にも起こりえます。',
      'お金の問題は、気持ちの問題と分けられないからこそ難しいものです。',
    ],
    points: [
      ['知っておきたい現実的なルール', '感情だけでは解決できない問題に、どんな手立てがあるのか。いざというときに役立つ考え方が語られます。'],
      ['お金の奥にある気持ち', '争っているのは本当にお金なのか。言葉にできなかった思いが、相談のなかで少しずつ見えてきます。'],
      ['こじれる前にできること', '問題を先送りにせず、いま何をしておくべきか。具体的なヒントが詰まっています。'],
      ['家族の関係をどう守るか', '正しさだけでは割り切れない家族の問題。関係を壊さずに向き合うための視点が示されます。'],
    ],
    targets: ['相続や家族のお金のことで悩んでいる方', '親族との関係にしこりを抱えている方', '将来のお金の問題に備えておきたい方', 'お金の貸し借りでトラブルを抱えている方'],
    link: ['/bai-viet/telephone-jinsei-soudan-towa', '「テレフォン人生相談」とは'],
  },
  {
    key: 'fuufu',
    re: /夫婦|夫|妻|結婚|離婚|浮気|不倫|恋愛|交際|再婚|内縁|嫁/,
    openers: [
      'いちばん近くにいるはずのパートナーが、いちばん遠く感じる――そんな夜はありませんか。',
      '長く一緒にいるからこそ、言えなくなることがあります。',
      '夫婦の問題は、外からはなかなか見えないものです。',
    ],
    points: [
      ['すれ違いはどこから始まったのか', 'ふたりの関係がこじれていった背景に、相談のやりとりを通して光が当てられます。'],
      ['相手を変えるより、自分に気づく', '相手への不満の奥にある、自分自身の心の動きに目を向けるきっかけになります。'],
      ['これからの関係をどう選ぶか', '続けるのか、距離を置くのか。後悔しない選択のための考え方が語られます。'],
      ['我慢の限界とその先', '飲み込んできた思いが、どんな形で表れてしまうのか。心の仕組みがわかりやすく語られます。'],
    ],
    targets: ['夫婦関係に悩みを抱えている方', 'パートナーとの距離を感じている方', '恋愛や結婚に迷いがある方', '「我慢すればいい」と思い込んでいる方'],
    link: ['/bai-viet/kokoro-no-kamen-wo-hazusou', '『心の仮面をはずそう』の紹介記事'],
  },
  {
    key: 'oyako',
    re: /息子|娘|母|父|親|子ども|子供|孫|姑|きょうだい|兄|姉|弟|妹|家族|男子|女子|子離れ/,
    openers: [
      '家族だからこそ、言えないこと、わかり合えないことがあります。',
      '親と子、きょうだい――近い関係ほど、こじれたときの痛みは深いものです。',
      '「家族なんだから」という思いが、ときに心を縛ってしまうことがあります。',
    ],
    points: [
      ['家族の歴史が映し出すもの', 'いまの悩みの根っこにある、長い年月の積み重ねに光が当てられます。'],
      ['相手の本当の気持ち', '言葉や行動の奥にある、相手の心のサインをどう受け取ればいいのかが語られます。'],
      ['距離のとり方を見直す', '近すぎても、離れすぎても苦しい。ちょうどいい距離を見つけるためのヒントです。'],
      ['自分の人生を生きるために', '家族の期待や役割から少し離れて、自分自身を大切にする視点が示されます。'],
    ],
    targets: ['親子関係や家族のことで悩んでいる方', '子育てに迷いを感じている親御さん', '家族との距離感に疲れている方', '家族のために自分を後回しにしてきた方'],
    link: ['/bai-viet/yoiko-no-higeki', '『よい子の悲劇』の紹介記事'],
  },
  {
    key: 'shigoto',
    re: /職場|上司|仕事|会社|同僚|部下|近所|友人|人間関係|社会人/,
    openers: [
      '毎日顔を合わせる相手だからこそ、人間関係の悩みは心に重くのしかかります。',
      '仕事や人づきあいの悩みは、誰にも相談できないまま抱え込みがちです。',
    ],
    points: [
      ['人間関係がこじれる理由', '相手との関わり方のクセや、心の奥にある思い込みが見えてきます。'],
      ['自分を守る距離のとり方', '我慢しすぎず、ぶつかりすぎず。明日から試せる考え方が語られます。'],
      ['立場や役割にとらわれない', '肩書きや評価から離れたとき、本当に大切なものが見えてきます。'],
    ],
    targets: ['職場の人間関係に悩んでいる方', '人づきあいに疲れを感じている方', '自分の居場所がないと感じている方'],
  },
  {
    key: 'kokoro',
    re: /不安|孤独|心|自分|生き方|人生|怖|寂し|自信|劣等|執着|依存|勇気|楽観|絶望|失望|苦し|悩/,
    openers: [
      '心の中のモヤモヤに、名前をつけられずにいませんか。',
      '「このままでいいのだろうか」――そんな思いが、ふとよぎることはありませんか。',
      '誰にも言えない心の重さを、ひとりで抱えていませんか。',
    ],
    points: [
      ['心の動きを言葉にする', '漠然とした不安や苦しさが、相談のやりとりのなかで少しずつ形になっていきます。'],
      ['見方が変わると、生き方が変わる', '同じ出来事でも、受け止め方ひとつで心は軽くなる。その転換のヒントが語られます。'],
      ['自分を責めすぎないために', '弱さや迷いを否定せず、受け止めることから始まる一歩が示されます。'],
      ['本当の気持ちに気づく', '自分でも気づいていなかった本音に光が当たる瞬間は、聴いている側の心にも響きます。'],
    ],
    targets: ['漠然とした不安を抱えている方', '自分の生き方に迷いがある方', '心を軽くするきっかけを探している方', 'つい自分を責めてしまう方'],
    link: ['/bai-viet/kokoro-no-yasumasekata', '『心の休ませ方』の紹介記事'],
  },
]

const GENERAL: Topic = {
  key: 'general',
  re: /.^/,
  openers: [
    '人生には、ひとりでは答えの出せない悩みがあります。',
    '誰かに話を聞いてもらうだけで、見えてくるものがあります。',
  ],
  points: [
    ['相談者の声に耳を傾ける', '相談者の言葉の奥にある本当の気持ちが、やりとりのなかで少しずつ見えてきます。'],
    ['問題の本質に迫る', '表に見えている悩みの奥にある、本当の問題に光が当てられます。'],
    ['明日からの一歩', '聴き終えたあとに、少しだけ前を向けるヒントが詰まっています。'],
  ],
  targets: ['人生の悩みを抱えている方', '誰かの相談から気づきを得たい方', 'テレフォン人生相談が好きな方'],
  link: ['/bai-viet/telephone-jinsei-soudan-towa', '「テレフォン人生相談」とは'],
}

const CLOSINGS = [
  '他人の相談なのに、なぜか自分のことのように胸に響く――それがテレフォン人生相談の魅力です。ぜひ最後まで聴いてみてください。',
  '聴き終えたとき、自分の悩みの見え方も少し変わっているかもしれません。じっくりとお楽しみください。',
  '同じような悩みを抱えている方にこそ、聴いてほしい回です。気になった方は、ぜひ再生ボタンを押してみてください。',
  '答えはひとつではありません。だからこそ、誰かの相談に耳を傾けることが、自分の答えを見つけるヒントになります。',
]

// --- Tiện ích ---
const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
/** Chọn n phần tử khác nhau, cố định theo seed */
function pick<T>(arr: T[], n: number, seed: number) {
  const a = [...arr]
  const out: T[] = []
  let s = seed
  while (out.length < n && a.length) {
    s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0
    out.push(a.splice(s % a.length, 1)[0])
  }
  return out
}
/** Chèn chữ người dùng vào Markdown an toàn (không HTML, không cú pháp Markdown) */
const md = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/([*_`[\]\\])/g, '\\$1')
const attr = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Phân tích tiêu đề: phần chính, người tư vấn (kèm vai trò), câu trích, chủ đề (khớp nhiều từ khoá nhất trước) */
export function analyzeTitle(raw: string) {
  const { core, people } = splitPeople(stripPrefix(raw))
  const quote = core.match(/「([^」]{3,40})」/)?.[1]
  const score = (t: Topic) => core.match(new RegExp(t.re.source, 'g'))?.length ?? 0
  const topics = TOPICS.map((t) => ({ t, n: score(t) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.t)
  return {
    core,
    quote,
    people: people.map((name) => ({ name, role: PEOPLE[name] })),
    topic: topics[0] ?? GENERAL,
    second: topics[1],
    seed: hash(raw),
  }
}
export { pick as pickVariants }
export type { Topic }

export function videoSlug(id: string, date = new Date()) {
  const d = date.toISOString().slice(0, 10).replace(/-/g, '')
  return `video-${d}-${id.toLowerCase().replace(/[^a-z0-9]/g, '')}`
}

export function buildVideoPost(video: { id: string; title: string }, date = new Date()): VideoPost {
  const seed = hash(video.id)
  const { core, people } = splitPeople(stripPrefix(video.title))
  const quote = core.match(/「([^」]{3,40})」/)?.[1]
  // Chủ đề khớp nhiều từ khoá nhất đứng trước (hoà thì theo thứ tự khai báo)
  const score = (t: Topic) => core.match(new RegExp(t.re.source, 'g'))?.length ?? 0
  const topics = TOPICS.map((t) => ({ t, n: score(t) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.t)
  const topic = topics[0] ?? GENERAL
  const second = topics[1]

  const roleOf = (p: string) => PEOPLE[p]
  const peopleText = people.map((p) => `${roleOf(p)}の${p}`).join('と')
  const hasLawyer = people.some((p) => roleOf(p) === LAWYER)
  const hasKato = people.includes('加藤諦三')
  const hasDoctor = people.some((p) => roleOf(p) === '精神科医')

  const tail = people.filter((p) => !core.includes(p)) // tên đã nằm trong câu thì không lặp lại
  const title = `【動画】${core}${tail.length ? `――${tail.join('＆')}` : ''}`
  const opener = pick(topic.openers, 1, seed)[0]
  const peopleLine = people.length ? `${peopleText}が、相談者の声に向き合います。` : '相談者の切実な声に、番組がまっすぐ向き合います。'

  const introVariants = [
    quote
      ? `「${md(quote)}」\n\nこの回で投げかけられたひとことに、思わずドキッとした方も多いのではないでしょうか。\n\n今回のテーマは、**${md(core)}**。${peopleLine}`
      : `${opener}\n\nテレフォン人生相談の今回のテーマは、**${md(core)}**。${peopleLine}`,
    `**${md(core)}**――。\n\n${opener}${quote ? `「${md(quote)}」という言葉の奥にあるものとは何なのか。` : ''}${peopleLine}`,
    `${opener}\n\nこの回で取り上げられるのは、**${md(core)}**という相談です。${peopleLine}`,
  ]
  const intro = introVariants[seed % introVariants.length]

  // Điểm nổi bật: 2 từ chủ đề chính + 1 theo người tư vấn (hoặc chủ đề phụ)
  const points = pick(topic.points, 2, seed)
  if (hasKato) points.push(['加藤諦三の鋭い洞察', '相談者自身も気づいていない心の奥に、加藤諦三ならではの言葉で光が当てられます。'])
  else if (hasLawyer) points.push(['弁護士の現実的なアドバイス', '気持ちの整理だけでなく、法律の面から何ができるのかが具体的に示されます。'])
  else if (hasDoctor) points.push(['精神科医の落ち着いた視点', '心の専門家ならではの言葉が、追い詰められた気持ちをそっとほどいていきます。'])
  else points.push(pick((second ?? GENERAL).points.filter((p) => !points.includes(p)), 1, seed + 7)[0])

  const targets = [...new Set([...pick(topic.targets, 2, seed), ...pick((second ?? GENERAL).targets, 1, seed + 3)])].slice(0, 3)
  const closing = CLOSINGS[(seed >>> 3) % CLOSINGS.length]
  const link = topic.link ?? GENERAL.link
  const url = `https://www.youtube.com/watch?v=${video.id}`

  const markdown = `${intro}

<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/${video.id}" title="${attr(core)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>

<p class="video-cta"><a class="btn" href="${url}" target="_blank" rel="noopener">▶ YouTubeで今すぐ視聴する</a></p>

## この回の見どころ

${points.map(([h, b]) => `- **${h}**　${b}`).join('\n')}

## こんな方におすすめです

${targets.map((t) => `- ${t}`).join('\n')}

${closing}

[▶ 動画をYouTubeで見る](${url})${link ? `\n\nあわせて読みたい：[${link[1]}](${link[0]})` : ''}
`

  const lead = quote && !core.startsWith(`「${quote}」`) ? `「${quote}」――` : ''
  const end = /[。！!？?」』…]$/.test(core) ? '' : '。'
  const excerpt = `${lead}${core}${end}テレフォン人生相談の注目回を、見どころとあわせてご紹介します。`.slice(0, 160)

  return { slug: videoSlug(video.id, date), title: title.slice(0, 150), excerpt, markdown }
}
