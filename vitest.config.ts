import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest 設定（Phase: テスト基盤）。
 * - 純関数ユニットテスト用。環境は node（DOM不要）。
 * - Next.js の "@/..." パスエイリアスを src/ に解決する。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // JSX は自動ランタイム（React 17+）で変換する（コンポーネント描画テスト用・Next と同挙動）。
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
