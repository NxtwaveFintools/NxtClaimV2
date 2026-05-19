/* eslint-disable @typescript-eslint/no-require-imports */
const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

const customJestConfig = {
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["<rootDir>/tests/unit/**/*.test.(ts|tsx)", "<rootDir>/src/**/*.test.(ts|tsx)"],
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/tests/integration/"],
};

module.exports = createJestConfig(customJestConfig);
