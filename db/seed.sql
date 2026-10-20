-- Dữ liệu mẫu cho môi trường local: npm run db:seed:local
INSERT INTO products (slug, name, summary, price, sort_order, buy_url, category) VALUES
('san-pham-mau', 'Sản phẩm mẫu', 'Sản phẩm mẫu: thay bằng mô tả thật.', 250000, 1, 'https://example.com/', 'chung'),
('san-pham-lien-he', 'Sản phẩm giá liên hệ', 'Sản phẩm mẫu: giá liên hệ.', NULL, 2, NULL, 'chung');
