// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,          // <-- enable describe/it/expect as globals
    environment: "jsdom",   // good default for React-ish code
    setupFiles: ["src/test/setup.ts"],
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "workers/**/*.test.ts"
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}", "workers/**/*.ts"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "src/main.tsx",         // app bootstrap, nothing to unit test
        "src/Root.tsx",         // service-worker update glue (virtual:pwa-register)
        "src/**/types.ts",      // type-only modules (no runtime code)
        "src/test/**",          // test setup helpers
      ],
      // The pure business logic (domain, worker, utils) is held at 100%.
      // UI components are covered separately and not gated here yet.
      thresholds: {
        "src/domain/**": { statements: 100, branches: 100, functions: 100, lines: 100 },
        "src/utils/**": { statements: 100, branches: 100, functions: 100, lines: 100 },
        "workers/**": { statements: 100, branches: 100, functions: 100, lines: 100 },
        // UI is covered pragmatically (behavior over presentation); these
        // floors guard against regressions without demanding 100%.
        "src/App.tsx": { statements: 90, branches: 80, functions: 80, lines: 90 },
        "src/components/**": { statements: 88, branches: 65, functions: 65, lines: 88 },
      },
    },
  },
});
