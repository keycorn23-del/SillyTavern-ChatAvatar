/**
 * Chat Avatar — mỗi chat một avatar riêng cho nhân vật.
 *
 * Avatar được lưu trong metadata của từng file chat (chat_metadata.chat_avatar),
 * nên đổi chat là đổi avatar, branch/backup chat cũng mang theo.
 * Ảnh tải lên được lưu vào data/<user>/user/images/chat-avatars/ trên server.
 *
 * Tự nhận thẻ: nếu tin nhắn của nhân vật có dạng  [avatar: <link hoặc tên file>]
 * thì extension tự đặt avatar cho chat đó và ẩn thẻ khỏi khung chat.
 */
(() => {
    'use strict';

    const MODULE = 'chat_avatar';
    const META_KEY = 'chat_avatar';
    const FOLDER = 'chat-avatars';
    const TAG_RE = /\[avatar:\s*([^\]\n]+?)\s*\]/i;
    // Dạng đã render: link có thể bị tự chuyển thành thẻ <a>
    const TAG_HTML_RE = /\[avatar:\s*(?:<a\b[^>]*>[^<]*<\/a>|[^\]<\n]+?)\s*\]/gi;

    const DEFAULTS = {
        enabled: true,
        autoTag: true,
        hideTag: true,
        maxSize: 768,
        index: {}, // "<file thẻ>::<tên chat>" → avatar, dùng cho danh sách chat gần đây / lịch sử chat
    };

    const ctx = () => SillyTavern.getContext();

    function settings() {
        const all = ctx().extensionSettings;
        if (!all[MODULE] || typeof all[MODULE] !== 'object') all[MODULE] = {};
        const s = all[MODULE];
        for (const [k, v] of Object.entries(DEFAULTS)) {
            if (s[k] === undefined) s[k] = (v && typeof v === 'object') ? {} : v;
        }
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
        const m = getMeta();
        return m?.src ? m.src : '';
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

    async function setChatAvatar(src, source = 'manual') {
        if (!isSoloChat()) {
            notify('warning', 'Chỉ dùng được trong chat 1-1 đang mở (không hỗ trợ group chat).');
            return false;
        }
        const c = ctx();
        c.chatMetadata[META_KEY] = src
            ? { src, source, at: Date.now() }
            : { src: '', cleared: true, at: Date.now() };
        await c.saveMetadata();
        syncIndex();
        applyAll();
        refreshModal();
        return true;
    }

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

    function syncIndex() {
        if (!isSoloChat()) return;
        const key = currentKey();
        if (!key) return;
        const idx = settings().index;
        const src = getChatAvatarSrc();
        let changed = false;
        if (src && idx[key] !== src) { idx[key] = src; changed = true; }
        if (!src && key in idx) { delete idx[key]; changed = true; }
        if (changed) ctx().saveSettingsDebounced();
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
        if (!/\[avatar:/i.test(html)) return;
        const next = html.replace(TAG_HTML_RE, '');
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

    function applyOne(mes, want, charName) {
        const img = mes.querySelector('.avatar img');
        const isChar = mes.getAttribute('is_user') !== 'true'
            && mes.getAttribute('is_system') !== 'true'
            && mes.getAttribute('ch_name') === charName;

        if (img) {
            mes.classList.toggle('ca-custom', setImg(img, isChar ? want : ''));
        }

        if (settings().enabled && settings().hideTag && mes.getAttribute('is_user') !== 'true') {
            stripTag(mes);
        }
    }

    function currentWant() {
        return settings().enabled ? resolveSrc(getChatAvatarSrc()) : '';
    }

    /** Danh sách "Chat gần đây" (màn hình chào) và "Lịch sử chat" (Manage chat files). */
    function applyLists() {
        const enabled = settings().enabled;
        const idx = settings().index;
        const lookup = (avatar, file) => (enabled && avatar && file) ? resolveSrc(idx[chatKey(avatar, file)]) : '';

        document.querySelectorAll('.recentChat[data-file]').forEach(item => {
            const img = item.querySelector('.avatar img');
            if (img) setImg(img, lookup(item.getAttribute('data-avatar'), item.getAttribute('data-file')));
        });

        const c = ctx();
        const ch = !c.groupId && c.characters?.[c.characterId];
        document.querySelectorAll('#select_chat_div .select_chat_block_wrapper').forEach(w => {
            const img = w.querySelector('.avatar img');
            const file = w.querySelector('.select_chat_block[file_name]')?.getAttribute('file_name');
            if (img) setImg(img, ch ? lookup(ch.avatar, file) : '');
        });
    }

    function applyAll() {
        const want = currentWant();
        const name = ctx().name2;
        document.querySelectorAll('#chat .mes').forEach(mes => applyOne(mes, want, name));
        applyLists();
    }

    // Chỉ xử lý những tin nhắn vừa thay đổi (nhẹ khi đang stream).
    // Chạy ngay trong callback của MutationObserver (trước khi vẽ) để không chớp ảnh gốc.
    const pending = new Set();
    let listsDirty = false;
    function flush() {
        const want = currentWant();
        const name = ctx().name2;
        for (const mes of pending) {
            if (mes.isConnected) applyOne(mes, want, name);
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

    // ---------- Tự nhận thẻ [avatar: ...] ----------

    function findTag(text) {
        const m = TAG_RE.exec(String(text || ''));
        return m ? m[1] : '';
    }

    async function scanMessage(id) {
        const s = settings();
        if (!s.enabled || !s.autoTag || !isSoloChat()) return;
        const msg = ctx().chat?.[Number(id)];
        if (!msg || msg.is_user || msg.is_system) return;
        const tag = findTag(msg.mes);
        if (tag && tag !== getChatAvatarSrc()) await setChatAvatar(tag, 'tag');
    }

    /** Khi mở chat chưa có avatar riêng: tìm thẻ gần nhất trong lịch sử. */
    async function scanHistory() {
        const s = settings();
        if (!s.enabled || !s.autoTag || !isSoloChat()) return;
        if (getMeta()) return; // đã đặt hoặc đã chủ động xoá
        const chat = ctx().chat || [];
        for (let i = chat.length - 1; i >= 0; i--) {
            const msg = chat[i];
            if (msg.is_user || msg.is_system) continue;
            const tag = findTag(msg.mes);
            if (tag) {
                await setChatAvatar(tag, 'tag');
                return;
            }
        }
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

    async function uploadImage(file) {
        if (!file?.type?.startsWith('image/')) throw new Error('File không phải ảnh');
        const img = await loadImage(file);
        const max = Math.max(128, Number(settings().maxSize) || DEFAULTS.maxSize);
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
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
        if (e.key === 'Escape') { e.stopPropagation(); closeModal(); }
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
        const c = ctx();
        modal.querySelector('.ca-preview').src = src ? resolveSrc(src) : defaultAvatarUrl();
        modal.querySelector('.ca-chatname').textContent = `${c.name2} · ${c.getCurrentChatId()}`;
        modal.querySelector('.ca-clear').disabled = !src;
        modal.querySelector('.ca-url').value = src && !src.startsWith('data:') ? src : '';
        setStatus(src ? 'Đang dùng avatar riêng cho chat này.' : 'Đang dùng ảnh gốc của thẻ.');
    }

    async function handleFile(file) {
        if (!file) return;
        try {
            setStatus('Đang tải ảnh lên…');
            const path = await uploadImage(file);
            await setChatAvatar(path, 'upload');
            notify('success', 'Đã đặt avatar cho chat này.');
        } catch (e) {
            console.error('[Chat Avatar]', e);
            setStatus(`Lỗi: ${e.message || e}`, true);
        }
    }

    function openModal() {
        closeModal();
        if (ctx().groupId) { notify('warning', 'Group chat chưa được hỗ trợ.'); return; }
        if (!isSoloChat()) { notify('info', 'Hãy mở một chat với nhân vật trước.'); return; }

        modal = document.createElement('div');
        modal.id = 'ca_modal';
        modal.innerHTML = `
            <div class="ca-dialog" role="dialog" aria-modal="true" aria-label="Avatar cho chat này">
                <div class="ca-head">
                    <b>Avatar cho chat này</b>
                    <button class="ca-x fa-solid fa-xmark" title="Đóng" aria-label="Đóng"></button>
                </div>
                <div class="ca-chatname"></div>
                <div class="ca-drop" tabindex="0" title="Bấm để chọn ảnh">
                    <img class="ca-preview" alt="">
                    <div class="ca-hint">Bấm, kéo thả ảnh vào đây, hoặc Ctrl+V</div>
                </div>
                <div class="ca-row">
                    <button class="menu_button ca-upload"><i class="fa-solid fa-upload"></i> Tải ảnh lên</button>
                    <button class="menu_button ca-clear"><i class="fa-solid fa-rotate-left"></i> Dùng ảnh gốc</button>
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

        const applyUrl = async () => {
            const v = q('.ca-url').value.trim();
            if (!v) { setStatus('Nhập link ảnh trước đã.', true); return; }
            await setChatAvatar(v, 'url');
        };
        q('.ca-apply').addEventListener('click', applyUrl);
        q('.ca-url').addEventListener('keydown', e => { if (e.key === 'Enter') applyUrl(); });
        q('.ca-clear').addEventListener('click', () => setChatAvatar('', 'manual'));
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

    // ---------- Cài đặt & menu ----------

    function addSettingsPanel() {
        const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (!host || document.getElementById('ca_settings')) return;
        const s = settings();
        const wrap = document.createElement('div');
        wrap.id = 'ca_settings';
        wrap.innerHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Chat Avatar</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <label class="checkbox_label"><input type="checkbox" data-key="enabled"> Bật avatar riêng cho từng chat</label>
                    <label class="checkbox_label"><input type="checkbox" data-key="autoTag"> Tự nhận thẻ <code>[avatar: …]</code> trong tin nhắn của nhân vật</label>
                    <label class="checkbox_label"><input type="checkbox" data-key="hideTag"> Ẩn thẻ <code>[avatar: …]</code> khỏi khung chat</label>
                    <label>Cạnh dài tối đa khi tải ảnh lên (px)
                        <input class="text_pole" type="number" min="128" max="2048" step="64" data-key="maxSize">
                    </label>
                    <div class="menu_button ca-open-btn"><i class="fa-solid fa-image-portrait"></i> Đặt avatar cho chat đang mở</div>
                    <small>Ảnh tải lên nằm trong <code>data/&lt;user&gt;/user/images/${FOLDER}/</code>.
                    Lệnh: <code>/chatavatar &lt;link|tên file&gt;</code>, <code>/chatavatar clear</code>.</small>
                </div>
            </div>`;
        host.append(wrap);

        wrap.querySelectorAll('[data-key]').forEach(input => {
            const key = input.dataset.key;
            if (input.type === 'checkbox') input.checked = !!s[key];
            else input.value = s[key];
            input.addEventListener('change', () => {
                s[key] = input.type === 'checkbox' ? input.checked : Number(input.value) || DEFAULTS[key];
                ctx().saveSettingsDebounced();
                applyAll();
            });
        });
        wrap.querySelector('.ca-open-btn').addEventListener('click', openModal);
    }

    function addMenuButton() {
        const menu = document.getElementById('extensionsMenu');
        if (!menu || document.getElementById('ca_menu_btn')) return;
        const btn = document.createElement('div');
        btn.id = 'ca_menu_btn';
        btn.className = 'list-group-item flex-container flexGap5 interactable';
        btn.tabIndex = 0;
        btn.innerHTML = '<div class="fa-solid fa-image-portrait extensionsMenuExtensionButton"></div><span>Avatar cho chat này</span>';
        btn.addEventListener('click', openModal);
        menu.append(btn);
    }

    function registerCommand() {
        const c = ctx();
        const handler = async (_args, value) => {
            const v = String(value ?? '').trim();
            if (!v) return getChatAvatarSrc();
            if (/^(clear|reset|xoa|xoá)$/i.test(v)) {
                await setChatAvatar('', 'command');
                return '';
            }
            await setChatAvatar(v, 'command');
            return v;
        };
        try {
            if (c.SlashCommandParser && c.SlashCommand) {
                c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
                    name: 'chatavatar',
                    callback: handler,
                    returns: 'avatar hiện tại của chat',
                    unnamedArgumentList: [
                        c.SlashCommandArgument.fromProps({
                            description: 'link ảnh, tên file trong thư mục chat-avatars, hoặc "clear"',
                            typeList: [c.ARGUMENT_TYPE.STRING],
                            isRequired: false,
                        }),
                    ],
                    helpString: 'Đặt avatar nhân vật riêng cho chat đang mở. Không có tham số: trả về avatar hiện tại. "clear": dùng lại ảnh gốc.',
                }));
            } else if (c.registerSlashCommand) {
                c.registerSlashCommand('chatavatar', handler, [], '(link|tên file|clear) – avatar riêng cho chat này', true, true);
            }
        } catch (e) {
            console.warn('[Chat Avatar] Không đăng ký được lệnh /chatavatar', e);
        }
    }

    // ---------- Khởi động ----------

    function init() {
        settings();
        addSettingsPanel();
        addMenuButton();
        registerCommand();

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
