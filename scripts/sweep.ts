/**
 * パラメータ感度分析（スイープ）CLI — Phase 1 追加。
 *
 * 目的は「最良値の探索」ではなく「頑健性の確認」。戦略C/Bのパラメータを段階的に振り、
 * 前半/後半(OOS)で一貫して優位性が維持される領域（プラトー）を検出する。
 *
 * 実行:  npm run sweep -- --strategy C --grid default
 * データ: /strategy-compare でエクスポートした scripts/tmp/series-cache.json を読むだけ。
 *         API 再取得なし（レート消費ゼロ・高速反復）。実行モデルは strategy-compare と同一
 *         （runStrategyComparison を再利用＝翌営業日始値約定・代用約定・等ウェイト%指標）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createRelativeMomentum, createPullback } from "@/lib/strategy/strategies";
import type { TradingStrategy } from "@/lib/strategy/signalStrategy";
import { runStrategyComparison, type SimMetrics } from "@/lib/backtest/signalSimulator";
import type { SeriesPoint } from "@/lib/analytics/priceCache";

function argOf(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

interface GridDef {
  label: string;
  columns: string[]; // 軸の順序（＝CSV列順）
  axes: Record<string, number[]>;
  make: (combo: Record<string, number>) => TradingStrategy;
  fmt: (combo: Record<string, number>) => string;
}

const GRIDS: Record<string, GridDef> = {
  C: {
    label: "C 相対力モメンタム",
    columns: ["stopLossPct", "maPeriod", "maxHoldBars"],
    axes: { stopLossPct: [6, 8, 10], maPeriod: [60, 75, 90], maxHoldBars: [40, 60, 80] },
    make: (c) => createRelativeMomentum({ stopLossPct: c.stopLossPct, maPeriod: c.maPeriod, maxHoldBars: c.maxHoldBars }),
    fmt: (c) => `SL-${c.stopLossPct}% MA${c.maPeriod} H${c.maxHoldBars}`,
  },
  B: {
    label: "B 押し目逆張り",
    columns: ["rsiEntryMax", "rsiExit", "stopLossPct"],
    axes: { rsiEntryMax: [25, 30, 35], rsiExit: [50, 55, 60], stopLossPct: [4, 6, 8] },
    make: (c) => createPullback({ rsiEntryMax: c.rsiEntryMax, rsiExit: c.rsiExit, stopLossPct: c.stopLossPct }),
    fmt: (c) => `RSIin${c.rsiEntryMax} RSIout${c.rsiExit} SL-${c.stopLossPct}%`,
  },
};

const strategyKey = (argOf("strategy", "C") || "C").toUpperCase();
const gridName = argOf("grid", "default") || "default";
const grid = GRIDS[strategyKey];
if (!grid) {
  console.error(`未知の戦略: ${strategyKey}（C または B を指定）`);
  process.exit(1);
}
if (gridName !== "default") {
  console.error(`未知のグリッド: ${gridName}（現状 default のみ対応）`);
  process.exit(1);
}

const TMP_DIR = path.join(process.cwd(), "scripts", "tmp");
const CACHE_FILE = path.join(TMP_DIR, "series-cache.json");
if (!existsSync(CACHE_FILE)) {
  console.error(`系列キャッシュが見つかりません: ${CACHE_FILE}`);
  console.error(`先に /strategy-compare で「比較を実行」→「スイープ用に系列をエクスポート」を実施してください。`);
  process.exit(1);
}
const cache = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as {
  from: string;
  to: string;
  perCode: { code: string; series: SeriesPoint[] }[];
};
const perCode = cache.perCode ?? [];
if (perCode.length === 0) {
  console.error("series-cache.json に系列がありません。エクスポートをやり直してください。");
  process.exit(1);
}
const nowIso = new Date().toISOString();

/** 軸のデカルト積。 */
function product(axes: Record<string, number[]>, cols: string[]): Record<string, number>[] {
  let acc: Record<string, number>[] = [{}];
  for (const col of cols) {
    const next: Record<string, number>[] = [];
    for (const base of acc) for (const v of axes[col]) next.push({ ...base, [col]: v });
    acc = next;
  }
  return acc;
}
const combos = product(grid.axes, grid.columns);

interface Row {
  combo: Record<string, number>;
  full: SimMetrics;
  h1: SimMetrics;
  h2: SimMetrics;
  plateau: boolean;
}

