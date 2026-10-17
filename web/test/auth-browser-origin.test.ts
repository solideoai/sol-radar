import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each([
  { configuredPort: undefined, port: 3200 },
  { configuredPort: "43817", port: 43817 },
])("Auth browser and server share localhost on port $port", async ({ configuredPort, port }) => {
  vi.stubEnv("E2E_PORT", configuredPort);
  vi.resetModules();
  const { default: config } = await import("@/playwright.auth.config");
  const origin = `http://localhost:${port}`;
  expect(config.use?.baseURL).toBe(origin);
  expect(config.webServer).toMatchObject({
    command: `pnpm start --hostname localhost --port ${port}`,
    url: origin,
    reuseExistingServer: false,
  });
});
