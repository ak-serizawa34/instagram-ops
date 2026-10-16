// 戦略：アカウントの設計（世界観・概要欄・戦略・フォーマット）を見る・直す・履歴をたどる
// 保存のたびに新しい版を足す（account_doc_versions）。表示は最新の版（account_docs ビュー）

const strategy = {
  docs: [],          // 最新の版の一覧
  section: 'worldview',
  editing: false,
  history: null,     // 開いている項目の全版（履歴を見ているとき）
  viewing: null,     // 履歴で選んだ版
  armed: false,
  profiles: {},      // id -> email
  manus: null,       // Manusの設定を開いているとき { copied }
};

const BASE_SECTIONS = [
  { section: 'worldview', title: '世界観' },
  { section: 'profile', title: '概要欄' },
  { section: 'strategy', title: '戦略' },
];

const FORMAT_KIND = { carousel: 'カルーセル', story: 'ストーリーズ' };

async function loadStrategy() {
  strategy.docs = check(await db.from('account_docs').select('*').eq('account_id', state.account));
  const ids = [...new Set(strategy.docs.map(d => d.created_by).filter(Boolean))];
  if (ids.length) {
    check(await db.from('profiles').select('id, email').in('id', ids)).forEach(p => { strategy.profiles[p.id] = p.email; });
  }
}

// フォーマット（消していないもの）の一覧。作るで選ぶときにも使う
function formatDocs() {
  return strategy.docs.filter(d => d.section.startsWith('format:') && !d.deleted)
    .sort((a, b) => a.section.localeCompare(b.section, 'ja'));
}

function currentDoc() {
  return strategy.docs.find(d => d.section === strategy.section);
}

function who(id) {
  return strategy.profiles[id] || '取り込み';
}

// 見出し（## ）・箇条書き（- ）・段落だけの簡単な書式を表示する
function renderBody(text) {
  if (!text.trim()) return '<p class="muted">まだ書かれていません。「編集」から書き始めます。</p>';
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) { flush(); out.push(`<h4>${esc(line.slice(3))}</h4>`); }
    else if (/^\s*[-・] /.test(line)) { (list = list || []).push(`<li>${esc(line.replace(/^\s*[-・] /, ''))}</li>`); }
    else if (!line.trim()) { flush(); }
    else { flush(); out.push(`<p>${esc(line)}</p>`); }
  }
  flush();
  return out.join('');
}

function renderStrategy() {
  const nav = [
    ...BASE_SECTIONS.map(s => ({ ...s, doc: strategy.docs.find(d => d.section === s.section) })),
  ];
  const navHtml = nav.map(n => navItem(n.section, n.title)).join('')
    + '<div class="nav-label">フォーマット</div>'
    + formatDocs().map(d => navItem(d.section, d.title)).join('')
    + '<button class="nav-add" data-act="sg-new-format">＋ フォーマットを足す</button>';

  return `
    <div class="section-head">
      <h2 class="section-title">戦略</h2>
      <button class="btn manus" data-act="sg-manus">Manusの設定</button>
    </div>
    <div class="strategy">
      <nav class="strategy-nav">${navHtml}</nav>
      <section class="panel strategy-body">${renderStrategyMain()}</section>
    </div>`;
}

function navItem(section, title) {
  return `<button class="nav-item ${strategy.section === section ? 'active' : ''}" data-act="sg-open" data-s="${esc(section)}">${esc(title)}</button>`;
}

// ---- Manusの設定：Manusのプロジェクトに1回だけ貼る指示 ----
// 設計そのものは、ManusがコネクタInsta Studio（supabase/functions/mcp）で毎回読みに来る。貼り直しは不要

function manusInstruction() {
  const a = account();
  return `このプロジェクトは「${a.label}」${a.handle ? `（@${a.handle}）` : ""}のInstagram運用です。
- 作業の前に、Insta Studio コネクタの get_account_design（account: ${a.id}）で設計を読み、フォーマットとルールに従ってください
- 新しい投稿を考えるときは list_posts で過去の投稿を見て、重複を避けてください。参考には get_benchmarks を使えます
- 公開する前に、必ず下書き（画像・キャプション・ハッシュタグ）を見せて、確認を取ってください
- 素材にない事実・数字・日付・固有名詞・人の発言を作らないでください。足りなければ質問してください
- 下書きを作ったら record_post（status: draft）、確認が取れたら approved、公開したら posted と投稿のURLで記録してください
- 設計を変えると決めたときだけ、save_design で保存してください`;
}

function renderManusPanel() {
  return `
    <div class="doc-head">
      <h3 class="doc-title">Manusの設定</h3>
      <button class="btn small" data-act="sg-manus-close">閉じる</button>
    </div>
    <p class="muted small">Manusで「${esc(account().label)}」用のプロジェクトを作り、その指示（Instructions）に1回だけ貼ってください。設計を変えても、貼り直す必要はありません（Manusが毎回コネクタで最新を読みます）。</p>
    <textarea id="manus-text" rows="12" readonly>${esc(manusInstruction())}</textarea>
    <div class="form-actions">
      <span class="muted small">${strategy.manus.copied ? "コピーしました" : ""}</span>
      <button class="btn primary" data-act="sg-manus-copy">コピーする</button>
    </div>`;
}

