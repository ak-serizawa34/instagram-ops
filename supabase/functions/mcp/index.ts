// Manus用のコネクタ（MCPサーバー）。Manusのチャットから、Insta Studioの設計を読み書きする
//
// つなぎ方：Manus の Connectors → Add MCP by URL に
//   https://fesasskyvogpmifxhxoa.supabase.co/functions/v1/mcp?key=<MCP_TOKEN>
// を登録する。key（合言葉）は秘密設定 MCP_TOKEN と照合する。URLはリポジトリや画面に出さない
//
// MCPの「Streamable HTTP」を、POSTでJSONを返す最小の形で実装している
// 必要な秘密設定：MCP_TOKEN（Manus用の合言葉）、MCP_TOKEN_CLAUDE（Claude Code用）、MCP_TOKEN_ASA（ASAさんのManus用・愛鷹テロワールだけ）、MCP_USER_ID_ASA（ASAさんのprofiles.id）、MCP_USER_ID（書き込みを誰の作業として残すか＝芹澤さんのprofiles.id）

import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
// 合言葉はつなぐ先ごとに分ける。どこからの書き込みかを記録に残すため
// accounts：使えるアカウント（null は全部）。user：書き込みを誰の作業として残すか（profiles.id）
const SERIZAWA = Deno.env.get("MCP_USER_ID") ?? null;
const CLIENTS = [
  { token: Deno.env.get("MCP_TOKEN") ?? "", source: "manus", label: "Manus", accounts: null as string[] | null, user: SERIZAWA },
  { token: Deno.env.get("MCP_TOKEN_CLAUDE") ?? "", source: "claude-code", label: "Claude Code", accounts: null as string[] | null, user: SERIZAWA },
  // ASAさん（愛鷹テロワールだけ共有）。MCP_USER_ID_ASA はASAさんがアプリに初めてログインしたあとに設定する
  { token: Deno.env.get("MCP_TOKEN_ASA") ?? "", source: "manus", label: "Manus（ASA）", accounts: ["ashitaka"], user: Deno.env.get("MCP_USER_ID_ASA") ?? null },
].filter((c) => c.token);
type Client = typeof CLIENTS[number];

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
// 本文の見出し（## ）を1段下げて、項目の見出しと重ならないようにする
const demote = (body: string, by: string) => body.trim().replace(/^## /gm, by + " ");

const FORMAT_KIND: Record<string, string> = { carousel: "カルーセル", story: "ストーリーズ", reel: "リール" };

// ---- 道具（tools）の定義 ----

const ACCOUNT = { type: "string", description: "アカウントID：ashitaka（愛鷹テロワール）／hotorino／chaochao" };

const TOOLS = [
  {
    name: "list_accounts",
    description: "Insta Studioで扱うInstagramアカウントの一覧（ID・名前・ハンドル）",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_account_design",
    description: "アカウントの設計（世界観・概要欄・戦略・フォーマット）の最新版を読む。投稿を作る・提案する前に必ず読み、フォーマットとルールに従うこと",
    inputSchema: { type: "object", properties: { account: ACCOUNT }, required: ["account"], additionalProperties: false },
  },
  {
    name: "get_benchmarks",
    description: "参考にするアカウント（ベンチマーク）の一覧。優先A＝毎週確認したい主要なもの、B＝企画に応じて参照する補助的なもの",
    inputSchema: {
      type: "object",
      properties: { account: ACCOUNT, priority: { type: "string", enum: ["A", "B"], description: "絞り込み（省略で全部）" } },
      required: ["account"], additionalProperties: false,
    },
  },
  {
    name: "list_posts",
    description: "これまでに記録した投稿（Manus・Claude Codeで作った・公開したもの）の一覧。新しい投稿を考えるとき、重複を避けるために読む",
    inputSchema: {
      type: "object",
      properties: { account: ACCOUNT, limit: { type: "integer", minimum: 1, maximum: 50, description: "件数（省略で20）" } },
      required: ["account"], additionalProperties: false,
    },
  },
  {
    name: "save_design",
    description: "設計の1項目を、新しい版として保存する（前の版は履歴に残る）。利用者が「決めた」「保存して」とはっきり言ったときだけ使う。body は差分ではなく、その項目の全文を渡す。section：worldview（世界観）／profile（概要欄）／strategy（戦略）／format:<名前>（フォーマット。新しく作るときは format:新しい名前）",
    inputSchema: {
      type: "object",
      properties: {
        account: ACCOUNT,
        section: { type: "string" },
        body: { type: "string", description: "項目の全文。「## 」で見出し、「- 」で箇条書き" },
        title: { type: "string", description: "フォーマットの名前（フォーマットのときだけ）" },
        format: { type: "string", enum: ["carousel", "story", "reel"], description: "フォーマットの形（フォーマットのときだけ）" },
        pages: { type: "integer", minimum: 1, maximum: 10, description: "フォーマットのページ数（フォーマットのときだけ）" },
        canva_url: { type: "string", description: "フォーマットのCanvaテンプレート（デザインのリンク）。フォーマットのときだけ" },
      },
      required: ["account", "section", "body"], additionalProperties: false,
    },
  },
  {
    name: "record_post",
    description: "作った・公開した投稿を記録する。下書きを作ったら status=draft、利用者が確認したら approved、公開したら posted で記録する。同じ投稿の状態が進んだら post_id を付けて更新する",
    inputSchema: {
      type: "object",
      properties: {
        account: ACCOUNT,
        post_id: { type: "string", description: "既に記録した投稿を更新するときのID（record_post の返り値）" },
        title: { type: "string", description: "一覧で見分ける題名" },
        format_name: { type: "string", description: "使ったフォーマットの名前（例：A. エピソード要点カード）" },
        kind: { type: "string", enum: ["carousel", "story", "reel", "post"] },
        status: { type: "string", enum: ["draft", "approved", "posted"] },
        caption: { type: "string" },
        hashtags: { type: "string" },
        permalink: { type: "string", description: "公開した投稿のURL" },
        notes: { type: "string", description: "メモ（ページの中身の要約、反応など）" },
        questions: {
          type: "array", maxItems: 12,
          description: "利用者に決めてもらうこと（アプリの確認画面に出る）。渡すと前の答えは消え、「答え待ち」になる。決めることがなくなったら空の配列を渡す",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "質問の短い識別子（例：q1）" },
              title: { type: "string", description: "何を決めるか（短く）" },
              why: { type: "string", description: "なぜ聞くか・確かめていないこと" },
              kind: { type: "string", enum: ["single", "multi", "text"], description: "single＝1つ選ぶ、multi＝いくつも選ぶ、text＝書いてもらう" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: { key: { type: "string" }, label: { type: "string" }, detail: { type: "string", description: "補足（その案の文面など）" } },
                  required: ["key", "label"], additionalProperties: false,
                },
              },
            },
            required: ["id", "title", "kind"], additionalProperties: false,
          },
        },
        decided: { type: "array", items: { type: "string" }, description: "これまでに決まったこと（全文。渡すと置き換わる）" },
      },
      required: ["account", "status"], additionalProperties: false,
    },
  },
  {
    name: "set_post_images",
    description: "投稿の画像（確認画面で見せる写し）を入れる。前の画像と置き換わる。Manusは Canva で書き出した画像のURL（image_urls）、Claude Code は pc/studio.mjs images で PC の画像ファイルを渡す（AIが画像の中身を読む必要はない）",
    inputSchema: {
      type: "object",
      properties: {
        account: ACCOUNT,
        post_id: { type: "string" },
        image_urls: { type: "array", items: { type: "string" }, maxItems: 10, description: "Canvaで書き出した画像のURL（ページ順）" },
        images: {
          type: "array", maxItems: 10, description: "画像そのもの（ページ順）。pc/studio.mjs が使う",
          items: { type: "object", properties: { type: { type: "string", enum: ["image/jpeg", "image/png"] }, base64: { type: "string" } }, required: ["type", "base64"], additionalProperties: false },
        },
      },
      required: ["account", "post_id"], additionalProperties: false,
    },
  },
  {
    name: "get_post_review",
    description: "投稿の確認の中身を読む：今の案（キャプション・ハッシュタグ）、決まったこと、決めることと利用者の答え、メモ。答えを受けて案を直す前に読む",
    inputSchema: {
      type: "object",
      properties: { account: ACCOUNT, post_id: { type: "string" } },
      required: ["account", "post_id"], additionalProperties: false,
    },
  },
  {
    name: "take_answered_reviews",
    description: "利用者が答えを送った投稿を受け取り、「AIが直しています」にする（見張り役が使う）。直し終わったら record_post で questions・decided・caption を渡すと「答え待ち」に戻る",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "add_benchmark",
    description: "ベンチマーク（参考にするアカウント）を1件追加する。handle か url のどちらかは必須。同じアカウントが登録済みなら追加せずに知らせる（そのときは update_benchmark を使う）。特徴・取り入れる点などは、プロフィールや投稿で確かめたことと、このアカウントの戦略から書き、確かめていないことは書かない",
    inputSchema: {
      type: "object",
      properties: {
        account: ACCOUNT,
        name: { type: "string", description: "表示名（例：hitokoto Radio）" },
        handle: { type: "string", description: "Instagramのハンドル（@あり・なしどちらでもよい）" },
        url: { type: "string", description: "InstagramのプロフィールURL（handle がないとき）" },
        priority: { type: "string", enum: ["A", "B"], description: "A＝毎週確認したい主要なもの、B＝企画に応じて参照する補助的なもの。決まっていなければ省く" },
        area: { type: "string", description: "参考領域（短く。例：川景観・滞在時間）" },
        feature: { type: "string", description: "運用の特徴（実際にプロフィールや投稿で確かめたことだけ）" },
        adopt: { type: "string", description: "取り入れる点（このアカウントの戦略に照らして）" },
        caution: { type: "string", description: "注意点（真似しないこと）" },
      },
      required: ["account", "name"], additionalProperties: false,
    },
  },
  {
    name: "update_benchmark",
    description: "登録済みのベンチマークの欄を直す。handle で探す。渡した欄だけが変わる",
    inputSchema: {
      type: "object",
      properties: {
        account: ACCOUNT,
        handle: { type: "string", description: "直したいベンチマークのハンドル" },
        name: { type: "string" },
        priority: { type: "string", enum: ["A", "B"], description: "A＝毎週確認したい主要なもの、B＝企画に応じて参照する補助的なもの。決まっていなければ省く" },
        area: { type: "string", description: "参考領域（短く。例：川景観・滞在時間）" },
        feature: { type: "string", description: "運用の特徴（実際にプロフィールや投稿で確かめたことだけ）" },
        adopt: { type: "string", description: "取り入れる点（このアカウントの戦略に照らして）" },
        caution: { type: "string", description: "注意点（真似しないこと）" },
      },
      required: ["account", "handle"], additionalProperties: false,
    },
  },
  {
    name: "record_benchmark_stats",
    description: "ベンチマークの数字（フォロワー数・フォロー中・投稿数）を、いつ時点かと一緒に記録する。複数件まとめてよい。履歴として積み上がり、一覧には最新の数字が出る。InstagramのプロフィールやManusのInstagram連携で確かめた数字だけを入れる",
    inputSchema: {
      type: "object",
      properties: {
        account: ACCOUNT,
        items: {
          type: "array", minItems: 1, maxItems: 50,
          items: {
            type: "object",
            properties: {
              handle: { type: "string" },
              followers: { type: "integer", minimum: 0 },
              following: { type: "integer", minimum: 0 },
              posts: { type: "integer", minimum: 0 },
            },
            required: ["handle"], additionalProperties: false,
          },
        },
        captured_at: { type: "string", description: "いつ時点の数字か（ISO形式の日付・日時）。省略すると今" },
        source: { type: "string", description: "どこで取ったか（例：Instagramのプロフィール）" },
      },
      required: ["account", "items"], additionalProperties: false,
    },
  },
  {
    name: "save_template_preview",
    description: "フォーマットのCanvaテンプレートを作った・直したあとに使う。Canvaで書き出した各ページの画像URL（PNG/JPG、ページ順）を渡すと、Insta Studioに見本画像として保存し、テンプレートのリンクも記録する（前の版は履歴に残る）",
    inputSchema: {
      type: "object",
      properties: {
        account: ACCOUNT,
        section: { type: "string", description: "フォーマットの section（例：format:A）。get_account_design で確認できる" },
        image_urls: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10, description: "Canvaで書き出したページ画像のURL（ページ順）" },
        canva_url: { type: "string", description: "テンプレートのCanvaデザインのリンク" },
        note: { type: "string", description: "何を変えたか（履歴に残す）" },
      },
      required: ["account", "section", "image_urls"], additionalProperties: false,
    },
  },
];

