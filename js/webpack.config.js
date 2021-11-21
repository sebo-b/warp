
const path = require('path');
const fsp = require('fs/promises');

const TerserPlugin = require("terser-webpack-plugin");
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

const warpDir = path.resolve(__dirname, '../warp');
const outputDir = path.join(warpDir,'static/dist');
const htmlOutputDir = path.join(warpDir,'templates/headers');

async function generateConfig() {

  async function removeFiles(dir) {

    let p = [];
    try {
      const files = await fsp.readdir(dir,{withFileTypes:true});
      for (const f of files) {
        if (f.isFile()) {
          let fn = path.join(dir,f.name);
          console.log(`Removing: ${fn}`);
          p.push(fsp.unlink(fn));
        }
      }
    } catch (err) {
      console.error(err);
    }

    return Promise.all(p);
  }

  // do not use {clean: true} option in webpack config
  // as we write from multiple entries to the same dir
  await Promise.all([
    removeFiles(outputDir),
    removeFiles(htmlOutputDir)
  ]);

  function createHtmlWebpackPlugin(chunkName) {

    return new HtmlWebpackPlugin({
      filename: path.join(htmlOutputDir, chunkName+'.html'),
      publicPath: '/static/dist',
      minify: true,
      chunks: [chunkName],
      inject: false,
      templateContent: (v) => v.htmlWebpackPlugin.tags.headTags.toString(),
    });

  }

  let config = [
    {
      entry: {},
      mode: 'production',
      output: {
        path: outputDir,
        filename: '[name].[contenthash].js',
  //      clean: true,
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
      ],
    },
    {
      entry: {
        base: './base/base.js',
      },
      mode: 'production',
      output: {
        path: outputDir,
        filename: '[name].[contenthash].js',
      },
      optimization: {
        moduleIds: 'deterministic',
        minimize: true,
        minimizer: [new TerserPlugin()],
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
      ]
    }
  ]

  async function fillConfig(config,directory) {

    directory = path.resolve(directory);

    try {
      const files = await fsp.readdir(directory,{withFileTypes:true});
      for (const f of files) {
        if (f.isFile() && f.name.endsWith('.js')) {
          let chunk = f.name.slice(0,-3);
          config.entry[chunk] = path.join(directory, f.name);
          config.plugins.push(createHtmlWebpackPlugin(chunk));
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  await fillConfig(config[0],'views');

  return config;
}

module.exports = generateConfig();
