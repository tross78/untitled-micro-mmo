// Hand-authored 16×16 character sprites in the 5-role grayscale palette.
// Digits: 0 transparent, 1 outline, 2 secondary, 3 primary, 4 accent, 5 shadow.
// Consumed by scripts/gen-animation-frames.js, which writes the source PNGs
// that assets:compile turns into runtime modules. Real colors come from each
// character's role palette at render time.
//
// Style anchor: front-facing chibi — large round head (~ rows 0-7), short
// stout body (rows 8-13), feet on rows 14-15, ~1:1 head-to-body ratio.

/** Copy a base grid, replacing the given rows: edits = [[rowIndex, '16chars'], …] */
const v = (base, edits) => {
    const g = [...base];
    for (const [row, str] of edits) g[row] = str;
    return g;
};

// ---------------------------------------------------------------------------
// NPCs (front-facing only — NPC rendering has no directional variants)
// ---------------------------------------------------------------------------

// Watchman — hooded sentry: deep hood, leather jerkin, spear in right hand
// (white tip, dark shaft, gripped at row 9), lantern hanging at the left hip.
const WATCHMAN = [
    '0000000000004000',
    '0000011110004000',
    '0000122221005000',
    '0001222222105000',
    '0001231132105000',
    '0001233332105000',
    '0000123321005000',
    '0000011110005000',
    '0001222221005000',
    '0012233221151000',
    '0001553355105000',
    '0014153351005000',
    '0041155551005000',
    '0001115511101000',
    '0000115511000000',
    '0000011011000000',
];

// Miller Bram — flat cap, flour-white apron, grain sack on the left shoulder.
const MILLER = [
    '0000000000000000',
    '0000111111000000',
    '0001333333100000',
    '0000113311220000',
    '0001311131221000',
    '0001333331122000',
    '0001533351012000',
    '0000113311001000',
    '0001253352100000',
    '0012344443210000',
    '0013144441310000',
    '0001344443100000',
    '0001144441100000',
    '0000114411000000',
    '0000115511000000',
    '0000011011000000',
];

// Archivist — round spectacles, scholarly robe, thick open book held out front.
const ARCHIVIST = [
    '0000000000000000',
    '0000011110000000',
    '0000133331000000',
    '0001333333100000',
    '0001414141100000',
    '0001333333100000',
    '0001533351000000',
    '0000113311000000',
    '0001222222100000',
    '0012225222210000',
    '0112222222211000',
    '1441444441441000',
    '1444444444441000',
    '0111122221111000',
    '0000125521000000',
    '0000011011000000',
];

// Old Fisher is a conformed RD-sourced sprite (see MULTI_PALETTES.fisherman);
// assets/source/npcs/fisherman.png is checked in directly, not generated here.

// Grocer — headscarf, apron, basket of produce held in front.
const GROCER = [
    '0000000000000000',
    '0000012210000000',
    '0000122221000000',
    '0001222222100000',
    '0001231132100000',
    '0001333333100000',
    '0001533351000000',
    '0000113311000000',
    '0001233332100000',
    '0012334433210000',
    '0013143341310000',
    '0001124211100000',
    '0001122211000000',
    '0000114411000000',
    '0000115511000000',
    '0000011011000000',
];

// Town Crier — tricorn hat, tabard, hand-bell raised right, scroll at left.
const TOWN_CRIER = [
    '0000000000000000',
    '0001111111000140',
    '0012222222100141',
    '0001333333100410',
    '0001311131101410',
    '0001333333101100',
    '0001533351000000',
    '0000113311000000',
    '0001244442110000',
    '0012424242421000',
    '0013444444131000',
    '0441344443100000',
    '0441134431100000',
    '0110114411000000',
    '0000115511000000',
    '0000011011000000',
];

// ---------------------------------------------------------------------------
// Enemies — base, _back, _side, _attack. The renderer mirrors side art for
// west-facing movement, so side sprites face east (right).
// ---------------------------------------------------------------------------