// 見本画像を取りに行ってよい場所（Canvaの書き出し先）
const PREVIEW_HOSTS = [/\.canva\.com$/, /^document-export.*\.amazonaws\.com$/, /^s3\.amazonaws\.com$/];

// ---- 道具の中身 ----

// ハンドルの書き方をそろえる：@・URL・空白・大文字を取り除いた「ハンドル本体」にする
function normalizeHandle(input: string) {
  let s = (input ?? "").trim();
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/);
  if (m) s = m[1];
  return s.replace(/^@/, "").replace(/\/.*$/, "").toLowerCase();
}

async function findBenchmark(acc: string, h: string) {
  const { data } = await db.from("benchmarks").select("id, name, handle").eq("account_id", acc);
  return (data ?? []).find((b) => normalizeHandle(b.handle ?? "") === h) ?? null;
}

async function account(id: string, client: Client) {
  if (client.accounts && !client.accounts.includes(id)) throw new Error(`このコネクタでは「${id}」は扱えません`);
  const { data } = await db.from("accounts").select("id, label, handle").eq("id", id).single();
  if (!data) throw new Error(`アカウント「${id}」はありません。list_accounts で確認してください`);
  return data;
}

async function latestDocs(acc: string) {
  const { data, error } = await db.from("account_docs").select("*").eq("account_id", acc).eq("deleted", false);
  if (error) throw new Error(error.message);
  return data ?? [];
}

