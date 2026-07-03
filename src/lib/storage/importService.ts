/**
 * バックアップ・インポート層
 *
 * exportService.ts が出力した JSON ファイルを検証し、localStorage へ書き戻す。
 * 上書き確認ダイアログは UI 側（Settings 画面）で行い、本サービスは
 * 検証と書き込みに専念する。
 */
import { BACKUP_APP, BACKUP_VERSION, STORAGE_KEYS } from "./keys";
import type { BackupEnvelope } from "./exportService";

export interface ImportResult {
  stocks: number;
  holdings: number;
  journal: number;
}

/** JSON テキストを検証し、正当なら BackupEnvelope を返す。不正なら例外。 */
export function parseAndValidate(text: string): BackupEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("JSON として読み込めませんでした。ファイル形式を確認してください。");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("バックアップ形式が不正です（オブジェクトではありません）。");
  }
  const env = parsed as Partial<BackupEnvelope>;

  if (env.app !== BACKUP_APP) {
    throw new Error(`このアプリのバックアップではありません（app: ${String(env.app)}）。`);
  }
  if (typeof env.version !== "number") {
    throw new Error("バージョン情報がありません。");
  }
  if (env.version > BACKUP_VERSION) {
    throw new Error(
      `新しいバージョンのバックアップです（v${env.version}）。アプリを更新してください。`
    );
  }
  if (typeof env.data !== "object" || env.data === null) {
    throw new Error("data フィールドがありません。");
  }
  const d = env.data as BackupEnvelope["data"];
  if (!Array.isArray(d.stocks) || !Array.isArray(d.holdings) || !Array.isArray(d.journal)) {
    throw new Error("data 内の stocks / holdings / journal が配列ではありません。");
  }

  return env as BackupEnvelope;
}

/** 検証済みエンベロープを localStorage へ書き込む（既存データを上書き）。 */
function writeEnvelope(env: BackupEnvelope): ImportResult {
  if (typeof window === "undefined") {
    return { stocks: 0, holdings: 0, journal: 0 };
  }
  const { stocks, holdings, journal, settings } = env.data;
  window.localStorage.setItem(STORAGE_KEYS.stocks, JSON.stringify(stocks));
  window.localStorage.setItem(STORAGE_KEYS.holdings, JSON.stringify(holdings));
  window.localStorage.setItem(STORAGE_KEYS.journal, JSON.stringify(journal));
  if (settings != null) {
    window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  }
  return { stocks: stocks.length, holdings: holdings.length, journal: journal.length };
}

/**
 * ファイルを読み込み・検証し、既存データを上書きする。
 * 呼び出し側で上書き確認ダイアログを表示してから実行すること。
 */
export async function importAll(file: File): Promise<ImportResult> {
  const text = await file.text();
  const env = parseAndValidate(text);
  return writeEnvelope(env);
}
