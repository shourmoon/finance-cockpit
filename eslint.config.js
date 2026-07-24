import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // `any` is a deliberate pattern at the untrusted-JSON boundaries
      // (localStorage/sync payload sanitizers, worker env). Everything
      // inside the domain is strictly typed; see CLAUDE.md.
      '@typescript-eslint/no-explicit-any': 'off',
      // formatDate intentionally joins with non-breaking spaces so
      // formatted dates never wrap; allow them in templates/regexes.
      'no-irregular-whitespace': ['error', { skipTemplates: true, skipRegExps: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Design-system guard: colour lives only in the tokens in
      // src/components/ui.ts. A raw hex literal anywhere else is drift —
      // add or reuse a token instead. (Overridden to allow it in ui.ts.)
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
          message:
            'Raw hex colour — use a token from src/components/ui.ts (colors/chart) instead.',
        },
      ],
    },
  },
  {
    // ui.ts is where the tokens are defined, so hex literals live here.
    // vite.config.ts holds the PWA manifest theme/background colour
    // (mirrors colors.bg) — build config, not component styling.
    files: ['src/components/ui.ts', 'vite.config.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
])
