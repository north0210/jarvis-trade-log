/**
 * ペーパートレードの永続化（localStorage・K レジストリ経由）— Phase 1 / Task 2。
 *
 * - 口座（ポジション・確定損益・キルスイッチ状態）と資金管理設定を保持。
 * - load は破損データでも例外を投げず安全にフォールバック（口座=空 / 設定=既定）。
 * - キー文字列は K 経由（KEY_REGISTRY 登録・バックアップ対象）。
 */
import { K } from "@/lib/storage/keys";
import {
  type PaperAccount,
  type PaperBrokerSettings,
  type KillSwitchState,
  emptyAccount,
  initialCash,
  DEFAULT_PAPER_BROKER_SETTINGS,
  INACTIVE_KILL_SWITCH,
} from "./paperBroker";

const ACCOUNT_KEY = K.paperBrokerAccount;
const SETTINGS_KEY = K.paperBrokerSettings;

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 容量超過等は握りつぶす（UI を壊さない）。
  }
}

// ---- 口座 ----

function normalizeKillSwitch(v: unknown): KillSwitchState {
  if (typeof v !== "object" || v === null) return { ...INACTIVE_KILL_SWITCH };
  const o = v as Record<string, unknown>;
  return {
    active: o.active === true,
    reason: typeof o.reason === "string" ? o.reason : "",
    triggeredAt: typeof o.triggeredAt === "string" ? o.triggeredAt : null,
    drawdownPctAtTrigger: typeof o.drawdownPctAtTrigger === "number" ? o.drawdownPctAtTrigger : null,
  };
}

/** 口座を読み込む（未保存/破損/形状不正時は空口座＝安全フォールバック）。 */
export function loadPaperAccount(): PaperAccount {
  // 現金の後方互換初期化に運用資金が必要。
  const capitalYen = loadPaperBrokerSettings().capitalYen;
  const fresh = (): PaperAccount => ({ ...emptyAccount(), cash: capitalYen });
  const raw = read(ACCOUNT_KEY);
  if (!raw) return fresh();
  try {
    const p = JSON.parse(raw) as Partial<PaperAccount>;
    if (!Array.isArray(p.positions) || !Array.isArray(p.closedTrades)) return fresh();
    // cash 未保存の旧口座は「運用資金 − 建玉建値合計」で初期化（後方互換）。
    const cash = typeof p.cash === "number" ? p.cash : initialCash(p.positions, capitalYen);
    return {
      positions: p.positions,
      closedTrades: p.closedTrades,
      killSwitch: normalizeKillSwitch(p.killSwitch),
      cash,
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : "",
    };
  } catch {
    return fresh();
  }
}

/** 口座を保存する。 */
export function savePaperAccount(account: PaperAccount): void {
  write(ACCOUNT_KEY, JSON.stringify(account));
}

// ---- 資金管理設定 ----

/** 設定を読み込む（欠損項目は既定値で補完）。 */
export function loadPaperBrokerSettings(): PaperBrokerSettings {
  const raw = read(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_PAPER_BROKER_SETTINGS };
  try {
    const p = JSON.parse(raw) as Partial<PaperBrokerSettings>;
    return {
      capitalYen: typeof p.capitalYen === "number" && p.capitalYen > 0 ? p.capitalYen : DEFAULT_PAPER_BROKER_SETTINGS.capitalYen,
      splits: typeof p.splits === "number" && p.splits > 0 ? p.splits : DEFAULT_PAPER_BROKER_SETTINGS.splits,
      killSwitchDrawdownPct:
        typeof p.killSwitchDrawdownPct === "number" && p.killSwitchDrawdownPct > 0
          ? p.killSwitchDrawdownPct
          : DEFAULT_PAPER_BROKER_SETTINGS.killSwitchDrawdownPct,
    };
  } catch {
    return { ...DEFAULT_PAPER_BROKER_SETTINGS };
  }
}

/** 設定を部分更新して保存し、更新後の全体を返す。 */
export function savePaperBrokerSettings(patch: Partial<PaperBrokerSettings>): PaperBrokerSettings {
  const merged = { ...loadPaperBrokerSettings(), ...patch };
  write(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}