// Goblin — small and hunched: big pointed ears, wide grin, crude dagger.
const GOBLIN = [
    '0000000000000000',
    '0000000000000000',
    '0000000000000000',
    '0010011110010000',
    '0110133331011000',
    '0121333333121000',
    '0011351153110000',
    '0001333333100000',
    '0001314413100000',
    '0000133331000000',
    '0000123321040000',
    '0001233332141000',
    '0012133312410000',
    '0001122211100000',
    '0000110011000000',
    '0000110011000000',
];
const GOBLIN_BACK = v(GOBLIN, [
    [6, '0011333333110000'],
    [7, '0001333333100000'],
    [8, '0001335533100000'],
    [10, '0000123321000000'],
    [11, '0001233332100000'],
    [12, '0001233332100000'],
]);
const GOBLIN_SIDE = v(GOBLIN, [
    [3, '0000011110100000'],
    [4, '0000133331110000'],
    [5, '0001333333321000'],
    [6, '0001335133331000'],
    [7, '0001333333110000'],
    [8, '0001331441100000'],
    [10, '0000123321400000'],
    [11, '0001233332410000'],
    [12, '0001213331100000'],
]);
const GOBLIN_ATTACK = v(GOBLIN, [
    [10, '0000123321440000'],
    [11, '0001233321410000'],
    [12, '0012133314100000'],
]);

// Bandit — bandana mask over the lower face, leather vest, knife held low.
const BANDIT = [
    '0000000000000000',
    '0000000000000000',
    '0000011110000000',
    '0000155551000000',
    '0001533335100000',
    '0001311131100000',
    '0001222222100000',
    '0000122221000000',
    '0001255552100000',
    '0012523325210000',
    '0013522253100000',
    '0001522251040000',
    '0001152511141000',
    '0000115511010000',
    '0000115511000000',
    '0000011011000000',
];
const BANDIT_BACK = v(BANDIT, [
    [4, '0001555555100000'],
    [5, '0001555555100000'],
    [6, '0001225222100000'],
    [11, '0001522251000000'],
    [12, '0001152511100000'],
    [13, '0000115511000000'],
]);
const BANDIT_SIDE = v(BANDIT, [
    [3, '0000155551000000'],
    [4, '0001533333510000'],
    [5, '0001333133110000'],
    [6, '0001222222210000'],
    [9, '0012523325410000'],
    [10, '0013522253141000'],
    [11, '0001522251010000'],
]);
const BANDIT_ATTACK = v(BANDIT, [
    [8, '0001255552144000'],
    [9, '0012523325441000'],
    [10, '0013522253410000'],
    [11, '0001522251100000'],
    [12, '0001152511000000'],
]);

// Skeleton — white skull with dark sockets, narrow ribcage with shadow ribs,
// separated bone legs, sword held vertically at the right side.
const SKELETON = [
    '0000000000000000',
    '0000011110000000',
    '0000144441000000',
    '0001444444100000',
    '0001414414100000',
    '0001444444100000',
    '0000144441000000',
    '0000115511004000',
    '0000144441002000',
    '0001454454102000',
    '0001454454102000',
    '0000144441012000',
    '0000115511121000',
    '0000141141010000',
    '0000141141000000',
    '0000110011000000',
];
const SKELETON_BACK = v(SKELETON, [
    [4, '0001444444100000'],
    [9, '0001445444102000'],
    [10, '0001445444102000'],
]);
const SKELETON_SIDE = v(SKELETON, [
    [4, '0001444414100000'],
    [5, '0001444444410000'],
]);
const SKELETON_ATTACK = v(SKELETON, [
    [7, '0000115511000040'],
    [8, '0000144441000400'],
    [9, '0001454454104000'],
    [10, '0001454454140000'],
    [11, '0000144441410000'],
    [12, '0000115511100000'],
]);

