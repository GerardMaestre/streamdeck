/**
 * main.js — Entry point for Stream Deck Pro.
 * Bootstraps the modular application via esbuild bundle.
 */
import { StreamDeckApp } from './core/StreamDeckApp.js';
import { setThumbTransform } from './ui/FaderFactory.js';

// --- Fullscreen button (global, outside the class) ---
const btnFullscreen = document.createElement('div');
btnFullscreen.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
</svg>`;
btnFullscreen.className = 'btn-fullscreen';
btnFullscreen.title = 'Pantalla Completa';
document.body.appendChild(btnFullscreen);

btnFullscreen.addEventListener('click', () => {
    const elem = document.documentElement;
    if (!document.fullscreenElement) {
        if (elem.requestFullscreen) elem.requestFullscreen();
        else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
        else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
    }
});

document.addEventListener('fullscreenchange', () => {
    btnFullscreen.classList.toggle('btn-fullscreen--hidden', !!document.fullscreenElement);
});

// --- Bootstrap ---
document.addEventListener('DOMContentLoaded', () => {
    new StreamDeckApp();
});
