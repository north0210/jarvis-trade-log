// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import {
  getJQuantsCredentials,
  setJQuantsCredentials,
  getJQuantsApiKey,
  setJQuantsApiKey,
  getProviderMode,
  setProviderMode,
} from "./settings";

// ※ APIキーはダミー値のみ。
const DUMMY_KEY = "dummy-v2-key";
const DUMMY_KEY2 = "dummy-v2-key-2";

beforeEach(() => {
  window.localStorage.clear();
});

describe("APIキーの保存/取得", () => {
  it("未保存なら null", () => {
    expect(getJQuantsApiKey()).toBeNull();
    expect(getJQuantsCredentials()).toBeNull();
  });

  it("setJQuantsApiKey → getJQuantsApiKey が往復一致", () => {
    setJQuantsApiKey(DUMMY_KEY);
    expect(getJQuantsApiKey()).toBe(DUMMY_KEY);
    expect(getJQuantsCredentials()).toEqual({ apiKey: DUMMY_KEY });
  });

  it("setJQuantsCredentials はマージ保存（apiKey を消さない）", () => {
    setJQuantsApiKey(DUMMY_KEY);
    setJQuantsCredentials({ email: "you@example.com", password: "pw" });
    const cred = getJQuantsCredentials();
    expect(cred).toEqual({ apiKey: DUMMY_KEY, email: "you@example.com", password: "pw" });
  });

  it("APIキーの上書き更新ができる", () => {
    setJQuantsApiKey(DUMMY_KEY);
    setJQuantsApiKey(DUMMY_KEY2);
    expect(getJQuantsApiKey()).toBe(DUMMY_KEY2);
  });

  it("email/password のみでも読める（V1 後方互換）", () => {
    setJQuantsCredentials({ email: "you@example.com", password: "pw" });
    expect(getJQuantsCredentials()).toEqual({ email: "you@example.com", password: "pw" });
    expect(getJQuantsApiKey()).toBeNull();
  });
});

describe("Provider モード", () => {
  it("既定は manual", () => {
    expect(getProviderMode()).toBe("manual");
  });
  it("jquants-ready に切替できる", () => {
    setProviderMode("jquants-ready");
    expect(getProviderMode()).toBe("jquants-ready");
  });
});
