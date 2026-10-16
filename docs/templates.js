// カルーセル・ストーリーズ画像の型。<canvas> に写真と文字を描いてJPEGにする
// 使い方：await Templates.draw(canvas, { template, format, image, text, sub })
//   template … 'photo' | 'margin' | 'text'
//   format   … 'feed'（1080×1350）| 'story'（1080×1920）
//   image    … HTMLImageElement（なければ灰色の面）
//   text     … メインの文字（一言など）
//   sub      … 小さな添え書き（アカウント名など）

(function () {
  const SIZES = { feed: [1080, 1350], story: [1080, 1920] };
  const MINCHO = '"Shippori Mincho"';
  const SANS = '"Noto Sans JP"';
  const INK = '#1c1b19';
  const PAPER = '#fbfaf7';
  const MUTED = '#8a877f';

  const TEMPLATES = [
    { id: 'photo', name: '写真全面＋一言' },
    { id: 'margin', name: '余白＋写真＋一言' },
    { id: 'text', name: '文字だけ' },
  ];

  // 行頭に来てはいけない文字（句読点など）
  const NO_HEAD = '、。，．・：；？！ー」』）】〉》〕ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ';

  // 日本語を1文字ずつ詰めて、幅に収まるように改行する
  function wrap(ctx, text, maxWidth) {
    const lines = [];
    for (const para of String(text || '').split('\n')) {
      let line = '';
      for (const ch of para) {
        const next = line + ch;
        if (ctx.measureText(next).width > maxWidth && line) {
          if (NO_HEAD.includes(ch)) { line = next; continue; }
          lines.push(line);
          line = ch;
        } else {
          line = next;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  // 写真を枠いっぱいに切り抜いて描く
  function cover(ctx, img, x, y, w, h) {
    if (!img) {
      ctx.fillStyle = '#d9d6cf';
      ctx.fillRect(x, y, w, h);
      return;
    }
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / s, sh = h / s;
    const sx = (img.naturalWidth - sw) / 2, sy = (img.naturalHeight - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  function drawLines(ctx, lines, x, y, lineHeight) {
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  }

  async function ready() {
    await Promise.all([
      document.fonts.load(`700 64px ${MINCHO}`),
      document.fonts.load(`400 28px ${SANS}`),
    ]);
  }

  const draw = {
    // 写真を全面に敷き、下に向かって暗くして白い文字を載せる
    photo(ctx, W, H, { image, text, sub }) {
      cover(ctx, image, 0, 0, W, H);
      const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,.62)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      const pad = 88;
      ctx.fillStyle = '#fff';
      ctx.font = `700 64px ${MINCHO}`;
      const lines = wrap(ctx, text, W - pad * 2);
      const lh = 64 * 1.6;
      const bottom = H - pad - (sub ? 64 : 0);
      drawLines(ctx, lines, pad, bottom - (lines.length - 1) * lh, lh);
      if (sub) {
        ctx.font = `400 28px ${SANS}`;
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.fillText(sub, pad, H - pad);
      }
    },

    // 紙色の地に、余白をとって写真を置き、下に墨色の文字
    margin(ctx, W, H, { image, text, sub }) {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, W, H);
      const pad = 88;
      const photoH = Math.round((W - pad * 2) * (H > 1500 ? 1.25 : 0.8));
      cover(ctx, image, pad, pad, W - pad * 2, photoH);

      ctx.fillStyle = INK;
      ctx.font = `700 56px ${MINCHO}`;
      const lines = wrap(ctx, text, W - pad * 2);
      drawLines(ctx, lines, pad, pad + photoH + 120, 56 * 1.6);
      if (sub) {
        ctx.font = `400 26px ${SANS}`;
        ctx.fillStyle = MUTED;
        ctx.fillText(sub, pad, H - pad);
      }
    },

    // 写真を使わず、紙色の地の中央に大きな文字
    text(ctx, W, H, { text, sub }) {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, W, H);
      const pad = 120;
      ctx.fillStyle = INK;
      ctx.font = `700 72px ${MINCHO}`;
      ctx.textAlign = 'center';
      const lines = wrap(ctx, text, W - pad * 2);
      const lh = 72 * 1.7;
      drawLines(ctx, lines, W / 2, H / 2 - ((lines.length - 1) * lh) / 2 + 24, lh);
      if (sub) {
        ctx.font = `400 26px ${SANS}`;
        ctx.fillStyle = MUTED;
        ctx.fillText(sub, W / 2, H - pad);
      }
      ctx.textAlign = 'left';
    },
  };

  window.Templates = {
    list: TEMPLATES,
    sizes: SIZES,
    async draw(canvas, opts) {
      await ready();
      const [W, H] = SIZES[opts.format || 'feed'];
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.textBaseline = 'alphabetic';
      draw[opts.template](ctx, W, H, opts);
    },
    // 投稿用のJPEGを作る
    toJpeg(canvas) {
      return new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
    },
  };
})();
