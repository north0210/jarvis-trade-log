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
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
