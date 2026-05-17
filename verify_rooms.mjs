import { rooms } from './src/content/data/rooms.js';

const roomMap = rooms;

console.log('=== AUDIT RESULTS ===\n');

// 1. BIDIRECTIONALITY
console.log('1. BIDIRECTIONALITY OF EXITS');
const oneWayExits = [];
for (const [roomId, room] of Object.entries(roomMap)) {
  for (const [dir, destId] of Object.entries(room.exits || {})) {
    const destRoom = roomMap[destId];
    if (!destRoom) {
      oneWayExits.push(`${roomId}[exits.${dir}] -> MISSING ROOM '${destId}'`);
      continue;
    }
    const opposites = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
    const oppositeDir = opposites[dir];
    if (!oppositeDir) {
      oneWayExits.push(`${roomId}[exits.${dir}] uses non-standard direction`);
      continue;
    }
    const reverseExit = destRoom.exits?.[oppositeDir];
    if (reverseExit !== roomId) {
      oneWayExits.push(`${roomId}.${dir} -> ${destId}, but ${destId}.${oppositeDir} not back to ${roomId} (has: ${reverseExit || 'none'})`);
    }
  }
}
if (oneWayExits.length === 0) {
  console.log('✓ All exits are bidirectional.\n');
} else {
  console.log('✗ ONE-WAY EXITS FOUND:');
  oneWayExits.forEach(e => console.log('  ' + e));
  console.log();
}

// 2. EXIT TILES ↔ EXITS AGREEMENT
console.log('2. EXIT TILES ↔ EXITS ARRAY AGREEMENT');
const exitTileProblems = [];
for (const [roomId, room] of Object.entries(roomMap)) {
  const exitTiles = room.exitTiles || [];
  const exits = room.exits || {};
  
  for (const dir of Object.keys(exits)) {
    let foundTile = false;
    for (const et of exitTiles) {
      if (et.dest === exits[dir]) {
        foundTile = true;
        break;
      }
    }
    if (!foundTile) {
      exitTileProblems.push(`${roomId}.exits['${dir}'] = ${exits[dir]} but no exitTile points to it`);
    }
  }
  
  for (const et of exitTiles) {
    let found = false;
    for (const [dir, dest] of Object.entries(exits)) {
      if (dest === et.dest) {
        found = true;
        break;
      }
    }
    if (!found) {
      exitTileProblems.push(`${roomId} has exitTile to ${et.dest} but no exits[*] points there`);
    }
  }
}
if (exitTileProblems.length === 0) {
  console.log('✓ All exits[] entries have matching exitTiles and vice versa.\n');
} else {
  console.log('✗ EXIT TILE MISMATCHES:');
  exitTileProblems.forEach(e => console.log('  ' + e));
  console.log();
}

// 3. ARRIVAL POINT SANITY
console.log('3. ARRIVAL POINT SANITY (destX/destY within bounds)');
const arrivalProblems = [];
for (const [roomId, room] of Object.entries(roomMap)) {
  for (const et of room.exitTiles || []) {
    const destRoom = roomMap[et.dest];
    if (!destRoom) continue;
    
    const destX = et.destX ?? 0;
    const destY = et.destY ?? 0;
    
    if (destX < 0 || destX >= destRoom.width || destY < 0 || destY >= destRoom.height) {
      arrivalProblems.push(`${roomId} -> ${et.dest}: destX=${destX},destY=${destY} OUT OF BOUNDS (${destRoom.width}x${destRoom.height})`);
    }
  }
}
if (arrivalProblems.length === 0) {
  console.log('✓ All arrival points are in-bounds.\n');
} else {
  console.log('✗ ARRIVAL POINT ISSUES:');
  arrivalProblems.forEach(e => console.log('  ' + e));
  console.log();
}

