// 過去イベントの卓番号を修正するスクリプト
// 各ラウンドの対戦について、前ラウンドまでの成績に基づき上位者に若い卓番号を割り当て直す
// 不戦勝は末尾に回す

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nnthvbizvqpufpfkzlho.supabase.co';
const supabaseAnonKey = 'sb_publishable_3v3fyKOO4Bib5aoa-rMwcQ_EOBMK_28';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  // 全イベント取得
  const { data: events, error: evErr } = await supabase.from('events').select('*');
  if (evErr) { console.error('イベント取得失敗:', evErr.message); return; }

  for (const event of events) {
    console.log(`\n=== イベント: ${event.name} (${event.id}) ===`);

    // ラウンド取得（round_number順）
    const { data: rounds } = await supabase
      .from('event_rounds').select('*')
      .eq('event_id', event.id)
      .order('round_number');
    if (!rounds || rounds.length === 0) { console.log('  ラウンドなし'); continue; }

    // 全マッチ取得
    const { data: allMatches } = await supabase
      .from('round_matches').select('*')
      .eq('event_id', event.id);
    if (!allMatches) continue;

    // 参加者取得
    const { data: participants } = await supabase
      .from('event_participants').select('*')
      .eq('event_id', event.id);
    const participantIds = (participants || []).map(p => p.user_id);

    for (const round of rounds) {
      const roundMatches = allMatches.filter(m => m.round_id === round.id);
      if (roundMatches.length === 0) continue;

      // このラウンドより前の確定済みマッチから成績を集計
      const priorMatches = allMatches.filter(m => {
        const r = rounds.find(rr => rr.id === m.round_id);
        return r && r.round_number < round.round_number && m.status === 'confirmed';
      });

      const stats = {};
      participantIds.forEach(id => { stats[id] = { points: 0 }; });
      priorMatches.forEach(m => {
        if (m.is_draw) {
          if (stats[m.player1_id]) stats[m.player1_id].points += 1;
          if (m.player2_id && stats[m.player2_id]) stats[m.player2_id].points += 1;
        } else if (m.winner_id) {
          if (stats[m.winner_id]) stats[m.winner_id].points += 3;
        }
      });

      // 各マッチの「上位側プレイヤーのポイント」でソート（不戦勝は末尾）
      const sorted = [...roundMatches].sort((a, b) => {
        const aIsBye = !a.player2_id;
        const bIsBye = !b.player2_id;
        if (aIsBye && !bIsBye) return 1;
        if (!aIsBye && bIsBye) return -1;
        // 各マッチの上位プレイヤーのポイントで比較
        const aMax = Math.max(stats[a.player1_id]?.points || 0, stats[a.player2_id]?.points || 0);
        const bMax = Math.max(stats[b.player1_id]?.points || 0, stats[b.player2_id]?.points || 0);
        if (bMax !== aMax) return bMax - aMax;
        // 同ポイントなら両プレイヤー合計ポイントで
        const aSum = (stats[a.player1_id]?.points || 0) + (stats[a.player2_id]?.points || 0);
        const bSum = (stats[b.player1_id]?.points || 0) + (stats[b.player2_id]?.points || 0);
        return bSum - aSum;
      });

      // 卓番号を振り直す
      let changed = false;
      const updates = [];
      sorted.forEach((m, idx) => {
        const newTableNumber = idx + 1;
        if (m.table_number !== newTableNumber) {
          changed = true;
          updates.push({ id: m.id, table_number: newTableNumber });
        }
      });

      if (!changed) {
        console.log(`  第${round.round_number}回戦: 変更なし`);
        continue;
      }

      console.log(`  第${round.round_number}回戦: ${updates.length}件更新`);
      for (const u of updates) {
        console.log(`    マッチ ${u.id} → 卓${u.table_number}`);
      }

      // DB更新
      for (const u of updates) {
        const { error } = await supabase
          .from('round_matches')
          .update({ table_number: u.table_number })
          .eq('id', u.id);
        if (error) {
          console.error(`    更新失敗 (${u.id}):`, error.message);
        }
      }
    }
  }

  console.log('\n完了');
}

main();
