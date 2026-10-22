-- Thành viên (khách tự đăng ký, miễn phí) để nghe âm thanh / xem video trong bài.
-- Mật khẩu băm PBKDF2 giống mật khẩu quản trị (lib/auth.ts).
CREATE TABLE members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- Phiên đăng nhập: cookie giữ mã ngẫu nhiên, DB chỉ lưu SHA-256 của mã đó
CREATE TABLE member_sessions (
  token_hash TEXT PRIMARY KEY,
  member_id  INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_member_sessions_member ON member_sessions (member_id);
