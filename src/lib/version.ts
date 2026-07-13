/**
 * Phase 56: アプリバージョン（単一の真実）。
 * package.json の version を自動参照する（手動同期の drift を防止）。
 * フッター/Settings/Help で表示。
 */
import pkg from "../../package.json";

export const APP_VERSION: string = pkg.version;
export const APP_NAME = "JARVIS Trade Log";
export const APP_LABEL = `${APP_NAME} v${APP_VERSION}`;
