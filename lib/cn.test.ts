import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("nối class và bỏ giá trị rỗng", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });
});
