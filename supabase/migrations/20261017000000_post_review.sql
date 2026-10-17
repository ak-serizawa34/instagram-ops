-- 投稿の確認（アプリの中で、AIが出した「決めること」に人が答える）
--
-- 流れ：AI（Manus／Claude Code）が案・決めること・画像を入れる（review_state = asking）
--   → 人がアプリで選んで「答えを送る」（answered）→ 見張り役がAIを起こす（working）
--   → AIが答えを読んで案を直し、次の決めることを入れる（asking に戻る。revised_at に時刻）
-- 画面に出すのは最新の案だけ。答えで決まったことは decided に積む

alter table public.posts
  add column questions jsonb not null default '[]',  -- 決めること [{id, title, why, kind: single|multi|text, options: [{key, label, detail}]}]
  add column decided jsonb not null default '[]',    -- 決まったこと（文の配列）
  add column answers jsonb not null default '{}',    -- 人の答え {質問のid: 選んだkey | [key...] | 書いた文}
  add column answer_note text,                       -- 選択肢にないことのメモ
  add column review_state text check (review_state in ('asking', 'answered', 'working')),
  add column answered_at timestamptz,
  add column revised_at timestamptz;                 -- AIが直した時刻

-- 写真（photos 列）の置き場：media バケットの <アカウントID>/posts/<投稿ID>/… 。読み書きの決まりは既存の media のものを使う
