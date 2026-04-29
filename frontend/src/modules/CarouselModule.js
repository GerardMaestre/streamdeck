/**
 * CarouselModule — Multi-page carousel with swipe gestures, page caching, and navigation.
 */
import { createButton, createBackButton } from '../ui/ButtonFactory.js';

export class CarouselModule {
    constructor(ctx) {
        this.events = ctx.events;
        this.container = ctx.container;
        this.overlay = ctx.overlay;
        this.overlayContainer = ctx.overlayContainer;
        this.getPages = ctx.getPages;            // () => pages object
        this.getPageData = ctx.getPageData;       // (pageId) => []
        this.buttonStateMap = ctx.buttonStateMap; // WeakMap for button state

        this.carouselPages = [];
        this.carouselIndex = 0;
        this.currentPage = 'main';
        this.editMode = false;
        this.initialLoad = true;
        this._cachedGrids = new Map();

        // Callbacks
        this.onPageChange = ctx.onPageChange || (() => {});
        this.onEditToggle = ctx.onEditToggle || (() => {});
        this.onSettingsOpen = ctx.onSettingsOpen || (() => {});
    }

    setCarouselPages(pages) {
        this.carouselPages = pages;
    }

    setEditMode(editMode) {
        this.editMode = editMode;
    }

    clearCache() {
        this._cachedGrids.clear();
    }

    invalidateCache(pageId) {
        this._cachedGrids.delete(pageId);
    }

    getCurrentPage() {
        return this.currentPage;
    }

    getCarouselIndex() {
        return this.carouselIndex;
    }

    /** Main grid initialization */
    initMainGrid() {
        if (this.carouselPages && this.carouselPages.length > 0) {
            this.renderSlide(0, 0);
        } else {
            this.renderGrid('main');
        }
    }

    /** Render a non-carousel page (sub-folders) */
    renderGrid(pageId = 'main') {
        this.currentPage = pageId;
        this.onPageChange(pageId);
        this.container.replaceChildren();
        this.container.className = 'deck-view';

        const pageData = this.getPageData(pageId);
        const shouldInjectBack = pageId !== 'main';

        const gridEl = document.createElement('div');
        gridEl.className = 'deck-grid';

        if (shouldInjectBack) {
            gridEl.appendChild(createBackButton(0, () => this.renderSlide(this.carouselIndex, 0)));
        }

        pageData.forEach((btnData, index) => {
            const visualIndex = shouldInjectBack ? index + 1 : index;
            gridEl.appendChild(createButton(btnData, visualIndex, this.buttonStateMap, this.initialLoad));
        });

        this.container.appendChild(gridEl);
        this.container.appendChild(this._buildFooter());
    }

    /** Render a carousel slide with caching */
    renderSlide(index, direction = 0) {
        if (!this.carouselPages || this.carouselPages.length === 0) {
            this.renderGrid('main');
            return;
        }

        this.carouselIndex = Math.max(0, Math.min(index, this.carouselPages.length - 1));
        const pageId = this.carouselPages[this.carouselIndex];
        this.currentPage = pageId;
        this.onPageChange(pageId);

        const slideClass = direction > 0 ? 'slide-enter-right' : direction < 0 ? 'slide-enter-left' : '';
        const useSlideAnimation = !this.initialLoad && Boolean(slideClass);

        // Page cache
        let cached = this._cachedGrids.get(pageId);
        if (!cached) {
            const pageData = this.getPageData(pageId);
            const gridEl = document.createElement('div');
            gridEl.className = 'deck-grid';
            pageData.forEach((btnData, i) => {
                gridEl.appendChild(createButton(btnData, i, this.buttonStateMap, this.initialLoad));
            });

            cached = { grid: gridEl, footer: this._buildFooter() };
            this._cachedGrids.set(pageId, cached);
        }

        this.container.replaceChildren();
        this.container.className = 'deck-view';
        if (useSlideAnimation) this.container.classList.add(slideClass);

        this.container.appendChild(cached.grid);
        this.container.appendChild(cached.footer);

        if (useSlideAnimation) {
            void this.container.offsetWidth; // force reflow
            this.container.classList.remove(slideClass);
            this.container.classList.add('slide-active');
        }

        // Remove floating edit buttons
        const existingFloating = document.getElementById('edit-mode-btn');
        if (existingFloating && !existingFloating.closest('.deck-footer')) {
            existingFloating.remove();
        }

        this._updateEditButton();

        if (this.editMode) {
            this.events.emit('editmode:reapply');
        }

        if (this.initialLoad) {
            this.initialLoad = false;
        }
    }

