import js from "@eslint/js";
import jestPlugin from "eslint-plugin-jest";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  js.configs.recommended,
  // Browser-based files
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
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],
      "no-undef": "error",
      "no-console": ["warn", { "allow": ["warn", "error", "log"] }],
      ...jestPlugin.configs.recommended.rules,
    },
  },
  // Node.js files (Arbiter and Scripts)
  {
    files: ["arbiter/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],
      "no-undef": "error",
    }
  },
  // Tests
  {
    files: ["src/**/*.test.js", "src/tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...jestPlugin.environments.globals.globals,
      }
    }
  },
  eslintConfigPrettier,
];
