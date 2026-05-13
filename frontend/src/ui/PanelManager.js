/**
 * PanelManager — show/hide/cache panels with fluid mobile-style slide transitions.
 * 
 * Uses a hardware-accelerated translateX slide system instead of scale/opacity,
 * mimicking iOS/Android screen-to-screen navigation.
 */
export class PanelManager {
    /**
     * @param {Object} opts
     * @param {HTMLElement} opts.container       - The main deck-container
     * @param {HTMLElement} opts.panelsContainer  - The panels-container wrapper
     * @param {Object}      opts.panels          - { mixer, discord, domotica } HTMLElements
     * @param {Function}    opts.onPanelChange   - Called when active panel changes: (panelId | null) => void
     */
    constructor({ container, panelsContainer, panels, onPanelChange }) {
        this.container = container;
        this.panelsContainer = panelsContainer;
        this.panels = panels;
        this.activePanel = null;
        this.onPanelChange = onPanelChange || (() => {});
        this._animating = false;

        // Duration in ms — matches CSS --panel-slide-duration
        this._duration = 380;
    }

    /** Show a panel by ID with a forward slide (panel slides in from the right) */
    showPanel(panelId) {
        if (this._animating) return;
        const previousPanel = this.activePanel;
        this.activePanel = panelId;
        this._animating = true;

        // Hide all other panels immediately
        Object.entries(this.panels).forEach(([id, p]) => {
            if (id !== panelId) {
                p.classList.add('hidden');
                p.classList.remove('panel-slide-in', 'panel-slide-out', 'panel-slide-back-in', 'panel-slide-back-out');
            }
        });

        // Prepare the panels container
        this.panelsContainer.classList.remove('hidden');

        // Prepare the target panel: show it at the starting position (off-screen right)
        const panel = this.panels[panelId];
        if (panel) {
            panel.classList.remove('hidden');
            panel.classList.remove('panel-slide-in', 'panel-slide-out', 'panel-slide-back-in', 'panel-slide-back-out');
            // Force reflow so the browser registers the starting position
            void panel.offsetWidth;
            panel.classList.add('panel-slide-in');
        }

        // Animate the main grid: slide it slightly to the left (parallax)
        this.container.classList.remove('hidden');
        this.container.classList.remove('grid-slide-out', 'grid-slide-back');
        void this.container.offsetWidth;
        this.container.classList.add('grid-slide-out');

        // After animation completes, clean up
        const onDone = () => {
            this.container.classList.add('hidden');
            this.container.classList.remove('grid-slide-out');
            if (panel) panel.classList.remove('panel-slide-in');
            this._animating = false;
        };

        if (panel) {
            panel.addEventListener('animationend', onDone, { once: true });
        }
        // Fallback timeout in case animationend doesn't fire
        setTimeout(() => {
            if (this._animating && this.activePanel === panelId) {
                onDone();
            }
        }, this._duration + 100);

        this.onPanelChange(panelId, previousPanel);
    }

    /** Hide all panels with a backward slide (panel slides out to the right, grid returns) */
    hidePanels() {
        const previousPanel = this.activePanel;
        if (!previousPanel || this._animating) return;

        this.activePanel = null;
        this._animating = true;

        const panel = this.panels[previousPanel];

        // Start animating the panel out to the right
        if (panel) {
            panel.classList.remove('panel-slide-in', 'panel-slide-out', 'panel-slide-back-in', 'panel-slide-back-out');
            void panel.offsetWidth;
            panel.classList.add('panel-slide-back-out');
        }

        // Animate the back button out
        const backBtn = document.getElementById('panel-back-button');
        if (backBtn) {
            backBtn.classList.add('panel-back-btn-exit');
        }

        // Bring the grid back: slide from left
        this.container.classList.remove('hidden', 'grid-slide-out', 'grid-slide-back');
        void this.container.offsetWidth;
        this.container.classList.add('grid-slide-back');

        // After animation completes, clean up
        const onDone = () => {
            this.container.classList.remove('grid-slide-back');
            this.panelsContainer.classList.add('hidden');
            Object.values(this.panels).forEach(p => {
                p.classList.add('hidden');
                p.classList.remove('panel-slide-in', 'panel-slide-out', 'panel-slide-back-in', 'panel-slide-back-out');
            });
            if (backBtn) backBtn.remove();
            this._animating = false;
        };

        if (panel) {
            panel.addEventListener('animationend', onDone, { once: true });
        }
        // Fallback timeout
        setTimeout(() => {
            if (this._animating && this.activePanel === null) {
                onDone();
            }
        }, this._duration + 100);

        this.onPanelChange(null, previousPanel);
    }

    /** Get the currently active panel ID */
    getActivePanel() {
        return this.activePanel;
    }

    /** Check if a specific panel is active */
    isActive(panelId) {
        return this.activePanel === panelId;
    }
}
