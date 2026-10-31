import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { supabase, APP_GAME_ID } from './supabaseClient';
import { fetchCloudDecks, upsertCloudDeck, deleteCloudDeck, uploadAllDecksToCloud } from './useDeckCloud.js';
import baseCardData, { packOrder } from './cardData';
import { getSameNameLimit, getSideDeckLimit } from './utils/deckLimits';
import { usePreviewCards } from './utils/usePreviewCards';
// qaData は ~1MB あり QA タブ表示時にのみ必要。dynamic import で遅延ロードする。
// メモリ上の参照を変えないよう、解決済み Promise をモジュール内でキャッシュする。
let _qaDataPromise = null;
const loadQaData = () => (_qaDataPromise ||= import('./qaData'));
import './App.css';
import './CardList.css';
import { FixedSizeList, FixedSizeGrid } from 'react-window';

import CardDetailModal from './components/CardDetailModal';
import ExportFilesModal from './components/ExportFilesModal';
import DeckDetailView from './components/DeckDetailView';
import DeckSubmitModal from './components/DeckSubmitModal';
import HomeOfficialNews from './components/HomeOfficialNews';
import HomeOfficialProducts from './components/HomeOfficialProducts';
import HomeOfficialEvents from './components/HomeOfficialEvents';
import HomePublicDecks from './components/HomePublicDecks';
import PublicDecksListPage from './components/PublicDecksListPage';
import DeckQrExportModal from './components/DeckQrExportModal';
import DeckQrImportButton from './components/DeckQrImportButton';
import { sortDeckCards } from './utils/deckUtils';
import { migrateIdCountPairs, migrateSavedDeck, migrateSavedDecks } from './utils/deckIdMigration';

// CardDetailModal は ./components/CardDetailModal.jsx から import 済み
// ExportFilesModal は ./components/ExportFilesModal.jsx から import 済み


function isIOSDevice() {
  try {
    const ua = navigator.userAgent || '';
    const iOSByUA = /iPad|iPhone|iPod/.test(ua);
    const iPadOSByPlatform = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return iOSByUA || iPadOSByPlatform;
  } catch {
    return false;
  }
}