const rows: Row[] = combos.map((combo) => {
  const strat = grid.make(combo);
  const res = runStrategyComparison([strat], perCode, cache.from, cache.to, nowIso);
  const e = res.entries[0];
  // プラトー: 前後半とも 取引3件以上・期待値>0・PF>1（頑健＝OOSで一貫）。
  const plateau =
    e.firstHalf.tradeCount >= 3 &&
    e.secondHalf.tradeCount >= 3 &&
    e.firstHalf.expectancyPct > 0 &&
    e.secondHalf.expectancyPct > 0 &&
    (e.firstHalf.profitFactor ?? 0) > 1 &&
    (e.secondHalf.profitFactor ?? 0) > 1;
  return { combo, full: e.full, h1: e.firstHalf, h2: e.secondHalf, plateau };
});

// ---- テーブル出力 ----
const cell = (m: SimMetrics): string =>
  [
    String(m.tradeCount).padStart(3),
    (m.tradeCount ? (m.winRate * 100).toFixed(0) : "-").padStart(4),
    (m.profitFactor != null ? m.profitFactor.toFixed(2) : "-").padStart(5),
    (m.tradeCount ? m.maxDrawdownPct.toFixed(1) : "-").padStart(5),
    (m.tradeCount ? (m.expectancyPct >= 0 ? "+" : "") + m.expectancyPct.toFixed(2) : "-").padStart(6),
  ].join(" ");

const pw = Math.max(grid.fmt(combos[0]).length, ...combos.map((c) => grid.fmt(c).length));
const subHead = " N  Win    PF    DD    Exp";
console.log("");
console.log("=== パラメータ感度分析（スイープ） ===");
console.log(`戦略: ${grid.label} ／ ${combos.length}通り ／ 期間 ${cache.from} 〜 ${cache.to} ／ ${perCode.length}銘柄`);
console.log("実行モデル: strategy-compare と同一（翌営業日始値約定・代用約定・端数切捨て／指標は等ウェイト%）");
console.log("");
console.log(`${"params".padEnd(pw)} │ 全期間${" ".repeat(subHead.length - 6)} │ 前半(OOS)${" ".repeat(subHead.length - 9)} │ 後半(OOS)${" ".repeat(subHead.length - 9)} │ plateau`);
console.log(`${" ".repeat(pw)} │${subHead} │${subHead} │${subHead} │`);
console.log("─".repeat(pw + subHead.length * 3 + 22));
for (const r of rows) {
  console.log(`${grid.fmt(r.combo).padEnd(pw)} │${cell(r.full)} │${cell(r.h1)} │${cell(r.h2)} │  ${r.plateau ? "✓" : ""}`);
}
console.log("");
const plateauCount = rows.filter((r) => r.plateau).length;
console.log(`プラトー ✓（前後半とも 取引3件以上・期待値>0・PF>1）: ${plateauCount}/${rows.length} 通り`);
console.log("");
console.log("⚠ 注意: 最良行をそのまま採用するのは過剰適合（オーバーフィッティング）リスクがあります。");
console.log("   本ツールの用途は、パラメータを少し動かしても優位性が保たれる領域（プラトー）の確認です。");
console.log("   単一の最良値ではなく、前後半(OOS)で一貫してプラスの“面”を見てください。");

// ---- CSV 出力 ----
const metricCols = ["N", "win", "pf", "dd", "exp"];
const header = [
  "strategy",
  "params",
  ...grid.columns,
  ...["full", "h1", "h2"].flatMap((p) => metricCols.map((m) => `${p}_${m}`)),
  "plateau",
];
const num = (v: number | null): string => (v == null ? "" : String(v));
const metricCells = (m: SimMetrics): string[] => [
  String(m.tradeCount),
  m.tradeCount ? (m.winRate * 100).toFixed(1) : "",
  num(m.profitFactor),
  m.tradeCount ? m.maxDrawdownPct.toFixed(2) : "",
  m.tradeCount ? m.expectancyPct.toFixed(3) : "",
];
const csvLines = [header.join(",")];
for (const r of rows) {
  csvLines.push(
    [
      strategyKey,
      grid.fmt(r.combo),
      ...grid.columns.map((c) => String(r.combo[c])),
      ...metricCells(r.full),
      ...metricCells(r.h1),
      ...metricCells(r.h2),
      r.plateau ? "1" : "0",
    ].join(",")
  );
}
mkdirSync(TMP_DIR, { recursive: true });
const csvFile = path.join(TMP_DIR, "sweep-result.csv");
writeFileSync(csvFile, csvLines.join("\n") + "\n");
console.log(`CSV: scripts/tmp/sweep-result.csv（${rows.length} 行）`);
