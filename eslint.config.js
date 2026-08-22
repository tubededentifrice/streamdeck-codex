import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "com.courcelle.codex-controls.sdPlugin/bin/**",
      "coverage/**",
      "node_modules/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["*.mjs"],
    languageOptions: { globals: { process: "readonly" } },
  },
  {
    files: ["com.courcelle.codex-controls.sdPlugin/ui/**/*.js"],
    languageOptions: {
      globals: {
        WebSocket: "readonly",
        clearTimeout: "readonly",
        document: "readonly",
        setTimeout: "readonly",
        structuredClone: "readonly",
        window: "readonly",
      },
    },
  },
);
