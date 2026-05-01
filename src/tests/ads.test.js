import { jest } from '@jest/globals';

describe('ads disabled configuration', () => {
    test('showRewardedAd calls failure callback when ads are disabled', async () => {
        jest.resetModules();

        const { initAds, showBanner, hideBanner, showRewardedAd } = await import('../ads.js');
        const onReward = jest.fn();
        const onFail = jest.fn();

        initAds();
        showBanner();
        hideBanner();
        showRewardedAd(onReward, onFail);

        expect(onReward).not.toHaveBeenCalled();
        expect(onFail).toHaveBeenCalledWith('Ads are disabled in config.');
    });

    test('banner functions are no-ops when ads are disabled', async () => {
        document.body.innerHTML = '<div id="banner-ad"></div>';
        const { showBanner, hideBanner } = await import('../ads.js');
        const banner = document.getElementById('banner-ad');
        showBanner();
        expect(banner.style.display).toBe('');
        hideBanner();
        expect(banner.style.display).toBe('');
    });
});
