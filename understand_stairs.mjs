import { rooms } from './src/content/data/rooms.js';

// The issue: stairs should be symmetric
// If room A has stairs at (ax, ay) that go DOWN to room B at (bx, by)
// Then room B should have stairs at (bx, by) that go UP to room A at (ax, ay)

// But what we're seeing:
// ruins has stairs at (10,0) -> ruins_descent(5,9)
// ruins_descent has stairs at (5,10) -> ruins(10,1)
//
// This breaks the symmetry: descent starts at (5,10) but ascent from ruins lands at (5,9)
// and ascent starts at (10,0) but descent from ruins_descent lands at (10,1)

console.log('Expected stair geometry:');
console.log('If room A stair at (ax,ay) lands at room B (bx,by)');
console.log('Then room B stair should be at (bx,by) and land back at room A (ax,ay)');
console.log();

console.log('ACTUAL ruins ↔ ruins_descent:');
const ruins = rooms.ruins;
const rd = rooms.ruins_descent;
const ruinsDown = ruins.exitTiles.find(et => et.dest === 'ruins_descent');
const rdUp = rd.exitTiles.find(et => et.dest === 'ruins');
console.log(`ruins down stair at (${ruinsDown.x},${ruinsDown.y}) -> ruins_descent(${ruinsDown.destX},${ruinsDown.destY})`);
console.log(`ruins_descent up stair at (${rdUp.x},${rdUp.y}) -> ruins(${rdUp.destX},${rdUp.destY})`);
console.log(`BROKEN: down ends at (${ruinsDown.destX},${ruinsDown.destY}) but up starts at (${rdUp.x},${rdUp.y})`);
console.log(`BROKEN: up ends at (${rdUp.destX},${rdUp.destY}) but down starts at (${ruinsDown.x},${ruinsDown.y})`);
console.log();

console.log('ACTUAL ruins_descent ↔ catacombs:');
const cat = rooms.catacombs;
const rdDown = rd.exitTiles.find(et => et.dest === 'catacombs');
const catUp = cat.exitTiles.find(et => et.dest === 'ruins_descent');
console.log(`ruins_descent down stair at (${rdDown.x},${rdDown.y}) -> catacombs(${rdDown.destX},${rdDown.destY})`);
console.log(`catacombs up stair at (${catUp.x},${catUp.y}) -> ruins_descent(${catUp.destX},${catUp.destY})`);
console.log(`BROKEN: down ends at (${rdDown.destX},${rdDown.destY}) but up starts at (${catUp.x},${catUp.y})`);
console.log(`BROKEN: up ends at (${catUp.destX},${catUp.destY}) but down starts at (${rdDown.x},${rdDown.y})`);
