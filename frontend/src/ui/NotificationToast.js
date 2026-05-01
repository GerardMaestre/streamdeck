export class NotificationToast {
    constructor() {
        this.container = document.getElementById('toast-container');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
        
        // Add styles if not present
        if (!document.getElementById('toast-styles')) {
            const style = document.createElement('style');
            style.id = 'toast-styles';
            style.innerHTML = `
                .toast-container {
                    position: fixed;
                    bottom: 30px;
                    left: 50%;
                    transform: translateX(-50%);
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    z-index: 10000;
                    pointer-events: none;
                }
                .toast {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 20px;
                    border-radius: 12px;
                    background: rgba(20, 20, 25, 0.85);
                    backdrop-filter: blur(10px);
                    -webkit-backdrop-filter: blur(10px);
                    color: white;
                    font-family: 'Inter', system-ui, sans-serif;
                    font-size: 1.1rem;
                    font-weight: 500;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    opacity: 0;
                    transform: translateY(20px) scale(0.95);
                    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                    pointer-events: auto;
                }
                .toast.show {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
                .toast.hide {
                    opacity: 0;
                    transform: translateY(20px) scale(0.95);
                }
                .toast-icon {
                    font-size: 1.5rem;
                }
                .toast.success { border-bottom: 3px solid #2ecc71; }
                .toast.error { border-bottom: 3px solid #e74c3c; }
                .toast.warning { border-bottom: 3px solid #f39c12; }
                .toast.info { border-bottom: 3px solid #3498db; }
            `;
            document.head.appendChild(style);
        }
    }

    show(message, type = 'info', durationMs = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let icon = 'ℹ️';
        if (type === 'success') icon = '✅';
        if (type === 'error') icon = '❌';
        if (type === 'warning') icon = '⚠️';

        const iconEl = document.createElement('span');
        iconEl.className = 'toast-icon';
        iconEl.textContent = icon;

        const messageEl = document.createElement('span');
        messageEl.className = 'toast-message';
        messageEl.textContent = String(message ?? '');

        toast.appendChild(iconEl);
        toast.appendChild(messageEl);
        
        this.container.appendChild(toast);
        
        // Trigger reflow
        toast.offsetWidth;
        
        toast.classList.add('show');

        // Allow dismissing by clicking
        toast.addEventListener('click', () => {
            this._removeToast(toast);
        });

        if (durationMs > 0) {
            setTimeout(() => {
                this._removeToast(toast);
            }, durationMs);
        }
    }

    _removeToast(toast) {
        if (!toast.parentNode) return;
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 300);
    }
}
