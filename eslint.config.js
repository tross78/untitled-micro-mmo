import js from "@eslint/js";
import jestPlugin from "eslint-plugin-jest";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    plugins: {
      jest: jestPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...jestPlugin.environments.globals.globals,
      },
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "no-undef": "error",
      "no-console": ["warn", { "allow": ["warn", "error", "log"] }],
      ...jestPlugin.configs.recommended.rules,
    },
  },
  eslintConfigPrettier,
];