// 4. SCENERY vs EXIT TILES OVERLAP
console.log('4. SCENERY ↔ EXIT TILES OVERLAP');
const sceneryExitProblems = [];
for (const [roomId, room] of Object.entries(roomMap)) {
  const scenery = room.scenery || [];
  const exitTiles = room.exitTiles || [];
  
  for (const s of scenery) {
    for (const et of exitTiles) {
      const sLeft = s.x, sRight = s.x + (s.w || 1);
      const sTop = s.y, sBottom = s.y + (s.h || 1);
      const etLeft = et.x, etRight = et.x + (et.w || 1);
      const etTop = et.y, etBottom = et.y + (et.h || 1);
      
      if (sLeft < etRight && sRight > etLeft && sTop < etBottom && sBottom > etTop) {
        sceneryExitProblems.push(`${roomId}: '${s.label}'(${s.x},${s.y}) overlaps exitTile to ${et.dest}(${et.x},${et.y})`);
      }
    }
  }
}
if (sceneryExitProblems.length === 0) {
  console.log('✓ No scenery-exitTile overlap.\n');
} else {
  console.log('✗ SCENERY OVERLAP ISSUES:');
  sceneryExitProblems.forEach(e => console.log('  ' + e));
  console.log();
}

// 5. NPC PLACEMENT
console.log('5. STATIC NPC PLACEMENT (within bounds)');
const npcProblems = [];
for (const [roomId, room] of Object.entries(roomMap)) {
  for (const npc of room.staticEntities || []) {
    if (npc.x < 0 || npc.x >= room.width || npc.y < 0 || npc.y >= room.height) {
      npcProblems.push(`${roomId}: NPC '${npc.id}' at (${npc.x},${npc.y}) OUT OF BOUNDS (${room.width}x${room.height})`);
    }
  }
}
if (npcProblems.length === 0) {
  console.log('✓ All NPC placements are in-bounds.\n');
} else {
  console.log('✗ NPC PLACEMENT ISSUES:');
  npcProblems.forEach(e => console.log('  ' + e));
  console.log();
}

// 6. STAIRCASE CONSISTENCY
console.log('6. VERTICAL TRANSITIONS (up/down consistency)');
const stairProblems = [];
for (const [roomId, room] of Object.entries(roomMap)) {
  const upExit = room.exits?.up;
  const downExit = room.exits?.down;
  
  if (upExit) {
    const destRoom = roomMap[upExit];
    if (destRoom) {
      const reverseDown = destRoom.exits?.down;
      if (reverseDown !== roomId) {
        stairProblems.push(`${roomId}.up -> ${upExit}, but ${upExit}.down != ${roomId} (has: ${reverseDown || 'none'})`);
      }
    }
  }
}
if (stairProblems.length === 0) {
  console.log('✓ Staircase transitions are bidirectional.\n');
} else {
  console.log('✗ STAIRCASE ISSUES:');
  stairProblems.forEach(e => console.log('  ' + e));
  console.log();
}

// 7. TILE OVERRIDES OUT OF BOUNDS
console.log('7. TILE OVERRIDES OUT OF BOUNDS');
const tileProblems = [];
for (const [roomId, room] of Object.entries(roomMap)) {
  for (const to of room.tileOverrides || []) {
    if (to.x < 0 || to.x >= room.width || to.y < 0 || to.y >= room.height) {
      tileProblems.push(`${roomId}: tileOverride at (${to.x},${to.y}) OUT OF BOUNDS (${room.width}x${room.height})`);
    }
  }
}
if (tileProblems.length === 0) {
  console.log('✓ All tile overrides are in-bounds.\n');
} else {
  console.log('✗ TILE OVERRIDE ISSUES:');
  tileProblems.forEach(e => console.log('  ' + e));
  console.log();
}

// 8. VALIDATOR CHECKS
console.log('8. VALIDATOR COVERAGE');
const gaps = [
  'validate.js does NOT check bidirectionality of exits',
  'validate.js does NOT check up/down staircase coordinate alignment',
  'validate.js does NOT detect one-way exits'
];
console.log('✗ KNOWN VALIDATOR BLIND SPOTS:');
gaps.forEach(e => console.log('  ' + e));

console.log('\n=== END AUDIT ===');
