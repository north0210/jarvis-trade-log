/**
 * Phase 54 (v1.2): JARVIS Advisor スナップショット永続化・履歴・差分（完全ローカル）。
 * types.ts は変更せず、本モジュールで型を保持。localStorage に判定履歴を保存し、
 * 過去との差分（上昇/悪化銘柄）・推移を提供する。
 */
import type { AdvisorCategory, AdvisorCounts, AdvisorReport, OverallGrade } from "./advisorTypes";
import type { AdvisorWeights } from "./advisorTypes";

const KEY = "jarvis-trade-log:advisor-snapshots";
const MAX = 60;

export interface AdvisorSnapItem {
  code: string;
  name: string;
  category: AdvisorCategory;
  composite: number;
  grade: OverallGrade;
}

export interface AdvisorSnapshot {
  id: string;
  date: string; // YYYY-MM-DD
  createdAt: string; // ISO
  preset: string;
  weights: AdvisorWeights;
  counts: AdvisorCounts;
  items: AdvisorSnapItem[];
}

function read(): AdvisorSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? (p as AdvisorSnapshot[]) : [];
  } catch {
    return [];
  }
}
function write(list: AdvisorSnapshot[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
}

/** 保存日時降順の履歴。 */
export function listAdvisorSnapshots(): AdvisorSnapshot[] {
  return read().slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

/** 現在の Advisor レポートをスナップショットとして保存。 */
export function saveAdvisorSnapshot(report: AdvisorReport, preset: string, weights: AdvisorWeights, at: string): AdvisorSnapshot {
  const snap: AdvisorSnapshot = {
    id: newId(),
    date: at.slice(0, 10),
    createdAt: at,
    preset,
    weights,
    counts: report.counts,
    items: report.items.map((i) => ({ code: i.code, name: i.name, category: i.category, composite: i.composite, grade: i.grade })),
  };
  write([snap, ...read()]);
  return snap;
}

export function removeAdvisorSnapshot(id: string): void {
  write(read().filter((s) => s.id !== id));
}
export function clearAdvisorSnapshots(): void {
  write([]);
}

export interface SnapDiffRow {
  code: string;
  name: string;
  fromComposite: number;
  toComposite: number;
  delta: number;
  fromCategory: AdvisorCategory;
  toCategory: AdvisorCategory;
}
export interface SnapDiff {
  improved: SnapDiffRow[]; // 上昇銘柄
  worsened: SnapDiffRow[]; // 悪化銘柄
}

/** 2スナップショット間の差分（current 基準・composite 変化）。 */
export function diffSnapshots(current: AdvisorSnapshot, prev: AdvisorSnapshot | null): SnapDiff {
  if (!prev) return { improved: [], worsened: [] };
  const prevMap = new Map(prev.items.map((i) => [i.code, i]));
  const improved: SnapDiffRow[] = [];
  const worsened: SnapDiffRow[] = [];
  for (const cur of current.items) {
    const p = prevMap.get(cur.code);
    if (!p) continue;
    const delta = cur.composite - p.composite;
    const row: SnapDiffRow = { code: cur.code, name: cur.name, fromComposite: p.composite, toComposite: cur.composite, delta, fromCategory: p.category, toCategory: cur.category };
    if (delta >= 3) improved.push(row);
    else if (delta <= -3) worsened.push(row);
  }
  improved.sort((a, b) => b.delta - a.delta);
  worsened.sort((a, b) => a.delta - b.delta);
  return { improved, worsened };
}
