import { describe, it, expect } from "vitest";
import { findExistingTemplateId } from "./PlanPage";

const catalog = [
  { id: "t1", name: "Push A" },
  { id: "t2", name: "Pull B" },
  { id: "t3", name: "Legs C" },
];

describe("findExistingTemplateId", () => {
  it("returns the id when a template with the exact name exists", () => {
    expect(findExistingTemplateId("Push A", catalog)).toBe("t1");
    expect(findExistingTemplateId("Pull B", catalog)).toBe("t2");
    expect(findExistingTemplateId("Legs C", catalog)).toBe("t3");
  });

  it("returns null when no template matches the name", () => {
    expect(findExistingTemplateId("Upper A", catalog)).toBeNull();
  });

  it("returns null for an empty catalog", () => {
    expect(findExistingTemplateId("Push A", [])).toBeNull();
  });

  it("is case-sensitive — partial or wrong-case names do not match", () => {
    expect(findExistingTemplateId("push a", catalog)).toBeNull();
    expect(findExistingTemplateId("PUSH A", catalog)).toBeNull();
    expect(findExistingTemplateId("Push", catalog)).toBeNull();
  });

  it("returns the first match when duplicates exist in the catalog", () => {
    const dup = [{ id: "first", name: "Push A" }, { id: "second", name: "Push A" }];
    expect(findExistingTemplateId("Push A", dup)).toBe("first");
  });
});
