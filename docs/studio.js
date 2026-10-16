// 作る：チャットでAIに頼み、下書きカードで確認・手直しする（Manusの流れを参考）
// 左：チャット（写真の添付・指示）　右：下書き（ページ・キャプション）

const studio = {
  post: null,      // 編集中の投稿（state.posts の1件を複製したもの）
  selected: 0,     // 選んでいるページ
  sending: false,  // AIの返事待ち
  uploading: false,
  dirty: false,    // 手で直して、まだ保存していない
  saved: '',       // 「保存しました」などの表示
  armedSlide: false,
};

const SIZE_LABEL = { s: '小', m: '中', l: '大' };
const ALIGN_LABEL = { top: '上', middle: '中', bottom: '下' };

function openStudio(post) {
  studio.post = structuredClone(post);
  studio.selected = 0;
  studio.dirty = false;
  studio.saved = '';
  studio.armedSlide = false;
}

// ---- 描画 ----

function renderStudio() {
  const drafts = state.posts.filter(p => p.status === 'draft');
  const chips = drafts.map(p => `
    <button class="chip ${studio.post?.id === p.id ? 'active' : ''}" data-act="st-open" data-id="${p.id}">
      ${esc(p.title || '無題の下書き')}<small>${fmt(p.created_at)}</small>
    </button>`).join('');

  const top = `
    <div class="section-head">
      <h2 class="section-title">作る</h2>
      <button class="btn primary" data-act="st-new">新しい投稿</button>
    </div>
    ${drafts.length ? `<div class="chips">${chips}</div>` : ''}`;

  if (!studio.post) {
    return top + `<div class="placeholder">「新しい投稿」から始めます。<br>写真と文字を添えて、チャットでAIに頼んでください。</div>`;
  }
  return top + `<div class="studio">${renderChat()}${renderDraft()}</div>`;
}

function renderChat() {
  const p = studio.post;
  const log = p.chat.map(m => `<div class="bubble ${m.role === 'user' ? 'me' : 'ai'}">${esc(m.text)}</div>`).join('');
  const thinking = studio.sending ? '<div class="bubble ai thinking">考えています…</div>' : '';
  const empty = !p.chat.length && !studio.sending
    ? '<p class="hint">写真を添えて、作りたい投稿を伝えてください。<br>例：「この3枚で、カルーセルを5ページ。世界観が伝わるように」</p>' : '';
  const thumbs = p.photos.map((path, i) => `
    <figure class="thumb"><img data-photo="${esc(path)}" alt=""><figcaption>写真${i}</figcaption></figure>`).join('');
  return `
    <section class="chat panel">
      <div class="chat-log" id="chat-log">${empty}${log}${thinking}</div>
      <div class="photo-tray">
        ${thumbs}
        <label class="add-photo ${studio.uploading ? 'busy' : ''}">
          <input type="file" accept="image/*" multiple data-st="upload" ${studio.uploading ? 'disabled' : ''}>
          <span>${studio.uploading ? '追加中…' : '＋ 写真'}</span>
        </label>
      </div>
      <form class="chat-form" data-form="st-send">
        <textarea name="message" rows="3" placeholder="AIへの指示・直してほしいこと" ${studio.sending ? 'disabled' : ''}></textarea>
        <button class="btn primary" type="submit" ${studio.sending ? 'disabled' : ''}>送る</button>
      </form>
    </section>`;
}