// Ruin Shade — hooded shroud of darkness: glowing eyes, ragged floating hem.
const RUIN_SHADE = [
    '0000000000000000',
    '0000011110000000',
    '0000155551000000',
    '0001555555100000',
    '0001541145100000',
    '0001555555100000',
    '0001555555100000',
    '0001255552100000',
    '0001555555100000',
    '0012555555210000',
    '0015555555510000',
    '0015525525510000',
    '0001505505100000',
    '0001105501100000',
    '0000100501000000',
    '0000000000000000',
];
const RUIN_SHADE_BACK = v(RUIN_SHADE, [
    [4, '0001555555100000'],
]);
const RUIN_SHADE_SIDE = v(RUIN_SHADE, [
    [4, '0001554114510000'],
]);
const RUIN_SHADE_ATTACK = v(RUIN_SHADE, [
    [4, '0001541145100000'],
    [8, '0011555555110000'],
    [9, '0125555555521000'],
    [10, '0155555555551000'],
]);

// Wraith — pale spectre: hollow eyes, trailing robe, hovers clear of the ground.
const WRAITH = [
    '0000011110000000',
    '0000133331000000',
    '0001333333100000',
    '0001311131100000',
    '0001333333100000',
    '0000133331000000',
    '0001233332100000',
    '0012333333210000',
    '0013233323310000',
    '0001333333100000',
    '0001323323100000',
    '0000132331000000',
    '0000131031000000',
    '0000010010000000',
    '0000000000000000',
    '0000000000000000',
];
const WRAITH_BACK = v(WRAITH, [
    [3, '0001333333100000'],
]);
const WRAITH_SIDE = v(WRAITH, [
    [3, '0001331133310000'],
]);
const WRAITH_ATTACK = v(WRAITH, [
    [6, '0011233332110000'],
    [7, '0123333333321000'],
    [8, '0133233323331000'],
]);

// Cave Troll — hulking and stooped: heavy knuckled arms, stone club right.
const CAVE_TROLL = [
    '0000000000000000',
    '0000000000000000',
    '0000111111000000',
    '0001333333100000',
    '0001311131100220',
    '0013333333310210',
    '0013533353312100',
    '0113333333112000',
    '1233333333321000',
    '1323333333231000',
    '1331233321331000',
    '0110123321011000',
    '0001233332100000',
    '0001133311000000',
    '0011501150110000',
    '0001100011000000',
];
const CAVE_TROLL_BACK = v(CAVE_TROLL, [
    [4, '0001333333100220'],
    [6, '0013335533312100'],
]);
const CAVE_TROLL_SIDE = v(CAVE_TROLL, [
    [3, '0001333333310000'],
    [4, '0001331133110220'],
    [5, '0013333333310210'],
    [6, '0013533533112100'],
]);
const CAVE_TROLL_ATTACK = v(CAVE_TROLL, [
    [2, '0001111110002200'],
    [3, '0013333331002100'],
    [4, '0013111311021000'],
    [5, '0133333333121000'],
    [6, '0135333533210000'],
    [7, '1133333331100000'],
]);

// Mountain Troll — bigger silhouette: boulder hump, jutting tusks, mossy hide.
const MOUNTAIN_TROLL = [
    '0000011111100000',
    '0001122222110000',
    '0012223222221000',
    '0012333333321000',
    '0013311311331000',
    '0013333333331000',
    '0013413314331000',
    '0113333333311200',
    '1223333333322120',
    '1332333333233210',
    '1333123332133100',
    '0110123332101100',
    '0001233333210000',
    '0001133331100000',
    '0011501150110000',
    '0001100011000000',
];
const MOUNTAIN_TROLL_BACK = v(MOUNTAIN_TROLL, [
    [4, '0013333333331000'],
    [6, '0013335533331000'],
]);
const MOUNTAIN_TROLL_SIDE = v(MOUNTAIN_TROLL, [
    [4, '0013331133310000'],
    [5, '0013333333331000'],
    [6, '0013353341431000'],
]);
const MOUNTAIN_TROLL_ATTACK = v(MOUNTAIN_TROLL, [
    [7, '0113333333311220'],
    [8, '1223333333322210'],
    [9, '1332333333233100'],
]);

