/**
 * Phase 51 (v1.1精緻化): JARVIS Advisor ルール（純関数）。
 * 加重合成スコア（Score/Risk/Backtest/MC/Volume/Strategy/Discipline）を算出し、
 * 9カテゴリへ分類する。断定表現は使わず、候補と目安のみ返す。
 */
import type { AdvisorCategory, AdvisorWeights, OverallGrade } from "./advisorTypes";

export interface GlobalSignals {
  riskGrade: "S" | "A" | "B" | "C" | "D";
  disciplineDanger: number;
  btAvgCagr: number | null;
  btAvgMaxDD: number | null;
  ruinProbability: number; // 0-1
}

export interface StockSignals {
  code: string;
  name: string;
  baseGrade: "S" | "A" | "B" | "C" | "D";
  score: number;
  adaptiveScore: number | null;
  rsi: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  operatingMargin: number | null;
  revenueGrowth: number | null;
  macd: string | null;
  relativeVolume: number | null;
  volumeTrend: string;
  held: boolean;
  positionRatioPct: number | null;
  pnlRatePct: number | null;
  stopHit: boolean;
  stopNear: boolean;
  rsiHot: boolean;
  takeProfitFlag: boolean;
  lossDanger: boolean;
  strategyFit: boolean | null;
  /** 個別銘柄BT指標（あれば市場平均より優先）。 */
  stockBt: StockBtSignals | null;
}

export interface StockBtSignals {
  pf: number | null;
  maxDD: number | null;
  winRate: number | null; // 0-1
  cagr: number | null;
  ruinProbability: number | null; // 0-1
  expectedValue: number | null; // 1取引あたり期待リターン(%)
}

export interface Thresholds {
  relativeVolumeWarning: number;
  relativeVolumeDanger: number;
  rsiOverheat: number;
  oneStockWeightWarning: number;
}

