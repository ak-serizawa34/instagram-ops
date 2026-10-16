-- ベンチマークの二重登録を、データベースの段階で止める。
-- 同じアカウントの中で、ハンドル（@と大文字小文字を除いた本体）が同じものは1件だけ
create unique index benchmarks_account_handle_unique
  on public.benchmarks (account_id, lower(regexp_replace(handle, '^@', '')))
  where handle is not null and handle <> '';
