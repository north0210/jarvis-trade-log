/**
 * 財務指標の導出（純関数・fetch/window 非依存）。
 *
 * J-Quants V2 /fins/summary の生レコード（V2FinRecord・数値は文字列）から、
 * PER / PBR / ROE / 営業利益率 / 売上成長率 を計算する。
 *
 * 選択方針（承認済み）:
 *  - 連結(Consolidated)優先・通期(FY)優先。FY が無ければ最新の四半期でフォールバック。
 *  - 売上成長率は同区分の1年前レコードとの YoY。
 *  - 必要フィールドが欠ければ当該指標のみ null（呼び出し側で手入力値を維持）。
 *
 * ※ ROE は EPS/BPS（1株ベース）で近似する。会社公表の ROE（当期純利益÷自己資本）とは
 *   端数・少数株主持分・期中平均の扱いにより **微差が生じ得る**（実装上の近似）。
 */
import type { V2FinRecord } from "./jquantsV2";

/** パース済みの財務レコード。 */
export interface FinRecord {
  discDate: string;
  code: string;
  docType: string;
  consolidated: boolean;
  perType: string; // 1Q/2Q/3Q/4Q/5Q/FY
  perEnd: string; // 会計期間終了日
  sales: number | null;
  op: number | null;
  np: number | null;
  eq: number | null;
  eps: number | null;
  bps: number | null;
}

/** 導出済みの財務指標（すべて欠損可）。 */
export interface Fundamentals {
  per: number | null;
  pbr: number | null;
  roe: number | null; // %（EPS/BPS 近似）
  operatingMargin: number | null; // %
  salesGrowth: number | null; // %（YoY）
  basis: "FY" | "quarter" | null; // 算出に用いた期の種類
  asOf: string | null; // 開示日（無ければ期末日）
}

export const EMPTY_FUNDAMENTALS: Fundamentals = {
  per: null,
  pbr: null,
  roe: null,
  operatingMargin: null,
  salesGrowth: null,
  basis: null,
  asOf: null,
};

/** 文字列の数値（"", 非数値は null）をパースする。 */
export function parseFinNum(v: string | undefined | null): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const dateMs = (d: string): number => Date.parse(d);

/** 生レコードをパース済み FinRecord へ変換する。 */
export function mapFinRecord(raw: V2FinRecord): FinRecord {
  const docType = raw.DocType ?? "";
  // "NonConsolidated" は "Consolidated" を部分文字列に含むため、除外して判定する。
  const consolidated = docType.includes("Consolidated") && !docType.includes("NonConsolidated");
  return {
    discDate: raw.DiscDate ?? "",
    code: raw.Code ?? "",
    docType,
    consolidated,
    perType: raw.CurPerType ?? "",
    perEnd: raw.CurPerEn ?? "",
    sales: parseFinNum(raw.Sales),
    op: parseFinNum(raw.OP),
    np: parseFinNum(raw.NP),
    eq: parseFinNum(raw.Eq),
    eps: parseFinNum(raw.EPS),
    bps: parseFinNum(raw.BPS),
  };
}

/** 連結優先・FY優先・最新期末の順で primary レコードを選ぶ。 */
export function selectPrimary(records: FinRecord[]): FinRecord | null {
  const valid = records.filter((r) => r.perEnd);
  if (valid.length === 0) return null;
  const rank = (r: FinRecord) => (r.consolidated ? 2 : 0) + (r.perType === "FY" ? 1 : 0);
  return valid.slice().sort((a, b) => {
    const rk = rank(b) - rank(a);
    if (rk !== 0) return rk;
    return dateMs(b.perEnd) - dateMs(a.perEnd); // 新しい期末を優先
  })[0];
}

/** primary と同区分・同連結区分で、約1年前の期末に最も近いレコードを探す（売上成長率用）。 */
export function findPriorYear(records: FinRecord[], primary: FinRecord): FinRecord | null {
  const targetMs = dateMs(primary.perEnd) - 365 * 24 * 60 * 60 * 1000;
  const cands = records.filter(
    (r) =>
      r.perType === primary.perType &&
      r.consolidated === primary.consolidated &&
      r.perEnd &&
      dateMs(r.perEnd) < dateMs(primary.perEnd) &&
      r.sales != null
  );
  if (cands.length === 0) return null;
  return cands
    .slice()
    .sort((a, b) => Math.abs(dateMs(a.perEnd) - targetMs) - Math.abs(dateMs(b.perEnd) - targetMs))[0];
}

/**
 * 財務指標を計算する。price は PER/PBR 用（無ければ両者 null）。
 * records は同一銘柄の複数期の開示。欠損は当該指標のみ null。
 */
export function computeFundamentals(records: FinRecord[], price: number | null): Fundamentals {
  const primary = selectPrimary(records);
  if (!primary) return { ...EMPTY_FUNDAMENTALS };

  const per =
    price != null && primary.eps != null && primary.eps > 0 ? round2(price / primary.eps) : null;
  const pbr =
    price != null && primary.bps != null && primary.bps > 0 ? round2(price / primary.bps) : null;
  // ROE ≈ EPS / BPS（1株ベース近似。公表値と微差が出得る）。
  const roe =
    primary.eps != null && primary.bps != null && primary.bps !== 0
      ? round2((primary.eps / primary.bps) * 100)
      : null;
  const operatingMargin =
    primary.op != null && primary.sales != null && primary.sales !== 0
      ? round2((primary.op / primary.sales) * 100)
      : null;

  const prior = findPriorYear(records, primary);
  const salesGrowth =
    primary.sales != null && prior?.sales != null && prior.sales !== 0
      ? round2(((primary.sales - prior.sales) / prior.sales) * 100)
      : null;

  return {
    per,
    pbr,
    roe,
    operatingMargin,
    salesGrowth,
    basis: primary.perType === "FY" ? "FY" : "quarter",
    asOf: primary.discDate || primary.perEnd || null,
  };
}
