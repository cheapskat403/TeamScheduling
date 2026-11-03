/**
 * In-app confirmation dialog. Use it instead of window.confirm(): the browser's popup looks out of place,
 * and some browsers (including embedded ones) block it by silently answering "no".
 *
 *   if (!await askConfirm('Delete this booking?', { title: 'Delete booking', confirmLabel: 'Delete' })) return;
 *
 * Resolves true for the confirm button, false for Cancel, Escape or a click outside the dialog.
 * The focus starts on Cancel, so pressing Enter by accident does not delete anything.
 *
 * Also available as window.confirmDialog, for scripts that are not modules (floor-plan.js).
 */

let open = null;   // the dialog on screen, if any, so a second call cannot stack another on top

export function askConfirm(message, { title = 'Are you sure?', confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true } = {}) {
    if (open) return open;

    open = new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal active confirm-modal';
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = `
            <div class="modal-content modal-small">
                <div class="modal-header"><h2></h2></div>
                <div class="confirm-body">
                    <p class="confirm-text"></p>
                    <div class="form-actions">
                        <button type="button" class="btn btn-secondary" data-confirm="no"></button>
                        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm="yes"></button>
                    </div>
                </div>
            </div>`;
        overlay.querySelector('h2').textContent = title;
        overlay.querySelector('.confirm-text').textContent = message;
        overlay.querySelector('[data-confirm="yes"]').textContent = confirmLabel;
        overlay.querySelector('[data-confirm="no"]').textContent = cancelLabel;
        overlay.setAttribute('aria-label', title);

        const finish = (answer) => {
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            open = null;
            resolve(answer);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
        };
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) return finish(false);
            const btn = e.target.closest('[data-confirm]');
            if (btn) finish(btn.dataset.confirm === 'yes');
        });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
        overlay.querySelector('[data-confirm="no"]').focus();
    });
    return open;
}

window.confirmDialog = askConfirm;