const run: Record<string, (a: any, client: Client) => Promise<string>> = {
  async list_accounts(_a, client) {
    let q = db.from("accounts").select("id, label, handle");
    if (client.accounts) q = q.in("id", client.accounts);
    const { data } = await q.order("sort");
    return (data ?? []).map((a) => `- ${a.id}：${a.label}（@${a.handle}）`).join("\n");
  },

  async get_account_design({ account: id }, client) {
    const a = await account(id, client);
    const docs = await latestDocs(id);
    const pick = (s: string) => docs.find((d) => d.section === s);
    const out = [`# ${a.label}（@${a.handle}）の設計（Insta Studio の最新版）`];
    for (const [s, t] of [["worldview", "世界観"], ["profile", "概要欄"], ["strategy", "戦略"]]) {
      const d = pick(s);
      out.push(`## ${t}\n${d?.body ? demote(d.body, "###") : "（まだ書かれていません）"}`);
    }
    const { data: setting } = await db.from("account_settings").select("links").eq("account_id", id).maybeSingle();
    const links = (setting?.links ?? []) as { label: string; url: string }[];
    out.push(`## 資料（収録台本・音声データなどの置き場所）\n${links.length ? links.map((l) => `- ${l.label}：${l.url}`).join("\n") : "（まだ登録されていません）"}`);
    const formats = docs.filter((d) => d.section.startsWith("format:")).sort((x, y) => x.section.localeCompare(y.section));
    out.push(`## フォーマット（${formats.length}件）`);
    for (const f of formats) {
      out.push(`### ${f.title}（${FORMAT_KIND[f.meta?.format] ?? ""}・${f.meta?.pages ?? ""}ページ）［section: ${f.section}］\nCanvaのテンプレート：${f.meta?.canva_url ?? "未設定（必要なら利用者に聞く）"}\n${demote(f.body, "####")}`);
    }
    return out.join("\n\n");
  },

  async get_benchmarks({ account: id, priority }, client) {
    await account(id, client);
    let q = db.from("benchmarks").select("priority, name, handle, url, area, feature, adopt, caution, followers, stats_at").eq("account_id", id);
    if (priority) q = q.eq("priority", priority);
    const { data } = await q.order("priority", { nullsFirst: false });
    return (data ?? []).map((b) =>
      `- [${b.priority ?? "－"}] ${b.name} ${b.handle ?? ""}｜${b.area ?? ""}${b.followers != null ? `｜フォロワー${b.followers}（${String(b.stats_at).slice(0, 10)}時点）` : ""}\n  特徴：${b.feature ?? ""}\n  取り入れる点：${b.adopt ?? ""}\n  注意点：${b.caution ?? ""}`).join("\n");
  },

  async list_posts({ account: id, limit }, client) {
    await account(id, client);
    const { data } = await db.from("posts")
      .select("id, title, format, status, caption, permalink, notes, created_at, posted_at")
      .eq("account_id", id).order("created_at", { ascending: false }).limit(limit ?? 20);
    if (!data?.length) return "まだ記録はありません";
    return data.map((p) =>
      `- ${p.created_at.slice(0, 10)}［${p.status}］${p.title ?? "無題"}（id: ${p.id}）${p.permalink ? `\n  ${p.permalink}` : ""}${p.caption ? `\n  キャプション冒頭：${p.caption.slice(0, 60)}` : ""}`).join("\n");
  },

  async save_design({ account: id, section, body, title, format, pages, canva_url }, client) {
    await account(id, client);
    const base: Record<string, string> = { worldview: "世界観", profile: "概要欄", strategy: "戦略" };
    const isFormat = section.startsWith("format:");
    if (!isFormat && !base[section]) throw new Error("section は worldview／profile／strategy／format:<名前> のどれかです");
    let meta = {};
    if (isFormat) {
      const prev = (await latestDocs(id)).find((d) => d.section === section);
      meta = { format: format ?? prev?.meta?.format ?? "carousel", pages: pages ?? prev?.meta?.pages ?? 1 };
      const canva = canva_url ?? prev?.meta?.canva_url;
      if (canva) meta = { ...meta, canva_url: canva };
      title = title ?? prev?.title ?? section.slice(7);
    }
    const { error } = await db.from("account_doc_versions").insert({
      account_id: id, section, title: isFormat ? title : base[section], body, meta, created_by: client.user,
    });
    if (error) throw new Error(error.message);
    return `保存しました（${isFormat ? title : base[section]}）。Insta Studio の戦略タブで、前の版は履歴から見られます`;
  },

  async add_benchmark({ account: id, name, handle, url, priority, area, feature, adopt, caution }, client) {
    await account(id, client);
    const h = normalizeHandle(handle ?? url ?? "");
    if (!h) throw new Error("handle か InstagramのURL を渡してください");
    const dup = await findBenchmark(id, h);
    if (dup) throw new Error(`「${dup.name}」（@${h}）はすでに登録されています。直すときは update_benchmark を使ってください`);
    const { error } = await db.from("benchmarks").insert({
      account_id: id, name, handle: "@" + h, url: `https://www.instagram.com/${h}/`,
      priority: priority ?? null, area: area ?? null, feature: feature ?? null, adopt: adopt ?? null, caution: caution ?? null,
      created_by: client.user,
    });
    if (error) throw new Error(error.message);
    return `ベンチマークに「${name}」（@${h}）を追加しました。アイコンはまだありません`;
  },

  async update_benchmark({ account: id, handle, ...fields }, client) {
    await account(id, client);
    const h = normalizeHandle(handle);
    const row = await findBenchmark(id, h);
    if (!row) throw new Error(`@${h} は登録されていません。追加するときは add_benchmark を使ってください`);
    const allowed = ["name", "priority", "area", "feature", "adopt", "caution"];
    const update: Record<string, unknown> = {};
    for (const k of allowed) if (fields[k] !== undefined) update[k] = fields[k];
    if (!Object.keys(update).length) throw new Error("直す欄を渡してください");
    const { error } = await db.from("benchmarks")
      .update({ ...update, updated_by: client.user, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (error) throw new Error(error.message);
    return `「${row.name}」（@${h}）を更新しました（${Object.keys(update).join("・")}）`;
  },

  async record_benchmark_stats({ account: id, items, captured_at, source }, client) {
    await account(id, client);
    const at = captured_at ? new Date(captured_at) : new Date();
    if (isNaN(at.getTime())) throw new Error("captured_at の日付が読めません");
    const done: string[] = [], missing: string[] = [];
    for (const it of items) {
      const h = normalizeHandle(it.handle);
      const row = await findBenchmark(id, h);
      if (!row) { missing.push("@" + h); continue; }
      const { error } = await db.from("benchmark_stats").insert({
        benchmark_id: row.id, account_id: id, followers: it.followers ?? null, following: it.following ?? null,
        posts: it.posts ?? null, captured_at: at.toISOString(), source: source ?? null, created_by: client.user,
      });
      if (error) throw new Error(error.message);
      // 一覧の「最新」は、今より新しい時点のときだけ書き換える（古い記録を後から足しても上書きしない）
      const { data: cur } = await db.from("benchmarks").select("stats_at").eq("id", row.id).single();
      if (!cur?.stats_at || new Date(cur.stats_at) <= at) {
        await db.from("benchmarks").update({ followers: it.followers ?? null, posts_count: it.posts ?? null, stats_at: at.toISOString() }).eq("id", row.id);
      }
      done.push(`@${h}${it.followers != null ? "（フォロワー" + it.followers + "）" : ""}`);
    }
    return `${at.toISOString().slice(0, 10)}時点の数字を${done.length}件記録しました：${done.join("、")}${missing.length ? `\n登録されていないため記録しなかったもの：${missing.join("、")}` : ""}`;
  },

  async save_template_preview({ account: id, section, image_urls, canva_url, note }, client) {
    await account(id, client);
    const prev = (await latestDocs(id)).find((d) => d.section === section);
    if (!prev || !section.startsWith("format:")) throw new Error(`フォーマット「${section}」がありません。get_account_design で section を確認してください`);
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const previews: string[] = [];
    for (let i = 0; i < image_urls.length; i++) {
      const url = new URL(image_urls[i]);
      if (url.protocol !== "https:" || !PREVIEW_HOSTS.some((h) => h.test(url.hostname))) {
        throw new Error(`Canvaで書き出した画像のURLを渡してください（${url.hostname} は受け付けません）`);
      }
      const res = await fetch(url);
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !/^image\/(png|jpeg)/.test(type)) throw new Error(`${i + 1}ページ目の画像を取得できませんでした`);
      const path = `${id}/templates/${section.slice(7)}_${stamp}_${i + 1}.${type.includes("png") ? "png" : "jpg"}`;
      const { error } = await db.storage.from("media").upload(path, await res.arrayBuffer(), { contentType: type });
      if (error) throw new Error(error.message);
      previews.push(path);
    }
    const meta = { ...prev.meta, previews, ...(canva_url ? { canva_url } : {}) };
    const body = note ? `${prev.body.trim()}\n\n## テンプレートの変更（${new Date().toISOString().slice(0, 10)}）\n- ${note}` : prev.body;
    const { error } = await db.from("account_doc_versions").insert({
      account_id: id, section, title: prev.title, body, meta, created_by: client.user,
    });
    if (error) throw new Error(error.message);
    return `見本画像を${previews.length}枚保存しました（${prev.title}）。Insta Studio の戦略タブで見られます`;
  },

  async set_post_images({ account: id, post_id, image_urls, images }, client) {
    await account(id, client);
    const { data: post } = await db.from("posts").select("id, photos").eq("id", post_id).eq("account_id", id).maybeSingle();
    if (!post) throw new Error("その投稿はありません。list_posts で post_id を確認してください");
    const files: { type: string; bytes: ArrayBuffer | Uint8Array }[] = [];
    for (const u of image_urls ?? []) {
      const url = new URL(u);
      if (url.protocol !== "https:" || !PREVIEW_HOSTS.some((h) => h.test(url.hostname))) {
        throw new Error(`Canvaで書き出した画像のURLを渡してください（${url.hostname} は受け付けません）`);
      }
      const res = await fetch(url);
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !/^image\/(png|jpeg)/.test(type)) throw new Error(`${files.length + 1}枚目の画像を取得できませんでした`);
      files.push({ type, bytes: await res.arrayBuffer() });
    }
    for (const im of images ?? []) {
      files.push({ type: im.type, bytes: Uint8Array.from(atob(im.base64), (c) => c.charCodeAt(0)) });
    }
    if (!files.length) throw new Error("image_urls か images を渡してください");
    // 同じ名前で上書きしない（表示のキャッシュに古い画像が残るため）。日時つきの名前で置き、前の画像は消す
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const path = `${id}/posts/${post_id}/${stamp}_${i + 1}.${files[i].type.includes("png") ? "png" : "jpg"}`;
      const { error } = await db.storage.from("media").upload(path, files[i].bytes, { contentType: files[i].type });
      if (error) throw new Error(error.message);
      paths.push(path);
    }
    const old = (post.photos ?? []) as string[];
    const { error } = await db.from("posts")
      .update({ photos: paths, updated_by: client.user, updated_at: new Date().toISOString() }).eq("id", post_id);
    if (error) throw new Error(error.message);
    if (old.length) await db.storage.from("media").remove(old);
    return `画像を${paths.length}枚入れました。Insta Studio の投稿の記録で見られます`;
  },

  async get_post_review({ account: id, post_id }, client) {
    await account(id, client);
    const { data: p } = await db.from("posts").select("*").eq("id", post_id).eq("account_id", id).maybeSingle();
    if (!p) throw new Error("その投稿はありません");
    const qs = (p.questions ?? []) as any[];
    const ans = (p.answers ?? {}) as Record<string, unknown>;
    const label = (q: any, k: string) => {
      const o = (q.options ?? []).find((x: any) => x.key === k);
      return o ? `${k}（${o.label}${o.detail ? "：" + o.detail : ""}）` : k;
    };
    const answerText = (q: any) => {
      const a = ans[q.id];
      if (a == null || a === "" || (Array.isArray(a) && !a.length)) return "（答えなし）";
      if (Array.isArray(a)) return a.map((k) => label(q, k)).join("、");
      return q.kind === "text" ? String(a) : label(q, String(a));
    };
    return [
      `# ${p.title ?? "無題"}（post_id: ${p.id}）`,
      `状態：${p.status}／確認：${p.review_state ?? "なし"}${p.answered_at ? `（答え ${p.answered_at.slice(0, 16)}）` : ""}`,
      `## 今の案：キャプション\n${p.caption ?? "（なし）"}`,
      `## 今の案：ハッシュタグ\n${p.hashtags ?? "（なし）"}`,
      `## 画像\n${((p.photos ?? []) as string[]).length}枚`,
      `## 決まったこと\n${((p.decided ?? []) as string[]).map((d) => "- " + d).join("\n") || "（なし）"}`,
      `## 決めることと答え\n${qs.map((q) => `- ${q.id} ${q.title}\n  答え：${answerText(q)}`).join("\n") || "（なし）"}`,
      `## 選択肢にないこと（メモ）\n${p.answer_note || "（なし）"}`,
    ].join("\n\n");
  },

  async take_answered_reviews(_a, client) {
    let q = db.from("posts").select("id, account_id, title").eq("review_state", "answered");
    if (client.accounts) q = q.in("account_id", client.accounts);
    const { data } = await q.order("answered_at");
    if (!data?.length) return "[]";
    await db.from("posts").update({ review_state: "working" }).in("id", data.map((p) => p.id));
    return JSON.stringify(data.map((p) => ({ account: p.account_id, post_id: p.id, title: p.title })));
  },

  async record_post({ account: id, post_id, title, format_name, kind, status, caption, hashtags, permalink, notes, questions, decided }, client) {
    await account(id, client);
    let section: string | null = null;
    if (format_name) {
      const f = (await latestDocs(id)).find((d) => d.section.startsWith("format:") && d.title === format_name);
      section = f?.section ?? null;
    }
    const fields: Record<string, unknown> = { status };
    if (title !== undefined) fields.title = title;
    if (section) fields.format_section = section;
    if (kind) fields.format = kind === "story" ? "story" : "carousel";
    if (caption !== undefined) fields.caption = caption;
    if (hashtags !== undefined) fields.hashtags = hashtags;
    if (permalink !== undefined) fields.permalink = permalink;
    if (notes !== undefined) fields.notes = notes;
    if (decided !== undefined) fields.decided = decided;
    // 決めることを渡したら、前の答えを消して「答え待ち」にする（空なら確認は終わり）
    if (questions !== undefined) {
      Object.assign(fields, {
        questions, answers: {}, answer_note: null, answered_at: null,
        review_state: questions.length ? "asking" : null,
      });
      if (post_id) fields.revised_at = new Date().toISOString();
    }
    if (post_id) { fields.updated_by = client.user; fields.updated_at = new Date().toISOString(); }
    if (status === "approved") { fields.approved_by = client.user; fields.approved_at = new Date().toISOString(); }
    if (status === "posted") fields.posted_at = new Date().toISOString();

    let id2 = post_id;
    if (post_id) {
      const { error } = await db.from("posts").update(fields).eq("id", post_id).eq("account_id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await db.from("posts")
        .insert({ ...fields, account_id: id, source: client.source, created_by: client.user }).select("id").single();
      if (error) throw new Error(error.message);
      id2 = data.id;
    }
    await db.from("post_logs").insert({
      post_id: id2, account_id: id, action: post_id ? status : "created", note: `${client.label}から`, created_by: client.user,
    });
    return `記録しました（post_id: ${id2}）。状態が進んだら、この post_id を付けて record_post を呼んでください`;
  },
};

