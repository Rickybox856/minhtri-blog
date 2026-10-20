-- Bài viết blog (nội dung Markdown)
CREATE TABLE posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  excerpt      TEXT NOT NULL DEFAULT '',
  content_md   TEXT NOT NULL,
  cover_key    TEXT,                 -- key ảnh trong R2
  published    INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_posts_published ON posts (published, published_at DESC);

-- Sản phẩm giới thiệu
CREATE TABLE products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  description_md TEXT NOT NULL DEFAULT '',
  price       INTEGER,               -- VND, NULL = liên hệ
  image_key   TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

-- Liên hệ / đặt hàng từ form
CREATE TABLE contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