export interface Decision {
  category: AdvisorCategory;
  composite: number;
  grade: OverallGrade;
  reasons: string[];
  action: string;
  btScore: number | null;
  btGrade: OverallGrade | null;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

function volumeUp(s: StockSignals, t: Thresholds): boolean {
  return s.relativeVolume != null && s.relativeVolume >= t.relativeVolumeWarning;
}
function volumeDown(s: StockSignals): boolean {
  return (s.relativeVolume != null && s.relativeVolume <= 0.5) || s.volumeTrend === "decreasing";
}
function rsiOverheated(s: StockSignals, t: Thresholds): boolean {
  return s.rsi != null && s.rsi >= t.rsiOverheat;
}
function rsiDipZone(s: StockSignals): boolean {
  return s.rsi != null && s.rsi >= 40 && s.rsi <= 65;
}

// ---- 各コンポーネント（0-100） ----
function riskComp(g: GlobalSignals): number {
  return { S: 100, A: 85, B: 70, C: 45, D: 20 }[g.riskGrade];
}
function btCompMarket(g: GlobalSignals): number {
  if (g.btAvgCagr == null) return 60;
  const c = g.btAvgCagr;
  if (c >= 15) return 100;
  if (c >= 8) return 85;
  if (c >= 3) return 70;
  if (c >= 0) return 55;
  return 30;
}

/** 個別銘柄BTスコア(0-100)。データ無しなら null（v1.5基準）。 */
export function perStockBtScore(bt: StockBtSignals | null): number | null {
  if (!bt) return null;
  let s = 60;
  if (bt.pf != null) s += bt.pf > 1.8 ? 10 : bt.pf >= 1.5 ? 6 : bt.pf < 1 ? -20 : 0;
  if (bt.winRate != null) s += bt.winRate > 0.6 ? 8 : bt.winRate <= 0.4 ? -10 : 0;
  if (bt.maxDD != null) s += bt.maxDD < 15 ? 6 : bt.maxDD >= 30 ? -16 : bt.maxDD >= 20 ? -8 : 0;
  if (bt.cagr != null) s += bt.cagr > 15 ? 6 : bt.cagr < 0 ? -12 : 0;
  if (bt.ruinProbability != null) s += bt.ruinProbability > 0.3 ? -10 : bt.ruinProbability <= 0.03 ? 8 : 0;
  if (bt.expectedValue != null && bt.expectedValue < 0) s -= 12;
  return clamp(s);
}

/** BTコンポーネント：個別銘柄BTがあれば優先、無ければ市場平均。 */
function btComp(s: StockSignals, g: GlobalSignals): number {
  const ps = perStockBtScore(s.stockBt);
  return ps != null ? ps : btCompMarket(g);
}
function mcComp(g: GlobalSignals): number {
  const r = g.ruinProbability;
  if (r <= 0.01) return 100;
  if (r <= 0.03) return 85;
  if (r <= 0.05) return 70;
  if (r <= 0.1) return 50;
  return 25;
}
function volComp(s: StockSignals, t: Thresholds): number {
  if (s.relativeVolume == null) return 60;
  if (volumeDown(s)) return 40;
  if (s.relativeVolume >= t.relativeVolumeDanger) return 65; // 急増は諸刃
  if (s.relativeVolume >= t.relativeVolumeWarning) return 90; // 適度な増加
  return 70;
}
function stratComp(s: StockSignals): number {
  return s.strategyFit === true ? 100 : s.strategyFit === false ? 30 : 60;
}
function discComp(g: GlobalSignals): number {
  return g.disciplineDanger === 0 ? 100 : g.disciplineDanger === 1 ? 55 : 25;
}
function scoreComp(s: StockSignals): number {
  return s.adaptiveScore != null ? clamp(s.score * 0.5 + s.adaptiveScore * 0.5) : clamp(s.score);
}

export function computeComposite(s: StockSignals, g: GlobalSignals, t: Thresholds, w: AdvisorWeights): number {
  const total =
    scoreComp(s) * w.score +
    riskComp(g) * w.risk +
    btComp(s, g) * w.backtest +
    mcComp(g) * w.montecarlo +
    volComp(s, t) * w.volume +
    stratComp(s) * w.strategy +
    discComp(g) * w.discipline;
  const denom = w.score + w.risk + w.backtest + w.montecarlo + w.volume + w.strategy + w.discipline;
  return clamp(total / (denom || 1));
}

export function compositeGrade(c: number): OverallGrade {
  if (c >= 93) return "S";
  if (c >= 88) return "A+";
  if (c >= 80) return "A";
  if (c >= 70) return "B+";
  if (c >= 60) return "B";
  if (c >= 48) return "C";
  return "D";
}

/** 単一銘柄の判定。 */
export function decide(s: StockSignals, g: GlobalSignals, t: Thresholds, w: AdvisorWeights): Decision {
  const composite = computeComposite(s, g, t, w);
  const grade = compositeGrade(composite);
  const btScore = perStockBtScore(s.stockBt);
  const btGrade = btScore != null ? compositeGrade(btScore) : null;
  const r: string[] = [];
  const addRsi = () => { if (s.rsi != null) r.push(rsiDipZone(s) ? "RSI適正" : rsiOverheated(s, t) ? "RSI過熱" : `RSI ${s.rsi.toFixed(0)}`); };
  const addRisk = () => r.push(`Risk ${g.riskGrade}`);
  const addMc = () => {
    const bt = s.stockBt;
    if (bt?.ruinProbability != null) { if (bt.ruinProbability <= 0.03) r.push("MC安定"); else if (bt.ruinProbability >= 0.1) r.push("MC破産確率高"); }
    else if (g.ruinProbability <= 0.03) r.push("MC安定"); else if (g.ruinProbability >= 0.1) r.push("MC破産確率高");
  };
  const addBt = () => {
    const bt = s.stockBt;
    if (bt) {
      if (bt.pf != null && bt.pf >= 1.5) r.push("PF良好");
      if (bt.maxDD != null && bt.maxDD <= 10) r.push("DD低水準");
      if (bt.winRate != null && bt.winRate >= 0.6) r.push("勝率高");
      if (bt.cagr != null && bt.cagr >= 10) r.push("BT-CAGR良好");
      if (btGrade) r.push(`BT ${btGrade}`);
    } else if (g.btAvgCagr != null && g.btAvgCagr > 0) r.push("PF良好");
  };
  const addVol = () => { if (volumeUp(s, t)) r.push("出来高増加"); else if (volumeDown(s)) r.push("出来高低下"); };
  const addDisc = () => r.push(g.disciplineDanger > 0 ? `規律違反 ${g.disciplineDanger}件` : "規律違反なし");
  const addPos = () => { if (s.positionRatioPct != null) r.push(s.positionRatioPct >= t.oneStockWeightWarning ? `保有率 ${s.positionRatioPct.toFixed(0)}%（過大）` : "保有率正常"); };
  // 指標を常時・定性ラベル付きで可視化（欠損は「データなし」）— 参照フィールド統一
  const perQ = s.per == null ? null : s.per <= 15 ? "市場平均以下" : s.per <= 25 ? "適正圏" : s.per <= 40 ? "やや高め" : "高PER";
  const pbrQ = s.pbr == null ? null : s.pbr <= 1 ? "解散価値以下" : s.pbr <= 3 ? "標準" : "高PBR";
  const roeQ = s.roe == null ? null : s.roe >= 20 ? "優秀" : s.roe >= 10 ? "平均水準" : "低水準";
  const rsiQ = s.rsi == null ? null : s.rsi < 30 ? "売られ過ぎ" : s.rsi <= 60 ? "中立" : s.rsi <= 70 ? "やや過熱" : s.rsi >= 80 ? "過熱" : "高値警戒";
  const omQ = s.operatingMargin == null ? null : s.operatingMargin >= 20 ? "高収益" : s.operatingMargin >= 10 ? "良好" : "低め";
  const rgQ = s.revenueGrowth == null ? null : s.revenueGrowth >= 20 ? "高成長" : s.revenueGrowth >= 5 ? "成長" : "鈍化";
  const fundamentals: string[] = [
    s.per != null ? `PER ${s.per}（${perQ}）` : "PER データなし",
    s.pbr != null ? `PBR ${s.pbr}（${pbrQ}）` : "PBR データなし",
    s.roe != null ? `ROE ${s.roe}%（${roeQ}）` : "ROE データなし",
    s.operatingMargin != null ? `営業利益率 ${s.operatingMargin}%（${omQ}）` : "営業利益率 データなし",
    s.revenueGrowth != null ? `売上成長率 ${s.revenueGrowth}%（${rgQ}）` : "売上成長率 データなし",
    s.rsi != null ? `RSI ${s.rsi.toFixed(0)}（${rsiQ}）` : "RSI データなし",
    s.macd && s.macd !== "不明" ? `MACD ${s.macd}` : "MACD データなし",
  ];
  const missing: string[] = [];
  if (s.per == null) missing.push("PER");
  if (s.pbr == null) missing.push("PBR");
  if (s.roe == null) missing.push("ROE");
  if (s.operatingMargin == null) missing.push("営業利益率");
  if (s.revenueGrowth == null) missing.push("売上成長率");
  if (s.rsi == null) missing.push("RSI");
  const done = (category: AdvisorCategory, action: string): Decision => {
    const reasons = [...fundamentals, ...r];
    if (missing.length) reasons.push(`データ不足: ${missing.join("/")} 未取得（要 価格更新/手入力）`);
    return { category, composite, grade, reasons, action, btScore, btGrade };
  };

  // ---- 保有銘柄 ----
  if (s.held) {
    if (s.stopHit && (g.riskGrade === "C" || g.riskGrade === "D" || volumeDown(s) || s.lossDanger || g.disciplineDanger > 0)) {
      r.push("損切りライン到達"); if (g.disciplineDanger > 0) addDisc(); addRisk(); if (volumeDown(s)) r.push("出来高減少");
      if (g.btAvgMaxDD != null && g.btAvgMaxDD >= 30) r.push("最大DD増加");
      return done("danger", "保有理由を再確認し、防御的に対応してください。");
    }
    if (s.stopHit || s.stopNear || s.lossDanger || (s.pnlRatePct != null && s.pnlRatePct <= -8)) {
      r.push(s.stopHit ? "損切りライン到達" : s.stopNear ? "損切りライン接近" : "含み損拡大"); if (g.disciplineDanger > 0) addDisc(); addRisk();
      return done("sellCandidate", "売却検討。感情ではなくルールで判断してください。");
    }
    if (s.takeProfitFlag || (rsiOverheated(s, t) && s.pnlRatePct != null && s.pnlRatePct >= 15)) {
      if (s.takeProfitFlag) r.push("利確ライン接近"); if (rsiOverheated(s, t)) r.push("RSI過熱");
      if (s.pnlRatePct != null && s.pnlRatePct >= 15) r.push(`含み益 +${s.pnlRatePct.toFixed(0)}%`);
      return done("partialTP", "10〜20%の利確を検討してください。");
    }
    if (s.positionRatioPct != null && s.positionRatioPct >= t.oneStockWeightWarning) {
      addPos(); if (rsiOverheated(s, t)) r.push("RSI過熱"); r.push("リバランス推奨");
      return done("reduce", "比率縮小（一部売却）を検討してください。");
    }
    addRsi(); addRisk(); addPos(); addDisc();
    return done("hold", "保有継続。ルールに沿って監視してください。");
  }

  // ---- 未保有銘柄 ----
  // composite が低い場合のみ見送り（baseGrade D でも評価は行い、買い候補ゲートで抑制）
  if (composite < 48) {
    r.push(`総合 ${grade}`); if (s.score < 50) r.push(`Score ${s.score}`); if (volumeDown(s)) r.push("出来高低下");
    return done("avoid", "現時点は見送り。条件が整うまで待機してください。");
  }
  const notWeak = s.baseGrade !== "D"; // ファンダ最弱は買い候補にせず監視まで
  const entryTiming = rsiDipZone(s) && !volumeDown(s) && s.strategyFit !== false;
  if (notWeak && composite >= 85 && entryTiming && (g.riskGrade === "S" || g.riskGrade === "A") && s.strategyFit === true && g.disciplineDanger === 0) {
    addRisk(); addMc(); addBt(); addVol(); r.push("Strategy適合"); addDisc();
    return done("strongBuy", "資産の5〜10%以内で段階エントリーを検討してください。");
  }
  if (notWeak && composite >= 70 && entryTiming) {
    addRisk(); addMc(); addBt(); addVol(); if (s.strategyFit === true) r.push("Strategy適合");
    return done("buy", "資産の5〜10%以内で段階エントリーを検討してください。");
  }
  if (composite >= 60 || (composite >= 48 && (rsiOverheated(s, t) || volumeUp(s, t)))) {
    if (rsiOverheated(s, t)) r.push("短期過熱の可能性"); addVol(); addRisk();
    if (!notWeak) r.push("ファンダ最弱（要確認）");
    return done("watch", "監視継続。押し目・条件成立を待って再評価してください。");
  }
  r.push("条件が十分に揃っていません");
  return done("avoid", "現時点は見送り。条件が整うまで待機してください。");
}
