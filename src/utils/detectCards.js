/**
 * detectCards.js
 * 画像からカード矩形を自動検出する。
 *
 * 方針:
 *   ACG カードは印刷上の特徴として「閉じた黒枠」で囲まれている。
 *   黒ピクセルの連結成分を見つけ、その bbox が TCG アスペクト比 (約 0.716) と
 *   ring 形状の充填率を持てばカードと判定する。
 *
 * これは2つの入力に対応する:
 *   (1) 公式X 告知画像: 複数カードを色枠装飾と共に並べたもの。各カードの黒枠が個別の連結成分になる
 *   (2) 単独カード画像 (acgtcg.com 由来など): 白背景に1カードのみ。黒枠が単一の連結成分になる
 *
 * 色枠ベースの旧アプローチは (2) で機能しなかったため廃止。
 *
 * 包含チェック:
 *   カード内部の額縁/効果テキスト枠が偶発的に TCG アスペクトを満たすことがあるため、
 *   完全に他候補に内包される矩形は除外する。
 *
 * 色枠なし告知画像の対応:
 *   カード周囲に色付き装飾枠がある場合は枠が「非暗色の堀」となり、カード黒枠が孤立した
 *   連結成分になる。色枠がなく背景が暗い場合（山・空等の暗いイラスト）は、背景の暗色
 *   ピクセルがカード黒枠と連結して巨大成分になりアスペクト比フィルタで除外されてしまう。
 *   darknessThreshold を 60 に絞ることで印刷黒（max RGB ≈ 0〜30）と背景暗色（≈ 60〜90）
 *   を分離する。0件の場合は threshold 75 + 画像境界接触除外で再試行する。
 */

const MAX_WORK_DIM = 1200;

const DEFAULTS = {
  darknessThreshold: 60,      // V < これを「黒枠の黒」とみなす（印刷黒と背景暗色を分離）
  minAreaRatio: 0.02,         // 画像全体に対する最低面積比率
  aspectMin: 0.65,            // bbox アスペクト比下限 (TCG 0.716 を中心に若干の余裕)
  aspectMax: 0.78,            // 同上限
  fillMin: 0.08,              // 黒pixel数/bbox面積 の下限 (ring shape は通常 0.15-0.5)
  fillMax: 0.6,               // 同上限 (これを超えると単なる「黒い塊」)
  minSizeRelativeToMax: 0.25, // 複数検出時、最大に比べ極端に小さいものを除外
  excludeBorderTouching: false, // true のとき画像端に接する連結成分を除外（リトライ時に使用）
};

/**
 * @param {HTMLImageElement} img - 読込済みの Image 要素
 * @param {Object} [opts] - パラメータ上書き
 * @returns {Array<{x:number, y:number, w:number, h:number}>} 元画像座標のカード矩形
 */
export function detectCards(img, opts = {}) {
  const { _retried = false, ...publicOpts } = opts;
  const params = { ...DEFAULTS, ...publicOpts };

  // 1. ワーキングキャンバスに縮小描画
  const workScale = Math.min(MAX_WORK_DIM / img.width, MAX_WORK_DIM / img.height, 1);
  const w = Math.max(1, Math.round(img.width * workScale));
  const h = Math.max(1, Math.round(img.height * workScale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  // 2. 黒マスク
  const darkMask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const max = Math.max(r, g, b);
    darkMask[i] = (max < params.darknessThreshold) ? 1 : 0;
  }

  // 3. 連結成分 BFS (4近傍)
  const labels = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  let nextLabel = 0;
  const bboxes = [];

  for (let p0 = 0; p0 < w * h; p0++) {
    if (!darkMask[p0] || labels[p0]) continue;
    nextLabel++;
    labels[p0] = nextLabel;
    queue[0] = p0;
    let head = 0, tail = 1;
    const bb = { minX: p0 % w, maxX: p0 % w, minY: Math.floor(p0 / w), maxY: Math.floor(p0 / w), count: 0, touchesBorder: false };

    while (head < tail) {
      const p = queue[head++];
      const py = Math.floor(p / w);
      const px = p - py * w;
      bb.count++;
      if (px < bb.minX) bb.minX = px;
      if (px > bb.maxX) bb.maxX = px;
      if (py < bb.minY) bb.minY = py;
      if (py > bb.maxY) bb.maxY = py;
      if (px === 0 || px === w - 1 || py === 0 || py === h - 1) bb.touchesBorder = true;

      if (px > 0) {
        const np = p - 1;
        if (darkMask[np] && !labels[np]) { labels[np] = nextLabel; queue[tail++] = np; }
      }
      if (px < w - 1) {
        const np = p + 1;
        if (darkMask[np] && !labels[np]) { labels[np] = nextLabel; queue[tail++] = np; }
      }
      if (py > 0) {
        const np = p - w;
        if (darkMask[np] && !labels[np]) { labels[np] = nextLabel; queue[tail++] = np; }
      }
      if (py < h - 1) {
        const np = p + w;
        if (darkMask[np] && !labels[np]) { labels[np] = nextLabel; queue[tail++] = np; }
      }
    }
    bboxes.push(bb);
  }

  // 4. アスペクト比 + 面積 + 充填率でフィルタ
  const minArea = w * h * params.minAreaRatio;
  let candidates = [];
  for (const b of bboxes) {
    if (params.excludeBorderTouching && b.touchesBorder) continue;
    const bw = b.maxX - b.minX + 1;
    const bh = b.maxY - b.minY + 1;
    const area = bw * bh;
    if (area < minArea) continue;
    const ratio = bw / bh;
    if (ratio < params.aspectMin || ratio > params.aspectMax) continue;
    const fill = b.count / area;
    if (fill < params.fillMin || fill > params.fillMax) continue;
    candidates.push({ minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, bw, bh, area });
  }

  // 5. 包含チェック: 他候補に完全内包される矩形を除外
  //    (カード内部の額縁/効果テキスト枠が偶発的に TCG アスペクトを満たすケース)
  const notContained = candidates.filter(a => {
    return !candidates.some(b =>
      b !== a &&
      b.minX <= a.minX && b.maxX >= a.maxX &&
      b.minY <= a.minY && b.maxY >= a.maxY
    );
  });
  candidates = notContained;

  // 6. 相対サイズフィルタ: 最大検出に対し小さすぎるものを除外
  if (candidates.length >= 2) {
    const maxArea = Math.max(...candidates.map(c => c.area));
    const minAccept = maxArea * params.minSizeRelativeToMax;
    candidates = candidates.filter(c => c.area >= minAccept);
  }

  // 7. 元画像座標に変換 + ソート (左→右、上→下)
  const results = candidates.map(c => ({
    x: Math.round(c.minX / workScale),
    y: Math.round(c.minY / workScale),
    w: Math.round(c.bw / workScale),
    h: Math.round(c.bh / workScale),
  }));
  const yTolerance = (h * 0.05) / workScale;
  results.sort((a, b) => {
    if (Math.abs(a.y - b.y) > yTolerance) return a.y - b.y;
    return a.x - b.x;
  });

  // threshold 60 で 0件の場合、JPEG圧縮で枠ピクセルが明るくなっている画像向けに
  // threshold を 75 に緩めて再試行する。背景との再マージを防ぐため excludeBorderTouching を有効化。
  if (results.length === 0 && !_retried) {
    return detectCards(img, {
      ...publicOpts,
      darknessThreshold: 75,
      excludeBorderTouching: true,
      _retried: true,
    });
  }

  return results;
}
