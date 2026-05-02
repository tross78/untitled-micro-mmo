import { defineQuest } from '../define.js';

export const QUESTS = {
    // The Militia Chain (Guard)
    find_tavern: defineQuest('find_tavern', {
        id: 'find_tavern', name: 'Find the Tavern', giver: 'guard', receiver: null, type: 'explore',
        description: 'Head to the Rusty Flagon Tavern.', lore: 'The Guard suggests getting your bearings at the local watering hole.',
        objective: { type: 'explore', target: 'tavern' }, prerequisite: null,
        reward: { xp: 10, gold: 0, item: 'potion' }, chain: 'militia'
    }),
    wolf_hunt: defineQuest('wolf_hunt', {
        id: 'wolf_hunt', name: 'Wolf Hunt', giver: 'guard', receiver: 'guard', type: 'kill',
        description: 'Cull 3 wolves from the Forest Edge.', lore: 'The Guard grumbles about wolf attacks on travelers.',
        objective: { type: 'kill', target: 'forest_wolf', count: 3 }, prerequisite: 'find_tavern',
        reward: { xp: 50, gold: 20 }, chain: 'militia'
    }),
    bandit_sweep: defineQuest('bandit_sweep', {
        id: 'bandit_sweep', name: 'Bandit Sweep', giver: 'guard', receiver: 'guard', type: 'kill',
        description: 'Slay 5 bandits at the Bandit Camp.', lore: 'The Guard needs the roads cleared of bandit filth.',
        objective: { type: 'kill', target: 'bandit', count: 5 }, prerequisite: 'wolf_hunt',
        reward: { xp: 100, gold: 40, item: 'bandit_mask' }, chain: 'militia'
    }),
    cave_troll_bounty: defineQuest('cave_troll_bounty', {
        id: 'cave_troll_bounty', name: 'Cave Troll Bounty', giver: 'guard', receiver: 'guard', type: 'kill',
        description: 'Slay the Cave Troll.', lore: 'A massive troll is blocking the southern passage.',
        objective: { type: 'kill', target: 'cave_troll', count: 1 }, prerequisite: 'bandit_sweep',
        reward: { xp: 150, gold: 50, item: 'iron_armor' }, chain: 'militia'
    }),
    // The Scholar Chain (Sage)
    ruins_survey: defineQuest('ruins_survey', {
        id: 'ruins_survey', name: 'Ruins Survey', giver: 'sage', receiver: 'sage', type: 'explore',
        description: 'Visit the Old Ruins.', lore: 'The Sage wants to know if the shadows are moving.',
        objective: { type: 'explore', target: 'ruins' }, prerequisite: null,
        reward: { xp: 20, gold: 0, item: 'old_tome' }, chain: 'scholar'
    }),
    tome_collection: defineQuest('tome_collection', {
        id: 'tome_collection', name: 'Tome Collection', giver: 'sage', receiver: 'sage', type: 'fetch',
        description: 'Bring 2 old tomes to the Sage.', lore: 'Knowledge is scattered among the dust of the ruins.',
        objective: { type: 'fetch', target: 'old_tome', count: 2 }, prerequisite: 'ruins_survey',
        reward: { xp: 60, gold: 0, item: 'magic_staff' }, chain: 'scholar'
    }),
    catacomb_delve: defineQuest('catacomb_delve', {
        id: 'catacomb_delve', name: 'Catacomb Delve', giver: 'sage', receiver: 'sage', type: 'explore',
        description: 'Reach the Catacombs.', lore: 'The deeper ruins hold secrets from a forgotten age.',
        objective: { type: 'explore', target: 'catacombs' }, prerequisite: 'tome_collection',
        reward: { xp: 80, gold: 30 }, chain: 'scholar'
    }),
    wraith_banish: defineQuest('wraith_banish', {
        id: 'wraith_banish', name: 'Wraith Banishment', giver: 'sage', receiver: 'sage', type: 'kill',
        description: 'Banish the Wraith in the Catacombs.', lore: 'A powerful spirit guards the lowest depths.',
        objective: { type: 'kill', target: 'wraith', count: 1 }, prerequisite: 'catacomb_delve',
        reward: { xp: 200, gold: 50 }, chain: 'scholar'
    }),
    // The Trade Chain (Merchant)
    gather_wood: defineQuest('gather_wood', {
        id: 'gather_wood', name: 'Gather Wood', giver: 'merchant', receiver: 'merchant', type: 'fetch',
        description: 'Gather 5 wood bundles.', lore: 'The Market needs fuel for the coming season.',
        objective: { type: 'fetch', target: 'wood', count: 5 }, prerequisite: null,
        reward: { xp: 25, gold: 15 }, chain: 'trade'
    }),
    iron_supply: defineQuest('iron_supply', {
        id: 'iron_supply', name: 'Iron Supply', giver: 'merchant', receiver: 'merchant', type: 'fetch',
        description: 'Gather 3 iron ore.', lore: 'We need raw materials for new tools and weapons.',
        objective: { type: 'fetch', target: 'iron', count: 3 }, prerequisite: 'gather_wood',
        reward: { xp: 35, gold: 20 }, chain: 'trade'
    }),
    craft_sword: defineQuest('craft_sword', {
        id: 'craft_sword', name: 'Sword Crafting', giver: 'merchant', receiver: 'merchant', type: 'craft',
        description: 'Craft an iron sword at the Market.', lore: 'It is time you learned to forge your own path.',
        objective: { type: 'craft', target: 'iron_sword', count: 1 }, prerequisite: 'iron_supply',
        reward: { xp: 50, gold: 0, item: 'iron_sword' }, chain: 'trade'
    }),
    market_recovery: defineQuest('market_recovery', {
        id: 'market_recovery', name: 'Market Recovery', giver: 'merchant', receiver: 'merchant', type: 'deliver',
        description: 'Sell 3 items to the Merchant.', lore: 'Keep the trade flowing in Hearthwick.',
        objective: { type: 'deliver', target: 'merchant', count: 3 }, prerequisite: 'craft_sword',
        reward: { xp: 40, gold: 25 }, chain: 'trade'
    }),
    // Barkeep's Requests
    tavern_regular: defineQuest('tavern_regular', {
        id: 'tavern_regular', name: 'Tavern Regular', giver: 'barkeep', receiver: 'barkeep', type: 'rest',
        description: 'Rest at the Tavern 3 separate days.', lore: 'A good adventurer knows the value of a warm bed.',
        objective: { type: 'rest', count: 3 }, prerequisite: null,
        reward: { xp: 20, gold: 0, item: 'ale' }, chain: 'barkeep'
    }),
    courier_run: defineQuest('courier_run', {
        id: 'courier_run', name: 'Courier Run', giver: 'barkeep', receiver: 'sage', type: 'deliver',
        description: 'Bring an ale to the Sage at the Ruins.', lore: 'The Sage hasn\'t visited in days. Bring him some cheer.',
        objective: { type: 'deliver', target: 'ale', count: 1 }, prerequisite: null,
        reward: { xp: 30, gold: 0, item: 'potion' }, chain: 'barkeep'
    }),
    mountain_trial: defineQuest('mountain_trial', {
        id: 'mountain_trial', name: 'Mountain Trial', giver: 'barkeep', receiver: 'barkeep', type: 'kill',
        description: 'Reach the Mountain Pass and survive a Mountain Troll.', lore: 'Only the bravest dare the northern heights.',
        objective: { type: 'kill', target: 'mountain_troll', count: 1 }, prerequisite: 'cave_troll_bounty',
        reward: { xp: 300, gold: 75, item: 'steel_sword' }, chain: 'barkeep'
    })
};
