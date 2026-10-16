-- アイコン画像とInstagramへのリンク

-- 自分たちのアカウントのハンドル（@なし）とアイコン
alter table public.accounts
  add column handle text,
  add column avatar_path text;

update public.accounts set handle = 'ashitaka_terroir' where id = 'ashitaka';
update public.accounts set handle = 'hotorino_' where id = 'hotorino';
update public.accounts set handle = 'chaochao_tea' where id = 'chaochao';

-- ベンチマークのアイコン（Storageの avatars バケット内のパス）
alter table public.benchmarks
  add column avatar_path text;

-- アイコン画像の置き場所。誰でも読めるが、書き込みはservice_role（管理用の鍵）だけ
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;
