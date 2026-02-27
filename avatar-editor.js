const CROPPY_CSS = 'https://unpkg.com/croppie/croppie.css';
const CROPPY_JS = 'https://unpkg.com/croppie/croppie.min.js';

function ensureStylesheet(href, id) {
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

function ensureScript(src, id) {
    return new Promise((resolve, reject) => {
        if (window.Croppie) {
            resolve();
            return;
        }
        const existing = document.getElementById(id);
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('Croppie load error')), { once: true });
            return;
        }
        const script = document.createElement('script');
        script.id = id;
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Croppie load error'));
        document.head.appendChild(script);
    });
}

function resolveInput(target) {
    if (!target) throw new Error('fileInput is required');
    if (target instanceof HTMLInputElement) return target;
    const found = document.querySelector(target);
    if (!found || !(found instanceof HTMLInputElement)) throw new Error('fileInput not found');
    return found;
}

export class TelegramAvatarEditor {
    constructor(options) {
        this.options = {
            fileInput: options?.fileInput,
            cssPath: options?.cssPath || './avatar-editor.css',
            title: options?.title || 'Редактор аватара',
            saveText: options?.saveText || 'Обрезать и сохранить',
            cancelText: options?.cancelText || 'Отмена',
            quality: typeof options?.quality === 'number' ? options.quality : 0.92,
            onSave: typeof options?.onSave === 'function' ? options.onSave : async () => {},
            onError: typeof options?.onError === 'function' ? options.onError : () => {}
        };
        this.input = resolveInput(this.options.fileInput);
        this.overlay = null;
        this.croppie = null;
        this.boundOnInput = this.onInputChange.bind(this);
    }

    async init() {
        ensureStylesheet(CROPPY_CSS, 'croppie-css-cdn');
        ensureStylesheet(this.options.cssPath, 'avatar-editor-css-local');
        await ensureScript(CROPPY_JS, 'croppie-js-cdn');
        this.render();
        this.input.addEventListener('change', this.boundOnInput);
    }

    render() {
        if (this.overlay) return;
        const overlay = document.createElement('div');
        overlay.className = 'avatar-editor-overlay';
        overlay.innerHTML = `
            <div class="avatar-editor-modal" role="dialog" aria-modal="true">
                <h3 class="avatar-editor-title">${this.escape(this.options.title)}</h3>
                <div class="avatar-editor-crop-root"></div>
                <div class="avatar-editor-actions">
                    <button class="avatar-editor-btn avatar-editor-btn--ghost" type="button" data-avatar-cancel>${this.escape(this.options.cancelText)}</button>
                    <button class="avatar-editor-btn avatar-editor-btn--primary" type="button" data-avatar-save>${this.escape(this.options.saveText)}</button>
                </div>
                <div class="avatar-editor-error" data-avatar-error></div>
            </div>
        `;

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) this.close();
        });

        overlay.querySelector('[data-avatar-cancel]').addEventListener('click', () => this.close());
        overlay.querySelector('[data-avatar-save]').addEventListener('click', () => this.save());

        document.body.appendChild(overlay);
        this.overlay = overlay;
    }

    async onInputChange(event) {
        const file = event.target?.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            this.setError('Выберите изображение');
            this.input.value = '';
            return;
        }

        try {
            this.setError('');
            const dataUrl = await this.readAsDataUrl(file);
            await this.openEditor(dataUrl);
        } catch (error) {
            this.reportError(error);
        }
    }

    async openEditor(dataUrl) {
        this.open();

        const cropRoot = this.overlay.querySelector('.avatar-editor-crop-root');
        cropRoot.innerHTML = '<div data-avatar-croppie></div>';
        const cropTarget = cropRoot.querySelector('[data-avatar-croppie]');

        if (this.croppie) {
            this.croppie.destroy();
            this.croppie = null;
        }

        this.croppie = new window.Croppie(cropTarget, {
            viewport: { width: 200, height: 200, type: 'circle' },
            boundary: { width: 300, height: 300 },
            showZoomer: true,
            enableZoom: true,
            enableExif: true,
            enableOrientation: true,
            mouseWheelZoom: true
        });

        await this.croppie.bind({ url: dataUrl });
    }

    async save() {
        if (!this.croppie) return;

        try {
            this.setError('');
            const blob = await this.croppie.result({
                type: 'blob',
                format: 'jpeg',
                circle: true,
                quality: this.options.quality
            });

            await this.options.onSave(blob, {
                contentType: 'image/jpeg',
                ext: 'jpg',
                fileName: `avatar_${Date.now()}.jpg`
            });

            this.close();
            this.input.value = '';
        } catch (error) {
            this.reportError(error);
        }
    }

    open() {
        if (!this.overlay) this.render();
        this.overlay.classList.add('is-open');
    }

    close() {
        if (!this.overlay) return;
        this.overlay.classList.remove('is-open');
    }

    destroy() {
        this.input.removeEventListener('change', this.boundOnInput);
        if (this.croppie) {
            this.croppie.destroy();
            this.croppie = null;
        }
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }

    readAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
            reader.readAsDataURL(file);
        });
    }

    reportError(error) {
        const message = error?.message || 'Ошибка редактора аватара';
        this.setError(message);
        this.options.onError(error);
    }

    setError(message) {
        if (!this.overlay) return;
        const el = this.overlay.querySelector('[data-avatar-error]');
        if (el) el.textContent = message || '';
    }

    escape(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

window.TelegramAvatarEditor = TelegramAvatarEditor;
