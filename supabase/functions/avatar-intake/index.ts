// アイコンの取り込み口：Instagramのプロフィール画像のURLを受け取り、avatars バケットに保存して、
// ベンチマーク（と自分たちのアカウント）のアイコンに設定する
//
// 使い方（Claude Code が Chrome で行う）：
//   Instagramのプロフィールを開き、表示中のプロフィール画像のURLを src に入れて、このURLへ移動する
//   GET /functions/v1/avatar-intake?key=<MCP_TOKEN_CLAUDE>&account=<ashitaka|hotorino|chaochao>&handle=<ハンドル>&src=<画像URL>
//   ※ InstagramのページからはSupabaseへの送信が止められるため、ページの移動（GET）で渡している
//
// 必要な秘密設定：MCP_TOKEN_CLAUDE（Claude Code用の合言葉と共通）

import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TOKEN = Deno.env.get("MCP_TOKEN_CLAUDE") ?? "";
const IMAGE_HOSTS = [/\.cdninstagram\.com$/, /\.fbcdn\.net$/];

function page(message: string, ok: boolean, status = 200) {
  const html = `<!doctype html><meta charset="utf-8"><title>アイコンの取り込み</title>
<body style="font-family:sans-serif;padding:40px;color:${ok ? "#1c1b19" : "#a23b2a"}"><p id="result">${message}</p></body>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function same(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const norm = (s: string) => (s ?? "").trim().replace(/^@/, "").toLowerCase();

Deno.serve(async (req) => {
  const q = new URL(req.url).searchParams;
  if (!same(q.get("key") ?? "", TOKEN)) return page("合言葉が違います", false, 401);

  const account = q.get("account") ?? "";
  const handle = norm(q.get("handle") ?? "");
  const src = q.get("src") ?? "";
  if (!account || !handle || !src) return page("account・handle・src が必要です", false, 400);

  let url: URL;
  try { url = new URL(src); } catch { return page("src が正しいURLではありません", false, 400); }
  if (url.protocol !== "https:" || !IMAGE_HOSTS.some((h) => h.test(url.hostname))) {
    return page(`Instagramの画像URLだけ受け付けます（${url.hostname}）`, false, 400);
  }

  const res = await fetch(url);
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) return page(`画像を取得できませんでした（${res.status}）`, false, 502);

  // 同じ名前で上書きすると配信のキャッシュに古い画像が残るので、日時つきの名前にする
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 12);
  const path = `ig/${handle}_${stamp}.jpg`;
  const { error: upErr } = await db.storage.from("avatars")
    .upload(path, await res.arrayBuffer(), { contentType: type, cacheControl: "3600" });
  if (upErr) return page(`保存できませんでした：${upErr.message}`, false, 500);

  // そのアカウントのベンチマークで、ハンドルが一致するものに設定
  const { data: rows } = await db.from("benchmarks").select("id, handle, avatar_path").eq("account_id", account);
  const hits = (rows ?? []).filter((b) => norm(b.handle ?? "") === handle);
  const old: string[] = [];
  for (const b of hits) {
    if (b.avatar_path) old.push(b.avatar_path);
    await db.from("benchmarks").update({ avatar_path: path }).eq("id", b.id);
  }
  // 自分たちのアカウントのハンドルなら、そちらにも設定
  const { data: own } = await db.from("accounts").select("id, avatar_path").eq("handle", handle);
  for (const a of own ?? []) {
    if (a.avatar_path) old.push(a.avatar_path);
    await db.from("accounts").update({ avatar_path: path }).eq("id", a.id);
  }
  if (!hits.length && !own?.length) {
    await db.storage.from("avatars").remove([path]);
    return page(`@${handle} は ${account} のベンチマークにも、自分たちのアカウントにもありません。先に登録してください`, false, 404);
  }
  // 前のアイコン画像は消す（ほかで使っていないもの）
  const stillUsed = new Set<string>();
  const { data: b2 } = await db.from("benchmarks").select("avatar_path").in("avatar_path", old.length ? old : ["-"]);
  const { data: a2 } = await db.from("accounts").select("avatar_path").in("avatar_path", old.length ? old : ["-"]);
  for (const r of [...(b2 ?? []), ...(a2 ?? [])]) stillUsed.add(r.avatar_path);
  const remove = old.filter((o) => !stillUsed.has(o));
  if (remove.length) await db.storage.from("avatars").remove(remove);

  return page(`OK：@${handle} のアイコンを保存しました（${hits.length + (own?.length ?? 0)}件に設定）`, true);
});
