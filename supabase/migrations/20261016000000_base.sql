-- 土台：アカウント・メンバー・作業者・ベンチマーク

-- Instagramのアカウント（愛鷹テロワール・hotorino・chaochao）
create table public.accounts (
  id text primary key,
  label text not null,
  sort int not null default 0
);

insert into public.accounts (id, label, sort) values
  ('ashitaka', '愛鷹テロワール', 1),
  ('hotorino', 'hotorino', 2),
  ('chaochao', 'chaochao', 3);

-- ログインした人（作業者の記録に使う）
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 誰がどのアカウントを見られるか
create table public.memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id text not null references public.accounts (id) on delete cascade,
  primary key (user_id, account_id)
);

create function public.is_member(acc text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships
    where user_id = auth.uid() and account_id = acc
  );
$$;

-- ベンチマーク
create table public.benchmarks (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references public.accounts (id),
  priority text check (priority in ('A', 'B')),
  name text not null,
  handle text,
  url text,
  area text,
  feature text,
  adopt text,
  caution text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz
);

create index on public.benchmarks (account_id);

-- 更新した人と日時を自動で記録
create function public.stamp_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger benchmarks_stamp_update
  before update on public.benchmarks
  for each row execute function public.stamp_update();

-- 見られる範囲：メンバーになっているアカウントだけ
alter table public.accounts enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.benchmarks enable row level security;

create policy "メンバーのアカウントだけ見える" on public.accounts
  for select to authenticated using (public.is_member(id));

create policy "自分のメンバー情報だけ見える" on public.memberships
  for select to authenticated using (user_id = auth.uid());

create policy "ログインした人は作業者の一覧を見られる" on public.profiles
  for select to authenticated using (true);

create policy "メンバーは見られる" on public.benchmarks
  for select to authenticated using (public.is_member(account_id));
create policy "メンバーは追加できる" on public.benchmarks
  for insert to authenticated with check (public.is_member(account_id) and created_by = auth.uid());
create policy "メンバーは編集できる" on public.benchmarks
  for update to authenticated using (public.is_member(account_id)) with check (public.is_member(account_id));
create policy "メンバーは削除できる" on public.benchmarks
  for delete to authenticated using (public.is_member(account_id));
