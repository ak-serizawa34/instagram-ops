// 画面の動き。データの読み書きはすべてSupabase経由
const db = supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey);

const VIEWS = [
  { key: 'create', label: '作る' },
  { key: 'publish', label: '公開する' },
  { key: 'insights', label: '分析する' },
  { key: 'bench', label: 'ベンチマーク' },
];

const state = {
  accounts: [], account: null, view: 'bench',
  bench: [], priority: 'すべて', editing: null, armed: null, error: '',
};

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// アイコン：画像があれば表示、なければ名前の頭文字の丸
function avatar(name, path) {
  if (path) {
    const src = `${APP_CONFIG.supabaseUrl}/storage/v1/object/public/avatars/${encodeURI(path)}`;
    return `<img class="avatar" src="${esc(src)}" alt="" loading="lazy">`;
  }
  return `<span class="avatar">${esc((name || '?').trim().charAt(0))}</span>`;
}

// InstagramのページURL：URL欄がInstagramならそれ、なければハンドルから作る
function igUrl(url, handle) {
  if (url && /instagram\.com/.test(url)) return url;
  const h = (handle || '').replace(/^@/, '').trim();
  return h ? `https://www.instagram.com/${h}/` : '';
}

function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Supabaseの返り値からエラーを取り出して投げる
function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// ---- ログイン ----

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = new FormData(e.target).get('email');
  const redirect = location.origin + location.pathname;
  const { error } = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
  $('login-msg').textContent = error ? error.message : 'メールを送りました。届いたリンクを開いてください。';
});

$('logout').addEventListener('click', () => db.auth.signOut());

db.auth.onAuthStateChange((_event, session) => {
  $('login').hidden = !!session;
  $('app').hidden = !session;
  if (session && !state.accounts.length) start();
  if (!session) state.accounts = [];
});

async function start() {
  try {
    // RLSにより、メンバーになっているアカウントだけが返ってくる
    state.accounts = check(await db.from('accounts').select('id, label, handle, avatar_path').order('sort'));
    state.account = state.accounts.length ? state.accounts[0].id : null;
    if (state.account) await loadBench();
  } catch (e) { state.error = e.message; }
  render();
}

// ---- ベンチマーク ----

async function loadBench() {
  state.bench = check(await db.from('benchmarks')
    .select('*, creator:profiles!benchmarks_created_by_fkey(email), updater:profiles!benchmarks_updated_by_fkey(email)')
    .eq('account_id', state.account)
    .order('priority', { nullsFirst: false })
    .order('created_at'));
}

async function saveBench(id, fields) {
  if (!fields.name) throw new Error('アカウント名を入れてください');
  if (id) {
    check(await db.from('benchmarks').update(fields).eq('id', id));
  } else {
    check(await db.from('benchmarks').insert({ ...fields, account_id: state.account }));
  }
  await loadBench();
}

async function deleteBench(id) {
  check(await db.from('benchmarks').delete().eq('id', id));
  await loadBench();
}

// ---- 描画 ----

function render() {
  // アカウント切り替え：アイコン＋名前
  $('accounts').innerHTML = state.accounts.map(a =>
    `<button class="${a.id === state.account ? 'active' : ''}" data-account="${a.id}">${avatar(a.label, a.avatar_path)}${esc(a.label)}</button>`).join('');
  $('views').innerHTML = VIEWS.map(v =>
    `<button class="${v.key === state.view ? 'active' : ''}" data-view="${v.key}">${v.label}</button>`).join('');

  const err = state.error ? `<div class="error">${esc(state.error)}</div>` : '';
  if (!state.account) {
    $('main').innerHTML = err + '<p class="empty">見られるアカウントがありません。管理者にメンバー登録を依頼してください。</p>';
    return;
  }
  $('main').innerHTML = err + renderProfile() + (state.view === 'bench' ? renderBench()
    : '<div class="placeholder">この画面は準備中です</div>');
}

// 選んでいる自分たちのアカウント（アイコン・名前・ハンドル → Instagramへ）
function renderProfile() {
  const a = state.accounts.find(x => x.id === state.account);
  const href = igUrl('', a.handle);
  return `
    <section class="profile">
      ${avatar(a.label, a.avatar_path)}
      <div>
        <h1 class="profile-name">${esc(a.label)}</h1>
        ${href ? `<a class="profile-handle" href="${esc(href)}" target="_blank" rel="noopener">@${esc(a.handle)}　Instagramを開く ↗</a>` : ''}
      </div>
    </section>`;
}

function renderBench() {
  const list = state.bench.filter(b => state.priority === 'すべて' || b.priority === state.priority);
  const filter = ['すべて', 'A', 'B'].map(p =>
    `<button class="${p === state.priority ? 'active' : ''}" data-priority="${p}">${p}</button>`).join('');
  const adding = state.editing === 'new' ? `<article class="card editing">${renderForm({})}</article>` : '';
  return `
    <div class="section-head">
      <h2 class="section-title">ベンチマーク<small>${state.bench.length}件</small></h2>
      <button class="btn primary" data-act="add">追加する</button>
    </div>
    <div class="legend">
      <div><span class="badge a">A</span>毎週確認したい主要なベンチマーク</div>
      <div><span class="badge b">B</span>企画のテーマに応じて参照する補助的なベンチマーク</div>
      <div class="note">フォロワー数ではなく、事業の目的に合うかどうかで分けています。</div>
    </div>
    <div class="toolbar">
      <div class="filter">${filter}</div>
    </div>
    <div class="grid">
      ${adding}
      ${list.length ? list.map(renderCard).join('') : '<p class="empty">まだありません</p>'}
    </div>`;
}

