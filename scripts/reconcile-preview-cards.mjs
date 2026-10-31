// reconcile-preview-cards.mjs
//
// 公式 acgtcg.com サイトに反映されたカード画像 (public/images/*.png) と
// Supabase の preview_cards 行を perceptual hash (pHash) で照合し、
// 一致したものを `status='superseded'` に更新する。
// (Storage 画像の実体は退役直後には消さず、PURGE_AFTER_DAYS 経過後に遅延削除する。
//  誤退役 (false positive) を一定期間は画像付きで復元できるようにするため)
//
// プレビューカードのライフサイクル:
//   1. /admin/cards でX告知画像から取り込み → preview_cards (status='pending')
//   2. 公式サイトに反映される (数週間〜数ヶ月後)
//   3. 次回 prebuild でこのスクリプトが走り、画像一致 (2条件: 最小距離 + 2番手とのギャップ) を
//      検出して status='superseded' に変更
//   3'. 画像一致しなかったものは「時間ベース退役」の第2パスにかける:
//       追加から2か月経過 かつ そのプレビュー追加後に新弾が公式に出ていれば退役する
//       (暗所カード等 pHash が原理的に当てられないカードの救済。詳細は TIME_RETIRE_AFTER_DAYS 付近)
//   4. フロントでは superseded の preview は非表示になり、公式版が cardData.generated.js 経由で表示される
//   5. 退役から PURGE_AFTER_DAYS 経過後、後続実行が Storage 画像実体を削除 (容量節約)
//
// ※時間ベース退役の限界: プレビューは収録弾を保持しない (tentative_card_number は合成値) ため、
//   「追加後に出た新弾」が "そのカード自身の弾" かどうかは判別できない。通常の運用 (告知は次弾分が
//   大半) では次に出る弾=そのカードの弾なので正しく退役するが、2弾以上先のカードを早期に告知した
//   稀ケースでは、間に別の弾が出た時点で退役してしまう。退役後30日は画像保持で復元可能。
//
// 使い方:
//   node scripts/reconcile-preview-cards.mjs           (通常)
//   node scripts/reconcile-preview-cards.mjs --dry-run (実際の更新はせずログのみ)
//   node scripts/reconcile-preview-cards.mjs --verbose (詳細ログ)
//
// 必要な環境変数:
//   SUPABASE_SERVICE_ROLE_KEY  (Netlify build環境変数。未設定の場合は何もせず正常終了)
//
// 失敗ハンドリング:
//   このスクリプトの失敗で prebuild 全体を止めないよう、エラーはログのみで exit 0 する。
//   (公式画像 / Supabase が一時的に取れなくても再ビルドで再試行されるため)

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const VERBOSE = args.has('--verbose');

