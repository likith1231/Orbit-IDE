// Test files share one database and clear tables in their setup, so they must not run in parallel.
module.exports = { preset: 'ts-jest', testEnvironment: 'node', testMatch: ['**/tests/**/*.test.ts'], clearMocks: true, moduleFileExtensions: ['js', 'ts', 'json', 'node'], maxWorkers: 1 };
