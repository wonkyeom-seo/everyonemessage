import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("loadConfig", () => {
  it("allows development auth mode without firebase admin secrets", () => {
    process.env.AUTH_MODE = "dev";
    process.env.PORT = "4000";
    expect(loadConfig().AUTH_MODE).toBe("dev");
  });
});
