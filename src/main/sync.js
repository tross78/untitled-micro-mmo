import { TAB_CHANNEL, arbiterPublicKey, hasSyncedWithArbiter, updateSimulation } from '../store.js';
import { verifyMessage } from '../crypto.js';
import { lastValidStatePacket } from '../networking.js';
import { triggerLogicalRefresh } from './events.js'; // Will be defined later

export const initCrossTabSync = () => {
    TAB_CHANNEL.onmessage = ({ data }) => {
        if (data.type === 'request_state' && lastValidStatePacket) {
            TAB_CHANNEL.postMessage({ type: 'state', packet: lastValidStatePacket });
        }
        if (data.type === 'state' && !hasSyncedWithArbiter) {
            verifyMessage(
                typeof data.packet.state === 'string' ? data.packet.state : JSON.stringify(data.packet.state),
                data.packet.signature,
                arbiterPublicKey
            ).then(valid => {
                if (!valid) return;
                const stateObj = typeof data.packet.state === 'string' ? JSON.parse(data.packet.state) : data.packet.state;
                
                // Security: Never sync 'ph' across tabs. Each tab must derive its own
                // from its own cryptographic keys.
                if (stateObj.ph) delete stateObj.ph;

                updateSimulation(stateObj);
                triggerLogicalRefresh();
            }).catch(() => {});
        }
    };
};
