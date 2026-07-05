import { describe, it, expect } from "vitest";
import { mapMasterRecord, buildUniverse, toAdjBar, assembleAdjSeries } from "./universe";
import type { V2MasterRecord, V2DailyBar } from "@/lib/pricing/jquantsV2";

function master(o: Partial<V2MasterRecord>): V2MasterRecord {
  return o;
}
function bar(o: Partial<V2DailyBar>): V2DailyBar {
  return o;
}

describe("mapMasterRecord", () => {
  it("マスタ → UniverseEntry（業種名/市場名を採用）", () => {
    const e = mapMasterRecord(
      master({ Code: "72030", CoName: "トヨタ自動車", CoNameEn: "TOYOTA", S17Nm: "自動車・輸送機", S33Nm: "輸送用機器", ScaleCat: "TOPIX Core30", MktNm: "プライム" })
    );
    expect(e).toEqual({
      code: "72030",
      name: "トヨタ自動車",
      nameEn: "TOYOTA",
      sector17: "自動車・輸送機",
      sector33: "輸送用機器",
      scaleCategory: "TOPIX Core30",
      market: "プライム",
    });
  });
});

describe("buildUniverse", () => {
  it("Code 空を除外し、重複 Code は後勝ちで一意化", () => {
    const u = buildUniverse([
      master({ Code: "72030", CoName: "旧名" }),
      master({ Code: "", CoName: "無効" }),
      master({ Code: "72030", CoName: "新名" }),
      master({ Code: "99840", CoName: "ソフトバンクG" }),
    ]);
    expect(u).toHaveLength(2);
    expect(u.find((x) => x.code === "72030")?.name).toBe("新名"); // 後勝ち
  });
});

describe("toAdjBar（調整後採用）", () => {
  it("AdjC/AdjVo を採用する", () => {
    expect(toAdjBar(bar({ Date: "2026-04-10", AdjC: 3050, AdjVo: 12000, C: 3100, Vo: 12345 }))).toEqual({
      date: "2026-04-10",
      adjClose: 3050,
      adjVolume: 12000,
    });
  });
  it("AdjC 欠損は null", () => {
    expect(toAdjBar(bar({ Date: "2026-04-10" })).adjClose).toBeNull();
  });
});

describe("assembleAdjSeries", () => {
  it("銘柄別に日付昇順で組み立て、AdjC null/空日付を除外", () => {
    const bars: V2DailyBar[] = [
      bar({ Code: "72030", Date: "2026-04-09", AdjC: 3000, AdjVo: 10 }),
      bar({ Code: "72030", Date: "2026-04-10", AdjC: 3050, AdjVo: 20 }),
      bar({ Code: "72030", Date: "2026-04-08", AdjC: null }), // 除外
      bar({ Code: "99840", Date: "2026-04-10", AdjC: 8000, AdjVo: 5 }),
      bar({ Code: "", Date: "2026-04-10", AdjC: 1 }), // Code 空 → 除外
    ];
    const m = assembleAdjSeries(bars);
    expect(m.get("72030")?.map((b) => b.date)).toEqual(["2026-04-09", "2026-04-10"]);
    expect(m.get("72030")?.map((b) => b.adjClose)).toEqual([3000, 3050]);
    expect(m.get("99840")).toHaveLength(1);
    expect(m.has("")).toBe(false);
  });
});
