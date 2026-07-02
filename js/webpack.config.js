
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
      await fsp.mkdir(dir, {recursive: true});
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

  const config = {
    // 'app' boots the SPA shell (logged-in pages, client-side routed);
    // 'public' is the small bundle for the server-rendered pages that stay
    // outside the SPA (login, auth error, ical action). Per-view chunks are
    // NOT separate entries — routes.js dynamic-import()s them, and
    // splitChunks below lets webpack name/split those chunks automatically.
    entry: {
      app: './app/main.js',
      public: './base/public.js',
    },
    mode: 'production',
    output: {
      path: outputDir,
      filename: '[name].[contenthash].js',
      chunkFilename: '[name].[contenthash].js',
      publicPath: '',   // runtime publicPath is set from warpGlobals.URLs.distBase (app/publicPath.js) — mount-prefix-safe
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
          test: /\.css$/i,
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
          ],
        },
        {
          // View markup fragments (js/views/html/*.html): raw source, not
          // parsed as an HTML module — router.js sets it via root.innerHTML.
          test: /views[\\/]html[\\/].*\.html$/,
          type: 'asset/source',
        },
      ],
    },
    plugins: [
      new MiniCssExtractPlugin({
        filename: "[name].[contenthash].css",
      }),
      createHtmlWebpackPlugin('app'),
      createHtmlWebpackPlugin('public'),
    ],
  };

  return config;
}

module.exports = generateConfig();