    /** Build the footer with Editar/Anterior/Siguiente/Ajustes */
    _buildFooter() {
        const footer = document.createElement('div');
        footer.className = 'deck-footer';

        const btnEditar = document.createElement('button');
        btnEditar.id = 'edit-mode-btn';
        btnEditar.type = 'button';
        btnEditar.className = 'footer-btn';
        btnEditar.textContent = this.editMode ? 'Listo' : 'Editar';
        if (this.editMode) btnEditar.classList.add('active');
        btnEditar.addEventListener('click', (e) => {
            e.preventDefault();
            this.onEditToggle();
        });

        const btnAnterior = document.createElement('button');
        btnAnterior.type = 'button';
        btnAnterior.className = 'footer-btn';
        btnAnterior.textContent = 'Anterior';
        btnAnterior.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.carouselIndex > 0) this.renderSlide(this.carouselIndex - 1, -1);
        });

        const btnSiguiente = document.createElement('button');
        btnSiguiente.type = 'button';
        btnSiguiente.className = 'footer-btn';
        btnSiguiente.textContent = 'Siguiente';
        btnSiguiente.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.carouselIndex < this.carouselPages.length - 1) this.renderSlide(this.carouselIndex + 1, 1);
        });

        const btnAjustes = document.createElement('button');
        btnAjustes.type = 'button';
        btnAjustes.className = 'footer-btn';
        btnAjustes.textContent = 'Ajustes';
        btnAjustes.addEventListener('click', (e) => {
            e.preventDefault();
            this.onSettingsOpen();
        });

        footer.appendChild(btnEditar);
        footer.appendChild(btnAnterior);
        footer.appendChild(btnSiguiente);
        footer.appendChild(btnAjustes);

        return footer;
    }

    /** Update the edit mode button text/state */
    _updateEditButton() {
        const btn = document.getElementById('edit-mode-btn');
        if (!btn) return;
        if (this.editMode) {
            btn.classList.add('active');
            btn.textContent = 'Listo';
        } else {
            btn.classList.remove('active');
            btn.textContent = 'Editar';
        }
    }

    /** Show/hide the edit button */
    setEditButtonVisibility(visible) {
        const btn = document.getElementById('edit-mode-btn');
        if (btn) btn.style.display = visible ? 'flex' : 'none';
    }

    /** Setup delegation for carousel dot/button navigation */
    setupDelegation() {
        const onCarouselTarget = (e) => {
            const target = e.target.closest('[data-carousel-index], [data-carousel-action]');
            if (!target || this.editMode) return;
            e.preventDefault();
            e.stopPropagation();

            const indexAttr = target.dataset.carouselIndex;
            if (indexAttr !== undefined) {
                const idx = Number(indexAttr);
                if (!Number.isFinite(idx) || idx === this.carouselIndex) return;
                this.renderSlide(idx, idx > this.carouselIndex ? 1 : -1);
                return;
            }

            const action = target.dataset.carouselAction;
            if (action === 'prev' && this.carouselIndex > 0) {
                this.renderSlide(this.carouselIndex - 1, -1);
            } else if (action === 'next' && this.carouselIndex < this.carouselPages.length - 1) {
                this.renderSlide(this.carouselIndex + 1, 1);
            }
        };
        document.body.addEventListener('click', onCarouselTarget, true);
    }
}
