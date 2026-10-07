import js from "@eslint/js";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.js"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { console: "readonly" },
    },
    rules: {
      "no-unused-vars": "error",
      "no-console": "warn",
    },
  },
  { ignores: ["**/node_modules/**", "**/dist/**"] },
]);
