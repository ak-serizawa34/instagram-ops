-- 投稿の記録の出どころに Claude Code を足す（同じコネクタを Manus と Claude Code の両方から使うため）
alter table public.posts drop constraint posts_source_check;
alter table public.posts add constraint posts_source_check check (source in ('app', 'manus', 'claude-code'));
