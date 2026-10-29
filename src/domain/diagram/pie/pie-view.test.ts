import { describe, expect, it } from "vitest";
import { readPieChartView } from "./pie-view";

describe("readPieChartView", () => {
  it("lists the slices in source order with the value as written", () => {
    const view = readPieChartView(
      'pie title Pets\n  "Dogs" : 386\n  "Cats" : 85.50\n',
    );
    expect(view.title).toBe("Pets");
    expect(view.slices).toEqual([
      { index: 0, targetLabel: "Dogs", displayLabel: "Dogs", valueText: "386" },
      {
        index: 1,
        targetLabel: "Cats",
        displayLabel: "Cats",
        valueText: "85.50",
      },
    ]);
  });

  it("shows a quote entity as a quote but keeps the written form as the target", () => {
    const [slice] = readPieChartView('pie\n  "say #quot;hi#quot;" : 1').slices;
    expect(slice?.displayLabel).toBe('say "hi"');
    expect(slice?.targetLabel).toBe("say #quot;hi#quot;");
  });

  it("has an empty title and no slices for an empty chart", () => {
    expect(readPieChartView("pie\n")).toEqual({ title: "", slices: [] });
  });

  it("keeps Japanese and emoji labels", () => {
    const [slice] = readPieChartView('pie\n  "犬🐕" : 3').slices;
    expect(slice?.displayLabel).toBe("犬🐕");
  });
});
