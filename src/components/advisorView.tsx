/**
 * Phase 50 (v1.1): JARVIS Advisor 表示コンポーネント。
 * カテゴリ別に候補を根拠・推奨行動つきで提示。断定表現は用いない。
 */
import Link from "next/link";
import HelpTooltip from "@/components/HelpTooltip";
import {
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  CATEGORY_TONE,
  type AdvisorCategory,
  type AdvisorReport,
} from "@/lib/advisor/advisorTypes";

const CATEGORY_TERM: Partial<Record<AdvisorCategory, string>> = {
  strongBuy: "strongbuy",
  watch: "watch",
  hold: "hold",
  danger: "danger",
};

const toneCls: Record<"good" | "info" | "caution" | "danger", string> = {
  good: "border-arc/50 bg-arc/5",
  info: "border-line",
  caution: "border-caution/50 bg-caution/5",
  danger: "border-danger/50 bg-danger/5",
};
const toneText: Record<"good" | "info" | "caution" | "danger", string> = {
  good: "text-arc",
  info: "text-arcdim",
  caution: "text-caution",
  danger: "text-danger",
};
const gradeCls: Record<string, string> = { S: "text-profit", "A+": "text-profit", A: "text-arc", "B+": "text-arc", B: "text-arc", C: "text-caution", D: "text-danger" };

export default function AdvisorView({ report }: { report: AdvisorReport }) {
  if (!report.hasData) {
    return (
      <section className="hud-panel p-4 border-caution/50 bg-caution/5">
        <p className="text-sm font-mono text-caution">・{report.comments[0]}</p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="hud-panel p-4 border-arc/40 shadow-arc">
        <h2 className="hud-label mb-2">◎ JARVIS Advisor 所見</h2>
        <ul className="space-y-1 text-sm font-mono text-arc leading-relaxed">
          {report.comments.map((c, i) => <li key={i}>・{c}</li>)}
        </ul>
        <p className="text-xs text-arcdim mt-2">※ {report.disclaimer}</p>
      </section>

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">◆ Advisor Summary</h2>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          {([
            { k: "strongBuy", label: "Strong Buy", tone: "good" },
            { k: "buy", label: "Buy", tone: "good" },
            { k: "watch", label: "Watch", tone: "info" },
            { k: "partialTP", label: "一部利確", tone: "caution" },
            { k: "sellCandidate", label: "売却候補", tone: "danger" },
            { k: "reduce", label: "比率縮小", tone: "caution" },
            { k: "danger", label: "危険", tone: "danger" },
            { k: "hold", label: "保有継続", tone: "info" },
            { k: "avoid", label: "見送り", tone: "info" },
          ] as const).map((c) => (
            <div key={c.k} className={`rounded border p-3 text-center ${toneCls[c.tone]}`}>
              <p className="hud-label">{c.label}</p>
              <p className={`font-mono text-2xl mt-1 ${toneText[c.tone]}`}>{report.counts[c.k]}</p>
            </div>
          ))}
        </div>
      </section>

      {CATEGORY_ORDER.map((cat) => {
        const list = report.byCategory[cat];
        if (list.length === 0) return null;
        const tone = CATEGORY_TONE[cat];
        return (
          <section key={cat} className="hud-panel p-4">
            <h3 className={`hud-label mb-3 ${toneText[tone]}`}>
              {CATEGORY_TERM[cat] ? <HelpTooltip termKey={CATEGORY_TERM[cat]} label={CATEGORY_LABELS[cat]} /> : CATEGORY_LABELS[cat]} <span className="text-arcdim">（{list.length}）</span>
            </h3>
            <ul className="space-y-2">
              {list.map((it) => (
                <li key={it.code} className={`rounded border p-3 ${toneCls[tone]}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-display tracking-wider">
                      <span className="text-arc">{it.code}</span> {it.name}
                      {it.held && <span className="text-arcdim text-xs"> ・保有中</span>}
                    </span>
                    <span className={`font-mono text-sm ${gradeCls[it.grade] ?? "text-arcdim"}`}>
                      <HelpTooltip termKey="advisorscore" label={`総合 ${it.grade}（${it.composite}）`} /> / Score {it.score}
                      {it.btGrade && <span className="text-arcdim"> / <HelpTooltip termKey="btgrade" label={`BT ${it.btGrade}`} /></span>}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-[#cfeaff] mt-2">
                    <span className="text-arcdim">理由: </span>{it.reasons.join(" / ") || "—"}
                  </p>
                  {it.bt && (
                    <p className="text-xs font-mono text-arcdim mt-1">
                      BT: PF {it.bt.pf != null ? it.bt.pf.toFixed(2) : "—"} / 勝率 {it.bt.winRate != null ? `${(it.bt.winRate * 100).toFixed(0)}%` : "—"} / DD {it.bt.maxDD != null ? `${it.bt.maxDD.toFixed(0)}%` : "—"} / CAGR {it.bt.cagr != null ? `${it.bt.cagr.toFixed(0)}%` : "—"} / MC {it.bt.ruin != null ? `${(it.bt.ruin * 100).toFixed(0)}%` : "—"} / 期待値 {it.bt.expectedValue != null ? `${it.bt.expectedValue.toFixed(1)}%` : "—"} / {it.bt.tradeCount ?? 0}回
                    </p>
                  )}
                  <p className="text-xs font-mono mt-1">
                    <span className="text-arcdim">判断: </span>
                    <span className={toneText[tone]}>{it.action}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className="hud-panel p-3">
        <p className="text-xs font-mono text-arcdim">
          関連: <Link href="/stocks" className="text-arc hover:underline">銘柄管理</Link> ／{" "}
          <Link href="/simulator" className="text-arc hover:underline">試算</Link> ／{" "}
          <Link href="/risk" className="text-arc hover:underline">リスク</Link> ／{" "}
          <Link href="/rebalance" className="text-arc hover:underline">リバランス</Link>
        </p>
      </section>
    </div>
  );
}