function renderCard(b, i) {
  if (state.editing === b.id) return `<article class="card editing">${renderForm(b)}</article>`;
  const ig = igUrl(b.url, b.handle);
  const name = b.url && !ig ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.name)}</a>` : esc(b.name);
  const notes = [['運用の特徴', b.feature], ['注意点', b.caution]]
    .filter(r => r[1]).map(r => `<div><dt>${r[0]}</dt><dd>${esc(r[1])}</dd></div>`).join('');
  const who = b.updated_at
    ? `更新 ${esc(b.updater?.email || '不明')}・${fmt(b.updated_at)}`
    : `追加 ${esc(b.creator?.email || '取り込み')}・${fmt(b.created_at)}`;
  const armed = state.armed === b.id;
  const badge = b.priority
    ? `<span class="badge ${b.priority === 'A' ? 'a' : 'b'}" title="${b.priority === 'A' ? '毎週確認したい主要なベンチマーク' : '企画のテーマに応じて参照する補助的なベンチマーク'}">${b.priority}</span>`
    : '<span class="badge none" title="優先度は未設定">－</span>';
  return `
    <article class="card" style="animation-delay:${Math.min(i, 12) * 30}ms">
      <div class="card-top">
        ${avatar(b.name, b.avatar_path)}
        <div class="card-id">
          <h3 class="card-name">${name}</h3>
          <div class="card-handle">${esc(b.handle)}</div>
        </div>
        ${badge}
      </div>
      ${b.area ? `<span class="area">${esc(b.area)}</span>` : ''}
      ${b.adopt ? `<dl class="notes"><div><dt>取り入れる点</dt><dd class="adopt">${esc(b.adopt)}</dd></div></dl>` : ''}
      ${notes ? `<dl class="notes">${notes}</dl>` : ''}
      <div class="card-foot">
        <span>${who}</span>
        <span class="actions">
          ${ig ? `<a class="ig-link" href="${esc(ig)}" target="_blank" rel="noopener">Instagram ↗</a>` : ''}
          <button class="btn small" data-act="edit" data-id="${b.id}">編集</button>
          <button class="btn small danger ${armed ? 'armed' : ''}" data-act="delete" data-id="${b.id}">${armed ? 'もう一度で削除' : '削除'}</button>
        </span>
      </div>
    </article>`;
}

function renderForm(b) {
  const labels = { '': '未設定', A: 'A：毎週確認したい主要なもの', B: 'B：企画に応じて参照する補助的なもの' };
  const opt = p => `<option value="${p}" ${(b.priority || '') === p ? 'selected' : ''}>${labels[p]}</option>`;
  return `
    <form class="edit" data-id="${esc(b.id || '')}">
      <div class="row2">
        <label>アカウント名<input name="name" value="${esc(b.name)}" required></label>
        <label>優先<select name="priority">${['', 'A', 'B'].map(opt).join('')}</select></label>
      </div>
      <div class="row2">
        <label>ハンドル<input name="handle" value="${esc(b.handle)}" placeholder="@"></label>
        <label>URL<input name="url" value="${esc(b.url)}" type="url"></label>
      </div>
      <label>参考領域<input name="area" value="${esc(b.area)}"></label>
      <label>運用の特徴<textarea name="feature">${esc(b.feature)}</textarea></label>
      <label>取り入れる点<textarea name="adopt">${esc(b.adopt)}</textarea></label>
      <label>注意点<textarea name="caution">${esc(b.caution)}</textarea></label>
      <div class="form-actions">
        <button type="button" class="btn" data-act="cancel">やめる</button>
        <button type="submit" class="btn primary">保存する</button>
      </div>
    </form>`;
}

// ---- 操作 ----

$('app').addEventListener('click', async e => {
  const t = e.target.closest('button');
  // フォームの保存ボタンは submit で受けるので、ここでは扱わない
  if (!t || t.id === 'logout' || (t.form && t.type === 'submit')) return;
  state.error = '';
  try {
    if (t.dataset.account) {
      state.account = t.dataset.account; state.editing = null; state.armed = null;
      await loadBench();
    } else if (t.dataset.view) {
      state.view = t.dataset.view;
    } else if (t.dataset.priority) {
      state.priority = t.dataset.priority;
    } else if (t.dataset.act === 'add') {
      state.editing = 'new';
    } else if (t.dataset.act === 'edit') {
      state.editing = t.dataset.id; state.armed = null;
    } else if (t.dataset.act === 'cancel') {
      state.editing = null;
    } else if (t.dataset.act === 'delete') {
      if (state.armed !== t.dataset.id) state.armed = t.dataset.id;
      else { state.armed = null; await deleteBench(t.dataset.id); }
    }
  } catch (err) { state.error = err.message; }
  render();
});

$('app').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const f = Object.fromEntries(new FormData(form));
  const fields = {
    priority: f.priority || null, name: f.name.trim(), handle: f.handle.trim(), url: f.url.trim(),
    area: f.area.trim(), feature: f.feature.trim(), adopt: f.adopt.trim(), caution: f.caution.trim(),
  };
  form.querySelector('[type=submit]').disabled = true;
  try {
    await saveBench(form.dataset.id, fields);
    state.editing = null; state.error = '';
  } catch (err) { state.error = err.message; }
  render();
});
