// acgtcg.com トップページから取得した「お知らせ」を表示するコンポーネント。
// 初期表示はビルド時のバンドル版、マウント直後に /home-proxy 経由で最新版を取得して
// 成功したら差し替える。失敗時はバンドル版のまま。

import { useEffect, useMemo, useState } from 'react';
import {
  homeNews as initialNews,
  homeMeta as initialMeta,
  fetchLatestHome,
} from '../homeData.js';

const MAX_DEFAULT = 8;

export default function HomeOfficialNews() {
  const [news, setNews] = useState(initialNews);
  const [, setMeta] = useState(initialMeta);
  const [refreshState, setRefreshState] = useState('loading');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchLatestHome().then((latest) => {
      if (!alive) return;
      if (!latest) { setRefreshState('stale'); return; }
      if (latest.news?.length) setNews(latest.news);
      setMeta((prev) => ({ ...(prev || {}), fetchedAt: latest.fetchedAt, source: 'runtime' }));
      setRefreshState('fresh');
    });
    return () => { alive = false; };
  }, []);

  const visible = useMemo(
    () => (expanded ? news : news.slice(0, MAX_DEFAULT)),
    [news, expanded]
  );

  const refreshLabel =
    refreshState === 'loading' ? '最新版を取得中…' :
    refreshState === 'fresh'   ? '最新版で表示中' :
    refreshState === 'stale'   ? 'バンドル版（取得失敗）' :
    'バンドル版';
  const refreshBg =
    refreshState === 'fresh' ? '#e8f5e9' :
    refreshState === 'stale' ? '#fff8e1' :
    '#f5f5f5';

  return (
    <div style={{ margin: '0.6em 0 1.4em 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6em', flexWrap: 'wrap', borderBottom: '2px solid #1976d2', paddingBottom: 4, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: '1.05em', color: '#1976d2' }}>公式お知らせ</h3>
        <span style={{
          fontSize: '0.75em', color: '#555',
          border: '1px solid #ddd', borderRadius: 999, padding: '0.1em 0.6em',
          background: refreshBg,
        }}>{refreshLabel}</span>
        <a href="https://acgtcg.com/" target="_blank" rel="noopener noreferrer"
           style={{ marginLeft: 'auto', fontSize: '0.85em', color: '#1976d2' }}>
          公式サイト ↗
        </a>
      </div>

      {visible.length === 0 && (
        <div style={{ padding: '0.8em', color: '#777', border: '1px solid #ddd', borderRadius: 8 }}>
          お知らせを取得できませんでした。
        </div>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {visible.map((item) => (
          <li key={item.id} style={{
            display: 'grid',
            gridTemplateColumns: '6.5em 1fr',
            gap: '0.6em',
            padding: '0.55em 0',
            borderBottom: '1px solid #eee',
            alignItems: 'baseline',
          }}>
            <span style={{ color: item.important ? '#d32f2f' : '#555', fontSize: '0.85em', fontWeight: item.important ? 'bold' : 'normal' }}>
              {item.date || '—'}
              {item.important && (
                <span style={{
                  display: 'inline-block', marginLeft: '0.3em',
                  fontSize: '0.75em', padding: '0.05em 0.4em', borderRadius: 999,
                  background: '#d32f2f', color: '#fff', fontWeight: 'bold',
                }}>重要</span>
              )}
            </span>
            <span
              className="home-news-body"
              style={{ lineHeight: 1.6, fontSize: '0.95em' }}
              dangerouslySetInnerHTML={{ __html: item.html }}
            />
          </li>
        ))}
      </ul>

      {news.length > MAX_DEFAULT && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              background: '#fff', color: '#1976d2', border: '1px solid #1976d2',
              borderRadius: 999, padding: '0.3em 1.2em', cursor: 'pointer', fontSize: '0.9em',
            }}
          >
            {expanded ? '折りたたむ' : `すべて表示（${news.length} 件）`}
          </button>
        </div>
      )}
    </div>
  );
}
