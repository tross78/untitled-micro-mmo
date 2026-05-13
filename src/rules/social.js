import { NPCS, CORPORA, ITEMS } from '../content/data.js';
import { generateSentence } from '../engine/markov.js';
import { seededRNG, hashStr } from './utils.js';
import { getTimeOfDay } from './world.js';

export function getNPCLocation(npcId, worldSeed, day) {
    const npc = NPCS[npcId];
    if (!npc) return null;
    if (!npc.patrol) return npc.home;
    const rng = seededRNG(hashStr(worldSeed + npcId + day));
    const patrolArray = Array.isArray(npc.patrol) ? [npc.home, ...npc.patrol] : [npc.home];
    return patrolArray[rng(patrolArray.length)];
}

// 8.6c: contextual line pools keyed by world-state tag
const EVENT_LINES = {
    market_surplus: {
        barkeep:  "The market is practically giving things away today — stock up while you can.",
        merchant: "Prices are low today! A surplus hit the supply lines. Fill your pack.",
        shop:     "Abundance in the market means I can offer better deals. What do you need?",
        guard:    "Even I'm tempted to buy something with the market this cheap.",
        sage:     "Abundance is its own kind of omen. Something caused this surplus.",
        bard:     "They say fortune favours the prepared. Today, fortune favours everyone.",
    },
    scarcity_spike: {
        barkeep:  "Can't get supplies in — roads are blocked or something. Prices are up.",
        merchant: "Slim pickings today. What I have left won't last long at these prices.",
        shop:     "Supplies are tight. I've had to raise prices to keep the doors open.",
        guard:    "Shortages breed desperation. Keep your pack close and your hand on your sword.",
        sage:     "Scarcity is the world reminding us that nothing lasts.",
        bard:     "I sing of want, of empty shelves, and merchants with hungry eyes.",
    },
    bounty_hunt: {
        barkeep:  "The Guard's paying triple for bandit masks today. Saw the notice myself.",
        merchant: "If you've got contraband, the Guard wants it — and they're paying well.",
        guard:    "Bring me what the bandits stole. Today I'm authorised to pay generously.",
        quest:    "The Guard has posted a bounty. Check the notices if you're looking for extra gold.",
        sage:     "Justice has a price today. Whether that is wisdom, I cannot say.",
        bard:     "A bounty is posted. Heroes and opportunists alike will answer.",
    },
    wolf_pack: {
        barkeep:  "More howling than usual last night. Stay in groups if you head to the forest.",
        merchant: "Wolf pelts are worth more today — there's a pack out there.",
        guard:    "Wolf pack spotted near the forest edge. Extra patrols tonight.",
        sage:     "The pack hunts as one. There is a lesson there, if you can survive it.",
        bard:     "I composed a dirge last night as the wolves sang outside.",
    },
    ancient_tremor: {
        barkeep:  "Did you feel that shaking? Came from underground. Unsettling.",
        merchant: "Something stirred in the deep. I'm keeping the back door locked.",
        guard:    "The catacombs are active. Do not go down there unless you're armoured.",
        sage:     "A tremor from the old world. The ancient power below is restless.",
        bard:     "The earth trembled. Even stones know when the old things awaken.",
    },
    wandering_boss: {
        barkeep:  "Someone said they saw a mountain troll near the ruins. Don't go alone.",
        merchant: "I'm closing up early — there's something big out there.",
        guard:    "All civilians stay indoors. There's a creature abroad tonight.",
        sage:     "It comes from the peaks when the threat grows great enough. Pray it passes.",
        bard:     "I have a ballad about the wandering troll. I'll save it for after you survive.",
    },
    wandering_trader: {
        barkeep:  "There's a trader I've never seen before set up near the crossroads.",
        merchant: "Competition today — a wandering trader showed up with unusual stock.",
        guard:    "Unknown trader in town. Keep an eye on them.",
        sage:     "Strangers bring knowledge. And sometimes, danger. Often both.",
        bard:     "I bartered a song for a curiosity from the wandering trader. Worth it.",
    },
};

