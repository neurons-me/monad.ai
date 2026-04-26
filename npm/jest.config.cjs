module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: [
    "<rootDir>/tests/**/*.test.ts",
    "<rootDir>/tests/**/*.test.js"
  ],
  moduleNameMapper: {
    "^(\\.{1,2}/.+)\\.js$": "$1"
  },
  setupFiles: ["<rootDir>/tests/setup.ts"],
  verbose: true
};
