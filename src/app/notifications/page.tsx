"use client";

import { useEffect, useMemo, useState } from "react";
import PageIntro from "@/components/PageIntro";
import HelpTooltip from "@/components/HelpTooltip";
import {
  getNotifications,
  markRead,
  markAllRead,
  removeNotification,
  clearNotifications,
  cleanupNotifications,
  type NotificationRecord,
  type NotificationType,
  type NotificationLevel,
} from "@/lib/notifications/notification-service";

const typeLabel: Record<NotificationType, string> = { report: "レポート", discipline: "規律", volume: "出来高", risk: "リスク", system: "システム" };
const levelCls: Record<NotificationLevel, string> = { danger: "text-danger", warning: "text-caution", info: "text-arc" };

const fmtAt = (iso: string) => iso.slice(0, 16).replace("T", " ");

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | NotificationType>("all");
  const [levelFilter, setLevelFilter] = useState<"all" | NotificationLevel>("all");
  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">("all");
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    cleanupNotifications();
    setItems(getNotifications());
  };
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () =>
      items.filter(
        (r) =>
          (typeFilter === "all" || r.type === typeFilter) &&
          (levelFilter === "all" || r.level === levelFilter) &&
          (readFilter === "all" || (readFilter === "unread" ? !r.read : r.read))
      ),
    [items, typeFilter, levelFilter, readFilter]
  );

  const unread = items.filter((r) => !r.read).length;
  const dangerUnread = items.filter((r) => !r.read && r.level === "danger").length;

  const comment =
    dangerUnread > 0
      ? `未読のdanger通知が${dangerUnread}件あります。無視するには少々勇敢すぎます、ボス。`
      : unread > 0
        ? `未読通知が${unread}件あります。`
        : "本日は未確認の重大通知はありません。良好です、ボス。";

  const doMarkRead = (id: string) => { markRead(id); load(); };
  const doMarkAll = () => { markAllRead(); setMsg("すべて既読にしました。"); load(); };
  const doRemove = (id: string) => { removeNotification(id); load(); };
  const doClear = () => { if (confirm("通知履歴をすべて削除しますか？")) { clearNotifications(); setMsg("通知履歴を整理しました。"); load(); } };
  const doCleanup = () => { const n = cleanupNotifications(); setMsg(`保持期間外の ${n} 件を整理しました。`); load(); };

  return (
    <div className="space-y-6">
      <PageIntro title="🔔 通知履歴" description="規律・リスク・出来高などの通知を一覧・管理します。" helpKey="notificationthreshold" />
      <section className="hud-panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="hud-label"><HelpTooltip termKey="notificationthreshold" label="🔔 通知履歴" /> ({items.length}) — 未読 {unread}</h2>
          <div className="flex gap-2">
            <button className="hud-btn text-xs px-3 py-1" onClick={doMarkAll}>全既読</button>
            <button className="hud-btn text-xs px-3 py-1" onClick={doCleanup}>期限整理</button>
            <button className="hud-btn-danger px-3 py-1 text-xs" onClick={doClear}>全削除</button>
          </div>
        </div>
        {msg && <p className="text-profit text-sm font-mono mt-2">{msg}</p>}
      </section>

      <section className="hud-panel p-4 border-arc/40 shadow-arc">
        <p className="text-sm font-mono text-arc">・{comment}</p>
      </section>

      <section className="hud-panel p-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <label className="flex items-center gap-1">
            <span className="hud-label">種別</span>
            <select className="hud-input w-28" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
              <option value="all">すべて</option>
              <option value="report">レポート</option>
              <option value="discipline">規律</option>
              <option value="volume">出来高</option>
              <option value="risk">リスク</option>
              <option value="system">システム</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="hud-label">レベル</span>
            <select className="hud-input w-24" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value as typeof levelFilter)}>
              <option value="all">すべて</option>
              <option value="danger">danger</option>
              <option value="warning">warning</option>
              <option value="info">info</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="hud-label">状態</span>
            <select className="hud-input w-24" value={readFilter} onChange={(e) => setReadFilter(e.target.value as typeof readFilter)}>
              <option value="all">すべて</option>
              <option value="unread">未読</option>
              <option value="read">既読</option>
            </select>
          </label>
        </div>

        {filtered.length === 0 ? (
          <p className="text-arcdim text-sm">該当する通知はありません。</p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((r) => (
              <li key={r.id} className={`px-3 py-2 rounded border ${r.read ? "border-line/60 opacity-70" : "border-arc/40 bg-arc/5"}`}>
                <div className="flex items-center justify-between">
                  <span className={`font-display tracking-wider ${levelCls[r.level]}`}>
                    {!r.read && <span className="text-arc">● </span>}
                    [{typeLabel[r.type]}] {r.title}
                  </span>
                  <span className="hud-label">{fmtAt(r.createdAt)}</span>
                </div>
                <p className="text-sm text-[#cfeaff] mt-1 font-mono whitespace-pre-wrap">{r.body}</p>
                <div className="flex gap-2 mt-2">
                  {!r.read && <button className="hud-btn text-xs px-2 py-0.5" onClick={() => doMarkRead(r.id)}>既読にする</button>}
                  <button className="hud-btn-danger" onClick={() => doRemove(r.id)}>削除</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
