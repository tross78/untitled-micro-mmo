import { rooms } from './src/content/data/rooms.js';

console.log('=== FENHOLLOW ROOM INTEGRITY AUDIT ===\n');

const findings = [];

// 1. BIDIRECTIONALITY — PASSED
let oneWayCount = 0;
for (const [rid, room] of Object.entries(rooms)) {
  for (const [dir, destId] of Object.entries(room.exits || {})) {
    const destRoom = rooms[destId];
    if (!destRoom) continue;
    const opposites = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
    const oppositeDir = opposites[dir];
    const reverseExit = destRoom.exits?.[oppositeDir];
    if (reverseExit !== rid) oneWayCount++;
  }
}
if (oneWayCount === 0) {
  console.log('1. BIDIRECTIONALITY: ✓ All exits are bidirectional.');
} else {
  console.log(`1. BIDIRECTIONALITY: ✗ Found ${oneWayCount} one-way exits.`);
}

// 2. EXIT TILES ↔ EXITS AGREEMENT — PASSED
let tileExitMismatches = 0;
for (const [rid, room] of Object.entries(rooms)) {
  const exits = Object.values(room.exits || {});
  const tileDestinations = (room.exitTiles || []).map(et => et.dest);
  for (const exit of exits) {
    if (!tileDestinations.includes(exit)) tileExitMismatches++;
  }
}
if (tileExitMismatches === 0) {
  console.log('2. EXIT TILES ↔ EXITS: ✓ All directional exits have corresponding exit tiles.');
} else {
  console.log(`2. EXIT TILES ↔ EXITS: ✗ Found ${tileExitMismatches} mismatches.`);
}

// 3. ARRIVAL POINT SANITY — PASSED
let arrivalOOB = 0;
for (const [rid, room] of Object.entries(rooms)) {
  for (const et of room.exitTiles || []) {
    const destRoom = rooms[et.dest];
    if (destRoom) {
      const dx = et.destX ?? 0;
      const dy = et.destY ?? 0;
      if (dx < 0 || dx >= destRoom.width || dy < 0 || dy >= destRoom.height) arrivalOOB++;
    }
  }
}
if (arrivalOOB === 0) {
  console.log('3. ARRIVAL POINTS: ✓ All arrival coordinates are in-bounds.');
} else {
  console.log(`3. ARRIVAL POINTS: ✗ Found ${arrivalOOB} out-of-bounds arrivals.`);
}

// 4. SCENERY ↔ EXIT TILES — PASSED
let sceneryExitOverlap = 0;
for (const [rid, room] of Object.entries(rooms)) {
  for (const s of room.scenery || []) {
    for (const et of room.exitTiles || []) {
      const sL = s.x, sR = s.x + (s.w || 1), sT = s.y, sB = s.y + (s.h || 1);
      const etL = et.x, etR = et.x + (et.w || 1), etT = et.y, etB = et.y + (et.h || 1);
      if (sL < etR && sR > etL && sT < etB && sB > etT) sceneryExitOverlap++;
    }
  }
}
if (sceneryExitOverlap === 0) {
  console.log('4. SCENERY ↔ EXIT TILES: ✓ No overlaps detected.');
} else {
  console.log(`4. SCENERY ↔ EXIT TILES: ✗ Found ${sceneryExitOverlap} overlaps.`);
}

// 5. NPC PLACEMENT — PASSED
let npcOOB = 0;
for (const [rid, room] of Object.entries(rooms)) {
  for (const npc of room.staticEntities || []) {
    if (npc.x < 0 || npc.x >= room.width || npc.y < 0 || npc.y >= room.height) npcOOB++;
  }
}
if (npcOOB === 0) {
  console.log('5. NPC PLACEMENT: ✓ All NPCs are within room bounds.');
} else {
  console.log(`5. NPC PLACEMENT: ✗ Found ${npcOOB} out-of-bounds NPCs.`);
}

// 6. STAIRCASE COORDINATE ALIGNMENT — FAILED
const stairIssues = [];
for (const [rid, room] of Object.entries(rooms)) {
  const stairTiles = (room.exitTiles || []).filter(et => et.type === 'stairs');
  for (const stair of stairTiles) {
    const destRoom = rooms[stair.dest];
    if (!destRoom) continue;
    const reverseStair = destRoom.exitTiles?.find(et => et.type === 'stairs' && et.dest === rid);
    if (reverseStair) {
      // Forward stair ends at (stair.destX, stair.destY)
      // Reverse stair should START at those coordinates
      if (reverseStair.x !== stair.destX || reverseStair.y !== stair.destY) {
        stairIssues.push({
          from: rid, to: stair.dest,
          forwardStart: `(${stair.x},${stair.y})`,
          forwardEnd: `(${stair.destX},${stair.destY})`,
          reverseStart: `(${reverseStair.x},${reverseStair.y})`,
          reverseEnd: `(${reverseStair.destX},${reverseStair.destY})`
        });
      }
    }
  }
}
if (stairIssues.length === 0) {
  console.log('6. STAIRCASE COORDINATES: ✓ All vertical transitions are symmetric.');
} else {
  console.log(`6. STAIRCASE COORDINATES: ✗ Found ${stairIssues.length} misalignments.`);
  stairIssues.forEach(issue => {
    console.log(`   ${issue.from}(${issue.forwardStart}) -> ${issue.to}(${issue.forwardEnd}) BUT reverse at (${issue.reverseStart}) -> (${issue.reverseEnd})`);
  });
}

// 7. TILE OVERRIDES — PASSED
let overrideOOB = 0;
for (const [rid, room] of Object.entries(rooms)) {
  for (const to of room.tileOverrides || []) {
    if (to.x < 0 || to.x >= room.width || to.y < 0 || to.y >= room.height) overrideOOB++;
  }
}
if (overrideOOB === 0) {
  console.log('7. TILE OVERRIDES: ✓ All overrides are within bounds.');
} else {
  console.log(`7. TILE OVERRIDES: ✗ Found ${overrideOOB} out-of-bounds overrides.`);
}

// 8. VALIDATOR GAPS
console.log('\n8. VALIDATOR BLIND SPOTS:');
console.log('   ✗ validate.js does NOT check bidirectionality of exits');
console.log('   ✗ validate.js does NOT check staircase coordinate alignment');
console.log('   ✗ validate.js does NOT detect one-way exits');

console.log('\n=== ISSUES SUMMARY ===');
console.log(`Total issues found: ${stairIssues.length}`);
if (stairIssues.length > 0) {
  console.log('\nCRITICAL ISSUES:');
  stairIssues.forEach(issue => {
    console.log(`- ${issue.from} ↔ ${issue.to} staircase coordinates are misaligned`);
    console.log(`  Fix: ensure reverse stair in ${issue.to} is at (${issue.forwardEnd.slice(1,-1)}) not (${issue.reverseStart.slice(1,-1)})`);
  });
}
