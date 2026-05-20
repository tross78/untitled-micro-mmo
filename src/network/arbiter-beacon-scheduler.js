export const createSerializedPublisher = (publish, now = () => Date.now()) => {
    let inFlight = null;
    let rerunRequested = false;
    let lastPublishedAt = 0;

    const run = async () => {
        do {
            rerunRequested = false;
            await publish();
            lastPublishedAt = now();
        } while (rerunRequested);
    };

    return {
        publish() {
            if (inFlight) {
                rerunRequested = true;
                return inFlight;
            }
            inFlight = run().finally(() => {
                inFlight = null;
            });
            return inFlight;
        },
        getLastPublishedAt() {
            return lastPublishedAt;
        },
        isInFlight() {
            return Boolean(inFlight);
        },
    };
};
