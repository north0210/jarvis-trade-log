/**
 * RSI（相対力指数）計算 — 純関数・外部依存なし。
 * Wilder の平滑化方式（RMA）で算出する。
 *
 * @param closes 終値の時系列（古い→新しい順）
 * @param period 期間（既定 14）
 * @returns 0〜100 の RSI（小数第2位まで）。算出不能時は null。
 *
 * 仕様:
 *  - 終値配列が period + 1 未満なら null
 *  - 空配列・非数値・非有限値（NaN/Infinity）を含む場合は null
 *  - avgLoss が 0（全上昇）は 100、全く変動なしは中立 50 とし、ゼロ除算を回避
 *  - 小数第2位まで四捨五入
 *
 * 簡易検証（内部）:
 *  - calculateRSI([1,2,3,...,15])            → 100    （全て上昇＝損失なし）
 *  - calculateRSI([15,14,13,...,1])          → 0      （全て下降＝上昇なし）
 *  - calculateRSI([5,5,5,...,5] (15個))      → 50     （変動なし＝中立）
 *  - calculateRSI([1,2,3])                   → null   （データ不足: 15未満）
 *  - calculateRSI([1, NaN, 3, ...])          → null   （異常値）
 */
export function calculateRSI(closes: number[], period = 14): number | null {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  if (closes.some((c) => typeof c !== "number" || !Number.isFinite(c))) return null;

  // 前日比（変化量）
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) changes.push(closes[i] - closes[i - 1]);

  // 初期平均（最初の period 分の単純平均）
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 0; i < period; i++) {
    const ch = changes[i];
    if (ch > 0) gainSum += ch;
    else if (ch < 0) lossSum -= ch;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  // Wilder 平滑化（残りの変化に適用）
  for (let i = period; i < changes.length; i++) {
    const ch = changes[i];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }

  // ゼロ除算対策
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  return Math.round(rsi * 100) / 100;
}
