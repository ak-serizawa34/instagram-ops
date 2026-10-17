-- ベンチマークの数字（フォロワー数など）を、いつ時点かと一緒に記録する。履歴として積み上げる
create table public.benchmark_stats (
  id uuid primary key default gen_random_uuid(),
  benchmark_id uuid not null references public.benchmarks (id) on delete cascade,
  account_id text not null references public.accounts (id),
  followers int,
  following int,
  posts int,
  captured_at timestamptz not null,  -- いつ時点の数字か
  source text,                       -- どこで取ったか（Instagramのページ、資料名など）
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index on public.benchmark_stats (benchmark_id, captured_at desc);

alter table public.benchmark_stats enable row level security;
create policy "メンバーは見られる" on public.benchmark_stats
  for select to authenticated using (public.is_member(account_id));
-- 書き込みはコネクタ（record_benchmark_stats）から

-- 一覧ですぐ見られるよう、最新の数字をベンチマークにも持たせる
alter table public.benchmarks
  add column followers int,
  add column posts_count int,
  add column stats_at timestamptz;
