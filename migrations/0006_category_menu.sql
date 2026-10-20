-- Cho phép ẩn chuyên mục bài viết khỏi menu và trang chủ
ALTER TABLE post_categories ADD COLUMN show_in_menu INTEGER NOT NULL DEFAULT 1;
