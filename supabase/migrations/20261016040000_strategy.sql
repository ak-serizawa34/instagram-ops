-- 戦略タブ：アカウントの設計（世界観・概要欄・戦略・フォーマット）を版ごとに積み上げる
-- 書き換えはせず、保存のたびに新しい版を1行足す。最新の版＝いちばん新しい行

create table public.account_doc_versions (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references public.accounts (id),
  section text not null,          -- 'worldview' | 'profile' | 'strategy' | 'format:<名前>'
  title text not null,            -- 画面に出す見出し（フォーマット名など）
  body text not null default '',  -- 中身（見出し・箇条書きを使った文章）
  meta jsonb not null default '{}', -- フォーマットの形など { "format": "carousel", "pages": 3 }
  deleted boolean not null default false, -- フォーマットを消したときの版
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index on public.account_doc_versions (account_id, section, created_at desc);

alter table public.account_doc_versions enable row level security;

create policy "メンバーは見られる" on public.account_doc_versions
  for select to authenticated using (public.is_member(account_id));
create policy "メンバーは版を足せる" on public.account_doc_versions
  for insert to authenticated with check (public.is_member(account_id) and created_by = auth.uid());
-- 版は書き換え・削除しない（履歴として残す）

-- 各項目の最新の版だけを返すビュー（呼び出した人の権限で動く）
create view public.account_docs with (security_invoker = true) as
  select distinct on (account_id, section) *
  from public.account_doc_versions
  order by account_id, section, created_at desc;

-- 投稿がどのフォーマットで作られたか
alter table public.posts add column format_section text;
