import * as torrent from '@trystero-p2p/torrent';

const getTransport = () => globalThis.__HEARTHWICK_TRANSPORT__ || torrent;

export const selfId = getTransport().selfId;
export const joinRoom = (...args) => getTransport().joinRoom(...args);
