-- HTML của bài viết được render sẵn lúc đăng (scripts/publish-post.mjs),
-- để mỗi lượt xem không phải parse Markdown (giới hạn CPU gói Workers miễn phí)
ALTER TABLE posts ADD COLUMN content_html TEXT;
