import { useRef, useState } from 'react';
import jsQR from 'jsqr';
import { decodeBuilderDeckUrl } from '../utils/acgDeckQr';

/**
 * acg-builder QR を画像ファイルから読み込むボタン。
 * 画像ファイル選択 → QR 復号 → デッキ復元 → `onDeckImported(deck)` を呼ぶ。
 *
 * 返るデッキ形式（minimal）:
 *   {
 *     name: string,
 *     cards: [{id,count}],
 *     tokenDeck: [{id,count}],
 *     sideDeck: [{id,count}],
 *   }
 */
export default function DeckQrImportButton({ onDeckImported, label = 'QR画像で読込', style }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;

    setBusy(true);
    try {
      const bitmap = await readImageBitmap(file);
      const { data, width, height } = bitmapToImageData(bitmap);
      const qr = jsQR(data, width, height);
      if (!qr) {
        alert('QR コードを検出できませんでした');
        return;
      }
      let decoded;
      try {
        decoded = decodeBuilderDeckUrl(qr.data);
      } catch (err) {
        alert(`QR の中身を解析できませんでした: ${err.message || err}`);
        return;
      }
      const fallbackName = `インポートデッキ ${new Date().toLocaleString('ja-JP')}`;
      const name = (decoded.name && decoded.name.trim()) ? decoded.name.trim() : fallbackName;
      const deck = {
        name,
        cards: decoded.mainCards,
        tokenDeck: decoded.tokenCards,
        sideDeck: decoded.sideCards,
      };
      if (decoded.unknownBuilderIds.length > 0) {
        alert(`デッキを読み込みましたが、acg-react に存在しないカードが ${decoded.unknownBuilderIds.length} 枚あり除外されました。\n（builder ID: ${decoded.unknownBuilderIds.slice(0, 10).join(', ')}${decoded.unknownBuilderIds.length > 10 ? '…' : ''}）`);
      }
      onDeckImported(deck);
    } catch (err) {
      alert(`画像の読み込みに失敗しました: ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const defaultStyle = {
    background: '#7b1fa2',
    color: '#fff',
    borderRadius: 6,
    padding: '0.4em 1em',
    fontWeight: 'bold',
    cursor: busy ? 'wait' : 'pointer',
    border: 'none',
    display: 'inline-block',
  };

  return (
    <label style={{ ...defaultStyle, ...(style || {}) }}>
      {busy ? '読み込み中…' : label}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFile}
        disabled={busy}
      />
    </label>
  );
}

// ─────────────────────────────────────────────────────────────
// 画像 → ImageData
// ─────────────────────────────────────────────────────────────
async function readImageBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    return await createImageBitmap(file);
  }
  // Safari 等の fallback
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function bitmapToImageData(bitmap) {
  const width = bitmap.width || bitmap.naturalWidth;
  const height = bitmap.height || bitmap.naturalHeight;
  // QR を確実に拾うため、極端に大きい画像はダウンスケール（jsQR は ~1024px 程度で十分）
  const MAX = 1024;
  let w = width, h = height;
  if (Math.max(w, h) > MAX) {
    const scale = MAX / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
