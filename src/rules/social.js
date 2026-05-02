import { NPCS, CORPORA } from '../engine/data.js';
import { generateSentence } from '../engine/markov.js';
import { seededRNG, hashStr } from './utils.js';

export function getNPCLocation(npcId, worldSeed, day) {
    const npc = NPCS[npcId];
    if (!npc) return null;
    if (!npc.patrol) return npc.home;
    const rng = seededRNG(hashStr(worldSeed + npcId + day));
    const patrolArray = Array.isArray(npc.patrol) ? [npc.home, ...npc.patrol] : [npc.home];
    return patrolArray[rng(patrolArray.length)];
}

export function getNPCDialogue(npcId, worldSeed, day, _mood) {
    const npc = NPCS[npcId];
    if (!npc) return "";
    
    const rng = seededRNG(hashStr(worldSeed + npcId + day + 'markov'));
    const corpus = CORPORA[npcId] || CORPORA[npc.role] || CORPORA['sage'];
    return generateSentence(corpus, rng);
}