// ---- MCP（JSON-RPC）の受け口 ----

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// 合言葉が合えば、どこから呼ばれたか（Manus／Claude Code）を返す。合わなければ null
function authorized(req: Request): Client | null {
  const url = new URL(req.url);
  const given = url.searchParams.get("key") ?? (req.headers.get("Authorization") ?? "").replace(/^Bearers+/i, "");
  return CLIENTS.find((c) => same(given, c.token)) ?? null;
}

async function handle(msg: any, client: Client) {
  const { id, method, params } = msg;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

  if (method === "initialize") {
    const v = PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0];
    return ok({
      protocolVersion: v,
      capabilities: { tools: {} },
      serverInfo: { name: "insta-studio", version: "0.2.0" },
      instructions: "Insta Studio（Instagram運用の設計の置き場）。投稿を作る・提案する前に get_account_design で設計を読み、フォーマットとルールに従う。画像はCanvaで、フォーマットのCanvaテンプレートを複製して作る。テンプレートそのものを作った・直したときは、各ページをPNGで書き出して save_template_preview で見本とリンクを保存する。決定事項は save_design、作成・公開した投稿は record_post で記録する。",
    });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS });
  if (method === "tools/call") {
    const fn = run[params?.name];
    if (!fn) return fail(-32602, `道具「${params?.name}」はありません`);
    try {
      return ok({ content: [{ type: "text", text: await fn(params.arguments ?? {}, client) }] });
    } catch (e) {
      return ok({ content: [{ type: "text", text: `エラー：${(e as Error).message}` }], isError: true });
    }
  }
  if (id === undefined) return null; // 通知（notifications/*）には返事をしない
  return fail(-32601, `未対応のメソッドです：${method}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const client = authorized(req);
  if (!client) return reply({ error: "合言葉が違います" }, 401);
  if (req.method !== "POST") return reply({ error: "POSTで呼んでください" }, 405);

  let body;
  try { body = await req.json(); } catch { return reply({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSONを読めません" } }, 400); }

  if (Array.isArray(body)) {
    const results = (await Promise.all(body.map((m) => handle(m, client)))).filter(Boolean);
    return results.length ? reply(results) : reply(null, 202);
  }
  const result = await handle(body, client);
  return result ? reply(result) : reply(null, 202);
});
