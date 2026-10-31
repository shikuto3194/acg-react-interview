/**
 * AdminCardsPage.jsx
 * カード管理ページ (プレビュー取込)
 * - 公式X (@ACG_TCG) の告知画像から自動でカード矩形を検出してトリミング保存
 * - 入力経路: URL貼り付け / ファイル選択 / クリップボード貼り付け
 * - 検出アルゴリズムは src/utils/detectCards.js 参照
 *
 * 重要前提:
 *   告知画像のカード周囲にある「色枠」(緑/赤/青等) はレイアウト装飾でカード本体ではない。
 *   実際のカード端は色枠の内側の黒枠。detectCards.js はこの黒枠基準で切り出す。
 *   acgtcg.com の ACG-XXX.png と整合する切り口になるため、後段の reconciliation (pHash比較) で
 *   公式版と一致を判定できる。
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './useAuth';
import { supabase } from './supabaseClient';
import { useNavigate } from 'react-router-dom';
import { detectCards } from './utils/detectCards';
import { containerStyle, sectionTitle, btnPrimary, btnDanger, btnSecondary, btnSuccess, inputStyle } from './styles/commonStyles';

const pageCardStyle = { maxWidth: 960, margin: '0 auto', background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px #bbb', padding: '1.5em' };

const MAX_CANVAS_W = 880;
const MAX_CANVAS_H = 660;

export default function AdminCardsPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // 画像入力
  const [urlInput, setUrlInput] = useState('');
  const [loadingImage, setLoadingImage] = useState(false);
  const [sourceBlob, setSourceBlob] = useState(null);
  const [sourceType, setSourceType] = useState(null); // 'x_url' | 'x_upload' | 'x_paste'
  const [sourceUrl, setSourceUrl] = useState(null);

  // 検出結果 (元画像座標)
  // 各要素: { id, x, y, w, h, excluded:boolean, saved:boolean }
  const [detectedRects, setDetectedRects] = useState([]);
  const [detecting, setDetecting] = useState(false);
  const [savingBatch, setSavingBatch] = useState(false);

  // 既存 preview 一覧
  const [previewList, setPreviewList] = useState([]);
  const [loadingList, setLoadingList] = useState(false);

  // Canvas
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [imageDims, setImageDims] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);

  // 管理者チェック
  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/login'); return; }
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .single();
      if (error) {
        alert('プロフィール取得エラー: ' + error.message);
        navigate('/');
        setLoading(false);
        return;
      }
      if (data?.role === 'admin') setIsAdmin(true);
      else { alert('管理者権限がありません'); navigate('/'); }
      setLoading(false);
    })();
  }, [user, authLoading, navigate]);

  // 既存 preview 一覧取得
  const fetchPreviews = useCallback(async () => {
    setLoadingList(true);
    const { data, error } = await supabase
      .from('preview_cards')
      .select('id, tentative_card_number, display_label, permanent_image_url, status, source_type, created_at')
      .eq('game', 'acg')
      .neq('status', 'superseded')
      .order('created_at', { ascending: false });
    if (error) console.error('preview一覧取得失敗:', error);
    else setPreviewList(data || []);
    setLoadingList(false);
  }, []);

  useEffect(() => {
    if (isAdmin) fetchPreviews();
  }, [isAdmin, fetchPreviews]);

  // ソース画像をロード + 自動検出
  useEffect(() => {
    if (!sourceBlob) {
      imgRef.current = null;
      setImageDims({ w: 0, h: 0 });
      setDetectedRects([]);
      return;
    }
    const url = URL.createObjectURL(sourceBlob);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImageDims({ w: img.width, h: img.height });
      const s = Math.min(MAX_CANVAS_W / img.width, MAX_CANVAS_H / img.height, 1);
      setScale(s);
      // 検出実行
      setDetecting(true);
      // setTimeout で UI フリーズを最小化（実際は同期処理）
      setTimeout(() => {
        try {
          const rects = detectCards(img);
          setDetectedRects(rects.map((r, i) => ({
            id: `det-${Date.now()}-${i}`,
            ...r,
            excluded: false,
            saved: false,
          })));
        } catch (e) {
          console.error('検出失敗:', e);
          alert('検出処理でエラーが発生しました: ' + e.message);
          setDetectedRects([]);
        } finally {
          setDetecting(false);
        }
      }, 50);
    };
    img.onerror = () => {
      alert('画像の読み込みに失敗しました');
      setSourceBlob(null);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [sourceBlob]);

  // Canvas 描画 (検出矩形を重ね描き)
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imageDims.w) return;
    const ctx = canvas.getContext('2d');
    canvas.width = imageDims.w * scale;
    canvas.height = imageDims.h * scale;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    detectedRects.forEach((r, i) => {
      const color = r.saved ? '#9e9e9e' : r.excluded ? '#d32f2f' : '#2e7d32';
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.setLineDash(r.excluded ? [6, 4] : []);
      ctx.strokeRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
      ctx.setLineDash([]);

      // バッジ
      ctx.fillStyle = color;
      ctx.fillRect(r.x * scale, r.y * scale, 42, 22);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(`#${i + 1}`, r.x * scale + 4, r.y * scale + 16);
    });
  }, [detectedRects, scale, imageDims]);

  // 画像取得: URL
  const loadFromUrl = async () => {
    if (!urlInput.trim()) return;
    setLoadingImage(true);
    try {
      const res = await fetch(urlInput.trim());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) throw new Error('画像ではありません');
      setSourceBlob(blob);
      setSourceType('x_url');
      setSourceUrl(urlInput.trim());
    } catch (e) {
      alert('画像読み込み失敗: ' + e.message + '\n(CORS制限の場合はファイルアップロードを使ってください)');
    } finally {
      setLoadingImage(false);
    }
  };

  // 画像取得: ファイル
  const loadFromFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setSourceBlob(file);
    setSourceType('x_upload');
    setSourceUrl(null);
  };

  // 画像取得: クリップボード貼り付け
  useEffect(() => {
    const handler = (e) => {
      if (!isAdmin) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            setSourceBlob(blob);
            setSourceType('x_paste');
            setSourceUrl(null);
            e.preventDefault();
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [isAdmin]);

  // 矩形の除外切り替え
  const toggleExclude = (id) => {
    setDetectedRects(rs => rs.map(r => r.id === id ? { ...r, excluded: !r.excluded } : r));
  };

  // 1矩形をクロップ → アップロード
  const uploadOneRect = async (r) => {
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = Math.round(r.w);
    cropCanvas.height = Math.round(r.h);
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.drawImage(imgRef.current, r.x, r.y, r.w, r.h, 0, 0, cropCanvas.width, cropCanvas.height);
    const blob = await new Promise((resolve, reject) => {
      cropCanvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob失敗')), 'image/jpeg', 0.92);
    });

    const filename = `preview-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('preview-card-images')
      .upload(filename, blob, { contentType: 'image/jpeg' });
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('preview-card-images')
      .getPublicUrl(filename);

    const { error: insertError } = await supabase.from('preview_cards').insert({
      game: 'acg',
      source_type: sourceType,
      source_url: sourceUrl,
      permanent_image_url: publicUrl,
      status: 'pending',
      tentative_card_number: `PREVIEW-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      card_data: {},
    });
    if (insertError) throw insertError;
  };

  // 検出されたカードを一括保存（除外済みは飛ばす）
  const saveAllDetected = async () => {
    const targets = detectedRects.filter(r => !r.excluded && !r.saved);
    if (targets.length === 0) {
      alert('保存対象がありません');
      return;
    }
    setSavingBatch(true);
    let success = 0, failed = 0;
    for (const r of targets) {
      try {
        await uploadOneRect(r);
        setDetectedRects(rs => rs.map(x => x.id === r.id ? { ...x, saved: true } : x));
        success++;
      } catch (e) {
        console.error('保存失敗 rect:', r, e);
        failed++;
      }
    }
    setSavingBatch(false);
    fetchPreviews();
    if (failed > 0) alert(`保存完了: 成功 ${success} / 失敗 ${failed}`);
  };

  // ソース画像破棄
  const handleDiscardImage = () => {
    if (detectedRects.some(r => r.saved) || confirm('現在の画像を破棄しますか?')) {
      setSourceBlob(null);
      setSourceType(null);
      setSourceUrl(null);
      setUrlInput('');
      setDetectedRects([]);
    }
  };

  // preview 削除
  const handleDeletePreview = async (row) => {
    if (!confirm(`「${row.tentative_card_number || row.id}」を削除しますか?`)) return;
    try {
      const path = row.permanent_image_url.split('/preview-card-images/')[1];
      if (path) await supabase.storage.from('preview-card-images').remove([path]);
      const { error } = await supabase.from('preview_cards').delete().eq('id', row.id);
      if (error) throw error;
      fetchPreviews();
    } catch (e) {
      alert('削除失敗: ' + e.message);
    }
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={pageCardStyle}><p>読み込み中...</p></div>
      </div>
    );
  }
  if (!isAdmin) return null;

  const activeCount = detectedRects.filter(r => !r.excluded && !r.saved).length;
  const savedCount = detectedRects.filter(r => r.saved).length;

  return (
    <div style={containerStyle}>
      <div style={pageCardStyle}>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginBottom: 6 }}>
          <button onClick={() => navigate('/admin')} style={{ background: 'none', border: 'none', color: '#1976d2', cursor: 'pointer', fontSize: '0.9em' }}>運営メニュー</button>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#1976d2', cursor: 'pointer', fontSize: '0.9em' }}>トップ</button>
        </div>
        <h2 style={{ margin: '0 0 1em 0' }}>カード管理 (プレビュー取込)</h2>

        {/* --- 入力 --- */}
        <section style={{ marginBottom: '1.5em' }}>
          <h3 style={sectionTitle}>画像入力</h3>
          <p style={{ fontSize: '0.85em', color: '#666', margin: '0 0 0.8em 0' }}>
            公式X (<a href="https://x.com/ACG_TCG" target="_blank" rel="noopener noreferrer" style={{ color: '#1976d2' }}>@ACG_TCG</a>) の告知画像を読み込むと、カード矩形を自動検出します。
          </p>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input
              type="url"
              placeholder="画像URL (https://pbs.twimg.com/media/...)"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
            />
            <button onClick={loadFromUrl} disabled={loadingImage || !urlInput.trim()} style={btnPrimary}>
              {loadingImage ? '読込中...' : 'URL読込'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <label style={{ ...btnSecondary, display: 'inline-block', cursor: 'pointer' }}>
              ファイル選択
              <input
                type="file"
                accept="image/*"
                onChange={(e) => loadFromFile(e.target.files?.[0])}
                style={{ display: 'none' }}
              />
            </label>
            <span style={{ color: '#666', fontSize: '0.85em' }}>
              またはこのページ上で <kbd style={{ background: '#eee', padding: '2px 6px', borderRadius: 3, fontSize: '0.9em' }}>Ctrl + V</kbd> でクリップボードの画像を貼り付け
            </span>
          </div>
        </section>

        {/* --- 検出結果プレビュー --- */}
        {sourceBlob && (
          <section style={{ marginBottom: '1.5em' }}>
            <h3 style={sectionTitle}>
              自動検出
              {detecting && <span style={{ fontSize: '0.85em', fontWeight: 'normal', color: '#1976d2', marginLeft: 8 }}>処理中...</span>}
              {!detecting && detectedRects.length > 0 && (
                <span style={{ fontSize: '0.85em', fontWeight: 'normal', color: '#666', marginLeft: 8 }}>
                  {detectedRects.length} 枚検出
                  {savedCount > 0 && ` / 保存済 ${savedCount}`}
                </span>
              )}
            </h3>

            <div style={{ border: '1px solid #ccc', borderRadius: 6, overflow: 'auto', background: '#fafafa', padding: 8, marginBottom: 8 }}>
              <canvas ref={canvasRef} style={{ display: 'block', maxWidth: '100%' }} />
            </div>

            {!detecting && detectedRects.length === 0 && (
              <p style={{ color: '#d32f2f', fontSize: '0.9em', margin: '0.5em 0' }}>
                カードを検出できませんでした。画像が告知画像のレイアウトと異なる可能性があります。
              </p>
            )}

            {/* 検出ごとの除外切替 */}
            {detectedRects.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginBottom: 12 }}>
                {detectedRects.map((r, i) => (
                  <button
                    key={r.id}
                    onClick={() => !r.saved && toggleExclude(r.id)}
                    disabled={r.saved}
                    style={{
                      border: `2px solid ${r.saved ? '#9e9e9e' : r.excluded ? '#d32f2f' : '#2e7d32'}`,
                      borderStyle: r.excluded ? 'dashed' : 'solid',
                      borderRadius: 6,
                      padding: 6,
                      background: r.saved ? '#f0f0f0' : '#fff',
                      cursor: r.saved ? 'default' : 'pointer',
                      fontSize: '0.8em',
                      textAlign: 'center',
                      opacity: r.excluded ? 0.6 : 1,
                    }}
                  >
                    <div style={{ fontWeight: 'bold', marginBottom: 2 }}>#{i + 1}</div>
                    <div style={{ color: '#666' }}>{r.w}×{r.h}</div>
                    <div style={{ marginTop: 4, color: r.saved ? '#9e9e9e' : r.excluded ? '#d32f2f' : '#2e7d32' }}>
                      {r.saved ? '✓ 保存済' : r.excluded ? '✗ 除外' : '✓ 保存対象'}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={saveAllDetected}
                disabled={savingBatch || activeCount === 0}
                style={{ ...btnSuccess, opacity: (savingBatch || activeCount === 0) ? 0.5 : 1 }}
              >
                {savingBatch ? '保存中...' : `保存対象 ${activeCount} 枚をまとめて保存`}
              </button>
              <button onClick={handleDiscardImage} style={btnDanger}>画像を破棄</button>
            </div>
          </section>
        )}

        {/* --- 既存プレビュー一覧 --- */}
        <section>
          <h3 style={sectionTitle}>
            プレビュー一覧
            {previewList.length > 0 && <span style={{ fontSize: '0.85em', fontWeight: 'normal', color: '#666', marginLeft: 8 }}>({previewList.length} 枚)</span>}
          </h3>
          {loadingList ? (
            <p>読み込み中...</p>
          ) : previewList.length === 0 ? (
            <p style={{ color: '#999', fontSize: '0.9em' }}>まだ取り込み済みのプレビューカードはありません。</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
              {previewList.map((row) => (
                <div key={row.id} style={{ border: '1px solid #ddd', borderRadius: 6, padding: 8, background: '#fafafa' }}>
                  <img
                    src={row.permanent_image_url}
                    alt={row.tentative_card_number || ''}
                    style={{ width: '100%', aspectRatio: '0.716', objectFit: 'cover', borderRadius: 4, background: '#eee' }}
                  />
                  <div style={{ fontSize: '0.72em', color: '#666', marginTop: 6, wordBreak: 'break-all' }}>
                    {row.tentative_card_number}
                  </div>
                  <div style={{ fontSize: '0.7em', color: '#999', marginTop: 2 }}>
                    {row.source_type} / {row.status}
                  </div>
                  <button
                    onClick={() => handleDeletePreview(row)}
                    style={{ ...btnDanger, width: '100%', marginTop: 6, padding: '0.4em', fontSize: '0.8em' }}
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
