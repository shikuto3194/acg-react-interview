// 大会形式 (MTG 方式) の順位計算ユーティリティ。
// EventsPage / AdminEventsPage / MyPage で重複していたロジックを 1 箇所に集約する。
//
// 入力:
//   matches: 試合配列（{ status, player1_id, player2_id, winner_id, is_draw, games? }）
//   participants: 参加者配列（{ user_id, ... }）
//
// 出力:
//   { standings, sortedStandings, getRank, getHeadToHead }
//   - standings:        { [uid]: { wins, losses, draws, gameWins, opponents[] } }
//   - sortedStandings:  Array<{ uid, wins, losses, draws, gameWins, opponents, points, omw }>
//   - getRank(index):   sortedStandings[index] の同率順位
//   - getHeadToHead(uid1, uid2): -1 / 0 / 1
//
// すべて pure function。React の useMemo でラップして使うのが想定。

export function calculateStandings(matches, participants) {
  const confirmedMatches = (matches || []).filter(m => m.status === 'confirmed');
  const standings = {};
  for (const p of participants || []) {
    standings[p.user_id] = { wins: 0, losses: 0, draws: 0, gameWins: 0, opponents: [] };
  }

  for (const m of confirmedMatches) {
    if (m.is_draw) {
      if (standings[m.player1_id]) standings[m.player1_id].draws++;
      if (m.player2_id && standings[m.player2_id]) standings[m.player2_id].draws++;
    } else if (m.winner_id) {
      if (standings[m.winner_id]) standings[m.winner_id].wins++;
      const loserId = m.winner_id === m.player1_id ? m.player2_id : m.player1_id;
      if (loserId && standings[loserId]) standings[loserId].losses++;
    }
    // BO3 のゲーム勝利数
    if (Array.isArray(m.games)) {
      for (const g of m.games) {
        if (g.status === 'confirmed' && g.winner_id && standings[g.winner_id]) {
          standings[g.winner_id].gameWins++;
        }
      }
    }
    // 対戦相手リスト記録（不戦勝は除外）
    if (m.player1_id && m.player2_id) {
      if (standings[m.player1_id]) standings[m.player1_id].opponents.push(m.player2_id);
      if (standings[m.player2_id]) standings[m.player2_id].opponents.push(m.player1_id);
    }
  }

  const getWinRate = (uid) => {
    const s = standings[uid];
    if (!s) return 0.33;
    const total = s.wins + s.losses + s.draws;
    if (total === 0) return 0.33;
    return Math.max(0.33, (s.wins * 3 + s.draws) / (total * 3));
  };

  // getOMW を 1 度だけ計算してキャッシュ（O(n²) → O(n)）。
  const omwCache = {};
  const getOMW = (uid) => {
    if (omwCache[uid] !== undefined) return omwCache[uid];
    const s = standings[uid];
    if (!s || s.opponents.length === 0) {
      omwCache[uid] = 0.33;
      return 0.33;
    }
    const sum = s.opponents.reduce((acc, oppId) => acc + getWinRate(oppId), 0);
    const v = sum / s.opponents.length;
    omwCache[uid] = v;
    return v;
  };

  const getHeadToHead = (uid1, uid2) => {
    let w1 = 0, w2 = 0;
    for (const m of confirmedMatches) {
      if (!((m.player1_id === uid1 && m.player2_id === uid2) ||
            (m.player1_id === uid2 && m.player2_id === uid1))) continue;
      if (m.is_draw) continue;
      if (m.winner_id === uid1) w1++;
      else if (m.winner_id === uid2) w2++;
    }
    if (w1 > w2) return -1;
    if (w2 > w1) return 1;
    return 0;
  };

  const sortedStandings = Object.entries(standings)
    .map(([uid, s]) => ({ uid, ...s, points: s.wins * 3 + s.draws, omw: getOMW(uid) }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (Math.abs(b.omw - a.omw) > 0.001) return b.omw - a.omw;
      const h2h = getHeadToHead(a.uid, b.uid);
      if (h2h !== 0) return h2h;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.gameWins - a.gameWins;
    });

  // 同率順位の計算（ループで実装、再帰版は深いスタックを避ける）。
  const rankCache = new Array(sortedStandings.length);
  const getRank = (index) => {
    if (index < 0 || index >= sortedStandings.length) return index + 1;
    if (rankCache[index] !== undefined) return rankCache[index];
    if (index === 0) { rankCache[0] = 1; return 1; }
    const curr = sortedStandings[index];
    const prev = sortedStandings[index - 1];
    if (curr.points === prev.points &&
        Math.abs(curr.omw - prev.omw) < 0.001 &&
        getHeadToHead(curr.uid, prev.uid) === 0 &&
        curr.wins === prev.wins &&
        curr.gameWins === prev.gameWins) {
      const r = getRank(index - 1);
      rankCache[index] = r;
      return r;
    }
    rankCache[index] = index + 1;
    return index + 1;
  };

  return { standings, sortedStandings, getRank, getHeadToHead, getWinRate, getOMW, confirmedMatches };
}
