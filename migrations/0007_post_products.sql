-- Sản phẩm gợi ý cho từng bài viết (chọn trong form sửa bài).
-- Cuối bài hiện các sản phẩm này trước (theo position), thiếu thì lấy thêm sản phẩm cùng danh mục.
CREATE TABLE post_products (
  post_id    INTEGER NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, product_id)
);
CREATE INDEX idx_post_products_product ON post_products (product_id);
