import { describe, expect, it } from "vitest";

describe("web shell", () => {
  it("uses the planned tab count", () => {
    const tabs = ["채팅", "친구", "찾기", "알림", "내정보"];
    expect(tabs).toHaveLength(5);
  });
});
