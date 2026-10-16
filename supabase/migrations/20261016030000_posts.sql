-- 投稿（作る・公開する）

-- アカウントごとの口調や避けたい表現など。AIへの指示に使う（空なら使わない）
alter table public.accounts add column brand_notes text;

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references public.accounts (id),
  title text,                                   -- 一覧で見分けるための題名
  format text not null default 'carousel' check (format in ('carousel', 'story')),
  status text not null default 'draft' check (status in ('draft', 'approved', 'posted')),
  photos jsonb not null default '[]',           -- media バケット内のパスの配列
  slides jsonb not null default '[]',           -- [{template, text, photo, size, align}]
  caption text,
  hashtags text,
  caption_options jsonb not null default '[]',  -- AIが出したキャプション案
  chat jsonb not null default '[]',             -- AIとのやりとり [{role, text, photos?}]
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  posted_at timestamptz
);

create index on public.posts (account_id, status);

create trigger posts_stamp_update
  before update on public.posts
  for each row execute function public.stamp_update();

-- 作業の記録（作成・承認・差し戻し・投稿済み など）
create table public.post_logs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  account_id text not null references public.accounts (id),
  action text not null,
  note text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index on public.post_logs (post_id);

alter table public.posts enable row level security;
alter table public.post_logs enable row level security;

create policy "メンバーは見られる" on public.posts
  for select to authenticated using (public.is_member(account_id));
create policy "メンバーは作れる" on public.posts
  for insert to authenticated with check (public.is_member(account_id) and created_by = auth.uid());
create policy "メンバーは直せる" on public.posts
  for update to authenticated using (public.is_member(account_id)) with check (public.is_member(account_id));
create policy "メンバーは消せる" on public.posts
  for delete to authenticated using (public.is_member(account_id));

create policy "メンバーは見られる" on public.post_logs
  for select to authenticated using (public.is_member(account_id));
create policy "メンバーは記録できる" on public.post_logs
  for insert to authenticated with check (public.is_member(account_id) and created_by = auth.uid());

-- 投稿に使う写真の置き場所（非公開）。パスの先頭がアカウントID：<account_id>/<ファイル名>
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

create policy "メンバーは写真を見られる" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and public.is_member((storage.foldername(name))[1]));
create policy "メンバーは写真を入れられる" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and public.is_member((storage.foldername(name))[1]));
create policy "メンバーは写真を消せる" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and public.is_member((storage.foldername(name))[1]));
