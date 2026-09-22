const path = require('node:path')
const { WormaDocsWebpackPlugin } = require('../dist/webpack.cjs')

module.exports = {
  mode: 'production',
  context: __dirname,
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'main.js',
    clean: true,
  },
  plugins: [
    new WormaDocsWebpackPlugin({
      swagger: 'https://petstore3.swagger.io/api/v3/openapi.json',
      output: 'aidocs',
      tags: ['pet'],
    }),
  ],
}
