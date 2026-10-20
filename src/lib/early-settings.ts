import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../types'
import { setMediaBase } from './format'

// Cài đặt cần có trước mọi route (chuyển hướng tên miền, khoá cache, link ảnh), đọc bằng MỘT truy vấn mỗi request.
// Tên miền chính / tên miền ảnh: biến môi trường (wrangler.jsonc) nếu có, không thì lấy trong Quản trị → Cài đặt site.
export type EarlySettings = {
  cacheVersion: string
  /** Địa chỉ gốc đã chuẩn hoá, vd. "https://tenmien.com"; trống = theo địa chỉ đang truy cập */
  siteUrl: string
  mediaBase: string
}

/** Đọc biến môi trường không bắt buộc (repo mẫu không khai báo các biến này trong wrangler.jsonc) */
export const optionalEnv = (env: object, name: string) => {
  const value = (env as Record<string, unknown>)[name]
  return typeof value === 'string' ? value.trim() : ''
}

const trimSlash = (url: string) => url.replace(/\/+$/, '')

export const loadEarlySettings: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { results } = await c.env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('cache_version', 'site.site_url', 'site.media_base')"
  ).all<{ key: string; value: string }>()
  const saved = Object.fromEntries(results.map((r) => [r.key, r.value]))
  const early: EarlySettings = {
    cacheVersion: saved.cache_version ?? '0',
    siteUrl: trimSlash(optionalEnv(c.env, 'SITE_URL') || saved['site.site_url'] || ''),
    mediaBase: trimSlash(optionalEnv(c.env, 'MEDIA_BASE') || saved['site.media_base'] || ''),
  }
  c.set('early', early)
  setMediaBase(early.mediaBase)
  await next()
}