// 64bit (= 64 文字) のバイナリ文字列を比較。Hamming distance で同一カードを判定する。
//
// ACG実機テスト結果 (preview SAMPLE透かしあり vs 公式画像):
//   同一カード: 12, 16, 16  (透かしが濃い個体ではさらに +4〜6 膨らみ 18〜22 になり得る)
//   別カード (次点): 24, 28, 24
//
// 公式に存在しない (まだリリースされていない) プレビューでも、数百枚の公式画像との
// 最小距離は偶然 18 程度まで縮むことがあり、単純な「最小距離 <= しきい値」では誤退役
// (false positive) が起きる。実際、6月のパック更新が無い期間に未公開プレビューが
// 誤って退役した。
//
// 対策として、以下 2 条件を「ともに」満たす場合のみ退役する:
//   (a) 最小距離 <= MATCH_THRESHOLD          … そもそも十分近い
//   (b) (2番目に近い距離 - 最小距離) >= MIN_SECOND_BEST_GAP
//                                            … 特定の1枚に「明確に」近いことを要求し、
//                                               多数の公式画像にまんべんなく中途半端に近い
//                                               (= 本物が存在しない) 偶発マッチを除外する
//
// ★誤退役を防いでいる「要」は (b) のギャップ条件であって (a) の絶対しきい値ではない。
//   過去の誤退役は「最小距離 ~18 だが 2番手も僅差 (gap < 6) = 勝者不在のばらけたマッチ」
//   であり、(b) gap>=6 を入れたことで解消した (未公開プレビューは gap が小さい)。
//   逆に本物の一致は best 12-22 / 2番手 (別カード) 24-28 で gap 8-12 と明確に離れる。
//
// ★ただし (b) には落とし穴があった: 同一カードの PNG/WebP 複製・_T エラータを 2番手に数えると
//   gap が ~0 に潰れて本物まで弾かれる (29枚残存の真因)。そのため 2番手は「best とは別カード
//   (kindKey が異なる)」だけで測るよう main() 内で修正済み。これで gap は別カードとの差を表す。
//
// (a) のしきい値は SAMPLE 透かしで膨らんだ本物の一致 (best 17-22) も拾えるよう 16→20 とした。
//   (b) gap>=6 を据え置く限り未公開プレビュー (gap<6) は従来どおり弾かれ、誤退役は回帰しない。
//   ※ (b) を 6 から動かすと「低 gap だが本物」を取りこぼす/「低 gap の偶発」を拾う方向に
//     なるため、誤退役防止の要である (b) は変更しない。
const MATCH_THRESHOLD = 20;       // SAMPLE透かしで膨らむ本物の一致を拾うための余裕 (元は16)
const MIN_SECOND_BEST_GAP = 6;    // 不変: 誤退役防止の要。安易に動かさないこと

// 段階ルール: best が「ほぼ同一アート」と言える水準 (<= STRONG_MATCH_THRESHOLD) のときだけ
//   gap 基準を MIN_SECOND_BEST_GAP(6) → STRONG_MATCH_GAP(4) に緩める。
//
//   狙い: 本物なのに別カードが偶然 5 差にいて gap 6 に僅か届かず残るケース (best 10-11 等) を拾う。
//   安全性: 過去の誤退役は best ~18 の「弱い一致」で起きた。best <= 12 は実質「ほぼ同一アート」で、
//           未公開カードが既存公式カードと偶然そこまで一致することは事実上ない (= ほぼ本物確定)。
//           よって弱い一致ゾーン (best 13-20) の gap 基準は 6 のまま据え置き、誤退役は回帰しない。
const STRONG_MATCH_THRESHOLD = 12; // これ以下の best は「ほぼ同一アート」とみなす
const STRONG_MATCH_GAP = 4;        // 強一致時に許容する最小 gap (通常は 6)

// 時間ベース自動退役 (pHash 不能カードの安全網):
//   pHash で確定できなかったプレビューでも、(1) 追加から TIME_RETIRE_AFTER_DAYS 経過し、
//   かつ (2) そのプレビュー追加日より後に新弾 (新しい弾プレフィックス) が公式に出ていれば、
//   「該当カードはもう発売された」とみなして退役する。
//   暗所カード等 pHash が原理的に当てられないものを、誤退役を抑えつつ拾うための仕組み。
//   弾の初出日は Supabase acg_pack_seen テーブルに記録する (supabase_pack_seen.sql)。
//   退役後も画像は PURGE_AFTER_DAYS 保持するため、万一の誤退役は復元可能。
const TIME_RETIRE_AFTER_DAYS = 60; // 「2か月」

// 退役 (superseded) してからこの日数が経過した行の Storage 画像を遅延削除する。
// 退役直後には画像を消さないことで、誤退役を一定期間は画像付きで復元できる。
const PURGE_AFTER_DAYS = 30;
// 遅延削除済みを示す notes マーカー (重複削除と監査用。スキーマ変更を避けるため notes に記録)。
const IMAGE_PURGED_MARKER = '[image-purged]';

// アートワーク領域の比率 (カードの中央部分のみハッシュしてテンプレート部の影響を除外する)。
// ACG カードは上部にコスト/名前、下部にATK/DEF/効果があり、中央 25-70% がアートワーク。
const ARTWORK_CROP = { topRatio: 0.25, leftRatio: 0.05, widthRatio: 0.90, heightRatio: 0.45 };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nnthvbizvqpufpfkzlho.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function log(...a) { console.log('[reconcile]', ...a); }
function logV(...a) { if (VERBOSE) console.log('[reconcile][v]', ...a); }
function logErr(...a) { console.warn('[reconcile][warn]', ...a); }

