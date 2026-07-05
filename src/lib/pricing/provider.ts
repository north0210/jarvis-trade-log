/**
 * 価格取得層（分離設計）
 *
 * 現在は ManualPriceProvider（DBの手入力値をそのまま採用）。
 * 将来、株価APIに接続する場合はこの PriceProvider を実装した
 * クラス（例: KabuApiProvider, JQuantsProvider）を追加し、
 * getPriceProvider() の返り値を差し替えるだけでよい。
 * UI・アラート・集計ロジックは一切変更不要。
 */
import type { Stock } from "@/lib/types";
import { fetchJQuantsQuotes } from "./jquantsClient";
import { calculateRSI } from "@/lib/indicators/rsi";

export interface Quote {
  code: string;
  price: number;
  rsi?: number;
  asOf: string; // ISO datetime
}

export interface PriceProvider {
  readonly name: string;
  /** 銘柄コード群の最新クオートを返す。取得不能な銘柄は省略してよい。 */
  fetchQuotes(codes: string[]): Promise<Quote[]>;
}

/** 手入力運用: stocks.current_price を信頼し、外部取得は行わない */
export class ManualPriceProvider implements PriceProvider {
  readonly name = "manual";
  constructor(private stocks: Stock[]) {}
  async fetchQuotes(codes: string[]): Promise<Quote[]> {
    return this.stocks
      .filter((s) => codes.includes(s.code) && s.current_price != null)
      .map((s) => ({
        code: s.code,
        price: s.current_price as number,
        rsi: s.rsi ?? undefined,
        asOf: s.price_updated_at ?? new Date().toISOString(),
      }));
  }
}

/** 価格取得のモード。UI・設定で切り替える。 */
export type PriceProviderMode = "manual" | "jquants-ready";

/**
 * J-Quants 認証情報。
 * - V2（現行）: `apiKey`（ダッシュボード発行のAPIキー）。x-api-key ヘッダで送出。
 * - V1（@deprecated）: `email` / `password`。2025-12-22 以降の登録者は利用不可。
 * すべて任意。保存は security 扱い（バックアップ除外）。
 */
export interface JQuantsCredentials {
  /** V2 APIキー（現行方式）。 */
  apiKey?: string;
  /** @deprecated V1 のみ。 */
  email?: string;
  /** @deprecated V1 のみ。 */
  password?: string;
}

/**
 * J-Quants 接続用 Provider（V2・APIキー方式）。
 *
 * 通信は必ず Route Handler（/api/jquants）経由で行う（jquantsClient）。
 * 認証は env 優先（JQUANTS_API_KEY・サーバ側）→ localStorage（credentials.apiKey）。直書き禁止。
 *
 * 取得失敗・認証失敗・APIキー未設定時は安全に fallback（ManualPriceProvider）へ委譲するため、
 * UI・Score・Alert は無改修で動作する。RSI は取得系列から indicators/rsi で自動算出する。
 *
 * ※ レート制限（5req/分）・進捗表示は B-2 で本 Provider 層に実装予定。
 */
export class JQuantsPriceProvider implements PriceProvider {
  readonly name = "jquants";
  constructor(
    private fallback: PriceProvider,
    private credentials: JQuantsCredentials | null
  ) {}

  async fetchQuotes(codes: string[]): Promise<Quote[]> {
    try {
      const res = await fetchJQuantsQuotes(codes, this.credentials);
      if (!res.ok || !res.quotes) {
        // 認証失敗・通信失敗時は安全に手入力値へ fallback
        return this.fallback.fetchQuotes(codes);
      }
      // 終値系列が十分あれば RSI を自動計算（indicators/rsi.ts に集約）。
      // 不足時は rsi を付けず、呼び出し側で既存 stock.rsi を維持する。
      // volume は Stock 型に無いため保存しない（将来拡張）。
      const quotes: Quote[] = res.quotes
        .filter((q) => q.current_price != null)
        .map((q) => {
          const rsi = calculateRSI(q.closes ?? []);
          return {
            code: q.code,
            price: q.current_price as number,
            rsi: rsi ?? undefined,
            asOf: q.date ?? new Date().toISOString(),
          };
        });
      return quotes;
    } catch {
      return this.fallback.fetchQuotes(codes);
    }
  }
}

/**
 * 現在のモード・認証情報に応じた PriceProvider を返す。
 * 既定は手入力（ManualPriceProvider）。UI・Score・Alert は本関数経由のまま無改修。
 */
export function getPriceProvider(
  stocks: Stock[],
  mode: PriceProviderMode = "manual",
  credentials: JQuantsCredentials | null = null
): PriceProvider {
  const manual = new ManualPriceProvider(stocks);
  if (mode === "jquants-ready") {
    // 準備モード: J-Quants Provider を返すが、内部で手入力値へ安全に fallback
    return new JQuantsPriceProvider(manual, credentials);
  }
  return manual;
}
