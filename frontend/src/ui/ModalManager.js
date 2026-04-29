/**
 * ModalManager — Confirm, Info, and Parameter modals.
 */
export class ModalManager {
    constructor() {
        this.modal = document.getElementById('parameter-modal');
        this.title = document.getElementById('parameter-title');
        this.description = document.getElementById('parameter-description');
        this.input = document.getElementById('parameter-input');
        this.cancelBtn = document.getElementById('parameter-cancel');
        this.submitBtn = document.getElementById('parameter-submit');
        this.resolve = null;

        this._setupListeners();
    }

    _setupListeners() {
        if (!this.modal) return;

        this.cancelBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._close(false);
        });
        this.submitBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._close(true);
        });
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this._close(false);
        });
    }

    _close(confirmed) {
        if (!this.modal) return;
        this.modal.classList.add('hidden');
        if (this.input) this.input.style.display = '';
        if (this.submitBtn) this.submitBtn.textContent = 'Aceptar';
        if (this.cancelBtn) {
            this.cancelBtn.style.display = '';
            this.cancelBtn.textContent = 'Cancelar';
        }
        if (this.title) this.title.textContent = '';
        if (this.description) this.description.textContent = '';
        if (this.resolve) {
            this.resolve(confirmed);
            this.resolve = null;
        }
    }

    /** Shows a confirmation dialog with Yes/Cancel buttons */
    showConfirm(message, title = 'Confirmar acción') {
        if (!this.modal) return Promise.resolve(false);
        if (this.resolve) this._close(false);

        if (this.title) this.title.textContent = title;
        if (this.description) this.description.textContent = message;
        if (this.input) this.input.style.display = 'none';
        if (this.submitBtn) this.submitBtn.textContent = 'Sí';
        if (this.cancelBtn) {
            this.cancelBtn.style.display = '';
            this.cancelBtn.textContent = 'Cancelar';
        }
        this.modal.classList.remove('hidden');
        return new Promise((resolve) => { this.resolve = resolve; });
    }

    /** Shows an informational dialog with a Close button */
    showInfo(message, title = 'Información') {
        if (!this.modal) return Promise.resolve(false);
        if (this.resolve) this._close(false);

        if (this.title) this.title.textContent = title;
        if (this.description) this.description.textContent = message;
        if (this.input) this.input.style.display = 'none';
        if (this.submitBtn) this.submitBtn.textContent = 'Cerrar';
        if (this.cancelBtn) this.cancelBtn.style.display = 'none';

        this.modal.classList.remove('hidden');
        return new Promise((resolve) => { this.resolve = resolve; });
    }
}
