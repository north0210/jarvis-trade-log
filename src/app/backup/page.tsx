"use client";

/**
 * Phase 52: バックアップ／復元コンソール。
 * 書き出し・読み込み・破損検知・プレビュー・部分復元・比較・世代管理。
 * 復元前に必ず現在状態を退避バックアップとして保存する。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import PageIntro from "@/components/PageIntro";
import { formatBackupTime } from "@/lib/storage/exportService";
import {
  downloadBackup,
  validateBackup,
  compareBackup,
  restoreBackup,
  restorePartial,
  stashCurrent,
  getGenerations,
  restoreGeneration,
  getLastBackup,
  UNIT_LABELS,
  type ValidationResult,
  type RestoreUnit,
  type Generation,
} from "@/lib/backup/backup-service";

type Msg = { tone: "ok" | "err"; text: string } | null;
const UNITS = Object.keys(UNIT_LABELS) as RestoreUnit[];

export default function BackupPage() {
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [selUnits, setSelUnits] = useState<Set<RestoreUnit>>(new Set(UNITS));
  const [msg, setMsg] = useState<Msg>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const comparison = useMemo(() => (validation?.backup ? compareBackup(validation.backup) : []), [validation]);

  const refreshMeta = () => {
    setLastBackup(getLastBackup());
    setGenerations(getGenerations());
  };

  useEffect(() => {
    refreshMeta(); // クライアントで localStorage を反映（ハイドレーション不整合回避）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doExport = () => {
    downloadBackup(new Date());
    refreshMeta();
    setMsg({ tone: "ok", text: "全データを書き出しました。バックアップファイルを保管してください、ボス。" });
  };

  const doStash = () => {
    stashCurrent("manual", new Date().toISOString());
    refreshMeta();
    setMsg({ tone: "ok", text: "現在の状態を退避バックアップに保存しました。人類にしては慎重です、ボス。" });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    const v = validateBackup(text);
    setValidation(v);
    if (v.ok) {
      const bad = v.errors.length;
      setMsg({ tone: "ok", text: bad === 0 ? "バックアップファイルに破損は見つかりません。復元前プレビューを確認してください。" : "一部データのみ復元できます。全損は免れました。" });
    } else {
      setMsg({ tone: "err", text: `復元できません: ${v.errors[0] ?? "不明なエラー"}` });
    }
  };

  const toggleUnit = (u: RestoreUnit) => {
    setSelUnits((prev) => {
      const next = new Set(prev);
      if (next.has(u)) next.delete(u);
      else next.add(u);
      return next;
    });
  };

  const doRestoreAll = () => {
    if (!validation?.backup) return;
    if (!confirm("現在のデータを、このバックアップで上書きします。よろしいですか？（実行前に自動退避します）")) return;
    stashCurrent("before-restore-all", new Date().toISOString());
    const summary = restoreBackup(validation.backup);
    refreshMeta();
    setMsg({ tone: "ok", text: `復元前に退避バックアップを作成しました。${summary.restored.length} 項目を復元しました。反映には画面の再読み込みが必要です、ボス。` });
  };

  const doRestorePartial = () => {
    if (!validation?.backup) return;
    if (selUnits.size === 0) {
      setMsg({ tone: "err", text: "復元する単位を1つ以上選択してください。" });
      return;
    }
    const labels = Array.from(selUnits).map((u) => UNIT_LABELS[u]).join(" / ");
    if (!confirm(`選択した単位（${labels}）を上書き復元します。よろしいですか？（実行前に自動退避します）`)) return;
    stashCurrent("before-restore-partial", new Date().toISOString());
    const summary = restorePartial(validation.backup, Array.from(selUnits));
    refreshMeta();
    setMsg({ tone: "ok", text: `一部データのみ復元しました（${summary.restored.length} 項目）。全損は免れました、ボス。反映には再読み込みが必要です。` });
  };

  const doRestoreGen = (g: Generation) => {
    if (!confirm(`退避バックアップ（${formatBackupTime(g.backup.exportedAt) ?? "—"}）で現在データを上書きします。よろしいですか？`)) return;
    stashCurrent("before-restore-generation", new Date().toISOString());
    restoreGeneration(g.id);
    refreshMeta();
    setMsg({ tone: "ok", text: "退避バックアップから復元しました。反映には再読み込みが必要です、ボス。" });
  };

  const genReasonLabel = (r: string) =>
    r === "manual" ? "手動退避" : r === "before-restore-all" ? "全復元前" : r === "before-restore-partial" ? "部分復元前" : r === "before-restore-generation" ? "世代復元前" : r;

  return (
    <div className="space-y-6">
      <PageIntro title="🛟 バックアップ / 復元" description="データの書き出し・復元・世代管理・破損チェック・部分復元を行います。" />

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">◇ バックアップ操作</h2>
        <div className="flex flex-wrap items-center gap-3">
          <button className="hud-btn" onClick={doExport}>全データを書き出し</button>
          <button className="hud-btn" onClick={doStash}>現在を退避バックアップ</button>
          <label className="hud-btn cursor-pointer">
            バックアップを読み込む
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
          </label>
          <span className="hud-label">
            最終バックアップ:{" "}
            <span className={lastBackup ? "text-arc" : "text-arcdim"}>{formatBackupTime(lastBackup) ?? "未実施"}</span>
          </span>
        </div>
        {msg && <p className={`text-sm font-mono mt-3 ${msg.tone === "ok" ? "text-profit" : "text-danger"}`}>{msg.text}</p>}
      </section>

      {validation && (
        <section className="hud-panel p-4">
          <h2 className="hud-label mb-2">◇ 破損チェック — {fileName}</h2>
          <div className="grid sm:grid-cols-3 gap-3 text-sm font-mono mb-3">
            <div className="hud-panel p-3">
              <p className="hud-label">形式 / バージョン</p>
              <p className="mt-1 text-arc">{validation.legacy ? "旧形式(v1)" : "full"} / v{validation.version ?? "—"}</p>
            </div>
            <div className="hud-panel p-3">
              <p className="hud-label">checksum</p>
              <p className={`mt-1 ${validation.checksumOk === false ? "text-danger" : validation.checksumOk ? "text-profit" : "text-caution"}`}>
                {validation.checksumOk === false ? "不一致（破損の疑い）" : validation.checksumOk ? "一致（正常）" : "未記録"}
              </p>
            </div>
            <div className="hud-panel p-3">
              <p className="hud-label">総合判定</p>
              <p className={`mt-1 ${validation.ok ? "text-profit" : "text-danger"}`}>{validation.ok ? "復元可能" : "復元不可"}</p>
            </div>
          </div>
          {validation.errors.map((e, i) => <p key={`e${i}`} className="text-danger text-xs font-mono">・{e}</p>)}
          {validation.warnings.map((w, i) => <p key={`w${i}`} className="text-caution text-xs font-mono">・{w}</p>)}
        </section>
      )}

      {validation?.backup && (
        <section className="hud-panel p-4 overflow-x-auto">
          <h2 className="hud-label mb-3">◇ 復元前プレビュー（現在 → バックアップ）</h2>
          <table className="w-full text-sm font-mono whitespace-nowrap">
            <thead>
              <tr className="hud-label text-left">
                {["項目", "単位", "現在", "バックアップ", "差異"].map((h) => <th key={h} className="pb-2 pr-3 font-normal">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {comparison.map((r) => (
                <tr key={r.key} className="border-t border-line/60">
                  <td className="py-1.5 pr-3 text-arc">{r.label}</td>
                  <td className="py-1.5 pr-3 text-arcdim">{UNIT_LABELS[r.unit]}</td>
                  <td className="py-1.5 pr-3">{r.kind === "array" ? `${r.currentCount}件` : r.currentCount == null ? "なし" : "あり"}</td>
                  <td className="py-1.5 pr-3">{r.kind === "array" ? `${r.backupCount}件` : r.backupCount == null ? "なし" : "あり"}</td>
                  <td className={`py-1.5 pr-3 ${r.changed ? "text-caution" : "text-arcdim"}`}>{r.changed ? "変化あり" : "同一"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {validation?.ok && validation.backup && (
        <section className="hud-panel p-4">
          <h2 className="hud-label mb-3">◇ 復元（単位を選択）</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {UNITS.map((u) => (
              <label key={u} className={`px-3 py-1.5 rounded border text-sm cursor-pointer ${selUnits.has(u) ? "border-arc/60 text-arc bg-arc/10" : "border-line text-arcdim"}`}>
                <input type="checkbox" className="hidden" checked={selUnits.has(u)} onChange={() => toggleUnit(u)} />
                {UNIT_LABELS[u]}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <button className="hud-btn" onClick={doRestorePartial}>選択単位を復元</button>
            <button className="hud-btn-danger" onClick={doRestoreAll}>すべて復元（上書き）</button>
          </div>
          <p className="text-xs text-arcdim mt-2">※ 復元は既存データを上書きします。実行前に自動で退避バックアップを作成します。反映後は画面の再読み込みを推奨します。</p>
        </section>
      )}

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">◇ 自動退避バックアップ（直近3件）</h2>
        {generations.length === 0 ? (
          <p className="text-arcdim text-sm">退避バックアップはまだありません。</p>
        ) : (
          <ul className="space-y-2">
            {generations.map((g) => (
              <li key={g.id} className="flex items-center justify-between px-3 py-2 rounded border border-line/60">
                <span className="text-sm font-mono">
                  <span className="text-arc">{formatBackupTime(g.backup.exportedAt) ?? "—"}</span>
                  <span className="text-arcdim"> — {genReasonLabel(g.reason)}</span>
                </span>
                <button className="hud-btn text-xs px-3 py-1" onClick={() => doRestoreGen(g)}>この時点へ復元</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="hud-panel p-4">
        <p className="text-sm font-mono text-arcdim">
          関連: <Link href="/settings" className="text-arc hover:underline">設定（Export/Import）</Link> ／{" "}
          <Link href="/help" className="text-arc hover:underline">使い方ガイド</Link>
        </p>
        <p className="text-xs text-arcdim mt-1">※ 認証情報・価格キャッシュなどの機微/一時データはバックアップ対象外です。</p>
      </section>
    </div>
  );
}
