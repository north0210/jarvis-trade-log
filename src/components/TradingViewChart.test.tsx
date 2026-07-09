import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TradingViewChart from "./TradingViewChart";

/** 依存の重い testing-library を使わず、静的マークアップ文字列で表示内容を検証する。 */
const html = (el: ReactElement) => renderToStaticMarkup(el);

describe("TradingViewChart（埋め込み廃止→外部リンク化）", () => {
  it("普通株(5桁末尾0): 22220 → TSE:2222 の外部リンク・銘柄名/コード・注記を表示", () => {
    const out = html(<TradingViewChart code="22220" name="テスト商事" />);
    // URL は 4桁正規化済み・新規タブ・noopener
    expect(out).toContain('href="https://jp.tradingview.com/chart/?symbol=TSE:2222"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain("noopener");
    // 銘柄名・コード（正規化済み）
    expect(out).toContain("テスト商事");
    expect(out).toContain("TSE:2222");
    // 注記
    expect(out).toContain("外部で開きます");
    // 埋め込みウィジェットは撤去済み
    expect(out).not.toContain("embed-widget-advanced-chart");
  });

  it("英字含み(137A0) → TSE:137A の外部リンク", () => {
    const out = html(<TradingViewChart code="137A0" />);
    expect(out).toContain('href="https://jp.tradingview.com/chart/?symbol=TSE:137A"');
    expect(out).toContain("TSE:137A");
  });

  it("優先株(末尾0以外 25935) は正規化せず TSE:25935", () => {
    const out = html(<TradingViewChart code="25935" />);
    expect(out).toContain('href="https://jp.tradingview.com/chart/?symbol=TSE:25935"');
    expect(out).toContain("TSE:25935");
  });

  it("code 未設定は『チャートデータ未登録』（リンクを出さない）", () => {
    const out = html(<TradingViewChart code={null} />);
    expect(out).toContain("チャートデータ未登録");
    expect(out).not.toContain("jp.tradingview.com");
  });
});
