// @ts-check

import { clearElement, getModalRootEl } from './shell.js';

/**
 * @param {{ title: string, initialValue?: string, maxLength?: number, placeholder?: string }} options
 * @returns {Promise<string | null>}
 */
export const requestTextInput = ({ title, initialValue = '', maxLength = 120, placeholder = '' }) => {
  const root = getModalRootEl();
  if (!root || typeof document === 'undefined') {
    return Promise.resolve(null);
  }

  clearElement(root);
  root.classList.add('modal-root-active');

  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';

  const panel = document.createElement('form');
  panel.className = 'ui-modal-panel';

  const heading = document.createElement('h2');
  heading.className = 'ui-modal-title';
  heading.textContent = title;

  const input = document.createElement('input');
  input.className = 'ui-modal-input';
  input.type = 'text';
  input.value = initialValue;
  input.maxLength = maxLength;
  input.placeholder = placeholder;

  const actions = document.createElement('div');
  actions.className = 'ui-modal-actions';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'ui-modal-button';
  cancelButton.textContent = 'Cancel';

  const confirmButton = document.createElement('button');
  confirmButton.type = 'submit';
  confirmButton.className = 'ui-modal-button ui-modal-button-primary';
  confirmButton.textContent = 'Confirm';

  actions.append(cancelButton, confirmButton);
  panel.append(heading, input, actions);
  overlay.appendChild(panel);
  root.appendChild(overlay);

  return new Promise((resolve) => {
    const close = (value) => {
      clearElement(root);
      root.classList.remove('modal-root-active');
      resolve(value);
    };

    cancelButton.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(null);
    });
    panel.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input.value.trim();
      close(value || null);
    });

    setTimeout(() => input.focus(), 0);
  });
};
