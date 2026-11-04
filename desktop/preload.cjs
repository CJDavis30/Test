// Marks the page as running in the desktop shell so CSS can leave room for the macOS traffic lights.
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('plexusDesktop', { platform: process.platform });
window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('is-desktop', `is-${process.platform}`));