function renderStrategyMain() {
  if (strategy.manus) return renderManusPanel();
  const base = BASE_SECTIONS.find(s => s.section === strategy.section);
  const doc = currentDoc();
  const isFormat = strategy.section.startsWith('format:');
  const title = doc?.title || base?.title || '新しいフォーマット';

  if (strategy.history) return renderHistory(title);

  if (strategy.editing) {
    const meta = doc?.meta || { format: 'carousel', pages: 3 };
    return `
      <form class="edit" data-form="sg-save">
        ${isFormat ? `
        <label>フォーマットの名前<input name="title" value="${esc(title)}" required></label>
        <div class="row2">
          <label>形<select name="format">${Object.entries(FORMAT_KIND).map(([k, l]) => `<option value="${k}" ${meta.format === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>ページ数<input name="pages" type="number" min="1" max="10" value="${esc(meta.pages || 1)}"></label>
        </div>` : `<h3 class="block-title">${esc(title)}</h3>`}
        <label>中身（「## 」で見出し、「- 」で箇条書き）<textarea name="body" rows="22">${esc(doc?.body || '')}</textarea></label>
        <div class="form-actions">
          ${isFormat && doc ? `<button type="button" class="btn small danger ${strategy.armed ? 'armed' : ''}" data-act="sg-delete">${strategy.armed ? 'もう一度で削除' : 'このフォーマットを削除'}</button>` : ''}
          <button type="button" class="btn" data-act="sg-cancel">やめる</button>
          <button type="submit" class="btn primary">保存する</button>
        </div>
      </form>`;
  }

  const metaLine = isFormat && doc ? `<p class="muted small">${FORMAT_KIND[doc.meta.format] || ''}・${doc.meta.pages || ''}ページ</p>` : '';
  return `
    <div class="doc-head">
      <h3 class="doc-title">${esc(title)}</h3>
      <div class="actions">
        ${doc ? '<button class="btn small" data-act="sg-history">履歴</button>' : ''}
        <button class="btn small primary" data-act="sg-edit">編集</button>
      </div>
    </div>
    ${metaLine}
    <div class="doc-body">${renderBody(doc?.body || '')}</div>
    ${doc ? `<p class="muted small doc-foot">最終更新 ${esc(who(doc.created_by))}・${fmt(doc.created_at)}</p>` : ''}`;
}

function renderHistory(title) {
  const list = strategy.history.map(v => `
    <button class="history-item ${strategy.viewing?.id === v.id ? 'active' : ''}" data-act="sg-view" data-id="${v.id}">
      ${fmt(v.created_at)}<small>${esc(who(v.created_by))}${v.deleted ? '・削除' : ''}</small>
    </button>`).join('');
  const v = strategy.viewing;
  return `
    <div class="doc-head">
      <h3 class="doc-title">${esc(title)}の履歴</h3>
      <button class="btn small" data-act="sg-history-close">最新に戻る</button>
    </div>
    <div class="history">
      <div class="history-list">${list}</div>
      <div class="doc-body">${v ? renderBody(v.body) : '<p class="muted">左の版を選ぶと中身が見られます。</p>'}</div>
    </div>`;
}

async function saveStrategy(form) {
  const f = Object.fromEntries(new FormData(form));
  const isFormat = strategy.section.startsWith('format:');
  const base = BASE_SECTIONS.find(s => s.section === strategy.section);
  const row = {
    account_id: state.account,
    section: strategy.section,
    title: isFormat ? f.title.trim() : base.title,
    body: f.body,
    meta: isFormat ? { format: f.format, pages: Number(f.pages) || 1 } : {},
  };
  if (!row.title) throw new Error('名前を入れてください');
  check(await db.from('account_doc_versions').insert(row));
  strategy.editing = false;
  await loadStrategy();
}

Object.assign(ACTIONS, {
  'sg-open': t => {
    strategy.manus = null;
    strategy.section = t.dataset.s;
    strategy.editing = false; strategy.history = null; strategy.viewing = null; strategy.armed = false;
  },
  'sg-edit': () => { strategy.editing = true; },
  'sg-cancel': () => {
    strategy.editing = false; strategy.armed = false;
    if (!currentDoc() && strategy.section.startsWith('format:')) strategy.section = 'worldview';
  },
  'sg-new-format': () => {
    strategy.section = `format:${Date.now()}`;
    strategy.editing = true; strategy.history = null; strategy.viewing = null;
  },
  'sg-delete': async () => {
    if (!strategy.armed) { strategy.armed = true; return; }
    const doc = currentDoc();
    check(await db.from('account_doc_versions').insert({
      account_id: state.account, section: doc.section, title: doc.title, body: doc.body, meta: doc.meta, deleted: true,
    }));
    strategy.armed = false; strategy.editing = false; strategy.section = 'worldview';
    await loadStrategy();
  },
  'sg-history': async () => {
    strategy.history = check(await db.from('account_doc_versions').select('*')
      .eq('account_id', state.account).eq('section', strategy.section).order('created_at', { ascending: false }));
    const ids = strategy.history.map(v => v.created_by).filter(id => id && !strategy.profiles[id]);
    if (ids.length) check(await db.from('profiles').select('id, email').in('id', ids)).forEach(p => { strategy.profiles[p.id] = p.email; });
    strategy.viewing = strategy.history[0] || null;
  },
  'sg-view': t => { strategy.viewing = strategy.history.find(v => v.id === t.dataset.id); },
  'sg-history-close': () => { strategy.history = null; strategy.viewing = null; },
  'sg-manus': t => {
    strategy.editing = false; strategy.history = null;
    strategy.manus = { copied: false };
  },
  'sg-manus-copy': async () => {
    await navigator.clipboard.writeText(manusInstruction());
    strategy.manus.copied = true;
  },
  'sg-manus-close': () => { strategy.manus = null; },
});
