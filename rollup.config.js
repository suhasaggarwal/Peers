import pkg from './package.json';
import typescript from '@rollup/plugin-typescript';

export default [
    {
        input: 'src/index.ts',
        external: [...Object.keys(pkg.dependencies)],
        output: [
            {
                file: pkg.module,
                format: 'es',
                sourcemap: true,
            },
        ],
        plugins: [typescript()],
    },
    {
        input: 'src/index.ts',
        external: [...Object.keys(pkg.dependencies)],
        output: [
            {
                file: pkg.main,
                format: 'cjs',
                sourcemap: true,
            },
        ],
        plugins: [
            typescript({
                target: 'ES5',
                downlevelIteration: true,
            }),
        ],
    },
];
