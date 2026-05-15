/**
 * CarouselModule — Multi-page carousel with fluid mobile-style slide transitions.
 * 
 * Uses a dual-container translateX system instead of DOM cloning.
 * Both old and new grids coexist briefly inside a sliding wrapper,
 * producing a seamless, 60fps iOS-style page swipe.
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
        this._slideDurationMs = 400;
        this._isSliding = false;

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

    /** 
     * Build or retrieve a cached grid element for a carousel page.
     * Returns a NEW clone each time so we can have two grids in the DOM simultaneously.
     */
    _getOrCreateGrid(pageId) {
        let cached = this._cachedGrids.get(pageId);
        if (!cached) {
            const pageData = this.getPageData(pageId);
            const gridEl = document.createElement('div');
            gridEl.className = 'deck-grid';
            pageData.forEach((btnData, i) => {
                gridEl.appendChild(createButton(btnData, i, this.buttonStateMap, this.initialLoad));
            });
            cached = { grid: gridEl };
            this._cachedGrids.set(pageId, cached);
        }
        return cached.grid;
    }

    /** Render a carousel slide with fluid mobile-style transitions */
    renderSlide(index, direction = 0) {
        if (!this.carouselPages || this.carouselPages.length === 0) {
            this.renderGrid('main');
            return;
        }

        // Prevent overlapping slides
        if (this._isSliding) return;

        const newIndex = Math.max(0, Math.min(index, this.carouselPages.length - 1));
        const pageId = this.carouselPages[newIndex];
        const shouldAnimate = !this.initialLoad && direction !== 0 && newIndex !== this.carouselIndex;

        this.carouselIndex = newIndex;
        this.currentPage = pageId;
        this.onPageChange(pageId);

        const newGrid = this._getOrCreateGrid(pageId);

        if (shouldAnimate) {
            this._performSlideTransition(newGrid, direction);
        } else {
            // No animation — instant render (initial load or same page)
            this.container.replaceChildren();
            this.container.className = 'deck-view';
            this.container.appendChild(newGrid);
            this.container.appendChild(this._buildFooter());
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

        // Ensure edit button visible
        this.setEditButtonVisibility(true);
    }

    /**
     * Perform a fluid slide transition between two grids.
     * 
     * Strategy: 
     * - Create a temporary "slide-track" that holds both grids side by side
     * - Use CSS transform: translateX to slide the track
     * - Hardware-accelerated, no DOM cloning, no layout thrashing
     */
    _performSlideTransition(newGrid, direction) {
        this._isSliding = true;

        // Get current grid (the one being displayed)
        const currentGrid = this.container.querySelector('.deck-grid');
        const footer = this.container.querySelector('.deck-footer');

        // Create a slide track container
        const track = document.createElement('div');
        track.className = 'carousel-slide-track';
        track.style.cssText = `
            display: flex;
            width: 200%;
            height: 100%;
            flex: 1 1 auto;
            will-change: transform;
            transform: translateX(${direction > 0 ? '0%' : '-50%'}) translate3d(0,0,0);
        `;

        // Create wrappers for each grid so they each take exactly 50% of the track
        const oldWrapper = document.createElement('div');
        oldWrapper.className = 'carousel-slide-page';
        oldWrapper.style.cssText = 'width: 50%; height: 100%; flex-shrink: 0; overflow: hidden;';

        const newWrapper = document.createElement('div');
        newWrapper.className = 'carousel-slide-page';
        newWrapper.style.cssText = 'width: 50%; height: 100%; flex-shrink: 0; overflow: hidden;';

        // Clone the current grid for the old position (keeps current grid intact for cache)
        if (currentGrid) {
            const oldGridClone = currentGrid.cloneNode(true);
            oldGridClone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
            oldWrapper.appendChild(oldGridClone);
        }
        newWrapper.appendChild(newGrid);

        // Order: [old | new] for forward, [new | old] for backward
        if (direction > 0) {
            track.appendChild(oldWrapper);
            track.appendChild(newWrapper);
        } else {
            track.appendChild(newWrapper);
            track.appendChild(oldWrapper);
        }

        // Replace container content with track + keep footer static
        this.container.replaceChildren();
        this.container.className = 'deck-view carousel-sliding';
        this.container.appendChild(track);
        
        // Keep the footer always visible and static (doesn't slide)
        const newFooter = this._buildFooter();
        this.container.appendChild(newFooter);

        // Force reflow, then animate
        void track.offsetWidth;

        // Apply the sliding transform
        const targetX = direction > 0 ? '-50%' : '0%';
        track.style.transition = `transform ${this._slideDurationMs}ms cubic-bezier(0.25, 1, 0.5, 1)`;
        track.style.transform = `translateX(${targetX}) translate3d(0,0,0)`;

        // Clean up after animation
        const cleanup = () => {
            track.removeEventListener('transitionend', cleanup);
            
            // Replace track with just the new grid
            this.container.replaceChildren();
            this.container.className = 'deck-view';
            this.container.appendChild(newGrid);
            this.container.appendChild(newFooter);

            this._isSliding = false;
        };

        track.addEventListener('transitionend', cleanup, { once: true });

        // Fallback timeout
        setTimeout(() => {
            if (this._isSliding) {
                cleanup();
            }
        }, this._slideDurationMs + 150);
    }

    /** Build the footer with Editar/Ajustes */
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

        // --- Wheel Event for PC Navigation ---
        let lastWheelTime = 0;
        const WHEEL_COOLDOWN = 600; // ms to prevent scrolling multiple pages at once

        const handleWheel = (e) => {
            if (this.editMode || !this.carouselPages || this.carouselPages.length <= 1 || !this.carouselPages.includes(this.currentPage)) return;
            
            // Ignore scroll if we are over a scrollable element (like scrollable panels or inputs)
            if (e.target.closest('.output-box') || e.target.closest('.scrollable') || e.target.closest('[class*="scroll"]') || e.target.closest('[class*="list"]') || e.target.closest('[class*="messages"]')) return;

            const now = Date.now();
            if (now - lastWheelTime < WHEEL_COOLDOWN) return;

            // deltaY > 0 -> Scroll Down -> Next page
            // deltaY < 0 -> Scroll Up -> Prev page
            if (Math.abs(e.deltaY) > 5) {
                if (e.deltaY > 0 && this.carouselIndex < this.carouselPages.length - 1) {
                    lastWheelTime = now;
                    this.renderSlide(this.carouselIndex + 1, 1);
                } else if (e.deltaY < 0 && this.carouselIndex > 0) {
                    lastWheelTime = now;
                    this.renderSlide(this.carouselIndex - 1, -1);
                }
            }
        };
        
        window.addEventListener('wheel', handleWheel, { passive: true });
    }
}
