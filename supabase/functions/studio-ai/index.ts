// 作る：チャットの指示から、投稿の下書き（ページの文字・型・キャプション）をAIに作ってもらう
// 呼び出し：POST { post_id, message }（ログインした人の権限で動く。RLSでメンバー以外は読めない）
// 必要な秘密設定：ANTHROPIC_API_KEY（supabase secrets set で入れる）

import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// AIが返す形。strict な JSON Schema（構造化出力）で受け取る
const SLIDE = {
  type: "object",
  properties: {
    template: { type: "string", enum: ["photo", "margin", "text"] },
    text: { type: "string" },
    photo: { type: "integer", description: "使う写真の番号（0始まり）。写真を使わないときは -1" },
    size: { type: "string", enum: ["s", "m", "l"] },
    align: { type: "string", enum: ["top", "middle", "bottom"] },
  },
  required: ["template", "text", "photo", "size", "align"],
  additionalProperties: false,
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "利用者への短い返事（日本語）" },
    title: { type: "string", description: "一覧で見分けるための短い題名" },
    format: { type: "string", enum: ["carousel", "story"] },
    slides: { type: "array", items: SLIDE },
    caption_options: { type: "array", items: { type: "string" } },
    caption: { type: "string" },
    hashtags: { type: "string" },
  },
  required: ["reply", "title", "format", "slides", "caption_options", "caption", "hashtags"],
  additionalProperties: false,
};

function systemPrompt(label: string, brandNotes: string | null) {
  return `あなたはInstagramアカウント「${label}」の投稿づくりを手伝う編集者です。
利用者のチャットの指示と添付の写真・文字をもとに、投稿の下書きを作り、指示に応じて直します。

## 守ること
- 素材（チャットの文字・写真）にない事実、数字、日付、固有名詞、人の発言を作らない。足りない情報は reply で質問する
- 公開はしない。あなたが作るのは下書きだけ
- 日本語で書く
- 直しの指示のときは、指示されていない部分は変えずに、下書き全体を返す
- 利用者が手で直した現在の下書きが渡されたら、それを土台にする

## 形
- carousel（カルーセル）：1〜10ページ。1枚目は思わず読みたくなる一言、最後は案内やまとめ
- story（ストーリーズ）：1〜3ページ
- 各ページの文字は短く（目安：photo・margin は40字以内、text は60字以内）。改行は \\n で入れてよい

## ページの型（template）
- photo：写真を全面に敷き、白い文字を載せる。写真が主役のページ
- margin：余白をとって写真を置き、下に文字。落ち着いた雑誌風
- text：写真なしで文字だけ。話の要点や引用に
- 写真を使うページは photo に写真の番号、使わないページは -1
- size は文字の大きさ（s / m / l）、align は文字の位置（top / middle / bottom。margin では使われない）

## キャプション
- caption_options に雰囲気の違う案を3つ。caption にはそのうちいちばん良いものを入れる
- hashtags は半角スペース区切り。多すぎない（目安5〜10個）

## reply
- 何を作った・直したかを1〜3文で。質問があればここで聞く
${brandNotes ? `\n## このアカウントについて（口調・避けたい表現など）\n${brandNotes}\n` : ""}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POSTで呼んでください" }, 405);

  // ログインした人の権限でSupabaseにつなぐ
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });

  const { post_id, message } = await req.json().catch(() => ({}));
  if (!post_id || !message) return json({ error: "post_id と message が必要です" }, 400);

  const { data: post, error: postErr } = await supabase.from("posts").select("*").eq("id", post_id).single();
  if (postErr || !post) return json({ error: "投稿が見つかりません" }, 404);

  const { data: account } = await supabase.from("accounts").select("label, brand_notes").eq("id", post.account_id).single();

  // 写真は署名付きURL（1時間）でAIに見せる
  const photos: string[] = post.photos ?? [];
  const urls: string[] = [];
  if (photos.length) {
    const { data: signed, error: signErr } = await supabase.storage.from("media").createSignedUrls(photos, 3600);
    if (signErr) return json({ error: "写真を読み込めませんでした" }, 500);
    for (const s of signed ?? []) urls.push(s.signedUrl);
  }

  // これまでのやりとり ＋ 今回の指示（写真と現在の下書きを添える）
  const history = (post.chat ?? []) as { role: "user" | "assistant"; text: string }[];
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.text }));

  const content: Anthropic.ContentBlockParam[] = [];
  urls.forEach((url, i) => {
    content.push({ type: "text", text: `写真${i}` });
    content.push({ type: "image", source: { type: "url", url } });
  });
  const current = {
    format: post.format, slides: post.slides, caption: post.caption, hashtags: post.hashtags,
  };
  if ((post.slides ?? []).length) {
    content.push({ type: "text", text: `現在の下書き（利用者が手で直している場合があります）:\n${JSON.stringify(current)}` });
  }
  content.push({ type: "text", text: message });
  messages.push({ role: "user", content });

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  let response;
  try {
    response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      system: systemPrompt(account?.label ?? "", account?.brand_notes ?? null),
      messages,
      output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      // 安全上の理由で断られたときは、別のモデルで自動的にやり直す
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "AIのキーが正しく設定されていません" }, 500);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "AIが混み合っています。少し待ってからもう一度お試しください" }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `AIの呼び出しに失敗しました（${e.status}）` }, 502);
    throw e;
  }

  if (response.stop_reason === "refusal") return json({ error: "AIがこの依頼に応じられませんでした。言い方を変えてお試しください" }, 422);
  if (response.stop_reason === "max_tokens") return json({ error: "AIの返事が長すぎて途中で切れました。もう一度お試しください" }, 502);

  const text = response.content.find((b) => b.type === "text");
  let out;
  try {
    out = JSON.parse(text && text.type === "text" ? text.text : "");
  } catch {
    return json({ error: "AIの返事を読み取れませんでした。もう一度お試しください" }, 502);
  }

  // 写真の番号が範囲外なら写真なしにする
  const slides = (out.slides ?? []).slice(0, out.format === "story" ? 3 : 10).map((s: { photo: number }) => ({
    ...s,
    photo: Number.isInteger(s.photo) && s.photo >= 0 && s.photo < photos.length ? s.photo : -1,
  }));

  const chat = [
    ...history,
    { role: "user", text: message },
    { role: "assistant", text: out.reply },
  ];

  const { data: updated, error: upErr } = await supabase.from("posts").update({
    title: post.title || out.title,
    format: out.format,
    slides,
    caption: out.caption,
    hashtags: out.hashtags,
    caption_options: out.caption_options,
    chat,
  }).eq("id", post_id).select("*").single();
  if (upErr) return json({ error: "下書きを保存できませんでした" }, 500);

  return json({ post: updated });
});
