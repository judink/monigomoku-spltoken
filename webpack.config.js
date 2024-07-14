const webpack = require('webpack');

module.exports = {
  // ... 기타 설정 ...
  resolve: {
    fallback: {
      assert: require.resolve('assert/'),
    },
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: 'process/browser',
    }),
  ],
};
