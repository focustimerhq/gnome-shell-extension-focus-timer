import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {FlatCompat} from '@eslint/eslintrc';
import js from '@eslint/js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.resolve(path.dirname(__filename), '..');

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

export default [
    ...compat.config({
        extends: [
            './lint/eslintrc-gjs.yml',
            './lint/eslintrc-shell.yml',
        ],
        parserOptions: {
            sourceType: 'module',
        },
    }),
];
