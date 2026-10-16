// Claude Code方式でAIの下書きを作るための道具（芹澤さんのPCで、Claude Codeが使う）
//
//   node pc/studio.mjs pending                 … 返事待ちの依頼の一覧
//   node pc/studio.mjs fetch <post_id> <dir>   … 投稿の中身（post.json）と写真（photo0.jpg…）を dir に保存
//   node pc/studio.mjs apply <post_id> <file>  … 作った下書き（JSON）を投稿に書き込み、依頼を「返事済み」にする
//
// 管理用の鍵（service_role）は実行のたびに Supabase CLI から取得し、どこにも保存しない。
// 前提：npx supabase login 済み

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REF = 'fesasskyvogpmifxhxoa';
const BASE = `https://${REF}.supabase.co`;

function serviceKey() {
  const out = execSync(`npx -y supabase@latest projects api-keys --project-ref ${REF} -o json`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: true });
  const keys = JSON.parse(out.slice(out.indexOf('[')));
  return keys.find(k => k.name === 'service_role').api_key;
}

const KEY = serviceKey();
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function rest(path, init = {}) {
  const r = await fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { ...H, 'Content-Type': 'application/json', ...init.headers } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text}`);
  return text ? JSON.parse(text) : null; // return=minimal のときは本文なし
}

async function getPost(id) {
  const [post] = await rest(`posts?id=eq.${id}&select=*`);
  if (!post) throw new Error('投稿が見つかりません');
  return post;
}

const isPending = p => p.chat.length && p.chat[p.chat.length - 1].pending;

// ---- コマンド ----

async function pending() {
  const posts = await rest('posts?select=id,account_id,title,format,chat,photos,slides&order=updated_at.desc.nullslast');
  const list = posts.filter(isPending).map(p => ({
    post_id: p.id, account: p.account_id, title: p.title, format: p.format,
    photos: p.photos.length, slides: p.slides.length,
    request: p.chat[p.chat.length - 1].text, by: p.chat[p.chat.length - 1].by,
  }));
  console.log(JSON.stringify(list, null, 2));
}

async function fetchPost(id, dir) {
  const post = await getPost(id);
  const [account] = await rest(`accounts?id=eq.${post.account_id}&select=label,brand_notes`);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < post.photos.length; i++) {
    const r = await fetch(`${BASE}/storage/v1/object/media/${post.photos[i]}`, { headers: H });
    if (!r.ok) throw new Error(`写真${i}を取得できません（${r.status}）`);
    writeFileSync(join(dir, `photo${i}.jpg`), Buffer.from(await r.arrayBuffer()));
  }
  // 戦略タブの最新の版：世界観・戦略と、この投稿で選んだフォーマット
  const docs = await rest(`account_docs?account_id=eq.${post.account_id}&deleted=eq.false&select=section,title,body,meta`);
  const pick = s => docs.find(d => d.section === s) || null;
  const view = {
    post_id: post.id, account: account.label, brand_notes: account.brand_notes,
    worldview: pick('worldview')?.body ?? null,
    strategy: pick('strategy')?.body ?? null,
    format_doc: post.format_section ? pick(post.format_section) : null,
    title: post.title, format: post.format, photos: post.photos.length,
    slides: post.slides, caption: post.caption, hashtags: post.hashtags, chat: post.chat,
  };
  writeFileSync(join(dir, 'post.json'), JSON.stringify(view, null, 2));
  console.log(`保存しました：${dir}（post.json と 写真${post.photos.length}枚）`);
}

// 下書きの形を確かめてから書き込む
function validate(d, photoCount) {
  const err = m => { throw new Error(`下書きの形が正しくありません：${m}`); };
  for (const k of ['reply', 'title', 'format', 'slides', 'caption_options', 'caption', 'hashtags']) if (!(k in d)) err(`${k} がない`);
  if (!['carousel', 'story'].includes(d.format)) err('format');
  const max = d.format === 'story' ? 3 : 10;
  if (!Array.isArray(d.slides) || !d.slides.length || d.slides.length > max) err(`slides は1〜${max}ページ`);
  for (const s of d.slides) {
    if (!['photo', 'margin', 'text'].includes(s.template)) err('template');
    if (typeof s.text !== 'string') err('text');
    if (!Number.isInteger(s.photo) || s.photo < -1 || s.photo >= photoCount) err(`photo は -1〜${photoCount - 1}`);
    if (!['s', 'm', 'l'].includes(s.size)) err('size');
    if (!['top', 'middle', 'bottom'].includes(s.align)) err('align');
  }
  if (!Array.isArray(d.caption_options)) err('caption_options');
}

async function apply(id, file) {
  const post = await getPost(id);
  const d = JSON.parse(readFileSync(file, 'utf8'));
  validate(d, post.photos.length);
  const chat = post.chat.map(m => { const { pending: _, ...rest } = m; return rest; });
  chat.push({ role: 'assistant', text: d.reply });
  await rest(`posts?id=eq.${id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      title: post.title || d.title, format: d.format, slides: d.slides,
      caption: d.caption, hashtags: d.hashtags, caption_options: d.caption_options, chat,
    }),
  });
  await rest('post_logs', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ post_id: id, account_id: post.account_id, action: 'drafted' }),
  });
  console.log('書き込みました');
}

// 戦略タブの1項目に新しい版を足す（世界観・概要欄・戦略・フォーマット）
//   file は JSON：{ "title": "...", "body": "...", "meta": {...} }
async function doc(account, section, file) {
  const d = JSON.parse(readFileSync(file, 'utf8'));
  if (!d.title || typeof d.body !== 'string') throw new Error('title と body が必要です');
  await rest('account_doc_versions', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: account, section, title: d.title, body: d.body, meta: d.meta || {} }),
  });
  console.log(`書き込みました：${account} / ${section}`);
}

const [cmd, ...args] = process.argv.slice(2);
const run = { pending, fetch: fetchPost, apply, doc }[cmd];
if (!run) {
  console.log('使い方：node pc/studio.mjs pending | fetch <post_id> <dir> | apply <post_id> <file> | doc <account> <section> <file>');
  process.exit(1);
}
run(...args).catch(e => { console.error(e.message); process.exitCode = 1; });
