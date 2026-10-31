import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { encodeDeckToBuilderUrl } from '../utils/acgDeckQr';
import '../styles/modal.css';

/**
 * acg-builder 互換の QR を生成して表示するモーダル。
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} props.deckName
 * @param {Array|Object} props.mainCards
 * @param {Array|Object} [props.tokenCards]
 * @param {Array|Object} [props.sideCards]
 * @param {Function} props.onClose
 */
export default function DeckQrExportModal({ open, deckName, mainCards, tokenCards, sideCards, onClose }) {
  const canvasRef = useRef(null);
  const [url, setUrl] = useState('');
  const [unknownIds, setUnknownIds] = useState([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setCopied(false);
    try {
      const enc = encodeDeckToBuilderUrl({
        name: deckName,
        mainCards,
        tokenCards,
        sideCards,
      });
      setUrl(enc.url);
      setUnknownIds(enc.unknownIds);
    } catch (e) {
      setError(`QR 生成に失敗しました: ${e.message || e}`);
      setUrl('');
      setUnknownIds([]);
    }
  }, [open, deckName, mainCards, tokenCards, sideCards]);

  useEffect(() => {
    if (!open || !url || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, { width: 280, margin: 2, errorCorrectionLevel: 'M' }, (err) => {
      if (err) setError(`QR 描画に失敗しました: ${err.message || err}`);
    });
  }, [open, url]);

  if (!open) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('URL をコピーしてください', url);
    }
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const safeName = (deckName || 'deck').replace(/[\\/:*?"<>|]/g, '_');
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${safeName}-acgbuilder-qr.png`;
    a.click();
  };

  return (
    <div className="efm-overlay" onClick={onClose}>
      <div className="efm-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="efm-header">
          <h3>QRで書き出し</h3>
          <button className="efm-close" onClick={onClose}>閉じる</button>
        </div>
        <div className="efm-hint">
          acg-builder で開ける QR コードを生成します。画像保存または URL をコピーしてください。
        </div>

        {error && (
          <div style={{ color: '#d32f2f', margin: '0.6em 0', fontSize: '0.9em' }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', padding: '0.8em 0' }}>
          <canvas ref={canvasRef} style={{ background: '#fff', maxWidth: '100%' }} />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: '0.8em' }}>
          <button
            onClick={handleDownload}
            disabled={!url}
            style={{ background: '#388e3c', color: '#fff', border: 'none', borderRadius: 6, padding: '0.5em 1em', cursor: url ? 'pointer' : 'not-allowed', fontWeight: 'bold' }}
          >PNG を保存</button>
          <button
            onClick={handleCopy}
            disabled={!url}
            style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 6, padding: '0.5em 1em', cursor: url ? 'pointer' : 'not-allowed', fontWeight: 'bold' }}
          >{copied ? 'コピー済み' : 'URL をコピー'}</button>
        </div>

        <div style={{ fontSize: '0.75em', color: '#666', wordBreak: 'break-all', background: '#f5f5f5', padding: '0.5em', borderRadius: 4, maxHeight: '6em', overflowY: 'auto' }}>
          {url}
        </div>

        {unknownIds.length > 0 && (
          <div style={{ marginTop: '0.6em', fontSize: '0.85em', color: '#d57b00' }}>
            ※ acg-builder の ID にマップできなかったカードが {unknownIds.length} 枚あり、QR から除外されました。
            <br />（acg-react ID: {unknownIds.slice(0, 10).join(', ')}{unknownIds.length > 10 ? '…' : ''}）
          </div>
        )}
      </div>
    </div>
  );
}
