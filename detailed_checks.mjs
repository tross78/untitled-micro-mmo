import { rooms } from './src/content/data/rooms.js';

const roomMap = rooms;

console.log('=== DETAILED SPOT CHECKS ===\n');

// Check 1: ruins_descent ↔ catacombs (stairs)
console.log('A. RUINS_DESCENT ↔ CATACOMBS STAIRCASE');
const rd = roomMap.ruins_descent;
const cat = roomMap.catacombs;
console.log(`ruins_descent exits: ${JSON.stringify(rd.exits)}`);
console.log(`catacombs exits: ${JSON.stringify(cat.exits)}`);
const rdDownTile = rd.exitTiles?.find(et => et.dest === 'catacombs');
const catUpTile = cat.exitTiles?.find(et => et.dest === 'ruins_descent');
console.log(`ruins_descent down stair at (${rdDownTile?.x},${rdDownTile?.y}) -> catacombs(${rdDownTile?.destX},${rdDownTile?.destY})`);
console.log(`catacombs up stair at (${catUpTile?.x},${catUpTile?.y}) -> ruins_descent(${catUpTile?.destX},${catUpTile?.destY})`);
console.log(`Alignment: ${rdDownTile?.destX === catUpTile?.x && rdDownTile?.destY === catUpTile?.y ? '✓ MATCH' : '✗ MISMATCH'}\n`);

// Check 2: ruins_descent -> ruins
console.log('B. RUINS_DESCENT ↔ RUINS');
const ruins = roomMap.ruins;
console.log(`ruins_descent south exit: ${rd.exits?.south}`);
console.log(`ruins north exit: ${ruins.exits?.north}`);
const rdSouthTile = rd.exitTiles?.find(et => et.dest === 'ruins');
const ruinsNorthTile = ruins.exitTiles?.find(et => et.dest === 'ruins_descent');
console.log(`ruins_descent source tile: (${rdSouthTile?.x},${rdSouthTile?.y}), arrival in ruins: (${rdSouthTile?.destX},${rdSouthTile?.destY})`);
console.log(`ruins source tile: (${ruinsNorthTile?.x},${ruinsNorthTile?.y}), arrival in ruins_descent: (${ruinsNorthTile?.destX},${ruinsNorthTile?.destY})`);
console.log();

// Check 3: Spot check scenery dimensions
console.log('C. SCENERY DIMENSION CHECK (sample)');
const tavern = roomMap.tavern;
console.log(`tavern (12x11) has ${tavern.scenery?.length} scenery items:`);
tavern.scenery?.slice(0, 5).forEach(s => {
  const oob = s.x + (s.w || 1) > tavern.width || s.y + (s.h || 1) > tavern.height;
  console.log(`  ${s.label}(${s.x},${s.y}) w=${s.w||1} h=${s.h||1}${oob ? ' ✗ EXCEEDS BOUNDS' : ''}`);
});
console.log();

// Check 4: Lake shore north exit
console.log('D. LAKE_SHORE ↔ MOUNTAIN_PASS');
const ls = roomMap.lake_shore;
const mp = roomMap.mountain_pass;
console.log(`lake_shore north exit: ${ls.exits?.north}`);
console.log(`mountain_pass south exit: ${mp.exits?.south}`);
const lsNorthTile = ls.exitTiles?.find(et => et.dest === 'mountain_pass');
const mpSouthTile = mp.exitTiles?.find(et => et.dest === 'lake_shore');
console.log(`lake_shore -> mountain_pass arrival: (${lsNorthTile?.destX},${lsNorthTile?.destY})`);
console.log(`mountain_pass (21x31) destination: ${mp.width}x${mp.height}`);
console.log(`Arrival in bounds: ${lsNorthTile?.destX < mp.width && lsNorthTile?.destY < mp.height ? '✓' : '✗'}\n`);

// Check 5: Cemetery ↔ Catacombs
console.log('E. CEMETERY ↔ CATACOMBS');
const cem = roomMap.cemetery;
console.log(`cemetery south exit: ${cem.exits?.south}`);
console.log(`catacombs north exit: ${cat.exits?.north}`);
const cemSouthTile = cem.exitTiles?.find(et => et.dest === 'catacombs');
const catNorthTile = cat.exitTiles?.find(et => et.dest === 'cemetery');
console.log(`cemetery at (${cemSouthTile?.x},${cemSouthTile?.y}) -> catacombs(${cemSouthTile?.destX},${cemSouthTile?.destY})`);
console.log(`catacombs at (${catNorthTile?.x},${catNorthTile?.y}) -> cemetery(${catNorthTile?.destX},${catNorthTile?.destY})`);
console.log(`Stair tiles type: cemetery=${cemSouthTile?.type || 'edge'}, catacombs=${catNorthTile?.type || 'edge'}\n`);

console.log('=== END DETAILED CHECKS ===');
