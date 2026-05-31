import { describe, expect, it } from "vitest";
import { displayEmHandle, extractHttpUrls, isValidEmHandle, normalizeEmHandle } from "./index";

describe("em handle helpers", () => {
  it("normalizes display handles", () => {
    expect(normalizeEmHandle(" #Test.Em-01 ")).toBe("test.em-01");
    expect(displayEmHandle("Test")).toBe("#test");
  });

  it("validates allowed characters", () => {
    expect(isValidEmHandle("#testemid")).toBe(true);
    expect(isValidEmHandle("#test_em-id")).toBe(true);
    expect(isValidEmHandle("#test.emid")).toBe(false);
    expect(isValidEmHandle("#테스트")).toBe(false);
    expect(isValidEmHandle("#ab")).toBe(false);
    expect(isValidEmHandle("#abcdefghijkl3")).toBe(false);
  });
});

describe("url extraction", () => {
  it("deduplicates http urls", () => {
    expect(extractHttpUrls("see https://example.com and https://example.com")).toEqual([
      "https://example.com"
    ]);
  });
});
