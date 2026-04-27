export const joinRoom = jest.fn(() => ({
  onPeerJoin: jest.fn(),
  onPeerLeave: jest.fn(),
  makeAction: jest.fn(() => [jest.fn(), jest.fn()]),
  getPeers: jest.fn(() => ({})),
  leave: jest.fn()
}));

export const selfId = 'test-self-id';
