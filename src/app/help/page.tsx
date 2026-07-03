"use client";

/**
 * Phase 47: JARVIS 操作マニュアル・初心者ガイド。
 * 完全ローカルの静的コンテンツ。投資助言ではなく判断補助として記載。
 * カテゴリ別メニュー / 検索 / 用語辞典 / 「今日やること」チェックリスト。
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Disclaimer from "@/components/Disclaimer";
import { APP_LABEL } from "@/lib/version";
import { GLOSSARY } from "@/lib/help/glossary";

const CHECK_KEY = "jarvis-trade-log:help-checklist";

type CardTone = "info" | "warning" | "danger";
interface HelpCard {
  q: string;
  a: string;
  tone?: CardTone;
  anchor?: string;
}
interface HelpSection {
  id: string;
  label: string;
  intro: string;
  cards: HelpCard[];
}

const SECTIONS: HelpSection[] = [
  {
    id: "intro",
    label: "1. はじめに",
    intro: "JARVIS Trade Log は、少額（例：30万円）での株式運用を支援するローカル管理コンソールです。売買判断そのものは行わず、あくまで判断の補助を提供します。",
    cards: [
      { q: "このアプリで何ができる？", a: "銘柄のスコアリング、保有株管理、運用日誌、リスク分析、バックテスト、リバランス提案、通知などを、すべて手元（localStorage）で完結して管理できます。外部に取引を発注する機能はありません。" },
      { q: "30万円運用での基本的な使い方は？", a: "①気になる銘柄を「銘柄管理」に登録 → ②Score/Grade を確認 → ③Strategy 適合と Simulator で試算 → ④Risk を確認 → ⑤納得できれば「保有株」に登録。1銘柄あたりは資金の20%以内（=6万円目安）に抑えるのが基本です。" },
      { q: "毎日見るべき画面は？", a: "まず「ダッシュボード」で総資産・含み損益・Risk Grade・Discipline Score・通知を確認。次に「規律」で違反の有無、「通知」で未読の重大アラートをチェックします。詳しくは『今日やること』チェックリストを参照。" },
    ],
  },
  {
    id: "dashboard",
    label: "2. ダッシュボードの見方",
    intro: "ダッシュボードは運用全体の状態を一望する画面です。数字が悪化した項目から優先的に確認します。",
    cards: [
      { q: "総資産とは？", a: "保有株の現在評価額と現金を合わせた合計です。日々の増減より、トレンド（上向きか下向きか）を見ることが大切です。" },
      { q: "含み損益とは？", a: "保有株を今売った場合に確定する損益（未確定）です。プラスでも売るまでは利益ではなく、マイナスでも売らなければ損は確定しません。損切りラインとの距離を意識します。" },
      { q: "Risk Grade とは？", a: "ポートフォリオ全体のリスク度合いを A〜D で表した総合評価です。D は集中しすぎ・変動が大きすぎのサイン。防御的な配分（現金比率↑・分散↑）を検討します。", tone: "warning" },
      { q: "Discipline Score とは？", a: "自分で決めた売買ルール（損切り・保有比率など）をどれだけ守れているかの点数です。低い＝ルール違反が多い状態。感情的な取引を減らす指標です。" },
      { q: "Mental Score とは？", a: "取引履歴から推定した心理状態の安定度です。連敗直後の熱くなった取引や、リベンジトレードの傾向を可視化します。低い時は取引を控えめに。" },
      { q: "通知パネルの見方は？", a: "未読通知数・未読danger数・最新通知3件を表示します。未読の danger 通知があれば最優先で確認してください。詳細は「通知」画面へ。", tone: "warning" },
    ],
  },
  {
    id: "stocks",
    label: "3. 銘柄管理の見方",
    intro: "銘柄管理は候補銘柄の指標を一覧する画面です。単一の数字で判断せず、複数指標を組み合わせて見ます。",
    cards: [
      { q: "Score とは？", a: "各指標を総合した0〜100の独自スコアです。高いほど条件が揃っている目安ですが、絶対的な買いサインではありません。" },
      { q: "Grade とは？", a: "Score を段階（S/A/B/C など）に区分した評価ラベルです。ひと目で相対的な良し悪しを把握するための目安です。" },
      { q: "RSI とは？", a: "買われすぎ・売られすぎを0〜100で示す指標。70以上は過熱、30以下は売られすぎの目安。80以上での飛びつき買いは特に危険です。", tone: "warning" },
      { q: "PER とは？", a: "株価が1株利益の何倍かを示す割高・割安の目安。低いほど割安傾向ですが、業種で標準値が異なります。" },
      { q: "PBR とは？", a: "株価が1株純資産の何倍かを示す指標。1倍が解散価値の目安とされます。" },
      { q: "ROE とは？", a: "自己資本に対してどれだけ効率よく利益を上げているか。高いほど収益効率が良い傾向です。" },
      { q: "出来高の見方は？", a: "売買が成立した株数です。急増は関心の高まりや転換点のサイン。ただし高RSI＋出来高急増は過熱の可能性があり注意します。" },
      { q: "危険アラートとは？", a: "出来高急増や過熱など、注意すべき状態を検出した警告です。赤（danger）表示は特に慎重に。", tone: "danger" },
    ],
  },
  {
    id: "buy",
    label: "4. 買う前の流れ",
    intro: "衝動買いを避けるための推奨手順です。1つずつ確認し、どれかで引っかかれば見送る勇気も大切です。",
    cards: [
      { q: "① 銘柄登録", a: "「銘柄管理」で対象銘柄を登録し、価格・指標を最新化します（J-Quants 接続時は一括更新可）。" },
      { q: "② Score 確認", a: "Score / Grade を確認。低スコア銘柄は原則見送り。数字だけでなく理由（どの指標が弱いか）も確認します。" },
      { q: "③ Strategy 適合確認", a: "「戦略」で自分のルールに適合するかを確認します。適合しない銘柄は、たとえ高スコアでも保留が無難です。" },
      { q: "④ Simulator 確認", a: "「試算」で購入株数・想定損益・損切り時の損失額をシミュレーションします。許容できる損失額かを必ず確認。" },
      { q: "⑤ Risk 確認", a: "「リスク」で買い増し後のポートフォリオ全体のリスク（集中度・破産確率など）が悪化しないか確認します。", tone: "warning" },
      { q: "⑥ 最終判断", a: "以上をすべて通過し、損切りラインを決められたら購入。1銘柄は資金の20%以内、現金は20〜30%残すのが基本です。" },
    ],
  },
  {
    id: "sell",
    label: "5. 売る前の流れ",
    intro: "「売り」は「買い」より難しいと言われます。あらかじめ決めたルールに従って淡々と実行します。",
    cards: [
      { q: "① 損切りライン確認", a: "購入時に決めた損切り価格に到達していないか確認。到達していれば、感情を挟まず実行するのが規律です。", tone: "danger" },
      { q: "② 利確目標確認", a: "目標株価・目標利益率に達したか確認。欲張らず、決めた水準での利確を検討します。" },
      { q: "③ 出来高アラート確認", a: "「通知」「銘柄管理」で出来高急増や過熱アラートを確認。天井圏のサインなら利確・縮小を検討します。", tone: "warning" },
      { q: "④ Rebalance 提案確認", a: "「調整（リバランス）」で、比率が偏った銘柄の縮小提案を確認します。集中しすぎの是正に使います。" },
      { q: "⑤ Trade 履歴保存", a: "売却後は「履歴」に取引を記録します。後の「戦略別成績」「心理分析」の精度が上がります。" },
    ],
  },
  {
    id: "glossary",
    label: "6. 用語辞典",
    intro: "頻出する専門用語を初心者向けに簡潔に説明します。各指標のツールチップ（ⓘ）からもここへ移動できます。",
    cards: GLOSSARY.map((t) => ({
      q: `${t.label} — ${t.shortDescription}`,
      a: `${t.beginnerDescription}\n【JARVIS基準】${t.jarvisRange.map((b) => `${b.range}：${b.meaning}`).join(" / ")}${t.warning ? `\n【注意】${t.warning}` : ""}`,
      anchor: `g-${t.key}`,
      tone: (t.dangerRange ? "warning" : "info") as CardTone,
    })),
  },
  {
    id: "verdicts",
    label: "7. JARVIS判定の読み方",
    intro: "各画面に表示される JARVIS のコメント／判定ラベルの意味です。いずれも断定ではなく参考情報です。",
    cards: [
      { q: "買い候補", a: "条件が比較的揃っている状態。ただし最終判断・損切り設定は必ず自分で行います。" },
      { q: "押し目待ち", a: "方向は良いが今は割高/過熱気味。下落（押し目）を待つのが無難、というサイン。" },
      { q: "見送り", a: "条件が不十分。無理に手を出さない方が良い、という判断補助です。" },
      { q: "危険", a: "損切りラインの接近・急落など、注意すべき状態。最優先で対応を検討します。", tone: "danger" },
      { q: "過熱", a: "RSI高値・出来高急増など、買われすぎのサイン。飛びつき買いは避けます。", tone: "warning" },
      { q: "分散推奨", a: "特定銘柄・セクターに集中しすぎの状態。比率の是正（分散）を促すサインです。", tone: "warning" },
    ],
  },
  {
    id: "rules",
    label: "8. 初心者向け運用ルール",
    intro: "守るほど大きな失敗を避けやすい基本ルールです。JARVIS の各種スコアはこれらの遵守を後押しします。",
    cards: [
      { q: "1銘柄は資金の20%以内", a: "1つの銘柄に集中すると、その銘柄の急落で資産全体が大きく傷つきます。上限20%を目安に分散します。" },
      { q: "損切りラインを必ず入れる", a: "買う前に「ここまで下がったら売る」を決めます。損切りを先送りすると損失が膨らみます。", tone: "danger" },
      { q: "RSI80以上では飛びつかない", a: "過熱状態での高値掴みは失敗の典型。押し目を待つ方が期待値は高い傾向です。", tone: "warning" },
      { q: "連敗時は取引額を下げる", a: "連敗中はメンタルが乱れがち。取引額を落として立て直す（Mental Score を参考に）。" },
      { q: "現金を20〜30%残す", a: "全額を株に回さない。暴落時の買い場や生活防衛のため、現金クッションを確保します。" },
      { q: "JARVISの警告を無視しない", a: "danger 通知・危険判定は放置しない。無視するには少々勇敢すぎます、ボス。", tone: "danger" },
    ],
  },
];

const TODO: { id: string; label: string }[] = [
  { id: "t1", label: "ダッシュボードで総資産・含み損益・Risk Grade を確認した" },
  { id: "t2", label: "通知画面で未読の danger 通知を確認した" },
  { id: "t3", label: "規律画面でルール違反がないか確認した" },
  { id: "t4", label: "保有株の損切りライン・利確目標との距離を確認した" },
  { id: "t5", label: "気になる銘柄の Score / RSI / 出来高を確認した" },
  { id: "t6", label: "現金比率が20〜30%残っているか確認した" },
];

const toneCls: Record<CardTone, string> = {
  info: "border-line/60",
  warning: "border-caution/50 bg-caution/5",
  danger: "border-danger/50 bg-danger/5",
};
const toneText: Record<CardTone, string> = { info: "text-arc", warning: "text-caution", danger: "text-danger" };

export default function HelpPage() {
  const [active, setActive] = useState<string>("intro");
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CHECK_KEY);
      if (raw) setChecked(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* ignore */
    }
    // ツールチップ「詳しく見る」からの #g-<key> 遷移 → 用語辞典を開いてスクロール
    const hash = window.location.hash;
    if (hash.startsWith("#g-")) {
      setActive("glossary");
      const id = hash.slice(1);
      setTimeout(() => {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("shadow-arc", "border-arc");
        }
      }, 80);
    }
  }, []);

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(CHECK_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  const resetChecks = () => {
    setChecked({});
    try {
      window.localStorage.removeItem(CHECK_KEY);
    } catch {
      /* ignore */
    }
  };

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const searchHits = useMemo(() => {
    if (!searching) return [];
    return SECTIONS.flatMap((s) =>
      s.cards
        .filter((c) => (c.q + c.a).toLowerCase().includes(q))
        .map((c) => ({ section: s.label, ...c }))
    );
  }, [q, searching]);

  const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
  const doneCount = TODO.filter((t) => checked[t.id]).length;

  const jarvisComment =
    doneCount === TODO.length
      ? "本日の確認手順はすべて完了しています。規律ある運用です、ボス。"
      : doneCount === 0
        ? "まだ本日の確認をしていませんね。まずは『今日やること』から始めましょう、ボス。"
        : `本日の確認は ${doneCount}/${TODO.length} 項目。残りも片付けてしまいましょう。`;

  return (
    <div className="space-y-6">
      <Disclaimer />
      <section className="hud-panel p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="hud-label">📘 JARVIS 操作マニュアル・初心者ガイド <span className="text-arcdim">— {APP_LABEL}</span></h2>
          <input
            className="hud-input w-64"
            placeholder="用語・機能を検索（例：RSI, 損切り）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="text-xs text-arcdim mt-2">
          ※ 本ガイドは投資助言ではなく、判断を補助する参考情報です。最終判断はご自身で行ってください。
        </p>
      </section>

      <section className="hud-panel p-4 border-arc/40 shadow-arc">
        <p className="text-sm font-mono text-arc">・{jarvisComment}</p>
      </section>

      {searching ? (
        <section className="hud-panel p-4">
          <h3 className="hud-label mb-3">検索結果: 「{query}」（{searchHits.length}件）</h3>
          {searchHits.length === 0 ? (
            <p className="text-arcdim text-sm">該当する項目が見つかりませんでした。</p>
          ) : (
            <ul className="space-y-2">
              {searchHits.map((c, i) => (
                <li key={i} className={`rounded border p-3 ${toneCls[c.tone ?? "info"]}`}>
                  <p className="hud-label">{c.section}</p>
                  <p className={`font-display tracking-wider mt-1 ${toneText[c.tone ?? "info"]}`}>{c.q}</p>
                  <p className="text-sm text-[#cfeaff] mt-1 font-mono whitespace-pre-wrap">{c.a}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* カテゴリ別メニュー */}
          <nav className="hud-panel p-3 h-fit md:col-span-1">
            <p className="hud-label mb-2">カテゴリ</p>
            <ul className="space-y-1">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <button
                    className={`w-full text-left px-2 py-1.5 rounded text-sm tracking-wide border transition-colors ${
                      active === s.id
                        ? "border-arc/60 text-arc bg-arc/10"
                        : "border-transparent text-arcdim hover:text-arc hover:border-line"
                    }`}
                    onClick={() => setActive(s.id)}
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* 本文 */}
          <div className="md:col-span-3 space-y-4">
            <section className="hud-panel p-4">
              <h3 className="text-arc font-display tracking-widest text-lg">{current.label}</h3>
              <p className="text-sm text-arcdim mt-2 font-mono">{current.intro}</p>
            </section>
            <div className="space-y-3">
              {current.cards.map((c, i) => (
                <div key={i} id={c.anchor} className={`hud-panel p-4 border ${toneCls[c.tone ?? "info"]}`}>
                  <p className={`font-display tracking-wider ${toneText[c.tone ?? "info"]}`}>{c.q}</p>
                  <p className="text-sm text-[#cfeaff] mt-2 font-mono leading-relaxed whitespace-pre-wrap">{c.a}</p>
                </div>
              ))}
            </div>

            {/* 今日やることチェックリスト */}
            <section className="hud-panel p-4 border-arc/30">
              <div className="flex items-center justify-between mb-3">
                <h3 className="hud-label">✅ 今日やること（{doneCount}/{TODO.length}）</h3>
                <button className="hud-btn text-xs px-3 py-1" onClick={resetChecks}>リセット</button>
              </div>
              <ul className="space-y-2">
                {TODO.map((t) => (
                  <li key={t.id}>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" className="accent-arc" checked={!!checked[t.id]} onChange={() => toggle(t.id)} />
                      <span className={`text-sm font-mono ${checked[t.id] ? "text-arcdim line-through" : "text-[#cfeaff]"}`}>{t.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>

            {/* 関連画面ショートカット */}
            <section className="hud-panel p-4">
              <p className="hud-label mb-2">関連画面へ</p>
              <div className="flex flex-wrap gap-2">
                <Link href="/" className="hud-btn text-xs px-3 py-1">ダッシュボード</Link>
                <Link href="/stocks" className="hud-btn text-xs px-3 py-1">銘柄管理</Link>
                <Link href="/simulator" className="hud-btn text-xs px-3 py-1">試算</Link>
                <Link href="/risk" className="hud-btn text-xs px-3 py-1">リスク</Link>
                <Link href="/discipline" className="hud-btn text-xs px-3 py-1">規律</Link>
                <Link href="/notifications" className="hud-btn text-xs px-3 py-1">通知</Link>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
