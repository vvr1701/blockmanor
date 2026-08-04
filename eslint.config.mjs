import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.expo/**',
      '**/android/**',
      '**/ios/**',
      'docs/design/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // PRD §16: zero `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // PRD §4.3 / §16: the engine is deterministic — no ambient randomness or clock.
    // Enforced here so the rule exists before the engine does (PRD §5, Stage 0).
    files: ['packages/engine/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'PRD §4.3: packages/engine is deterministic — use the seeded PRNG in rng.ts (mulberry32).',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'PRD §4.3: time is not a game input — inject it via GameConfig.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'PRD §4.3: inject time via GameConfig; the engine has no clock.' },
      ],
    },
  },
  {
    files: ['**/*.config.{js,mjs,cjs,ts}', '**/metro.config.js', '**/babel.config.js'],
    languageOptions: {
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
