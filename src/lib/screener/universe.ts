/**
 * 東証全銘柄スクリーナー: ユニバース＆系列の純アダプタ（fetch/window 非依存）。
 *
 * - 上場マスタ（V2MasterRecord）→ UniverseEntry（軽量・永続用）。
 * - 日付一括の株価（V2DailyBar[]）→ 銘柄別の **調整後**系列（AdjC/AdjVo）。
 *   指標計算は調整後株価を用いる（分割・併合の影響を除去するため）。
 */
import type { V2MasterRecord, V2DailyBar } from "@/lib/pricing/jquantsV2";

/** スクリーナー用の軽量な銘柄エントリ（永続対象・生系列は持たない）。 */
export interface UniverseEntry {
  code: string;
  name: string;
  nameEn: string;
  sector17: string;
  sector33: string;
  scaleCategory: string;
  market: string; // MktNm（市場区分名・表示用）
  marketCode: string; // Mkt（市場区分コード・絞り込み用）
  prodCategory: string; // ProdCat（商品区分コード・絞り込み用）
}

/** 商品区分: 内国株券（個別株）。 */
export const PRODCAT_COMMON_STOCK = "011";
/** 現行の個別株3市場（プライム/スタンダード/グロース）。 */
export const CURRENT_STOCK_MARKETS = ["0111", "0112", "0113"];

/** 銘柄別の調整後日足（1点）。 */
export interface AdjBar {
  date: string;
  adjClose: number | null;
  adjVolume: number | null;
}

/** マスタ 1 レコード → UniverseEntry。 */
export function mapMasterRecord(raw: V2MasterRecord): UniverseEntry {
  return {
    code: raw.Code ?? "",
    name: raw.CoName ?? "",
    nameEn: raw.CoNameEn ?? "",
    sector17: raw.S17Nm ?? "",
    sector33: raw.S33Nm ?? "",
    scaleCategory: raw.ScaleCat ?? "",
    market: raw.MktNm ?? "",
    marketCode: raw.Mkt ?? "",
    prodCategory: raw.ProdCat ?? "",
  };
}

/**
 * 個別株（内国株券・現行3市場）だけに絞り込む。
 * 既定: ProdCat="011"（内国株券）かつ Mkt∈{0111,0112,0113}。
 * → ETF(014)/REIT(013)/優先出資(012)/外国(021-024)/PRO Market(0105) 等を除外する。
 * 実測: /equities/master は約4450件（ETF等を含む）→ 本フィルタで個別株のみへ。
 */
export function filterCommonStocks(
  universe: UniverseEntry[],
  opts?: { prodCategories?: string[]; markets?: string[] }
): UniverseEntry[] {
  const pc = new Set(opts?.prodCategories ?? [PRODCAT_COMMON_STOCK]);
  const mk = new Set(opts?.markets ?? CURRENT_STOCK_MARKETS);
  return universe.filter((e) => pc.has(e.prodCategory) && mk.has(e.marketCode));
}

/**
 * マスタ配列 → UniverseEntry 配列。
 * Code 空を除外し、重複 Code は後勝ち（最新スナップショット優先）で一意化する。
 */
export function buildUniverse(records: V2MasterRecord[]): UniverseEntry[] {
  const byCode = new Map<string, UniverseEntry>();
  for (const r of records) {
    const e = mapMasterRecord(r);
    if (e.code) byCode.set(e.code, e);
  }
  return Array.from(byCode.values());
}

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** V2 日足 → 調整後 AdjBar（AdjC/AdjVo を採用）。 */
export function toAdjBar(raw: V2DailyBar): AdjBar {
  return {
    date: raw.Date ?? "",
    adjClose: isNum(raw.AdjC) ? raw.AdjC : null,
    adjVolume: isNum(raw.AdjVo) ? raw.AdjVo : null,
  };
}

/**
 * 複数日ぶんの日付一括バー（全銘柄×複数日を連結した配列）→ 銘柄別の調整後系列。
 * 各系列は日付昇順・調整後終値 null と空日付を除外する。
 */
export function assembleAdjSeries(bars: V2DailyBar[]): Map<string, AdjBar[]> {
  const byCode = new Map<string, AdjBar[]>();
  for (const raw of bars) {
    const code = raw.Code ?? "";
    if (!code) continue;
    const bar = toAdjBar(raw);
    if (!bar.date || bar.adjClose == null) continue;
    const arr = byCode.get(code);
    if (arr) arr.push(bar);
    else byCode.set(code, [bar]);
  }
  byCode.forEach((arr) => arr.sort((a, b) => a.date.localeCompare(b.date)));
  return byCode;
}
