// Manus用のコネクタ（MCPサーバー）。Manusのチャットから、Insta Studioの設計を読み書きする
//
// つなぎ方：Manus の Connectors → Add MCP by URL に
//   https://fesasskyvogpmifxhxoa.supabase.co/functions/v1/mcp?key=<MCP_TOKEN>
// を登録する。key（合言葉）は秘密設定 MCP_TOKEN と照合する。URLはリポジトリや画面に出さない
//
// MCPの「Streamable HTTP」を、POSTでJSONを返す最小の形で実装している
// 必要な秘密設定：MCP_TOKEN（Manus用の合言葉）、MCP_TOKEN_CLAUDE（Claude Code用の合言葉）、MCP_USER_ID（書き込みを誰の作業として残すか＝芹澤さんのprofiles.id）

import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
// 合言葉はつなぐ先ごとに分ける。どこからの書き込みかを記録に残すため
const CLIENTS = [
  { token: Deno.env.get("MCP_TOKEN") ?? "", source: "manus", label: "Manus" },
  { token: Deno.env.get("MCP_TOKEN_CLAUDE") ?? "", source: "claude-code", label: "Claude Code" },
].filter((c) => c.token);
type Client = typeof CLIENTS[number];
const USER_ID = Deno.env.get("MCP_USER_ID") ?? null;

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
      },
      required: ["account", "status"], additionalProperties: false,
    },
  },
];

// ---- 道具の中身 ----

async function account(id: string) {
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
  async list_accounts() {
    const { data } = await db.from("accounts").select("id, label, handle").order("sort");
    return (data ?? []).map((a) => `- ${a.id}：${a.label}（@${a.handle}）`).join("\n");
  },

  async get_account_design({ account: id }) {
    const a = await account(id);
    const docs = await latestDocs(id);
    const pick = (s: string) => docs.find((d) => d.section === s);
    const out = [`# ${a.label}（@${a.handle}）の設計（Insta Studio の最新版）`];
    for (const [s, t] of [["worldview", "世界観"], ["profile", "概要欄"], ["strategy", "戦略"]]) {
      const d = pick(s);
      out.push(`## ${t}\n${d?.body ? demote(d.body, "###") : "（まだ書かれていません）"}`);
    }
    const formats = docs.filter((d) => d.section.startsWith("format:")).sort((x, y) => x.section.localeCompare(y.section));
    out.push(`## フォーマット（${formats.length}件）`);
    for (const f of formats) {
      out.push(`### ${f.title}（${FORMAT_KIND[f.meta?.format] ?? ""}・${f.meta?.pages ?? ""}ページ）［section: ${f.section}］\nCanvaのテンプレート：${f.meta?.canva_url ?? "未設定（必要なら利用者に聞く）"}\n${demote(f.body, "####")}`);
    }
    return out.join("\n\n");
  },

  async get_benchmarks({ account: id, priority }) {
    await account(id);
    let q = db.from("benchmarks").select("priority, name, handle, url, area, feature, adopt, caution").eq("account_id", id);
    if (priority) q = q.eq("priority", priority);
    const { data } = await q.order("priority", { nullsFirst: false });
    return (data ?? []).map((b) =>
      `- [${b.priority ?? "－"}] ${b.name} ${b.handle ?? ""}｜${b.area ?? ""}\n  特徴：${b.feature ?? ""}\n  取り入れる点：${b.adopt ?? ""}\n  注意点：${b.caution ?? ""}`).join("\n");
  },

  async list_posts({ account: id, limit }) {
    await account(id);
    const { data } = await db.from("posts")
      .select("id, title, format, status, caption, permalink, notes, created_at, posted_at")
      .eq("account_id", id).order("created_at", { ascending: false }).limit(limit ?? 20);
    if (!data?.length) return "まだ記録はありません";
    return data.map((p) =>
      `- ${p.created_at.slice(0, 10)}［${p.status}］${p.title ?? "無題"}（id: ${p.id}）${p.permalink ? `\n  ${p.permalink}` : ""}${p.caption ? `\n  キャプション冒頭：${p.caption.slice(0, 60)}` : ""}`).join("\n");
  },

  async save_design({ account: id, section, body, title, format, pages, canva_url }) {
    await account(id);
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
      account_id: id, section, title: isFormat ? title : base[section], body, meta, created_by: USER_ID,
    });
    if (error) throw new Error(error.message);
    return `保存しました（${isFormat ? title : base[section]}）。Insta Studio の戦略タブで、前の版は履歴から見られます`;
  },

  async record_post({ account: id, post_id, title, format_name, kind, status, caption, hashtags, permalink, notes }, client) {
    await account(id);
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
    if (status === "approved") { fields.approved_by = USER_ID; fields.approved_at = new Date().toISOString(); }
    if (status === "posted") fields.posted_at = new Date().toISOString();

    let id2 = post_id;
    if (post_id) {
      const { error } = await db.from("posts").update(fields).eq("id", post_id).eq("account_id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await db.from("posts")
        .insert({ ...fields, account_id: id, source: client.source, created_by: USER_ID }).select("id").single();
      if (error) throw new Error(error.message);
      id2 = data.id;
    }
    await db.from("post_logs").insert({
      post_id: id2, account_id: id, action: post_id ? status : "created", note: `${client.label}から`, created_by: USER_ID,
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
      instructions: "Insta Studio（Instagram運用の設計の置き場）。投稿を作る・提案する前に get_account_design で設計を読み、フォーマットとルールに従う。画像はCanvaで、フォーマットのCanvaテンプレートを複製して作る。決定事項は save_design、作成・公開した投稿は record_post で記録する。",
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
