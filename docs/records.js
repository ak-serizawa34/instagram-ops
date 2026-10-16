// 投稿の記録：Manusで作った・公開した投稿の一覧（Manusがコネクタの record_post で書き込む）
// アプリからは見るだけ。メモ（反応・気づき）は書き足せる

const records = {
  filter: 'all',  // all | draft | approved | posted
  open: null,     // 開いている投稿のID
  editingNote: false,
};

function renderRecords() {
  const filters = [['all', 'すべて'], ['draft', '下書き'], ['approved', '確認済み'], ['posted', '投稿済み']]
    .map(([k, l]) => `<button class="${records.filter === k ? 'active' : ''}" data-act="rc-filter" data-v="${k}">${l}</button>`).join('');
  const list = state.posts.filter(p => records.filter === 'all' || p.status === records.filter);
  const rows = list.map(p => {
    const fmtName = strategy.docs.find(d => d.section === p.format_section)?.title;
    const open = records.open === p.id;
    return `
      <article class="record ${open ? 'open' : ''}">
        <button class="record-head" data-act="rc-open" data-id="${p.id}">
          <span class="status ${p.status}">${STATUS_LABEL[p.status]}</span>
          <span class="record-title">${esc(p.title || '無題')}</span>
          <span class="muted small">${fmtName ? esc(fmtName) + '・' : ''}${fmt(p.posted_at || p.created_at)}</span>
        </button>
        ${open ? renderRecordBody(p) : ''}
      </article>`;
  }).join('');

  return `
    <div class="section-head"><h2 class="section-title">投稿の記録<small>${list.length}件</small></h2></div>
    <p class="muted small">Manusで下書きを作ったとき・確認したとき・公開したときに、Manusが記録します。</p>
    <div class="toolbar"><div class="filter">${filters}</div></div>
    <div class="records">${rows || '<p class="empty">まだ記録はありません。</p>'}</div>`;
}

function renderRecordBody(p) {
  const note = records.editingNote
    ? `<form class="edit" data-form="rc-note">
         <textarea name="notes" rows="4" placeholder="反応・気づきなど">${esc(p.notes || '')}</textarea>
         <div class="form-actions">
           <button type="button" class="btn" data-act="rc-note-cancel">やめる</button>
           <button type="submit" class="btn primary">保存する</button>
         </div>
       </form>`
    : `<p class="caption-text">${p.notes ? esc(p.notes) : '<span class="muted">メモはありません</span>'}</p>
       <div><button class="btn small" data-act="rc-note-edit">メモを書く</button></div>`;
  return `
    <div class="record-body">
      ${p.permalink ? `<a class="ig-link" href="${esc(p.permalink)}" target="_blank" rel="noopener">Instagramで見る ↗</a>` : ''}
      ${p.caption ? `<h4 class="block-title">キャプション</h4><p class="caption-text">${esc(p.caption)}</p>` : ''}
      ${p.hashtags ? `<p class="caption-text muted">${esc(p.hashtags)}</p>` : ''}
      <h4 class="block-title">メモ</h4>
      ${note}
    </div>`;
}

async function saveRecordNote(form) {
  const notes = new FormData(form).get('notes');
  const updated = check(await db.from('posts').update({ notes }).eq('id', records.open).select('*').single());
  replacePost(updated);
  records.editingNote = false;
}

Object.assign(ACTIONS, {
  'rc-filter': t => { records.filter = t.dataset.v; },
  'rc-open': t => { records.open = records.open === t.dataset.id ? null : t.dataset.id; records.editingNote = false; },
  'rc-note-edit': () => { records.editingNote = true; },
  'rc-note-cancel': () => { records.editingNote = false; },
});
