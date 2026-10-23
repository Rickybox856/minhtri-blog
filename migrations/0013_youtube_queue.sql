-- Hàng chờ đăng bài video: video mới → status 'queued' + giờ đăng dự kiến (UTC), cách nhau 2 tiếng
ALTER TABLE youtube_videos ADD COLUMN scheduled_at TEXT;
CREATE INDEX idx_youtube_videos_queue ON youtube_videos (status, scheduled_at);
