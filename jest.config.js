export default {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  roots: ['<rootDir>/src'],
  testMatch: ['**/tests/**/*.test.js'],
  transform: {
    '^.+\\.jsx?$': 'babel-jest',
  },
  moduleNameMapper: {
    '^@trystero-p2p/nostr$': '<rootDir>/src/__mocks__/@trystero-p2p/nostr.js',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!@trystero-p2p|@google/gemini-cli|@trystero-p2p/core)/',
  ],
};
