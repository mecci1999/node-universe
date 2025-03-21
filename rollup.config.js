const filesize = require('rollup-plugin-filesize');
const typescript = require('rollup-plugin-typescript2');
const dts = require('rollup-plugin-dts');
const tscAlias = require('rollup-plugin-tsc-alias');
const json = require('@rollup/plugin-json');
const alias = require('@rollup/plugin-alias');
// const { terser } = require('rollup-plugin-terser');

module.exports = [
  {
    input: './src/index.ts',
    output: [
      {
        dir: './dist',
        format: 'cjs',
        entryFileNames: '[name].js',
        compact: true,
        exports: 'auto'
      },
      {
        dir: './dist',
        format: 'esm',
        entryFileNames: '[name].esm.js',
        compact: true,
      }
    ],
    plugins: [
      alias({
        entries: [
          { find: '@/', replacement: './src/' }
        ]
      }),
      typescript({
        tsconfig: './tsconfig.build.json'
      }),
      tscAlias(),
      // terser({
      //   format: {
      //     comments: true
      //   }
      // }),
      filesize(),
      json()
    ]
  },
  {
    input: 'src/index.ts',
    output: [{ file: 'dist/index.d.ts', format: 'es' }],
    plugins: [
      dts.default({
        compilerOptions: {
          emitDeclarationOnly: true,
          resolveJsonModule: true,
          declaration: true,
          declarationDir: null,
          composite: false
        },
        outputAsModuleFolder: false,
        tsconfig: './tsconfig.build.json'
      })
    ]
  }
];
