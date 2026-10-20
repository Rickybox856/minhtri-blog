-- Cấu hình dạng key/value: mã băm mật khẩu quản trị, khoá ký phiên đăng nhập
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
