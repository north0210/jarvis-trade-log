/**
 * JARVIS 分析コメント生成（完全ローカル・テンプレート方式）。
 * 外部LLM API・APIキー不要。Score・指標・アラートから自然文の所見を組み立てる。
 * 将来 LLM 接続する場合も、本関数を fallback として残せる設計。
 *
 * ※ score.ts / alerts.ts のロジックは変更せず、その出力を文章化するだけ。
 */
import type { Stock } from "@/lib/types";
import type { ScoreResult } from "@/lib/score";
import type { Alert } from "@/lib/alerts";
import { volumeComment } from "@/lib/indicators/volume";

const FALLBACK = "分析に必要なデータが不足しています。銘柄情報を更新してください、ボス。";

export function generateJarvisComment(stock: Stock, score: ScoreResult, alerts: Alert[]): string {
  // データ不足判定（ファンダ/テクニカルが1つも無ければ分析不可）
  const hasData = [
    stock.roe,
    stock.operating_margin,
    stock.sales_growth,
    stock.per,
    stock.pbr,
    stock.rsi,
  ].some((v) => v != null);
  if (!hasData) return FALLBACK;

  const parts: string[] = [];

  // 導入: Score / Grade
  parts.push(`${stock.name}（${stock.code}）の JARVIS Score は${score.score}点、評価は${score.grade}です。`);

  // 収益性・成長性
  const strengths: string[] = [];
  if (stock.roe != null)
    strengths.push(
      stock.roe >= 20 ? `ROE ${stock.roe}%と高収益` : stock.roe >= 10 ? `ROE ${stock.roe}%と標準的` : `ROE ${stock.roe}%とやや低め`
    );
  if (stock.operating_margin != null)
    strengths.push(
      stock.operating_margin >= 20
        ? `営業利益率 ${stock.operating_margin}%と高水準`
        : stock.operating_margin >= 10
          ? `営業利益率 ${stock.operating_margin}%と堅調`
          : `営業利益率 ${stock.operating_margin}%と控えめ`
    );
  if (stock.sales_growth != null)
    strengths.push(
      stock.sales_growth >= 30
        ? `売上成長率 ${stock.sales_growth}%と高成長`
        : stock.sales_growth >= 10
          ? `売上成長率 ${stock.sales_growth}%と安定成長`
          : `売上成長率 ${stock.sales_growth}%と鈍化気味`
    );
  if (strengths.length) parts.push(`収益性・成長性は${strengths.join("、")}。`);

  // バリュエーション（PER / PBR）
  const val: string[] = [];
  if (stock.per != null)
    val.push(stock.per <= 20 ? `PER ${stock.per}倍と割安` : stock.per > 50 ? `PER ${stock.per}倍と割高感` : `PER ${stock.per}倍`);
  if (stock.pbr != null)
    val.push(stock.pbr <= 3 ? `PBR ${stock.pbr}倍と割安` : stock.pbr > 15 ? `PBR ${stock.pbr}倍と割高感` : `PBR ${stock.pbr}倍`);
  if (val.length) parts.push(`バリュエーションは${val.join("、")}です。`);

  // RSI
  if (stock.rsi != null) {
    const r = stock.rsi;
    parts.push(
      r >= 80
        ? `RSIは${r}と過熱圏にあり、短期的な調整に注意が必要です。`
        : r >= 70
          ? `RSIは${r}とやや過熱気味です。`
          : r <= 30
            ? `RSIは${r}と売られ過ぎ圏で、反発余地があります。`
            : `RSIは${r}と落ち着いた水準です。`
    );
  }

  // MACD
  const macd: Record<string, string> = {
    ゴールデンクロス: "MACDはゴールデンクロスで上昇基調です。",
    デッドクロス: "MACDはデッドクロスで下降基調です。",
    上昇中: "MACDは上昇トレンドにあります。",
    下降中: "MACDは下降トレンドにあります。",
  };
  if (macd[stock.macd]) parts.push(macd[stock.macd]);

  // アラート状態
  const danger = alerts.filter((a) => a.level === "danger");
  const caution = alerts.filter((a) => a.level === "caution");
  const profit = alerts.filter((a) => a.level === "profit");
  if (danger.length) parts.push(`警戒: ${danger.map((a) => a.label).join("、")}。リスク管理を最優先してください。`);
  else if (caution.length) parts.push(`注意: ${caution.map((a) => a.label).join("、")}。`);
  else if (profit.length) parts.push(`好機: ${profit.map((a) => a.label).join("、")}。`);

  // 出来高（保存されている場合）
  const vc = volumeComment(stock);
  if (vc) parts.push(vc);

  // 最終判断
  parts.push(`現時点では「${score.recommendation}」が妥当と判断します、ボス。`);

  return parts.join("");
}
