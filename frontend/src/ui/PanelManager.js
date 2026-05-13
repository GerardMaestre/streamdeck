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
        this._transitionTimeout = null;
    }

    /** Show a panel by ID, hiding all others and the main grid */
    showPanel(panelId) {
        const previousPanel = this.activePanel;
        this.activePanel = panelId;

        // Cancelamos timers previos si existieran
        if (this._transitionTimeout) {
            clearTimeout(this._transitionTimeout);
            this._transitionTimeout = null;
        }

        // Ocultamos el resto de paneles inmediatamente
        Object.entries(this.panels).forEach(([id, p]) => {
            if (id !== panelId) {
                p.classList.add('hidden');
                p.classList.remove('animating-out');
            }
        });

        // 1. Preparamos la animación del Grid: quitar hidden y añadir clase de transición activa
        this.container.classList.remove('hidden');
        // Forzamos reflow
        void this.container.offsetWidth;
        this.container.classList.add('panel-active');

        // 2. Preparamos el nuevo panel para entrar
        const panel = this.panels[panelId];
        if (panel) {
            panel.classList.remove('hidden');
            panel.classList.remove('animating-out');
        }
        this.panelsContainer.classList.remove('hidden');

        // 3. Programamos el display:none del Grid al terminar la animación de entrada (420ms como --motion-panel)
        this._transitionTimeout = setTimeout(() => {
            if (this.activePanel === panelId) {
                this.container.classList.add('hidden');
            }
            this._transitionTimeout = null;
        }, 420);

        this.onPanelChange(panelId, previousPanel);
    }

    /** Hide all panels and show the main grid */
    hidePanels() {
        const previousPanel = this.activePanel;
        if (!previousPanel) return; // Ya oculto

        this.activePanel = null;

        // Cancelamos timers en curso
        if (this._transitionTimeout) {
            clearTimeout(this._transitionTimeout);
            this._transitionTimeout = null;
        }

        // 1. Devolvemos el Grid al DOM (está en opacity 0 y escala reducida)
        this.container.classList.remove('hidden');
        // Forzamos reflow
        void this.container.offsetWidth;

        // 2. Disparamos la animación de vuelta del Grid
        this.container.classList.remove('panel-active');

        // 3. Disparamos la animación de salida del panel actual y el botón de atrás
        const panel = this.panels[previousPanel];
        if (panel) {
            panel.classList.add('animating-out');
        }

        const backBtn = document.getElementById('panel-back-button');
        if (backBtn) {
            backBtn.classList.add('animating-out');
        }

        // 4. Al terminar la animación de salida (240ms), limpiamos completamente el DOM
        this._transitionTimeout = setTimeout(() => {
            this.panelsContainer.classList.add('hidden');
            Object.values(this.panels).forEach(p => {
                p.classList.add('hidden');
                p.classList.remove('animating-out');
            });

            if (backBtn) backBtn.remove();
            this._transitionTimeout = null;
        }, 240);

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
