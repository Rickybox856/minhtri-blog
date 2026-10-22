-- Diễn đàn みんなの相談広場: thành viên đăng chủ đề và trả lời; ai cũng đọc được.
-- Bài hiện ngay; người đọc bấm 通報 (báo cáo), đủ số lần thì tự ẩn chờ quản trị xem.

-- Biệt danh hiển thị trên diễn đàn (email không bao giờ hiện)
ALTER TABLE members ADD COLUMN nickname TEXT;
CREATE UNIQUE INDEX idx_members_nickname ON members (nickname COLLATE NOCASE) WHERE nickname IS NOT NULL;

CREATE TABLE forum_boards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- status: visible | hidden (bị ẩn: do báo cáo hoặc quản trị) | deleted (người viết hoặc quản trị xoá)
CREATE TABLE forum_threads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id     INTEGER NOT NULL REFERENCES forum_boards (id),
  member_id    INTEGER REFERENCES members (id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  anonymous    INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'visible',
  report_count INTEGER NOT NULL DEFAULT 0,
  reply_count  INTEGER NOT NULL DEFAULT 0,
  last_post_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_forum_threads_board ON forum_threads (board_id, status, last_post_at DESC);
CREATE INDEX idx_forum_threads_recent ON forum_threads (status, last_post_at DESC);

CREATE TABLE forum_replies (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id    INTEGER NOT NULL REFERENCES forum_threads (id) ON DELETE CASCADE,
  member_id    INTEGER REFERENCES members (id) ON DELETE SET NULL,
  body         TEXT NOT NULL,
  anonymous    INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'visible',
  report_count INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_forum_replies_thread ON forum_replies (thread_id, id);

-- Mỗi thành viên chỉ báo cáo một bài một lần
CREATE TABLE forum_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL, -- thread | reply
  target_id   INTEGER NOT NULL,
  member_id   INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  reason      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (target_type, target_id, member_id)
);

INSERT INTO forum_boards (slug, name, description, sort_order) VALUES
  ('fuufu-renai', '夫婦・恋愛', '夫婦関係、恋愛、結婚・離婚の悩み', 1),
  ('oyako-kazoku', '親子・家族', '子育て、親との関係、きょうだい・親族の悩み', 2),
  ('shigoto-ningen-kankei', '仕事・人間関係', '職場、友人、ご近所づきあいの悩み', 3),
  ('kokoro', '心の悩み', '不安、孤独、自分との向き合い方', 4),
  ('rougo-kaigo-souzoku', '老後・介護・相続', '介護、相続、これからの暮らし', 5),
  ('bangumi-kansou', '番組の感想・雑談', 'テレフォン人生相談の感想や、心に残った言葉', 6);
