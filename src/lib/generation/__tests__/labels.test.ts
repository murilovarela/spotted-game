import { describe, expect, it } from "vitest";
import { parseLabels, parseLocations } from "../labels";

const ids = ["a", "b"];

describe("parseLabels", () => {
  it("parses a well-formed array", () => {
    expect(parseLabels('[{"candidate":0,"objectId":"a","confidence":0.9},{"candidate":1,"objectId":null,"confidence":0.2}]', 2, ids)).toEqual([
      { candidate: 0, objectId: "a", confidence: 0.9 },
      { candidate: 1, objectId: null, confidence: 0.2 },
    ]);
  });
  it("drops entries with out-of-range candidates or non-numeric confidence, clamps confidence, nulls unknown objects", () => {
    expect(parseLabels('[{"candidate":7,"objectId":"a","confidence":1},{"candidate":0,"objectId":"zzz","confidence":1.7},{"candidate":1,"objectId":"b"}]', 2, ids)).toEqual([
      { candidate: 0, objectId: null, confidence: 1 },
    ]);
  });
  it("accepts a fenced or wrapped payload and returns [] for anything unparseable", () => {
    expect(parseLabels('```json\n[{"candidate":0,"objectId":"b","confidence":0.5}]\n```', 1, ids)).toEqual([{ candidate: 0, objectId: "b", confidence: 0.5 }]);
    expect(parseLabels('{"labels":[{"candidate":0,"objectId":"b","confidence":0.5}]}', 1, ids)).toEqual([{ candidate: 0, objectId: "b", confidence: 0.5 }]);
    expect(parseLabels("not json", 1, ids)).toEqual([]);
    expect(parseLabels("42", 1, ids)).toEqual([]);
  });
});

describe("parseLocations", () => {
  it("converts box_2d [ymin, xmin, ymax, xmax] on a 0–1000 grid into a normalized box", () => {
    expect(parseLocations('[{"objectId":"a","box_2d":[100,200,300,600],"confidence":0.8}]', ids)).toEqual([
      { objectId: "a", box: { x: 0.2, y: 0.1, w: 0.4, h: 0.2 }, confidence: 0.8 },
    ]);
  });
  it("drops unknown objects, malformed or empty boxes, and clamps coordinates and confidence", () => {
    const text = JSON.stringify([
      { objectId: "zzz", box_2d: [0, 0, 100, 100], confidence: 1 },
      { objectId: "a", box_2d: [0, 0, 100], confidence: 1 },
      { objectId: "a", box_2d: [300, 300, 300, 400], confidence: 1 }, // ymax == ymin
      { objectId: "a", box_2d: [400, 400, 300, 500], confidence: 1 }, // ymax < ymin
      { objectId: "a", box_2d: ["0", 0, 100, 100], confidence: 1 },
      { objectId: "b", box_2d: [-50, 900, 1200, 1100], confidence: 1.5 },
      { objectId: "b", box_2d: [0, 0, 100, 100] },
    ]);
    expect(parseLocations(text, ids)).toEqual([{ objectId: "b", box: { x: 0.9, y: 0, w: 0.1, h: 1 }, confidence: 1 }]);
  });
  it("accepts fenced or wrapped payloads and returns [] for anything unparseable", () => {
    expect(parseLocations('```json\n[{"objectId":"b","box_2d":[0,0,500,500],"confidence":0.5}]\n```', ids)).toEqual([{ objectId: "b", box: { x: 0, y: 0, w: 0.5, h: 0.5 }, confidence: 0.5 }]);
    expect(parseLocations('{"locations":[{"objectId":"b","box_2d":[0,0,500,500],"confidence":0.5}]}', ids)).toEqual([{ objectId: "b", box: { x: 0, y: 0, w: 0.5, h: 0.5 }, confidence: 0.5 }]);
    expect(parseLocations("nope", ids)).toEqual([]);
    expect(parseLocations("7", ids)).toEqual([]);
    expect(parseLocations("[1, null]", ids)).toEqual([]);
  });
});
