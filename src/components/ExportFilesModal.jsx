import '../styles/modal.css';

export default function ExportFilesModal({ open, title, files, onClose }) {
  if (!open) return null;
  const safeFiles = Array.isArray(files) ? files : [];
  return (
    <div className="efm-overlay" onClick={onClose}>
      <div className="efm-content" onClick={(e) => e.stopPropagation()}>
        <div className="efm-header">
          <h3>{title || '出力ファイル'}</h3>
          <button className="efm-close" onClick={onClose}>閉じる</button>
        </div>
        <div className="efm-hint">
          iPhone/iPadでの保存方法　「開く」→共有→「ファイルに保存」（ファイル名が固定なので任意で変えてください）
        </div>
        {safeFiles.length === 0 ? (
          <div className="efm-empty">出力ファイルがありません。</div>
        ) : (
          <div className="efm-file-list">
            {safeFiles.map((f, idx) => (
              <div key={f.url || idx} className="efm-file-item">
                <div className="efm-file-name">{f.name || `file-${idx + 1}`}</div>
                <div className="efm-file-actions">
                  <button
                    className="efm-open-btn"
                    onClick={() => {
                      try {
                        window.open(f.url, '_blank', 'noopener,noreferrer');
                      } catch {
                        window.location.href = f.url;
                      }
                    }}
                  >
                    開く
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
