// ACG (アニマルカードゲーム) のカードデータ。
// 実体は scripts/build-card-data.mjs が acgtcg.com から生成した cardData.generated.js。
// ここでは画像 URL のキャッシュバスティング (?v=hash) を適用してから default export する。

import { applyVersionToCard } from './imageUrl.js';
import { cardData as rawCardData, packOrder as rawPackOrder } from './cardData.generated.js';

export const packOrder = rawPackOrder;

const versionedCardData = rawCardData.map(applyVersionToCard);

export default versionedCardData;
