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
    },
  },
])
