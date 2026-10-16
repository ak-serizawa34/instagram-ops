-- 管理用の書き込み（コネクタなど、ログインした人がいない更新）でも、
-- 更新した人・日時をはっきり指定したときは、それを残す。指定がなければ前の値のまま
create or replace function public.stamp_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if auth.uid() is null then
    if new.updated_at is not distinct from old.updated_at then
      new.updated_by := old.updated_by;
    end if;
  else
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end;
$$;
