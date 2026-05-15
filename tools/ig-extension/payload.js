(() => {
    "use strict";

    // ==========================================
    // 💀 PHANTOM CONFIG (V9.4 - AFFINITY ENGINE)
    // ==========================================
    const CFG = {
        HASH_FOLLOWERS: "c76146de99bb02f6415203be841dd25a",
        HASH_FOLLOWING: "3dec7e2c57367ef3da3d987d89f9dbc8",
        APP_ID: "936619743392459", // Instagram Web App ID
        TIMINGS: { SCAN_BASE: 2000, ACTION_BASE: 5500, DM_BASE: 9000, BATCH_PAUSE: 320000 },
        LIMITS: { SESSION: 150, DM_SESSION: 40, BATCH: 50, MAX_ERRORS: 3, CIRCUIT_BREAK_MS: 900000 },
        FILTERS: { SKIP_VERIFIED: true, SKIP_NO_PIC: true },
        NO_PIC_IDS: ["44884218_345707102882519_2446069589734326272_n", "464760996_1254146839119862_3605321457742435801_n", "11906329_960233084022564_1448528159_a.jpg", "default_profile_pic"],
        SYS_ID: 'ig_core_v94_' + Math.random().toString(36).substring(2, 12),
        WHITELIST_KEY: 'ig_phantom_whitelist'
    };

    // ==========================================
    // 🛡️ UTILS & SECURITY (STEALTH 2.0)
    // ==========================================
    const Utils = {
        sanitize: (str) => {
            if (typeof str !== 'string') return '';
            const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', "/": '&#x2F;' };
            return str.replace(/[&<>"'/]/ig, match => map[match]);
        },
        sleep: ms => new Promise(r => setTimeout(r, ms)),
        fmt: ms => ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s` : `${Math.ceil(ms / 1000)}s`,
        getFatigueDelay: (actionsDone, baseDelay) => {
            let delay = Math.floor(baseDelay * (1 + Math.log10(1 + actionsDone) * 0.15) * (Math.random() * 0.4 + 0.8));
            if (Math.random() < 0.08) delay += Math.floor(Math.random() * 12000) + 8000;
            return delay;
        },
        getUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            let r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8); return v.toString(16);
        }),
        spinText: (text) => text.replace(/\{([^{}]+)\}/g, (m, opts) => {
            const arr = opts.split('|'); 
            return arr[Math.floor(Math.random() * arr.length)];
        }),
        getCSRF: () => {
            const match = document.cookie.match(/csrftoken=([^;]+)/);
            return match ? match[1] : (window._sharedData?.config?.csrf_token || "");
        }
    };

    const EventBus = {
        events: {},
        on(event, listener) { (this.events[event] = this.events[event] || []).push(listener); },
        emit(event, data) { if (this.events[event]) this.events[event].forEach(l => l(data)); }
    };

    const ErrorHandler = {
        log(msg, type = "info") {
            const t = new Date().toLocaleTimeString('es-ES', { hour12: false });
            EventBus.emit('NEW_LOG', { t, msg, type });
        },
        handle(error, context) {
            if (error.name === 'AbortError') return this.log(`🛑 Secuencia abortada (${context}).`, 'wait');
            this.log(`❌ Error [${context}]: ${error.message}`, 'err');
        }
    };

    // ==========================================
    // 💽 ASYNC INDEXED-DB & STORE (OPTIMIZED)
    // ==========================================
    const DB = {
        db: null,
        init() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open("PhantomV9_Database", 1);
                req.onupgradeneeded = e => e.target.result.createObjectStore("processed", { keyPath: "id" });
                req.onsuccess = e => { this.db = e.target.result; resolve(); };
                req.onerror = e => reject(e);
            });
        },
        has(id) {
            return new Promise(resolve => {
                if (!this.db) return resolve(false);
                try {
                    const req = this.db.transaction("processed", "readonly").objectStore("processed").get(id);
                    req.onsuccess = e => resolve(!!e.target.result);
                    req.onerror = () => resolve(false);
                } catch(e) { resolve(false); }
            });
        },
        save(id) {
            if (!this.db) return;
            try {
                this.db.transaction("processed", "readwrite").objectStore("processed").put({ id, timestamp: Date.now() });
            } catch(e) { console.warn("DB Write Error", e); }
        }
    };

    const Store = {
        state: new Proxy({
            status: "idle", mode: "follow", target: "", searchQuery: "", dmMessage: "", keywords: "",
            stats: { scanned: 0, success: 0, fail: 0, errs: 0, backoff: 30000 },
        }, {
            set(t, p, v) {
                t[p] = v;
                EventBus.emit(`STATE_CHANGED_${p.toUpperCase()}`, v);
                return true;
            }
        }),
        pool: new Map(), queue: new Set(),
        whitelist: new Set(JSON.parse(localStorage.getItem(CFG.WHITELIST_KEY) || '[]')),

        addWhitelist(usernames) {
            usernames.forEach(u => this.whitelist.add(u));
            localStorage.setItem(CFG.WHITELIST_KEY, JSON.stringify([...this.whitelist]));
            EventBus.emit('WHITELIST_UPDATED', this.whitelist.size);
        },
        clearWhitelist() {
            this.whitelist.clear();
            localStorage.removeItem(CFG.WHITELIST_KEY);
            EventBus.emit('WHITELIST_UPDATED', 0);
        },

        addPool(users) { 
            users.forEach(u => this.pool.set(u.id, u)); 
            EventBus.emit('POOL_UPDATED', Array.from(this.pool.values())); 
        },
        toggleQueue(id, forceState) {
            if (!this.pool.has(id)) return;
            const willAdd = forceState !== undefined ? forceState : !this.queue.has(id);
            willAdd ? this.queue.add(id) : this.queue.delete(id);
            EventBus.emit('QUEUE_TOGGLED', { id, selected: willAdd });
        },
        clearQueue() { 
            this.queue.clear(); 
            EventBus.emit('QUEUE_CLEARED'); 
        }
    };

    // ==========================================
    // 🌐 NETWORK LAYER (GHOST PARSER V2.1)
    // ==========================================
    const Net = {
        controller: new AbortController(), circuitOpenUntil: 0,
        resetController() { this.controller = new AbortController(); }, 
        abort() { this.controller.abort(); },

        get headers() {
            return {
                "content-type": "application/x-www-form-urlencoded",
                "x-csrftoken": Utils.getCSRF(),
                "x-instagram-ajax": "1",
                "x-ig-app-id": CFG.APP_ID,
                "x-requested-with": "XMLHttpRequest"
            };
        },

        async healSession() {
            try {
                await fetch('/', { credentials: 'include' });
                return true;
            } catch (e) { return false; }
        },

        async req(url, method = "GET", body = "") {
            if (Date.now() < this.circuitOpenUntil) throw new Error("Cortocircuito Activo (Enfriando API).");
            const opt = { method, credentials: "include", signal: this.controller.signal };
            opt.headers = this.headers;
            if (method === "POST") opt.body = body;

            let res;
            try {
                res = await fetch(url, opt);
            } catch (err) {
                if (err.name === 'AbortError') throw err;
                return { err: "NETWORK_ERROR", retry: 12000 };
            }

            if (res.status === 403 && await this.healSession()) {
                opt.headers = this.headers;
                res = await fetch(url, opt);
            }

            if (res.status === 429) {
                const retryAfter = res.headers.get("Retry-After");
                return { err: "LIMIT", retry: retryAfter ? parseInt(retryAfter) * 1000 : 65000 };
            }

            const textResponse = await res.text();
            if (!textResponse) return { err: "EMPTY_RESPONSE", retry: 15000 };

            try {
                const data = JSON.parse(textResponse);
                if (data.status === "fail" || res.status >= 400) {
                    const igMessage = data.feedback_message || data.message || `Denegado (HTTP ${res.status})`;
                    return { err: "LIMIT", retry: 60000, ig_msg: igMessage, code: res.status };
                }
                return data;
            } catch (e) {
                if (textResponse.trim().toLowerCase().startsWith("<!doctype") || textResponse.trim().toLowerCase().startsWith("<html")) {
                    return { err: "LIMIT", retry: 900000, ig_msg: "Bloqueo HTML (15m)", code: res.status };
                }
                return { err: "PARSE_ERROR", retry: 10000 };
            }
        },

        async resolveFull(username) {
            let r = await this.req(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`);
            if (r?.data?.user) return r.data.user;
            r = await this.req(`https://www.instagram.com/web/search/topsearch/?query=${username}`);
            const fbUser = r?.users?.find(x => x.user.username === username)?.user;
            return fbUser ? { id: fbUser.pk, ...fbUser } : null;
        },

        async scan(id, cursor, mode) {
            const hash = (mode === "infieles") ? CFG.HASH_FOLLOWING : CFG.HASH_FOLLOWERS;
            return this.req(`https://www.instagram.com/graphql/query/?query_hash=${hash}&variables=${encodeURIComponent(JSON.stringify({ id, first: CFG.LIMITS.BATCH, after: cursor }))}`);
        },
        async getLatestFeed(uid) {
            const r = await this.req(`https://www.instagram.com/api/v1/feed/user/${uid}/`);
            return (r && r.items && r.items.length > 0) ? r.items[0] : null;
        },
        async getLatestStory(uid) {
            const r = await this.req(`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${uid}`);
            if (r?.reels && r.reels[uid] && r.reels[uid].items && r.reels[uid].items.length > 0) {
                const items = r.reels[uid].items;
                return items[items.length - 1];
            }
            return null;
        }
    };

    // ==========================================
    // ⚙️ ENGINE LOGIC (SURGICAL ENDPOINTS)
    // ==========================================
    const Engine = {
        async init() { 
            try { 
                await DB.init(); 
                ErrorHandler.log("💽 Motor V9.4 Affinity Engine Inicializado.", "suc"); 
            } catch (e) { 
                ErrorHandler.handle(e, "Arranque DB"); 
            } 
        },

        async runScan() {
            if (!Store.state.target) return ErrorHandler.log("❌ Especifica un objetivo primero.", "err");
            Store.state.status = "scan"; Net.resetController();

            const rawKw = Store.state.keywords ? Store.state.keywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k) : [];
            const inKw = rawKw.filter(k => !k.startsWith('!'));
            const exKw = rawKw.filter(k => k.startsWith('!')).map(k => k.substring(1));

            ErrorHandler.log(`🔍 Escaneando [${Store.state.mode.toUpperCase()}]: @${Store.state.target}...`);

            try {
                const userData = await Net.resolveFull(Store.state.target);
                if (!userData || !userData.id) throw new Error("Objetivo no encontrado (Privado/Bloqueado).");
                const id = userData.id;

                let cur = null, next = true, cycles = 0; 
                Store.pool.clear(); 
                Store.clearQueue();

                while (next && Store.state.status === "scan") {

                    if (Store.state.mode === "recommended") {
                        // =========================================================
                        // FIX V9.4: MOTOR DE AFINIDAD (TRIADIC CLOSURE ALGORITHM)
                        // =========================================================
                        ErrorHandler.log("Iniciando Motor de Afinidad (Buscando Alto Índice de Follow-Back)...", "info");

                        let affinityMap = new Map(); // Mapa para puntuar a los perfiles
                        
                        try {
                            // PASO 1: Extraer seguidores recientes (la audiencia más activa del objetivo)
                            ErrorHandler.log(`Mapeando la audiencia activa de @${Store.state.target}...`, "info");
                            const baseRes = await Net.scan(id, null, "follow");   
                            
                            let baseNodes = [];
                            if (baseRes?.data?.user?.edge_followed_by?.edges) {
                                baseNodes = baseRes.data.user.edge_followed_by.edges.map(e => e.node);
                            }

                            if (baseNodes.length === 0) throw new Error("El objetivo no tiene seguidores públicos visibles.");

                            // PASO 2: Filtrar "Nodos Semilla" de alta calidad (Perfiles reales, públicos y recientes)
                            let seedNodes = baseNodes
                                .filter(u => !u.is_private && !u.profile_pic_url.includes("anonymous"))
                                .slice(0, 4); // Analizamos las redes de los 4 mejores
                            
                            ErrorHandler.log(`Calculando intersecciones algorítmicas con ${seedNodes.length} nodos semilla...`, "wait");
                            
                            // PASO 3: Triangulación (Puntuar coincidencias)
                            for (let i = 0; i < seedNodes.length; i++) {
                                if (Store.state.status !== "scan") break;
                                ErrorHandler.log(`Triangulando afinidad (${i+1}/${seedNodes.length}): analizando red de @${seedNodes[i].username}...`, "info");
                                
                                try {
                                    // A) Obtenemos a quién siguen estos usuarios (Intereses paralelos) -> Vale 1.5 Puntos
                                    const subFollowing = await Net.scan(seedNodes[i].id, null, "infieles");
                                    if (subFollowing?.data?.user?.edge_follow?.edges) {
                                        subFollowing.data.user.edge_follow.edges.forEach(e => {
                                            let u = e.node;
                                            if (affinityMap.has(u.id)) {
                                                affinityMap.get(u.id).score += 1.5;
                                            } else {
                                                affinityMap.set(u.id, { user: u, score: 1.5 });
                                            }
                                        });
                                    }

                                    // B) Obtenemos a sus seguidores (Demografía similar) -> Vale 1 Punto
                                    const subFollowers = await Net.scan(seedNodes[i].id, null, "follow");
                                    if (subFollowers?.data?.user?.edge_followed_by?.edges) {
                                        subFollowers.data.user.edge_followed_by.edges.forEach(e => {
                                            let u = e.node;
                                            if (affinityMap.has(u.id)) {
                                                affinityMap.get(u.id).score += 1.0;
                                            } else {
                                                affinityMap.set(u.id, { user: u, score: 1.0 });
                                            }
                                        });
                                    }
                                } catch(e) {
                                    // Silenciar errores de sub-nodos y continuar
                                }
                                await Utils.sleep(1500 + Math.random() * 1000); 
                            }

                            // PASO 4: Filtrado estricto y Ordenamiento por Relevancia
                            let sortedAffinity = Array.from(affinityMap.values())
                                .sort((a, b) => b.score - a.score); // Los de mayor puntuación primero
                                
                            let valid = [];
                            
                            for (const item of sortedAffinity) {
                                const u = item.user;
                                
                                if (u.id === id) continue; // Excluir al objetivo original
                                if (Store.whitelist.has(u.username)) continue;
                                if (u.followed_by_viewer || u.requested_by_viewer) continue; // Ya los sigues

                                // Filtrado por Keywords
                                if (rawKw.length > 0) {
                                    const fullText = ((u.full_name || "") + " " + (u.username || "")).toLowerCase();
                                    if (exKw.some(k => fullText.includes(k))) continue;
                                    if (inKw.length > 0 && !inKw.some(k => fullText.includes(k))) continue;
                                }

                                if (CFG.FILTERS.SKIP_VERIFIED && u.is_verified) continue; // Omitir verificados (rara vez devuelven el follow)
                                if (CFG.FILTERS.SKIP_NO_PIC && (u.profile_pic_url.includes("anonymous") || CFG.NO_PIC_IDS.some(pid => u.profile_pic_url.includes(pid)))) continue;

                                if (!(await DB.has(u.id))) valid.push(u);
                            }

                            Store.addPool(valid);
                            Store.state.stats = { ...Store.state.stats, scanned: Store.pool.size };
                            ErrorHandler.log(`🌟 Éxito: ${valid.length} perfiles altamente afines extraídos y ordenados.`, "suc");
                            next = false; // Detener bucle, red completada.

                        } catch (errGraph) {
                            throw new Error("No se pudo calcular la afinidad. La cuenta objetivo podría estar protegida o Meta bloqueó la lectura temporalmente.");
                        }

                    } else {
                        // Flujo normal (Followers / Following)
                        const d = await Net.scan(id, cur, Store.state.mode);
                        if (d?.err) throw new Error("Rate Limit en escáner o error de GraphQL.");

                        const edge = Store.state.mode === "infieles" ? d?.data?.user?.edge_follow : d?.data?.user?.edge_followed_by;
                        if (!edge) throw new Error("API modificada o cuenta bloqueada temporalmente.");

                        next = edge.page_info.has_next_page; cur = edge.page_info.end_cursor;
                        const valid = [];

                        for (const e of edge.edges) {
                            const u = e.node;

                            if (Store.whitelist.has(u.username) && Store.state.mode !== "message") continue;
                            if (Store.state.mode === "follow" && (u.followed_by_viewer || u.requested_by_viewer)) continue;
                            if (Store.state.mode === "infieles" && u.follows_viewer) continue;

                            if (rawKw.length > 0) {
                                const fullText = ((u.full_name || "") + " " + (u.username || "")).toLowerCase();
                                if (exKw.some(k => fullText.includes(k))) continue;
                                if (inKw.length > 0 && !inKw.some(k => fullText.includes(k))) continue;
                            }

                            if (CFG.FILTERS.SKIP_VERIFIED && u.is_verified && Store.state.mode !== "message") continue;
                            if (CFG.FILTERS.SKIP_NO_PIC && (u.profile_pic_url.includes("anonymous") || CFG.NO_PIC_IDS.some(pid => u.profile_pic_url.includes(pid)))) continue;
                            if (!(await DB.has(u.id))) valid.push(u);
                        }
                        Store.addPool(valid);
                        Store.state.stats = { ...Store.state.stats, scanned: Store.pool.size };
                        
                        if (++cycles > 6) { 
                            cycles = 0; 
                            await Utils.sleep(Math.random() * 5000 + 4000); 
                        } else {
                            await Utils.sleep(Utils.getFatigueDelay(0, CFG.TIMINGS.SCAN_BASE));
                        }
                    }
                }
                if (Store.state.mode !== "recommended") {
                    ErrorHandler.log(`✅ Escaneo listo: ${Store.pool.size} perfiles extraídos.`, "suc");
                }
            } catch (error) { 
                ErrorHandler.handle(error, "Escáner"); 
            } finally { 
                if (Store.state.status === "scan") Store.state.status = "idle"; 
            }
        },

        async engage() {
            const targets = Array.from(Store.queue);
            if (!targets.length) return;
            if (Store.state.mode === "message" && !Store.state.dmMessage.trim()) return ErrorHandler.log("❌ Añade un mensaje para DM.", "err");

            Store.state.status = "run"; 
            Store.state.stats.backoff = 30000; 
            Net.resetController();
            
            const sLimit = Store.state.mode === "message" ? CFG.LIMITS.DM_SESSION : CFG.LIMITS.SESSION;
            const bTime = Store.state.mode === "message" ? CFG.TIMINGS.DM_BASE : CFG.TIMINGS.ACTION_BASE;

            ErrorHandler.log(`🚀 Ejecutando táctica: ${Store.state.mode.toUpperCase()}`, "info");

            try {
                for (let i = 0; i < targets.length; i++) {
                    if (Store.state.status !== "run") break;

                    if (document.hidden) {
                        ErrorHandler.log("⏸️ Tab en 2º plano. Pausando para evitar detección...", "wait");
                        while (document.hidden && Store.state.status === "run") await Utils.sleep(2000);
                    }

                    if (Store.state.stats.success >= sLimit) { 
                        ErrorHandler.log("🛑 Cuota segura de sesión alcanzada.", "wait"); 
                        break; 
                    }

                    const uid = targets[i], user = Store.pool.get(uid);
                    let ok = false, actionIcon = "✔️";

                    await Utils.sleep(Math.floor(Math.random() * 1200) + 800);

                    if (Store.state.mode === "boost_feed") {
                        const media = await Net.getLatestFeed(uid);
                        if (!media) { ok = true; actionIcon = "⏭️ (Sin fotos)"; }
                        else if (media.has_liked) { ok = true; actionIcon = "💖 (Ya likeada)"; }
                        else {
                            const pureId = media.pk || (media.id ? media.id.split('_')[0] : null);
                            if (!pureId) { ok = true; actionIcon = "⚠️"; }
                            else {
                                await Utils.sleep(Math.floor(Math.random() * 1500) + 1000);
                                const r = await Net.req(`https://www.instagram.com/api/v1/web/likes/${pureId}/like/`, "POST");
                                if (r && r.status === "ok") { ok = true; actionIcon = "❤️"; } else if (r && r.err) { ok = r; }
                            }
                        }
                    } else if (Store.state.mode === "boost_story") {
                        const story = await Net.getLatestStory(uid);
                        if (!story) { ok = true; actionIcon = "⏭️ (Sin historias)"; }
                        else if (story.has_liked) { ok = true; actionIcon = "💖 (Ya likeada)"; }
                        else {
                            const pureStoryId = story.pk || (story.id ? story.id.split('_')[0] : null);
                            if (!pureStoryId) { ok = true; actionIcon = "⚠️ (ID)"; }
                            else {
                                await Utils.sleep(Math.floor(Math.random() * 2000) + 1000);
                                const r = await Net.req(`https://www.instagram.com/api/v1/story_interactions/send_story_like/`, "POST", `media_id=${pureStoryId}`);
                                if (r && r.status === "ok") { ok = true; actionIcon = "🔥"; } else if (r && r.err) { ok = r; }
                            }
                        }
                    } else if (Store.state.mode === "message") {
                        const m = Utils.spinText(Store.state.dmMessage.replace(/@usuario/gi, user.username));
                        const offId = Date.now().toString() + Math.floor(Math.random() * 999).toString().padStart(3, '0');
                        const p = new URLSearchParams();
                        p.append('recipient_users', `[["${uid}"]]`);
                        p.append('action', 'send_item');
                        p.append('is_shh_mode', '0');
                        p.append('send_attribution', 'direct_thread');
                        p.append('client_context', Utils.getUUID());
                        p.append('offline_threading_id', offId);
                        p.append('mutation_token', offId);
                        p.append('text', m);

                        const r = await Net.req(`https://www.instagram.com/api/v1/direct_v2/threads/broadcast/text/`, "POST", p.toString());
                        if (r && r.status === "ok") { ok = true; actionIcon = "✉️"; } else if (r && r.err) { ok = r; }
                    } else {
                        const actPrimary = Store.state.mode === "infieles" ? "destroy" : "create";
                        let r = await Net.req(`https://www.instagram.com/api/v1/friendships/${actPrimary}/${uid}/`, "POST", `container_module=profile&user_id=${uid}`);

                        if (r && ["ok", "following", "unfollowed", "requested"].includes(r.status || r.result)) {
                            ok = true; actionIcon = Store.state.mode === "infieles" ? "💔" : "➕";
                        } else if (r && r.err) {
                            ok = r;
                        }
                    }

                    if (ok === true) {
                        Store.state.stats = { ...Store.state.stats, success: Store.state.stats.success + 1, errs: 0, backoff: 30000 };
                        DB.save(uid);
                        EventBus.emit('ITEM_PROCESSED', { id: uid, result: 'ok' });
                        Store.toggleQueue(uid, false);
                        ErrorHandler.log(`${actionIcon} @${user.username}`, "suc");
                    } else {
                        Store.state.stats = { ...Store.state.stats, fail: Store.state.stats.fail + 1, errs: Store.state.stats.errs + 1 };
                        EventBus.emit('ITEM_PROCESSED', { id: uid, result: 'err' });

                        if (Store.state.stats.errs >= CFG.LIMITS.MAX_ERRORS) {
                            Store.state.status = "idle";
                            ErrorHandler.log("🛑 ABORTO SEGURO: API rechazó 3 acciones continuas.", "err");
                            break;
                        }

                        const waitTime = (ok && ok.retry) ? ok.retry : Store.state.stats.backoff;
                        const igMsg = (ok && ok.ig_msg) ? ` (${ok.ig_msg})` : "";
                        ErrorHandler.log(`⚠️ Limitación de IG${igMsg}. Protegiendo cuenta por: ${Utils.fmt(waitTime)}.`, "err");
                        await Utils.sleep(waitTime);
                        Store.state.stats.backoff *= 1.5;
                    }

                    EventBus.emit('PROGRESS_UPDATED', ((i + 1) / targets.length) * 100);
                    if (i === targets.length - 1 || Store.state.status === "dead" || Store.state.status === "idle") break;

                    let cd = (Store.state.stats.success > 0 && Store.state.stats.success % 5 === 0) 
                        ? CFG.TIMINGS.BATCH_PAUSE + Math.floor(Math.random() * 25000) 
                        : Utils.getFatigueDelay(Store.state.stats.success, bTime);
                    
                    let elapsed = 0;
                    while (elapsed < cd && Store.state.status === "run") { 
                        await Utils.sleep(1000); 
                        elapsed += 1000; 
                        EventBus.emit('TIMER_UPDATED', cd - Math.min(elapsed, cd)); 
                    }
                }
            } catch (error) { 
                ErrorHandler.handle(error, "Motor"); 
            } finally { 
                if (Store.state.status !== "dead") { 
                    Store.state.status = "idle"; 
                    ErrorHandler.log("🏁 Operación concluida.", "suc"); 
                } 
            }
        },
        abort() { 
            if (["scan", "run"].includes(Store.state.status)) { 
                Net.abort(); 
                Store.state.status = "idle"; 
            } 
        },
        selfDestruct() {
            this.abort();
            Store.state.status = "dead";
            EventBus.emit('SELF_DESTRUCT');
        }
    };

    // ==========================================
    // 🖥️ NANO UI (HARDWARE ACCELERATED V9.4)
    // ==========================================
    const UI = {
        dom: {}, shadow: null, logsArr: [], host: null,
        dragState: { isDragging: false, startX: 0, startY: 0, startLeft: 0, startTop: 0, isClick: true, raf: null },
        handlers: {},

        css: `:host { display: block; position: fixed; z-index: 2147483647; top: 20px; left: 20px; width: 380px; height: 580px; max-height: calc(100vh - 40px); transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), height 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.1s; }
        * { box-sizing: border-box; }
        :host(.minimized) { width: 48px !important; height: 48px !important; }
        :host(.maximized) { width: 90vw !important; height: 90vh !important; top: 5vh !important; left: 5vw !important; transform: none !important; }
        
        .sys { font-family: system-ui, -apple-system, sans-serif; user-select: none; background: rgba(10, 10, 14, 0.95); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); border: 1px solid rgba(0, 255, 238, 0.2); color: #e2e8f0; width: 100%; height: 100%; border-radius: 16px; box-shadow: 0 20px 50px rgba(0,0,0,0.9), inset 0 0 20px rgba(0,255,238,0.05); display: flex; flex-direction: column; overflow: hidden; position: relative; transition: all 0.3s; }
        
        /* State Minimized */
        :host(.minimized) .sys { border-radius: 24px; border-color: #0fe; background: rgba(0,0,0,0.9); }
        :host(.minimized) .sys > *:not(.hd) { display: none !important; }
        :host(.minimized) .hd { padding: 0; background: 0 0; border: none; display: flex; justify-content: center; align-items: center; width: 100%; height: 100%; cursor: pointer; }
        :host(.minimized) .hd > * { display: none; }
        :host(.minimized) .hd::after { content: "⚡"; font-size: 22px; display: block; filter: drop-shadow(0 0 5px #0fe); }
        
        .hd { padding: 14px 20px; background: rgba(0,0,0,0.5); border-bottom: 1px solid rgba(0, 255, 238, 0.15); display: flex; justify-content: space-between; align-items: center; font-weight: 700; letter-spacing: 1px; cursor: move; }
        .bd { flex: 1; display: flex; flex-direction: column; padding: 16px; gap: 10px; overflow: hidden; }
        
        .inp { background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 10px 14px; width: 100%; border-radius: 8px; font-size: 13px; outline: 0; transition: 0.3s; box-shadow: inset 0 2px 4px rgba(0,0,0,0.5); }
        .inp:focus { border-color: #0fe; box-shadow: 0 0 12px rgba(0,255,238,0.2), inset 0 2px 4px rgba(0,0,0,0.5); }
        
        .btn { background: rgba(0,255,238,0.05); color: #0fe; border: 1px solid rgba(0,255,238,0.2); padding: 10px; cursor: pointer; font-size: 11px; font-weight: 800; border-radius: 8px; transition: 0.3s; text-transform: uppercase; letter-spacing: 0.5px; }
        .btn:hover:not(:disabled) { background: #0fe; color: #000; box-shadow: 0 0 15px rgba(0,255,238,0.5); }
        .btn:disabled { border-color: rgba(255,255,255,0.05); color: #64748b; background: transparent; cursor: not-allowed; box-shadow: none; }
        
        .grd { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 16px 8px; align-content: start; padding: 8px 4px; will-change: transform; }
        .crd { display: flex; flex-direction: column; align-items: center; gap: 8px; cursor: pointer; opacity: 0.6; transition: 0.2s; }
        .crd:hover, .crd.sel { opacity: 1; transform: translateY(-3px); }
        
        .img-wrap { width: 60px; height: 60px; flex-shrink: 0; border-radius: 50%; background: linear-gradient(135deg, #1e1e24, #0a0a0c); border: 2px solid rgba(255,255,255,0.08); box-shadow: 0 4px 10px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; position: relative; transition: 0.3s; }
        .avatar-txt { font-size: 18px; font-weight: 900; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 1px; transition: 0.3s; }
        
        .crd.sel .img-wrap { border-color: #0fe; box-shadow: 0 0 20px rgba(0,255,238,0.4), inset 0 0 10px rgba(0,255,238,0.1); }
        .crd.sel .avatar-txt { color: #0fe; text-shadow: 0 0 12px rgba(0,255,238,0.6); }
        .crd.ok { opacity: 0.2; pointer-events: none; filter: grayscale(1); }
        .crd.err .img-wrap { border-color: #f43f5e; box-shadow: 0 0 15px rgba(244,63,94,0.3); }
        .crd.err .avatar-txt { color: #f43f5e; text-shadow: 0 0 10px rgba(244,63,94,0.5); }
        
        .name { width: 100%; max-width: 80px; font-size: 10px; font-weight: 600; text-align: center; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .badge { position: absolute; bottom: -2px; right: -2px; background: #111; font-size: 9px; padding: 3px; border-radius: 50%; border: 1.5px solid #f43f5e; box-shadow: 0 2px 4px rgba(0,0,0,0.5); width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; }
        
        .sts { display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; background: rgba(0,0,0,0.4); padding: 10px 14px; border-radius: 8px; font-weight: 700; border: 1px solid rgba(255,255,255,0.05); }
        .lgs { height: 90px; flex-shrink: 0; background: rgba(0,0,0,0.7); border-radius: 8px; font-size: 11px; padding: 10px; overflow-y: auto; font-family: 'Courier New', monospace; border: 1px solid rgba(255,255,255,0.08); box-shadow: inset 0 4px 10px rgba(0,0,0,0.5); }
        
        .suc { color: #10b981; } .err { color: #f43f5e; } .wait { color: #fbbf24; } .info { color: #38bdf8; }
        
        .bar { height: 2px; background: rgba(255,255,255,0.05); width: 100%; }
        .fil { height: 100%; background: #0fe; width: 0%; transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 0 12px #0fe; }
        
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.4); }`,

        init() {
            document.querySelectorAll(`div[data-core="sys"]`).forEach(el => el.remove());
            
            this.host = document.createElement('div');
            this.host.id = CFG.SYS_ID;
            this.host.dataset.core = "sys";
            document.documentElement.appendChild(this.host);

            this.shadow = this.host.attachShadow({ mode: 'closed' });

            this.shadow.innerHTML = `<style>${this.css}</style>
            <div class="sys" id="main">
                <div class="hd" id="drag-handle">
                    <div style="display:flex;align-items:center;gap:8px;color:#0fe;font-size:14px">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                        PHANTOM V9.4
                    </div>
                    <span id="act" style="font-size:10px;color:#fbbf24">READY</span>
                    <div style="display:flex;gap:12px;font-size:14px;">
                        <span id="b-min" style="cursor:pointer;color:#94a3b8;transition:.2s" title="Minimizar">_</span>
                        <span id="b-max" style="cursor:pointer;color:#94a3b8;transition:.2s" title="Maximizar">🗖</span>
                        <span id="b-cls" style="cursor:pointer;color:#94a3b8;transition:.2s" title="Cerrar">✕</span>
                    </div>
                </div>
                <div class="bar"><div class="fil" id="prog"></div></div>
                <div class="bd">
                    <div style="display:flex;gap:8px">
                        <input class="inp" id="targ" placeholder="Objetivo (@usuario)" autocomplete="off" spellcheck="false">
                        <button class="btn" id="b-scn" style="width:110px">ESCANEAR</button>
                    </div>
                    <div style="display:flex;gap:8px">
                        <input class="inp" id="kwd" placeholder="Filtro (ej: bcn, !rrpp)" autocomplete="off" spellcheck="false" style="border-color: rgba(254,202,87,0.3);">
                    </div>
                    <div class="sts">
                        <span>POOL: <b id="s-scn" style="color:#fff">0</b></span>
                        <span>OK: <b id="s-ok" class="suc">0</b></span>
                        <span>ERR: <b id="s-err" class="err">0</b></span>
                    </div>
                    <div style="display:flex;gap:6px">
                        <button class="btn" style="flex:1" id="b-mod">M: FOLLOW ➕</button>
                        <button class="btn" style="flex:.4" id="b-all" title="Marcar Todos">ALL</button>
                        <button class="btn" style="flex:.4" id="b-prv" title="Marcar Privadas">PRIV</button>
                        <button class="btn" style="flex:.4" id="b-pub" title="Marcar Públicas">PUB</button>
                        <button class="btn" style="flex:.4" id="b-clr" title="Limpiar Marcas">CLR</button>
                    </div>
                    <div style="display:flex;gap:6px">
                        <button class="btn" style="flex:1; color:#feca57; border-color:rgba(254,202,87,0.2); background:rgba(254,202,87,0.05);" id="b-wht" title="Añadir a Whitelist">⭐ PROTEGER</button>
                        <button class="btn" style="flex:.8; color:#ff4757; border-color:rgba(255,71,87,0.2); background:rgba(255,71,87,0.05);" id="b-cwht" title="Vaciar Whitelist">🗑️ VACIAR (<span id="wht-cnt">0</span>)</button>
                    </div>
                    <textarea class="inp" id="dm-msg" placeholder="Spintax: {Hola|Ey} @usuario, ¿qué tal? 🚀" style="display:none; resize:none; height:50px; font-family:inherit;"></textarea>
                    
                    <div style="display:flex;gap:6px">
                        <input class="inp" id="search-grid" placeholder="🔍 Buscar en lista..." autocomplete="off" spellcheck="false" style="flex:1; padding: 8px 12px;">
                        <button class="btn" id="b-sel-vis" style="flex:.4" title="Seleccionar los visibles actuales">SEL VIS</button>
                    </div>

                    <div class="grd" id="grd"></div>
                    <div class="lgs" id="lgs"></div>
                    
                    <div style="display:flex;gap:8px;margin-top:auto">
                        <button class="btn" style="flex:2;padding:14px;font-size:12px" id="b-run" disabled>INICIAR SECUENCIA</button>
                        <button class="btn" style="flex:1;color:#f43f5e;border-color:rgba(244,63,94,.2);background:rgba(244,63,94,.05)" id="b-stp">ABORTAR</button>
                    </div>
                </div>
            </div>`;

            const $ = s => this.shadow.querySelector(s);
            this.dom = {
                targ: $('#targ'), scn: $('#b-scn'), run: $('#b-run'), stp: $('#b-stp'),
                min: $('#b-min'), max: $('#b-max'), cls: $('#b-cls'), grd: $('#grd'), lgs: $('#lgs'),
                s_scn: $('#s-scn'), s_ok: $('#s-ok'), s_err: $('#s-err'), act: $('#act'),
                prog: $('#prog'), mod: $('#b-mod'), all: $('#b-all'), prv: $('#b-prv'), pub: $('#b-pub'), clr: $('#b-clr'),
                wht: $('#b-wht'), cwht: $('#b-cwht'), wht_cnt: $('#wht-cnt'), search_grid: $('#search-grid'), sel_vis: $('#b-sel-vis'),
                dm_msg: $('#dm-msg'), kwd: $('#kwd'), main: $('#main'), dragHandle: $('#drag-handle')
            };

            this.bindEvents();
            this.bindStoreEvents();
            this.initDrag();

            EventBus.emit('WHITELIST_UPDATED', Store.whitelist.size);
        },

        initDrag() {
            const dragStart = (e) => {
                if (e.target.tagName === 'SPAN' || e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
                if (this.host.classList.contains('maximized')) return;

                this.dragState.isDragging = true;
                this.dragState.isClick = true;

                const rect = this.host.getBoundingClientRect();
                this.dragState.startLeft = rect.left;
                this.dragState.startTop = rect.top;

                this.dragState.startX = e.clientX ?? e.touches?.[0].clientX;
                this.dragState.startY = e.clientY ?? e.touches?.[0].clientY;
            };

            const dragMove = (e) => {
                if (!this.dragState.isDragging) return;
                const currentX = e.clientX ?? e.touches?.[0].clientX;
                const currentY = e.clientY ?? e.touches?.[0].clientY;
                const dx = currentX - this.dragState.startX;
                const dy = currentY - this.dragState.startY;

                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.dragState.isClick = false;

                if (!this.dragState.isClick) {
                    e.preventDefault();
                    if (this.dragState.raf) cancelAnimationFrame(this.dragState.raf);
                    
                    this.dragState.raf = requestAnimationFrame(() => {
                        this.host.style.setProperty('left', `${this.dragState.startLeft + dx}px`, 'important');
                        this.host.style.setProperty('top', `${this.dragState.startTop + dy}px`, 'important');
                    });
                }
            };

            const dragEnd = () => {
                if (!this.dragState.isDragging) return;
                this.dragState.isDragging = false;
                if (this.dragState.raf) cancelAnimationFrame(this.dragState.raf);
                
                if (this.dragState.isClick && this.host.classList.contains('minimized')) {
                    this.host.classList.remove('minimized');
                }
            };

            this.handlers.dragMove = dragMove;
            this.handlers.dragEnd = dragEnd;

            this.dom.dragHandle.addEventListener('mousedown', dragStart);
            this.dom.dragHandle.addEventListener('touchstart', dragStart, { passive: false });
            
            // Allow clicking anywhere to restore from minimized state
            this.dom.main.addEventListener('mousedown', (e) => { if (this.host.classList.contains('minimized')) dragStart(e); });
            this.dom.main.addEventListener('touchstart', (e) => { if (this.host.classList.contains('minimized')) dragStart(e); }, { passive: false });

            window.addEventListener('mousemove', this.handlers.dragMove);
            window.addEventListener('touchmove', this.handlers.dragMove, { passive: false });
            window.addEventListener('mouseup', this.handlers.dragEnd);
            window.addEventListener('touchend', this.handlers.dragEnd);
        },

        bindEvents() {
            this.dom.scn.onclick = () => Engine.runScan();
            this.dom.targ.oninput = e => Store.state.target = Utils.sanitize(e.target.value.replace('@', '').trim());
            this.dom.kwd.oninput = e => Store.state.keywords = e.target.value;
            this.dom.dm_msg.oninput = e => Store.state.dmMessage = e.target.value;

            let searchTimeout;
            this.dom.search_grid.oninput = (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    Store.state.searchQuery = e.target.value.toLowerCase().trim();
                    EventBus.emit('POOL_UPDATED', Array.from(Store.pool.values()));
                }, 200);
            };

            this.dom.sel_vis.onclick = () => {
                const visibleCards = this.dom.grd.querySelectorAll('.crd');
                visibleCards.forEach(c => {
                    if (c.dataset.id) Store.toggleQueue(c.dataset.id, true);
                });
            };

            this.dom.mod.onclick = () => {
                const modes = ["follow", "recommended", "infieles", "message", "boost_feed", "boost_story"];
                const nextMode = modes[(modes.indexOf(Store.state.mode) + 1) % modes.length];
                Store.state.mode = nextMode;

                this.dom.dm_msg.style.display = nextMode === "message" ? "block" : "none";

                const labels = {
                    "boost_feed": "M: LIKE FEED 📸",
                    "boost_story": "M: LIKE STORY 🔥",
                    "message": "M: DM ✉️",
                    "infieles": "M: INFIELES 💔",
                    "recommended": "M: SUGERIDOS 🌟",
                    "follow": "M: FOLLOW ➕"
                };
                this.dom.mod.innerText = labels[nextMode];
            };

            this.dom.all.onclick = () => Store.pool.forEach(u => Store.toggleQueue(u.id, true));
            this.dom.prv.onclick = () => Store.pool.forEach(u => u.is_private && Store.toggleQueue(u.id, true));
            this.dom.pub.onclick = () => Store.pool.forEach(u => !u.is_private && Store.toggleQueue(u.id, true));
            this.dom.clr.onclick = () => Store.clearQueue();

            this.dom.wht.onclick = () => {
                const selectedIds = Array.from(Store.queue);
                if (selectedIds.length === 0) return ErrorHandler.log("⚠️ Selecciona perfiles para proteger.", "wait");
                const usernames = selectedIds.map(id => Store.pool.get(id).username);
                Store.addWhitelist(usernames);
                selectedIds.forEach(id => Store.pool.delete(id));
                Store.clearQueue();
                EventBus.emit('POOL_UPDATED', Array.from(Store.pool.values()));
                ErrorHandler.log(`⭐ ${usernames.length} perfiles protegidos.`, "suc");
            };

            this.dom.cwht.onclick = () => {
                if (confirm("¿Vaciar Whitelist? Todos perderán su protección.")) {
                    Store.clearWhitelist();
                    ErrorHandler.log("🗑️ Lista Blanca reiniciada.", "info");
                }
            };

            this.dom.run.onclick = () => Engine.engage();
            this.dom.stp.onclick = () => Engine.abort();

            this.dom.min.onclick = () => {
                this.host.classList.remove('maximized');
                this.host.classList.toggle('minimized');
            };
            
            this.dom.max.onclick = () => {
                this.host.classList.remove('minimized');
                this.host.classList.toggle('maximized');
            };

            this.dom.cls.onclick = () => Engine.selfDestruct();
            
            this.dom.grd.addEventListener('click', e => {
                const c = e.target.closest('.crd');
                if (c && c.dataset.id && !["run", "dead"].includes(Store.state.status)) {
                    Store.toggleQueue(c.dataset.id);
                }
            }, { passive: true });
        },

        bindStoreEvents() {
            EventBus.on('STATE_CHANGED_STATUS', (status) => {
                const busy = ["scan", "run"].includes(status);
                ['scn', 'run', 'targ', 'mod', 'all', 'prv', 'pub', 'clr', 'wht', 'cwht'].forEach(k => { if (this.dom[k]) this.dom[k].disabled = busy; });
                if (status === "idle") { 
                    if (this.dom.act) this.dom.act.innerText = "READY"; 
                    if (this.dom.run) this.dom.run.disabled = Store.queue.size === 0; 
                }
            });
            
            EventBus.on('STATE_CHANGED_MODE', () => { if (this.dom.run) this.dom.run.disabled = Store.queue.size === 0; });

            EventBus.on('STATE_CHANGED_STATS', stats => {
                if (this.dom.s_scn) this.dom.s_scn.innerText = stats.scanned;
                if (this.dom.s_ok) this.dom.s_ok.innerText = stats.success;
                if (this.dom.s_err) this.dom.s_err.innerText = stats.fail;
            });

            EventBus.on('WHITELIST_UPDATED', size => { if (this.dom.wht_cnt) this.dom.wht_cnt.innerText = size; });

            EventBus.on('POOL_UPDATED', (users) => {
                const frag = document.createDocumentFragment();
                if (this.dom.grd) this.dom.grd.innerHTML = '';
                
                const query = Store.state.searchQuery;
                const filteredUsers = query ? users.filter(u => u.username.toLowerCase().includes(query)) : users;

                const maxRender = 200; // Increased limit slightly for better UX
                const displayUsers = filteredUsers.slice(0, maxRender);

                displayUsers.forEach(u => {
                    const div = document.createElement('div');
                    div.className = `crd ${Store.queue.has(u.id) ? 'sel' : ''}`;
                    div.dataset.id = u.id;
                    div.title = `@${u.username}`;

                    const wrap = document.createElement('div');
                    wrap.className = 'img-wrap';

                    const avatarTxt = document.createElement('div');
                    avatarTxt.className = 'avatar-txt';
                    avatarTxt.textContent = u.username.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase() || 'IG';
                    wrap.appendChild(avatarTxt);

                    if (u.is_private) {
                        const badge = document.createElement('div');
                        badge.className = 'badge';
                        badge.innerHTML = '🔒';
                        wrap.appendChild(badge);
                    }

                    const name = document.createElement('div');
                    name.className = 'name';
                    name.textContent = u.username;

                    div.appendChild(wrap);
                    div.appendChild(name);
                    frag.appendChild(div);
                });

                if (filteredUsers.length > maxRender) {
                    const warn = document.createElement('div');
                    warn.style.cssText = "grid-column: 1 / -1; text-align: center; color: #94a3b8; padding: 10px; font-size: 11px;";
                    warn.textContent = `+ ${filteredUsers.length - maxRender} perfiles ocultos (Optimización de UI). Usa el buscador.`;
                    frag.appendChild(warn);
                }

                if (this.dom.grd) this.dom.grd.appendChild(frag);
            });

            EventBus.on('QUEUE_TOGGLED', ({ id, selected }) => {
                if (!this.dom.grd) return;
                const card = this.dom.grd.querySelector(`.crd[data-id="${id}"]`);
                if (card) selected ? card.classList.add('sel') : card.classList.remove('sel');
                if (this.dom.run) this.dom.run.disabled = Store.queue.size === 0 || Store.state.status === "run";
            });

            EventBus.on('QUEUE_CLEARED', () => {
                if (!this.dom.grd) return;
                this.dom.grd.querySelectorAll('.crd.sel').forEach(el => el.classList.remove('sel'));
                if (this.dom.run) this.dom.run.disabled = true;
            });

            EventBus.on('ITEM_PROCESSED', ({ id, result }) => {
                if (!this.dom.grd) return;
                const card = this.dom.grd.querySelector(`.crd[data-id="${id}"]`);
                if (card) {
                    card.classList.remove('sel');
                    card.classList.add(result);
                }
            });

            EventBus.on('NEW_LOG', (log) => {
                if (!this.dom.lgs) return;
                this.logsArr.push(`<div class="${log.type}" style="margin-bottom:6px; line-height:1.4;">[<span style="color:#64748b">${log.t}</span>] ${Utils.sanitize(log.msg)}</div>`);
                if (this.logsArr.length > 50) this.logsArr.shift();
                
                // Usamos requestAnimationFrame para batching del DOM
                requestAnimationFrame(() => {
                    this.dom.lgs.innerHTML = this.logsArr.join('');
                    this.dom.lgs.scrollTop = this.dom.lgs.scrollHeight;
                });
            });

            EventBus.on('PROGRESS_UPDATED', percent => { 
                if (this.dom.prog) this.dom.prog.style.width = `${percent}%`; 
            });
            
            EventBus.on('TIMER_UPDATED', remainingMs => { 
                if (this.dom.act) this.dom.act.innerText = `NEXT: ${Utils.fmt(remainingMs)}`; 
            });
            
            EventBus.on('SELF_DESTRUCT', () => {
                if (this.host) {
                    window.removeEventListener('mousemove', this.handlers.dragMove);
                    window.removeEventListener('touchmove', this.handlers.dragMove);
                    window.removeEventListener('mouseup', this.handlers.dragEnd);
                    window.removeEventListener('touchend', this.handlers.dragEnd);
                    this.host.style.opacity = '0';
                    this.host.style.transform = 'scale(0.9)';
                    setTimeout(() => this.host.remove(), 300);
                }
            });
        }
    };

    // ==========================================
    // 🚀 BOOT SEQUENCE
    // ==========================================
    (async () => {
        UI.init();
        await Engine.init();
    })();
})();