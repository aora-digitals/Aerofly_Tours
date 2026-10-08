import { defineConfig } from "vitest/config";
import path from "path";
import dotenv from "dotenv";

const templateRoot = path.resolve(import.meta.dirname);

// Explicitly load the project's .env before Vitest imports server modules.
dotenv.config({
  path: path.resolve(templateRoot, ".env"),
});

console.log(
  "[Vitest env] SUPABASE_URL:",
  Boolean(process.env.SUPABASE_URL),
);

console.log(
  "[Vitest env] SUPABASE_SERVICE_ROLE_KEY:",
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
);

export default defineConfig({
  root: templateRoot,

  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },

  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
  },
});