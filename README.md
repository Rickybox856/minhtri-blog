# MinhTri Blog Cloudflare

Blog tiếng Việt chạy **miễn phí** trên Cloudflare Workers: không cần thuê hosting, chỉ cần (nếu muốn) mua tên miền.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/nhakhtn/minhtri-blog-cloudflare)

Site thật đang chạy bằng mã nguồn này: [matongduoclieu.com](https://matongduoclieu.com).

## Có gì

- **Trang quản trị** `/quan-tri`: bài viết (Markdown), chuyên mục, trang tĩnh, sản phẩm, thư viện ảnh, lời nhắn liên hệ, cài đặt site.
- **Cài đặt site** ngay trên web: tên blog, favicon, trang chủ, footer, copyright, thông tin liên hệ và tác giả.
- **Menu tự động** theo chuyên mục có bài; bật/tắt mục **Sản phẩm** cho ai làm affiliate (Shopee, Tiki, Lazada…).
- **Tải ảnh**: ảnh được thu nhỏ và chuyển sang WebP ngay trên trình duyệt trước khi lưu vào R2.
- **SEO**: sitemap, robots.txt, canonical, Open Graph, dữ liệu cấu trúc (Article, Breadcrumb, Organization).
- **Nhanh và tiết kiệm**: trang được cache tại Cloudflare, sửa bài là khách thấy ngay.

Công nghệ: [Hono](https://hono.dev) + JSX, Cloudflare Workers, D1 (SQLite), R2 (ảnh), KV.

## Cài đặt bằng một nút bấm

Cần: tài khoản [Cloudflare](https://dash.cloudflare.com/sign-up) (miễn phí) và tài khoản [GitHub](https://github.com/signup).

1. Bấm nút **Deploy to Cloudflare** ở trên, đăng nhập Cloudflare và kết nối GitHub.
2. Đặt tên cho dự án (vd. `blog-cua-toi`). Cloudflare tự tạo cơ sở dữ liệu D1, kho ảnh R2, KV và một repo GitHub mới là bản sao của mã nguồn này.
3. Ở ô **SETUP_TOKEN**, điền một **mã cài đặt** khó đoán (vd. `blog-2026-mat-ma-rieng`) và **ghi nhớ lại**. Ô **SITE_NAME** là tên blog, đổi được sau.
4. Bấm **Deploy** và chờ 1–2 phút.
5. Mở địa chỉ `https://<tên-dự-án>.<tài-khoản>.workers.dev/quan-tri`, nhập mã cài đặt và đặt mật khẩu quản trị.
6. Vào **Cài đặt site** để đổi tên blog, thông tin liên hệ… rồi bắt đầu viết bài.

Sau này bạn sửa code trong repo GitHub của mình, Cloudflare sẽ tự build và cập nhật site.

## Gắn tên miền riêng (không bắt buộc)

Tên miền cần được quản lý DNS trên Cloudflare (thêm tên miền vào Cloudflare và đổi nameserver theo hướng dẫn của Cloudflare).

1. Cloudflare dashboard → **Workers & Pages** → chọn Worker của bạn → **Settings** → **Domains & Routes** → **Add** → **Custom domain** → nhập `tenmien.com`.
2. Vào `/quan-tri` → **Cài đặt site** → **Tên miền & Google**, điền `https://tenmien.com` vào ô **Tên miền chính** rồi lưu. Từ đây link trong sitemap, chia sẻ Facebook… dùng tên miền này, và `www.tenmien.com` (nếu có gắn) tự chuyển về tên miền chính.

## Tên miền cho ảnh: tiết kiệm hạn mức miễn phí (khuyên dùng khi có tên miền)

Gói miễn phí cho 100.000 request Worker mỗi ngày. Mặc định mỗi ảnh cũng đi qua Worker, nên bài có nhiều ảnh sẽ tốn nhiều request. Gắn tên miền riêng cho kho ảnh để ảnh đi thẳng qua CDN của Cloudflare (miễn phí, không giới hạn):

1. Cloudflare dashboard → **R2** → bucket ảnh của bạn → **Settings** → **Custom Domains** → **Connect Domain** → nhập `anh.tenmien.com`.
2. Vào **Cài đặt site** → **Tên miền & Google**, điền `https://anh.tenmien.com` vào ô **Tên miền ảnh** rồi lưu.

## Hạn mức miễn phí

| Dịch vụ | Miễn phí |
|---|---|
| Workers | 100.000 request/ngày |
| D1 | 5 triệu dòng đọc/ngày, 5 GB |
| R2 | 10 GB lưu trữ, băng thông tải ra miễn phí |

Gói miễn phí **không bao giờ tự trừ tiền**: nếu vượt hạn mức, site tạm báo lỗi cho tới hết ngày (theo giờ UTC) rồi chạy lại.

## Chạy trên máy (cho lập trình viên)

```bash
npm install
npm run db:migrate:local      # tạo bảng trong D1 local
npm run dev                   # http://localhost:8787
```

Tạo file `.dev.vars` từ `.dev.vars.example` (đặt `SETUP_TOKEN`), hoặc đặt mật khẩu trực tiếp: `npm run admin:password -- --local`.

Quên mật khẩu trên site thật: `npm run admin:password` (cần đăng nhập `npx wrangler login`).

## Giấy phép

MIT. Mã nguồn tách ra từ [matongduoclieu.com](https://github.com/nhakhtn/matongduoclieu.com) của Nguyễn Đoàn Đức Nhã.
