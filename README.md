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