// Giant Crab — wide shell, raised snapping claws, stalk eyes, splayed legs.
const CRAB = [
    '0000000000000000',
    '0000000000000000',
    '0000010010000000',
    '0000015510000000',
    '0110001100001100',
    '1331011110133100',
    '1313133331313100',
    '0113333333311000',
    '0013353353310000',
    '0133333333331000',
    '0131333333131000',
    '0011233332110000',
    '0101122211010000',
    '0110100101011000',
    '0000000000000000',
    '0000000000000000',
];
const CRAB_BACK = v(CRAB, [
    [2, '0000000000000000'],
    [3, '0000000000000000'],
    [8, '0013333333310000'],
]);
const CRAB_SIDE = v(CRAB, [
    [4, '0000001100011000'],
    [5, '0000011110133100'],
    [6, '0001133331313100'],
    [7, '0013333333311000'],
    [8, '0013335353310000'],
]);
const CRAB_ATTACK = v(CRAB, [
    [2, '0100010010001000'],
    [3, '1310015510013100'],
    [4, '1313001100013110'],
    [5, '0131011110131100'],
    [6, '0113133331311000'],
]);

// Throne Guardian — ancient sentinel: horned helm, full plate with a white
// chest sigil, greatsword planted point-down at its right side (our left).
const THRONE_GUARDIAN = [
    '0010000000000100',
    '0110011110000110',
    '0101122221101010',
    '0011222222110000',
    '0401241142100000',
    '0501222222100000',
    '1410122221000000',
    '0411244442100000',
    '0411232223210000',
    '0411322422310000',
    '0411322222310000',
    '0411152225110000',
    '0411122122110000',
    '0101122122100000',
    '0010115511000000',
    '0000011011000000',
];
const THRONE_GUARDIAN_BACK = v(THRONE_GUARDIAN, [
    [4, '0401222222100000'],
    [9, '0411322222310000'],
]);
const THRONE_GUARDIAN_SIDE = v(THRONE_GUARDIAN, [
    [4, '0401222114210000'],
]);
const THRONE_GUARDIAN_ATTACK = v(THRONE_GUARDIAN, [
    [4, '0001241142100040'],
    [5, '0001222222100400'],
    [6, '0010122221014000'],
    [7, '0001244442141000'],
    [8, '0012232223210000'],
    [9, '0013322422310000'],
    [10, '0013322222310000'],
    [11, '0001152225110000'],
    [12, '0001122122110000'],
    [13, '0001122122100000'],
    [14, '0000115511000000'],
]);

// Wolf — front view: pricked ears, dark eyes, white muzzle with dark nose,
// stout chest, forepaws planted.
const WOLF = [
    '0000000000000000',
    '0000000000000000',
    '0000110000110000',
    '0000121001210000',
    '0000122222210000',
    '0000122222210000',
    '0000121221210000',
    '0000124444210000',
    '0000124114210000',
    '0000012442100000',
    '0000122222210000',
    '0001222222221000',
    '0001222222221000',
    '0000121001210000',
    '0000121001210000',
    '0000110000110000',
];
const WOLF_BACK = v(WOLF, [
    [6, '0000122222210000'],
    [7, '0000122222210000'],
    [8, '0000125555210000'],
    [9, '0000012222100000'],
    [13, '0000121221210000'],
]);
// Side view — full quadruped profile facing east.
const WOLF_SIDE = [
    '0000000000000000',
    '0000000000000000',
    '0000000000000000',
    '0000000000110000',
    '0000000001121000',
    '0100000012221000',
    '1210001222221100',
    '1221122222512410',
    '0122222222224110',
    '0012222222221000',
    '0001222222210000',
    '0001210012100000',
    '0001210012100000',
    '0001100011000000',
    '0000000000000000',
    '0000000000000000',
];
const WOLF_ATTACK = v(WOLF, [
    [2, '0000000000000000'],
    [3, '0000110000110000'],
    [4, '0000121001210000'],
    [5, '0000122222210000'],
    [6, '0000121221210000'],
    [7, '0000124444210000'],
    [8, '0000124114210000'],
    [9, '0000014224100000'],
    [13, '0001210000121000'],
    [14, '0001210000121000'],
    [15, '0001100000011000'],
]);

