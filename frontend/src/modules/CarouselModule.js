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
        this._slideDurationMs = 340;

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
            gridEl.appendChild(createBackButton(0, () => this.renderSlide(this.carouselIndex, 0), this.buttonStateMap));
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

        // --- Displacement Animation Logic (Bug-Free & Optimized) ---
        if (useSlideAnimation) {
            this._cleanupSlideArtifacts();
            document.body.classList.add('animating');

            const clone = this.container.cloneNode(true);
            clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
            clone.classList.remove('slide-enter-right', 'slide-enter-left', 'slide-active');
            clone.classList.add('slide-snapshot', direction > 0 ? 'slide-exit-left' : 'slide-exit-right');

            document.body.appendChild(clone);
            this._activeSnapshot = clone;

            this._snapshotFallbackTimeout = setTimeout(() => {
                this._cleanupSlideArtifacts();
            }, this._slideDurationMs + 140);

            clone.addEventListener('animationend', () => {
                this._cleanupSlideArtifacts();
            }, { once: true });
        }

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
        if (useSlideAnimation) {
            this.container.classList.add(slideClass);
            this.container.addEventListener('animationend', () => {
                this.container.classList.remove(slideClass);
            }, { once: true });
        }

        this.container.appendChild(cached.grid);
        this.container.appendChild(cached.footer);

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

        // Asegurar que el botón de edición vuelva a ser visible al retornar al carrusel
        this.setEditButtonVisibility(true);
    }

    _cleanupSlideArtifacts() {
        if (this._snapshotFallbackTimeout) {
            clearTimeout(this._snapshotFallbackTimeout);
            this._snapshotFallbackTimeout = null;
        }

        if (this._activeSnapshot) {
            this._activeSnapshot.remove();
            this._activeSnapshot = null;
        }

        document.body.classList.remove('animating');
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

        const btnAjustes = document.createElement('button');
        btnAjustes.type = 'button';
        btnAjustes.className = 'footer-btn';
        btnAjustes.textContent = 'Ajustes';
        btnAjustes.addEventListener('click', (e) => {
            e.preventDefault();
            this.onSettingsOpen();
        });

        footer.appendChild(btnEditar);
        
        // Spacer invisible para mantener el balance visual del footer
        const spacer = document.createElement('div');
        spacer.style.flex = '1';
        footer.appendChild(spacer);

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

        // --- Swipe Gestures ---
        let touchStartX = 0;
        let touchStartY = 0;
        let touchEndX = 0;
        let touchEndY = 0;
        const SWIPE_THRESHOLD = 40;

        const handleSwipe = () => {
            if (this.editMode || !this.carouselPages || this.carouselPages.length <= 1) return false;
            const deltaX = touchEndX - touchStartX;
            const deltaY = touchEndY - touchStartY;
            
            // Priorizar movimiento horizontal sobre vertical y asegurar el threshold
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > SWIPE_THRESHOLD) {
                if (deltaX < 0 && this.carouselIndex < this.carouselPages.length - 1) {
                    // Swipe a la izquierda -> Siguiente página
                    if (navigator.vibrate) navigator.vibrate(10);
                    this.renderSlide(this.carouselIndex + 1, 1);
                    return true;
                } else if (deltaX > 0 && this.carouselIndex > 0) {
                    // Swipe a la derecha -> Página anterior
                    if (navigator.vibrate) navigator.vibrate(10);
                    this.renderSlide(this.carouselIndex - 1, -1);
                    return true;
                }
            }
            return false;
        };

        this.container.addEventListener('touchstart', (e) => {
            // Ignorar swipe si se interactúa con elementos que requieren drag
            if (e.target.closest('.fader-thumb') || e.target.closest('.slider-thumb') || e.target.closest('input')) return;
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });

        this.container.addEventListener('touchend', (e) => {
            if (e.target.closest('.fader-thumb') || e.target.closest('.slider-thumb') || e.target.closest('input')) return;
            touchEndX = e.changedTouches[0].screenX;
            touchEndY = e.changedTouches[0].screenY;
            if (handleSwipe()) {
                // Prevenir que el click se propague si ha sido un swipe
                e.preventDefault();
            }
        }, { passive: false });
    }
}
