-- Theo dõi kênh YouTube: mỗi video đã thấy được ghi lại để không đăng trùng.
-- status: processing (đang tạo bài) | posted | skipped (tiêu đề chỉ là ngày tháng) | baseline (có sẵn trước khi bật) | error
CREATE TABLE youtube_videos (
  video_id   TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL,
  post_slug  TEXT,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_youtube_videos_created ON youtube_videos (created_at DESC);

-- 10 video đã có bài viết tay (2026-10-22)
INSERT OR IGNORE INTO youtube_videos (video_id, title, status, post_slug) VALUES
  ('LoBU6wgrvB4', 'なぜ相続は揉めるのか？土地共有の危険性と執着を生む心理構造！加藤諦三＆中川潤', 'posted', 'video-souzoku-wa-naze-momeru'),
  ('KdIczzKXajg', '「単なる泥棒と決めつけるな」専門家が喝！13歳男子の行動に隠されたSOS！', 'posted', 'video-13sai-musuko-no-sos'),
  ('F5S-VRHqT8U', '他人を頼らず超楽観的に生き抜いた83歳女性！不安を無力化する驚異の人生観！', 'posted', 'video-83sai-chou-rakkan'),
  ('Rte8O6SDCzQ', '「良い母親をやめ『自己中』に生きろ」専門家が喝！64歳からの子離れと老後開拓！', 'posted', 'video-yoi-hahaoya-wo-yameru'),
  ('VQ4e1RZ6TVU', '「行動すれば心も変わる」加藤諦三が突く“思考を強化する習慣”', 'posted', 'video-koudou-sureba-kokoro-mo-kawaru'),
  ('o8TRNyYDSBg', 'なぜあなたは夫の顔色ばかりうかがうのか？無理な変化が招く夫婦崩壊の心理構造！加藤諦三＆大原敬子', 'posted', 'video-otto-no-kaoiro'),
  ('aSoEfCAjqSo', '「愛」ではなく「真面目さ」で維持した結婚。熟年期に襲う虚無感と冷え切った夫婦の闇！', 'posted', 'video-majimesa-de-iji-shita-kekkon'),
  ('Vt8nRRSZcxs', '釣り場で出会った男に金を騙し取られた。善意をを踏みにじられた怒りと決別！今井通子・大迫恵美子', 'posted', 'video-tsuriba-de-damasareta'),
  ('1hArHWXOSdU', '他人に依存し勝手に傷つく愚かさ。自己確立と現実的な立場整理の決断！加藤諦三・大迫恵美子', 'posted', 'video-tanin-ni-izon-shite-kizutsuku'),
  ('dPPLUvHPCDM', '「その生き方では孤独になる」マドモアゼル・愛が55歳男性に迫る', 'posted', 'video-sono-ikikata-dewa-kodoku-ni-naru');