export const CHARACTER_SPRITES = {
    'npcs/watchman': { frames: [WATCHMAN] },
    'npcs/miller': { frames: [MILLER] },
    'npcs/archivist': { frames: [ARCHIVIST] },
    'npcs/grocer': { frames: [GROCER] },
    'npcs/town_crier': { frames: [TOWN_CRIER] },

    'enemies/goblin': { frames: [GOBLIN] },
    'enemies/goblin_back': { frames: [GOBLIN_BACK] },
    'enemies/goblin_side': { frames: [GOBLIN_SIDE] },
    'enemies/goblin_attack': { frames: [GOBLIN_ATTACK] },

    'enemies/bandit': { frames: [BANDIT] },
    'enemies/bandit_back': { frames: [BANDIT_BACK] },
    'enemies/bandit_side': { frames: [BANDIT_SIDE] },
    'enemies/bandit_attack': { frames: [BANDIT_ATTACK] },

    'enemies/skeleton': { frames: [SKELETON] },
    'enemies/skeleton_back': { frames: [SKELETON_BACK] },
    'enemies/skeleton_side': { frames: [SKELETON_SIDE] },
    'enemies/skeleton_attack': { frames: [SKELETON_ATTACK] },

    'enemies/ruin_shade': { frames: [RUIN_SHADE] },
    'enemies/ruin_shade_back': { frames: [RUIN_SHADE_BACK] },
    'enemies/ruin_shade_side': { frames: [RUIN_SHADE_SIDE] },
    'enemies/ruin_shade_attack': { frames: [RUIN_SHADE_ATTACK] },

    'enemies/wraith': { frames: [WRAITH] },
    'enemies/wraith_back': { frames: [WRAITH_BACK] },
    'enemies/wraith_side': { frames: [WRAITH_SIDE] },
    'enemies/wraith_attack': { frames: [WRAITH_ATTACK] },

    'enemies/cave_troll': { frames: [CAVE_TROLL] },
    'enemies/cave_troll_back': { frames: [CAVE_TROLL_BACK] },
    'enemies/cave_troll_side': { frames: [CAVE_TROLL_SIDE] },
    'enemies/cave_troll_attack': { frames: [CAVE_TROLL_ATTACK] },

    'enemies/mountain_troll': { frames: [MOUNTAIN_TROLL] },
    'enemies/mountain_troll_back': { frames: [MOUNTAIN_TROLL_BACK] },
    'enemies/mountain_troll_side': { frames: [MOUNTAIN_TROLL_SIDE] },
    'enemies/mountain_troll_attack': { frames: [MOUNTAIN_TROLL_ATTACK] },

    'enemies/crab': { frames: [CRAB] },
    'enemies/crab_back': { frames: [CRAB_BACK] },
    'enemies/crab_side': { frames: [CRAB_SIDE] },
    'enemies/crab_attack': { frames: [CRAB_ATTACK] },

    'enemies/throne_guardian': { frames: [THRONE_GUARDIAN] },
    'enemies/throne_guardian_back': { frames: [THRONE_GUARDIAN_BACK] },
    'enemies/throne_guardian_side': { frames: [THRONE_GUARDIAN_SIDE] },
    'enemies/throne_guardian_attack': { frames: [THRONE_GUARDIAN_ATTACK] },

    'enemies/wolf': { frames: [WOLF] },
    'enemies/wolf_back': { frames: [WOLF_BACK] },
    'enemies/wolf_side': { frames: [WOLF_SIDE] },
    'enemies/wolf_attack': { frames: [WOLF_ATTACK] },
};