function renderDraft() {
  const p = studio.post;
  const format = ['carousel', 'story'].map(f =>
    `<button class="${p.format === f ? 'active' : ''}" data-act="st-format" data-v="${f}">${f === 'carousel' ? 'カルーセル' : 'ストーリーズ'}</button>`).join('');
  const max = p.format === 'story' ? 3 : 10;

  const strip = p.slides.map((_, i) => `
    <button class="slide-thumb ${i === studio.selected ? 'active' : ''}" data-act="st-select" data-i="${i}">
      <canvas data-post="studio" data-slide="${i}"></canvas><span>${i + 1}</span>
    </button>`).join('');

  const s = p.slides[studio.selected];
  const tpl = s && Templates.list.find(t => t.id === s.template);
  const editor = s ? `
    <div class="slide-editor">
      <canvas class="slide-big" data-post="studio" data-slide="${studio.selected}"></canvas>
      <div class="slide-controls">
        <label>${studio.selected + 1}ページ目の文字<textarea data-st="text" rows="4">${esc(s.text)}</textarea></label>
        <div class="control-row">
          <span class="control-label">大きさ</span>
          <div class="seg">${['s', 'm', 'l'].map(v => `<button class="${s.size === v ? 'active' : ''}" data-act="st-size" data-v="${v}">${SIZE_LABEL[v]}</button>`).join('')}</div>
        </div>
        ${tpl?.usesAlign ? `
        <div class="control-row">
          <span class="control-label">位置</span>
          <div class="seg">${['top', 'middle', 'bottom'].map(v => `<button class="${s.align === v ? 'active' : ''}" data-act="st-align" data-v="${v}">${ALIGN_LABEL[v]}</button>`).join('')}</div>
        </div>` : ''}
        <div class="control-row">
          <span class="control-label">並び</span>
          <div class="seg">
            <button data-act="st-move" data-d="-1" ${studio.selected === 0 ? 'disabled' : ''}>← 前へ</button>
            <button data-act="st-move" data-d="1" ${studio.selected === p.slides.length - 1 ? 'disabled' : ''}>後ろへ →</button>
          </div>
          <button class="btn small danger ${studio.armedSlide ? 'armed' : ''}" data-act="st-del-slide">${studio.armedSlide ? 'もう一度で削除' : 'このページを削除'}</button>
        </div>
        <p class="muted small">型（${esc(tpl?.name || '')}）や写真を変えたいときは、チャットで頼んでください。</p>
      </div>
    </div>` : '<p class="hint">AIに頼むと、ここに下書きが出ます。</p>';

  const options = p.caption_options.map((c, i) => `
    <button class="option" data-act="st-pick" data-i="${i}">案${i + 1}：${esc(c.length > 60 ? c.slice(0, 60) + '…' : c)}</button>`).join('');

  return `
    <section class="draft panel">
      <div class="draft-head">
        <input class="title-input" data-st="title" value="${esc(p.title || '')}" placeholder="題名（一覧で見分けるため）">
        <div class="seg">${format}</div>
      </div>
      <div class="slide-strip">
        ${strip}
        ${p.slides.length < max ? '<button class="slide-add" data-act="st-add-slide">＋<br>ページ</button>' : ''}
      </div>
      ${editor}
      <div class="caption-block">
        <h3 class="block-title">キャプション</h3>
        ${options ? `<div class="options">${options}</div>` : ''}
        <textarea data-st="caption" rows="6" placeholder="キャプション">${esc(p.caption || '')}</textarea>
        <input data-st="hashtags" value="${esc(p.hashtags || '')}" placeholder="#ハッシュタグ">
      </div>
      <div class="draft-foot">
        <span class="muted small" id="st-saved">${esc(studio.saved)}</span>
        <button class="btn primary" data-act="st-save" ${studio.dirty ? '' : 'disabled'}>保存する</button>
      </div>
    </section>`;
}

// 描いたあとに、写真のサムネイルとチャットの位置を整える
function afterStudioRender() {
  if (!studio.post) return;
  const imgs = document.querySelectorAll('img[data-photo]');
  if (imgs.length) {
    photoUrls(studio.post.photos).then(urls => {
      imgs.forEach(img => { img.src = urls[studio.post.photos.indexOf(img.dataset.photo)]; });
    }).catch(() => {});
  }
  const log = document.getElementById('chat-log');
  if (log) log.scrollTop = log.scrollHeight;
}

// ---- 保存 ----

function markDirty() {
  studio.dirty = true;
  studio.saved = '保存していない変更があります';
  const btn = document.querySelector('[data-act="st-save"]');
  if (btn) btn.disabled = false;
  const msg = document.getElementById('st-saved');
  if (msg) msg.textContent = studio.saved;
}

async function studioSave() {
  const p = studio.post;
  const updated = check(await db.from('posts').update({
    title: p.title, format: p.format, slides: p.slides, caption: p.caption, hashtags: p.hashtags,
  }).eq('id', p.id).select('*').single());
  await logPost(p.id, 'edited');
  studio.dirty = false;
  studio.saved = `保存しました（${fmt(new Date())}）`;
  replacePost(updated);
}

// state.posts の1件を差し替える（作者などの表示用の情報は残す）
function replacePost(updated) {
  const i = state.posts.findIndex(x => x.id === updated.id);
  if (i >= 0) state.posts[i] = { ...state.posts[i], ...updated };
}

// ---- 入力（打つたびにその場で反映。全体は描き直さない） ----

