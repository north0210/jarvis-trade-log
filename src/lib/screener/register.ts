/**
 * スクリーナー行 → ウォッチリスト（既存 StockRepository）への登録（純関数）。
 *
 * - 新規ストア・新規キーは作らない（既存 stocks に create するのみ）。
 * - 重複 code は登録しない（非破壊: 既存銘柄を上書きしない）。
 * - 財務未取得（fundamentalsAvailable=false）の行は該当フィールドを空(null)のまま登録し、
 *   既存の手入力フォールバックを維持する。
 */
import type { StockRank, StockStatus } from "@/lib/types";
import type { StockInput } from "@/lib/storage/stockRepository";
import type { ScreenerRow } from "./technical";

/** 登録時の初期ステータス（quick-setup と同作法）。 */
const REGISTER_STATUS: StockStatus = "買い候補";

/** スクリーナー grade → StockRank。S/A/B/C は同値、StockRank に無い D は C にクランプ。 */
export function gradeToRank(grade: ScreenerRow["grade"]): StockRank {
  return grade === "D" ? "C" : grade;
}

export interface RegisterContext {
  /** 現在値のアンカー日（snapshot.priceAsOf）。 */
  priceAsOf?: string;
  /** フォールバック（snapshot.generatedAt）。 */
  generatedAt: string;
}

/** ScreenerRow を StockInput へ転写する。財務未取得は null のまま。 */
export function screenerRowToStockInput(row: ScreenerRow, ctx: RegisterContext): StockInput {
  return {
    code: row.code,
    name: row.name,
    market: row.market || null,
    theme: row.sector || null, // Stock に sector 列が無いため theme へ転写
    per: row.per ?? null,
    pbr: row.pbr ?? null,
    roe: row.roe ?? null,
    sales_growth: row.salesGrowth ?? null,
    operating_margin: row.operatingMargin ?? null,
    rsi: row.rsi,
    macd: row.macd,
    current_price: row.price, // 調整後終値（後の「価格更新」で raw に上書きされ得る）
    stop_loss: null,
    take_profit: null,
    rank: gradeToRank(row.grade),
    status: REGISTER_STATUS,
    memo: null,
    price_updated_at: ctx.priceAsOf ?? ctx.generatedAt,
    fundamentals_updated_at: row.fundamentalsAsOf ?? undefined,
    fundamentals_basis: row.fundamentalsBasis ?? undefined,
    relativeVolume: row.relativeVolume ?? undefined,
  };
}

export interface RegisterPlan {
  /** 既登録のためスキップするか。 */
  skip: boolean;
  /** skip=false のときの登録内容。 */
  input?: StockInput;
}

/**
 * 登録計画を立てる（純関数・I/O なし）。
 * 既存 code に含まれれば skip（非破壊）、無ければ転写した StockInput を返す。
 */
export function planRegister(
  row: ScreenerRow,
  existingCodes: Set<string>,
  ctx: RegisterContext
): RegisterPlan {
  if (existingCodes.has(row.code)) return { skip: true };
  return { skip: false, input: screenerRowToStockInput(row, ctx) };
}
