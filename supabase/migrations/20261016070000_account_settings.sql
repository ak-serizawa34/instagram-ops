-- アカウントごとの設定（いまは Manus のプロジェクトURL）。アプリの上部のボタンから飛ぶために使う

create table public.account_settings (
  account_id text primary key references public.accounts (id) on delete cascade,
  manus_url text,
  updated_by uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.account_settings enable row level security;

create policy "メンバーは見られる" on public.account_settings
  for select to authenticated using (public.is_member(account_id));
create policy "メンバーは作れる" on public.account_settings
  for insert to authenticated with check (public.is_member(account_id));
create policy "メンバーは直せる" on public.account_settings
  for update to authenticated using (public.is_member(account_id)) with check (public.is_member(account_id));
