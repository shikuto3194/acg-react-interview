import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist', '.codex-temp/**', 'docs/**', 'src/cardData.js'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'no-irregular-whitespace': ['error', {
        skipComments: true,
        skipStrings: true,
        skipTemplates: true,
        skipJSXText: true,
        skipRegExps: true,
      }],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    // Node 実行されるビルド/設定ファイルは process 等の Node グローバルを許可する
    files: ['vite.config.js', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  { files: ['scripts/security/**/*.mjs', 'scripts/harness.mjs', 'scripts/chunks.mjs', 'scripts/optimized-images.mjs', 'scripts/run-tests.mjs', 'scripts/check-distribution.mjs'], languageOptions: { globals: globals.node }, rules: js.configs.recommended.rules },
  { files: ['src/**/*.test.js'], languageOptions: { globals: globals.node } },
]
