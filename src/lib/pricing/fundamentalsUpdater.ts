/**
 * 財務指標の一括更新サービス（PriceProvider 系と同思想）。
 *
 * FundamentalsProvider（共有レートリミッタ）経由で取得し、
 * per / pbr / roe / operating_margin / sales_growth を StockRepository へ反映する。
 *
 * ・**手入力値は computed ?? manual のフォールバックで維持**（非破壊）。
 * ・「どの銘柄のどの指標を更新するか」の判定は純関数 planFundamentalsUpdate に分離し、
 *   書き込みは updateAllFundamentals が担う（テスト容易性）。
 */
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getProviderMode, getJQuantsCredentials, setJQuantsStatus } from "./settings";
import { getFundamentalsProvider } from "./fundamentalsProvider";
import type { Fundamentals } from "./fundamentals";
import type { BulkStop } from "./provider";
import type { BulkUpdateOptions } from "./priceUpdater";
import type { Stock } from "@/lib/types";

/** 財務指標として更新対象になる Stock フィールド。 */
type FundamentalField = "per" | "pbr" | "roe" | "operating_margin" | "sales_growth";

export interface FundamentalsUpdatePlan {
  code: string;
  /** computed ?? 既存値 でマージ済みの値（自動取得日を含む）。 */
  updates: Pick<Stock, FundamentalField | "fundamentals_updated_at">;
  /** 実際に新値（API 由来・非 null）が入るフィールド名。 */
  updatedFields: FundamentalField[];
}

export interface FundamentalsUpdateResult {
  ok: boolean;
  successCount: number; // 1 指標以上更新した銘柄数
  failedCount: number; // 更新に至らなかった銘柄数
  fieldCount: number; // 更新した指標の総数
  message: string;
  at: string;
}

/**
 * 純関数: 銘柄と算出済み財務指標から「更新後の値」と「新値が入るフィールド」を決める。
 * computed が null（API が返せない）の指標は既存の手入力値を維持する（非破壊）。
 */
export function planFundamentalsUpdate(stock: Stock, f: Fundamentals): FundamentalsUpdatePlan {
  const updatedFields: FundamentalField[] = [];
  if (f.per != null) updatedFields.push("per");
  if (f.pbr != null) updatedFields.push("pbr");
  if (f.roe != null) updatedFields.push("roe");
  if (f.operatingMargin != null) updatedFields.push("operating_margin");
  if (f.salesGrowth != null) updatedFields.push("sales_growth");

  const updates: Pick<Stock, FundamentalField | "fundamentals_updated_at"> = {
    per: f.per ?? stock.per,
    pbr: f.pbr ?? stock.pbr,
    roe: f.roe ?? stock.roe,
    operating_margin: f.operatingMargin ?? stock.operating_margin,
    sales_growth: f.salesGrowth ?? stock.sales_growth,
    // 新値が入る場合のみ自動取得日（開示日）を更新。無変更なら既存を維持（非破壊）。
    fundamentals_updated_at:
      updatedFields.length > 0 ? f.asOf ?? stock.fundamentals_updated_at : stock.fundamentals_updated_at,
  };
  return { code: stock.code, updates, updatedFields };
}

function messageFor(stopped: BulkStop | null, success: number, total: number, failed: number): string {
  switch (stopped) {
    case "aborted":
      return `${success}/${total} 更新（ユーザー中断）`;
    case "rate":
      return `${success}/${total} 更新（レート制限で中断）`;
    case "auth":
      return "認証に失敗しました（APIキーを確認してください）。";
    default:
      return failed === 0 ? "財務指標を更新しました" : `${success}/${total} 更新（一部は財務データ無し）`;
  }
}

/** 全登録銘柄の財務指標を J-Quants から一括更新する（進捗・中断対応）。 */
export async function updateAllFundamentals(opts?: BulkUpdateOptions): Promise<FundamentalsUpdateResult> {
  const at = new Date().toISOString();
  const repo = getStockRepository();
  const stocks = await repo.list();

  if (getProviderMode() !== "jquants-ready") {
    return { ok: false, successCount: 0, failedCount: 0, fieldCount: 0, message: "手入力モードです。設定画面で J-Quants モードに切り替えてください。", at };
  }
  if (stocks.length === 0) {
    return { ok: false, successCount: 0, failedCount: 0, fieldCount: 0, message: "対象銘柄がありません。", at };
  }

  // PER/PBR 用の現在値は永続化済みの値を使う（価格の再取得はしない）。
  const priceByCode = new Map(stocks.map((s) => [s.code, s.current_price]));
  const provider = getFundamentalsProvider("jquants-ready", getJQuantsCredentials());
  const result = await provider.fetchFundamentalsBulk(
    stocks.map((s) => s.code),
    priceByCode,
    { onProgress: opts?.onProgress, signal: opts?.signal }
  );

  const byCode = new Map(result.items.map((i) => [i.code, i.fundamentals]));
  let success = 0;
  let fieldCount = 0;
  for (const s of stocks) {
    const f = byCode.get(s.code);
    if (!f) continue;
    const plan = planFundamentalsUpdate(s, f);
    if (plan.updatedFields.length === 0) continue; // 新値が無ければ書かない（手入力維持）
    const { id, ...rest } = s;
    await repo.update(id, { ...rest, ...plan.updates });
    success++;
    fieldCount += plan.updatedFields.length;
  }
  const failedCount = stocks.length - success;
  const message = messageFor(result.stopped, success, stocks.length, failedCount);

  setJQuantsStatus({
    status: result.stopped === "auth" ? "error" : "connected",
    at,
    message: result.stopped === "auth" ? "認証エラー" : "接続成功",
  });

  const ok = result.stopped === null && failedCount === 0;
  return { ok, successCount: success, failedCount, fieldCount, message, at };
}
