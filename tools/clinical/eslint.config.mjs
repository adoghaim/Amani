import js from '@eslint/js';
import globals from 'globals';
export default [{
  files: ['tools/clinical/**/*.mjs'],
  ...js.configs.recommended,
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
}];
