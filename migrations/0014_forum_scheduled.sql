-- Bài diễn đàn viết sẵn, chờ tự đăng (cron mỗi giờ) dưới tên 相談広場スタッフ
CREATE TABLE forum_scheduled (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  board_slug  TEXT NOT NULL,
  title       TEXT NOT NULL UNIQUE,
  body        TEXT NOT NULL,
  publish_at  TEXT NOT NULL,              -- UTC, dạng YYYY-MM-DD HH:MM:SS
  thread_id   INTEGER,                    -- có giá trị khi đã đăng (0 = đang đăng)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_forum_scheduled_due ON forum_scheduled (thread_id, publish_at);