let redrawTimer = null;
function redrawSelected() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => {
    document.querySelectorAll(`canvas[data-post="studio"][data-slide="${studio.selected}"]`)
      .forEach(c => drawSlide(c, studio.post, studio.selected));
  }, 120);
}

function studioInput(el) {
  const p = studio.post;
  const key = el.dataset.st;
  if (key === 'text') {
    p.slides[studio.selected].text = el.value;
    redrawSelected();
  } else if (key === 'title' || key === 'caption' || key === 'hashtags') {
    p[key] = el.value;
  }
  markDirty();
}

// ---- 写真の追加：ブラウザで縮めてから、非公開の置き場所へ ----

function shrink(file, maxSide = 1440) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(resolve, 'image/jpeg', 0.88);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function studioUpload(input) {
  const files = [...input.files];
  if (!files.length) return;
  studio.uploading = true;
  render();
  try {
    const p = studio.post;
    for (const f of files) {
      const blob = await shrink(f);
      const path = `${state.account}/${crypto.randomUUID()}.jpg`;
      check(await db.storage.from('media').upload(path, blob, { contentType: 'image/jpeg' }));
      p.photos.push(path);
    }
    const updated = check(await db.from('posts').update({ photos: p.photos }).eq('id', p.id).select('*').single());
    replacePost(updated);
  } catch (e) { state.error = `写真を追加できませんでした：${e.message}`; }
  studio.uploading = false;
  render();
}

// ---- AIに頼む ----

async function studioSend(form) {
  const message = new FormData(form).get('message').trim();
  if (!message || studio.sending) return;
  state.error = '';
  try {
    if (studio.dirty) await studioSave(); // 手で直した分をAIに渡すため、先に保存する
    studio.post.chat = [...studio.post.chat, { role: 'user', text: message }];
    studio.sending = true;
    render();
    const { data, error } = await db.functions.invoke('studio-ai', { body: { post_id: studio.post.id, message } });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch { /* 本文が読めないときはそのまま */ }
      throw new Error(msg);
    }
    replacePost(data.post);
    const keep = studio.selected;
    openStudio(data.post);
    studio.selected = Math.min(keep, Math.max(0, data.post.slides.length - 1));
  } catch (e) {
    state.error = `AIに頼めませんでした：${e.message}`;
    studio.post.chat = studio.post.chat.slice(0, -1);
  }
  studio.sending = false;
  render();
}

// ---- ボタン ----

Object.assign(ACTIONS, {
  'st-new': async () => {
    const post = check(await db.from('posts').insert({ account_id: state.account }).select('*').single());
    await logPost(post.id, 'created');
    state.posts.unshift(post);
    openStudio(post);
  },
  'st-open': async t => {
    if (studio.dirty && studio.post) await studioSave();
    openStudio(state.posts.find(p => p.id === t.dataset.id));
  },
  'st-select': t => { studio.selected = Number(t.dataset.i); studio.armedSlide = false; },
  'st-format': t => {
    studio.post.format = t.dataset.v;
    if (t.dataset.v === 'story') studio.post.slides = studio.post.slides.slice(0, 3);
    studio.selected = Math.min(studio.selected, Math.max(0, studio.post.slides.length - 1));
    markDirty();
  },
  'st-size': t => { studio.post.slides[studio.selected].size = t.dataset.v; markDirty(); },
  'st-align': t => { studio.post.slides[studio.selected].align = t.dataset.v; markDirty(); },
  'st-move': t => {
    const s = studio.post.slides, i = studio.selected, j = i + Number(t.dataset.d);
    [s[i], s[j]] = [s[j], s[i]];
    studio.selected = j;
    markDirty();
  },
  'st-add-slide': () => {
    studio.post.slides.splice(studio.selected + 1, 0, { template: 'text', text: '', photo: -1, size: 'm', align: 'middle' });
    studio.selected = studio.post.slides.length === 1 ? 0 : studio.selected + 1;
    markDirty();
  },
  'st-del-slide': () => {
    if (!studio.armedSlide) { studio.armedSlide = true; return; }
    studio.armedSlide = false;
    studio.post.slides.splice(studio.selected, 1);
    studio.selected = Math.max(0, studio.selected - 1);
    markDirty();
  },
  'st-pick': t => {
    studio.post.caption = studio.post.caption_options[Number(t.dataset.i)];
    markDirty();
  },
  'st-save': () => studioSave(),
});
