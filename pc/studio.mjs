// Claude Code が Insta Studio を読み書きするための道具（芹澤さんのPCで使う）。
// すべてコネクタ（Manusと同じ窓口）を通すので、重複チェックや記録の決まりがManusからの書き込みとそろう。
//
//   node pc/studio.mjs mcp <道具の名前> [引数のJSONファイル]  … コネクタの道具を呼ぶ（例：get_account_design, add_benchmark）
//   node pc/studio.mjs doc <account> <section> <JSONファイル>   … 戦略タブの1項目に新しい版を足す（save_design の近道）
//   node pc/studio.mjs avatar-url <account> <handle>            … アイコンの取り込み口のURL（末尾の src= に画像URLを足す）
//   node pc/studio.mjs images <account> <post_id> <画像ファイル…> … 投稿の確認画面に画像を入れる（ページ順。AIは画像を読まない）
//
// 合言葉は、リポジトリに入らない .env の MCP_TOKEN_CLAUDE を使う。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://fesasskyvogpmifxhxoa.supabase.co';

function token() {
  const env = readFileSync(join(import.meta.dirname, '..', '.env'), 'utf8');
  const t = env.match(/^MCP_TOKEN_CLAUDE=(.+)$/m)?.[1]?.trim();
  if (!t) throw new Error('.env に MCP_TOKEN_CLAUDE がありません');
  return t;
}

async function call(tool, args) {
  const r = await fetch(`${BASE}/functions/v1/mcp?key=${token()}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  console.log(j.result.content[0].text);
  if (j.result.isError) process.exitCode = 1;
}

// ---- コマンド ----

async function mcp(tool, file) {
  await call(tool, file ? JSON.parse(readFileSync(file, 'utf8')) : {});
}

// file は JSON：{ "title": "フォーマット名（フォーマットのときだけ）", "body": "...", "meta": { "format": "carousel", "pages": 3 } }
async function doc(account, section, file) {
  const d = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof d.body !== 'string') throw new Error('body が必要です');
  await call('save_design', {
    account, section, body: d.body,
    ...(section.startsWith('format:') ? { title: d.title, format: d.meta?.format, pages: d.meta?.pages } : {}),
  });
}

async function avatarUrl(account, handle) {
  console.log(`${BASE}/functions/v1/avatar-intake?key=${token()}&account=${encodeURIComponent(account)}&handle=${encodeURIComponent(handle)}&src=`);
}

async function images(account, postId, ...files) {
  if (!files.length) throw new Error('画像ファイルを渡してください');
  await call('set_post_images', {
    account, post_id: postId,
    images: files.map(f => ({ type: /\.png$/i.test(f) ? 'image/png' : 'image/jpeg', base64: readFileSync(f).toString('base64') })),
  });
}

const [cmd, ...args] = process.argv.slice(2);
const run = { mcp, doc, 'avatar-url': avatarUrl, images }[cmd];
if (!run) {
  console.log('使い方：node pc/studio.mjs mcp <道具> [JSON] | doc <account> <section> <JSON> | avatar-url <account> <handle> | images <account> <post_id> <画像…>');
  process.exit(1);
}
run(...args).catch(e => { console.error(e.message); process.exitCode = 1; });
