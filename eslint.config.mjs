import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "data/**",
      "scripts/**",
      "playwright-report/**",
      "test-results/**",
      ".agents/**",
      ".claude/**",
      // Generados por el CLI de shadcn: se actualizan con `shadcn add`, no a mano.
      "frontend/src/components/ui/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["backend/**/*.ts", "packages/**/*.ts", "tests/**/*.{js,mjs}", "*.{js,mjs}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["frontend/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // Tests del repo base: no se modifican. Los callbacks de page.evaluate corren en el navegador.
    files: ["tests/**/*.{js,mjs}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { "no-useless-escape": "off" },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
