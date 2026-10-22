// Đọc danh sách video mới nhất của một kênh YouTube từ trang /videos (RSS của kênh đang hỏng).
// Không JSON.parse cả trang (~1,3 MB) để giữ CPU thấp: chỉ cắt từng ô video rồi lấy id + tiêu đề.
// YouTube thử nhiều kiểu giao diện nên hỗ trợ cả "videoRenderer" (cũ) lẫn "lockupViewModel" (mới).

export type ChannelVideo = { id: string; title: string }

const unescapeJson = (s: string) => {
  try {
    return JSON.parse(`"${s}"`) as string
  } catch {
    return s
  }
}

const TITLE_RES = [
  /"lockupMetadataViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)*)"/, // kiểu mới
  /"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/, // kiểu cũ
]

/** Lấy tối đa `max` video (mới nhất trước) từ HTML trang /videos */
export function parseChannelVideos(html: string, max = 30): ChannelVideo[] {
  const out: ChannelVideo[] = []
  const seen = new Set<string>()
  let pos = html.indexOf('"richItemRenderer":')
  while (pos !== -1 && out.length < max) {
    const next = html.indexOf('"richItemRenderer":', pos + 20)
    const chunk = html.slice(pos, next === -1 ? pos + 20000 : next)
    pos = next
    const id =
      chunk.match(/"videoId":"([\w-]{11})"/)?.[1] ??
      chunk.match(/"contentId":"([\w-]{11})"/)?.[1] ??
      chunk.match(/\/vi\/([\w-]{11})\//)?.[1]
    if (!id || seen.has(id)) continue
    let title: string | undefined
    for (const re of TITLE_RES) {
      const m = chunk.match(re)
      if (m) {
        title = unescapeJson(m[1])
        break
      }
    }
    if (!title) continue
    seen.add(id)
    out.push({ id, title })
  }
  return out
}

export async function fetchChannelVideos(channelId: string): Promise<ChannelVideo[]> {
  const res = await fetch(`https://www.youtube.com/channel/${channelId}/videos`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'Accept-Language': 'ja,en;q=0.8',
      // Bỏ qua trang hỏi đồng ý cookie (máy chủ ở châu Âu hay gặp)
      Cookie: 'SOCS=CAI; CONSENT=YES+1',
    },
  })
  if (!res.ok) throw new Error(`YouTube trả mã ${res.status}`)
  const html = await res.text()
  const videos = parseChannelVideos(html)
  if (!videos.length) throw new Error('Không đọc được danh sách video (YouTube có thể đã đổi giao diện).')
  return videos
}

/** Tải ảnh thumbnail lớn nhất có sẵn */
export async function fetchThumbnail(id: string): Promise<ArrayBuffer | null> {
  for (const name of ['maxresdefault', 'hqdefault']) {
    const res = await fetch(`https://i.ytimg.com/vi/${id}/${name}.jpg`)
    if (res.ok) return res.arrayBuffer()
  }
  return null
}
