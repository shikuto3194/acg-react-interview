// acgtcg.com/index_event.html に掲載されている公式・公認イベント一覧を
// 横スクロールカルーセルで表示するコンポーネント。
// 初期表示はビルド時のバンドル版、マウント直後に /event-proxy 経由で最新版を取得して
// 成功したら差し替える。失敗時はバンドル版のまま。

import { useEffect, useState } from 'react';
import {
  homeEvents as initialEvents,
  fetchLatestEvents,
} from '../homeData.js';

export default function HomeOfficialEvents() {
  const [items, setItems] = useState(initialEvents);
  const [refreshState, setRefreshState] = useState('loading');

  useEffect(() => {
    let alive = true;
    fetchLatestEvents().then((latest) => {
      if (!alive) return;
      if (!latest) { setRefreshState('stale'); return; }
      if (latest.events?.length) setItems(latest.events);
      setRefreshState('fresh');
    });
    return () => { alive = false; };
  }, []);

  const refreshLabel =
    refreshState === 'loading' ? '最新版を取得中…' :
    refreshState === 'fresh'   ? '最新版で表示中' :
    refreshState === 'stale'   ? 'バンドル版' :
    'バンドル版';
  const refreshBg =
    refreshState === 'fresh' ? '#e8f5e9' :
    refreshState === 'stale' ? '#fff8e1' :
    '#f5f5f5';

  if (!items || items.length === 0) return null;

  return (
    <div style={{ margin: '0.6em 0 1.4em 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6em', flexWrap: 'wrap', borderBottom: '2px solid #1976d2', paddingBottom: 4, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: '1.05em', color: '#1976d2' }}>公式・公認イベント</h3>
        <span style={{
          fontSize: '0.75em', color: '#555',
          border: '1px solid #ddd', borderRadius: 999, padding: '0.1em 0.6em',
          background: refreshBg,
        }}>{refreshLabel}</span>
        <span style={{ color: '#999', fontSize: '0.85em', marginLeft: 'auto' }}>
          {items.length} 件 / 横スクロール →
        </span>
      </div>

      <div data-no-tab-swipe style={{
        display: 'flex',
        gap: '0.7em',
        overflowX: 'auto',
        paddingBottom: '0.4em',
        WebkitOverflowScrolling: 'touch',
        scrollSnapType: 'x mandatory',
        touchAction: 'pan-x pan-y',
      }}>
        {items.map((p) => {
          const card = (
            <div style={{
              width: 160, flex: '0 0 auto', scrollSnapAlign: 'start',
              border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden',
              background: '#fff', display: 'flex', flexDirection: 'column',
            }}>
              {p.image && (
                <div style={{ width: '100%', height: 110, background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  <img
                    src={p.image}
                    alt={p.title}
                    loading="lazy"
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                </div>
              )}
              <div style={{
                padding: '0.5em 0.6em',
                fontSize: '0.85em', lineHeight: 1.35, color: '#222',
                flex: 1,
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 4,
                overflow: 'hidden',
                wordBreak: 'break-word',
                whiteSpace: 'pre-line',
              }} title={p.title}>
                {p.title}
              </div>
            </div>
          );
          if (p.href) {
            return (
              <a key={p.id} href={p.href} target="_blank" rel="noopener noreferrer"
                 style={{ textDecoration: 'none', color: 'inherit' }}>
                {card}
              </a>
            );
          }
          return <div key={p.id}>{card}</div>;
        })}
      </div>
    </div>
  );
}
