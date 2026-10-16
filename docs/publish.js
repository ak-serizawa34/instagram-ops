// 公開する：下書きカードを確認し、承認・差し戻し・投稿済みにする
// 投稿は今は手動：画像を保存し、キャプションをコピーしてInstagramに貼る

const publish = {
  filter: 'all',    // all | draft | approved | posted
  openId: null,     // 開いている投稿
  logs: [],         // 開いている投稿の作業の記録
  returning: false, // 差し戻しのコメント入力中
  copied: false,
};

const LOG_LABEL = {
  created: '作成', requested: 'AIへの依頼', drafted: 'AIが下書き', edited: '手直し', approved: '承認', returned: '差し戻し', posted: '投稿済みにした',
};

function renderPublish() {
  if (publish.openId) return renderPublishDetail();

  const filters = [['all', 'すべて'], ['draft', '下書き'], ['approved', '確認済み'], ['posted', '投稿済み']]
    .map(([k, l]) => `<button class="${publish.filter === k ? 'active' : ''}" data-act="pb-filter" data-v="${k}">${l}</button>`).join('');
  const list = state.posts.filter(p => p.slides.length && (publish.filter === 'all' || p.status === publish.filter));
  const cards = list.map(p => `
    <article class="card post-card">
      <button class="post-open" data-act="pb-open" data-id="${p.id}">
        <canvas data-post="${p.id}" data-slide="0"></canvas>
      </button>
      <div class="post-meta">
        <span class="status ${p.status}">${STATUS_LABEL[p.status]}</span>
        <span class="muted small">${p.format === 'story' ? 'ストーリーズ' : 'カルーセル'}・${p.slides.length}ページ</span>
      </div>
      <h3 class="card-name">${esc(p.title || '無題')}</h3>
      <div class="card-foot">
        <span>${p.updated_at ? `更新 ${esc(p.updater?.email || '')}・${fmt(p.updated_at)}` : `作成 ${esc(p.creator?.email || '')}・${fmt(p.created_at)}`}</span>
        <button class="btn small" data-act="pb-open" data-id="${p.id}">開く</button>
      </div>
    </article>`).join('');

  return `
    <div class="section-head"><h2 class="section-title">公開する<small>${list.length}件</small></h2></div>
    <div class="toolbar"><div class="filter">${filters}</div></div>
    <div class="grid posts">${cards || '<p class="empty">まだありません。「作る」でページができた投稿がここに並びます。</p>'}</div>`;
}

function renderPublishDetail() {
  const p = state.posts.find(x => x.id === publish.openId);
  if (!p) { publish.openId = null; return renderPublish(); }

  const slides = p.slides.map((_, i) => `<canvas class="detail-slide ${p.format}" data-post="${p.id}" data-slide="${i}"></canvas>`).join('');
  const logs = publish.logs.map(l => `
    <li><span>${LOG_LABEL[l.action] || esc(l.action)}</span>
      <span class="muted">${esc(l.who?.email || '')}・${fmt(l.created_at)}</span>
      ${l.note ? `<p>${esc(l.note)}</p>` : ''}</li>`).join('');

  const actions = [];
  if (p.status === 'draft') actions.push('<button class="btn primary" data-act="pb-approve">承認する</button>');
  if (p.status === 'approved') actions.push('<button class="btn primary" data-act="pb-posted">投稿済みにする</button>');
  if (p.status !== 'posted') actions.push('<button class="btn" data-act="pb-return-start">差し戻す</button>');
  if (p.status === 'draft') actions.push('<button class="btn" data-act="pb-edit">作るで直す</button>');

  const returnForm = publish.returning ? `
    <div class="return-form">
      <label>差し戻しのコメント<textarea id="pb-note" rows="3" placeholder="直してほしいところ"></textarea></label>
      <div class="form-actions">
        <button class="btn" data-act="pb-return-cancel">やめる</button>
        <button class="btn primary" data-act="pb-return">差し戻す</button>
      </div>
    </div>` : '';

  return `
    <div class="section-head">
      <h2 class="section-title">${esc(p.title || '無題')}<small><span class="status ${p.status}">${STATUS_LABEL[p.status]}</span></small></h2>
      <button class="btn" data-act="pb-close">一覧へ戻る</button>
    </div>
    <div class="detail-slides">${slides}</div>
    <div class="detail-grid">
      <section class="panel">
        <h3 class="block-title">キャプション</h3>
        <p class="caption-text">${esc(p.caption || '')}</p>
        <p class="caption-text muted">${esc(p.hashtags || '')}</p>
        <div class="form-actions">
          <button class="btn" data-act="pb-copy">${publish.copied ? 'コピーしました' : 'キャプションをコピー'}</button>
          <button class="btn" data-act="pb-download">画像を保存</button>
        </div>
      </section>
      <section class="panel">
        <h3 class="block-title">確認</h3>
        <div class="form-actions start">${actions.join('')}</div>
        ${returnForm}
        <h3 class="block-title">作業の記録</h3>
        <ul class="logs">${logs || '<li class="muted">記録はまだありません</li>'}</ul>
      </section>
    </div>`;
}

async function loadLogs(postId) {
  publish.logs = check(await db.from('post_logs')
    .select('*, who:profiles!post_logs_created_by_fkey(email)')
    .eq('post_id', postId)
    .order('created_at', { ascending: false }));
}

// 状態を変えて、記録を残す
async function setStatus(status, action, note, extra = {}) {
  const updated = check(await db.from('posts').update({ status, ...extra }).eq('id', publish.openId).select('*').single());
  await logPost(publish.openId, action, note);
  replacePost(updated);
  await loadLogs(publish.openId);
}

Object.assign(ACTIONS, {
  'pb-filter': t => { publish.filter = t.dataset.v; },
  'pb-open': async t => {
    publish.openId = t.dataset.id;
    publish.returning = false;
    publish.copied = false;
    await loadLogs(publish.openId);
  },
  'pb-close': () => { publish.openId = null; },
  'pb-approve': () => setStatus('approved', 'approved', null, { approved_by: (state.me || null), approved_at: new Date().toISOString() }),
  'pb-posted': () => setStatus('posted', 'posted', null, { posted_at: new Date().toISOString() }),
  'pb-return-start': () => { publish.returning = true; },
  'pb-return-cancel': () => { publish.returning = false; },
  'pb-return': async () => {
    const note = document.getElementById('pb-note').value.trim();
    if (!note) throw new Error('差し戻しのコメントを入れてください');
    publish.returning = false;
    await setStatus('draft', 'returned', note, { approved_by: null, approved_at: null });
  },
  'pb-edit': () => {
    openStudio(state.posts.find(p => p.id === publish.openId));
    publish.openId = null;
    state.view = 'create';
  },
  'pb-copy': async () => {
    const p = state.posts.find(x => x.id === publish.openId);
    await navigator.clipboard.writeText([p.caption, p.hashtags].filter(Boolean).join('\n\n'));
    publish.copied = true;
  },
  // ページごとのJPEGを、押した人の端末に保存する
  'pb-download': async () => {
    const p = state.posts.find(x => x.id === publish.openId);
    for (let i = 0; i < p.slides.length; i++) {
      const c = document.createElement('canvas');
      await drawSlide(c, p, i);
      const blob = await Templates.toJpeg(c);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(p.title || 'post').replace(/[\\/:*?"<>|]/g, '')}_${String(i + 1).padStart(2, '0')}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    return false;
  },
});
