// Hash-identicon character sprites (16x16, seeded from entity id)
export function generateCharacterSprite(seed, type) {
  // Phase 7.5: returns a stub or null
  return null;
}

// Canvas primitive tile renderer — no PNG assets
export function drawTile(ctx, tileType, canvasX, canvasY, rngSeed) {
  // Phase 7.5: placeholder patterns
  const colors = {
    stone_floor: '#3a3a3a',
    wall: '#2a2a3a',
    grass: '#1a4a1a',
    water: '#0a3a6a',
    portal: '#111'
  };
  ctx.fillStyle = colors[tileType] || '#000';
  ctx.fillRect(canvasX, canvasY, 16, 16);
}

// Animate walk cycle via pose offsets
export function getWalkPose(frameTime) {
  // Phase 7.5: returns {legOffset, bodyY}
  return { legOffset: 0, bodyY: 0 };
}
