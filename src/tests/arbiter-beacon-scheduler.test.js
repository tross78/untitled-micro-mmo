import { createSerializedPublisher } from '../network/arbiter-beacon-scheduler.js';

describe('arbiter beacon scheduler', () => {
    test('coalesces overlapping publish calls into one in-flight promise', async () => {
        let releasePublish;
        const publish = jest.fn(() => new Promise(resolve => {
            releasePublish = resolve;
        }));
        const scheduler = createSerializedPublisher(publish);

        const first = scheduler.publish();
        const second = scheduler.publish();

        expect(first).toBe(second);
        expect(scheduler.isInFlight()).toBe(true);
        expect(publish).toHaveBeenCalledTimes(1);

        releasePublish();
        await Promise.resolve();
        expect(publish).toHaveBeenCalledTimes(2);
        releasePublish();
        await first;

        // The second call happened while the first was in flight, so exactly one
        // follow-up publish runs after the first completes.
        expect(publish).toHaveBeenCalledTimes(2);
        expect(scheduler.isInFlight()).toBe(false);
    });

    test('records last publish time only after publish resolves', async () => {
        let now = 1000;
        let releasePublish;
        const publish = jest.fn(() => new Promise(resolve => {
            releasePublish = resolve;
        }));
        const scheduler = createSerializedPublisher(publish, () => now);

        const pending = scheduler.publish();

        expect(scheduler.getLastPublishedAt()).toBe(0);

        now = 2000;
        releasePublish();
        await pending;

        expect(scheduler.getLastPublishedAt()).toBe(2000);
    });

    test('collapses many overlapping calls into one trailing publish', async () => {
        const releases = [];
        const publish = jest.fn(() => new Promise(resolve => {
            releases.push(resolve);
        }));
        const scheduler = createSerializedPublisher(publish);

        const first = scheduler.publish();
        const calls = Array.from({ length: 50 }, () => scheduler.publish());

        expect(calls.every(call => call === first)).toBe(true);
        expect(publish).toHaveBeenCalledTimes(1);

        releases.shift()();
        await Promise.resolve();
        expect(publish).toHaveBeenCalledTimes(2);

        releases.shift()();
        await first;
        expect(publish).toHaveBeenCalledTimes(2);
    });
});
