# Insta Studio（instagram-ops）

Insta Studio（Instagram運用アプリ）。仕組みの説明は [設計書.md](設計書.md) を読んでください。

## 公開の手順

1. Supabaseのプロジェクトを作り、`supabase/migrations/` を反映する
2. `docs/config.js` に、SupabaseのURLとanonキーを入れる
3. Supabaseの Authentication → URL Configuration で、Site URL にGitHub PagesのURLを入れる
4. GitHubのリポジトリの Settings → Pages で、`main` ブランチの `/docs` を公開する

## 人を追加する

1. その人にアプリのURLを開いてもらい、メールのリンクで一度ログインしてもらう
2. SupabaseのSQL Editorで、見られるアカウントを登録する

```sql
insert into memberships (user_id, account_id)
select id, 'ashitaka' from profiles where email = 'その人のメールアドレス';
```

`'ashitaka'` の部分は `'hotorino'` `'chaochao'` に変えられます。

ASAさんの場合は、あわせてManusでの書き込みを本人の作業として残すため、ASAさんの profiles.id を秘密設定 `MCP_USER_ID_ASA` に入れ、コネクタを反映し直します（設計書 9章）。

## コネクタ（Manus・Claude Code）と取り込み口を反映する

```
npx supabase functions deploy mcp --project-ref fesasskyvogpmifxhxoa --use-api --no-verify-jwt
npx supabase functions deploy avatar-intake --project-ref fesasskyvogpmifxhxoa --use-api --no-verify-jwt
```

## 画面を直したとき

```
sh pc/bump.sh   # 読み込みに版の印を付ける（ブラウザに古いファイルを使わせない）
git add -A && git commit && git push
```

## 休止対策

`.github/workflows/keepalive.yml` が毎日Supabaseにアクセスします。GitHubの「Actions」タブで動いているか確認できます。手動で動かすときは `gh workflow run keepalive.yml`。
