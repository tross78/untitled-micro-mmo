import { rooms } from './src/content/data/rooms.js';

// The impact: when a player uses stairs, they arrive at (destX, destY) in the destination room.
// They then stand on that tile. If they want to go back up, the stairs should be AT that tile.
//
// Current issue: player arrives at (5,9) in ruins_descent from ruins, but the down-stair 
// from ruins_descent is at (5,2), NOT where they landed. This breaks the symmetry assumption
// that you can immediately go back the way you came.

console.log('=== STAIRCASE GAMEPLAY IMPACT ===\n');

const rd = rooms.ruins_descent;
const ruins = rooms.ruins;
const cat = rooms.catacombs;

console.log('Scenario 1: Player goes from ruins down into ruins_descent');
const rdDownStair = rd.exitTiles.find(et => et.dest === 'ruins' && et.type === 'stairs');
const ruinsDownStair = ruins.exitTiles.find(et => et.dest === 'ruins_descent' && et.type === 'stairs');
console.log(`Player stands on stair at ruins(${ruinsDownStair.x},${ruinsDownStair.y})`);
console.log(`Player arrives in ruins_descent at (${ruinsDownStair.destX},${ruinsDownStair.destY})`);
console.log(`To go back up, player must reach the stair at ruins_descent(${rdDownStair.x},${rdDownStair.y})`);
const distance = Math.abs(ruinsDownStair.destX - rdDownStair.x) + Math.abs(ruinsDownStair.destY - rdDownStair.y);
console.log(`Distance to back-exit: ${distance} tiles`);
if (distance > 1) {
  console.log('✗ PROBLEM: Player does not arrive directly on the back-stair. They must walk to it.');
}
console.log();

console.log('Scenario 2: Player goes from ruins_descent down into catacombs');
const catUpStair = cat.exitTiles.find(et => et.dest === 'ruins_descent' && et.type === 'stairs');
const rdDownCat = rd.exitTiles.find(et => et.dest === 'catacombs' && et.type === 'stairs');
console.log(`Player stands on stair at ruins_descent(${rdDownCat.x},${rdDownCat.y})`);
console.log(`Player arrives in catacombs at (${rdDownCat.destX},${rdDownCat.destY})`);
console.log(`To go back up, player must reach the stair at catacombs(${catUpStair.x},${catUpStair.y})`);
const distance2 = Math.abs(rdDownCat.destX - catUpStair.x) + Math.abs(rdDownCat.destY - catUpStair.y);
console.log(`Distance to back-exit: ${distance2} tiles`);
if (distance2 > 1) {
  console.log('✗ PROBLEM: Player does not arrive directly on the back-stair. They must walk to it.');
}
console.log();

console.log('VERDICT: These are not hard breaks (stairs are not auto-walk), but they break');
console.log('the expected symmetry of stairwell design. Players arriving at descent will be');
console.log('surprised to find they cannot immediately return via interact.');
