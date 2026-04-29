/**
 * PanelManager — show/hide/cache panels.
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
    }

    /** Show a panel by ID, hiding all others and the main grid */
    showPanel(panelId) {
        const previousPanel = this.activePanel;
        this.activePanel = panelId;

        // Hide all panels first
        Object.values(this.panels).forEach(p => p.classList.add('hidden'));
        this.container.classList.add('hidden');

        // Show the target panel
        this.panelsContainer.classList.remove('hidden');
        const panel = this.panels[panelId];
        if (panel) panel.classList.remove('hidden');

        this.onPanelChange(panelId, previousPanel);
    }

    /** Hide all panels and show the main grid */
    hidePanels() {
        const previousPanel = this.activePanel;
        this.activePanel = null;

        this.panelsContainer.classList.add('hidden');
        Object.values(this.panels).forEach(p => p.classList.add('hidden'));
        this.container.classList.remove('hidden');

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
