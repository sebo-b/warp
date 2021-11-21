
const path = require('path');
const fs = require('fs');

const TerserPlugin = require("terser-webpack-plugin");
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

const warpDir = path.resolve(__dirname, '../warp');

function createHtmlWebpackPlugin(chunkName) {

  const outputDir = path.join(warpDir,'templates/headers');

  return new HtmlWebpackPlugin({
    filename: path.join(outputDir, chunkName+'.html'),
    publicPath: '/static/dist',
    minify: false,
    chunks: [chunkName],
    inject: false,
    templateContent: (v) => v.htmlWebpackPlugin.tags.headTags.toString(),
  });

}

let config = [
  {
    entry: {
      base: './base/base.js',
    },
    mode: 'production',
    output: {
      path: path.join(warpDir,'static/dist'),
      filename: '[name].[contenthash].js',
      clean: true,
    },
    performance: {
      maxEntrypointSize: 400000,
      maxAssetSize: 400000
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
    module: {
      rules: [
        {
          test: /\.(s[ac]ss|css)$/i,
          use: [
            MiniCssExtractPlugin.loader,
            "css-loader",
            {
              loader: "postcss-loader",
              options: {
                postcssOptions: {
                  plugins: [ "postcss-preset-env", "cssnano" ],
                }
              }
            },
            "sass-loader",
          ],
        },
      ],
    },
    plugins: [
      new MiniCssExtractPlugin({
        filename: "[name].[contenthash].css",
      }),
      createHtmlWebpackPlugin('base'),
    ],
  },
]

function fillConfig(config,directory) {

  directory = path.resolve(directory);


  fs.readdirSync(directory,{withFileTypes:true}).forEach( (e) => {

    if (e.isFile() && e.name.endsWith('.js')) {
      let chunk = e.name.slice(0,-3);
      config.entry[chunk] = path.join(directory, e.name);
      config.plugins.push(createHtmlWebpackPlugin(chunk));
    }
  });
};

fillConfig(config[0],'views');

module.exports = config;