const WEATHER_LINES = {
    storm: {
        barkeep:  "Nasty weather out there. Stay inside, have another drink.",
        merchant: "Few customers in this storm. Can Blame them.",
        shop:     "The rain is keeping the crowds away. Perfect time for some quiet browsing.",
        guard:    "Storm's making the rounds miserable tonight. Watch your footing.",
        sage:     "The storm speaks of change. Whether for better or worse, I cannot say.",
        bard:     "Thunder is nature's percussion. I find it inspiring, if damp.",
    },
    fog: {
        barkeep:  "Thick fog tonight. Wolves move in fog — stay on the path.",
        merchant: "Can't see past the square in this fog. Trade is slow.",
        shop:     "Quiet day. The fog has swallowed the market.",
        guard:    "Visibility is near zero out there. Be careful.",
        sage:     "Fog obscures more than the eye. The mind also loses its footing in it.",
        bard:     "The fog muffles my lute's sound, but not its feeling.",
    },
};

// 8.6c: template interpolation for ${season}, ${day}, ${scarcityItem}, etc.
function interpolate(line, ctx) {
    return line.replace(/\$\{(\w+)\}/g, (_, k) => ctx[k] ?? _);
}

export function getNPCDialogue(npcId, worldSeed, day, mood, playerLocation, worldState, localPlayer) {
    const npc = NPCS[npcId];
    if (!npc) return "";

    // Location-aware warning dialogue takes priority
    if (playerLocation && npc.locationDialogue?.[playerLocation]) {
        return npc.locationDialogue[playerLocation];
    }

    const rng = seededRNG(hashStr(worldSeed + npcId + day + 'markov'));

    // 8.6c: contextual line — event takes priority, then weather, then mood, then base corpus
    const role = npc.role || npcId;
    
    // 8.75b: Template string interpolation
    const scarcityItem = worldState?.scarcity?.[0] ? (ITEMS[worldState.scarcity[0]]?.name || worldState.scarcity[0]) : 'goods';
    const surplusItem = worldState?.surplus?.[0] ? (ITEMS[worldState.surplus[0]]?.name || worldState.surplus[0]) : 'goods';
    const playerName = localPlayer?.ph ? `Traveler ${localPlayer.ph.substring(0, 4)}` : 'Friend';

    const ctx = {
        season: worldState?.season || '',
        day: String(day),
        scarcityItem,
        surplusItem,
        playerName
    };

    const eventType = worldState?.event?.type;
    const eventLine = eventType && (EVENT_LINES[eventType]?.[npcId] || EVENT_LINES[eventType]?.[role]);
    if (eventLine) {
        return interpolate(eventLine, ctx);
    }

    const weather = worldState?.weather;
    const weatherLine = weather && weather !== 'clear' && (WEATHER_LINES[weather]?.[npcId] || WEATHER_LINES[weather]?.[role]);
    if (weatherLine) {
        return interpolate(weatherLine, ctx);
    }

    // 8.75a, 8.75c, 8.75d: Contextual corpus tagging and Richer corpora
    const npcCorpus = CORPORA[npcId] || CORPORA[role] || CORPORA['sage'];
    let selectedPool = Array.isArray(npcCorpus) ? npcCorpus : (npcCorpus.base || []);

    if (!Array.isArray(npcCorpus)) {
        // Priority: post_quest > time_night > scarcity/surplus > season > base
        let questOverride = false;
        
        if (localPlayer?.quests) {
            const completedTags = Object.keys(npcCorpus).filter(k => k.startsWith('post_quest_'));
            for (const tag of completedTags) {
                const qid = tag.replace('post_quest_', '');
                if (localPlayer.quests[qid]?.completed && npcCorpus[tag] && npcCorpus[tag].length > 0) {
                    selectedPool = npcCorpus[tag];
                    questOverride = true;
                    break;
                }
            }
        }
        
        if (!questOverride) {
            const timeOfDay = getTimeOfDay();
            const hasScarcity = worldState?.scarcity?.length > 0;
            const hasSurplus = worldState?.surplus?.length > 0;
            const season = worldState?.season;

            if (timeOfDay === 'night' && npcCorpus.time_night?.length > 0) {
                selectedPool = npcCorpus.time_night;
            } else if (hasScarcity && npcCorpus.scarcity?.length > 0) {
                selectedPool = npcCorpus.scarcity;
            } else if (hasSurplus && npcCorpus.surplus?.length > 0) {
                selectedPool = npcCorpus.surplus;
            } else if (season && npcCorpus[`season_${season}`]?.length > 0) {
                selectedPool = npcCorpus[`season_${season}`];
            }
        }
    }

    const generated = generateSentence(selectedPool, rng);
    return interpolate(generated, ctx);
}
