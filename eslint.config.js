import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  // Página de teste: JavaScript que roda no navegador
  { files: ['public/**/*.js'], languageOptions: { globals: globals.browser } },
);
