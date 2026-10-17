// 投稿の記録：Manusで作った・公開した投稿の一覧（Manusがコネクタの record_post で書き込む）
// アプリからは見るだけ。メモ（反応・気づき）は書き足せる
// 確認（決めることがある下書き）では、画像と案を見ながら選んで答えを送れる

const records = {
  filter: 'all',  // all | draft | approved | posted
  open: null,     // 開いている投稿のID
  editingNote: false,
  draft: null,        // 確認：送る前の答え {id, answers, note}
  armedApprove: null, // 「確認済みにする」を一度押した投稿のID
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
    <p class="muted small">Manus・Claude Codeで下書きを作ったとき・確認したとき・公開したときに記録されます。決めることがある下書きは、開いて答えを送れます。</p>
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
  const hasReview = (p.photos || []).length || (p.questions || []).length || (p.decided || []).length;
  const plain = `
      ${p.caption ? `<h4 class="block-title">キャプション</h4><p class="caption-text">${esc(p.caption)}</p>` : ''}
      ${p.hashtags ? `<p class="caption-text muted">${esc(p.hashtags)}</p>` : ''}`;
  return `
    <div class="record-body">
      ${p.permalink ? `<a class="ig-link" href="${esc(p.permalink)}" target="_blank" rel="noopener">Instagramで見る ↗</a>` : ''}
      ${hasReview ? renderReview(p) : plain}
      <h4 class="block-title">メモ</h4>
      ${note}
    </div>`;
}

// ---- 確認：AIが出した案と「決めること」に、人が答える ----
// 答えを送ると review_state が answered になり、見張り役（PC）がAIを起こして案を直す

const REVIEW_LABEL = {
  asking: '答え待ち',
  answered: '答えを送りました。AIが直すのを待っています（15分おきに確認）',
  working: 'AIが直しています',
};

// 選びかけの答え（送るまで画面の中だけに持つ）
function reviewDraft(p) {
  if (records.draft?.id !== p.id) {
    records.draft = { id: p.id, answers: JSON.parse(JSON.stringify(p.answers || {})), note: p.answer_note || '' };
  }
  return records.draft;
}

function renderReview(p) {
  const photos = (p.photos || []).map((path, i) =>
    `<img class="review-photo" data-preview="${esc(path)}" alt="${i + 1}枚目">`).join('');
  const caption = [p.caption, p.hashtags].filter(Boolean).join('\n\n');
  const decided = (p.decided || []).map(d => `<li>${esc(d)}</li>`).join('');
  const editable = p.review_state === 'asking';
  const d = reviewDraft(p);
  const qs = (p.questions || []).map((q, n) => renderQuestion(q, n, d.answers[q.id], editable)).join('');
  const revised = p.revised_at ? `<span>AIが直した時刻 ${fmt(p.revised_at)}</span>` : '';
  const banner = p.review_state
    ? `<div class="review-state ${p.review_state}">${esc(REVIEW_LABEL[p.review_state])}${revised}</div>`
    : (p.revised_at ? `<div class="review-state">決めることはありません${revised}</div>` : '');
  return `
    ${banner}
    <div class="review">
      <section class="review-post" aria-label="投稿の見え方">
        ${photos ? `<div class="review-photos">${photos}</div>` : '<p class="muted small">画像はまだありません</p>'}
        <p class="caption-text review-caption">${caption ? esc(caption) : '<span class="muted">キャプションはまだありません</span>'}</p>
      </section>
      <section class="review-side">
        ${decided ? `<div class="review-decided"><h4 class="block-title">決まったこと</h4><ul>${decided}</ul></div>` : ''}
        ${qs ? `<h4 class="block-title">決めること</h4>${qs}` : ''}
        ${p.review_state ? `
          <label class="review-note">選択肢にないこと（メモ）
            <textarea data-q-note rows="3" ${editable ? '' : 'disabled'} placeholder="追加したいこと、変えたいことなど">${esc(d.note)}</textarea>
          </label>` : ''}
        <div class="form-actions review-actions">
          <button class="btn small" data-act="rc-reload">読み直す</button>
          ${editable ? '<button class="btn primary" data-act="rc-send">答えを送る</button>' : ''}
          ${p.status === 'draft' ? `<button class="btn ${records.armedApprove === p.id ? 'armed' : ''}" data-act="rc-approve">${records.armedApprove === p.id ? 'もう一度で確認済み' : '確認済みにする'}</button>` : ''}
        </div>
      </section>
    </div>`;
}