async function main() {
  if (process.env.INTERVIEW_BUILD === 'true') {
    log('面接用ビルドでは共有/本番 Supabase を変更しないためスキップ');
    return;
  }

  if (!SUPABASE_SERVICE_KEY) {
    log('SUPABASE_SERVICE_ROLE_KEY が未設定のためスキップ (ローカル開発時など)');
    return;
  }

  // 動的 import (ローカル開発で sharp-phash / sharp が未インストールでもスクリプト全体は壊さない)
  let phash, sharp, createClient;
  try {
    phash = (await import('sharp-phash')).default;
    sharp = (await import('sharp')).default;
    createClient = (await import('@supabase/supabase-js')).createClient;
  } catch (e) {
    logErr('依存パッケージのロード失敗 (npm install sharp-phash 推奨):', e.message);
    return;
  }

  // 画像バッファのアートワーク領域だけを切り出して pHash を計算する。
  // テンプレート (コスト円・名前枠・ATK/DEF・効果テキスト枠) を除外することで
  // カード固有のイラスト部分のみで比較でき、同テンプレート別カードの誤マッチを防ぐ。
  async function hashArtwork(buffer) {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) throw new Error('画像サイズ取得失敗');
    const top = Math.round(meta.height * ARTWORK_CROP.topRatio);
    const left = Math.round(meta.width * ARTWORK_CROP.leftRatio);
    const width = Math.round(meta.width * ARTWORK_CROP.widthRatio);
    const height = Math.round(meta.height * ARTWORK_CROP.heightRatio);
    const cropped = await sharp(buffer).extract({ top, left, width, height }).toBuffer();
    return phash(cropped);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // 1. 退役候補となる preview_cards を取得
  const { data: previews, error } = await supabase
    .from('preview_cards')
    .select('id, tentative_card_number, permanent_image_url, status, source_url, created_at')
    .eq('game', 'acg')
    .in('status', ['pending', 'auto_approved']);
  if (error) { logErr('preview_cards 取得失敗:', error.message); return; }
  if (!previews || previews.length === 0) { log('退役候補のプレビューはなし'); return; }
  log(`退役候補プレビュー: ${previews.length} 件`);

  // 2. 公式画像のハッシュをすべて計算 (public/images/*.png|jpg|webp)
  const imagesDir = join(projectRoot, 'public', 'images');
  let files;
  try {
    files = await readdir(imagesDir);
  } catch (e) {
    logErr('public/images が読めない:', e.message);
    return;
  }
  const officialFiles = files.filter(f => /\.(png|jpe?g|webp)$/i.test(f));
  log(`公式画像 ${officialFiles.length} 件のハッシュ計算中...`);

  const officialHashes = [];
  for (const f of officialFiles) {
    try {
      const buf = await readFile(join(imagesDir, f));
      const hash = await hashArtwork(buf);
      const cardNumber = basename(f, extname(f));
      officialHashes.push({ file: f, hash, cardNumber });
    } catch (e) {
      logErr(`公式画像 ${f} のハッシュ計算失敗:`, e.message);
    }
  }
  log(`公式ハッシュ計算完了: ${officialHashes.length} 件`);

  // 2.5 弾プレフィックスの初出日を更新・取得 (時間ベース退役の判定用)。
  //   現在 public/images にある弾プレフィックスを集計し、未登録のものを first_seen_at=now で記録。
  //   acg_pack_seen テーブルが無い/読めない場合は packSeen=null として時間ベース退役をスキップ
  //   (テーブル未作成でもビルド・pHash 退役は壊さない fail-safe)。
  let packSeen = null;
  try {
    const currentPrefixes = new Set();
    for (const off of officialHashes) {
      const p = packPrefixOfCardNumber(off.cardNumber);
      if (p) currentPrefixes.add(p);
    }
    const { data: existingRows, error: selErr } = await supabase
      .from('acg_pack_seen')
      .select('prefix, first_seen_at');
    if (selErr) throw new Error(selErr.message);
    const known = new Set((existingRows || []).map(r => r.prefix));
    const toInsert = [...currentPrefixes].filter(p => !known.has(p)).map(prefix => ({ prefix }));
    if (toInsert.length > 0) {
      log(`新しい弾プレフィックスを記録: ${toInsert.map(r => r.prefix).join(', ')}`);
      if (!DRY_RUN) {
        const { error: insErr } = await supabase
          .from('acg_pack_seen')
          .upsert(toInsert, { onConflict: 'prefix', ignoreDuplicates: true });
        if (insErr) throw new Error(insErr.message);
      }
    }
    // 反映後の全行を再取得 (初回 INSERT 分も含める)
    const { data: allRows, error: reSelErr } = await supabase
      .from('acg_pack_seen')
      .select('prefix, first_seen_at');
    if (reSelErr) throw new Error(reSelErr.message);
    packSeen = (allRows || []).map(r => ({ prefix: r.prefix, firstSeen: new Date(r.first_seen_at).getTime() }));
    logV(`acg_pack_seen: ${packSeen.map(p => `${p.prefix}@${new Date(p.firstSeen).toISOString().slice(0,10)}`).join(', ')}`);
  } catch (e) {
    logErr(`acg_pack_seen 利用不可 (時間ベース退役をスキップ): ${e.message}`);
    packSeen = null;
  }

  // 3. 各 preview について最適マッチを探索
  let supersededCount = 0;
  let timeSupersededCount = 0;
  let keptCount = 0;
  let errorCount = 0;

  const TIME_CUTOFF = Date.now() - TIME_RETIRE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  // そのプレビュー追加日 (createdMs) より後に出た弾があるか。
  const hasNewerPack = (createdMs) =>
    Array.isArray(packSeen) && packSeen.some((p) => p.firstSeen > createdMs);

  for (const prev of previews) {
    try {
      const res = await fetch(prev.permanent_image_url);
      if (!res.ok) {
        logErr(`preview ${prev.id} の画像取得失敗: HTTP ${res.status}`);
        errorCount++;
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const previewHash = await hashArtwork(buf);

      // 最小 (best) と「best とは別カードの」2番目に近い距離 (secondBest) を求める。
      //
      // ★重要 (29枚残存の真因): 同一カードは public/images に PNG と WebP の2ファイルが存在する
      //   (convert-images-to-webp が元 PNG を残したまま WebP を追加するため。さらに _T エラータも
      //   同一アート)。これらを secondBest に数えると「自分自身の複製」との距離が ~0 になり、
      //   gap 条件 (b) が常に不成立となって本物の一致まで退役できない。
      //   (実測: 公式PNG vs 公式WebP = 0、preview vs 公式 = 12 → 旧ロジックは best=12/2nd=12/gap=0 で KEEP)
      //
      //   そこで secondBest は kindKey (= 番号から _T を除いたカード識別子) が best と異なる
      //   ものだけで測る。これによりギャップ条件は本来の意図どおり「別カードに対して明確に近いか」
      //   を評価し、PNG/WebP/_T の複製に惑わされない。誤退役防止 (gap<6 の偶発マッチ除外) は不変。
      const kindKeyOfFile = (cn) => cn.replace(/_T$/, '');
      let bestMatch = null;
      let bestDistance = Infinity;
      for (const off of officialHashes) {
        const dist = hammingDistance(previewHash, off.hash);
        if (dist < bestDistance) { bestDistance = dist; bestMatch = off; }
      }
      let secondBestDistance = Infinity;
      if (bestMatch) {
        const bestKey = kindKeyOfFile(bestMatch.cardNumber);
        for (const off of officialHashes) {
          if (kindKeyOfFile(off.cardNumber) === bestKey) continue; // 同一カード(PNG/WebP/_T)を除外
          const dist = hammingDistance(previewHash, off.hash);
          if (dist < secondBestDistance) secondBestDistance = dist;
        }
      }

      const label = prev.tentative_card_number || prev.id;
      const gap = secondBestDistance - bestDistance;
      // best が「ほぼ同一アート」(<= STRONG_MATCH_THRESHOLD) のときだけ gap 基準を緩める段階ルール。
      const requiredGap = bestDistance <= STRONG_MATCH_THRESHOLD ? STRONG_MATCH_GAP : MIN_SECOND_BEST_GAP;
      const isCloseEnough = bestMatch && bestDistance <= MATCH_THRESHOLD;
      const isDistinctMatch = gap >= requiredGap;

      if (isCloseEnough && isDistinctMatch) {
        log(`[MATCH] ${label} → ${bestMatch.cardNumber} (Hamming=${bestDistance}, 2nd=${secondBestDistance}, gap=${gap})`);
        if (!DRY_RUN) {
          // 退役マーク。Storage 画像はここでは消さない (誤退役からの復元余地を残すため)。
          // 実体削除は退役から PURGE_AFTER_DAYS 経過後に purgeOldSupersededImages() で行う。
          const { error: updateError } = await supabase
            .from('preview_cards')
            .update({
              status: 'superseded',
              superseded_by_card_number: bestMatch.cardNumber,
              reviewed_at: new Date().toISOString(),
              notes: `Auto-superseded by reconcile-preview-cards.mjs (pHash distance ${bestDistance}, 2nd ${secondBestDistance}, gap ${gap})`,
            })
            .eq('id', prev.id);
          if (updateError) {
            logErr(`status 更新失敗 (${prev.id}):`, updateError.message);
            errorCount++;
            continue;
          }
        }
        supersededCount++;
      } else {
        const reason = !isCloseEnough
          ? `最小距離 ${bestDistance} > ${MATCH_THRESHOLD}`
          : `gap ${gap} < ${requiredGap} (最小距離に明確な差なし→偶発マッチの疑い)`;

        // pHash で確定できなかった場合の第2パス: 時間ベース退役。
        //   条件 (1) 追加から 2か月 (TIME_RETIRE_AFTER_DAYS) 経過
        //        (2) そのプレビュー追加日より後に新弾 (新プレフィックス) が公式に出た
        //   両方満たせば「該当カードは発売済み」とみなして退役する (暗所カード等の救済)。
        //   superseded_by_card_number は確証が無いので null。退役後も画像は 30日保持で復元可能。
        const createdMs = prev.created_at ? new Date(prev.created_at).getTime() : NaN;
        const ageOk = Number.isFinite(createdMs) && createdMs <= TIME_CUTOFF;
        const newerPack = hasNewerPack(createdMs);
        if (ageOk && newerPack) {
          log(`[TIME-MATCH] ${label}: 追加から2か月超 + 追加後に新弾あり → 退役 (near=${bestMatch?.cardNumber || '?'} best=${bestDistance}, 画像照合は不一致)`);
          if (!DRY_RUN) {
            const { error: updateError } = await supabase
              .from('preview_cards')
              .update({
                status: 'superseded',
                superseded_by_card_number: null,
                reviewed_at: new Date().toISOString(),
                notes: `Auto-superseded by reconcile-preview-cards.mjs (time-based: created+${TIME_RETIRE_AFTER_DAYS}d 経過 かつ 追加後に新弾更新あり。pHash near=${bestMatch?.cardNumber || '?'} best=${bestDistance} は不一致)`,
              })
              .eq('id', prev.id);
            if (updateError) {
              logErr(`status 更新失敗 (${prev.id}):`, updateError.message);
              errorCount++;
              continue;
            }
          }
          timeSupersededCount++;
        } else {
          // 退役されなかった理由を通常ログにも出す (しきい値調整の判断材料。誤退役回帰の監視も兼ねる)。
          // 「near=実カード番号 / best/2nd/gap」を見れば、透かしで僅かに届かない本物か、
          // 偶発マッチ(本物不在)かを後から判別できる。
          const timeNote = !Number.isFinite(createdMs)
            ? ''
            : !ageOk ? ' [2か月未満]' : !newerPack ? ' [追加後の新弾なし]' : '';
          log(`[KEEP] ${label}: near=${bestMatch?.cardNumber || '?'} best=${bestDistance} 2nd=${secondBestDistance} gap=${gap} (${reason})${timeNote}`);
          keptCount++;
        }
      }
    } catch (e) {
      logErr(`preview ${prev.id} の処理でエラー:`, e.message);
      errorCount++;
    }
  }

  log(`完了: superseded=${supersededCount}, time-superseded=${timeSupersededCount}, kept=${keptCount}, errors=${errorCount}${DRY_RUN ? ' (DRY RUN)' : ''}`);

  // 退役から十分時間が経った行の Storage 画像を遅延削除する (容量節約)。
  // 退役直後には消さないため、誤退役 (false positive) を PURGE_AFTER_DAYS の間は
  // 画像付きで復元できる。
  await purgeOldSupersededImages(supabase);
}

// 退役済み (status='superseded') かつ reviewed_at が PURGE_AFTER_DAYS より前の行について、
// Storage 上の画像実体を削除する。削除済みは notes の IMAGE_PURGED_MARKER で識別してスキップする
// (スキーマ変更を避けるため専用列ではなく notes に記録)。
async function purgeOldSupersededImages(supabase) {
  const cutoffIso = new Date(Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from('preview_cards')
    .select('id, permanent_image_url, notes')
    .eq('game', 'acg')
    .eq('status', 'superseded')
    .lt('reviewed_at', cutoffIso);
  if (error) { logErr('退役画像クリーンアップの取得失敗:', error.message); return; }
  if (!rows || rows.length === 0) { logV('退役画像クリーンアップ: 対象なし'); return; }

  let purged = 0;
  for (const row of rows) {
    if (row.notes && row.notes.includes(IMAGE_PURGED_MARKER)) continue; // 既に削除済み
    try {
      const path = row.permanent_image_url?.split('/preview-card-images/')[1];
      if (!path) continue;
      if (!DRY_RUN) {
        const { error: rmError } = await supabase.storage
          .from('preview-card-images')
          .remove([path]);
        if (rmError) { logErr(`退役画像削除失敗 (${row.id}):`, rmError.message); continue; }
        const newNotes = `${row.notes ? row.notes + ' ' : ''}${IMAGE_PURGED_MARKER} ${new Date().toISOString()}`;
        const { error: noteError } = await supabase
          .from('preview_cards')
          .update({ notes: newNotes })
          .eq('id', row.id);
        if (noteError) logErr(`退役画像 notes 更新失敗 (${row.id}):`, noteError.message);
      }
      purged++;
    } catch (e) {
      logErr(`退役画像クリーンアップエラー (${row.id}):`, e.message);
    }
  }
  log(`退役画像クリーンアップ: ${purged} 件削除${DRY_RUN ? ' (DRY RUN)' : ''}`);
}

// カード番号 (ファイル名のベース) から弾プレフィックスを返す。プロモ等は null。
//   build-card-data.mjs の packFromCardNumber と同じ分類。SD は ACG 番号レンジで判定。
function packPrefixOfCardNumber(cardNumber) {
  let m;
  if ((m = cardNumber.match(/^(BP\d+)-/i))) return m[1].toUpperCase();
  if (/^RYO-/i.test(cardNumber)) return 'RYO';
  if ((m = cardNumber.match(/^ACG-(\d+)/i))) {
    const n = parseInt(m[1], 10);
    return n <= 90 ? 'SD1' : n <= 164 ? 'SD2' : 'SD3';
  }
  return null; // PR / GP / JUDGE / TokenDS 等プロモは弾ではない
}

function hammingDistance(hash1, hash2) {
  // sharp-phash は 64 文字の '0'/'1' 文字列を返す
  if (hash1.length !== hash2.length) return Infinity;
  let dist = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) dist++;
  }
  return dist;
}

main()
  .catch((e) => { logErr('予期せぬエラー:', e.message, e.stack); })
  // 必ず exit 0: このスクリプトの失敗で prebuild 全体を止めない
  .finally(() => { process.exit(0); });
