-- Quản trị nội dung: chuyên mục bài viết, danh mục sản phẩm, trang tĩnh.
-- posts.category và products.category lưu slug của chuyên mục/danh mục tương ứng.

CREATE TABLE post_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO post_categories (slug, name, description, sort_order) VALUES
('ghi-chep', 'Ghi chép', 'Những ghi chép, suy nghĩ và câu chuyện thường ngày.', 1),
('chia-se', 'Chia sẻ', 'Kinh nghiệm, hướng dẫn và mẹo hay.', 2);

CREATE TABLE product_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO product_categories (slug, name, sort_order) VALUES
('chung', 'Sản phẩm', 1);

-- Trang tĩnh: /<slug>. content_html được render khi lưu từ trang quản trị
-- (hoặc lần xem đầu tiên nếu còn trống).
CREATE TABLE pages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  content_md     TEXT NOT NULL DEFAULT '',
  content_html   TEXT,
  published      INTEGER NOT NULL DEFAULT 1,
  show_in_menu   INTEGER NOT NULL DEFAULT 0,
  show_in_footer INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO pages (slug, title, description, show_in_menu, show_in_footer, sort_order, content_md) VALUES
('gioi-thieu', 'Giới thiệu', 'Giới thiệu về blog và tác giả.', 1, 0, 1,
'Chào bạn! Đây là trang giới thiệu. Hãy sửa nội dung này trong **Quản trị → Trang**.

Gợi ý: kể vài dòng về blog nói về chủ đề gì, viết cho ai, và vì sao bạn bắt đầu viết.

<h2 id="tac-gia">Tác giả</h2>

Giới thiệu ngắn về bạn: tên, nghề nghiệp, kinh nghiệm liên quan tới chủ đề của blog. Google đánh giá cao các trang có thông tin tác giả rõ ràng.

## Liên hệ

Xem trang [Liên hệ](/lien-he).'),
('mien-tru-trach-nhiem', 'Miễn trừ trách nhiệm', 'Miễn trừ trách nhiệm và công khai liên kết tiếp thị.', 0, 1, 2,
'## Thông tin tham khảo

Nội dung trên blog chỉ nhằm mục đích cung cấp thông tin tham khảo. Hãy cân nhắc và hỏi ý kiến chuyên gia khi cần.

## Liên kết tiếp thị

Một số liên kết trên trang có thể là liên kết tiếp thị: khi bạn mua qua liên kết này, chúng tôi có thể nhận hoa hồng mà giá bạn trả không thay đổi.');

-- Bài chào mừng: hướng dẫn nhanh, xoá đi khi đã có bài thật
INSERT INTO posts (slug, title, excerpt, category, published, published_at, content_md) VALUES
('chao-mung', 'Chào mừng đến với blog của bạn',
 'Blog đã chạy! Đây là bài viết mẫu kèm hướng dẫn nhanh để bắt đầu.',
 'ghi-chep', 1, datetime('now'),
'Chúc mừng, blog của bạn đã chạy trên Cloudflare, **miễn phí**!

## Bắt đầu trong 3 bước

1. Vào **/quan-tri**, nhập *mã cài đặt* (SETUP_TOKEN) bạn đã điền lúc deploy và đặt mật khẩu quản trị.
2. Vào **Cài đặt site**: đổi tên blog, favicon, câu giới thiệu trang chủ, thông tin liên hệ.
3. Vào **Bài viết → Viết bài mới**. Nội dung viết bằng Markdown: `## Tiêu đề`, `**chữ đậm**`, `[chữ](link)`; nút bên dưới ô nội dung giúp chèn ảnh.

## Có gì sẵn

- Chuyên mục bài viết: mỗi chuyên mục có bài đăng sẽ tự lên menu và trang chủ.
- Trang tĩnh (Giới thiệu, Miễn trừ trách nhiệm…), form liên hệ, thư viện ảnh.
- Mục Sản phẩm cho ai làm affiliate (bật trong Cài đặt site).
- Sitemap, dữ liệu cấu trúc cho Google, cache trang để chạy nhanh và tiết kiệm hạn mức miễn phí.

Khi đã có bài thật, hãy xoá bài này trong **Quản trị → Bài viết**.');
