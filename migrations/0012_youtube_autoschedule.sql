-- Tự động đặt lịch đăng cho video nháp (riêng tư, chưa có lịch) của kênh đã liên kết.
-- Cron mỗi giờ: tìm video nháp → xếp vào khung giờ trống tiếp theo theo cài đặt.
CREATE TABLE youtube_autoschedule (
  channel_id     INTEGER PRIMARY KEY,                 -- youtube_channels.id
  enabled        INTEGER NOT NULL DEFAULT 0,
  tz_offset      INTEGER NOT NULL DEFAULT 540,        -- phút lệch so với UTC (540 = giờ Nhật)
  times          TEXT NOT NULL DEFAULT '20:00',       -- khung giờ trong ngày, cách nhau bởi dấu phẩy
  weekdays       TEXT NOT NULL DEFAULT '0123456',     -- 0 = Chủ nhật … 6 = Thứ bảy
  order_by       TEXT NOT NULL DEFAULT 'oldest',      -- oldest | newest
  min_age_min    INTEGER NOT NULL DEFAULT 60,         -- chỉ xếp video đã tải lên ít nhất N phút (để kịp sửa tiêu đề/mô tả)
  lead_hours     INTEGER NOT NULL DEFAULT 2,          -- khung giờ sớm nhất cách hiện tại ít nhất N giờ
  max_per_run    INTEGER NOT NULL DEFAULT 5,          -- số video tối đa mỗi lần chạy
  skip_marker    TEXT NOT NULL DEFAULT '[giữ]',       -- tiêu đề chứa chữ này thì bỏ qua
  last_run       TEXT,                                -- JSON tóm tắt lần chạy gần nhất
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Nhật ký: video đã được tự động đặt lịch (ok = 1) hoặc bị YouTube từ chối (ok = 0, không thử lại)
CREATE TABLE youtube_autoschedule_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  INTEGER NOT NULL,
  video_id    TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  publish_at  TEXT,
  ok          INTEGER NOT NULL,
  error       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_yt_autolog_channel ON youtube_autoschedule_log (channel_id, created_at);
CREATE INDEX idx_yt_autolog_video ON youtube_autoschedule_log (video_id, ok);
