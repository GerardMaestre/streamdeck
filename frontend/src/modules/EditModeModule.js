/**
 * EditModeModule — Drag & drop button reordering across carousel pages.
 */
export class EditModeModule {
    constructor(ctx) {
        this.events = ctx.events;
        this.container = ctx.container;
        this.getPages = ctx.getPages;
        this.getCurrentPage = ctx.getCurrentPage;
        this.getCarouselIndex = ctx.getCarouselIndex;
        this.getCarouselPages = ctx.getCarouselPages;
        this.renderSlide = ctx.renderSlide;
        this.invalidateCache = ctx.invalidateCache;
        this.saveConfig = ctx.saveConfig;

        this.editMode = false;
        this._editModeAbortController = null;
        this._dragState = null;
        this._edgeScrollTimeout = null;

        // Bind as arrow fn for remove
        this._onEditPointerDown = this._onEditPointerDown.bind(this);

        // Listen for reapply from carousel
        this.events.on('editmode:reapply', () => {
            if (this.editMode) this._applyEditModeToButtons();
        });
    }

    isActive() {
        return this.editMode;
    }

    enter() {
        if (this.editMode) return;
        const carouselPages = this.getCarouselPages();
        if (!carouselPages.includes(this.getCurrentPage())) return;

        this.editMode = true;
        const btn = document.getElementById('edit-mode-btn');
        if (btn) {
            btn.classList.add('active');
            btn.innerHTML = '<span class="edit-btn-icon">✅</span><span class="edit-btn-label">Listo</span>';
        }

        this._editModeAbortController = new AbortController();
        this._applyEditModeToButtons();
        this.events.emit('editmode:changed', true);
    }

    exit() {
        this.editMode = false;
        const btn = document.getElementById('edit-mode-btn');
        if (btn) {
            btn.classList.remove('active');
            btn.innerHTML = '<span class="edit-btn-icon">✏️</span><span class="edit-btn-label">Editar</span>';
        }

        const buttons = this.container.querySelectorAll('.boton');
        buttons.forEach(b => b.classList.remove('wiggle', 'drag-source'));

        if (this._editModeAbortController) {
            this._editModeAbortController.abort();
            this._editModeAbortController = null;
        }

        this.saveConfig();
        this.invalidateCache(); // clear all cached grids
        this.events.emit('editmode:changed', false);
    }

    toggle() {
        if (this.editMode) {
            this.exit();
        } else {
            this.enter();
        }
    }

    _applyEditModeToButtons() {
        const buttons = this.container.querySelectorAll('.boton');
        buttons.forEach((btn, i) => {
            btn.classList.add('wiggle');
            btn.dataset.editIndex = i;
        });
        this.container.addEventListener('pointerdown', this._onEditPointerDown, {
            capture: true,
            signal: this._editModeAbortController?.signal
        });
    }

