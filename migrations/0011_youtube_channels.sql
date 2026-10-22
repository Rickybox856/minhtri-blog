-- Kênh YouTube được kết nối bằng Google OAuth để quản lý, sửa SEO và tải video lên.
-- Mã truy cập luôn được mã hoá AES-GCM (khoá trong secret TOKEN_ENC_KEY của Worker), không lưu dạng thô.
CREATE TABLE youtube_channels (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id         TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  thumbnail          TEXT NOT NULL DEFAULT '',
  refresh_token_enc  TEXT NOT NULL,
  access_token_enc   TEXT,
  access_expires_at  INTEGER NOT NULL DEFAULT 0, -- mili giây
  status             TEXT NOT NULL DEFAULT 'ok',  -- ok | expired (cần kết nối lại)
  desc_footer        TEXT NOT NULL DEFAULT '',    -- đoạn cuối mô tả mặc định (link, lời chào…)
  default_tags       TEXT NOT NULL DEFAULT '',    -- tag mặc định, cách nhau bởi dấu phẩy
  connected_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Nhật ký video tải lên từ trang quản trị
CREATE TABLE youtube_uploads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  TEXT NOT NULL,
  video_id    TEXT NOT NULL,
  title       TEXT NOT NULL,
  privacy     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