function renderQuestion(q, n, ans, editable) {
  const dis = editable ? '' : 'disabled';
  let body = '';
  if (q.kind === 'text') {
    body = `<textarea data-q="${esc(q.id)}" data-kind="text" rows="2" ${dis}>${esc(ans || '')}</textarea>`;
  } else {
    const multi = q.kind === 'multi';
    const picked = multi ? (Array.isArray(ans) ? ans : []) : ans;
    body = `<div class="${multi ? 'q-tags' : 'q-opts'}">${(q.options || []).map(o => {
      const on = multi ? picked.includes(o.key) : picked === o.key;
      return `<label class="${multi ? 'q-tag' : 'q-opt'}">
        <input type="${multi ? 'checkbox' : 'radio'}" name="q-${esc(q.id)}" data-q="${esc(q.id)}" data-kind="${q.kind}" value="${esc(o.key)}" ${on ? 'checked' : ''} ${dis}>
        <span>${multi ? '' : `<b>${esc(o.key)}</b>`}${esc(o.label)}${o.detail ? `<small>${esc(o.detail)}</small>` : ''}</span>
      </label>`;
    }).join('')}</div>`;
  }
  return `
    <div class="question">
      <h5><span class="q-n">${n + 1}</span>${esc(q.title)}</h5>
      ${q.why ? `<p class="muted small">${esc(q.why)}</p>` : ''}
      ${body}
    </div>`;
}

// 選んだ・書いたものを、送るまで records.draft に持つ（描き直しても消えないように）
function onReviewInput(e) {
  const t = e.target;
  if (!records.draft) return;
  if (t.matches('[data-q-note]')) { records.draft.note = t.value; return; }
  const id = t.dataset.q;
  if (!id) return;
  if (t.dataset.kind === 'multi') {
    const cur = new Set(records.draft.answers[id] || []);
    t.checked ? cur.add(t.value) : cur.delete(t.value);
    records.draft.answers[id] = [...cur];
  } else {
    records.draft.answers[id] = t.value;
  }
}
$('app').addEventListener('change', onReviewInput);
$('app').addEventListener('input', onReviewInput);

async function sendAnswers() {
  const d = records.draft;
  const updated = check(await db.from('posts')
    .update({ answers: d.answers, answer_note: d.note || null, review_state: 'answered', answered_at: new Date().toISOString() })
    .eq('id', d.id).eq('review_state', 'asking').select('*').single());
  replacePost(updated);
  records.draft = null;
}

async function approvePost(id) {
  const updated = check(await db.from('posts')
    .update({ status: 'approved', approved_by: state.me, approved_at: new Date().toISOString() })
    .eq('id', id).select('*').single());
  replacePost(updated);
}

async function saveRecordNote(form) {
  const notes = new FormData(form).get('notes');
  const updated = check(await db.from('posts').update({ notes }).eq('id', records.open).select('*').single());
  replacePost(updated);
  records.editingNote = false;
}

Object.assign(ACTIONS, {
  'rc-filter': t => { records.filter = t.dataset.v; },
  'rc-open': t => { records.open = records.open === t.dataset.id ? null : t.dataset.id; records.editingNote = false; records.draft = null; records.armedApprove = null; },
  'rc-send': async () => { await sendAnswers(); },
  'rc-reload': async () => { records.draft = null; await loadPosts(); },
  'rc-approve': async () => {
    if (records.armedApprove !== records.open) { records.armedApprove = records.open; return; }
    records.armedApprove = null; await approvePost(records.open);
  },
  'rc-note-edit': () => { records.editingNote = true; },
  'rc-note-cancel': () => { records.editingNote = false; },
});
