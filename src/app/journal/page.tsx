"use client";

import { useEffect, useMemo, useState } from "react";
import { getJournalRepository, type JournalInput } from "@/lib/storage/journalRepository";
import type { Journal } from "@/lib/types";

const repo = getJournalRepository();

const today = () => new Date().toISOString().slice(0, 10);

const empty = {
  date: today(),
  marketMemo: "",
  tradeMemo: "",
  boughtStocks: "",
  soldStocks: "",
  buyReason: "",
  sellReason: "",
  emotion: "",
  reflection: "",
  jarvisComment: "",
};
type Form = typeof empty;

const FIELDS: { key: keyof Omit<Form, "date">; label: string; rows?: number }[] = [
  { key: "marketMemo", label: "今日の相場メモ", rows: 2 },
  { key: "tradeMemo", label: "売買メモ", rows: 2 },
  { key: "boughtStocks", label: "買った銘柄" },
  { key: "soldStocks", label: "売った銘柄" },
  { key: "buyReason", label: "買った理由", rows: 2 },
  { key: "sellReason", label: "売った理由", rows: 2 },
  { key: "emotion", label: "感情メモ", rows: 2 },
  { key: "reflection", label: "反省", rows: 2 },
  { key: "jarvisComment", label: "JARVISコメント欄", rows: 2 },
];

const toInput = (f: Form): JournalInput =>
  Object.fromEntries(
    Object.entries(f).map(([k, v]) => [k, k === "date" ? v : v === "" ? null : v])
  ) as unknown as JournalInput;

const toForm = (j: Journal): Form => ({
  date: j.date,
  marketMemo: j.marketMemo ?? "",
  tradeMemo: j.tradeMemo ?? "",
  boughtStocks: j.boughtStocks ?? "",
  soldStocks: j.soldStocks ?? "",
  buyReason: j.buyReason ?? "",
  sellReason: j.sellReason ?? "",
  emotion: j.emotion ?? "",
  reflection: j.reflection ?? "",
  jarvisComment: j.jarvisComment ?? "",
});

export default function JournalPage() {
  const [entries, setEntries] = useState<Journal[]>([]);
  const [form, setForm] = useState<Form>(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const load = async () => {
    setEntries(await repo.list());
  };
  useEffect(() => {
    load();
  }, []);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.date) {
      alert("日付は必須です。");
      return;
    }
    setBusy(true);
    try {
      if (editingId) await repo.update(editingId, toInput(form));
      else await repo.create(toInput(form));
    } catch (e) {
      setBusy(false);
      alert(`保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setBusy(false);
    setForm({ ...empty, date: today() });
    setEditingId(null);
    load();
  };

  const edit = (j: Journal) => {
    setEditingId(j.id);
    setForm(toForm(j));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ ...empty, date: today() });
  };

  const remove = async (id: string) => {
    if (!confirm("この日誌を削除しますか？")) return;
    await repo.remove(id);
    if (editingId === id) cancelEdit();
    load();
  };

  // 日付検索（date に部分一致）。最新順は Repository 側で担保。
  const filtered = useMemo(
    () => (search ? entries.filter((e) => e.date.includes(search)) : entries),
    [entries, search]
  );

  return (
    <div className="space-y-6">
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-4">{editingId ? "▲ 日誌を編集" : "＋ 本日の運用日誌"}</h2>
        <label className="block max-w-xs">
          <span className="hud-label">日付 *</span>
          <input className="hud-input mt-1" type="date" value={form.date} onChange={set("date")} />
        </label>
        <div className="grid md:grid-cols-2 gap-3 mt-3">
          {FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="hud-label">{f.label}</span>
              {f.rows ? (
                <textarea className="hud-input mt-1" rows={f.rows} value={form[f.key]} onChange={set(f.key)} />
              ) : (
                <input className="hud-input mt-1" value={form[f.key]} onChange={set(f.key)} />
              )}
            </label>
          ))}
        </div>
        <div className="mt-4 flex gap-3">
          <button className="hud-btn" onClick={submit} disabled={busy}>
            {editingId ? "更新する" : "記録する"}
          </button>
          {editingId && (
            <button className="hud-btn-danger" onClick={cancelEdit}>編集をやめる</button>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="hud-label">記録一覧 ({filtered.length})</h2>
          <label className="flex items-center gap-2">
            <span className="hud-label">日付検索</span>
            <input
              className="hud-input w-44"
              type="text"
              placeholder="2026-07 / 2026-07-02"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="hud-btn text-xs px-2 py-0.5" onClick={() => setSearch("")}>解除</button>
            )}
          </label>
        </div>
        {filtered.length === 0 && (
          <p className="text-arcdim text-sm">
            {entries.length === 0
              ? "記録なし。市場との対話はここから始まります。"
              : "該当する日付の記録はありません。"}
          </p>
        )}
        {filtered.map((e) => (
          <article key={e.id} className="hud-panel p-4">
            <div className="flex justify-between items-center mb-3">
              <p className="font-mono text-arc text-lg">{e.date}</p>
              <div className="flex gap-2">
                <button className="hud-btn text-xs px-2 py-0.5" onClick={() => edit(e)}>編集</button>
                <button className="hud-btn-danger" onClick={() => remove(e.id)}>削除</button>
              </div>
            </div>
            <dl className="grid md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {FIELDS.filter((f) => e[f.key]).map((f) => (
                <div key={f.key}>
                  <dt className="hud-label">{f.label}</dt>
                  <dd className={`mt-0.5 whitespace-pre-wrap ${f.key === "jarvisComment" ? "text-arc" : "text-[#cfeaff]"}`}>
                    {e[f.key] as string}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </section>
    </div>
  );
}
