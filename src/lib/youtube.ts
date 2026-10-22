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

// --- Dự phòng: YouTube Data API v3 (chính thức, cần API key Google, miễn phí 10.000 đơn vị/ngày) ---
// Mỗi lần dùng tốn 2 đơn vị: playlistItems (danh sách tải lên) + videos (thời lượng, để bỏ Shorts/livestream).

const API = 'https://www.googleapis.com/youtube/v3'
const SHORT_MAX_SECONDS = 180 // Shorts dài tối đa 3 phút

type ApiError = { error?: { message?: string; errors?: { reason?: string }[] } }

/** Xác thực API: API key, hoặc mã truy cập OAuth của một kênh đã liên kết (đọc được dữ liệu công khai của mọi kênh) */
export type ApiAuth = { key: string } | { token: string }

async function apiGet<T>(path: string, params: Record<string, string>, auth: ApiAuth): Promise<T> {
  const res =
    'key' in auth
      ? await fetch(`${API}/${path}?${new URLSearchParams({ ...params, key: auth.key })}`)
      : await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${auth.token}` } })
  const data = (await res.json().catch(() => ({}))) as T & ApiError
  if (!res.ok) {
    const reason = data.error?.errors?.[0]?.reason
    const msg =
      reason === 'quotaExceeded'
        ? 'API đã hết hạn mức trong ngày'
        : res.status === 401
          ? 'Quyền truy cập kênh đã liên kết không còn hợp lệ (cần kết nối lại)'
        : res.status === 400 || res.status === 403
          ? `${'key' in auth ? 'API key không hợp lệ hoặc chưa' : 'Project Google chưa'} bật YouTube Data API v3 (${data.error?.message ?? res.status})`
          : `YouTube API trả mã ${res.status}`
    throw new Error(msg)
  }
  return data
}

/** ISO 8601 "PT1H2M3S" → giây */
const isoSeconds = (d: string) => {
  const m = d.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  return m ? (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + +(m[4] ?? 0) : 0
}

export async function fetchChannelVideosApi(channelId: string, auth: ApiAuth): Promise<ChannelVideo[]> {
  // Danh sách tải lên của kênh có mã UU… tương ứng UC…
  const uploads = `UU${channelId.slice(2)}`
  const list = await apiGet<{ items?: { snippet: { title: string; resourceId: { videoId: string } } }[] }>(
    'playlistItems',
    { part: 'snippet', playlistId: uploads, maxResults: '30' },
    auth
  )
  const items = (list.items ?? []).map((i) => ({ id: i.snippet.resourceId.videoId, title: i.snippet.title }))
  if (!items.length) return []
  const details = await apiGet<{
    items?: { id: string; contentDetails: { duration: string }; snippet: { liveBroadcastContent: string }; status: { privacyStatus: string } }[]
  }>('videos', { part: 'contentDetails,snippet,status', id: items.map((v) => v.id).join(',') }, auth)
  // Chỉ video công khai: khi dùng quyền của chủ kênh, danh sách có cả video nháp / đang chờ lịch
  const ok = new Set(
    (details.items ?? [])
      .filter(
        (d) =>
          d.status.privacyStatus === 'public' &&
          d.snippet.liveBroadcastContent === 'none' &&
          isoSeconds(d.contentDetails.duration) > SHORT_MAX_SECONDS
      )
      .map((d) => d.id)
  )
  return items.filter((v) => ok.has(v.id))
}

/** Tải ảnh thumbnail lớn nhất có sẵn */
export async function fetchThumbnail(id: string): Promise<ArrayBuffer | null> {
  for (const name of ['maxresdefault', 'hqdefault']) {
    const res = await fetch(`https://i.ytimg.com/vi/${id}/${name}.jpg`)
    if (res.ok) return res.arrayBuffer()
  }
  return null
}
