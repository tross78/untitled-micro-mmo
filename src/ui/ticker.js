import { seededRNG, hashStr } from '../rules/index.js';
import { CORPORA } from '../content/data.js';
import { generateSentence } from '../engine/markov.js';

export const startTicker = (worldState, onTick) => {
    const updateTicker = () => {
        if (!worldState.seed) return;
        const interval = Math.floor(Date.now() / 30000);
        const rng = seededRNG(hashStr(worldState.seed + interval + 'ticker'));
        const msg = generateSentence(CORPORA.ticker, rng);
        if (onTick) onTick(msg);
    };
    updateTicker();
    setInterval(updateTicker, 30000);
};
