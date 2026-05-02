// @ts-check

const SHELL_HTML = `
  <div id="status-bar">
    <div id="status-left"></div>
    <div id="status-center"></div>
    <div id="status-right"></div>
  </div>
  <div id="game-area">
    <div id="radar-container"></div>
  </div>
  <div id="side-panel"></div>
  <div id="action-buttons"></div>
  <div id="debug-console" class="debug-console is-hidden">
    <div id="output">Initializing P2P network...
Searching for peers in the BitTorrent DHT...</div>
    <div id="banner-ad" class="banner-ad is-hidden"></div>
    <div id="suggestions"></div>
    <div id="input-container" class="input-container">
      <span id="prompt">&gt;</span>
      <input
        type="text"
        id="input"
        autofocus
        spellcheck="false"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        enterkeyhint="send"
        placeholder="type a command..."
      >
    </div>
  </div>
  <div id="ui-modal-root"></div>
`;

const REQUIRED_IDS = [
  'status-bar',
  'status-left',
  'status-center',
  'status-right',
  'game-area',
  'side-panel',
  'action-buttons',
  'debug-console',
  'output',
  'banner-ad',
  'suggestions',
  'input-container',
  'input',
  'ui-modal-root',
];

const ensureRoot = () => {
  if (typeof document === 'undefined') return null;
  return document.body;
};

export const ensureShell = () => {
  const root = ensureRoot();
  if (!root) return null;
  const hasShell = REQUIRED_IDS.every((id) => document.getElementById(id));
  if (!hasShell) {
    root.insertAdjacentHTML('afterbegin', SHELL_HTML);
  }
  return root;
};

/**
 * @param {string} id
 * @returns {HTMLElement | null}
 */
export const getShellElement = (id) => {
  ensureShell();
  return document.getElementById(id);
};

export const getGameAreaEl = () => getShellElement('game-area');
export const getActionButtonsEl = () => getShellElement('action-buttons');
export const getDebugConsoleEl = () => getShellElement('debug-console');
export const getOutputEl = () => getShellElement('output');
export const getBannerAdEl = () => getShellElement('banner-ad');
export const getSuggestionsEl = () => getShellElement('suggestions');
export const getInputContainerEl = () => getShellElement('input-container');
export const getInputEl = () => /** @type {HTMLInputElement | null} */ (getShellElement('input'));
export const getModalRootEl = () => getShellElement('ui-modal-root');
export const getRadarEl = () => getShellElement('radar-container');

export const clearElement = (el) => {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
};
