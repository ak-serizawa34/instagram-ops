// ホーム：運用の流れと、AI（Manus・Claude Code）の使い分け。頼み方の例はコピーして使える
// 中身は選んでいるアカウントに合わせて変わる（アカウント名・フォーマット名）

const guide = { copied: null };

function guideSteps(a) {
  const fA = formatDocs()[0]?.title || 'フォーマット';
  return [
    {
      title: '設計する', who: 'アプリ',
      text: '世界観・概要欄・戦略・フォーマットを「戦略」に置く。ここが正本で、直すたびに履歴が残る。',
      link: { label: '戦略を開く', act: 'gd-view', view: 'strategy' },
    },
    {
      title: '頼む', who: 'Manus',
      text: `Manusの「${a.label}」プロジェクトで、フォーマットと素材を伝える。Manusは先にInsta Studioの設計を読んでから作る。`,
      link: { label: 'Manusを開く', href: state.settings?.manus_url || MANUS_HOME },
    },
    {
      title: 'Canvaで仕上げる', who: 'Manus・Canva',
      text: `「${fA}」などのテンプレートをManusが複製し、文字と写真を差し替える。細かいところはCanvaで直す。`,
      link: null,
    },
    {
      title: '確認して公開', who: 'Manus',
      text: '公開の前に、Manusが必ず下書きを見せる。確認して公開すると、「投稿の記録」に自動で残る。',
      link: { label: '投稿の記録を見る', act: 'gd-view', view: 'records' },
    },
    {
      title: '振り返る', who: 'Manus・Claude Code',
      text: '数字を見て次の案を出してもらう。決まったことは「保存して」と言えば、戦略に履歴つきで残る。',
      link: null,
    },
  ];
}

function guideAI(a) {
  const fA = formatDocs()[0]?.title || 'フォーマットA';
  return [
    {
      name: 'Manus', role: '日々の運用', where: 'ブラウザ・スマホ',
      does: ['投稿の下書きを作る（Canvaで画像も）', 'Instagramに公開する', '数字を見て振り返る', '決まったことを戦略に保存する'],
      prompts: [
        `${fA}で下書きを作って。素材：（エピソードのタイトル・要点・写真など）`,
        '先週の投稿の数字を見て、良かった点と次の投稿の案を3つ出して',
        'このbioに決めた。Insta Studioの概要欄に保存して',
      ],
    },
    {
      name: 'Claude Code', role: '設計づくり・まとめ作業', where: '芹澤さんのPC',
      does: ['ベンチマークを登録する（アイコンも）', '資料から設計を写す・見直す', 'Canvaのテンプレートを作る', 'このアプリを直す'],
      prompts: [
        `${a.label}のベンチマークに @（ハンドル） を追加して`,
        `${a.label}のフォーマットのCanvaテンプレートを作って`,
        `${a.label}の戦略を、最新の資料から見直して`,
      ],
    },
  ];
}

function renderGuide() {
  const a = account();
  const steps = guideSteps(a).map((s, i) => `
    <li class="step">
      <span class="step-no">${i + 1}</span>
      <div class="step-body">
        <div class="step-head"><strong>${esc(s.title)}</strong><span class="step-who">${esc(s.who)}</span></div>
        <p>${esc(s.text)}</p>
        ${s.link ? (s.link.href
          ? `<a class="step-link" href="${esc(s.link.href)}" target="_blank" rel="noopener">${esc(s.link.label)} ↗</a>`
          : `<button class="step-link" data-act="${s.link.act}" data-v="${s.link.view}">${esc(s.link.label)} →</button>`) : ''}
      </div>
    </li>`).join('');

  const ai = guideAI(a).map((c, ci) => `
    <article class="ai-card">
      <div class="ai-head">
        <h3>${esc(c.name)}</h3>
        <span class="muted small">${esc(c.role)}・${esc(c.where)}</span>
      </div>
      <ul class="ai-does">${c.does.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
      <div class="ai-prompts">
        <span class="nav-label">頼み方の例</span>
        ${c.prompts.map((p, pi) => {
          const key = `${ci}-${pi}`;
          return `<button class="prompt" data-act="gd-copy" data-key="${key}" data-text="${esc(p)}">
            <span>${esc(p)}</span><em>${guide.copied === key ? 'コピーしました' : 'コピー'}</em></button>`;
        }).join('')}
      </div>
    </article>`).join('');

  return `
    <div class="guide-hero">
      <p class="guide-lead">Instagram運用の<strong>設計</strong>と<strong>記録</strong>を置く場所。<br>作る・公開する・振り返るは、AIに頼む。</p>
    </div>

    <section class="guide-section">
      <h2 class="section-title">運用の流れ</h2>
      <ol class="steps">${steps}</ol>
    </section>

    <section class="guide-section">
      <h2 class="section-title">AIの使い分け</h2>
      <p class="muted small">どちらも同じ「Insta Studio」の設計を読み、決まったことや記録をここに残す。どちらで作業しても、情報は1か所にたまる。</p>
      <div class="ai-grid">${ai}</div>
    </section>

    <section class="guide-section">
      <h2 class="section-title">このアプリでできること</h2>
      <div class="roles">
        <button class="role" data-act="gd-view" data-v="strategy"><strong>戦略</strong><span>設計の正本。世界観・概要欄・戦略・フォーマット（Canvaテンプレートの見本つき）。履歴が残る</span></button>
        <button class="role" data-act="gd-view" data-v="records"><strong>投稿の記録</strong><span>Manusで作った・公開した投稿。反応や気づきのメモを書ける</span></button>
        <button class="role" data-act="gd-view" data-v="bench"><strong>ベンチマーク</strong><span>参考にするアカウント。追加はClaude Codeに頼むと、確認からアイコンまで済む</span></button>
        <div class="role static"><strong>資料</strong><span>収録台本・音声データなどの置き場所。アカウント名の下から開く</span></div>
      </div>
    </section>`;
}

Object.assign(ACTIONS, {
  'gd-view': t => { state.view = t.dataset.v; },
  'gd-copy': async t => {
    await navigator.clipboard.writeText(t.dataset.text);
    guide.copied = t.dataset.key;
  },
});
