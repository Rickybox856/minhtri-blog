-- Bài viết hẹn giờ: published = 0 + scheduled_at (UTC). Cron mỗi giờ tự đăng khi đến giờ (src/lib/post-schedule.ts)
ALTER TABLE posts ADD COLUMN scheduled_at TEXT;
CREATE INDEX idx_posts_scheduled ON posts (scheduled_at) WHERE scheduled_at IS NOT NULL;
