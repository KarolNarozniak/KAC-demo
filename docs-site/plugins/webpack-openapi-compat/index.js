module.exports = function webpackOpenApiCompatibility() {
  return {
    name: 'kac-openapi-webpack-compatibility',
    configureWebpack() {
      // The OpenAPI theme ships CommonJS modules that Webpack cannot safely concatenate.
      return { optimization: { concatenateModules: false } };
    },
  };
};
