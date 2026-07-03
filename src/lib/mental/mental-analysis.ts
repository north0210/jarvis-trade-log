/**
 * 取引メンタル分析（Phase 30・完全ローカル・純関数）。
 * 運用日誌の emotion/reflection を取引日に突合し、感情と成績の関係を可視化する。
 * 既存 journal / trades を利用（他モジュールは変更しない）。
 */
import type { Journal, Trade } from "@/lib/types";

export interface EmotionStat {
  emotion: string;
  count: number;
  winRate: number;
  pnl: number;
  avgPnl: number;
  avgWin: number;
  avgLoss: number;
}

export interface MentalAnalysis {
  mentalScore: number;
  emotions: EmotionStat[];
  riskEmotion: EmotionStat | null; // 平均損益が最も悪い感情
  bestEmotion: EmotionStat | null; // 平均損益が最も良い感情
  afterLoss: { count: number; avgPnl: number; winRate: number }; // 連敗/損切り後の再エントリー
  matched: number;
  unmatched: number;
  comments: string[];
}

// 感情の正規化（自由記述 → 代表感情）
const EMOTION_DEFS: { key: string; kw: string[] }[] = [
  { key: "冷静", kw: ["冷静", "落ち着", "平常", "フラット", "淡々"] },
  { key: "自信", kw: ["自信", "確信", "納得"] },
  { key: "強気", kw: ["強気", "楽観", "イケ", "期待", "高揚"] },
  { key: "焦り", kw: ["焦", "あせ", "急い", "飛びつ", "せっかち"] },
  { key: "不安", kw: ["不安", "心配", "迷い", "怖", "恐", "ビビ"] },
  { key: "弱気", kw: ["弱気", "悲観", "諦", "投げ"] },
  { key: "欲", kw: ["欲", "もっと", "強欲", "焦らず稼"] },
];

function classifyEmotion(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null;
  for (const d of EMOTION_DEFS) {
    if (d.kw.some((k) => text.includes(k))) return d.key;
  }
  return "その他";
}

function statFor(emotion: string, trades: Trade[]): EmotionStat {
  const wins = trades.filter((t) => t.realizedPnl > 0);
  const losses = trades.filter((t) => t.realizedPnl < 0);
  const pnl = trades.reduce((a, t) => a + t.realizedPnl, 0);
  return {
    emotion,
    count: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    pnl,
    avgPnl: trades.length ? pnl / trades.length : 0,
    avgWin: wins.length ? wins.reduce((a, t) => a + t.realizedPnl, 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((a, t) => a + t.realizedPnl, 0) / losses.length : 0,
  };
}

export function analyzeMental(journals: Journal[], trades: Trade[]): MentalAnalysis {
  // 日付→感情（同日日誌を優先、無ければ直近過去の日誌）
  const sortedJournals = journals.slice().sort((a, b) => a.date.localeCompare(b.date));
  const emotionOn = (date: string): string | null => {
    let found: string | null = null;
    for (const j of sortedJournals) {
      if (j.date <= date) found = classifyEmotion(j.emotion) ?? classifyEmotion(j.reflection);
      else break;
      if (j.date === date) return classifyEmotion(j.emotion) ?? classifyEmotion(j.reflection) ?? found;
    }
    return found;
  };

  const tagged = trades
    .slice()
    .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.createdAt.localeCompare(b.createdAt)))
    .map((t) => ({ t, emotion: emotionOn(t.date) }));

  const matched = tagged.filter((x) => x.emotion != null);
  const unmatched = tagged.length - matched.length;

  // 感情別
  const groups = new Map<string, Trade[]>();
  for (const { t, emotion } of matched) {
    const e = emotion as string;
    const arr = groups.get(e) ?? [];
    arr.push(t);
    groups.set(e, arr);
  }
  const emotions = Array.from(groups.entries())
    .map(([e, ts]) => statFor(e, ts))
    .sort((a, b) => b.pnl - a.pnl);

  const riskEmotion = emotions.length ? emotions.slice().sort((a, b) => a.avgPnl - b.avgPnl)[0] : null;
  const bestEmotion = emotions.length ? emotions.slice().sort((a, b) => b.avgPnl - a.avgPnl)[0] : null;

  // 連敗/損切り後の再エントリー（直前取引が損失だった取引）
  const seq = tagged.map((x) => x.t);
  const reentries: Trade[] = [];
  for (let i = 1; i < seq.length; i++) {
    if (seq[i - 1].realizedPnl < 0) reentries.push(seq[i]);
  }
  const rWins = reentries.filter((t) => t.realizedPnl > 0).length;
  const afterLoss = {
    count: reentries.length,
    avgPnl: reentries.length ? reentries.reduce((a, t) => a + t.realizedPnl, 0) / reentries.length : 0,
    winRate: reentries.length ? rWins / reentries.length : 0,
  };

  // メンタルスコア（100基準・減点）
  const total = matched.length;
  let score = 100;
  for (const e of emotions) {
    if (e.avgPnl < 0 && total > 0) score -= 15 * (e.count / total);
  }
  if (afterLoss.count >= 2 && afterLoss.avgPnl < 0) score -= 15;
  const calm = emotions.find((e) => e.emotion === "冷静");
  if (calm && calm.winRate < 0.4) score -= 5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  // JARVIS コメント
  const comments: string[] = [];
  if (total < 3) {
    comments.push("日誌と紐付く取引が少なく、メンタル分析の信頼度は限定的です。売却時の感情記録を続けてください、ボス。");
  } else {
    if (riskEmotion && riskEmotion.avgPnl < 0)
      comments.push(`「${riskEmotion.emotion}」が記録された日の取引は平均損失が大きい傾向があります（平均 ¥${Math.round(riskEmotion.avgPnl).toLocaleString("ja-JP")}）。`);
    if (bestEmotion && bestEmotion.avgPnl > 0 && bestEmotion.emotion !== riskEmotion?.emotion)
      comments.push(`「${bestEmotion.emotion}」の日の成績が良好です（勝率 ${(bestEmotion.winRate * 100).toFixed(0)}%）。取引前の状態確認が有効です。`);
    if (afterLoss.count >= 2 && afterLoss.avgPnl < 0)
      comments.push("連敗後の再エントリーで損失が拡大しています。次回は取引サイズを抑えることを推奨します。");
    if (comments.length === 0) comments.push("感情と成績に大きな偏りは見られません。規律が保たれています、ボス。");
  }
  if (unmatched > 0) comments.push(`${unmatched} 件の取引は日誌と紐付きませんでした（感情記録なし）。`);

  return { mentalScore: score, emotions, riskEmotion, bestEmotion, afterLoss, matched: total, unmatched, comments };
}
