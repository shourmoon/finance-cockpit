// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,          // <-- enable describe/it/expect as globals
    environment: "jsdom",   // good default for React-ish code
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"]
  }
});
