-- 管理用の書き込み（アイコンの登録など、ログインした人がいない更新）は
-- 「更新した人・日時」に記録しない

create or replace function public.stamp_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if auth.uid() is null then
    new.updated_by := old.updated_by;
    new.updated_at := old.updated_at;
  else
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- アイコン登録のときに付いてしまった「更新 不明」を消す
alter table public.benchmarks disable trigger benchmarks_stamp_update;
update public.benchmarks set updated_by = null, updated_at = null where updated_by is null;
alter table public.benchmarks enable trigger benchmarks_stamp_update;
