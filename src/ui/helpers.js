export const getHealthBar = (current, max, length = 10) => {
    const filledLength = Math.max(0, Math.min(length, Math.round((current / (max || 1)) * length)));
    const emptyLength = length - filledLength;
    return `[${'█'.repeat(filledLength)}${'░'.repeat(emptyLength)}]`;
};

let _shakeTimer = null;
export const triggerShake = () => {
    clearTimeout(_shakeTimer);
    document.body.classList.add('shake');
    _shakeTimer = setTimeout(() => {
        document.body.classList.remove('shake');
        _shakeTimer = null;
    }, 200);
};
