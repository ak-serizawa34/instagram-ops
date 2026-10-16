-- アカウントごとの資料のリンク（収録台本・音声データなどのGoogleドライブのフォルダ）
-- [{ "label": "収録台本", "url": "https://drive.google.com/..." }, ...]
alter table public.account_settings add column links jsonb not null default '[]';

insert into public.account_settings (account_id, links, updated_by) values
  ('ashitaka', '[
    {"label": "愛鷹テロワール（フォルダ全体）", "url": "https://drive.google.com/drive/folders/13HXBjfp8LG3h5qxkFfpiyOzlqhoqD4gl"},
    {"label": "収録台本", "url": "https://drive.google.com/drive/folders/1C-Lhp2nmZRkKImnJudKwlgF4-B3CRkW7"},
    {"label": "音声データ（AudioData）", "url": "https://drive.google.com/drive/folders/14yOlc25cxizF_uTuN_HiK06jMph7xQgH"}
  ]', null)
on conflict (account_id) do update set links = excluded.links;
