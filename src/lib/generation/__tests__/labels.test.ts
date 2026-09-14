import { describe, expect, it } from "vitest";
import { parseLabels } from "../labels";

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
