/**
 * JARVIS Score Engine（銘柄評価・純関数）
 *
 * 完全ローカル動作・外部API不要。銘柄のファンダメンタルズ／テクニカル指標から
 * 0〜100 のスコアと S/A/B/C/D グレード、推奨アクションを算出する。
 * 評価ロジックはこのファイルに集約する（alerts.ts と同じ思想・UIから独立）。
 *
 * 配点（満点=100／出来高は現状データ源なしのため対象外）:
 *   ROE          >=30:+20  >=20:+15  >=10:+10
 *   営業利益率    >=30:+20  >=20:+15  >=10:+10
 *   売上成長率    >=50:+20  >=30:+15  >=10:+10
 *   PER          <=20:+10  <=35:+5   >50:-10
 *   PBR          <=3 :+10  <=8 :+5   >15:-10
 *   RSI          40-65:+10 65-75:+5  >80:-10
 *   MACD         GC:+10    DC:-10
 *
 * グレード: 90-100:S / 80-89:A / 65-79:B / 50-64:C / <50:D
 */
import type { Stock } from "@/lib/types";

export interface ScoreResult {
  score: number;
  grade: "S" | "A" | "B" | "C" | "D";
  recommendation: string;
  reasons: string[];
}

const RECOMMENDATION: Record<ScoreResult["grade"], string> = {
  S: "積極監視",
  A: "買い候補",
  B: "押し目待ち",
  C: "様子見",
  D: "見送り",
};

function toGrade(score: number): ScoreResult["grade"] {
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

/** 銘柄を自動採点する。データ欠損項目は加点なし（理由に明記）。 */
export function scoreStock(s: Stock): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  // ROE
  if (s.roe == null) {
    reasons.push("ROE データなし");
  } else if (s.roe >= 30) {
    score += 20;
    reasons.push(`ROE ${s.roe}% 卓越 (+20)`);
  } else if (s.roe >= 20) {
    score += 15;
    reasons.push(`ROE ${s.roe}% 優良 (+15)`);
  } else if (s.roe >= 10) {
    score += 10;
    reasons.push(`ROE ${s.roe}% 良好 (+10)`);
  } else {
    reasons.push(`ROE ${s.roe}% 低水準 (0)`);
  }

  // 営業利益率
  if (s.operating_margin == null) {
    reasons.push("営業利益率 データなし");
  } else if (s.operating_margin >= 30) {
    score += 20;
    reasons.push(`営業利益率 ${s.operating_margin}% 卓越 (+20)`);
  } else if (s.operating_margin >= 20) {
    score += 15;
    reasons.push(`営業利益率 ${s.operating_margin}% 優良 (+15)`);
  } else if (s.operating_margin >= 10) {
    score += 10;
    reasons.push(`営業利益率 ${s.operating_margin}% 良好 (+10)`);
  } else {
    reasons.push(`営業利益率 ${s.operating_margin}% 低水準 (0)`);
  }

  // 売上成長率
  if (s.sales_growth == null) {
    reasons.push("売上成長率 データなし");
  } else if (s.sales_growth >= 50) {
    score += 20;
    reasons.push(`売上成長率 ${s.sales_growth}% 急成長 (+20)`);
  } else if (s.sales_growth >= 30) {
    score += 15;
    reasons.push(`売上成長率 ${s.sales_growth}% 高成長 (+15)`);
  } else if (s.sales_growth >= 10) {
    score += 10;
    reasons.push(`売上成長率 ${s.sales_growth}% 成長 (+10)`);
  } else {
    reasons.push(`売上成長率 ${s.sales_growth}% 鈍化 (0)`);
  }

  // PER
  if (s.per == null) {
    reasons.push("PER データなし");
  } else if (s.per <= 20) {
    score += 10;
    reasons.push(`PER ${s.per}倍 割安 (+10)`);
  } else if (s.per <= 35) {
    score += 5;
    reasons.push(`PER ${s.per}倍 標準 (+5)`);
  } else if (s.per > 50) {
    score -= 10;
    reasons.push(`PER ${s.per}倍 割高 (-10)`);
  } else {
    reasons.push(`PER ${s.per}倍 やや高い (0)`);
  }

  // PBR
  if (s.pbr == null) {
    reasons.push("PBR データなし");
  } else if (s.pbr <= 3) {
    score += 10;
    reasons.push(`PBR ${s.pbr}倍 割安 (+10)`);
  } else if (s.pbr <= 8) {
    score += 5;
    reasons.push(`PBR ${s.pbr}倍 標準 (+5)`);
  } else if (s.pbr > 15) {
    score -= 10;
    reasons.push(`PBR ${s.pbr}倍 割高 (-10)`);
  } else {
    reasons.push(`PBR ${s.pbr}倍 やや高い (0)`);
  }

  // RSI
  if (s.rsi == null) {
    reasons.push("RSI データなし");
  } else if (s.rsi >= 40 && s.rsi <= 65) {
    score += 10;
    reasons.push(`RSI ${s.rsi} 正常 (+10)`);
  } else if (s.rsi > 65 && s.rsi <= 75) {
    score += 5;
    reasons.push(`RSI ${s.rsi} やや過熱 (+5)`);
  } else if (s.rsi > 80) {
    score -= 10;
    reasons.push(`RSI ${s.rsi} 過熱 (-10)`);
  } else if (s.rsi < 40) {
    reasons.push(`RSI ${s.rsi} 売られ過ぎ (0)`);
  } else {
    reasons.push(`RSI ${s.rsi} 高値警戒 (0)`);
  }

  // MACD
  if (s.macd === "ゴールデンクロス") {
    score += 10;
    reasons.push("MACD ゴールデンクロス (+10)");
  } else if (s.macd === "デッドクロス") {
    score -= 10;
    reasons.push("MACD デッドクロス (-10)");
  } else {
    reasons.push(`MACD ${s.macd} (0)`);
  }

  // 出来高（Phase 42・任意。保存されている場合のみ・満点は clamp で維持）
  if (s.relativeVolume != null) {
    if (s.rsi != null && s.rsi >= 80 && s.relativeVolume >= 1.5) {
      score -= 5;
      reasons.push(`出来高急増 ${s.relativeVolume}倍 × RSI過熱 → 過熱警告 (-5)`);
    } else if (s.relativeVolume >= 1.5) {
      score += 5;
      reasons.push(`相対出来高 ${s.relativeVolume}倍 資金流入 (+5)`);
    } else if (s.relativeVolume < 0.5) {
      score -= 5;
      reasons.push(`相対出来高 ${s.relativeVolume}倍 低調 (-5)`);
    }
  }

  // 0〜100 にクランプ
  score = Math.max(0, Math.min(100, score));
  const grade = toGrade(score);

  return { score, grade, recommendation: RECOMMENDATION[grade], reasons };
}