    _onEditPointerDown(e) {
        if (!this.editMode) return;
        e.preventDefault();
        e.stopImmediatePropagation();

        const sourceBtn = e.target.closest('.boton');
        if (!sourceBtn || !this.container.contains(sourceBtn)) return;
        const sourceIndex = parseInt(sourceBtn.dataset.editIndex);
        const originPageId = this.getCurrentPage();
        if (isNaN(sourceIndex)) return;

        sourceBtn.classList.add('drag-source');

        // Ghost clone
        const ghost = sourceBtn.cloneNode(true);
        ghost.id = 'drag-ghost';
        ghost.classList.remove('wiggle', 'drag-source');
        ghost.classList.add('drag-ghost');
        const rect = sourceBtn.getBoundingClientRect();
        ghost.style.width = rect.width + 'px';
        ghost.style.height = rect.height + 'px';
        ghost.style.left = rect.left + 'px';
        ghost.style.top = rect.top + 'px';
        document.body.appendChild(ghost);

        this._dragState = {
            sourceIndex, sourceBtn, ghost,
            lastOverIndex: sourceIndex, originPageId
        };

        let lastTargetBtn = null;

        const onMove = (me) => {
            ghost.style.left = (me.clientX - rect.width / 2) + 'px';
            ghost.style.top = (me.clientY - rect.height / 2) + 'px';

            // Edge scroll detection
            const edgeWidth = 60;
            const carouselPages = this.getCarouselPages();
            const carouselIndex = this.getCarouselIndex();
            const canPrev = carouselIndex > 0;
            const canNext = carouselIndex < carouselPages.length - 1;

            if (me.clientX < edgeWidth && canPrev) {
                this._startEdgeScroll(-1);
                document.body.classList.add('edge-hover-left');
                document.body.classList.remove('edge-hover-right');
            } else if (me.clientX > window.innerWidth - edgeWidth && canNext) {
                this._startEdgeScroll(1);
                document.body.classList.add('edge-hover-right');
                document.body.classList.remove('edge-hover-left');
            } else {
                this._stopEdgeScroll();
                document.body.classList.remove('edge-hover-left', 'edge-hover-right');
            }

            ghost.style.pointerEvents = 'none';
            const el = document.elementFromPoint(me.clientX, me.clientY);
            ghost.style.pointerEvents = '';

            const targetBtn = el ? el.closest('.boton') : null;
            if (targetBtn !== lastTargetBtn) {
                if (lastTargetBtn) lastTargetBtn.classList.remove('drag-over');
                if (targetBtn) {
                    targetBtn.classList.add('drag-over');
                    this._dragState.lastOverIndex = parseInt(targetBtn.dataset.editIndex);
                } else {
                    this._dragState.lastOverIndex = sourceIndex;
                }
                lastTargetBtn = targetBtn;
            }
        };

        const onUp = () => {
            this._stopEdgeScroll();
            document.body.classList.remove('edge-hover-left', 'edge-hover-right');

            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);

            ghost.remove();
            sourceBtn.classList.remove('drag-source');

            const targetIndex = this._dragState.lastOverIndex;
            const dragOriginPageId = this._dragState.originPageId;
            const targetPageId = this.getCurrentPage();
            this._dragState = null;

            this.container.querySelectorAll('.drag-over').forEach(b => b.classList.remove('drag-over'));

            if (targetPageId !== dragOriginPageId || targetIndex !== sourceIndex) {
                this._moveOrSwapButton(dragOriginPageId, sourceIndex, targetPageId, targetIndex);
            }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    }

    _startEdgeScroll(direction) {
        if (this._edgeScrollTimeout) return;
        this._edgeScrollTimeout = setTimeout(() => {
            const carouselPages = this.getCarouselPages();
            const carouselIndex = this.getCarouselIndex();
            if (direction === 1 && carouselIndex < carouselPages.length - 1) {
                if (navigator.vibrate) navigator.vibrate(40);
                this.renderSlide(carouselIndex + 1, 1);
            } else if (direction === -1 && carouselIndex > 0) {
                if (navigator.vibrate) navigator.vibrate(40);
                this.renderSlide(carouselIndex - 1, -1);
            }
            this._edgeScrollTimeout = null;
        }, 750);
    }

    _stopEdgeScroll() {
        if (this._edgeScrollTimeout) {
            clearTimeout(this._edgeScrollTimeout);
            this._edgeScrollTimeout = null;
        }
    }

    _moveOrSwapButton(originPageId, sourceIndex, targetPageId, targetIndex) {
        const pages = this.getPages();
        const originArr = pages[originPageId];
        const targetArr = pages[targetPageId];
        if (!originArr || !targetArr) return;

        const [item] = originArr.splice(sourceIndex, 1);
        targetArr.splice(targetIndex, 0, item);

        if (navigator.vibrate) navigator.vibrate([20, 10, 20]);

        this.invalidateCache(originPageId);
        this.invalidateCache(targetPageId);
        this.renderSlide(this.getCarouselIndex(), 0);
    }
}
