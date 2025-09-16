const filesize = require('rollup-plugin-filesize');
const typescript = require('rollup-plugin-typescript2');
const dts = require('rollup-plugin-dts');
const tscAlias = require('rollup-plugin-tsc-alias');
const json = require('@rollup/plugin-json');
const alias = require('@rollup/plugin-alias');
const { terser } = require('rollup-plugin-terser');
const pkg = require('./package.json');

// 获取所有依赖作为external，但排除tslib（需要内联helper函数）
const external = [
  ...Object.keys(pkg.dependencies || {}).filter(dep => dep !== 'tslib'),
  ...Object.keys(pkg.peerDependencies || {}),
  // Node.js内置模块
  'fs', 'path', 'os', 'crypto', 'util', 'events', 'stream', 'http', 'https', 'net', 'dgram', 'perf_hooks', 'zlib', 'v8'
];

module.exports = [
  {
    input: './src/index.ts',
    external,
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
      terser({
        format: {
          comments: false
        },
        compress: {
          drop_console: false,
          drop_debugger: true,
          pure_funcs: ['console.log']
        },
        mangle: {
          reserved: ['Star', 'Service', 'Context']
        }
      }),
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
