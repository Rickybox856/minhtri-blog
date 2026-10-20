-- Chuyên mục và tác giả cho bài viết
ALTER TABLE posts ADD COLUMN category TEXT NOT NULL DEFAULT 'ghi-chep';
ALTER TABLE posts ADD COLUMN author TEXT;
CREATE INDEX idx_posts_category ON posts (category, published, published_at DESC);

-- Sản phẩm: link mua (affiliate), ảnh ngoài, chuyên mục, lượt bấm
ALTER TABLE products ADD COLUMN buy_url TEXT;
ALTER TABLE products ADD COLUMN image_url TEXT;
ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT 'ghi-chep';
ALTER TABLE products ADD COLUMN clicks INTEGER NOT NULL DEFAULT 0;
