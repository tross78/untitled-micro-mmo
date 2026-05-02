/**
 * Ad Manager (Phase 4.4 Architecture Placeholder)
 * Acts as a wrapper for future real ad network integrations (AdSense, AdMob, etc.)
 */

import { ENABLE_ADS } from './data.js';
import { log } from '../ui/index.js';
import { seededRNG, hashStr } from '../rules/index.js';
import { clearElement, getBannerAdEl } from '../adapters/dom/shell.js';

let initialized = false;

export const initAds = () => {
    if (!ENABLE_ADS || initialized) return;
    console.log('[Ads] Initialized Ad Network Placeholder');
    initialized = true;
};

export const showBanner = () => {
    if (!ENABLE_ADS || !initialized) return;
    const banner = getBannerAdEl();
    if (banner) {
        banner.classList.remove('is-hidden');
        clearElement(banner);
        const placeholder = document.createElement('div');
        placeholder.textContent = '[ Advertisement Placeholder ]';
        placeholder.style.background = '#222';
        placeholder.style.color = '#555';
        placeholder.style.textAlign = 'center';
        placeholder.style.padding = '10px';
        placeholder.style.border = '1px solid #333';
        placeholder.style.marginTop = '5px';
        banner.appendChild(placeholder);
    }
};

export const hideBanner = () => {
    if (!ENABLE_ADS) return;
    const banner = getBannerAdEl();
    if (banner) banner.classList.add('is-hidden');
};

/**
 * Simulates showing a rewarded video ad.
 * @param {Function} onReward - Callback when the player finishes the ad.
 * @param {Function} onFail - Callback if the ad fails to load or the player closes it early.
 */
export const showRewardedAd = (onReward, onFail) => {
    if (!ENABLE_ADS || !initialized) {
        if (onFail) onFail('Ads are disabled in config.');
        return;
    }

    log(`\n[System] A vision begins to form in your mind... (Simulating 3s Ad)`, '#a0f');
    
    // We use Date.now() for the RNG seed here because Ad completion 
    // isn't a world simulation event that needs P2P consensus.
    const rng = seededRNG(hashStr(Date.now().toString()));
    
    // Simulate an ad playing with a timeout
    setTimeout(() => {
        // 90% chance the ad succeeds, 10% chance it fails or player skips
        if (rng(100) < 90) {
            log(`[System] The vision fades. You feel strangely energized.`, '#a0f');
            if (onReward) onReward();
        } else {
            log(`[System] The vision shatters before it finishes.`, '#f55');
            if (onFail) onFail('The vision was interrupted.');
        }
    }, 3000);
};
