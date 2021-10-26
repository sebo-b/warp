const TerserPlugin = require("terser-webpack-plugin");

module.exports = {
  entry: './index.js',
  mode: 'production',
  output: {
	  path: `${__dirname}/../../warp/static/i18n/`,
	  filename: 'warp_i18n.min.js',
  },
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin()],
  },
  module: {
	rules: [
        {
            test: /\.js$/,
            exclude: /node_modules/,
            use: {
                loader: 'babel-loader',
                options: {
                  presets: [
                    ['@babel/preset-env', { targets: "defaults" }]
                  ],
                },
            },
        },
    ],
  },
}
