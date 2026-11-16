/**
 * Chat Avatar — mỗi chat một avatar và một tên hiển thị riêng cho nhân vật.
 *
 * Dữ liệu lưu trong metadata của từng file chat (chat_metadata.chat_avatar = { src, name }),
 * nên đổi chat là đổi theo, branch/backup chat cũng mang theo.
 * Ảnh tải lên được lưu vào data/<user>/user/images/chat-avatars/ trên server.
 *
 * Tên chỉ đổi phần HIỂN THỊ (tin nhắn, danh sách chat). Tên thẻ và {{char}} gửi cho mô hình giữ nguyên.
 *
 * Tự nhận thẻ trong tin nhắn của nhân vật:
 *   [avatar: <link hoặc tên file>]   [name: <tên hiển thị>]
 * → tự đặt cho chat đó và ẩn thẻ khỏi khung chat.
 */
(() => {
    'use strict';

    const MODULE = 'chat_avatar';
    const META_KEY = 'chat_avatar';
    const FOLDER = 'chat-avatars';
    const TAG_RE = /\[(avatar|name):\s*([^\]\n]+?)\s*\]/gi;
    // Dạng đã render: link có thể bị tự chuyển thành thẻ <a>
    const TAG_HTML_RE = /\[(?:avatar|name):\s*(?:<a\b[^>]*>[^<]*<\/a>|[^\]<\n]+?)\s*\]/gi;
    const TAG_TEST_RE = /\[(?:avatar|name):/i;

    const MAX_SIZE = 768;      // cạnh dài tối đa của ảnh tải lên (px)
    const CROP_ASPECT = 2 / 3; // giống khung avatar gốc của ST
    const MAX_NAME = 80;

    const ctx = () => SillyTavern.getContext();

    /** Cài đặt lưu trên server: chỉ có bảng tra "<file thẻ>::<tên chat>" → { src, name }. */
    function settings() {
        const all = ctx().extensionSettings;
        if (!all[MODULE] || typeof all[MODULE] !== 'object') all[MODULE] = {};
        const s = all[MODULE];
        if (!s.index || typeof s.index !== 'object') s.index = {};
        return s;
    }

    function notify(type, msg) {
        if (globalThis.toastr?.[type]) globalThis.toastr[type](msg, 'Chat Avatar');
        else console.log(`[Chat Avatar] ${msg}`);
    }

    // ---------- Dữ liệu theo chat ----------

    function isSoloChat() {
        const c = ctx();
        return !c.groupId && c.characterId !== undefined && c.characterId !== null && !!c.getCurrentChatId();
    }

    function getMeta() {
        if (!isSoloChat()) return null;
        return ctx().chatMetadata?.[META_KEY] || null;
    }

    function getChatAvatarSrc() {
        return getMeta()?.src || '';
    }

    function getChatName() {
        return getMeta()?.name || '';
    }

    function cleanName(v) {
        return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    }

    /** Chuyển giá trị lưu trữ thành URL hiển thị được. */
    function resolveSrc(v) {
        v = String(v || '').trim();
        if (!v) return '';
        if (/^(https?:|data:|blob:)/i.test(v)) return v;
        if (v.startsWith('/')) return v;
        if (v.startsWith('user/')) return '/' + v;
        // Tên file trần → lấy trong thư mục chat-avatars của user
        return `/user/images/${FOLDER}/` + v.split('/').map(encodeURIComponent).join('/');
    }

    /**
     * Cập nhật dữ liệu của chat đang mở. patch: { src?, name? } — chuỗi rỗng = bỏ, dùng lại của thẻ.
     * Metadata vẫn được giữ (kể cả khi rỗng) để đánh dấu "đã chỉnh tay", tránh tự nhận lại thẻ cũ.
     */
    async function updateChat(patch, source = 'manual') {
        if (!isSoloChat()) {
            notify('warning', 'Chỉ dùng được trong chat 1-1 đang mở (không hỗ trợ group chat).');
            return false;
        }
        const c = ctx();
        const next = { ...(c.chatMetadata[META_KEY] || {}), ...patch, source, at: Date.now() };
        delete next.cleared; // trường cũ (≤ 1.3)
        if (!next.src) delete next.src;
        if (!next.name) delete next.name;
        c.chatMetadata[META_KEY] = next;
        await c.saveMetadata();
        syncIndex();
        applyAll();
        refreshModal();
        return true;
    }

    const setChatAvatar = (src, source) => updateChat({ src: String(src || '').trim() }, source);
    const setChatName = (name, source) => updateChat({ name: cleanName(name) }, source);

    // ---------- Bảng tra cho danh sách chat ----------
    // Danh sách "chat gần đây" và "lịch sử chat" không đọc metadata của từng chat,
    // nên lưu thêm một bảng tra nhỏ trong cài đặt của extension.

    function chatKey(avatar, file) {
        return `${avatar}::${String(file || '').replace(/\.jsonl$/i, '')}`;
    }

    function currentKey() {
        const c = ctx();
        const ch = c.characters?.[c.characterId];
        return ch?.avatar ? chatKey(ch.avatar, c.getCurrentChatId()) : '';
    }

    /** Đọc một mục trong bảng tra (bản ≤ 1.3 lưu thẳng chuỗi src). */
    function readIndex(key) {
        const v = settings().index[key];
        if (!v) return {};
        return typeof v === 'string' ? { src: v } : v;
    }

    function syncIndex() {
        if (!isSoloChat()) return;
        const key = currentKey();
        if (!key) return;
        const idx = settings().index;
        const entry = {};
        if (getChatAvatarSrc()) entry.src = getChatAvatarSrc();
        if (getChatName()) entry.name = getChatName();
        const had = JSON.stringify(idx[key] ?? null);
        if (entry.src || entry.name) idx[key] = entry;
        else delete idx[key];
        if (JSON.stringify(idx[key] ?? null) !== had) ctx().saveSettingsDebounced();
    }

    function onChatRenamed(data) {
        if (!data?.avatarId || data.groupId) return;
        const idx = settings().index;
        const from = chatKey(data.avatarId, data.oldFileName);
        if (!(from in idx)) return;
        idx[chatKey(data.avatarId, data.newFileName)] = idx[from];
        delete idx[from];
        ctx().saveSettingsDebounced();
        applyLists();
    }

    function onChatDeleted(name) {
        const c = ctx();
        const ch = !c.groupId && c.characters?.[c.characterId];
        if (!ch?.avatar) return;
        const key = chatKey(ch.avatar, name);
        const idx = settings().index;
        if (key in idx) {
            delete idx[key];
            ctx().saveSettingsDebounced();
        }
    }

    // ---------- Hiển thị ----------

    function defaultAvatarUrl() {
        const c = ctx();
        const ch = c.characters?.[c.characterId];
        return ch?.avatar ? c.getThumbnailUrl('avatar', ch.avatar) : '';
    }

    function stripTag(mes) {
        const t = mes.querySelector('.mes_text');
        if (!t || t.querySelector('textarea')) return; // đang sửa tin nhắn thì không đụng
        const html = t.innerHTML;
        if (!TAG_TEST_RE.test(html)) return;
        const next = html
            .replace(new RegExp(`(?:<br\\s*/?>\\s*)?${TAG_HTML_RE.source}`, 'gi'), '') // bỏ cả dòng chứa thẻ
            .replace(/<p>(?:\s*<br\s*\/?>)+/gi, '<p>')
            .replace(/(?:<br\s*\/?>\s*)+<\/p>/gi, '</p>')
            .replace(/<p>\s*<\/p>/gi, '');
        if (next !== html) t.innerHTML = next;
    }

    /** Đặt ảnh riêng (want) hoặc trả lại ảnh gốc (want rỗng). Trả về true nếu đang dùng ảnh riêng. */
    function setImg(img, want) {
        if (want) {
            if (!('caOrig' in img.dataset)) img.dataset.caOrig = img.getAttribute('src') || '';
            if (img.getAttribute('src') !== want) img.setAttribute('src', want);
            return true;
        }
        if ('caOrig' in img.dataset) {
            const orig = img.dataset.caOrig;
            delete img.dataset.caOrig;
            if (img.getAttribute('src') !== orig) img.setAttribute('src', orig);
        }
        return false;
    }

    /** Đặt tên riêng (want) hoặc trả lại tên gốc (want rỗng). */
    function setText(el, want) {
        if (want) {
            if (!('caOrigName' in el.dataset)) el.dataset.caOrigName = el.textContent;
            if (el.textContent !== want) el.textContent = want;
            return;
        }
        if ('caOrigName' in el.dataset) {
            const orig = el.dataset.caOrigName;
            delete el.dataset.caOrigName;
            if (el.textContent !== orig) el.textContent = orig;
        }
    }

    function currentWant() {
        return { src: resolveSrc(getChatAvatarSrc()), name: getChatName(), charName: ctx().name2 };
    }

    function applyOne(mes, want) {
        const isChar = mes.getAttribute('is_user') !== 'true'
            && mes.getAttribute('is_system') !== 'true'
            && mes.getAttribute('ch_name') === want.charName;

        const img = mes.querySelector('.avatar img');
        if (img) mes.classList.toggle('ca-custom', setImg(img, isChar ? want.src : ''));

        const nameEl = mes.querySelector('.ch_name .name_text');
        if (nameEl) setText(nameEl, isChar ? want.name : '');

        if (mes.getAttribute('is_user') !== 'true') stripTag(mes);
    }

    /** Danh sách "Chat gần đây" (màn hình chào) và "Lịch sử chat" (Manage chat files). */
    function applyLists() {
        const lookup = (avatar, file) => (avatar && file) ? readIndex(chatKey(avatar, file)) : {};

        document.querySelectorAll('.recentChat[data-file]').forEach(item => {
            const entry = lookup(item.getAttribute('data-avatar'), item.getAttribute('data-file'));
            const img = item.querySelector('.avatar img');
            if (img) setImg(img, resolveSrc(entry.src));
            const nameEl = item.querySelector('.characterName');
            if (nameEl) setText(nameEl, entry.name || '');
        });

        const c = ctx();
        const ch = !c.groupId && c.characters?.[c.characterId];
        document.querySelectorAll('#select_chat_div .select_chat_block_wrapper').forEach(w => {
            const img = w.querySelector('.avatar img');
            const file = w.querySelector('.select_chat_block[file_name]')?.getAttribute('file_name');
            if (img) setImg(img, ch ? resolveSrc(lookup(ch.avatar, file).src) : '');
        });
    }

    function applyAll() {
        const want = currentWant();
        document.querySelectorAll('#chat .mes').forEach(mes => applyOne(mes, want));
        applyLists();
    }

    // Chỉ xử lý những tin nhắn vừa thay đổi (nhẹ khi đang stream).
    // Chạy ngay trong callback của MutationObserver (trước khi vẽ) để không chớp ảnh/tên gốc.
    const pending = new Set();
    let listsDirty = false;
    function flush() {
        const want = currentWant();
        for (const mes of pending) {
            if (mes.isConnected) applyOne(mes, want);
        }
        pending.clear();
        if (listsDirty) {
            listsDirty = false;
            applyLists();
        }
    }
    const LIST_SEL = '.recentChat, .select_chat_block_wrapper';
    function onMutations(records) {
        for (const r of records) {
            const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
            const mes = el?.closest?.('.mes');
            if (mes) pending.add(mes);
            if (el?.closest?.(LIST_SEL)) listsDirty = true;
            r.addedNodes.forEach(n => {
                if (n.nodeType !== 1) return;
                if (n.classList.contains('mes')) pending.add(n);
                else n.querySelectorAll?.('.mes').forEach(m => pending.add(m));
                if (n.matches?.(LIST_SEL) || n.querySelector?.(LIST_SEL)) listsDirty = true;
            });
        }
        if (pending.size || listsDirty) flush();
    }

    // ---------- Tự nhận thẻ [avatar: ...] / [name: ...] ----------

    /** Lấy thẻ cuối cùng của mỗi loại trong một tin nhắn. */
    function findTags(text) {
        const out = {};
        for (const m of String(text || '').matchAll(TAG_RE)) {
            const kind = m[1].toLowerCase();
            out[kind === 'avatar' ? 'src' : 'name'] = kind === 'name' ? cleanName(m[2]) : m[2].trim();
        }
        return out;
    }

    async function scanMessage(id) {
        if (!isSoloChat()) return;
        const msg = ctx().chat?.[Number(id)];
        if (!msg || msg.is_user || msg.is_system) return;
        const tags = findTags(msg.mes);
        const patch = {};
        if (tags.src && tags.src !== getChatAvatarSrc()) patch.src = tags.src;
        if (tags.name && tags.name !== getChatName()) patch.name = tags.name;
        if (Object.keys(patch).length) await updateChat(patch, 'tag');
    }

    /** Khi mở chat chưa chỉnh gì: tìm thẻ gần nhất của mỗi loại trong lịch sử. */
    async function scanHistory() {
        if (!isSoloChat()) return;
        if (getMeta()) return; // đã đặt hoặc đã chủ động bỏ
        const chat = ctx().chat || [];
        const patch = {};
        for (let i = chat.length - 1; i >= 0 && !(patch.src && patch.name); i--) {
            const msg = chat[i];
            if (msg.is_user || msg.is_system) continue;
            const tags = findTags(msg.mes);
            if (!patch.src && tags.src) patch.src = tags.src;
            if (!patch.name && tags.name) patch.name = tags.name;
        }
        if (patch.src || patch.name) await updateChat(patch, 'tag');
    }

    // ---------- Tải ảnh lên ----------

    function loadImage(blob) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được file ảnh')); };
            img.src = url;
        });
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.onerror = () => reject(new Error('Không đọc được file ảnh'));
            r.readAsDataURL(blob);
        });
    }

    /**
     * Mở khung cắt ảnh có sẵn của SillyTavern (giống lúc đổi avatar gốc).
     * @returns {Promise<Blob|null|undefined>} Blob đã cắt; null nếu người dùng huỷ;
     *          undefined nếu ST không có khung cắt (khi đó dùng nguyên ảnh).
     */
    async function cropWithST(blob) {
        const c = ctx();
        if (!c.Popup || c.POPUP_TYPE?.CROP === undefined) return undefined;
        const dataUrl = await blobToDataUrl(blob);
        const dlg = new c.Popup('Chọn vùng ảnh làm avatar cho chat này', c.POPUP_TYPE.CROP, '', {
            cropImage: dataUrl,
            cropAspect: CROP_ASPECT,
        });
        const result = await dlg.show();
        if (!result || typeof result !== 'string') return null;
        return await (await fetch(result)).blob();
    }

    async function uploadImage(file) {
        if (!file?.type?.startsWith('image/')) throw new Error('File không phải ảnh');
        const img = await loadImage(file);
        const scale = Math.min(1, MAX_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

        let lastErr = '';
        for (const fmt of ['webp', 'png']) {
            const dataUrl = canvas.toDataURL(`image/${fmt}`, 0.92);
            if (!dataUrl.startsWith(`data:image/${fmt}`)) continue; // trình duyệt không hỗ trợ
            try {
                const res = await fetch('/api/images/upload', {
                    method: 'POST',
                    headers: ctx().getRequestHeaders(),
                    body: JSON.stringify({
                        image: dataUrl.split(',')[1],
                        format: fmt,
                        ch_name: FOLDER,
                        filename: `ca_${Date.now()}`,
                    }),
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data?.path) return data.path;
                    lastErr = 'Server không trả về đường dẫn ảnh';
                } else {
                    lastErr = await res.text().catch(() => res.statusText);
                }
            } catch (e) {
                lastErr = e?.message || String(e);
            }
        }
        throw new Error(lastErr || 'Tải ảnh lên thất bại');
    }

    // ---------- Hộp thoại ----------

    let modal = null;

    function closeModal() {
        modal?.remove();
        modal = null;
        document.removeEventListener('keydown', onModalKey, true);
    }

    function onModalKey(e) {
        if (e.key !== 'Escape') return;
        if (document.querySelector('dialog[open]')) return; // để khung cắt ảnh của ST tự xử lý Esc
        e.stopPropagation();
        closeModal();
    }

    function setStatus(text, isError = false) {
        const el = modal?.querySelector('.ca-status');
        if (!el) return;
        el.textContent = text;
        el.classList.toggle('ca-error', isError);
    }

    function refreshModal() {
        if (!modal) return;
        if (!isSoloChat()) { closeModal(); return; }
        const src = getChatAvatarSrc();
        const name = getChatName();
        const c = ctx();
        modal.querySelector('.ca-preview').src = src ? resolveSrc(src) : defaultAvatarUrl();
        modal.querySelector('.ca-chatname').textContent = `${name || c.name2} · ${c.getCurrentChatId()}`;
        modal.querySelector('.ca-clear').disabled = !src;
        modal.querySelector('.ca-recrop').disabled = !src;
        const nameInput = modal.querySelector('.ca-name');
        nameInput.placeholder = c.name2;
        if (document.activeElement !== nameInput) nameInput.value = name;
        const urlInput = modal.querySelector('.ca-url');
        if (document.activeElement !== urlInput) urlInput.value = src && !src.startsWith('data:') ? src : '';
        setStatus(src ? 'Đang dùng avatar riêng cho chat này.' : 'Đang dùng ảnh gốc của thẻ.');
    }

    let busy = false;
    async function handleFile(file) {
        if (!file || busy) return;
        busy = true;
        try {
            setStatus('Chọn vùng ảnh trong khung cắt…');
            const cropped = await cropWithST(file);
            if (cropped === null) { setStatus('Đã huỷ, avatar giữ nguyên.'); return; }
            const source = cropped || file;
            setStatus('Đang tải ảnh lên…');
            const path = await uploadImage(source);
            await setChatAvatar(path, 'upload');
            notify('success', 'Đã đặt avatar cho chat này.');
        } catch (e) {
            console.error('[Chat Avatar]', e);
            setStatus(`Lỗi: ${e.message || e}`, true);
        } finally {
            busy = false;
        }
    }

    /** Cắt lại avatar đang dùng. */
    async function recropCurrent() {
        const src = getChatAvatarSrc();
        if (!src) return;
        try {
            const res = await fetch(resolveSrc(src));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            await handleFile(new File([blob], 'avatar', { type: blob.type || 'image/png' }));
        } catch (e) {
            console.error('[Chat Avatar]', e);
            setStatus('Không lấy được ảnh hiện tại để cắt (link ngoài có thể chặn). Hãy tải ảnh về rồi tải lên lại.', true);
        }
    }

    function openModal() {
        closeModal();
        if (ctx().groupId) { notify('warning', 'Group chat chưa được hỗ trợ.'); return; }
        if (!isSoloChat()) { notify('info', 'Hãy mở một chat với nhân vật trước.'); return; }

        modal = document.createElement('div');
        modal.id = 'ca_modal';
        modal.innerHTML = `
            <div class="ca-dialog" role="dialog" aria-modal="true" aria-label="Avatar và tên cho chat này">
                <div class="ca-head">
                    <b>Avatar & tên cho chat này</b>
                    <button class="ca-x fa-solid fa-xmark" title="Đóng" aria-label="Đóng"></button>
                </div>
                <div class="ca-chatname"></div>
                <div class="ca-drop" tabindex="0" title="Bấm để chọn ảnh">
                    <img class="ca-preview" alt="">
                    <div class="ca-hint">Bấm, kéo thả ảnh vào đây, hoặc Ctrl+V</div>
                </div>
                <div class="ca-row">
                    <input class="text_pole ca-name" type="text" maxlength="${MAX_NAME}" aria-label="Tên hiển thị" title="Để trống rồi Lưu để dùng tên gốc của thẻ">
                    <button class="menu_button ca-name-save">Lưu tên</button>
                </div>
                <div class="ca-row">
                    <button class="menu_button ca-upload"><i class="fa-solid fa-upload"></i> Tải ảnh lên</button>
                    <button class="menu_button ca-recrop"><i class="fa-solid fa-crop-simple"></i> Cắt lại</button>
                </div>
                <div class="ca-row">
                    <button class="menu_button ca-clear"><i class="fa-solid fa-rotate-left"></i> Dùng ảnh gốc của thẻ</button>
                </div>
                <div class="ca-row">
                    <input class="text_pole ca-url" type="text" placeholder="Link ảnh, hoặc tên file trong thư mục ${FOLDER}">
                    <button class="menu_button ca-apply">Áp dụng</button>
                </div>
                <div class="ca-status"></div>
                <input class="ca-file" type="file" accept="image/*" hidden>
            </div>`;
        document.body.append(modal);

        const q = sel => modal.querySelector(sel);
        const fileInput = q('.ca-file');
        const pick = () => fileInput.click();

        modal.addEventListener('mousedown', e => { if (e.target === modal) closeModal(); });
        q('.ca-x').addEventListener('click', closeModal);
        q('.ca-upload').addEventListener('click', pick);
        q('.ca-drop').addEventListener('click', pick);
        q('.ca-drop').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
        fileInput.addEventListener('change', () => { handleFile(fileInput.files?.[0]); fileInput.value = ''; });

        const drop = q('.ca-drop');
        drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('ca-over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('ca-over'));
        drop.addEventListener('drop', e => {
            e.preventDefault();
            drop.classList.remove('ca-over');
            handleFile([...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/')));
        });
        modal.addEventListener('paste', e => {
            const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
            if (item) { e.preventDefault(); handleFile(item.getAsFile()); }
        });

        const saveName = async () => {
            const input = q('.ca-name');
            const v = cleanName(input.value);
            if (v === getChatName()) return;
            input.blur();
            await setChatName(v, 'manual');
            notify('success', v ? `Đã đổi tên hiển thị thành “${v}”.` : 'Đã dùng lại tên gốc của thẻ.');
        };
        q('.ca-name-save').addEventListener('click', saveName);
        q('.ca-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveName(); } });

        const applyUrl = async () => {
            const input = q('.ca-url');
            const v = input.value.trim();
            if (!v) { setStatus('Nhập link ảnh trước đã.', true); return; }
            input.blur();
            await setChatAvatar(v, 'url');
        };
        q('.ca-apply').addEventListener('click', applyUrl);
        q('.ca-url').addEventListener('keydown', e => { if (e.key === 'Enter') applyUrl(); });
        q('.ca-clear').addEventListener('click', () => setChatAvatar('', 'manual'));
        q('.ca-recrop').addEventListener('click', recropCurrent);
        q('.ca-preview').addEventListener('error', () => {
            if (getChatAvatarSrc()) setStatus('Không tải được ảnh này — kiểm tra lại link hoặc tên file.', true);
        });

        document.addEventListener('keydown', onModalKey, true);
        refreshModal();
        drop.focus();
    }

    // ---------- Phóng to avatar ----------
    // ST đoán file ảnh từ link thumbnail nên với ảnh riêng sẽ bị vỡ → tự xử lý.

    function showZoom(src) {
        document.getElementById('ca_zoom')?.remove();
        const z = document.createElement('div');
        z.id = 'ca_zoom';
        z.title = 'Bấm để đóng';
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        z.append(img);
        z.addEventListener('click', () => z.remove());
        document.body.append(z);
    }

    function onAvatarClick(e) {
        const av = e.target?.closest?.('#chat .mes.ca-custom .avatar');
        if (!av) return;
        e.stopPropagation();
        e.preventDefault();
        const src = av.querySelector('img')?.src;
        if (src) showZoom(src);
    }

    // ---------- Menu & lệnh ----------

    function addMenuButton() {
        const menu = document.getElementById('extensionsMenu');
        if (!menu || document.getElementById('ca_menu_btn')) return;
        const btn = document.createElement('div');
        btn.id = 'ca_menu_btn';
        btn.className = 'list-group-item flex-container flexGap5 interactable';
        btn.tabIndex = 0;
        btn.innerHTML = '<div class="fa-solid fa-image-portrait extensionsMenuExtensionButton"></div><span>Avatar & tên cho chat này</span>';
        btn.addEventListener('click', openModal);
        menu.append(btn);
    }

    function registerCommand(name, getter, setter, help, argHelp) {
        const c = ctx();
        const handler = async (_args, value) => {
            const v = String(value ?? '').trim();
            if (!v) return getter();
            if (/^(clear|reset|xoa|xoá)$/i.test(v)) {
                await setter('', 'command');
                return '';
            }
            await setter(v, 'command');
            return getter();
        };
        try {
            if (c.SlashCommandParser && c.SlashCommand) {
                c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
                    name,
                    callback: handler,
                    returns: 'giá trị hiện tại của chat',
                    unnamedArgumentList: [
                        c.SlashCommandArgument.fromProps({
                            description: argHelp,
                            typeList: [c.ARGUMENT_TYPE.STRING],
                            isRequired: false,
                        }),
                    ],
                    helpString: help,
                }));
            } else if (c.registerSlashCommand) {
                c.registerSlashCommand(name, handler, [], help, true, true);
            }
        } catch (e) {
            console.warn(`[Chat Avatar] Không đăng ký được lệnh /${name}`, e);
        }
    }

    // ---------- Khởi động ----------

    function init() {
        // Dọn các tuỳ chọn cũ (bản ≤ 1.2 có bảng cài đặt)
        const s = settings();
        let cleaned = false;
        for (const k of Object.keys(s)) {
            if (k !== 'index') { delete s[k]; cleaned = true; }
        }
        if (cleaned) ctx().saveSettingsDebounced();

        addMenuButton();
        registerCommand('chatavatar', getChatAvatarSrc, setChatAvatar,
            'Đặt avatar nhân vật riêng cho chat đang mở. Không có tham số: trả về avatar hiện tại. "clear": dùng lại ảnh gốc.',
            'link ảnh, tên file trong thư mục chat-avatars, hoặc "clear"');
        registerCommand('chatname', getChatName, setChatName,
            'Đặt tên hiển thị riêng của nhân vật cho chat đang mở (chỉ đổi phần hiển thị). Không có tham số: trả về tên hiện tại. "clear": dùng lại tên gốc.',
            'tên hiển thị, hoặc "clear"');

        const observer = new MutationObserver(onMutations);
        for (const id of ['chat', 'select_chat_div']) {
            const el = document.getElementById(id);
            if (el) {
                observer.observe(el, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['src'],
                });
            }
        }
        window.addEventListener('click', onAvatarClick, true);

        const { eventSource, eventTypes } = ctx();
        eventSource.on(eventTypes.CHAT_CHANGED, async () => {
            closeModal();
            syncIndex();
            applyAll();
            await scanHistory();
        });
        if (eventTypes.CHAT_RENAMED) eventSource.on(eventTypes.CHAT_RENAMED, onChatRenamed);
        if (eventTypes.CHAT_DELETED) eventSource.on(eventTypes.CHAT_DELETED, onChatDeleted);
        for (const ev of ['MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'CHARACTER_MESSAGE_RENDERED']) {
            if (eventTypes[ev]) eventSource.on(eventTypes[ev], id => scanMessage(id));
        }

        applyAll();
        scanHistory();
        console.log('[Chat Avatar] loaded');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
