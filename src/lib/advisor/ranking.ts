/**
 * Phase 62 (v1.7): Advisor ランキング補助（純関数）。
 * ランキング用の短文コメント（判断補助・投資助言ではない・断定/未来予測なし）。
 */
import type { AdvisorItem } from "@/lib/advisor/advisorTypes";

const DANGER = new Set(["danger", "sellCandidate", "reduce"]);

/** ランキング用の一言コメント。 */
export function rankingComment(it: AdvisorItem, missingCount: number): string {
  if (DANGER.has(it.category)) return "Danger寄りの判定です。規律を優先してください。";
  if (missingCount >= 3) return "データ不足があるため過信は禁物です。";
  if (it.category === "strongBuy") return "総合スコア上位。監視優先度は高めです。";
  if (it.category === "buy") return "優位性はありますが、確実性ではありません。";
  if (it.category === "watch") return "監視候補。押し目・条件成立を待つのが無難です。";
  if (it.category === "hold") return "保有継続。ルールに沿って監視してください。";
  return "現時点は見送り。条件が整うまで待機してください。";
}

export const DISCLAIMER_LINE = "※ 判断補助であり投資助言ではありません。利益は保証されません。";
