import { rooms } from './src/content/data/rooms.js';

const roomMap = rooms;

console.log('=== STAIRCASE COORDINATE AUDIT ===\n');

// Walk all stairs and verify consistency
const issues = [];

for (const [roomId, room] of Object.entries(roomMap)) {
  // Find stairs-type exit tiles
  const stairTiles = (room.exitTiles || []).filter(et => et.type === 'stairs');
  
  for (const stair of stairTiles) {
    const destRoom = roomMap[stair.dest];
    if (!destRoom) {
      issues.push(`${roomId}: stairs at (${stair.x},${stair.y}) point to missing room ${stair.dest}`);
      continue;
    }
    
    // This stair goes from (stair.x, stair.y) in roomId to (stair.destX, stair.destY) in destRoom
    // The reverse should be stairs at (stair.destX, stair.destY) pointing back
    const reverseStair = destRoom.exitTiles?.find(
      et => et.type === 'stairs' && et.dest === roomId
    );
    
    if (!reverseStair) {
      issues.push(`${roomId}: stairs at (${stair.x},${stair.y}) go down to ${stair.dest}(${stair.destX},${stair.destY}), but no stairs back from ${stair.dest}`);
      continue;
    }
    
    // Check coordinate alignment: reverse stair should START where the forward stair ENDS
    if (reverseStair.x !== stair.destX || reverseStair.y !== stair.destY) {
      issues.push(`${roomId} stairs at (${stair.x},${stair.y}) end at ${stair.dest}(${stair.destX},${stair.destY}), but reverse stair in ${stair.dest} starts at (${reverseStair.x},${reverseStair.y}) — COORDINATE MISMATCH`);
    }
    
    // Check reverse destination alignment: reverse stair should END where forward stair STARTED
    if (reverseStair.destX !== stair.x || reverseStair.destY !== stair.y) {
      issues.push(`${roomId} stairs at (${stair.x},${stair.y}) -> ${stair.dest}(${stair.destX},${stair.destY}), but reverse returns to (${reverseStair.destX},${reverseStair.destY}) — NOT MATCHING START POSITION`);
    }
  }
}

if (issues.length === 0) {
  console.log('✓ All staircase coordinates are consistent and symmetric.\n');
} else {
  console.log('✗ STAIRCASE COORDINATE MISALIGNMENTS:\n');
  issues.forEach(issue => console.log('  ' + issue));
}

console.log('\n=== SUMMARY BY ROOM ===');
['ruins_descent', 'catacombs', 'cemetery'].forEach(rid => {
  const room = roomMap[rid];
  const stairs = room.exitTiles?.filter(et => et.type === 'stairs') || [];
  console.log(`\n${rid}:`);
  stairs.forEach(st => {
    console.log(`  stair at (${st.x},${st.y}) -> ${st.dest}(${st.destX},${st.destY})`);
  });
});
