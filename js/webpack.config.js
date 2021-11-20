
const path = require('path');
const fs = require('fs');

const TerserPlugin = require("terser-webpack-plugin");
const HtmlWebpackPlugin = require('html-webpack-plugin');

const warpDir = path.resolve(__dirname, '../warp');

let config = [
  {
    entry: {},
    mode: 'production',
    output: {
      path: path.join(warpDir,'static/js'),
      filename: '[name].[contenthash].js',
      clean: true,
    },
    optimization: {
      moduleIds: 'deterministic',
      runtimeChunk: {
        name: 'webpack_runtime',
      },
      minimize: true,
      minimizer: [new TerserPlugin()],
      splitChunks: {
        chunks: 'all',
        minChunks: 2,
        minSize: 0,
        minSizeReduction: 0,
      },
    },
    plugins: [],
  },
]

function fillConfig(config,directory) {

  directory = path.resolve(directory);
  const outputDir = path.join(warpDir,'templates/headers');

  fs.readdirSync(directory,{withFileTypes:true}).forEach( (e) => {

    if (e.isFile() && e.name.endsWith('.js')) {

      let chunk = e.name.slice(0,-3);

      config.entry[chunk] = path.join(directory, e.name);
      config.plugins.push(
        new HtmlWebpackPlugin({
          filename: path.join(outputDir, chunk+'.html'),
          publicPath: '/static/js',
          minify: false,
          chunks: [chunk],
          inject: false,
          templateContent: (v) => v.htmlWebpackPlugin.tags.headTags.toString(),
        }),
      )
    }
  });
};

fillConfig(config[0],'views');

module.exports = config;