// --- ヘッダー右上のログイン状態表示 ---
function UserBadge() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  if (!user) {
    return (
      <button
        onClick={() => navigate('/login')}
        style={{
          background: '#1976d2', color: '#fff', border: 'none', borderRadius: 6,
          padding: '0.5em 1em', fontSize: '0.9em', cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        ログイン
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        onClick={() => navigate('/events')}
        style={{
          background: 'none', border: '1px solid #ff9800', color: '#ff9800', borderRadius: 6,
          padding: '0.5em 0.9em', fontSize: '0.85em', cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        イベント
      </button>
      <button
        onClick={() => navigate('/mypage')}
        style={{
          background: 'none', border: '1px solid #1976d2', color: '#1976d2', borderRadius: 6,
          padding: '0.5em 0.9em', fontSize: '0.85em', cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        マイページ
      </button>
      <button
        onClick={async () => { await signOut(); }}
        style={{
          background: '#e0e0e0', color: '#333', border: 'none', borderRadius: 6,
          padding: '0.5em 0.9em', fontSize: '0.85em', cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        ログアウト
      </button>
    </div>
  );
}

// 作成中デッキの自動保存キー。スキーマを変える時は v2 に上げて読み捨てる。
const DRAFT_STORAGE_KEY = 'orika_draftDeck_v1';

// デッキ詳細モーダル上部の <select> (出力 / 公開中) を <button> と同じ縦幅・見た目に揃えるための style。
// 矢印は placeholder option のテキストに「▼」を直接含めて表現するため、ここでは背景画像も右側余白も不要。
// 縦幅基準は lineHeight: 1.2 (コンパクト寄り)。同じ行の <button> (公開 / コピーして編集) にも
// 同値の lineHeight: 1.2 を inline で指定して揃えている。
const pillSelectBaseStyle = {
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  color: '#fff',
  borderRadius: '6px',
  padding: '0.4em 0.5em',
  fontWeight: 'bold',
  fontSize: '1em',
  lineHeight: 1.2,
  border: 'none',
  cursor: 'pointer',
};

// 領土デッキ・予備デッキの合計枚数上限
const TOKEN_DECK_MAX_TOTAL = 10;
const SIDE_DECK_MAX_TOTAL = 15;

// ACG では領土カードを基礎デッキとは別の「領土デッキ」に入れる。
// 既存の tokenDeck 機構をそのまま流用するため、領土タイプを「トークン側」として扱う。
// 同型の関数が複数の hook 内で再宣言されていたのを 1 箇所にまとめた。
const isTokenCard = (c) => {
  if (!c) return false;
  if (c.isDoubleSided && c.front && c.back) {
    const ft = c.front.type || '';
    const bt = c.back.type || '';
    return ft === '領土' || bt === '領土' || ft.includes('トークン') || bt.includes('トークン');
  }
  const t = c.type || '';
  return t === '領土' || t.includes('トークン');
};

// オブジェクトの浅い比較。tokenDeck/sideDeck のような id→count マップ用。
// 旧コードは JSON.stringify 比較を毎回行っていたが、数値マップなので shallow で十分。
const shallowEqualObj = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (a[k] !== b[k]) return false;
  }
  return true;
};

// 作成中デッキの自動保存復元用 lookup (モジュール初期化時に同期評価される)。
// プレビューカードは Supabase 非同期取得なのでここには含まれず、別途 rehydrate 時にスキップされる。
const _cardLookupForDraft = (() => {
  const m = new Map();
  for (const c of baseCardData) m.set(c.id, c);
  return m;
})();

const readDraftFromStorage = () => {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    const draft = raw ? JSON.parse(raw) : null;
    if (!draft || typeof draft !== 'object') return null;
    // 旧世代の ID (新弾追加でずれた領土カード等) を補正。
    // 保存デッキとキー名が違うので、いったん保存デッキの形に合わせてから通す。
    const migrated = migrateSavedDeck({
      name: draft.currentDeckName,
      cards: draft.deck,
      tokenDeck: draft.tokenDeck,
      sideDeck: draft.sideDeck,
      thumbnailCardId: draft.deckThumbnailCardId ?? null,
    });
    return {
      ...draft,
      deck: migrated.cards,
      tokenDeck: migrated.tokenDeck,
      sideDeck: migrated.sideDeck,
      deckThumbnailCardId: migrated.thumbnailCardId,
    };
  } catch {
    return null;
  }
};

const rehydrateDraftDeck = (savedCards) => {
  if (!Array.isArray(savedCards)) return [];
  const out = [];
  for (const saved of savedCards) {
    if (!saved || saved.id == null) continue;
    const base = _cardLookupForDraft.get(saved.id);
    if (!base) continue;
    out.push({ ...base, count: Number(saved.count) || 0, isDeckThumbnail: !!saved.isDeckThumbnail });
  }
  return out;
};

const CardRow = React.memo(function CardRow({ index, style, data }) {
    const { decreaseCardCount, decreaseSideCount, decreaseTokenCount, getCardCountInDeck, increaseCardCount, increaseSideCount, increaseTokenCount, itemTouchHandlers, openCardDetail, sideDeck, sideMode, tokenDeck } = data.context;
    const card = data.cards[index];
    if (!card) return null;
    const countInMainDeck = getCardCountInDeck(card.id);
    // ダブルフェイス対応
    const isDoubleSided = card.isDoubleSided && card.front && card.back;
    const displayCard = isDoubleSided ? card.front : card;
    const typeText = isDoubleSided ? `${card.front.type} / ${card.back.type}` : card.type;
    const isToken = isDoubleSided
      ? (card.front.type === '領土' || card.back.type === '領土' || card.front.type?.includes('トークン') || card.back.type?.includes('トークン'))
      : (card.type === '領土' || card.type?.includes('トークン'));
    const primaryCount = isToken ? (tokenDeck[card.id] || 0) : countInMainDeck;
    const sideCount = Number(sideDeck[card.id]) || 0;
    const primaryMax = isToken ? (card.maxTokenDeckCount ?? 4) : (card.maxDeckCount ?? 4);
    const combinedLimit = getSameNameLimit(card);
    const primaryIncDisabled = primaryCount >= primaryMax || primaryCount + sideCount >= combinedLimit;
    const sideIncDisabled = sideCount >= getSideDeckLimit(card) || primaryCount + sideCount >= combinedLimit;

    // 現在のモードに応じた表示値・操作
    const count = sideMode ? sideCount : primaryCount;
    const maxCount = sideMode ? getSideDeckLimit(card) : primaryMax;
    const isUnlimited = !sideMode && combinedLimit > 90;
    const incDisabled = sideMode ? sideIncDisabled : primaryIncDisabled;
    const onMinus = sideMode
      ? () => decreaseSideCount(card.id)
      : (isToken ? () => decreaseTokenCount(card.id) : () => decreaseCardCount(card.id));
    const onPlus = sideMode
      ? () => increaseSideCount(card.id)
      : (isToken ? () => increaseTokenCount(card.id) : () => increaseCardCount(card.id));
    const btnBg = sideMode ? '#43a047' : (isToken ? '#ff9800' : undefined);
    const btnExtraClass = sideMode ? ' side-btn' : (isToken ? ' token-btn' : '');
    // sideMode では予備側に追加可能 (primaryMax=0 でも) なら +/- を出す
    const showControls = sideMode ? true : primaryMax > 0;

    return (
      <div
        className="card-item"
        style={{ ...style, touchAction: 'pan-y', cursor: 'pointer' }}
        key={card.id}
        {...itemTouchHandlers}
        onClick={e => {
          // +/−ボタン以外のクリックで詳細
          if (
            e.target.classList.contains('plusBtn') ||
            e.target.classList.contains('minusBtn')
          ) return;
          openCardDetail(card);
        }}
      >
        <div className="card-grid-img-wrap" style={{ width: 48, height: 64, marginRight: 8 }}>
          <img src={displayCard.image} alt={displayCard.name} className="card-grid-img" style={{ width: '100%', height: '100%' }} />
        </div>
        <div className="card-info"><b>{card.name}</b> <span style={{ fontSize: '0.9em', color: '#666' }}>({typeText})</span></div>
        {showControls && (
          <div className="card-controls">
            <button
              onClick={e => { e.stopPropagation(); onMinus(); }}
              className={`minusBtn${btnExtraClass}`}
              disabled={count <= 0}
              style={btnBg ? { background: btnBg } : undefined}
            >-</button>
            <span>{count}{isUnlimited ? ' / ∞' : ` / ${maxCount}`}</span>
            <button
              onClick={e => { e.stopPropagation(); onPlus(); }}
              className={`plusBtn${btnExtraClass}`}
              disabled={incDisabled}
              style={btnBg ? { background: btnBg } : undefined}
            >+</button>
          </div>
        )}
      </div>
    );
  });

const CardGridCell = React.memo(function CardGridCell({ columnIndex, rowIndex, style, data }) {
    const { decreaseCardCount, decreaseSideCount, decreaseTokenCount, getCardCountInDeck, increaseCardCount, increaseSideCount, increaseTokenCount, itemTouchHandlers, openCardDetail, sideDeck, sideMode, tokenDeck } = data.context;
    const { cards, columns, section = 'search' } = data;
    const index = rowIndex * columns + columnIndex;
    if (index >= cards.length) return null;
    const card = cards[index];
    const countInMainDeck = getCardCountInDeck(card.id);
    const isDoubleSided = card.isDoubleSided && card.front && card.back;
    const displayCard = isDoubleSided ? card.front : card;
    const isToken = isDoubleSided
      ? (card.front.type === '領土' || card.back.type === '領土' || card.front.type?.includes('トークン') || card.back.type?.includes('トークン'))
      : (card.type === '領土' || card.type?.includes('トークン'));
    const count = isToken ? (tokenDeck[card.id] || 0) : countInMainDeck;
    const sideCount = Number(sideDeck[card.id]) || 0;
    const maxCount = isToken ? (card.maxTokenDeckCount ?? 4) : (card.maxDeckCount ?? 4);
    const combinedLimit = getSameNameLimit(card);
    const incDisabled = count >= maxCount || count + sideCount >= combinedLimit;
    const sideIncDisabled = sideCount >= getSideDeckLimit(card) || count + sideCount >= combinedLimit;
    const isSideSection = section === 'side';
    // 検索タブで予備モード ON の場合は予備セクション同様に振る舞う
    const treatAsSide = isSideSection || (section === 'search' && sideMode);

    // セクション別: badge と +/- 表示の差し替え
    let badgeBg = isToken ? '#ff9800' : '#1976d2';
    let badgeCount;
    let showControls = maxCount > 0;
    if (treatAsSide) {
      badgeBg = '#43a047';
      badgeCount = sideCount;
      // 予備モード時は予備側に追加可能なので、純トークン (maxCount=0) でも +/- を表示
      if (section === 'search' && sideMode) showControls = true;
    } else if (section === 'basic' || section === 'territory') {
      badgeCount = count;
    } else {
      // search (sideMode=false): 単色 (基礎=青, 領土=橙)
      badgeBg = isToken ? '#ff9800' : '#1976d2';
      badgeCount = count;
    }
    return (
      <div
        style={{ ...style, padding: 0, display: 'flex', alignItems: 'stretch', justifyContent: 'center', touchAction: 'pan-y', cursor: 'pointer' }}
        {...itemTouchHandlers}
        onClick={e => {
          // +/−ボタン以外のクリックで詳細
          if (
            e.target.classList.contains('plusBtn') ||
            e.target.classList.contains('minusBtn')
          ) return;
          openCardDetail(card);
        }}
      >
        <div
          className="card-grid-img-wrap"
          style={{
            width: '100%',
            height: '100%',
            aspectRatio: '385/561',
            background: '#fff',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 5,
            boxShadow: '0 1px 4px #bbb',
            overflow: 'hidden',
          }}
        >
          <img
            src={displayCard.image}
            alt={displayCard.name}
            className="card-grid-img"
            style={{
              width: '98%',
              height: '98%',
              aspectRatio: '385/561',
              objectFit: 'cover',
              borderRadius: 5,
              background: '#fff',
              boxShadow: 'none',
              cursor: 'pointer',
              display: 'block',
            }}
          />
          {badgeCount > 0 && (
            <span
              className="card-badge"
              style={{ position: 'absolute', top: 0, right: 0, background: badgeBg, color: '#fff', borderRadius: '50%', width: '1.7em', height: '1.7em', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1em', fontWeight: 'bold', boxShadow: '0 1px 4px #bbb', zIndex: 3, pointerEvents: 'none' }}
            >{badgeCount}</span>
          )}
          {showControls && (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                bottom: 4,
                transform: 'translateX(-50%)',
                display: 'flex',
                gap: '0.3em',
                zIndex: 2,
              }}
            >
              {(() => {
                const accent = treatAsSide ? '#43a047' : (isToken ? '#ff9800' : '#1976d2');
                const minusClass = treatAsSide ? 'side-outline-btn' : (isToken ? 'token-outline-btn' : '');
                const plusClass = treatAsSide ? 'side-btn' : (isToken ? 'token-btn' : '');
                const onMinus = treatAsSide
                  ? () => decreaseSideCount(card.id)
                  : (isToken ? () => decreaseTokenCount(card.id) : () => decreaseCardCount(card.id));
                const onPlus = treatAsSide
                  ? () => increaseSideCount(card.id)
                  : (isToken ? () => increaseTokenCount(card.id) : () => increaseCardCount(card.id));
                const minusDisabled = treatAsSide ? sideCount <= 0 : count <= 0;
                const plusDisabled = treatAsSide ? sideIncDisabled : incDisabled;
                return (
                  <>
                    <button
                      className={`minusBtn${minusClass ? ' ' + minusClass : ''}`}
                      style={{
                        width: '2em',
                        height: '2em',
                        borderRadius: '50%',
                        background: '#fff',
                        border: `2px solid ${accent}`,
                        color: accent,
                        fontSize: '1.2em',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 1px 4px #bbb',
                        cursor: 'pointer',
                      }}
                      onClick={e => { e.stopPropagation(); onMinus(); }}
                      disabled={minusDisabled}
                    >
                      -
                    </button>
                    <button
                      className={`plusBtn${plusClass ? ' ' + plusClass : ''}`}
                      style={{
                        width: '2em',
                        height: '2em',
                        borderRadius: '50%',
                        background: accent,
                        border: `2px solid ${accent}`,
                        color: '#fff',
                        fontSize: '1.2em',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 1px 4px #bbb',
                        cursor: 'pointer',
                      }}
                      onClick={e => { e.stopPropagation(); onPlus(); }}
                      disabled={plusDisabled}
                    >
                      +
                    </button>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    );
  });

export default function CanvasCardApp() {
  const { user } = useAuth();

  // 公式 acgtcg.com のカード (cardData) と Supabase 由来のプレビューカードをマージ。
  // 以降のロジックは cardData を統合済み配列として扱う (preview は type='プレビュー')。
  const previewCards = usePreviewCards();
  const cardData = useMemo(() => [...baseCardData, ...previewCards], [previewCards]);

  const [search, setSearch] = useState('');
  const [draftInitial] = useState(readDraftFromStorage);
  const [deck, setDeck] = useState(() => rehydrateDraftDeck(draftInitial?.deck));
  const [tokenDeck, setTokenDeck] = useState(() => (draftInitial?.tokenDeck && typeof draftInitial.tokenDeck === 'object') ? draftInitial.tokenDeck : {}); // id -> count（領土デッキ）
  const [sideDeck, setSideDeck] = useState(() => (draftInitial?.sideDeck && typeof draftInitial.sideDeck === 'object') ? draftInitial.sideDeck : {});   // id -> count（予備デッキ）
  const [deckThumbnailCardId, setDeckThumbnailCardId] = useState(() => draftInitial?.deckThumbnailCardId ?? null); // 共通サムネイルID
  const [exportFilesModal, setExportFilesModal] = useState(null);
  const [, setCloudLoaded] = useState(false); // クラウド読み込み済みフラグ
  const [savedDecks, setSavedDecks] = useState(() => {
    try {
      const decks = localStorage.getItem('savedCanvasDecks');
      // 新弾追加でずれた旧世代の ID をここで補正する (補正結果は保存時に localStorage へ戻る)
      return migrateSavedDecks(decks ? JSON.parse(decks) : []);
    } catch {
      return [];
    }
  });

  // --- ログイン時にSupabaseからデッキを読み込む ---
  useEffect(() => {
    if (!user) { setCloudLoaded(false); return; }
    let cancelled = false;
    (async () => {
      const cloudDecks = await fetchCloudDecks(user.id);
      if (cancelled) return;
      if (cloudDecks.length > 0) {
        // クラウドにデッキがあればそちらを使用
        setSavedDecks(cloudDecks);
      } else {
        // クラウドが空でlocalStorageにデッキがあればアップロード
        const localDecks = migrateSavedDecks(JSON.parse(localStorage.getItem('savedCanvasDecks') || '[]'));
        if (localDecks.length > 0) {
          await uploadAllDecksToCloud(user.id, localDecks);
        }
      }
      setCloudLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [user]);
  const [deckName, setDeckName] = useState('');
  // acg-builder 互換 QR の出力モーダル。null=非表示。
  const [qrExport, setQrExport] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [currentDeckName, setCurrentDeckName] = useState(() => draftInitial?.currentDeckName ?? '');
  const [showFront, setShowFront] = useState(true);
  const [showFilter, setShowFilter] = useState(false);
  const [filterColor, setFilterColor] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterRarity, setFilterRarity] = useState('');
  const [filterTribe, setFilterTribe] = useState('');
  const [filterPack, setFilterPack] = useState('');
  const [filterCost, setFilterCost] = useState('');
  const [filterReduction, setFilterReduction] = useState('');
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'grid'
  const [sideMode, setSideMode] = useState(false); // 検索タブで +/- ボタンを予備デッキ操作にするモード
  const [qaQuery, setQaQuery] = useState('');
  const [qaSectionFilter, setQaSectionFilter] = useState(''); // '' = all
  // QA データは dynamic import で QA タブ初表示時にロードする。
  // それまでは空で保持しておく（filteredQaSections は O(0) になる）。
  const [qaSectionsState, setQaSectionsState] = useState([]);
  const [, setQaMetaState] = useState(null);
  const [qaRefreshState, setQaRefreshState] = useState('idle'); // 'idle' | 'loading' | 'fresh' | 'stale'
  const tabOrder = useMemo(() => ['home', 'search', 'deck', 'saved', 'qa'], []);
  const tabContentWrapRef = useRef(null);

  const homeContainerRef = useRef(null);
  const searchContainerRef = useRef(null);
  const listContainerRef = useRef(null);
  const deckContainerRef = useRef(null);
  const savedContainerRef = useRef(null);
  const qaContainerRef = useRef(null);
  // 旧PNGキャプチャは削除。SVGベース出力のみ使用。

  const closeExportFilesModal = () => {
    try {
      const files = exportFilesModal?.files;
      if (Array.isArray(files)) {
        for (const f of files) {
          if (f?.url) URL.revokeObjectURL(f.url);
        }
      }
    } catch {
      // ignore
    }
    setExportFilesModal(null);
  };

  const openExportFilesModal = (title, files) => {
    setExportFilesModal({ title, files });
  };

  const resetFilters = () => {
    setSearch('');
    setFilterColor('');
    setFilterType('');
    setFilterRarity('');
    setFilterTribe('');
    setFilterPack('');
    setFilterCost('');
    setFilterReduction('');
    // 種族のドロップダウンも閉じる
    try { setTribeDropdownOpen(false); } catch { /* noop */ }
  };

  // 種族の候補一覧（入力補助用）。cardData にプレビューカードが追加されたら再計算する。
  const tribeOptions = useMemo(() => {
    const set = new Set();
    for (const card of cardData) {
      const sides = (card.isDoubleSided && card.front && card.back) ? [card.front, card.back] : [card];
      for (const s of sides) {
        const t = (s.tribe || '').trim();
        if (!t) continue;
        // 複数種族は「・」「/」「／」で区切られている想定
        t.split(/[・/／]/).map(x => x.trim()).filter(Boolean).forEach(x => set.add(x));
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
  }, [cardData]);

  // 種族コンボボックス（スマホでも選択リストを出すための簡易ドロップダウン）
  const [tribeDropdownOpen, setTribeDropdownOpen] = useState(false);
  const tribeDropdownRef = useRef(null);
  const filteredTribeOptions = useMemo(() => {
    const q = (filterTribe || '').toLowerCase();
    if (!q) return tribeOptions;
    return tribeOptions.filter(o => o.toLowerCase().includes(q));
  }, [tribeOptions, filterTribe]);

  useEffect(() => {
    const handleOutside = (e) => {
      if (tribeDropdownRef.current && !tribeDropdownRef.current.contains(e.target)) {
        setTribeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, []);


  // QA: 弾フィルタ + キーワード絞り込みの結果（セクション単位）
  const filteredQaSections = useMemo(() => {
    const q = qaQuery.trim().toLowerCase();
    const matchesQuery = (item) => {
      if (!q) return true;
      const hay = [item.question, item.answer, (item.tags || []).join(' ')]
        .join(' \n ').toLowerCase();
      return hay.includes(q);
    };
    const out = [];
    for (const sec of qaSectionsState) {
      if (qaSectionFilter && sec.id !== qaSectionFilter) continue;
      const entries = sec.entries.filter(matchesQuery);
      if (entries.length === 0 && (q || qaSectionFilter)) continue;
      out.push({ ...sec, entries });
    }
    return out;
  }, [qaQuery, qaSectionFilter, qaSectionsState]);

  const filteredQaCount = useMemo(
    () => filteredQaSections.reduce((acc, s) => acc + s.entries.length, 0),
    [filteredQaSections]
  );

  // QA の開閉・ホバー状態
  const [qaOpen, setQaOpen] = useState({});
  const [qaHover, setQaHover] = useState({});
  const toggleQa = (id) => setQaOpen(prev => ({ ...prev, [id]: !prev[id] }));

  // QA タブを初表示したタイミングで qaData モジュールを dynamic import し、
  // 続けてランタイム取得で最新版に置き換える（取得失敗時はバンドル版のまま）。
  const qaRefreshTriedRef = useRef(false);
  useEffect(() => {
    if (activeTab !== 'qa' || qaRefreshTriedRef.current) return;
    qaRefreshTriedRef.current = true;
    const controller = new AbortController();
    let cancelled = false;
    setQaRefreshState('loading');
    (async () => {
      const mod = await loadQaData();
      if (cancelled) return;
      // バンドル版をまず表示
      setQaSectionsState(mod.qaSections);
      setQaMetaState(mod.qaMeta);
      // ランタイム取得で最新版に置換を試みる
      const latest = await mod.fetchLatestQa({ signal: controller.signal });
      if (cancelled) return;
      if (!latest) {
        setQaRefreshState('stale');
        return;
      }
      setQaSectionsState(latest.sections);
      setQaMetaState((prev) => ({ ...(prev || {}), fetchedAt: latest.fetchedAt, source: 'runtime' }));
      setQaRefreshState('fresh');
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [activeTab]);

  // --- 最新カードデータへの再結合（リハイドレート）ヘルパー ---
  // cardData が変化する (preview カードのロード完了など) たびに再構築する。
  const cardMapById = useMemo(() => {
    const m = new Map();
    for (const c of cardData) m.set(c.id, c);
    return m;
  }, [cardData]);
  // 名前→カードの逆引きも併設（relatedTokens の解決用）。
  const cardMapByName = useMemo(() => {
    const m = new Map();
    for (const c of cardData) m.set(c.name, c);
    return m;
  }, [cardData]);
  const rehydrateCard = (saved) => {
    if (!saved) return saved;
    const base = saved.id ? cardMapById.get(saved.id) : null;
    if (!base) return saved; // 予備: 見つからなければそのまま
    return { ...base, count: saved.count ?? base.count ?? 0, isDeckThumbnail: !!saved.isDeckThumbnail };
  };
  const rehydrateCards = (savedCards = []) => savedCards.map(rehydrateCard);
  const collectRelatedTokensFromCards = (cards = []) => {
    const out = [];
    const seen = new Set();
    for (const card of cards) {
      const rel = card.relatedTokens || [];
      for (const name of rel) {
        if (seen.has(name)) continue;
        const token = cardMapByName.get(name);
        if (token) { out.push(token); seen.add(name); }
      }
    }
    return out;
  };

  // --- 作成中デッキからトークン候補を抽出し、tokenDeckのキーを同期 ---
  useEffect(() => {
    // isTokenCard / 領土カード判定はモジュール最上位 (1 箇所) に集約済み
    const tokenCards = collectRelatedTokensFromCards(deck);
    const relatedTokenIds = new Set(tokenCards.map(t => t.id));

    setTokenDeck(prev => {
      const next = { ...prev };

      // 既存 tokenDeck をクランプ／不正値を掃除
      for (const [idStr, rawCount] of Object.entries(next)) {
        const id = Number(idStr);
        const token = cardMapById.get(id);
        if (!token || !isTokenCard(token)) {
          delete next[idStr];
          continue;
        }
        const maxT = token.maxTokenDeckCount ?? 4;
        const count = Math.max(0, Math.min(Number(rawCount) || 0, maxT));
        next[idStr] = count;
        // 関連トークンでもなく、0枚なら保持する必要がないので削除
        if (count <= 0 && !relatedTokenIds.has(id)) delete next[idStr];
      }

      // 作成中デッキに紐づくトークンはキーを必ず作る（0枚でも表示対象にできる）
      for (const t of tokenCards) {
        const key = String(t.id);
        const maxT = t.maxTokenDeckCount ?? 4;
        const cur = next[key] ?? 0;
        next[key] = Math.max(0, Math.min(Number(cur) || 0, maxT));
      }

      return shallowEqualObj(next, prev) ? prev : next;
    });
    // cardMapById / collectRelatedTokensFromCards はレンダー間で実質不変。deck 変化時のみ同期する意図のため依存に含めない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck]);

  const increaseTokenCount = React.useCallback((tokenId) => {
    const token = cardMapById.get(tokenId);
    if (!token) return;
    const maxT = token.maxTokenDeckCount ?? 4;
    const cur = tokenDeck[tokenId] || 0;
    if (cur >= maxT) return;
    // 同名 基礎+領土+予備 合計の制限 (502.3 / 504.4)
    const sideCnt = Number(sideDeck[tokenId]) || 0;
    const limit = token.type === '領土' && token.tribe === '基礎' ? 99 : 4;
    if (cur + sideCnt >= limit) return;
    // 領土デッキ合計枚数の上限
    const tokenTotal = Object.values(tokenDeck).reduce((sum, cnt) => sum + Math.max(0, Number(cnt) || 0), 0);
    if (tokenTotal >= TOKEN_DECK_MAX_TOTAL) return;
    setTokenDeck(prev => ({ ...prev, [tokenId]: cur + 1 }));
  }, [cardMapById, setTokenDeck, sideDeck, tokenDeck]);
  const decreaseTokenCount = React.useCallback((tokenId) => {
    const cur = tokenDeck[tokenId] || 0;
    if (cur <= 0) return;
    setTokenDeck(prev => ({ ...prev, [tokenId]: cur - 1 }));
  }, [setTokenDeck, tokenDeck]);

  const increaseCardCount = React.useCallback((cardId) => {
    const cardToAdd = cardMapById.get(cardId);
    // isTokenCard / 領土カード判定はモジュール最上位 (1 箇所) に集約済み
    const getMaxCount = (c) => (isTokenCard(c) ? 0 : (c?.maxDeckCount ?? 4));
    const maxCount = getMaxCount(cardToAdd);
    if (cardToAdd && maxCount === 0) return; // 上限0なら追加不可
    if (isTokenCard(cardToAdd)) {
      alert('領土カードは基礎デッキには入れられません。領土デッキで管理してください。');
      return;
    }
    // 「契約」タイプ制限
    const isKeiyaku = (card) => {
      if (card.isDoubleSided && card.front && card.back) {
        return card.front.type.includes('契約') || card.back.type.includes('契約');
      }
      return card.type && card.type.includes('契約');
    };
    if (isKeiyaku(cardToAdd)) {
      // 既にデッキ内に他の契約カードがあるか
      const alreadyKeiyaku = deck.some(c => c.id !== cardId && isKeiyaku(c));
      if (alreadyKeiyaku) {
        alert('契約カードはデッキに1種類しか入れられません。');
        return;
      }
    }
    // 基礎+予備の合計上限。カードに記載された枚数例外を優先する。
    const combinedLimit = getSameNameLimit(cardToAdd);
    const sideCnt = Number(sideDeck[cardId]) || 0;
    const existingCard = deck.find((c) => c.id === cardId);
    if (existingCard) {
      if (existingCard.count >= maxCount) return;
      if (existingCard.count + sideCnt >= combinedLimit) return;
      setDeck(deck.map((c) => c.id === cardId ? { ...c, count: c.count + 1 } : c));
    } else {
      if (sideCnt >= combinedLimit) return;
      if (cardToAdd) {
        // 関連トークンを持つカードを「追加」したタイミングで、トークンデッキに初期値(9)を自動投入
        // ※ユーザーが既に tokenDeck に値を持っている（0含む）場合は上書きしない
        if (Array.isArray(cardToAdd.relatedTokens) && cardToAdd.relatedTokens.length > 0) {
          setTokenDeck(prev => {
            const next = { ...prev };
            let totalSoFar = Object.values(next).reduce((sum, cnt) => sum + Math.max(0, Number(cnt) || 0), 0);
            for (const tokenName of cardToAdd.relatedTokens) {
              const token = cardMapByName.get(tokenName);
              if (!token || !isTokenCard(token)) continue;
              const key = String(token.id);
              if (Object.prototype.hasOwnProperty.call(next, key)) continue;
              const remaining = TOKEN_DECK_MAX_TOTAL - totalSoFar;
              if (remaining <= 0) break;
              const maxT = token.maxTokenDeckCount ?? 4;
              const initial = Math.min(9, maxT, remaining);
              if (initial > 0) {
                next[key] = initial;
                totalSoFar += initial;
              }
            }
            return shallowEqualObj(next, prev) ? prev : next;
          });
        }
        setDeck([...deck, { ...cardToAdd, count: 1 }]);
      }
    }
  }, [cardMapById, cardMapByName, deck, setDeck, setTokenDeck, sideDeck]);

  const decreaseCardCount = React.useCallback((cardId) => {
    const cardToRemove = cardMapById.get(cardId);
    // isTokenCard / 領土カード判定はモジュール最上位 (1 箇所) に集約済み
    const getMaxCount = (c) => (isTokenCard(c) ? 0 : (c?.maxDeckCount ?? 4));
    if (cardToRemove && getMaxCount(cardToRemove) === 0) return;
    setDeck(
      deck
        .map((c) => c.id === cardId ? { ...c, count: c.count - 1 } : c)
        .filter((c) => c.count > 0)
    );
  }, [cardMapById, deck, setDeck]);

  // 502 カード ×（toLowerCase 多数）を毎レンダー走らせると重い。
  // フィルタ状態が変わらない限りキャッシュする。
  const filteredCards = useMemo(() => cardData.filter((card) => {
    // ダブルフェイス対応: 検索・フィルター対象を拡張
    const isDoubleSided = card.isDoubleSided && card.front && card.back;
    // 検索対象テキスト
    const name = isDoubleSided ? `${card.front.name} ${card.back.name}` : card.name;
    const effect = isDoubleSided ? `${card.front.effect || ''} ${card.back.effect || ''}` : card.effect || '';
    const color = isDoubleSided ? [...new Set([...(card.front.color||[]), ...(card.back.color||[])])] : card.color || [];
    const symbol = isDoubleSided ? [...new Set([...(card.front.symbol||[]), ...(card.back.symbol||[])])] : card.symbol || [];
    const type = isDoubleSided ? `${card.front.type} ${card.back.type}` : card.type;
    const rarity = isDoubleSided ? [card.front.rarity||'', card.back.rarity||''] : [card.rarity||''];
    const tribe = isDoubleSided ? `${card.front.tribe||''} ${card.back.tribe||''}` : card.tribe||'';
    const cost = isDoubleSided ? `${card.front.cost} ${card.back.cost}` : card.cost;
    const reduction = isDoubleSided ? [...new Set([...(card.front.reduction||[]), ...(card.back.reduction||[])])] : card.reduction || [];
    const pack = isDoubleSided ? `${card.front.pack||''} ${card.back.pack||''}` : card.pack||'';

    const keyword = search.toLowerCase();
    const matchesSearch =
      name.toLowerCase().includes(keyword) ||
      effect.toLowerCase().includes(keyword) ||
      color.join('').toLowerCase().includes(keyword) ||
      symbol.join('').toLowerCase().includes(keyword) ||
      type.toLowerCase().includes(keyword) ||
      rarity.join(' ').toLowerCase().includes(keyword) ||
      tribe.toLowerCase().includes(keyword) ||
      cost.toString().includes(keyword) ||
      reduction.join('').toLowerCase().includes(keyword) ||
      pack.toLowerCase().includes(keyword);
    const matchesColor = !filterColor || (
      filterColor === '多属性'
        ? (Array.isArray(color) && color.length >= 2)
        : filterColor === '__none__'
          ? (Array.isArray(color) && color.length === 0)
          : (Array.isArray(color) ? color.includes(filterColor) : color === filterColor)
    );
    // プレビューカードはデフォルト非表示。filterType='プレビュー' のときだけ表示対象。
    // 他の type フィルタを指定された場合は preview の type 文字列に該当しないので自動的に除外される。
    const isPreviewType = type === 'プレビュー' || (typeof type === 'string' && type.includes('プレビュー'));
    const matchesType = filterType
      ? (filterType === 'プレビュー' ? isPreviewType : (type.includes ? type.includes(filterType) : type === filterType))
      : !isPreviewType;
    const matchesRarity = !filterRarity || rarity.includes(filterRarity);
    const matchesTribe = !filterTribe || tribe.toLowerCase().includes(filterTribe.toLowerCase());
    const matchesPack = !filterPack || (pack.includes ? pack.includes(filterPack) : pack === filterPack);
    const matchesCost = !filterCost || cost.toString().split(' ').includes(filterCost);
    // 「条件なし」(__none__) は条件配列が空 かつ 領土カードでは無いものに限る
    // (領土カードは条件という概念自体が無いため除外)
    const matchesReduction = !filterReduction || (
      filterReduction === '__none__'
        ? (reduction.length === 0 && !(type.includes ? type.includes('領土') : type === '領土'))
        : reduction.includes(filterReduction)
    );
    return (
      matchesSearch &&
      matchesColor &&
      matchesType &&
      matchesRarity &&
      matchesTribe &&
      matchesPack &&
      matchesCost &&
      matchesReduction
    );
  }), [cardData, search, filterColor, filterType, filterRarity, filterTribe, filterPack, filterCost, filterReduction]);

  const deckCounts = useMemo(() => new Map(deck.map(card => [card.id, card.count])), [deck]);
  const getCardCountInDeck = React.useCallback(cardId => deckCounts.get(cardId) || 0, [deckCounts]);

  // 予備デッキ +/-
  const increaseSideCount = React.useCallback((cardId) => {
    const card = cardMapById.get(cardId);
    if (!card) return;
    const isTerritory = card.type === '領土';
    const primaryCount = isTerritory ? (Number(tokenDeck[cardId]) || 0) : (deck.find(c => c.id === cardId)?.count || 0);
    const limit = getSameNameLimit(card);
    setSideDeck(prev => {
      const cur = Number(prev[cardId]) || 0;
      if (cur >= getSideDeckLimit(card)) return prev;
      if (primaryCount + cur >= limit) return prev;
      // 予備デッキ合計枚数の上限
      const sideTotal = Object.values(prev).reduce((sum, cnt) => sum + Math.max(0, Number(cnt) || 0), 0);
      if (sideTotal >= SIDE_DECK_MAX_TOTAL) return prev;
      return { ...prev, [cardId]: cur + 1 };
    });
  }, [cardMapById, deck, setSideDeck, tokenDeck]);
  const decreaseSideCount = React.useCallback((cardId) => {
    setSideDeck(prev => {
      const cur = Number(prev[cardId]) || 0;
      if (cur <= 0) return prev;
      const next = { ...prev };
      if (cur - 1 <= 0) delete next[cardId];
      else next[cardId] = cur - 1;
      return next;
    });
  }, [setSideDeck]);

  /**
   * 指定デッキ名が開催中(in_progress)のイベントで登録済みかチェック
   * @returns {Promise<string|null>} イベント名 or null
   */
  const getLockedEventName = async (deckNameToCheck) => {
    if (!user || !deckNameToCheck) return null;
    // deck_name または deck_name_2 が一致する参加レコードを取得
    const { data: parts } = await supabase
      .from('event_participants')
      .select('event_id')
      .eq('user_id', user.id)
      .or(`deck_name.eq.${deckNameToCheck},deck_name_2.eq.${deckNameToCheck}`);
    if (!parts || parts.length === 0) return null;
    const eventIds = [...new Set(parts.map(p => p.event_id))];
    const { data: events } = await supabase
      .from('events')
      .select('id, name, status')
      .in('id', eventIds)
      .eq('game', APP_GAME_ID)
      .in('status', ['in_progress', 'recruiting']);
    if (events && events.length > 0) return events[0].name;
    return null;
  };

  const saveCurrentDeck = async () => {
    if (!deckName) {
      alert('デッキ名を入力してください');
      return;
    }
    // 最小形式で保存（id, count, isDeckThumbnail のみ）
    const minimalCards = deck.map(c => ({ id: c.id, count: c.count || 0, isDeckThumbnail: !!c.isDeckThumbnail }));
    // 0枚は保存しない（領土0枚なら「領土無し」として扱えるようにする）
    const minimalTokens = Object.entries(tokenDeck)
      .map(([id, count]) => ({ id: Number(id), count: Number(count) || 0 }))
      .filter(t => t.count > 0);
    const minimalSide = Object.entries(sideDeck)
      .map(([id, count]) => ({ id: Number(id), count: Number(count) || 0 }))
      .filter(s => s.count > 0);

    const normalizedThumbId = (() => {
      const id = Number(deckThumbnailCardId);
      if (!Number.isFinite(id)) return null;
      const inMain = deck.some(c => Number(c.id) === id);
      const inTokens = (Number(tokenDeck?.[id]) || 0) > 0;
      return (inMain || inTokens) ? id : null;
    })();

    const fallbackThumbId =
      normalizedThumbId ??
      (deck.find(c => c.isDeckThumbnail)?.id ?? deck[0]?.id ?? minimalTokens[0]?.id ?? null);
    // 既存デッキ名チェック
    const existingIdx = savedDecks.findIndex(d => d.name === deckName);
    if (existingIdx !== -1) {
      // イベントロックチェック
      const lockedBy = await getLockedEventName(deckName);
      if (lockedBy) { alert(`デッキ「${deckName}」はイベント「${lockedBy}」で使用されているため、編集できません。\nイベントページでデッキ登録を解除してから編集してください。`); return; }
      if (!window.confirm(`デッキ「${deckName}」を上書きしますか？`)) return;
      // 上書き
      const updatedDecks = savedDecks.map((d, i) =>
        i === existingIdx ? { name: d.name, cards: minimalCards, tokenDeck: minimalTokens, sideDeck: minimalSide, thumbnailCardId: fallbackThumbId } : d
      );
      setSavedDecks(updatedDecks);
      setCurrentDeckName(deckName);
      setDeckName('');
      // クラウド同期（失敗時はユーザーに通知）
      if (user) {
        const { error } = await upsertCloudDeck(user.id, { name: deckName, cards: minimalCards, tokenDeck: minimalTokens, sideDeck: minimalSide, thumbnailCardId: fallbackThumbId });
        if (error) {
          alert(`デッキ「${deckName}」を上書き保存しました（ただしクラウド同期に失敗: ${error.message ?? error}）`);
          return;
        }
      }
      alert(`デッキ「${deckName}」を上書き保存しました！`);
      return;
    }
    const newDeck = {
      name: deckName,
      cards: minimalCards,
      tokenDeck: minimalTokens,
      sideDeck: minimalSide,
      thumbnailCardId: fallbackThumbId,
    };
    setSavedDecks([...savedDecks, newDeck]);
    setCurrentDeckName(deckName);
    setDeckName('');
    // クラウド同期（失敗時はユーザーに通知）
    if (user) {
      const { error } = await upsertCloudDeck(user.id, newDeck);
      if (error) {
        alert(`デッキ「${deckName}」を保存しました（ただしクラウド同期に失敗: ${error.message ?? error}）`);
        return;
      }
    }
    alert(`デッキ「${deckName}」を保存しました！`);
  };

  const loadDeck = (name) => {
    const selectedDeck = savedDecks.find((d) => d.name === name);
    if (selectedDeck) {
      // 保存デッキのカードを最新データに再結合してロード
      const hydrated = rehydrateCards(selectedDeck.cards);
      setDeck(hydrated);
      // トークンデッキもロード（旧形式: tokenDeckが無い場合は関連トークンを9枚として初期化）
      const hasTokenDeckField = Object.prototype.hasOwnProperty.call(selectedDeck, 'tokenDeck');
      const map = {};
      if (hasTokenDeckField) {
        if (Array.isArray(selectedDeck.tokenDeck)) {
          for (const t of selectedDeck.tokenDeck) {
            if (!t || typeof t.id === 'undefined') continue;
            const cnt = Number(t.count) || 0;
            if (cnt > 0) map[Number(t.id)] = cnt;
          }
        } else if (selectedDeck.tokenDeck && typeof selectedDeck.tokenDeck === 'object') {
          for (const [id, cntRaw] of Object.entries(selectedDeck.tokenDeck)) {
            const cnt = Number(cntRaw) || 0;
            if (cnt > 0) map[Number(id)] = cnt;
          }
        }
      } else {
        // 旧型は「関連トークン=9枚」で読み込み
        const legacyTokenCards = collectRelatedTokensFromCards(hydrated);
        for (const t of legacyTokenCards) {
          const maxT = t.maxTokenDeckCount ?? 4;
          const cnt = Math.min(9, maxT);
          if (cnt > 0) map[Number(t.id)] = cnt;
        }
      }
      setTokenDeck(map);

      // 予備デッキの復元 (旧形式 sideDeck 無しならカラ)
      const sideMap = {};
      const rawSide = selectedDeck.sideDeck;
      if (Array.isArray(rawSide)) {
        for (const s of rawSide) {
          if (!s || typeof s.id === 'undefined') continue;
          const cnt = Number(s.count) || 0;
          if (cnt > 0) sideMap[Number(s.id)] = cnt;
        }
      } else if (rawSide && typeof rawSide === 'object') {
        for (const [id, cntRaw] of Object.entries(rawSide)) {
          const cnt = Number(cntRaw) || 0;
          if (cnt > 0) sideMap[Number(id)] = cnt;
        }
      }
      setSideDeck(sideMap);

      // サムネイルIDも復元（なければ従来のisDeckThumbnail/先頭カード/先頭トークン）
      const thumbFromCards = hydrated.find(c => c.isDeckThumbnail)?.id ?? hydrated[0]?.id ?? null;
      const thumbFromTokens = Object.entries(map).find(([, cnt]) => (Number(cnt) || 0) > 0)?.[0];
      const thumbId =
        (selectedDeck.thumbnailCardId ?? null) ??
        thumbFromCards ??
        (thumbFromTokens ? Number(thumbFromTokens) : null);
      setDeckThumbnailCardId(thumbId);

      setCurrentDeckName(selectedDeck.name);
      setDeckName(selectedDeck.name);
      setActiveTab('deck');
    }
  };

  const createNewDeck = () => {
    setDeck([]);
    setTokenDeck({});
    setSideDeck({});
    setDeckThumbnailCardId(null);
    setCurrentDeckName('');
    setDeckName('');
    setActiveTab('deck');
  };

  const deleteDeckByName = async (name) => {
    // イベントロックチェック
    const lockedBy = await getLockedEventName(name);
    if (lockedBy) { alert(`デッキ「${name}」はイベント「${lockedBy}」で使用されているため、削除できません。\nイベントページでデッキ登録を解除してから削除してください。`); return; }
    const confirmDelete = window.confirm(`デッキ「${name}」を削除しますか？`);
    if (!confirmDelete) return;
    const updatedDecks = savedDecks.filter((deck) => deck.name !== name);
    setSavedDecks(updatedDecks);
    // クラウドからも削除（失敗時はユーザーに通知）
    if (user) {
      const { error } = await deleteCloudDeck(user.id, name);
      if (error) {
        alert(`デッキ「${name}」を削除しました（ただしクラウド同期に失敗: ${error.message ?? error}）`);
      }
    }
    if (name === currentDeckName) {
      setCurrentDeckName('');
      setDeckName('');
      setDeck([]);
      setTokenDeck({});
      setSideDeck({});
      setDeckThumbnailCardId(null);
    }
    alert(`デッキ「${name}」を削除しました！`);
    if (updatedDecks.length > 0) {
      setActiveTab('saved');
    } else {
      setActiveTab('deck');
    }
  };

  // グリッド1セルの高さ（react-window用）
  const CARD_GRID_HEIGHT = 160; // 例: 160px 固定（必要に応じて調整）

  // react-window用: カードリスト1行


  // react-window用: グリッド1セル
  // section: 'search' | 'basic' | 'territory' | 'side'
  //  - 'search' (デフォルト): sideMode に応じて基礎/領土 or 予備を単色バッジで表示・+/- 操作
  //  - 'basic'/'territory': 当該セクションの単独カウント + 単色バッジ、+/- は当該デッキ
  //  - 'side': 予備カウントのみ、緑バッジ、+/- なし (詳細モーダルで操作)


  // 端末幅に合わせてリスト/グリッドの幅・高さを可変に（最低幅320px）
  const [listSize, setListSize] = useState({ width: Math.max(window.innerWidth, 320), height: 600 });
  useEffect(() => {
    const handleResize = () => {
      const width = Math.max(window.innerWidth, 320); // 最低320px
      setListSize({ width, height: 600 });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const touchStart = useRef({ x: null, y: null });
  const touchEnd = useRef({ x: null, y: null });

  // スワイプ判定用共通関数
  const useSwipeTab = (containerRef) => {
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      el.style.touchAction = 'pan-y';
      const handleTouchStart = e => {
        // 横スクロール要素（[data-no-tab-swipe]）内のタッチではタブスワイプを発火させない
        if (e.target && e.target.closest && e.target.closest('[data-no-tab-swipe]')) {
          touchStart.current = { x: null, y: null };
          return;
        }
        const t = e.touches[0];
        touchStart.current = { x: t.clientX, y: t.clientY };
      };
      const handleTouchEnd = e => {
        if (touchStart.current.x === null || touchStart.current.y === null) return;
        const t = e.changedTouches[0];
        touchEnd.current = { x: t.clientX, y: t.clientY };
        const dx = touchEnd.current.x - touchStart.current.x;
        const dy = touchEnd.current.y - touchStart.current.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
          const idx = tabOrder.indexOf(activeTab);
          if (dx < 0 && idx < tabOrder.length - 1) setActiveTab(tabOrder[idx + 1]);
          else if (dx > 0 && idx > 0) setActiveTab(tabOrder[idx - 1]);
        }
        touchStart.current = { x: null, y: null };
        touchEnd.current = { x: null, y: null };
      };
      el.addEventListener('touchstart', handleTouchStart, { passive: true });
      el.addEventListener('touchend', handleTouchEnd, { passive: true });
      return () => {
        el.removeEventListener('touchstart', handleTouchStart);
        el.removeEventListener('touchend', handleTouchEnd);
      };
      // activeTab はイベント発火時のクロージャで参照するため依存に必要だが、
      // useSwipeTab を App 内で定義しているため eslint が state と認識できず誤検知する。
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, tabOrder, containerRef]);
  };
  useSwipeTab(listContainerRef);
  useSwipeTab(deckContainerRef);
  useSwipeTab(savedContainerRef);
  useSwipeTab(qaContainerRef);
  useSwipeTab(homeContainerRef);
  useSwipeTab(searchContainerRef);

  // react-windowラッパーにtouch-action: pan-yを明示（JSでstyle付与）
  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    el.style.touchAction = 'pan-y';
    // react-window内部のスクロールラッパーにも適用
    const inner = el.querySelector('.ReactVirtualized__Grid, .ReactVirtualized__List');
    if (inner) inner.style.touchAction = 'pan-y';
  }, [viewMode, listSize]);

  // ネイティブtouchイベントでスワイプ判定
  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    const handleTouchStart = e => {
      const t = e.touches[0];
      touchStart.current = { x: t.clientX, y: t.clientY };
    };
    const handleTouchEnd = e => {
      if (touchStart.current.x === null || touchStart.current.y === null) return;
      const t = e.changedTouches[0];
      touchEnd.current = { x: t.clientX, y: t.clientY };
      const dx = touchEnd.current.x - touchStart.current.x;
      const dy = touchEnd.current.y - touchStart.current.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        const idx = tabOrder.indexOf(activeTab);
        if (dx < 0 && idx < tabOrder.length - 1) setActiveTab(tabOrder[idx + 1]);
        else if (dx > 0 && idx > 0) setActiveTab(tabOrder[idx - 1]);
      }
      touchStart.current = { x: null, y: null };
      touchEnd.current = { x: null, y: null };
    };
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [activeTab, tabOrder]);

  // アイテムにもtouchイベント
  const itemTouchHandlers = useMemo(() => ({
    onTouchStart: e => {
      const t = e.touches[0];
      touchStart.current = { x: t.clientX, y: t.clientY };
    },
    onTouchEnd: e => {
      if (touchStart.current.x === null || touchStart.current.y === null) return;
      const t = e.changedTouches[0];
      touchEnd.current = { x: t.clientX, y: t.clientY };
      const dx = touchEnd.current.x - touchStart.current.x;
      const dy = touchEnd.current.y - touchStart.current.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        const idx = tabOrder.indexOf(activeTab);
        if (dx < 0 && idx < tabOrder.length - 1) setActiveTab(tabOrder[idx + 1]);
        else if (dx > 0 && idx > 0) setActiveTab(tabOrder[idx - 1]);
      }
      touchStart.current = { x: null, y: null };
      touchEnd.current = { x: null, y: null };
    }
  }), [activeTab, setActiveTab, tabOrder, touchEnd, touchStart]);

  // グリッド用カラム数・カラム幅・高さ（カード画像サイズに合わせる）
  const gridColumns = 4;
  const gridColWidth = Math.max(Math.floor(listSize.width / gridColumns), 80); // 最低80px
  // カード画像のアスペクト比3:4、幅はグリッド幅の92%を画像に使う
  const gridImgWidth = Math.floor(gridColWidth * 0.92);
  const gridImgHeight = Math.floor(gridImgWidth * 561 / 385);
  // セルの高さは画像サイズ＋余白（上下4%ずつ）
  const gridRowHeight = Math.floor(gridImgHeight / 0.92);

  // カード詳細モーダル
  // function CardDetailModal({ card, show, onClose, onSetDeckThumbnail, inDeck, countInDeck, onIncrease, onDecrease }) {
  //   if (!show || !card) return null;
  //   // ダブルフェイス対応
  //   const [showFront, setShowFront] = React.useState(true);
  //   const isDoubleSided = card.isDoubleSided && card.front && card.back;
  //   const activeSide = isDoubleSided ? (showFront ? card.front : card.back) : card;
  //   const maxCount = card.maxDeckCount ?? 4;
  //   return (
  //     <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
  //       <div style={{ background: '#fff', padding: '1.2em 1em 1em 1em', borderRadius: 14, maxWidth: 420, width: '95vw', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }} onClick={e => e.stopPropagation()}>
  //         <button className="card-detail-close-btn" onClick={onClose} style={{ position: 'absolute', top: 8, right: 12 }}>×</button>
  //         <div style={{ textAlign: 'center' }}>
  //           <img src={activeSide.image} alt={activeSide.name} style={{ width: '100%', maxWidth: 260, height: 'auto', objectFit: 'cover', borderRadius: 10, marginBottom: '0.7em' }} />
  //         </div>
  //         {isDoubleSided && (
  //           <button style={{ display: 'block', margin: '0 auto 1em auto', padding: '0.3em 1.2em', border: '1px solid #1976d2', background: '#fff', color: '#1976d2', borderRadius: 6, cursor: 'pointer' }} onClick={() => setShowFront(f => !f)}>
  //             {showFront ? '裏面を見る' : '表面に戻す'}
  //           </button>
  //         )}
  //         <div style={{ minHeight: '2.5em', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1em' }}>
  //           {/* デッキ画像に指定ボタンのスペースを常に確保 */}
  //           {onSetDeckThumbnail && inDeck && (card.maxDeckCount ?? 4) > 0 && !card.isBanned ? (
  //             <button style={{ display: 'block', margin: '0 auto', padding: '0.3em 1.2em', border: '1px solid #388e3c', background: '#fff', color: '#388e3c', borderRadius: 6, cursor: 'pointer' }} onClick={() => { onSetDeckThumbnail(card.id); onClose(); }}>
  //               デッキ画像に指定
  //             </button>
  //           ) : (
  //             <span style={{ display: 'inline-block', width: '8.5em', height: '2.2em' }}></span>
  //           )}
  //         </div>
  //         <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.7em', marginBottom: '1em' }}>
  //           {maxCount > 0 ? (
  //             <>
  //               <button onClick={() => onDecrease(card.id)} style={{ width: '2.2em', height: '2.2em', borderRadius: '50%', background: '#1976d2', color: '#fff', fontSize: '1.3em', border: 'none' }}>-</button>
  //               <span style={{ fontSize: '1.1em' }}>{countInDeck} / {maxCount}</span>
  //               <button onClick={() => onIncrease(card.id)} style={{ width: '2.2em', height: '2.2em', borderRadius: '50%', background: '#1976d2', color: '#fff', fontSize: '1.3em', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1, textAlign: 'center' }}>+</button>
  //             </>
  //           ) : (
  //             <span style={{ color: '#d32f2f', fontWeight: 'bold', fontSize: '1.0em' }}>このカードはデッキに入れられません。</span>
  //           )}
  //         </div>
  //         <h2 style={{ fontSize: '1.3em', fontWeight: 'bold', marginBottom: '0.5em' }}>{activeSide.name}</h2>
  //         <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.7em 1.2em', fontSize: '0.97em', color: '#555', marginBottom: '0.7em' }}>
  //           <span>属性: {(activeSide.color||[]).join('・') || '-'}</span>
  //           <span>コスト: {activeSide.cost}</span>
  //           <span>{activeSide.reduction && activeSide.reduction.length ? `条件: ${activeSide.reduction.join('・')}` : ''}</span>
  //           <span>カード種類: {activeSide.type}</span>
  //           <span>種族: {activeSide.tribe||'-'}</span>
  //         </div>
  //         {activeSide.levels && (
  //           <div style={{ marginBottom: '0.7em', overflowX: 'auto' }}>
  //             <table style={{ width: '100%', fontSize: '0.97em', borderCollapse: 'collapse' }}>
  //               <thead>
  //                 <tr>
  //                   <th style={{ border: '1px solid #ddd', padding: '2px 6px', background: '#f5f5f5' }}></th>
  //                   {activeSide.levels.map(l => (
  //                     <th key={l.level} style={{ border: '1px solid #ddd', padding: '2px 6px', background: '#f5f5f5' }}>{l.level} ({l.cost})</th>
  //                   ))}
  //                   {card.ocBoost && (
  //                     <th style={{ border: '1px solid #ddd', padding: '2px 6px', background: '#f5f5f5', color: '#d32f2f', fontWeight: 'bold' }}>OC({card.ocBoost.levelLabel.replace('OC','')})</th>
  //                   )}
  //                   {(['ブレイヴ', '契約ブレイヴ'].includes(activeSide.type)) && activeSide.combinedBoost && (
  //                     <th style={{ border: '1px solid #ddd', padding: '2px 6px', background: '#f5f5f5',color: '#1976d2', fontWeight: 'bold' }}>合体中</th>
  //                   )}
  //                 </tr>
  //               </thead>
  //               <tbody>
  //                 <tr>
  //                   <td style={{ border: '1px solid #ddd', padding: '2px 6px', background: '#f5f5f5' }}>BP</td>
  //                   {activeSide.levels.map(l => ([
  //                     'スピリット', 'アルティメット', 'ブレイヴ', '契約スピリット', '契約ブレイヴ'
  //                   ].includes(activeSide.type) ? (
  //                     <td key={l.level} style={{ border: '1px solid #ddd', padding: '2px 6px' }}>{l.bp ?? '-'}</td>
  //                   ) : (
  //                     <td key={l.level} style={{ border: '1px solid #ddd', padding: '2px 6px' }}>-</td>
  //                   )))}
  //                   {card.ocBoost && (
  //                     <td style={{ border: '1px solid #ddd', padding: '2px 6px', color: '#d32f2f', fontWeight: 'bold' }}>{card.ocBoost.bp}</td>
  //                   )}
  //                   {(['ブレイヴ', '契約ブレイヴ'].includes(activeSide.type)) && activeSide.combinedBoost && (
  //                     <td style={{ border: '1px solid #ddd', padding: '2px 6px', color: '#1976d2', fontWeight: 'bold' }}>+{activeSide.combinedBoost}</td>
  //                   )}
  //                 </tr>
  //               </tbody>
  //             </table>
  //           </div>
  //         )}
  //         <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.7em 1.2em', fontSize: '0.97em', color: '#555', marginBottom: '0.7em' }}>
  //           <span>レアリティ: {activeSide.rarity||'-'}</span>
  //           <span>収録弾: {activeSide.pack||'-'}</span>
  //           <span>カード番号: {activeSide.cardNumber||'-'}</span>
  //         </div>
  //         <div style={{ fontSize: '0.98em', color: '#222', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{activeSide.effect||''}</div>
  //       </div>
  //     </div>
  //   );
  // }

  // カード詳細モーダル表示用state
  const [detailCard, setDetailCard] = useState(null);
  const [detailHideDeckActions, setDetailHideDeckActions] = useState(false);

  // カード詳細を開く
  const openCardDetail = React.useCallback((card, opts = {}) => {
    setDetailCard(card);
    setDetailHideDeckActions(!!opts.hideDeckActions);
    setShowFront(true); // 新しく開くたびに表面にリセット
  }, [setDetailCard, setDetailHideDeckActions, setShowFront]);
  // カード詳細を閉じる
  const closeCardDetail = () => {
    setDetailCard(null);
    setDetailHideDeckActions(false);
  };

  // スクロール位置保存用
  const searchListScrollRef = useRef(0);

  // 検索タブのリスト/グリッドのスクロール位置を保存
  useEffect(() => {
    if (activeTab !== 'search') {
      // タブを離れるときに現在のスクロール位置を保存
      const el = listContainerRef.current;
      if (el) {
        searchListScrollRef.current = el.scrollTop;
      }
    }
  }, [activeTab]);

  // 検索タブに戻ったときにスクロール位置を復元
  useEffect(() => {
    if (activeTab === 'search') {
      const el = listContainerRef.current;
      if (el) {
        setTimeout(() => {
          el.scrollTop = searchListScrollRef.current;
        }, 0);
      }
    }
  }, [activeTab, viewMode, listSize.width, listSize.height]);

  // 全タブ共通のスクロール位置をタブごとに保持
  // (実際にスクロールしているのは .tab-content-wrap (= tabContentWrapRef) で
  //  全タブ共用の1要素のため、タブ切替時に保存/復元しないと位置が失われる)
  const tabScrollMapRef = useRef({});
  const prevActiveTabRef = useRef(activeTab);
  if (prevActiveTabRef.current !== activeTab) {
    // レンダー時点では DOM はまだ旧タブを表示中なので scrollTop は正確。
    const el = tabContentWrapRef.current;
    if (el) {
      tabScrollMapRef.current[prevActiveTabRef.current] = el.scrollTop;
    }
    prevActiveTabRef.current = activeTab;
  }
  useEffect(() => {
    const el = tabContentWrapRef.current;
    if (!el) return;
    const saved = tabScrollMapRef.current[activeTab] ?? 0;
    const id = requestAnimationFrame(() => {
      el.scrollTop = saved;
    });
    return () => cancelAnimationFrame(id);
  }, [activeTab]);

  // デッキ詳細ウィンドウ用state
  const [detailDeck, setDetailDeck] = useState(null);
  // デッキ公開フォーム用state (DeckSubmitModal 表示対象)
  const [submitDeck, setSubmitDeck] = useState(null);
  // ホームの「みんなのデッキ」を再取得させるためのキー。公開/非公開化のたびにインクリメント。
  const [publicDecksRefreshKey, setPublicDecksRefreshKey] = useState(0);
  // ホームタブ内のサブページ ('main' | 'publicDecksAll'): タブ切替後も維持される
  const [homeSubPage, setHomeSubPage] = useState('main');
  // メインホーム画面のスクロール位置（サブページから戻った時に復元）
  const homeMainScrollRef = useRef(0);

  // ブラウザ「戻る」ボタンでサブページ→メインに戻すための popstate ハンドラ
  useEffect(() => {
    const onPopState = (e) => {
      const next = e.state?.homeSubPage;
      setHomeSubPage(next === 'publicDecksAll' ? 'publicDecksAll' : 'main');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // サブページ「みんなのデッキ全件」へ遷移（履歴に積む + メインのスクロール位置を退避）
  const enterPublicDecksAll = useCallback(() => {
    if (homeContainerRef.current) {
      homeMainScrollRef.current = homeContainerRef.current.scrollTop;
    }
    setHomeSubPage('publicDecksAll');
    try {
      window.history.pushState({ homeSubPage: 'publicDecksAll' }, '', '#みんなのデッキ');
    } catch { /* file:// 環境などで失敗しても処理続行 */ }
    if (homeContainerRef.current) homeContainerRef.current.scrollTop = 0;
  }, []);

  // サブページからメインに戻る（履歴を1つ戻すことで popstate ハンドラ経由でも動かす）
  const exitToHomeMain = useCallback(() => {
    try {
      if (window.history.state?.homeSubPage === 'publicDecksAll') {
        window.history.back();
      } else {
        setHomeSubPage('main');
      }
    } catch {
      setHomeSubPage('main');
    }
  }, []);

  // メイン復帰時にスクロール位置を復元（描画後に反映するため次フレームで実行）
  useEffect(() => {
    if (homeSubPage === 'main' && homeContainerRef.current) {
      const restored = homeMainScrollRef.current;
      requestAnimationFrame(() => {
        if (homeContainerRef.current) homeContainerRef.current.scrollTop = restored;
      });
    }
  }, [homeSubPage]);

  // デッキを非公開にする (詳細モーダルの「公開中 ▼」→ 非公開にする から呼ばれる)
  const handleUnpublishDeck = useCallback(async (deck) => {
    if (!user) { alert('ログインが必要です'); return; }
    if (!window.confirm(`「${deck.name}」を非公開にしますか？\n（みんなのデッキ一覧から外れます。デッキ内容や説明は保持されます）`)) return;
    const result = await upsertCloudDeck(user.id, { ...deck, isPublic: false });
    if (result.error) {
      alert(`非公開化に失敗しました: ${result.error.message || result.error}`);
      return;
    }
    setSavedDecks(decks => decks.map(d => d.name === deck.name ? { ...d, isPublic: false } : d));
    setDetailDeck(d => (d?.name === deck.name ? { ...d, isPublic: false } : d));
    setPublicDecksRefreshKey(k => k + 1);
  }, [user]);

  // 他人の公開デッキを作成中デッキ (deck builder) にコピーして開く
  // - 既存の作成中デッキに内容があれば上書き確認
  // - currentDeckName はクリア (=「既存デッキ編集」ではなく新規ドラフト扱い)
  // - deckName には元の名前 + (コピー) を付与してユーザーに編集を促す
  // - タブを自動で「作成中デッキ」へ
  const copyForeignDeckToBuilder = useCallback((foreignDeck) => {
    const hasContent = deck.length > 0
      || Object.values(tokenDeck).some(v => (Number(v) || 0) > 0)
      || Object.values(sideDeck).some(v => (Number(v) || 0) > 0);
    if (hasContent) {
      if (!window.confirm('現在の「作成中デッキ」を上書きします。よろしいですか？\n（保存済みデッキは影響を受けません）')) return;
    }

    const hydrated = rehydrateCards(foreignDeck.cards || []);
    setDeck(hydrated);

    const tokenMap = {};
    const rawToken = foreignDeck.tokenDeck;
    if (Array.isArray(rawToken)) {
      for (const t of rawToken) {
        if (!t || typeof t.id === 'undefined') continue;
        const cnt = Number(t.count) || 0;
        if (cnt > 0) tokenMap[Number(t.id)] = cnt;
      }
    } else if (rawToken && typeof rawToken === 'object') {
      for (const [id, cntRaw] of Object.entries(rawToken)) {
        const cnt = Number(cntRaw) || 0;
        if (cnt > 0) tokenMap[Number(id)] = cnt;
      }
    }
    setTokenDeck(tokenMap);

    const sideMap = {};
    const rawSide = foreignDeck.sideDeck;
    if (Array.isArray(rawSide)) {
      for (const s of rawSide) {
        if (!s || typeof s.id === 'undefined') continue;
        const cnt = Number(s.count) || 0;
        if (cnt > 0) sideMap[Number(s.id)] = cnt;
      }
    } else if (rawSide && typeof rawSide === 'object') {
      for (const [id, cntRaw] of Object.entries(rawSide)) {
        const cnt = Number(cntRaw) || 0;
        if (cnt > 0) sideMap[Number(id)] = cnt;
      }
    }
    setSideDeck(sideMap);

    const thumbFromCards = hydrated.find(c => c.isDeckThumbnail)?.id ?? hydrated[0]?.id ?? null;
    const thumbFromTokens = Object.entries(tokenMap).find(([, cnt]) => (Number(cnt) || 0) > 0)?.[0];
    const thumbId =
      (foreignDeck.thumbnailCardId ?? null) ??
      thumbFromCards ??
      (thumbFromTokens ? Number(thumbFromTokens) : null);
    setDeckThumbnailCardId(thumbId);

    setCurrentDeckName(''); // 新規ドラフト扱い (元の同名デッキを誤って上書きしない)
    setDeckName(`${foreignDeck.name} (コピー)`);

    setDetailDeck(null);
    setActiveTab('deck');
    // rehydrateCards はレンダー間で実質不変のヘルパー。引数の foreignDeck を変換するだけで依存に含める必要はない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, tokenDeck, sideDeck]);

  // DeckSubmitModal で公開成功した時のローカル state 反映
  const handleDeckSubmitted = useCallback((updatedDeck) => {
    setSavedDecks(decks => decks.map(d =>
      d.name === updatedDeck.name
        ? { ...d, isPublic: true, description: updatedDeck.description, tags: updatedDeck.tags }
        : d
    ));
    setDetailDeck(d => (d?.name === updatedDeck.name
      ? { ...d, isPublic: true, description: updatedDeck.description, tags: updatedDeck.tags }
      : d));
    setSubmitDeck(null);
    setPublicDecksRefreshKey(k => k + 1);
  }, []);

  // デッキをA4・3x3グリッドでPDF出力する関数
  // PDF出力: 1ページごとにファイル分割・デッキ名-順番_総数.pdf・ダブルフェイス対応
  async function exportDeckToA4PDF(deck) {
    const { default: jsPDF } = await import('jspdf');
    if (!deck) {
      alert('デッキにカードがありません');
      return;
    }
    const mainCards = Array.isArray(deck.cards) ? deck.cards : [];
    const pageWidth = 210;
    const pageHeight = 297;
    const cellW = 63; // mm
    const cellH = 88; // mm
    const gridCols = 3;
    const gridRows = 3;
    const totalGridW = cellW * gridCols;
    const totalGridH = cellH * gridRows;
    const marginX = (pageWidth - totalGridW) / 2;
    const marginY = (pageHeight - totalGridH) / 2;

    // デッキの合計枚数を計算（トークン含む）
    // 現行仕様: tokenDeckの枚数を反映し、0枚のトークンは「無し」扱い
    // 旧型: tokenDeckフィールドが無い場合のみ、関連トークンを9枚として扱う
    const hasTokenDeckField = deck && Object.prototype.hasOwnProperty.call(deck, 'tokenDeck');
    const tokenCountMap = new Map();
    if (Array.isArray(deck.tokenDeck)) {
      for (const t of deck.tokenDeck) {
        if (!t || typeof t.id === 'undefined') continue;
        const cnt = Number(t.count) || 0;
        if (cnt > 0) tokenCountMap.set(Number(t.id), cnt);
      }
    } else if (deck.tokenDeck && typeof deck.tokenDeck === 'object') {
      for (const [id, cntRaw] of Object.entries(deck.tokenDeck)) {
        const cnt = Number(cntRaw) || 0;
        if (cnt > 0) tokenCountMap.set(Number(id), cnt);
      }
    }

    const relatedTokensAll = Array.isArray(deck.relatedTokens) ? deck.relatedTokens : [];
    const relatedIdSet = new Set(relatedTokensAll.map(t => Number(t.id)));
    const extraTokenIds = hasTokenDeckField
      ? Array.from(tokenCountMap.keys()).filter(id => !relatedIdSet.has(Number(id)))
      : [];
    const extraTokenCards = extraTokenIds
      .map(id => cardMapById.get(Number(id)))
      .filter(Boolean);

    const tokenCards = [...relatedTokensAll, ...extraTokenCards]
      .map(tc => {
        const id = Number(tc.id);
        const fromMap = tokenCountMap.get(id);
        const legacyDefault = !hasTokenDeckField
          ? Math.min(9, tc.maxTokenDeckCount ?? 4)
          : 0;
        const count = (typeof fromMap === 'number') ? fromMap : legacyDefault;
        return { card: tc, count };
      })
      .filter(x => (Number(x.count) || 0) > 0);

    // 予備デッキ (sideDeck) を解決。array / object 両形式を許容。
    const sideCountMap = new Map();
    if (Array.isArray(deck.sideDeck)) {
      for (const s of deck.sideDeck) {
        if (!s || typeof s.id === 'undefined') continue;
        const cnt = Number(s.count) || 0;
        if (cnt > 0) sideCountMap.set(Number(s.id), cnt);
      }
    } else if (deck.sideDeck && typeof deck.sideDeck === 'object') {
      for (const [id, cntRaw] of Object.entries(deck.sideDeck)) {
        const cnt = Number(cntRaw) || 0;
        if (cnt > 0) sideCountMap.set(Number(id), cnt);
      }
    }
    const sideCards = Array.from(sideCountMap.entries())
      .map(([id, count]) => {
        const card = cardMapById.get(Number(id));
        return card ? { card, count } : null;
      })
      .filter(Boolean);

    const mainTotal = mainCards.reduce((sum, c) => sum + (c.count || 0), 0);
    const tokenTotal = tokenCards.reduce((sum, t) => sum + (Number(t.count) || 0), 0);
    const sideTotal = sideCards.reduce((sum, s) => sum + (Number(s.count) || 0), 0);

    // メイン0枚・トークン0枚・予備0枚なら出力不可
    if (mainTotal <= 0 && tokenTotal <= 0 && sideTotal <= 0) {
      alert('デッキにカードがありません');
      return;
    }

    let totalDeckCount = 0;
    for (const card of mainCards) {
      totalDeckCount += card.count || 1;
    }
    for (const t of tokenCards) {
      totalDeckCount += Number(t.count) || 0;
    }
    for (const s of sideCards) {
      totalDeckCount += Number(s.count) || 0;
    }

    // ページごとの画像リストを作成。
    // 順序: 基礎 → 予備 → 領土。各セクション内はデッキ内枚数の降順 (stable sort で同枚数は格納順を維持)。
    // 27枚 (= 9マス × 3ページ) 以下なら実枚数分、28枚以上は Math.ceil(count / 4) で集約。
    // ACG は同名カード最大4枚なので、28枚以上は実質「種類ごとに1マス」に集約される。
    const compactRepeat = (count) => {
      const n = Number(count) || 0;
      return totalDeckCount <= 27 ? n : Math.ceil(n / 4);
    };

    let cardImages = [];

    // 基礎デッキ
    const sortedMain = [...mainCards].sort((a, b) => (b.count || 0) - (a.count || 0));
    for (const card of sortedMain) {
      const isDoubleSided = card.isDoubleSided && card.front && card.back;
      const repeat = compactRepeat(card.count || 1);
      for (let i = 0; i < repeat; i++) {
        if (isDoubleSided) {
          cardImages.push(card.front.image);
          cardImages.push(card.back.image);
        } else {
          cardImages.push(card.image);
        }
      }
    }

    // 予備デッキ。ダブルフェイスは両面を並べる。
    if (sideCards.length > 0) {
      const sortedSide = [...sideCards].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
      for (const { card: sideCard, count } of sortedSide) {
        const sideRepeat = compactRepeat(count);
        const isDoubleSided = sideCard.isDoubleSided && sideCard.front && sideCard.back;
        for (let i = 0; i < sideRepeat; i++) {
          if (isDoubleSided) {
            cardImages.push(sideCard.front.image);
            cardImages.push(sideCard.back.image);
          } else {
            cardImages.push(sideCard.image);
          }
        }
      }
    }

    // 領土デッキ (トークン)。旧型 (tokenDeck フィールド無し) は9枚扱いで legacyDefault 適用済み。
    if (tokenCards.length > 0) {
      const sortedTokens = [...tokenCards].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
      for (const { card: tokenCard, count } of sortedTokens) {
        const tokenRepeat = compactRepeat(count);
        for (let i = 0; i < tokenRepeat; i++) {
          cardImages.push(tokenCard.image);
        }
      }
    }

    // 画像をbase64化（軽い圧縮処理付き）
    async function fetchImageAsDataUrl(url) {
      let fetchUrl = url;
      if (!/^https?:/.test(url) && !url.startsWith('data:')) {
        fetchUrl = url.startsWith('/') ? url : `/${url}`;
      }
      const res = await fetch(fetchUrl);
      const blob = await res.blob();

      // 軽い圧縮でPDFサイズを10MB未満に抑える（印刷品質重視）
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          // リサイズ: 最大幅800px（印刷品質を保持）
          const maxWidth = 800;
          const scale = Math.min(1, maxWidth / img.width);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;

          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          // JPEG品質99%で軽い圧縮（印刷品質重視）
          resolve(canvas.toDataURL('image/jpeg', 0.99));
        };
        img.onerror = reject;

        const reader = new FileReader();
        reader.onloadend = () => {
          img.src = reader.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    const dataUrls = [];
    for (let i = 0; i < cardImages.length; i++) {
      try {
        dataUrls.push(await fetchImageAsDataUrl(cardImages[i]));
      } catch {
        dataUrls.push(null);
      }
    }

    // 1ページごとにファイルを分割
    const totalPages = Math.ceil(dataUrls.length / (gridCols * gridRows));
    const iOSMode = isIOSDevice();
    const outFiles = [];
    for (let page = 0; page < totalPages; page++) {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      // ヘッダー（グリッドより上に配置）。現行仕様: 基礎/領土/予備 を併記
      try {
        doc.setFontSize(10);
        const parts = [`基礎デッキ${mainTotal}枚`];
        if (tokenTotal > 0) parts.push(`領土デッキ${tokenTotal}枚`);
        if (sideTotal > 0) parts.push(`予備デッキ${sideTotal}枚`);
        doc.text(parts.join(' '), marginX, 10);
      } catch {
        // text描画失敗時は無視
      }

      for (let i = 0; i < gridCols * gridRows; i++) {
        const idx = page * gridCols * gridRows + i;
        if (idx >= dataUrls.length) break;
        const col = i % gridCols;
        const row = Math.floor(i / gridCols);
        const x = marginX + col * cellW;
        const y = marginY + row * cellH;
        const imgData = dataUrls[idx];
        if (imgData) {
          doc.addImage(imgData, 'JPEG', x, y, cellW, cellH);
        }
      }
      // ファイル名: デッキ名-ページ番号_総ページ数.pdf
      const fileName = `${deck.name.replace(/[/\\:*?"<>|]/g, '_')}-${page + 1}_${totalPages}.pdf`;

      if (iOSMode) {
        try {
          const blob = doc.output('blob');
          const url = URL.createObjectURL(blob);
          outFiles.push({ name: fileName, url });
        } catch {
          // iOS用生成に失敗した場合は何もしない（あとで0件表示）
        }
      } else {
        doc.save(fileName);
      }
    }

    if (iOSMode) {
      openExportFilesModal('PDF出力（開く）', outFiles);
    } else {
      alert('デッキをPDF出力しました');
    }
  }

  // デッキ詳細画面でデッキをJSONでエクスポート
  // 現デッキ構築仕様 (基礎/領土/予備 + thumbnailCardId) と一致する最小保存形式で書き出す。
  // 取込時 (JSONデッキ読込) の正規化が期待するスキーマと同形。
  const exportSingleDeckAsJson = (deck) => {
    const normalizeIdCountList = (raw) => {
      if (Array.isArray(raw)) {
        return raw
          .map(t => ({ id: Number(t?.id), count: Number(t?.count) || 0 }))
          .filter(t => Number.isFinite(t.id) && t.id > 0 && t.count > 0);
      }
      if (raw && typeof raw === 'object') {
        return Object.entries(raw)
          .map(([id, count]) => ({ id: Number(id), count: Number(count) || 0 }))
          .filter(t => Number.isFinite(t.id) && t.id > 0 && t.count > 0);
      }
      return [];
    };

    const inputCards = Array.isArray(deck?.cards) ? deck.cards : [];
    const minimalCards = inputCards
      .map(c => ({
        id: Number(c?.id),
        count: Number(c?.count) || 0,
        isDeckThumbnail: !!c?.isDeckThumbnail,
      }))
      .filter(c => Number.isFinite(c.id) && c.id > 0);

    const tokenDeckArr = normalizeIdCountList(deck?.tokenDeck);
    const sideDeckArr = normalizeIdCountList(deck?.sideDeck);

    const explicitThumbId = Number(deck?.thumbnailCardId);
    const thumbFromMain = minimalCards.find(c => c.isDeckThumbnail)?.id ?? null;
    const thumbnailCardId = Number.isFinite(explicitThumbId) && explicitThumbId > 0
      ? explicitThumbId
      : (thumbFromMain ?? minimalCards[0]?.id ?? tokenDeckArr[0]?.id ?? null);

    const out = {
      name: deck?.name || 'deck',
      cards: minimalCards,
      tokenDeck: tokenDeckArr,
      sideDeck: sideDeckArr,
      thumbnailCardId,
    };

    const dataStr = JSON.stringify(out, null, 2);
    const safeName = (out.name || 'deck').replace(/[/\\:*?"<>|]/g, '_');
    const fileName = `${safeName}.json`;
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    if (isIOSDevice()) {
      openExportFilesModal('JSON出力（開く）', [{ name: fileName, url }]);
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // sortDeckCards は ./utils/deckUtils.js から import 済み

  // savedDecksが変化したらlocalStorageへ保存（アラートは削除）
  useEffect(() => {
    try {
      localStorage.setItem('savedCanvasDecks', JSON.stringify(savedDecks));
      console.log('savedCanvasDecks updated:', savedDecks);
    } catch (e) {
      alert('デッキの保存に失敗しました（localStorage容量制限など）');
      console.error(e);
    }
  }, [savedDecks]);

  // 作成中デッキの内容を localStorage へ自動保存（300msデバウンス。ページ更新時の復元用）
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const minimalDeck = (deck || []).map(c => ({
          id: c.id,
          count: Number(c.count) || 0,
          isDeckThumbnail: !!c.isDeckThumbnail,
        }));
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
          deck: minimalDeck,
          tokenDeck,
          sideDeck,
          deckThumbnailCardId,
          currentDeckName,
        }));
      } catch {
        // 容量制限などは無視（savedDecks 側で既にアラート済み）
      }
    }, 300);
    return () => clearTimeout(id);
  }, [deck, tokenDeck, sideDeck, deckThumbnailCardId, currentDeckName]);

  // --- 既存保存データの自動移行（最小形式へ） ---
  useEffect(() => {
    if (!Array.isArray(savedDecks) || savedDecks.length === 0) return;
    const migrated = savedDecks.map(d => {
      // 旧形式（カードに name/type/image 等を丸ごと持っている）も最小形式へ落とす
      const cards = Array.isArray(d.cards) ? d.cards : [];
      const hasTokenDeckField = d && Object.prototype.hasOwnProperty.call(d, 'tokenDeck');
      let tokenDeck;
      if (Array.isArray(d.tokenDeck)) {
        tokenDeck = d.tokenDeck
          .map(t => ({ id: Number(t?.id), count: Number(t?.count) || 0 }))
          .filter(t => Number.isFinite(t.id) && t.id > 0 && t.count > 0);
      } else if (d.tokenDeck && typeof d.tokenDeck === 'object') {
        tokenDeck = Object.entries(d.tokenDeck)
          .map(([id, count]) => ({ id: Number(id), count: Number(count) || 0 }))
          .filter(t => Number.isFinite(t.id) && t.id > 0 && t.count > 0);
      } else {
        // tokenDeckフィールドが無いデッキは「旧型」として判別できるよう、あえて付与しない
        tokenDeck = hasTokenDeckField ? [] : undefined;
      }
      // 余計なトップレベルフィールドは落とす（thumbnail/relatedTokens など）が、
      // 予備デッキ・サムネイル・クラウド/公開情報は保持する（落とすとデッキが壊れる）
      const base = {
        name: d.name,
        cards: cards.map(c => ({ id: c.id, count: c.count || 0, isDeckThumbnail: !!c.isDeckThumbnail })),
      };
      if (typeof tokenDeck !== 'undefined') base.tokenDeck = tokenDeck;
      for (const key of ['sideDeck', 'thumbnailCardId', '_cloudId', 'isPublic', 'description', 'tags', 'postedAt', 'contentUpdatedAt']) {
        if (Object.prototype.hasOwnProperty.call(d, key)) base[key] = d[key];
      }
      return base;
    });
    // 変更があれば反映
    const changed = JSON.stringify(migrated) !== JSON.stringify(savedDecks);
    if (changed) setSavedDecks(migrated);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- デッキURL共有用 ---
  // id/count ペアを URL クエリ文字列にエンコード（id:2byte, count:1byte）
  function encodeIdCountPairsToQuery(pairs) {
    const arr = (pairs || [])
      .map(([id, count]) => [Number(id), Number(count)])
      .filter(([id, count]) => Number.isFinite(id) && Number.isFinite(count) && id > 0 && count > 0);
    const buf = new Uint8Array(arr.length * 3);
    arr.forEach(([id, count], i) => {
      buf[i * 3] = (id >> 8) & 0xff;
      buf[i * 3 + 1] = id & 0xff;
      buf[i * 3 + 2] = count & 0xff;
    });
    let binary = '';
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    // base64（URLセーフ: +→-, /→_, =削除）
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeIdCountPairsFromQuery(str) {
    try {
      if (!str) return [];
      str = String(str).replace(/-/g, '+').replace(/_/g, '/');
      while (str.length % 4) str += '=';
      const binary = atob(str);
      const buf = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
      const arr = [];
      for (let i = 0; i + 2 < buf.length; i += 3) {
        const id = (buf[i] << 8) | buf[i + 1];
        const count = buf[i + 2];
        if (id > 0 && count > 0) arr.push([id, count]);
      }
      return arr;
    } catch (e) {
      console.error('クエリデコード失敗', e);
      return [];
    }
  }

  // デッキをURLクエリにエンコード
  function encodeDeckToQuery(deck) {
    return encodeIdCountPairsToQuery((deck || []).map(c => [Number(c.id), Number(c.count)]));
  }
  // 共有URL (?deck=...&token=...&side=...) を読み込んで作成中デッキに反映する。
  // 初回レンダー時と window.onload の両方から呼ばれる。
  function loadDeckFromQueryParams(deckParam, tokenParam, sideParam) {
    if (!deckParam) return;
    // 新弾追加でずれた旧世代の共有URLはここで現行IDへ読み替える
    const { mainPairs, tokenPairs, sidePairs } = migrateIdCountPairs(
      decodeIdCountPairsFromQuery(deckParam),
      tokenParam ? decodeIdCountPairsFromQuery(tokenParam) : [],
      sideParam ? decodeIdCountPairsFromQuery(sideParam) : [],
    );
    const loaded = mainPairs
      .map(([id, count]) => {
        const card = cardMapById.get(id);
        return card ? { ...card, count } : null;
      })
      .filter(Boolean);
    if (loaded.length === 0) return;

    setDeck(loaded);
    if (tokenParam) {
      const map = {};
      for (const [id, count] of tokenPairs) map[id] = count;
      setTokenDeck(map);
    } else {
      // 旧共有URL（tokenパラメータ無し）は関連トークンを9枚として初期化
      const legacyTokenCards = collectRelatedTokensFromCards(loaded);
      const map = {};
      for (const t of legacyTokenCards) {
        const maxT = t.maxTokenDeckCount ?? 4;
        const cnt = Math.min(9, maxT);
        if (cnt > 0) map[Number(t.id)] = cnt;
      }
      setTokenDeck(map);
    }
    if (sideParam) {
      const sideMap = {};
      for (const [id, count] of sidePairs) sideMap[id] = count;
      setSideDeck(sideMap);
    } else {
      setSideDeck({});
    }
    setActiveTab('deck');
    setCurrentDeckName('共有デッキ');
    setDeckName('共有デッキ');
  }

  // --- URLクエリからデッキ自動読込 ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deckParam = params.get('deck');
    const tokenParam = params.get('token');
    const sideParam = params.get('side');
    loadDeckFromQueryParams(deckParam, tokenParam, sideParam);
    // 共有URL(?deck=...) の初回取り込み専用。loadDeckFromQueryParams / collectRelatedTokensFromCards は
    // レンダー間で実質不変で、URL 変化（実質マウント時）のみ実行する意図のため依存に含めない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window.location.search]);

  // --- デッキ共有用URL生成 ---
  const getShareUrl = () => {
    const encoded = encodeDeckToQuery(deck);
    const tokenPairs = Object.entries(tokenDeck)
      .map(([id, count]) => [Number(id), Number(count)])
      .filter(([, count]) => count > 0);
    const tokenEncoded = tokenPairs.length ? encodeIdCountPairsToQuery(tokenPairs) : '';
    const sidePairs = Object.entries(sideDeck)
      .map(([id, count]) => [Number(id), Number(count)])
      .filter(([, count]) => count > 0);
    const sideEncoded = sidePairs.length ? encodeIdCountPairsToQuery(sidePairs) : '';
    // 共有URLは必ずindex.htmlを明示
    const tokenPart = tokenEncoded ? `&token=${tokenEncoded}` : '';
    const sidePart = sideEncoded ? `&side=${sideEncoded}` : '';
    return `${window.location.origin}/index.html?deck=${encoded}${tokenPart}${sidePart}`;
  };

  // --- SVG生成（共通）---
  const buildDeckSVG = async (deckObj) => {
    if (!deckObj || !Array.isArray(deckObj.cards)) return null;
    const cards = sortDeckCards(deckObj.cards);
    // 画像を dataURL に変換するヘルパー（同一オリジン前提）
    const toDataUrl = async (src) => {
      if (!src) return null;
      try {
        const res = await fetch(src, { cache: 'no-cache' });
        if (!res.ok) throw new Error('fetch failed');
        const blob = await res.blob();
        const reader = new FileReader();
        const done = new Promise((resolve) => {
          reader.onloadend = () => resolve(reader.result);
        });
        reader.readAsDataURL(blob);
        return await done; // data:image/png;base64,...
      } catch {
        return null;
      }
    };
    // レイアウト設定
    const cols = 5;
    const cellW = 110; // 1カードの枠幅
    const cellH = 160; // 1カードの枠高（3:4近似）
    const gap = 12;
    const marginLeft = 24;
    const marginTop = 24;
    const headerH = 90;
    const rows = Math.ceil(cards.length / cols);

    // 現行仕様: tokenDeckの枚数を反映し、0枚のトークンは「無し」扱い
    // 旧型: tokenDeckフィールドが無い場合のみ、関連トークンを9枚として扱う
    const hasTokenDeckField = deckObj && Object.prototype.hasOwnProperty.call(deckObj, 'tokenDeck');
    const tokenCountMap = new Map();
    if (Array.isArray(deckObj.tokenDeck)) {
      for (const t of deckObj.tokenDeck) {
        if (!t || typeof t.id === 'undefined') continue;
        const cnt = Number(t.count) || 0;
        if (cnt > 0) tokenCountMap.set(Number(t.id), cnt);
      }
    } else if (deckObj.tokenDeck && typeof deckObj.tokenDeck === 'object') {
      for (const [id, cntRaw] of Object.entries(deckObj.tokenDeck)) {
        const cnt = Number(cntRaw) || 0;
        if (cnt > 0) tokenCountMap.set(Number(id), cnt);
      }
    }

    const relatedTokensAll = Array.isArray(deckObj.relatedTokens) ? deckObj.relatedTokens : [];
    const relatedIdSet = new Set(relatedTokensAll.map(t => Number(t.id)));
    const extraTokenIds = hasTokenDeckField
      ? Array.from(tokenCountMap.keys()).filter(id => !relatedIdSet.has(Number(id)))
      : [];
    const extraTokenCards = extraTokenIds
      .map(id => cardMapById.get(Number(id)))
      .filter(Boolean);

    const tokenCards = [...relatedTokensAll, ...extraTokenCards]
      .map(tc => {
        const id = Number(tc.id);
        const fromMap = tokenCountMap.get(id);
        const legacyDefault = !hasTokenDeckField
          ? Math.min(9, tc.maxTokenDeckCount ?? 4)
          : 0;
        const count = (typeof fromMap === 'number') ? fromMap : legacyDefault;
        return { card: tc, count };
      })
      .filter(x => (Number(x.count) || 0) > 0);

    // 予備デッキ (sideDeck) を解決。array / object 両形式を許容。
    const sideCountMap = new Map();
    if (Array.isArray(deckObj.sideDeck)) {
      for (const s of deckObj.sideDeck) {
        if (!s || typeof s.id === 'undefined') continue;
        const cnt = Number(s.count) || 0;
        if (cnt > 0) sideCountMap.set(Number(s.id), cnt);
      }
    } else if (deckObj.sideDeck && typeof deckObj.sideDeck === 'object') {
      for (const [id, cntRaw] of Object.entries(deckObj.sideDeck)) {
        const cnt = Number(cntRaw) || 0;
        if (cnt > 0) sideCountMap.set(Number(id), cnt);
      }
    }
    const sideCards = sortDeckCards(
      Array.from(sideCountMap.keys())
        .map(id => cardMapById.get(Number(id)))
        .filter(Boolean)
    ).map(card => ({ card, count: sideCountMap.get(Number(card.id)) || 0 }))
      .filter(x => x.count > 0);

    const tokenRows = Math.ceil(tokenCards.length / cols);
    const sideRows = Math.ceil(sideCards.length / cols);
    const svgW = marginLeft + cols * cellW + (cols - 1) * gap + marginLeft;
    const extraBetween = 40;
    const svgH = marginTop + headerH
      + rows * cellH + (rows - 1) * gap
      + (tokenCards.length > 0 ? (extraBetween + tokenRows * cellH + Math.max(0, tokenRows - 1) * gap) : 0)
      + (sideCards.length > 0 ? (extraBetween + sideRows * cellH + Math.max(0, sideRows - 1) * gap) : 0)
      + marginTop;

    // ヘッダー（タイトル、サムネイル、合計枚数）
    const header = (() => {
      const nameText = deckObj.name || 'デッキ';
      const mainTotal = cards.reduce((s, c) => s + (c.count || 0), 0);
      const tokenTotal = tokenCards.reduce((s, t) => s + (Number(t.count) || 0), 0);
      const sideTotal = sideCards.reduce((s, t) => s + (Number(t.count) || 0), 0);
      // 同期文字列生成のため、後で置換
      const thumbImgPlaceholder = '<!--THUMB_PLACEHOLDER-->';
      const titleX = marginLeft + 64;
      return `
        ${thumbImgPlaceholder}
        <text x="${titleX}" y="${marginTop + 26}" font-size="22" font-weight="700" fill="#000">${nameText}</text>
        <text x="${titleX}" y="${marginTop + 56}" font-size="16" font-weight="700">
          <tspan fill="#1976d2">基礎デッキ${mainTotal}枚</tspan>
          ${tokenTotal > 0 ? `<tspan fill="#1976d2"> </tspan><tspan fill="#ff9800">領土デッキ${tokenTotal}枚</tspan>` : ''}
          ${sideTotal > 0 ? `<tspan fill="#1976d2"> </tspan><tspan fill="#43a047">予備デッキ${sideTotal}枚</tspan>` : ''}
        </text>
      `;
    })();

    // カードグリッドSVG作成
    const gridStartY = marginTop + headerH;
    // 後で画像を埋め込むためにプレースホルダーを使う
    const imgPlaceholders = [];
    const items = cards.map((card, idx) => {
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      const x = marginLeft + c * (cellW + gap);
      const y = gridStartY + r * (cellH + gap);
      const display = card.isDoubleSided && card.front ? card.front : card;
      const imgX = x + 4;
      const imgY = y + 4;
      const imgW = cellW - 8;
      const imgH = cellH - 8;
      const placeholderId = `IMG_${idx}`;
      imgPlaceholders.push({ id: placeholderId, src: display.image, x: imgX, y: imgY, w: imgW, h: imgH });
      // バッジ（右上）
      const badgeR = 12;
      const badgeCx = x + cellW - badgeR - 6;
      const badgeCy = y + badgeR + 6;
      return `
        <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="6" ry="6" fill="#ffffff" stroke="#bbb" />
        <!--${placeholderId}-->
        <circle cx="${badgeCx}" cy="${badgeCy}" r="${badgeR}" fill="#1976d2" />
        <text x="${badgeCx}" y="${badgeCy + 5}" font-size="12" font-weight="700" fill="#fff" text-anchor="middle">${card.count || 0}</text>
      `;
    }).join('');

    // トークンデッキセクション
    let tokensSection = '';
    const mainSectionEndY = gridStartY + rows * (cellH + gap);
    const tokenStartY = mainSectionEndY + extraBetween;
    if (tokenCards.length > 0) {
      const tokenItems = tokenCards.map(({ card: tokenCard, count }, idx) => {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        const x = marginLeft + c * (cellW + gap);
        const y = tokenStartY + r * (cellH + gap);
        const display = tokenCard;
        const imgX = x + 4;
        const imgY = y + 4;
        const imgW = cellW - 8;
        const imgH = cellH - 8;
        const placeholderId = `TOKEN_IMG_${idx}`;
        imgPlaceholders.push({ id: placeholderId, src: display.image, x: imgX, y: imgY, w: imgW, h: imgH });
        const badgeR = 12;
        const badgeCx = x + cellW - badgeR - 6;
        const badgeCy = y + badgeR + 6;
        const badgeCount = Number(count) || 0;
        return `
          <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="6" ry="6" fill="#ffffff" stroke="#bbb" />
          <!--${placeholderId}-->
          <circle cx="${badgeCx}" cy="${badgeCy}" r="${badgeR}" fill="#ff9800" />
          <text x="${badgeCx}" y="${badgeCy + 5}" font-size="12" font-weight="700" fill="#fff" text-anchor="middle">${badgeCount}</text>
        `;
      }).join('');
      const tokenHeader = `<text x="${marginLeft}" y="${tokenStartY - 12}" font-size="18" font-weight="700" fill="#ff9800">領土デッキ</text>`;
      tokensSection = `${tokenHeader}${tokenItems}`;
    }

    // 予備デッキセクション
    let sideSection = '';
    if (sideCards.length > 0) {
      const sideStartY = (tokenCards.length > 0)
        ? tokenStartY + tokenRows * (cellH + gap) + extraBetween
        : mainSectionEndY + extraBetween;
      const sideItems = sideCards.map(({ card: sideCard, count }, idx) => {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        const x = marginLeft + c * (cellW + gap);
        const y = sideStartY + r * (cellH + gap);
        const isDouble = sideCard.isDoubleSided && sideCard.front && sideCard.back;
        const display = isDouble ? sideCard.front : sideCard;
        const imgX = x + 4;
        const imgY = y + 4;
        const imgW = cellW - 8;
        const imgH = cellH - 8;
        const placeholderId = `SIDE_IMG_${idx}`;
        imgPlaceholders.push({ id: placeholderId, src: display.image, x: imgX, y: imgY, w: imgW, h: imgH });
        const badgeR = 12;
        const badgeCx = x + cellW - badgeR - 6;
        const badgeCy = y + badgeR + 6;
        const badgeCount = Number(count) || 0;
        return `
          <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="6" ry="6" fill="#ffffff" stroke="#bbb" />
          <!--${placeholderId}-->
          <circle cx="${badgeCx}" cy="${badgeCy}" r="${badgeR}" fill="#43a047" />
          <text x="${badgeCx}" y="${badgeCy + 5}" font-size="12" font-weight="700" fill="#fff" text-anchor="middle">${badgeCount}</text>
        `;
      }).join('');
      const sideHeader = `<text x="${marginLeft}" y="${sideStartY - 12}" font-size="18" font-weight="700" fill="#43a047">予備デッキ</text>`;
      sideSection = `${sideHeader}${sideItems}`;
    }

    let svg = `<?xml version="1.0" encoding="UTF-8"?>
      <svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
        <rect x="0" y="0" width="${svgW}" height="${svgH}" fill="#ffffff" />
        ${header}
        ${items}
        ${tokensSection}
        ${sideSection}
      </svg>`;

    // サムネイル差し込み (現行仕様: thumbnailCardId 優先 → isDeckThumbnail → 先頭基礎 → 先頭領土)
    const resolveThumbSrc = () => {
      if (deckObj.thumbnail) return deckObj.thumbnail;
      const cardImg = (card) => {
        if (!card) return null;
        const isDouble = card.isDoubleSided && card.front && card.back;
        return isDouble ? card.front.image : card.image;
      };
      const tid = Number(deckObj.thumbnailCardId);
      if (Number.isFinite(tid) && tid > 0) {
        const fromMain = cards.find(c => Number(c.id) === tid);
        if (fromMain) return cardImg(fromMain);
        const fromToken = tokenCards.find(t => Number(t.card.id) === tid);
        if (fromToken) return cardImg(fromToken.card);
      }
      const explicit = cards.find(c => c.isDeckThumbnail);
      if (explicit) return cardImg(explicit);
      if (cards[0]) return cardImg(cards[0]);
      if (tokenCards[0]) return cardImg(tokenCards[0].card);
      return null;
    };
    const headerThumbSrc = resolveThumbSrc();
    if (headerThumbSrc) {
      const thumbDataUrl = await toDataUrl(headerThumbSrc);
      if (thumbDataUrl) {
        const thumbTag = `<image href="${thumbDataUrl}" x="${marginLeft}" y="${marginTop}" width="48" height="64" />`;
        svg = svg.replace('<!--THUMB_PLACEHOLDER-->', thumbTag);
      } else {
        svg = svg.replace('<!--THUMB_PLACEHOLDER-->', '');
      }
    } else {
      svg = svg.replace('<!--THUMB_PLACEHOLDER-->', '');
    }

    // 各カード画像差し込み
    for (const ph of imgPlaceholders) {
      const dataUrl = await toDataUrl(ph.src);
      const tag = dataUrl
        ? `<image href="${dataUrl}" x="${ph.x}" y="${ph.y}" width="${ph.w}" height="${ph.h}" preserveAspectRatio="xMidYMid slice" />`
        : '';
      svg = svg.replace(`<!--${ph.id}-->`, tag);
    }

    return { svg, width: svgW, height: svgH };
  };

  // --- SVG→PNG 変換してダウンロード ---
  const exportDeckSvgToPng = async (deckObj, opts = {}) => {
    const built = await buildDeckSVG(deckObj);
    if (!built) return;
    const { svg, width, height } = built;
    // 高解像度化用スケール。指定がなければデバイスのDPRか2倍を採用。
    const scale = Math.max(4, Math.floor((opts.scale || window.devicePixelRatio || 4)));
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = svgUrl;
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(e);
      });
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      // スケール適用のうえアンチエイリアスを有効化
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      const iOSMode = isIOSDevice();
      const fileName = `${deckObj.name || 'deck'}.png`;

      if (iOSMode) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (blob) {
          const url = URL.createObjectURL(blob);
          openExportFilesModal('PNG出力（開く）', [{ name: fileName, url }]);
        } else {
          openExportFilesModal('PNG出力（開く）', []);
        }
      } else {
        const dataUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  };

  // 安全な幅・高さを保証
  const safeListWidth = (!listSize.width || isNaN(listSize.width) || listSize.width < 80) ? 320 : listSize.width;
  const safeGridColWidth = (!gridColWidth || isNaN(gridColWidth) || gridColWidth < 40) ? 80 : gridColWidth;
  const safeListHeight = (!listSize.height || isNaN(listSize.height) || listSize.height < 80) ? 600 : listSize.height;

const renderContext = useMemo(() => ({ decreaseCardCount, decreaseSideCount, decreaseTokenCount, getCardCountInDeck, increaseCardCount, increaseSideCount, increaseTokenCount, itemTouchHandlers, openCardDetail, sideDeck, sideMode, tokenDeck }), [decreaseCardCount, decreaseSideCount, decreaseTokenCount, getCardCountInDeck, increaseCardCount, increaseSideCount, increaseTokenCount, itemTouchHandlers, openCardDetail, sideDeck, sideMode, tokenDeck]);
  const searchItemData = useMemo(() => ({ cards: filteredCards, columns: gridColumns, context: renderContext }), [filteredCards, gridColumns, renderContext]);
  const deckItemData = useMemo(() => ({ cards: sortDeckCards(deck), columns: gridColumns, context: renderContext, section: 'basic' }), [deck, gridColumns, renderContext]);

    // 画面幅が異常な場合はメッセージ表示
  if (!safeListWidth || isNaN(safeListWidth) || safeListWidth < 80) {
    return <div style={{padding:40}}>画面幅が小さすぎるか、レイアウト計算に失敗しました。ウィンドウを広げてください。</div>;
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h1 style={{ margin: 0 }}>　ACGマネージャー　</h1>
        <UserBadge />
      </div>
      {/* タブバー */}
      <div className="tab-bar" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr) minmax(0,2fr) minmax(0,2fr) minmax(0,1fr)', gap: '6px', overflowX: 'hidden' }}>
        <button className={`tab-btn${activeTab === 'home' ? ' active' : ''}`} style={{ minWidth: 0, fontSize: '1em', fontWeight: 'bold', lineHeight: 1 }} onClick={() => setActiveTab('home')}>🏠</button>
        <button className={`tab-btn${activeTab === 'search' ? ' active' : ''}`} style={{ minWidth: 0 }} onClick={() => setActiveTab('search')}>カード検索</button>
        <button className={`tab-btn${activeTab === 'deck' ? ' active' : ''}`} style={{ minWidth: 0 }} onClick={() => setActiveTab('deck')}>作成中デッキ</button>
        <button className={`tab-btn${activeTab === 'saved' ? ' active' : ''}`} style={{ minWidth: 0 }} onClick={() => setActiveTab('saved')}>保存デッキ</button>
        <button className={`tab-btn${activeTab === 'qa' ? ' active' : ''}`} style={{ minWidth: 0 }} onClick={() => setActiveTab('qa')}>QA</button>
      </div>
      <div
        className="tab-content-wrap"
        ref={tabContentWrapRef}
        style={{ touchAction: 'pan-y' }} // 垂直スクロールは許可
      >
        {/* ホームタブ */}
        <div className="tab-content" ref={homeContainerRef} style={{ display: activeTab === 'home' ? 'block' : 'none' }}>
          {/* メイン (最新情報) — サブページ表示中は display:none で隠す (DOM は残してスクロール位置復元) */}
          <div style={{ marginTop: 8, display: homeSubPage === 'main' ? 'block' : 'none' }}>
            {/* 出典・権利表記（ホームタブのみに表示） */}
            <section style={{
              margin: '0.4em 0 1em 0',
              padding: '0.8em 1em',
              background: '#fafafa',
              border: '1px solid #e0e0e0',
              borderRadius: 8,
              fontSize: '0.78em',
              color: '#666',
              lineHeight: 1.7,
            }}>
              <div style={{ marginBottom: '0.3em', fontWeight: 'bold', color: '#555' }}>
                本サイトについて
              </div>
              <div>
                本サイトは <strong>非公式のファンサイト</strong> です。「ACG（アニマルカードゲーム）」を発行する公式団体のサイトではありません。
              </div>
              <div>
                カードデータ・お知らせ・Q&amp;A 等の情報出典：
                <a href="https://acgtcg.com/" target="_blank" rel="noopener noreferrer"
                   style={{ color: '#1976d2', textDecoration: 'underline' }}>
                  acgtcg.com
                </a>
                （ACG 公式サイト）
              </div>
              <div>
                カード名・効果テキスト・画像・ロゴ等に関する権利は、すべて発行元に帰属します。
              </div>
            </section>
            <h2>最新情報</h2>
            {/* 開催予定イベント (Supabase アプリ内イベント) */}
            <HomeRecruitingEvents />
            {/* 公式お知らせ (acgtcg.com から取得) */}
            <HomeOfficialNews />
            {/* 公式 新弾・新製品 (acgtcg.com から取得) */}
            <HomeOfficialProducts />
            {/* 公式・公認イベント一覧 (acgtcg.com/index_event.html から取得) */}
            <HomeOfficialEvents />
            {/* みんなのデッキ (コミュニティ投稿、公式コンテンツの下に区切って表示) */}
            <HomePublicDecks
              refreshKey={publicDecksRefreshKey}
              onDeckClick={(deck) => setDetailDeck(deck)}
              onShowAll={enterPublicDecksAll}
            />
          </div>
          {/* サブページ: みんなのデッキ全件 (ホームタブ内、戻ると最新情報へ) */}
          {homeSubPage === 'publicDecksAll' && (
            <div style={{ marginTop: 8 }}>
              <PublicDecksListPage
                onBack={exitToHomeMain}
                onDeckClick={(deck) => setDetailDeck(deck)}
                refreshKey={publicDecksRefreshKey}
              />
            </div>
          )}
        </div>
        {/* カード検索タブ */}
        <div className="tab-content" ref={searchContainerRef} style={{ display: activeTab === 'search' ? 'block' : 'none' }}>
          <div className="input-row">
            <input
              type="text"
              placeholder="カード名、属性、効果、作品名で検索"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button onClick={() => {}} style={{ minWidth: '4em' }}>検索</button>
          </div>
          {/* 検索結果件数表示 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0.5em 0' }}>
            <span style={{ fontWeight: 'bold' }}>検索結果</span>
            <span style={{ color: '#666', fontSize: '0.9em' }}>{filteredCards.length} 件</span>
          </div>
          {/* ▼▼▼ フィルターUI（サンプルHTML準拠） ▼▼▼ */}
          <div style={{ margin: '0.7em 0 0.7em 0' }}>
            <div style={{ display: 'flex', gap: '0.7em', marginBottom: '0.7em' }}>
              <button onClick={() => setShowFilter(f => !f)} style={{ flex: 1 }}>
                {showFilter ? 'フィルターを閉じる' : 'フィルターを開く'}
              </button>
              <button onClick={resetFilters} style={{ flex: 1, background: '#d32f2f', color: '#fff' }}>条件リセット</button>
            </div>
            {showFilter && (
              <div className="filter-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7em 1em', marginBottom: '1em', fontSize: '0.97em' }}>
                <div>
                  <label>属性</label>
                  <select value={filterColor} onChange={e => setFilterColor(e.target.value)} style={{ width: '100%' }}>
                    <option value="">(指定なし)</option>
                    <option value="水">水</option>
                    <option value="森">森</option>
                    <option value="平">平</option>
                    <option value="山">山</option>
                    <option value="夜">夜</option>
                    <option value="__none__">無</option>
                  </select>
                </div>
                <div>
                  <label>カード種類</label>
                  <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ width: '100%' }}>
                    <option value="">(指定なし)</option>
                    <option value="動物">動物</option>
                    <option value="縄張り">縄張り</option>
                    <option value="場面">場面</option>
                    <option value="特技">特技</option>
                    <option value="道具">道具</option>
                    <option value="領土">領土</option>
                    <option value="プレビュー">プレビュー</option>
                  </select>
                </div>
                <div>
                  <label>レアリティ</label>
                  <select value={filterRarity} onChange={e => setFilterRarity(e.target.value)} style={{ width: '100%' }}>
                    <option value="">(指定なし)</option>
                    <option value="PR">PR</option>
                    <option value="SEC">SEC</option>
                    <option value="エラータ">エラータ</option>
                    <option value="領土">領土</option>
                  </select>
                </div>
                <div>
                  <label>種族</label>
                  <div ref={tribeDropdownRef} style={{ position: 'relative' }}>
                    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '2fr 1fr' }}>
                      <input
                        type="text"
                        value={filterTribe}
                        onChange={e => setFilterTribe(e.target.value)}
                        onFocus={() => setTribeDropdownOpen(true)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setTribeDropdownOpen(false);
                          if (e.key === 'ArrowDown') setTribeDropdownOpen(true);
                          if (e.key === 'Enter' && tribeDropdownOpen && filteredTribeOptions.length) {
                            setFilterTribe(filteredTribeOptions[0]);
                            setTribeDropdownOpen(false);
                            e.preventDefault();
                          }
                        }}
                        style={{ width: '100%' }}
                        placeholder="例: ワニ（候補から選択可）"
                        aria-autocomplete="list"
                        aria-expanded={tribeDropdownOpen}
                        aria-controls="tribe-dropdown-list"
                        role="combobox"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setTribeDropdownOpen(prev => {
                            const next = !prev;
                            if (next) {
                              // リストを開く操作時に入力を自動クリア
                              setFilterTribe('');
                            }
                            return next;
                          });
                        }}
                        aria-label="種族候補を開く（開く時に入力をクリア）"
                        title="リストを開く（開く時に種族入力をクリア）"
                        style={{ padding: '4px 8px', width: '100%' }}
                      >
                        ▼
                      </button>
                    </div>
                    {tribeDropdownOpen && (
                      <div
                        id="tribe-dropdown-list"
                        role="listbox"
                        style={{
                          position: 'absolute',
                          zIndex: 50,
                          background: '#fff',
                          border: '1px solid #ccc',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                          maxHeight: 240,
                          overflowY: 'auto',
                          WebkitOverflowScrolling: 'touch',
                          touchAction: 'pan-y',
                          overscrollBehavior: 'contain',
                          width: '100%',
                          marginTop: 4,
                        }}
                      >
                        {filteredTribeOptions.length === 0 ? (
                          <div style={{ padding: 8, color: '#666' }}>候補なし</div>
                        ) : (
                          filteredTribeOptions.map(opt => (
                            <div
                              key={opt}
                              role="option"
                              onClick={() => { setFilterTribe(opt); setTribeDropdownOpen(false); }}
                              style={{ padding: '6px 8px', cursor: 'pointer' }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                            >
                              {opt}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label>収録パック</label>
                  <select value={filterPack} onChange={e => setFilterPack(e.target.value)} style={{ width: '100%' }}>
                    <option value="">(指定なし)</option>
                    {packOrder.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>コスト</label>
                  <select value={filterCost} onChange={e => setFilterCost(e.target.value)} style={{ width: '100%' }}>
                    <option value="">(指定なし)</option>
                    {[...Array(14)].map((_,i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
                <div>
                  <label>条件</label>
                  <select value={filterReduction} onChange={e => setFilterReduction(e.target.value)} style={{ width: '100%' }}>
                    <option value="">(指定なし)</option>
                    <option value="水">水</option>
                    <option value="森">森</option>
                    <option value="平">平</option>
                    <option value="山">山</option>
                    <option value="夜">夜</option>
                    <option value="無">無</option>
                    <option value="__none__">条件なし</option>
                  </select>
                </div>
              </div>
            )}
          </div>
          {/* ▲▲▲ フィルターUIここまで ▲▲▲ */}
          <div className="view-toggle-row">
            <button
              className={`view-toggle-btn side-mode-btn${sideMode ? ' active' : ''}`}
              onClick={() => setSideMode(s => !s)}
              title="予備モード: +/- ボタンで予備デッキを操作"
            >予</button>
            <button className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => setViewMode('list')}>≡</button>
            <button className={`view-toggle-btn${viewMode === 'grid' ? ' active' : ''}`} onClick={() => setViewMode('grid')}>■</button>
          </div>
          {/* カードリスト（リスト/グリッド切替） */}
          {viewMode === 'list' ? (
            <div
              className="card-list"
              ref={listContainerRef}
              style={{ width: '100%', maxWidth: '100vw', touchAction: 'pan-y' }}
            >
              <FixedSizeList
                height={safeListHeight}
                itemCount={filteredCards.length}
                itemData={searchItemData}
                itemSize={80}
                               width={safeListWidth}
              >
                {CardRow}
              </FixedSizeList>
            </div>
          ) : (
            <div
              className="card-grid"
              ref={listContainerRef}
              style={{ width: '100%', maxWidth: '100vw', touchAction: 'pan-y' }}
            >
              <FixedSizeGrid
                height={safeListHeight}
                columnCount={gridColumns}
                columnWidth={safeGridColWidth}
                rowCount={Math.ceil(filteredCards.length / gridColumns)}
                rowHeight={gridRowHeight}
                width={safeListWidth}
                itemData={searchItemData}
              >
                {CardGridCell}
              </FixedSizeGrid>
            </div>
          )}
        </div>
        {/* 作成中デッキタブ */}
        <div className="tab-content" style={{ display: activeTab === 'deck' ? 'block' : 'none' }}>
          <div ref={deckContainerRef} style={{ width: '100%', height: '100%', touchAction: 'pan-y' }}>
            <h2>作成中デッキ</h2>
            {/* サムネイル画像表示 */}
            {(() => {
              const tokenTotal = Object.values(tokenDeck).reduce((sum, cnt) => sum + Math.max(0, Number(cnt) || 0), 0);
              const sideTotal = Object.values(sideDeck).reduce((sum, cnt) => sum + Math.max(0, Number(cnt) || 0), 0);
              const hasAnyCards = deck.length > 0 || tokenTotal > 0 || sideTotal > 0;
              if (!hasAnyCards) return null;

              const normalizedThumbId = (() => {
                const id = Number(deckThumbnailCardId);
                if (!Number.isFinite(id)) return null;
                const inMain = deck.some(c => Number(c.id) === id);
                const inTokens = (Number(tokenDeck?.[id]) || 0) > 0;
                return (inMain || inTokens) ? id : null;
              })();

              const thumbIdRaw = normalizedThumbId ?? (deck.find(c => c.isDeckThumbnail)?.id ?? deck[0]?.id ?? null);
              const fallbackTokenId = Object.entries(tokenDeck).find(([, cnt]) => (Number(cnt) || 0) > 0)?.[0];
              const thumbId = thumbIdRaw ?? (fallbackTokenId ? Number(fallbackTokenId) : null);
              const thumbCard = thumbId ? (deck.find(c => Number(c.id) === Number(thumbId)) || cardMapById.get(Number(thumbId))) : null;

              return (
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5em' }}>
                {(() => {
                  // サムネイル指定カードを取得
                  if (!thumbCard) return null;
                  const isDoubleSided = thumbCard.isDoubleSided && thumbCard.front && thumbCard.back;
                  const displayCard = isDoubleSided ? thumbCard.front : thumbCard;
                  return (
                    <div style={{
                      border: '3px solid #1976d2',
                      borderRadius: 8,
                      padding: 2,
                      marginRight: '0.7em',
                      width: 48,
                      height: 64,
                      boxSizing: 'border-box',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: '#fff',
                    }}>
                      <img src={displayCard.image} alt="デッキサムネイル" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }} />
                    </div>
                  );
                })()}
                {/* 合計枚数表示を追加 */}
                <span style={{ fontWeight: 'bold', fontSize: '1.08em', color: '#1976d2', marginRight: '1em' }}>
                  基礎デッキ: {deck.reduce((sum, c) => sum + (c.count || 0), 0)}枚
                </span>
                {tokenTotal > 0 && (
                  <span style={{ fontWeight: 'bold', fontSize: '1.08em', color: '#ff9800', marginRight: '1em' }}>
                    領土デッキ: {tokenTotal}枚
                  </span>
                )}
                {sideTotal > 0 && (
                  <span style={{ fontWeight: 'bold', fontSize: '1.08em', color: '#43a047', marginRight: '1em' }}>
                    予備デッキ: {sideTotal}枚
                  </span>
                )}
                <div className="view-toggle-row" style={{ marginBottom: 0 }}>
                  <button className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => setViewMode('list')}>≡</button>
                  <button className={`view-toggle-btn${viewMode === 'grid' ? ' active' : ''}`} onClick={() => setViewMode('grid')}>■</button>
                </div>
              </div>
              );
            })()}
            {viewMode === 'list' ? (
              <div
                className="card-list"
                style={{ width: '100%', maxWidth: '100vw', touchAction: 'pan-y' }}
              >
                {(() => {
                  const mainCards = sortDeckCards(deck);
                  // 関連トークンでも、枚数が0なら「トークン無し」扱い（表示しない）
                  const tokenCardsFromDeck = collectRelatedTokensFromCards(deck)
                    .filter(t => (Number(tokenDeck[t.id]) || 0) > 0);
                  const fromDeckIdSet = new Set(tokenCardsFromDeck.map(t => t.id));
                  const extraTokenIds = Object.entries(tokenDeck)
                    .filter(([, cnt]) => (Number(cnt) || 0) > 0)
                    .map(([id]) => Number(id))
                    .filter(id => !fromDeckIdSet.has(id));
                  const extraTokenCards = extraTokenIds
                    .map(id => cardMapById.get(id))
                    .filter(Boolean);
                  const tokenCards = [...tokenCardsFromDeck, ...extraTokenCards];
                  const tokenTotal = tokenCards.reduce((sum, t) => sum + (Number(tokenDeck[t.id]) || 0), 0);

                  const sideCards = sortDeckCards(
                    Object.entries(sideDeck)
                      .filter(([, cnt]) => (Number(cnt) || 0) > 0)
                      .map(([id]) => cardMapById.get(Number(id)))
                      .filter(Boolean)
                  );
                  const sideTotal = sideCards.reduce((sum, c) => sum + (Number(sideDeck[c.id]) || 0), 0);

                  const hasTokens = tokenCards.length > 0;
                  const hasSide = sideCards.length > 0;
                  const totalCount = mainCards.length + (hasTokens ? (1 + tokenCards.length) : 0) + (hasSide ? (1 + sideCards.length) : 0);
                  if (totalCount === 0) return <div>デッキが空です。</div>;

                  return (
                    <FixedSizeList
                      height={Math.min(totalCount * 80, safeListHeight)}
                      itemCount={totalCount}
                      itemSize={80}
                      width={safeListWidth}
                      itemData={{ mainCards, tokenCards, tokenTotal, sideCards, sideTotal }}
                    >
                      {({ index, style, data }) => {
                        const mainLen = data.mainCards.length;
                        const tokens = data.tokenCards;
                        const sides = data.sideCards;
                        const hasT = tokens.length > 0;
                        const hasS = sides.length > 0;

                        // メイン行
                        if (index < mainLen) {
                          const card = data.mainCards[index];
                          if (!card) return null;
                          const isDoubleSided = card.isDoubleSided && card.front && card.back;
                          const displayCard = isDoubleSided ? card.front : card;
                          const typeText = isDoubleSided ? `${card.front.type} / ${card.back.type}` : card.type;
                          const isToken = isDoubleSided
                            ? (card.front.type === '領土' || card.back.type === '領土' || card.front.type?.includes('トークン') || card.back.type?.includes('トークン'))
                            : (card.type === '領土' || card.type?.includes('トークン'));
                          const count = isToken ? (tokenDeck[card.id] || 0) : (card.count || 0);
                          const sideCnt = Number(sideDeck[card.id]) || 0;
                          const maxCount = isToken ? (card.maxTokenDeckCount ?? 4) : (card.maxDeckCount ?? 4);
                          const isUnlimited = isToken && card.tribe === '基礎';
                          const combinedLimit = getSameNameLimit(card);
                          const incDisabled = count >= maxCount || (count + sideCnt) >= combinedLimit;

                          return (
                            <div
                              className="card-item"
                              style={{ ...style, touchAction: 'pan-y', cursor: 'pointer' }}
                              {...itemTouchHandlers}
                              onClick={e => {
                                if (
                                  e.target.classList.contains('plusBtn') ||
                                  e.target.classList.contains('minusBtn')
                                ) return;
                                openCardDetail(card);
                              }}
                            >
                              <div className="card-grid-img-wrap" style={{ width: 48, height: 64, marginRight: 8 }}>
                                <img src={displayCard.image} alt={displayCard.name} className="card-grid-img" style={{ width: '100%', height: '100%' }} />
                              </div>
                              <div className="card-info"><b>{card.name}</b> <span style={{ fontSize: '0.9em', color: '#666' }}>({typeText})</span></div>
                              {maxCount > 0 && (
                                <div className="card-controls">
                                  <button
                                    onClick={e => { e.stopPropagation(); isToken ? decreaseTokenCount(card.id) : decreaseCardCount(card.id); }}
                                    className={`minusBtn${isToken ? ' token-btn' : ''}`}
                                    disabled={count <= 0}
                                    style={isToken ? { background: '#ff9800' } : undefined}
                                  >-</button>
                                  <span>{count}{isUnlimited ? ' / ∞' : ` / ${maxCount}`}</span>
                                  <button
                                    onClick={e => { e.stopPropagation(); isToken ? increaseTokenCount(card.id) : increaseCardCount(card.id); }}
                                    className={`plusBtn${isToken ? ' token-btn' : ''}`}
                                    disabled={incDisabled}
                                    style={isToken ? { background: '#ff9800' } : undefined}
                                  >+</button>
                                </div>
                              )}
                            </div>
                          );
                        }

                        const tokenHeaderIndex = mainLen;
                        const tokenRowsEnd = tokenHeaderIndex + (hasT ? 1 + tokens.length : 0);

                        // トークンヘッダー行
                        if (hasT && index === tokenHeaderIndex) {
                          return (
                            <div
                              style={{ ...style, display: 'flex', alignItems: 'center', fontWeight: 'bold', color: '#ff9800', padding: '0 0.8em' }}
                            >
                              領土デッキ: {data.tokenTotal || 0}枚
                            </div>
                          );
                        }

                        // トークン行
                        if (hasT && index < tokenRowsEnd) {
                          const t = tokens[index - tokenHeaderIndex - 1];
                          if (!t) return null;
                          const cnt = tokenDeck[t.id] || 0;
                          const sideCnt = Number(sideDeck[t.id]) || 0;
                          const maxT = t.maxTokenDeckCount ?? 4;
                          const isUnlimited = t.tribe === '基礎';
                          const combinedLimit = isUnlimited ? 99 : 4;
                          const incDisabled = cnt >= maxT || (cnt + sideCnt) >= combinedLimit;
                          return (
                            <div
                              className="card-item"
                              style={{ ...style, touchAction: 'pan-y', cursor: 'pointer' }}
                              {...itemTouchHandlers}
                              onClick={e => {
                                if (
                                  e.target.classList.contains('plusBtn') ||
                                  e.target.classList.contains('minusBtn')
                                ) return;
                                openCardDetail(t);
                              }}
                            >
                              <div className="card-grid-img-wrap" style={{ width: 48, height: 64, marginRight: 8 }}>
                                <img src={t.image} alt={t.name} className="card-grid-img" style={{ width: '100%', height: '100%' }} />
                              </div>
                              <div className="card-info"><b>{t.name}</b> <span style={{ fontSize: '0.9em', color: '#666' }}>({t.type})</span></div>
                              <div className="card-controls">
                                <button onClick={e => { e.stopPropagation(); decreaseTokenCount(t.id); }} className="minusBtn token-btn" disabled={cnt <= 0} style={{ background: '#ff9800' }}>-</button>
                                <span>{cnt}{isUnlimited ? ' / ∞' : ` / ${maxT}`}</span>
                                <button onClick={e => { e.stopPropagation(); increaseTokenCount(t.id); }} className="plusBtn token-btn" disabled={incDisabled} style={{ background: '#ff9800' }}>+</button>
                              </div>
                            </div>
                          );
                        }

                        if (!hasS) return null;

                        const sideHeaderIndex = tokenRowsEnd;
                        // 予備ヘッダー行
                        if (index === sideHeaderIndex) {
                          return (
                            <div
                              style={{ ...style, display: 'flex', alignItems: 'center', fontWeight: 'bold', color: '#43a047', padding: '0 0.8em' }}
                            >
                              予備デッキ: {data.sideTotal || 0}枚
                            </div>
                          );
                        }

                        // 予備行 (+/- ボタン付き、緑テーマ)
                        const s = sides[index - sideHeaderIndex - 1];
                        if (!s) return null;
                        const sCnt = Number(sideDeck[s.id]) || 0;
                        const isDoubleSided = s.isDoubleSided && s.front && s.back;
                        const displaySide = isDoubleSided ? s.front : s;
                        const typeTextSide = isDoubleSided ? `${s.front.type} / ${s.back.type}` : s.type;
                        const sideIsTerritory = isDoubleSided
                          ? (s.front.type === '領土' || s.back.type === '領土')
                          : (s.type === '領土');
                        const sidePrimaryCount = sideIsTerritory ? (Number(tokenDeck[s.id]) || 0) : (deck.find(c => c.id === s.id)?.count || 0);
                        const sideCombinedLimit = getSameNameLimit(s);
                        const sIncDisabled = sCnt >= getSideDeckLimit(s) || (sidePrimaryCount + sCnt) >= sideCombinedLimit;
                        return (
                          <div
                            className="card-item"
                            style={{ ...style, touchAction: 'pan-y', cursor: 'pointer' }}
                            {...itemTouchHandlers}
                            onClick={e => {
                              if (
                                e.target.classList.contains('plusBtn') ||
                                e.target.classList.contains('minusBtn')
                              ) return;
                              openCardDetail(s);
                            }}
                          >
                            <div className="card-grid-img-wrap" style={{ width: 48, height: 64, marginRight: 8 }}>
                              <img src={displaySide.image} alt={displaySide.name} className="card-grid-img" style={{ width: '100%', height: '100%' }} />
                            </div>
                            <div className="card-info"><b>{s.name}</b> <span style={{ fontSize: '0.9em', color: '#666' }}>({typeTextSide})</span></div>
                            <div className="card-controls">
                              <button
                                onClick={e => { e.stopPropagation(); decreaseSideCount(s.id); }}
                                className="minusBtn side-btn"
                                disabled={sCnt <= 0}
                                style={{ background: '#43a047' }}
                              >-</button>
                              <span>{sCnt} / {getSideDeckLimit(s)}</span>
                              <button
                                onClick={e => { e.stopPropagation(); increaseSideCount(s.id); }}
                                className="plusBtn side-btn"
                                disabled={sIncDisabled}
                                style={{ background: '#43a047' }}
                              >+</button>
                            </div>
                          </div>
                        );
                      }}
                    </FixedSizeList>
                  );
                })()}
              </div>
            ) : (
              <div className="card-grid" style={{ width: '100%', maxWidth: '100vw', touchAction: 'pan-y' }}>
                {(() => {
                  const tokenTotal = Object.values(tokenDeck).reduce((sum, cnt) => sum + Math.max(0, Number(cnt) || 0), 0);
                  const hasAnyCards = deck.length > 0 || tokenTotal > 0;
                  if (!hasAnyCards) return <div>デッキが空です。</div>;
                  if (deck.length === 0) return null;
                  return (
                  <FixedSizeGrid
                    height={(deck.length === 0 ? 1 : Math.ceil(deck.length / gridColumns)) * gridRowHeight}
                    columnCount={gridColumns}
                    columnWidth={gridColWidth}
                    rowCount={Math.ceil(deck.length / gridColumns)}
                    rowHeight={gridRowHeight}
                    width={listSize.width}
                    itemData={deckItemData}
                  >
                    {CardGridCell}
                  </FixedSizeGrid>
                  );
                })()}
              </div>
            )}
            {/* トークンデッキ管理 */}
            {viewMode === 'grid' && (() => {
              // 関連トークンでも、枚数が0なら「トークン無し」扱い（表示しない）
              const tokenCardsFromDeck = collectRelatedTokensFromCards(deck)
                .filter(t => (Number(tokenDeck[t.id]) || 0) > 0);
              const fromDeckIdSet = new Set(tokenCardsFromDeck.map(t => t.id));
              const extraTokenIds = Object.entries(tokenDeck)
                .filter(([, cnt]) => (Number(cnt) || 0) > 0)
                .map(([id]) => Number(id))
                .filter(id => !fromDeckIdSet.has(id));
              const extraTokenCards = extraTokenIds
                .map(id => cardMapById.get(id))
                .filter(Boolean);
              const tokenCards = [...tokenCardsFromDeck, ...extraTokenCards];
              if (!tokenCards.length) return null;
              const tokenTotal = tokenCards.reduce((sum, t) => sum + (Number(tokenDeck[t.id]) || 0), 0);
              return (
                <div style={{ marginTop: '0.8em' }}>
                  <h3 style={{ fontSize: '1.05em', fontWeight: 'bold', margin: '0.2em 0 0.5em 0', color: '#ff9800' }}>領土デッキ: {tokenTotal}枚</h3>
                  <div className="card-grid" style={{ width: '100%', maxWidth: '100vw', touchAction: 'pan-y' }}>
                    <FixedSizeGrid
                      height={Math.ceil(tokenCards.length / gridColumns) * gridRowHeight}
                      columnCount={gridColumns}
                      columnWidth={gridColWidth}
                      rowCount={Math.ceil(tokenCards.length / gridColumns)}
                      rowHeight={gridRowHeight}
                      width={listSize.width}
                      itemData={{ context: renderContext, cards: tokenCards, columns: gridColumns, section: 'territory' }}
                    >
                      {CardGridCell}
                    </FixedSizeGrid>
                  </div>
                </div>
              );
            })()}
            {/* 予備デッキ管理 (グリッド) */}
            {viewMode === 'grid' && (() => {
              const sideCards = sortDeckCards(
                Object.entries(sideDeck)
                  .filter(([, cnt]) => (Number(cnt) || 0) > 0)
                  .map(([id]) => cardMapById.get(Number(id)))
                  .filter(Boolean)
              );
              if (!sideCards.length) return null;
              const sideTotal = sideCards.reduce((sum, c) => sum + (Number(sideDeck[c.id]) || 0), 0);
              return (
                <div style={{ marginTop: '0.8em' }}>
                  <h3 style={{ fontSize: '1.05em', fontWeight: 'bold', margin: '0.2em 0 0.5em 0', color: '#43a047' }}>予備デッキ: {sideTotal}枚</h3>
                  <div className="card-grid" style={{ width: '100%', maxWidth: '100vw', touchAction: 'pan-y' }}>
                    <FixedSizeGrid
                      height={Math.ceil(sideCards.length / gridColumns) * gridRowHeight}
                      columnCount={gridColumns}
                      columnWidth={gridColWidth}
                      rowCount={Math.ceil(sideCards.length / gridColumns)}
                      rowHeight={gridRowHeight}
                      width={listSize.width}
                      itemData={{ context: renderContext, cards: sideCards, columns: gridColumns, section: 'side' }}
                    >
                      {CardGridCell}
                    </FixedSizeGrid>
                  </div>
                </div>
              );
            })()}
            <div className="input-row">
              <input
                id="deckNameInput"
                placeholder="デッキ名"
                type="text"
                value={deckName}
                onChange={e => setDeckName(e.target.value)}
              />
            </div>
            <div className="input-row" style={{ gap: '0.5em' }}>
              <button id="saveDeckBtn" style={{ flex: 1, background: '#388e3c' }} onClick={saveCurrentDeck}>デッキ保存</button>
              {/* ▼▼▼ デッキ共有ボタン追加 ▼▼▼ */}
              <button style={{ flex: 1, background: '#1976d2', color: '#fff' }}
                onClick={() => {
                  const url = getShareUrl();
                  window.prompt('このURLをコピーして共有できます', url);
                }}
                disabled={deck.length === 0 && Object.values(tokenDeck).every(v => (Number(v) || 0) <= 0)}
              >デッキ共有URL</button>
            </div>
            <div className="input-row" style={{ gap: '0.5em', marginTop: '0.5em' }}>
              <button style={{ flex: 1, background: '#7b1fa2', color: '#fff' }}
                onClick={() => {
                  const mainCards = deck.map(c => ({ id: c.id, count: c.count || 0 })).filter(c => c.count > 0);
                  setQrExport({
                    deckName: deckName || '名称未設定',
                    mainCards,
                    tokenCards: tokenDeck,
                    sideCards: sideDeck,
                  });
                }}
                disabled={deck.length === 0}
              >QRで書き出し</button>
            </div>
            <button id="clearDeckBtn" style={{ flex: 1, background: '#bbb', color: '#222', marginTop: '0.5em' }} onClick={createNewDeck}>クリア</button>
            <div id="message"></div>
          </div>
        </div>
        {/* 保存デッキタブ */}
        <div className="tab-content" style={{ display: activeTab === 'saved' ? 'block' : 'none' }}>
          <div ref={savedContainerRef} style={{ width: '100%', height: '100%', touchAction: 'pan-y' }}>
            <h2>保存デッキ</h2>
            {/* JSONデッキ読込ボタン */}
            <div style={{ marginBottom: '1em', display: 'flex', gap: '1em', alignItems: 'center' }}>
              <label style={{ background: '#1976d2', color: '#fff', borderRadius: 6, padding: '0.4em 1em', fontWeight: 'bold', cursor: 'pointer' }}>
                JSONデッキ読込
                <input type="file" accept="application/json" style={{ display: 'none' }}
                  onChange={async e => {
                    const file = e.target.files[0];
                    if (!file) return;
                    try {
                      const text = await file.text();
                      const deck = JSON.parse(text);
                      if (!deck || !Array.isArray(deck.cards) || !deck.name) {
                        alert('不正なデッキデータです');
                        return;
                      }

                      // 取込時に最小形式へ整形 + tokenDeckを正規化
                      const inputCards = Array.isArray(deck.cards) ? deck.cards : [];
                      const minimalCards = inputCards.map(c => ({ id: c.id, count: c.count || 0, isDeckThumbnail: !!c.isDeckThumbnail }));
                      const hasTokenDeckField = Object.prototype.hasOwnProperty.call(deck, 'tokenDeck');
                      let tokenDeckArr;
                      if (hasTokenDeckField) {
                        if (Array.isArray(deck.tokenDeck)) {
                          tokenDeckArr = deck.tokenDeck
                            .map(t => ({ id: Number(t?.id), count: Number(t?.count) || 0 }))
                            .filter(t => Number.isFinite(t.id) && t.id > 0 && t.count > 0);
                        } else if (deck.tokenDeck && typeof deck.tokenDeck === 'object') {
                          tokenDeckArr = Object.entries(deck.tokenDeck)
                            .map(([id, count]) => ({ id: Number(id), count: Number(count) || 0 }))
                            .filter(t => Number.isFinite(t.id) && t.id > 0 && t.count > 0);
                        } else {
                          tokenDeckArr = [];
                        }
                      } else {
                        // 旧型（tokenDeck無し）は関連トークンを9枚として初期化
                        const hydratedCards = rehydrateCards(minimalCards);
                        const legacyTokenCards = collectRelatedTokensFromCards(hydratedCards);
                        tokenDeckArr = legacyTokenCards.map(t => ({
                          id: Number(t.id),
                          count: Math.min(9, t.maxTokenDeckCount ?? 4),
                        })).filter(t => Number.isFinite(t.id) && t.id > 0 && t.count > 0);
                      }

                      // 予備デッキ正規化
                      const hasSideDeckField = Object.prototype.hasOwnProperty.call(deck, 'sideDeck');
                      let sideDeckArr = [];
                      if (hasSideDeckField) {
                        if (Array.isArray(deck.sideDeck)) {
                          sideDeckArr = deck.sideDeck
                            .map(s => ({ id: Number(s?.id), count: Number(s?.count) || 0 }))
                            .filter(s => Number.isFinite(s.id) && s.id > 0 && s.count > 0);
                        } else if (deck.sideDeck && typeof deck.sideDeck === 'object') {
                          sideDeckArr = Object.entries(deck.sideDeck)
                            .map(([id, count]) => ({ id: Number(id), count: Number(count) || 0 }))
                            .filter(s => Number.isFinite(s.id) && s.id > 0 && s.count > 0);
                        }
                      }

                      // 旧世代（新弾追加前）に書き出した JSON は領土カードの ID がずれているので補正する
                      const normalizedDeck = migrateSavedDeck({
                        name: deck.name,
                        cards: minimalCards,
                        ...(hasTokenDeckField ? { tokenDeck: tokenDeckArr } : {}),
                        ...(hasSideDeckField || sideDeckArr.length > 0 ? { sideDeck: sideDeckArr } : {}),
                        ...(Object.prototype.hasOwnProperty.call(deck, 'thumbnailCardId') ? { thumbnailCardId: Number(deck.thumbnailCardId) || null } : {}),
                      });
                      // 既存と同名なら上書き確認
                      const exists = savedDecks.some(d => d.name === normalizedDeck.name);
                      if (exists && !window.confirm(`同名のデッキ「${normalizedDeck.name}」を上書きしますか？`)) return;
                      setSavedDecks(prev => {
                        const filtered = prev.filter(d => d.name !== normalizedDeck.name);
                        return [...filtered, normalizedDeck];
                      });
                      alert(`デッキ「${normalizedDeck.name}」を保存デッキに追加しました`);
                    } catch {
                      alert('ファイルの読み込みに失敗しました');
                    }
                    e.target.value = '';
                  }}
                />
              </label>
              <DeckQrImportButton
                onDeckImported={(importedDeck) => {
                  // QR から復元された minimal deck を保存デッキにマージ
                  let name = importedDeck.name;
                  while (savedDecks.some(d => d.name === name)) {
                    const next = window.prompt(`同名のデッキ「${name}」が存在します。別名を入力してください（キャンセルで上書き）。`, `${name} (2)`);
                    if (next === null) break; // キャンセル＝上書き
                    name = next.trim() || name;
                  }
                  const normalizedDeck = {
                    name,
                    cards: importedDeck.cards.map(c => ({ id: Number(c.id), count: Number(c.count) || 0 })).filter(c => c.id > 0 && c.count > 0),
                    tokenDeck: importedDeck.tokenDeck.map(t => ({ id: Number(t.id), count: Number(t.count) || 0 })).filter(t => t.id > 0 && t.count > 0),
                    sideDeck: importedDeck.sideDeck.map(s => ({ id: Number(s.id), count: Number(s.count) || 0 })).filter(s => s.id > 0 && s.count > 0),
                  };
                  setSavedDecks(prev => {
                    const filtered = prev.filter(d => d.name !== normalizedDeck.name);
                    return [...filtered, normalizedDeck];
                  });
                  alert(`デッキ「${normalizedDeck.name}」を保存デッキに追加しました`);
                }}
              />
            </div>
            <div className="saved-decks-grid">
              {savedDecks.length === 0 && <div>保存デッキなし</div>}
              {savedDecks.map((saved) => {
                const mainCount = (saved.cards || []).reduce((sum, c) => sum + (c.count || 0), 0);
                const hasTokenDeckField = Object.prototype.hasOwnProperty.call(saved, 'tokenDeck');
                const tokenCount = hasTokenDeckField
                  ? (
                    Array.isArray(saved.tokenDeck)
                      ? saved.tokenDeck.reduce((sum, t) => sum + (t?.count || 0), 0)
                      : (saved.tokenDeck && typeof saved.tokenDeck === 'object')
                        ? Object.values(saved.tokenDeck).reduce((sum, v) => sum + (Number(v) || 0), 0)
                        : 0
                  )
                  : (() => {
                    const hydratedCards = rehydrateCards(saved.cards || []);
                    const legacyTokenCards = collectRelatedTokensFromCards(hydratedCards);
                    return legacyTokenCards.reduce((sum, t) => sum + Math.min(9, t.maxTokenDeckCount ?? 4), 0);
                  })();
                const sideCount = (() => {
                  const raw = saved.sideDeck;
                  if (Array.isArray(raw)) return raw.reduce((sum, s) => sum + (Number(s?.count) || 0), 0);
                  if (raw && typeof raw === 'object') return Object.values(raw).reduce((sum, v) => sum + (Number(v) || 0), 0);
                  return 0;
                })();

                return (
                <div className="saved-deck-card" key={saved.name}
                  onClick={e => {
                    // 編集・削除ボタン以外のクリックで詳細ウィンドウ
                    if (
                      e.target.closest('.deck-actions')
                    ) return;
                    // 最新データに再結合した上で詳細を表示
                    const hydratedCards = rehydrateCards(saved.cards);
                    const relatedTokens = collectRelatedTokensFromCards(hydratedCards);
                    const hasTokenDeckField = Object.prototype.hasOwnProperty.call(saved, 'tokenDeck');
                    let tokenDeckArr;
                    if (hasTokenDeckField) {
                      if (Array.isArray(saved.tokenDeck)) {
                        tokenDeckArr = saved.tokenDeck
                          .map(t => ({ id: Number(t?.id), count: Number(t?.count) || 0 }))
                          .filter(t => Number.isFinite(t.id) && t.id > 0 && t.count > 0);
                      } else if (saved.tokenDeck && typeof saved.tokenDeck === 'object') {
                        tokenDeckArr = Object.entries(saved.tokenDeck)
                          .map(([id, count]) => ({ id: Number(id), count: Number(count) || 0 }))
                          .filter(t => Number.isFinite(t.id) && t.id > 0 && t.count > 0);
                      } else {
                        tokenDeckArr = [];
                      }
                    } else {
                      // 旧型（tokenDeck無し）は関連トークンを9枚として初期化
                      tokenDeckArr = relatedTokens.map(t => ({
                        id: Number(t.id),
                        count: Math.min(9, t.maxTokenDeckCount ?? 4),
                      })).filter(t => Number.isFinite(t.id) && t.id > 0 && t.count > 0);
                    }
                    // 予備デッキ正規化
                    let sideDeckArr = [];
                    const rawSide = saved.sideDeck;
                    if (Array.isArray(rawSide)) {
                      sideDeckArr = rawSide
                        .map(s => ({ id: Number(s?.id), count: Number(s?.count) || 0 }))
                        .filter(s => Number.isFinite(s.id) && s.id > 0 && s.count > 0);
                    } else if (rawSide && typeof rawSide === 'object') {
                      sideDeckArr = Object.entries(rawSide)
                        .map(([id, count]) => ({ id: Number(id), count: Number(count) || 0 }))
                        .filter(s => Number.isFinite(s.id) && s.id > 0 && s.count > 0);
                    }
                    const detail = { ...saved, cards: hydratedCards, relatedTokens, tokenDeck: tokenDeckArr, sideDeck: sideDeckArr };
                    setDetailDeck(detail);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5em', marginBottom: '0.5em' }}>
                    {/* サムネイル画像表示 */}
                    {saved.thumbnail ? (
                      <img src={saved.thumbnail} alt="サムネイル" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, border: '2px solid #1976d2' }} />
                    ) : (
                      (() => {
                        const hydrated = rehydrateCards(saved.cards || []);
                        const thumbFromCards = hydrated.find(c => c.isDeckThumbnail)?.id ?? hydrated[0]?.id ?? null;
                        const thumbFromTokens = (() => {
                          const td = saved.tokenDeck;
                          if (Array.isArray(td)) return td.find(t => (Number(t?.count) || 0) > 0)?.id ?? null;
                          if (td && typeof td === 'object') return Object.entries(td).find(([, cnt]) => (Number(cnt) || 0) > 0)?.[0] ?? null;
                          return null;
                        })();
                        const thumbId = (saved.thumbnailCardId ?? null) ?? thumbFromCards ?? (thumbFromTokens ? Number(thumbFromTokens) : null);
                        if (!thumbId) return null;
                        const card = cardMapById.get(Number(thumbId));
                        if (!card) return null;
                        const isDoubleSided = card.isDoubleSided && card.front && card.back;
                        const displayCard = isDoubleSided ? card.front : card;
                        return <img src={displayCard.image} alt="サムネイル" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, border: '2px solid #1976d2' }} />;
                      })()
                    )}
                    {/* 公開状態アイコン (サムネ右隣・独立) — 表示専用、操作は詳細モーダル経由 */}
                    <span
                      title={saved.isPublic ? '公開中' : '非公開'}
                      aria-label={saved.isPublic ? '公開中' : '非公開'}
                      style={{
                        width: 28, height: 28, borderRadius: '50%',
                        background: saved.isPublic ? '#e8f5e9' : '#f5f5f5',
                        border: `1px solid ${saved.isPublic ? '#43a047' : '#bbb'}`,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.95em',
                        filter: saved.isPublic ? 'none' : 'grayscale(80%) opacity(0.55)',
                        flexShrink: 0,
                        userSelect: 'none',
                      }}
                    >
                      {saved.isPublic ? '🔓' : '🔒'}
                    </span>
                  </div>
                  <div className="deck-title">{saved.name}</div>
                  <div className="deck-count">基礎{mainCount}枚{tokenCount > 0 ? ` 領土${tokenCount}枚` : ''}{sideCount > 0 ? ` 予備${sideCount}枚` : ''}</div>
                  <div className="deck-actions">
                    <button style={{ background: '#1976d2' }} onClick={e => { e.stopPropagation(); loadDeck(saved.name); }}>編集</button>
                    <button style={{ background: '#d32f2f' }} onClick={e => { e.stopPropagation(); deleteDeckByName(saved.name); }}>削除</button>
                  </div>
                </div>
              );
              })}
            </div>
          </div>
        </div>
        {/* QAタブ（ルール・裁定） */}
        <div className="tab-content" style={{ display: activeTab === 'qa' ? 'block' : 'none' }}>
          <div ref={qaContainerRef} style={{ width: '100%', height: '100%', touchAction: 'pan-y' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.6em', flexWrap: 'wrap' }}>
            <span>QA（ルール・裁定）</span>
            <span style={{
              fontSize: '0.6em', fontWeight: 'normal', color: '#666',
              border: '1px solid #ddd', borderRadius: 999, padding: '0.15em 0.7em',
              background: qaRefreshState === 'fresh' ? '#e8f5e9' : qaRefreshState === 'stale' ? '#fff8e1' : '#f5f5f5'
            }}>
              {qaRefreshState === 'loading' ? '最新版を取得中…'
                : qaRefreshState === 'fresh' ? '最新版で表示中'
                : qaRefreshState === 'stale' ? 'バンドル版で表示中（取得失敗）'
                : 'バンドル版'}
            </span>
          </h2>

          {/* 公式ルール文書へのリンク */}
          <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', margin: '0 0 0.9em 0' }}>
            <a href="https://acgtcg.com/pdf/ACG_CR.pdf" target="_blank" rel="noopener noreferrer"
               style={{ fontSize: '0.85em', textDecoration: 'none', color: '#1976d2', border: '1px solid #1976d2', borderRadius: 6, padding: '0.25em 0.7em' }}>
              総合ルール（PDF）
            </a>
            <a href="https://acgtcg.com/pdf/ACG_FR.pdf" target="_blank" rel="noopener noreferrer"
               style={{ fontSize: '0.85em', textDecoration: 'none', color: '#1976d2', border: '1px solid #1976d2', borderRadius: 6, padding: '0.25em 0.7em' }}>
              フロアルール（PDF）
            </a>
            <a href="https://acgtcg.com/pdf/ACG_Banned.pdf" target="_blank" rel="noopener noreferrer"
               style={{ fontSize: '0.85em', textDecoration: 'none', color: '#d32f2f', border: '1px solid #d32f2f', borderRadius: 6, padding: '0.25em 0.7em' }}>
              禁止カード（PDF）
            </a>
            <a href="https://acgtcg.com/QA.html" target="_blank" rel="noopener noreferrer"
               style={{ fontSize: '0.85em', textDecoration: 'none', color: '#666', border: '1px solid #bbb', borderRadius: 6, padding: '0.25em 0.7em' }}>
              公式 Q&A サイト ↗
            </a>
          </div>

          <div style={{ display: 'grid', gap: '0.8em', gridTemplateColumns: '1fr' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 6 }}>キーワード検索</label>
              <div className="input-row" style={{ gap: '0.5em' }}>
                <input
                  type="text"
                  placeholder="例: 崩落 / 鉄壁 / 対象 など"
                  value={qaQuery}
                  onChange={(e) => setQaQuery(e.target.value)}
                />
                <button
                  onClick={() => setQaQuery('')}
                  style={{ background: '#888', color: '#fff', visibility: qaQuery ? 'visible' : 'hidden' }}
                >クリア</button>
              </div>
              <div style={{ color: '#666', fontSize: '0.9em', marginTop: '0.3em' }}>
                （{filteredQaCount} 件 / 全 {qaSectionsState.reduce((a,s)=>a+s.entries.length,0)} 件）
              </div>
            </div>

            {/* 弾フィルタ */}
            <div style={{ display: 'flex', gap: '0.4em', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontWeight: 'bold', marginRight: '0.3em' }}>弾で絞り込み:</span>
              <button
                onClick={() => setQaSectionFilter('')}
                style={{
                  fontSize: '0.85em', padding: '0.25em 0.7em', borderRadius: 999,
                  border: '1px solid ' + (qaSectionFilter === '' ? '#1976d2' : '#ccc'),
                  background: qaSectionFilter === '' ? '#1976d2' : '#fff',
                  color: qaSectionFilter === '' ? '#fff' : '#333', cursor: 'pointer'
                }}
              >すべて</button>
              {qaSectionsState.map((sec) => (
                <button
                  key={sec.id}
                  onClick={() => setQaSectionFilter(sec.id)}
                  title={`公開: ${sec.publishedAt || '?'}${sec.updatedAt ? ` / 更新: ${sec.updatedAt}` : ''}`}
                  style={{
                    fontSize: '0.85em', padding: '0.25em 0.7em', borderRadius: 999,
                    border: '1px solid ' + (qaSectionFilter === sec.id ? '#1976d2' : '#ccc'),
                    background: qaSectionFilter === sec.id ? '#1976d2' : '#fff',
                    color: qaSectionFilter === sec.id ? '#fff' : '#333', cursor: 'pointer'
                  }}
                >{sec.name}（{sec.entries.length}）</button>
              ))}
            </div>

            {/* セクション別 Q&A 一覧 */}
            <div>
              {filteredQaSections.length === 0 && (
                <div style={{ padding: '0.8em', color: '#777', border: '1px solid #ddd', borderRadius: 8 }}>
                  一致するQAが見つかりませんでした。
                </div>
              )}
              {filteredQaSections.map((sec) => (
                <div key={sec.id} style={{ marginBottom: '1.2em' }}>
                  <div style={{
                    display: 'flex', alignItems: 'baseline', gap: '0.6em', flexWrap: 'wrap',
                    borderBottom: '2px solid #1976d2', paddingBottom: 4, marginBottom: 4,
                  }}>
                    <h3 style={{ margin: 0, fontSize: '1.05em', color: '#1976d2' }}>{sec.title}</h3>
                    <span style={{ color: '#666', fontSize: '0.85em' }}>
                      {sec.publishedAt && `公開: ${sec.publishedAt}`}
                      {sec.updatedAt && `　更新: ${sec.updatedAt}`}
                    </span>
                    <span style={{ marginLeft: 'auto', color: '#999', fontSize: '0.85em' }}>{sec.entries.length} 件</span>
                  </div>
                  <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
                    {sec.entries.map((item, idx) => {
                      const qNum = idx + 1;
                      const open = !!qaOpen[item.id];
                      const hover = !!qaHover[item.id];
                      return (
                        <div key={item.id} style={{ borderTop: idx === 0 ? 'none' : '1px solid #eee' }}>
                          <button
                            onClick={() => toggleQa(item.id)}
                            onMouseEnter={() => setQaHover(prev => ({ ...prev, [item.id]: true }))}
                            onMouseLeave={() => setQaHover(prev => ({ ...prev, [item.id]: false }))}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '0.6em', width: '100%', textAlign: 'left',
                              padding: '0.7em 0.9em',
                              background: (open || hover) ? '#1976d2' : '#fafafa',
                              border: 'none', cursor: 'pointer',
                              color: (open || hover) ? '#fff' : '#000'
                            }}
                          >
                            <span style={{ fontWeight: 'bold', color: (open || hover) ? '#fff' : '#1976d2', minWidth: '2.4em' }}>{`Q${qNum}`}</span>
                            {item.updated && (
                              <span style={{
                                fontSize: '0.7em', padding: '0.05em 0.5em', borderRadius: 999,
                                background: (open || hover) ? '#fff' : '#d32f2f',
                                color: (open || hover) ? '#d32f2f' : '#fff', fontWeight: 'bold'
                              }}>更新</span>
                            )}
                            <span style={{ flex: 1, color: (open || hover) ? '#fff' : '#000' }}>{item.question}</span>
                            <span style={{ color: (open || hover) ? '#fff' : '#999' }}>{open ? '▲' : '▼'}</span>
                          </button>
                          {open && (
                            <div style={{ padding: '0.7em 1em 0.9em 2.2em', background: '#fff' }}>
                              <div style={{ marginBottom: '0.5em' }}>
                                <div style={{ fontWeight: 'bold', color: '#388e3c', marginBottom: 4 }}>A.</div>
                                <div className="qa-answer" style={{ lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: item.answer }} />
                              </div>
                              <div style={{ display: 'flex', gap: '0.4em', flexWrap: 'wrap', marginTop: 6 }}>
                                {(item.tags || []).map(tag => (
                                  <button
                                    key={tag}
                                    onClick={() => setQaQuery(tag)}
                                    style={{
                                      fontSize: '0.85em', background: '#e3f2fd', color: '#1976d2',
                                      padding: '0.1em 0.5em', borderRadius: 999, border: 'none', cursor: 'pointer'
                                    }}
                                    title={`「${tag}」で絞り込み`}
                                  >{tag}</button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          </div>
        </div>
      </div>

      <ExportFilesModal
        open={!!exportFilesModal}
        title={exportFilesModal?.title}
        files={exportFilesModal?.files}
        onClose={closeExportFilesModal}
      />
      <DeckQrExportModal
        open={!!qrExport}
        deckName={qrExport?.deckName}
        mainCards={qrExport?.mainCards}
        tokenCards={qrExport?.tokenCards}
        sideCards={qrExport?.sideCards}
        onClose={() => setQrExport(null)}
      />
      {/* デッキ詳細ウィンドウ */}
      {detailDeck && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setDetailDeck(null)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '1.2em 1em 1em 1em', maxWidth: 500, width: '95vw', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button
              style={{ position: 'absolute', top: 8, right: 12, fontSize: '1.3em' }}
              onClick={() => setDetailDeck(null)}
            >
              ×
            </button>
            <h2 style={{ marginBottom: '0.7em' }}>{detailDeck.name}</h2>
            {/* 概要（コンセプト）+ タグ — 公開デッキで設定された description/tags をここで全文表示 */}
            {((detailDeck.description && detailDeck.description.trim()) || (Array.isArray(detailDeck.tags) && detailDeck.tags.length > 0)) && (
              <div style={{ marginBottom: '0.8em', padding: '0.6em 0.7em', background: '#fafafa', border: '1px solid #eee', borderRadius: 8 }}>
                {detailDeck.description && detailDeck.description.trim() && (
                  <div style={{ color: '#444', fontSize: '0.9em', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {detailDeck.description}
                  </div>
                )}
                {Array.isArray(detailDeck.tags) && detailDeck.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.3em', flexWrap: 'wrap', marginTop: detailDeck.description && detailDeck.description.trim() ? '0.5em' : 0 }}>
                    {detailDeck.tags.map(t => (
                      <span key={t} style={{ background: '#e3f2fd', color: '#1976d2', borderRadius: 999, padding: '0.1em 0.6em', fontSize: '0.78em' }}>
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.7em', gap: '1em', flexWrap: 'wrap' }}>
              {(() => {
                const thumb = detailDeck.thumbnail;
                if (thumb) {
                  return <img src={thumb} alt="サムネイル" style={{ width: 48, height: 64, objectFit: 'cover', borderRadius: 8, border: '2px solid #1976d2', marginRight: '12px' }} />;
                }
                const cards = Array.isArray(detailDeck.cards) ? detailDeck.cards : [];
                const card = cards.find(c => c.isDeckThumbnail) || cards[0];
                if (!card) return null;
                const isDoubleSided = card.isDoubleSided && card.front && card.back;
                const displayCard = isDoubleSided ? card.front : card;
                const src = displayCard?.image;
                if (!src) return null;
                return <img src={src} alt="サムネイル" style={{ width: 48, height: 64, objectFit: 'cover', borderRadius: 8, border: '2px solid #1976d2', marginRight: '12px' }} />;
              })()}
              <span style={{ fontWeight: 'bold', color: '#1976d2', marginRight: '1em' }}>基礎デッキ: {detailDeck.cards.reduce((sum, c) => sum + (c.count || 0), 0)}枚</span>
              {/* ▼▼▼ 出力dropdown + 公開ボタン + リスト/グリッド切替 ▼▼▼ */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                {/* 出力ファイル形式 dropdown (旧 PDF/JSON/PNG ボタン群を集約) */}
                <select
                  value=""
                  onChange={async (e) => {
                    const v = e.target.value;
                    e.target.value = '';
                    if (v === 'pdf') await exportDeckToA4PDF(detailDeck);
                    else if (v === 'json') exportSingleDeckAsJson(detailDeck);
                    else if (v === 'png') await exportDeckSvgToPng(detailDeck);
                  }}
                  style={{ ...pillSelectBaseStyle, backgroundColor: '#1976d2' }}
                  aria-label="出力ファイル形式"
                >
                  <option value="" disabled hidden>出力 ▼</option>
                  <option value="pdf">PDF</option>
                  <option value="json">JSON</option>
                  <option value="png">PNG</option>
                </select>

                {/* オーナー別の操作ボタン:
                    - 他人の公開デッキ → 「コピーして編集」(作成中デッキにロード + タブ移動)
                    - 自分のデッキ (ログイン時のみ) → 公開 / 公開中 dropdown */}
                {detailDeck.userId && (!user || detailDeck.userId !== user.id) ? (
                  <button
                    style={{ background: '#f57c00', color: '#fff', borderRadius: '6px', padding: '0.4em 0.5em', fontWeight: 'bold', fontSize: '1em', lineHeight: 1.2, border: 'none', cursor: 'pointer' }}
                    onClick={() => copyForeignDeckToBuilder(detailDeck)}
                  >
                    取り込む
                  </button>
                ) : (
                  user && (
                    detailDeck.isPublic ? (
                      <select
                        value=""
                        onChange={(e) => {
                          const v = e.target.value;
                          e.target.value = '';
                          if (v === 'edit') setSubmitDeck(detailDeck);
                          else if (v === 'unpublish') handleUnpublishDeck(detailDeck);
                        }}
                        style={{ ...pillSelectBaseStyle, backgroundColor: '#43a047' }}
                        aria-label="公開状態"
                      >
                        <option value="" disabled hidden>公開中 ▼</option>
                        <option value="edit">内容編集</option>
                        <option value="unpublish">非公開化</option>
                      </select>
                    ) : (
                      <button
                        style={{ background: '#f57c00', color: '#fff', borderRadius: '6px', padding: '0.4em 0.5em', fontWeight: 'bold', fontSize: '1em', lineHeight: 1.2, border: 'none', cursor: 'pointer' }}
                        onClick={() => setSubmitDeck(detailDeck)}
                      >
                        公開
                      </button>
                    )
                  )
                )}

                <button className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => setViewMode('list')}>≡</button>
                <button className={`view-toggle-btn${viewMode === 'grid' ? ' active' : ''}`} onClick={() => setViewMode('grid')}>■</button>
              </div>
            </div>
            {/* デッキ詳細リスト/グリッド (抽出済み: src/components/DeckDetailView.jsx) */}
            <DeckDetailView
              deck={detailDeck}
              viewMode={viewMode}
              onCardClick={(card) => { setDetailCard(card); setShowFront(true); }}
              listMaxHeight={320}
            />
          </div>
        </div>
      )}
      {/* デッキ公開フォーム (DeckSubmitModal) — 詳細モーダルの上に重ねる */}
      {submitDeck && user && (
        <DeckSubmitModal
          deck={submitDeck}
          userId={user.id}
          onClose={() => setSubmitDeck(null)}
          onSubmitted={handleDeckSubmitted}
          onCardClick={(card) => { setDetailCard(card); setShowFront(true); }}
        />
      )}
      {/* カード詳細モーダルは最前面に表示 */}
      {detailCard && (
        <CardDetailModal
          card={detailCard}
          show={!!detailCard}
          onClose={closeCardDetail}
          zIndex={3000}
          onSetDeckThumbnail={(cardId) => {
            const idNum = Number(cardId);
            setDeckThumbnailCardId(Number.isFinite(idNum) ? idNum : null);

            // メインデッキ内にあるカードなら従来通りフラグを付ける。トークンのみの場合は全てfalseのまま。
            setDeck(deck => {
              const existsInMain = deck.some(c => Number(c.id) === idNum);
              if (!existsInMain) return deck.map(c => ({ ...c, isDeckThumbnail: false }));
              return deck.map(c => Number(c.id) === idNum ? { ...c, isDeckThumbnail: true } : { ...c, isDeckThumbnail: false });
            });
            setSavedDecks(decks => decks.map(deck => {
              if (deck.name === currentDeckName) {
                const existsInMainSaved = Array.isArray(deck.cards) && deck.cards.some(c => Number(c.id) === idNum);
                return {
                  ...deck,
                  thumbnailCardId: Number.isFinite(idNum) ? idNum : null,
                  cards: (deck.cards || []).map(c => {
                    if (!existsInMainSaved) return { ...c, isDeckThumbnail: false };
                    return Number(c.id) === idNum ? { ...c, isDeckThumbnail: true } : { ...c, isDeckThumbnail: false };
                  })
                };
              }
              return deck;
            }));
          }}
          inDeck={detailCard ? (deck.some(c => c.id === detailCard.id) || ((Number(tokenDeck?.[detailCard.id]) || 0) > 0)) : false}
          countInDeck={detailCard ? getCardCountInDeck(detailCard.id) : 0}
          onIncrease={increaseCardCount}
          onDecrease={decreaseCardCount}
          getTokenCountInDeck={(cardId) => tokenDeck?.[cardId] || 0}
          onTokenIncrease={increaseTokenCount}
          onTokenDecrease={decreaseTokenCount}
          getSideCountInDeck={(cardId) => sideDeck?.[cardId] || 0}
          onSideIncrease={increaseSideCount}
          onSideDecrease={decreaseSideCount}
          showFront={showFront}
          setShowFront={setShowFront}
          hideDeckActions={detailHideDeckActions || !!detailDeck} // 明示指定 or デッキ詳細ウィンドウから開いた場合は非表示
        />
      )}
    </div>
  );
}

// --- ホーム: 募集中イベント表示 ---
function HomeRecruitingEvents() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [myEventIds, setMyEventIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(null); // 参加処理中のeventId

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: evData } = await supabase
        .from('events')
        .select('id, name, date, format, match_type, deck_count')
        .eq('game', APP_GAME_ID)
        .eq('status', 'recruiting')
        .order('date', { ascending: true });
      if (cancelled) return;
      setEvents(evData || []);

      if (user && evData && evData.length > 0) {
        const eventIds = evData.map(e => e.id);
        const { data: parts } = await supabase
          .from('event_participants')
          .select('event_id')
          .eq('user_id', user.id)
          .in('event_id', eventIds);
        if (!cancelled) {
          setMyEventIds(new Set((parts || []).map(p => p.event_id)));
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const handleJoin = async (eventId) => {
    if (!user) { navigate('/login'); return; }
    setJoining(eventId);
    const { error } = await supabase.from('event_participants').insert({
      event_id: eventId,
      user_id: user.id,
    });
    if (error) {
      alert('参加に失敗しました: ' + error.message);
    } else {
      setMyEventIds(prev => new Set([...prev, eventId]));
    }
    setJoining(null);
  };

  const formatLabel = { swiss: 'スイスドロー', round_robin: '総当たり', single_elimination: 'トーナメント' };
  const matchTypeLabel = { bo1: '1本先取', bo3: 'BO3' };

  if (loading) return null;
  if (events.length === 0) return null;

  return (
    <div style={{ background: '#e3f2fd', border: '1px solid #90caf9', padding: '10px', borderRadius: 6, marginBottom: 12 }}>
      <h3 style={{ marginTop: 0, marginBottom: 8 }}>🎪 開催予定のイベント</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {events.map(ev => {
          const joined = myEventIds.has(ev.id);
          return (
            <div key={ev.id} style={{
              background: '#fff', borderRadius: 8, padding: '0.7em',
              border: '1px solid #bbdefb', cursor: 'pointer',
            }} onClick={() => navigate(`/events/${ev.id}`)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 'bold', fontSize: '0.95em' }}>{ev.name}</div>
                  <div style={{ fontSize: '0.8em', color: '#666' }}>
                    {ev.date} ・ {formatLabel[ev.format] || ev.format} ・ {matchTypeLabel[ev.match_type] || ev.match_type} ・ {ev.deck_count === 2 ? '2デッキ制' : '1デッキ制'}
                  </div>
                </div>
                <div style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  {joined ? (
                    <button
                      onClick={() => navigate(`/events/${ev.id}`)}
                      style={{
                        background: '#fff', border: '1px solid #2e7d32', color: '#2e7d32', borderRadius: 6,
                        padding: '1em 0.8em', fontSize: '1em', cursor: 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap',
                      }}
                    >
                      ✅ 応募済み
                    </button>
                  ) : (
                    <button
                      onClick={() => handleJoin(ev.id)}
                      disabled={joining === ev.id}
                      style={{
                        background: '#1976d2', color: '#fff', border: 'none', borderRadius: 6,
                        padding: '1em 0.8em', fontSize: '1em', cursor: joining === ev.id ? 'default' : 'pointer',
                        fontWeight: 'bold', whiteSpace: 'nowrap', opacity: joining === ev.id ? 0.6 : 1,
                      }}
                    >
                      {joining === ev.id ? '処理中...' : '応募する'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

