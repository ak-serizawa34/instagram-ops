-- Manus連携：Manusで作った・公開した投稿を記録する欄

alter table public.posts
  add column source text not null default 'app' check (source in ('app', 'manus')), -- どこで作ったか
  add column permalink text,  -- 公開した投稿のURL
  add column notes text;      -- メモ（反応、気づきなど）
