// ==UserScript==
// @name         油猴脚本-额度大的用额度小的没必要用-Arena Native Suite
// @namespace    local.amp.native
// @version      1.11.58
// @description  Arena 原生
// @match        https://arena.ai/*
// @run-at       document-start
// @grant        none
// @noframes
// @downloadURL  https://raw.githubusercontent.com/755287249/-/main/Arena-Native-Suite.user.js
// @updateURL    https://raw.githubusercontent.com/755287249/-/main/Arena-Native-Suite.user.js
// ==/UserScript==

(function mergedArenaTools(){
'use strict';
// Only one copy may run; installing this next to the original Lite script would double-hook fetch.
if (window.__AMP_NATIVE_SUITE__) return;
try { Object.defineProperty(window, '__AMP_NATIVE_SUITE__', { value: '1.11.58' }); } catch {}
// Claude 内部型号几乎都带 -vertex（渠道标记），默认不写进对话名/显示名
const noVertex = n => typeof n === 'string' ? n.replace(/-vertex(?=$|[-_\s·])/ig, '') : n;
// localStorage 写入：满了（QuotaExceededError）会静默失败，导致“保存了刷新又没了”。
// 失败时依次清掉可重建的大缓存（本地历史副本 / 排行榜缓存 / 型号变更记录）再重试，并把结果告诉调用方。
const ampStore = (() => {
  const PRUNE = ['amp.lite.v2.history', 'amp.native.rank.v1', 'amp.native.resp.v1', 'amp.lite.v2.logs'];
  let failed = 0;
  function set(key, value) {
    try { localStorage.setItem(key, value); return true; } catch {}
    for (const k of PRUNE) {
      if (k === key) continue;
      try { if (localStorage.getItem(k) === null) continue; localStorage.removeItem(k); } catch { continue; }
      try { localStorage.setItem(key, value); console.warn('[Arena Native] 本地存储已满，已清理缓存 ' + k + ' 后保存成功'); return true; } catch {}
    }
    failed++; console.warn('[Arena Native] 本地存储写入失败：' + key); return false;
  }
  function usage() { let n = 0, ours = 0; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i), v = localStorage.getItem(k) || ''; n += k.length + v.length; if (/^amp\./.test(k)) ours += k.length + v.length; } } catch {} return { total: n * 2, ours: ours * 2 }; }
  return { set, usage, get failed() { return failed; } };
})();

// UI bridge: original detector source remains unchanged between the markers below.
// Only the display text is mirrored; no credentials, trace bodies or prompts are copied.
const legacyDisplay = {
  revision: 0, onchange: null,
  data: { state: '等待验证', text: '等待发送内容', at: null },
  snapshot() { return { tool:'Independent detector display', detectorVersion:'8.1.0', ...this.data }; }
};
function mountLegacyDisplayBridge() {
  let discovery=null;
  const attach=()=>{
    const source=document.getElementById('__arena_backend_model_detector__');
    if(!source?.shadowRoot)return false;
    // Keep the original hidden UI alive so its unchanged functions continue to work.
    source.style.setProperty('display','none','important');
    source.setAttribute('aria-hidden','true');
    source.setAttribute('inert','');
    const shadow=source.shadowRoot;
    const update=()=>{
      const state=shadow.querySelector('.state')?.textContent||'等待验证';
      const text=shadow.querySelector('pre')?.textContent||'';
      if(state===legacyDisplay.data.state&&text===legacyDisplay.data.text)return;
      legacyDisplay.data={state,text,at:new Date().toISOString()};
      legacyDisplay.revision++;
      legacyDisplay.onchange?.();
    };
    const observer=new MutationObserver(update);
    observer.observe(shadow,{subtree:true,childList:true,characterData:true});
    update();discovery?.disconnect();return true;
  };
  if(!attach()){
    discovery=new MutationObserver(attach);
    discovery.observe(document.documentElement||document,{childList:true,subtree:true});
  }
}

// BEGIN ORIGINAL DETECTOR v8.1.0 — executable source preserved verbatim
(() => {
    'use strict';

    /*
     * ============================================================
     * 模型检测 v8.0
     *
     * UI：
     *
     * 等待验证    等待发送内容
     *
     * ↓
     *
     * 验证进行中  查询 Run ID
     *             查询 Trace
     *             扫描 AI Span
     *             查询 Model
     *             查询 Provider
     *             查询 Operation
     *
     * ↓
     *
     * Model: xxx
     * 思考等级: high / medium / low / unknown
     *
     * ============================================================
     */

    const originalFetch = window.fetch;

    const processedRuns = new Set();
    const processedSpans = new Set();

    let panel = null;

    /*
     * ------------------------------------------------------------
     * New Chat 自动刷新
     * ------------------------------------------------------------
     */

    let newChatReloadScheduled = false;

    function isNewChatLink(element) {

        if (!element) {
            return false;
        }

        const link =
            element.closest?.(
                'a[href="/agent"]'
            );

        if (!link) {
            return false;
        }

        const menuItem =
            link.closest(
                'li[data-sidebar="menu-item"]'
            );

        if (!menuItem) {
            return false;
        }

        const text =
            (link.textContent || '').trim();

        return (
            text.includes('New Chat') ||
            link.getAttribute('href') === '/agent'
        );
    }

    function scheduleNewChatReload() {

        if (newChatReloadScheduled) {
            return;
        }

        newChatReloadScheduled = true;

        log(
            'NEW CHAT CLICKED - waiting for /agent navigation...'
        );

        let attempts = 0;

        const checkNavigation = () => {

            attempts++;

            const pathname =
                window.location.pathname;

            if (
                pathname === '/agent' &&
                !(window.__AMP_NATIVE_GACHA_NAV__ > Date.now())
            ) {

                log(
                    'NEW CHAT NAVIGATION DETECTED - reloading page...'
                );

                try {

                    sessionStorage.setItem(
                        '__ARENA_NEW_CHAT_RELOADED__',
                        '1'
                    );

                } catch {}

                window.location.reload();

                return;
            }

            if (
                attempts < 50
            ) {

                setTimeout(
                    checkNavigation,
                    100
                );

                return;
            }

            log(
                'NEW CHAT navigation timeout.'
            );

            newChatReloadScheduled =
                false;
        };

        setTimeout(
            checkNavigation,
            100
        );
    }

    document.addEventListener(
        'click',
        event => {

            try {

                if (
                    !(window.__AMP_NATIVE_GACHA_NAV__ > Date.now()) &&
                    isNewChatLink(
                        event.target
                    )
                ) {

                    scheduleNewChatReload();
                }

            } catch (e) {

                warn(
                    'NEW CHAT CLICK DETECTION ERROR',
                    e
                );
            }

        },
        true
    );

    /* Compact UI: isolated styles; local preferences contain UI state only. */
    const UI_KEY = '__arena_detector_ui_v81__';
    let ui = null;
    let uiData = { phase: 'waiting', title: '等待验证', step: '等待发送内容', result: null };
    let uiPrefs = { side: 'right', y: 0.32 };
    try {
        const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
        if (saved.side === 'left' || saved.side === 'right') uiPrefs.side = saved.side;
        if (Number.isFinite(saved.y)) uiPrefs.y = Math.max(0, Math.min(1, saved.y));
    } catch {}
    let expanded = false;
    let drag = null;
    let suppressClick = false;
    const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(uiPrefs)); } catch {} };

    function viewportBox() {
        const v = window.visualViewport;
        return { x: v?.offsetLeft || 0, y: v?.offsetTop || 0,
            w: v?.width || window.innerWidth, h: v?.height || window.innerHeight };
    }
    function positionPanel() {
        if (!panel || !ui || drag) return;
        const v = viewportBox(), margin = 10;
        panel.style.setProperty('max-width', Math.max(40, v.w - margin * 2) + 'px', 'important');
        ui.card.style.maxHeight = Math.max(44, v.h - margin * 2) + 'px';
        const r = panel.getBoundingClientRect();
        const x = uiPrefs.side === 'right' ? v.x + v.w - r.width - margin : v.x + margin;
        const range = Math.max(0, v.h - r.height - margin * 2);
        panel.style.setProperty('left', Math.max(v.x + margin, x) + 'px', 'important');
        panel.style.setProperty('top', (v.y + margin + range * uiPrefs.y) + 'px', 'important');
    }
    function setExpanded(value, restoreFocus = false) {
        expanded = !!value;
        if (!ui) return;
        ui.card.hidden = !expanded;
        ui.chip.hidden = expanded;
        ui.chip.setAttribute('aria-expanded', String(expanded));
        positionPanel();
        if (expanded) ui.close.focus({ preventScroll: true });
        else if (restoreFocus) ui.chip.focus({ preventScroll: true });
    }
    function ensurePanel() {
        if (panel && document.documentElement?.contains(panel)) return panel;
        if (panel && ui) {
            if (document.documentElement) document.documentElement.appendChild(panel);
            return panel;
        }
        panel = document.createElement('div');
        panel.id = '__arena_backend_model_detector__';
        for (const [key, value] of Object.entries({ position: 'fixed', 'z-index': '2147483647',
            display: 'block', margin: '0', padding: '0', border: '0', width: 'max-content',
            height: 'auto', background: 'transparent', 'pointer-events': 'auto',
            right: 'auto', bottom: 'auto', opacity: '1', transform: 'none', 'color-scheme': 'dark' })) {
            panel.style.setProperty(key, value, 'important');
        }
        const shadow = panel.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
        <style>
        :host{font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e9edf4;text-align:left}
        *{box-sizing:border-box} [hidden]{display:none!important}
        button{font:inherit;color:inherit;cursor:pointer;border:0;outline-offset:3px;-webkit-tap-highlight-color:transparent}
        button:focus-visible,summary:focus-visible{outline:2px solid #a8c6ff}
        .chip{display:flex;align-items:center;gap:8px;min-height:42px;padding:0 13px;border-radius:22px;
            background:rgba(24,28,36,.94);border:1px solid #ffffff24;box-shadow:0 4px 18px #0003;
            touch-action:none;user-select:none;max-width:160px;transition:background .16s}
        .chip:hover{background:#303744}.dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--tone,#99a5b7)}
        .chip-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;font-weight:600}
        .chevron{color:#8894a8;font-size:12px}
        .card{width:310px;max-width:100%;overflow:auto;overscroll-behavior:contain;background:rgba(22,26,34,.97);
            border:1px solid #ffffff22;border-radius:18px;box-shadow:0 12px 44px #0005;scrollbar-width:thin}
        .header{display:flex;align-items:center;gap:8px;padding:9px 10px 9px 15px;border-bottom:1px solid #ffffff0e}
        .handle{flex:1;min-width:0;min-height:34px;display:flex;align-items:center;gap:9px;touch-action:none;cursor:grab;user-select:none;font-size:12px;color:#c7d0df;background:transparent;padding:0;text-align:left}
        .grip{color:#667386}.close{width:36px;height:34px;border-radius:9px;background:#ffffff09;color:#b7c3d4;font-size:20px}
        .close:hover{background:#ffffff18}.body{padding:15px}.state{font-size:11px;color:var(--tone);margin-bottom:10px}
        .model{font:600 17px/1.45 system-ui,sans-serif;color:#f0f4fb;overflow-wrap:anywhere;max-height:160px;overflow:auto;user-select:text}
        .reason{display:inline-block;margin-top:12px;padding:5px 9px;border-radius:8px;background:#ffffff08;color:#c3cddd;font-size:12px;overflow-wrap:anywhere;max-width:100%}
        details{margin-top:14px;border-top:1px solid #ffffff0d;padding-top:10px}summary{cursor:pointer;color:#8797ad;font-size:12px;min-height:30px;display:list-item;list-style-position:inside}
        pre{font:11px/1.7 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;color:#adb9ca;max-height:210px;overflow:auto;margin:8px 0 0;user-select:text}
        .footer{display:flex;align-items:center;gap:10px;margin-top:12px;color:#68788e;font-size:10px}
        .copy{margin-left:auto;flex:none;background:#ffffff09;border-radius:8px;padding:7px 10px;font-size:11px;color:#b8c7db}
        .busy .dot{animation:pulse 1.4s ease-in-out infinite}@keyframes pulse{50%{opacity:.35}}
        @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
        </style>
        <button class="chip" type="button" aria-expanded="false" aria-controls="detector-card" title="点击展开 · 拖动可移位"><span class="dot"></span><span class="chip-label">检测</span><span class="chevron">⌃</span></button>
        <section class="card" id="detector-card" aria-label="检测信息" hidden>
            <div class="header"><button type="button" class="handle" title="拖动移动面板，方向键微调，Home 恢复位置" aria-label="移动检测面板"><span class="grip">⠿</span><span class="dot"></span><span>检测信息</span></button><button type="button" class="close" title="收起（Esc）" aria-label="收起面板">−</button></div>
            <div class="body"><div class="state" role="status" aria-live="polite"></div><div class="model"></div><div class="reason"></div>
            <details><summary>详细信息与依据</summary><pre></pre></details>
            <div class="footer"><span>拖动移位 · 点击外部收起</span><button type="button" class="copy">复制信息</button></div></div>
        </section>`;
        const find = s => shadow.querySelector(s);
        ui = { shadow, chip: find('.chip'), label: find('.chip-label'), card: find('.card'),
            close: find('.close'), handle: find('.handle'), state: find('.state'), model: find('.model'),
            reason: find('.reason'), details: find('details'), pre: find('pre'), copy: find('.copy') };
        ui.chip.addEventListener('click', () => { if (!suppressClick) setExpanded(true); });
        ui.close.addEventListener('click', () => setExpanded(false, true));
        ui.details.addEventListener('toggle', positionPanel);
        ui.copy.addEventListener('click', async () => {
            const text = uiData.result ? resultLines(uiData.result).join('\n') : `${uiData.title}：${uiData.step}`;
            try { await navigator.clipboard.writeText(text); ui.copy.textContent = '已复制'; }
            catch { ui.details.open = true; const selection = window.getSelection();
                const range = document.createRange(); range.selectNodeContents(ui.pre); selection?.removeAllRanges(); selection?.addRange(range);
                ui.copy.textContent = '请长按文字复制'; }
            setTimeout(() => { ui.copy.textContent = '复制信息'; }, 2200);
        });
        const start = event => {
            if (!event.isPrimary || event.button !== 0) return;
            suppressClick = false;
            const rect = panel.getBoundingClientRect();
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
            event.currentTarget.setPointerCapture(event.pointerId);
        };
        const move = event => {
            if (!drag || event.pointerId !== drag.id) return;
            const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
            if (!drag.moved && Math.hypot(dx,dy) < 6) return;
            drag.moved = true;
            const v = viewportBox(), rect = panel.getBoundingClientRect();
            panel.style.setProperty('left', Math.max(v.x + 10, Math.min(v.x + v.w - rect.width - 10, drag.left + dx)) + 'px', 'important');
            panel.style.setProperty('top', Math.max(v.y + 10, Math.min(v.y + v.h - rect.height - 10, drag.top + dy)) + 'px', 'important');
        };
        const end = event => {
            if (!drag || event.pointerId !== drag.id) return;
            const moved = drag.moved;
            if (moved) {
                const v = viewportBox(), rect = panel.getBoundingClientRect();
                uiPrefs.side = rect.left + rect.width / 2 < v.x + v.w / 2 ? 'left' : 'right';
                uiPrefs.y = Math.max(0, Math.min(1, (rect.top - v.y - 10) / Math.max(1, v.h - rect.height - 20)));
                saveUi();
            }
            drag = null;
            suppressClick = moved || event.type === 'pointercancel';
            positionPanel();
            setTimeout(() => { suppressClick = false; }, 300);
        };
        for (const el of [ui.chip, ui.handle]) {
            el.addEventListener('pointerdown', start); el.addEventListener('pointermove', move);
            el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
            el.addEventListener('lostpointercapture', end);
            el.addEventListener('keydown', event => {
                if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key)) return;
                event.preventDefault();
                if (event.key === 'Home') uiPrefs = { side: 'right', y: .32 };
                if (event.key === 'ArrowLeft') uiPrefs.side = 'left';
                if (event.key === 'ArrowRight') uiPrefs.side = 'right';
                if (event.key === 'ArrowUp') uiPrefs.y = Math.max(0, uiPrefs.y - .05);
                if (event.key === 'ArrowDown') uiPrefs.y = Math.min(1, uiPrefs.y + .05);
                saveUi(); positionPanel();
            });
        }
        document.addEventListener('pointerdown', event => {
            if (expanded && !event.composedPath().includes(panel)) setExpanded(false);
        }, true);
        document.addEventListener('keydown', event => {
            if (expanded && event.key === 'Escape') setExpanded(false, true);
        });
        window.addEventListener('resize', positionPanel, { passive: true });
        window.visualViewport?.addEventListener('resize', positionPanel, { passive: true });
        window.visualViewport?.addEventListener('scroll', positionPanel, { passive: true });
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(positionPanel).observe(panel);
        const mount = () => {
            if (!panel.isConnected && document.documentElement) document.documentElement.appendChild(panel);
            positionPanel();
        };
        if (document.documentElement) mount();
        else document.addEventListener('DOMContentLoaded', mount, { once: true });
        return panel;
    }
    function resultLines(result) {
        const lines = [`Model: ${result?.model || 'unknown'}`, `思考等级: ${result?.reasoning?.display || 'unknown'}`];
        if (result?.internalModel && result.internalModel !== result.model) lines.push(`Arena 配置: ${result.internalModel}`);
        if (result?.reasoning?.source) lines.push(`依据: ${result.reasoning.source}`);
        if (Array.isArray(result?.reasoningTokens) && result.reasoningTokens.length) lines.push(`推理 Token: ${result.reasoningTokens.join(' / ')}（用量，不等于档位）`);
        if (result?.error) lines.push(`错误: ${result.error}`);
        return lines;
    }
    function renderDetectorUi() {
        ensurePanel();
        const busy = uiData.phase === 'verifying';
        const known = uiData.result?.model && uiData.result.model !== 'unknown';
        panel.style.setProperty('--tone', busy ? '#eac77b' : uiData.phase === 'result' ? (known ? '#8fdeb2' : '#eac77b') : '#99a5b7');
        ui.chip.classList.toggle('busy', busy); ui.card.classList.toggle('busy', busy);
        ui.label.textContent = busy ? '查询中' : uiData.phase === 'result' ? (known ? '查看结果' : '未识别') : '待检测';
        ui.chip.setAttribute('aria-label', `${ui.label.textContent}，点击展开检测信息`);
        ui.state.textContent = uiData.title;
        ui.model.textContent = uiData.result ? (uiData.result.model || 'unknown') : uiData.step;
        ui.reason.hidden = !uiData.result;
        ui.reason.textContent = uiData.result ? `思考等级 · ${uiData.result.reasoning?.display || 'unknown'}` : '';
        ui.pre.textContent = uiData.result ? resultLines(uiData.result).join('\n') : `${uiData.title}：${uiData.step}`;
        positionPanel();
    }
    function setPanelWaiting() {
        uiData = { phase: 'waiting', title: '等待验证', step: '发送内容后开始检测', result: null };
        renderDetectorUi();
    }
    function setPanelVerifying(step = '等待开始') {
        uiData = { phase: 'verifying', title: '验证进行中', step, result: null };
        renderDetectorUi();
    }
    function setPanelResult(result) {
        uiData = { phase: 'result', title: result?.error ? '检测结束 · 存在错误' : '检测结果', step: '', result };
        renderDetectorUi(); // Never auto-open or interrupt typing when results arrive.
    }

    /*
     * ------------------------------------------------------------
     * Console logging
     * ------------------------------------------------------------
     */

    function log(...args) {

        console.log(
            '%c[ARENA MODEL]',
            'background:#171717;color:#5cff8d;font-weight:bold',
            ...args
        );
    }

    function warn(...args) {

        console.warn(
            '%c[ARENA MODEL]',
            'background:#3a2900;color:#ffd479;font-weight:bold',
            ...args
        );
    }

    function error(...args) {

        console.error(
            '%c[ARENA MODEL]',
            'background:#3b0000;color:#ff8080;font-weight:bold',
            ...args
        );
    }

    /*
     * ------------------------------------------------------------
     * JWT
     * ------------------------------------------------------------
     */

    function decodeJwtPayload(
        token
    ) {

        try {

            if (
                !token ||
                typeof token !== 'string'
            ) {
                return null;
            }

            const clean =
                token.replace(
                    /^Bearer\s+/i,
                    ''
                );

            const parts =
                clean.split('.');

            if (
                parts.length !== 3
            ) {
                return null;
            }

            let b64 =
                parts[1]
                    .replace(/-/g, '+')
                    .replace(/_/g, '/');

            while (
                b64.length % 4 !== 0
            ) {

                b64 += '=';
            }

            const binary =
                atob(b64);

            const bytes =
                Uint8Array.from(
                    binary,
                    x =>
                        x.charCodeAt(0)
                );

            const decoded =
                new TextDecoder().decode(
                    bytes
                );

            return JSON.parse(
                decoded
            );

        } catch {

            return null;
        }
    }

    function extractRunInfo(
        token
    ) {

        const payload =
            decodeJwtPayload(
                token
            );

        if (!payload) {

            return {
                runId: null,
                payload: null
            };
        }

        const scopes =
            Array.isArray(
                payload.scopes
            )
                ? payload.scopes
                : [];

        const scope =
            scopes.find(
                value =>
                    typeof value === 'string' &&
                    value.startsWith(
                        'read:runs:'
                    )
            );

        return {

            runId:
                scope
                    ? scope.slice(
                        'read:runs:'.length
                    )
                    : null,

            payload
        };
    }

    /*
     * ------------------------------------------------------------
     * SSE
     * ------------------------------------------------------------
     */

    function processSseEvent(
        eventText
    ) {

        if (
            !eventText ||
            !eventText.trim()
        ) {
            return;
        }

        let eventName =
            '';

        for (
            const line
                of eventText.split(/\r?\n/)
        ) {

            if (
                line.startsWith(
                    'event:'
                )
            ) {

                eventName =
                    line.slice(
                        6
                    ).trim();

                break;
            }
        }

        if (
            eventName !== 'batch'
        ) {
            return;
        }

        const dataLines =
            eventText
                .split(/\r?\n/)
                .filter(
                    line =>
                        line.startsWith(
                            'data:'
                        )
                )
                .map(
                    line =>
                        line
                            .slice(5)
                            .trim()
                );

        if (
            !dataLines.length
        ) {
            return;
        }

        try {

            const parsed =
                JSON.parse(
                    dataLines.join('\n')
                );

            processBatch(
                parsed
            );

        } catch (e) {

            warn(
                'SSE batch parse failed',
                e
            );
        }
    }

    function processBatch(
        parsed
    ) {

        if (
            !parsed ||
            !Array.isArray(
                parsed.records
            )
        ) {
            return;
        }

        for (
            const record
                of parsed.records
        ) {

            if (
                !record ||
                typeof record !== 'object'
            ) {
                continue;
            }

            const headers =
                Array.isArray(
                    record.headers
                )
                    ? record.headers
                    : null;

            if (!headers) {
                continue;
            }

            let turnComplete =
                false;

            let token =
                null;

            for (
                const pair of headers
            ) {

                if (
                    !Array.isArray(pair) ||
                    pair.length < 2
                ) {
                    continue;
                }

                const name =
                    String(pair[0])
                        .toLowerCase();

                const value =
                    pair[1];

                if (
                    name ===
                        'trigger-control' &&
                    value ===
                        'turn-complete'
                ) {

                    turnComplete =
                        true;
                }

                if (
                    name ===
                        'public-access-token' &&
                    typeof value ===
                        'string'
                ) {

                    token =
                        value;
                }
            }

            if (
                !turnComplete
            ) {
                continue;
            }

            log(
                'TURN COMPLETE',
                {
                    seq:
                        record.seq_num,

                    hasToken:
                        !!token
                }
            );

            if (!token) {
                continue;
            }

            handleRunToken(
                token
            );
        }
    }

    /*
     * ------------------------------------------------------------
     * Run token
     * ------------------------------------------------------------
     */

    function handleRunToken(
        token
    ) {

        const {
            runId
        } =
            extractRunInfo(
                token
            );

        /*
         * 查询 Run ID
         */

        setPanelVerifying(
            '查询 Run ID'
        );

        if (!runId) {

            warn(
                'Public token found but read:runs scope missing.'
            );

            return;
        }

        window.__ARENA_RUN_ID__ =
            runId;

        window.__ARENA_RUN_TOKEN__ =
            token;

        log(
            'RUN ID:',
            runId
        );

        /*
         * 找到 Run ID 后继续。
         */

        setPanelVerifying(
            '查询 Trace'
        );

        if (
            processedRuns.has(
                runId
            )
        ) {

            return;
        }

        /*
         * Set 只表示“当前正在读取”。同一个 Agent run 可能包含多轮，
         * 本轮结束后删除，下一轮仍可重新读取最新的 chat turn。
         */

        processedRuns.add(
            runId
        );

        fetchTrace(
            runId,
            token
        ).finally(() => {

            processedRuns.delete(
                runId
            );
        });
    }

    /*
     * ------------------------------------------------------------
     * Trigger Trace
     * ------------------------------------------------------------
     */

    const DETAIL_MESSAGES = new Set([
        'ai.streamText.doStream',
        'token.usage.recorded',
        'spend.recorded'
    ]);

    const wait = ms =>
        new Promise(resolve => setTimeout(resolve, ms));

    async function fetchJson(
        url,
        token,
        maxBytes = 4 * 1024 * 1024
    ) {

        const response =
            await originalFetch(
                url,
                {
                    method: 'GET',

                    headers: {
                        Authorization:
                            `Bearer ${token}`,

                        Accept:
                            'application/json'
                    },

                    credentials:
                        'omit',

                    redirect:
                        'error',

                    cache:
                        'no-store'
                }
            );

        const text =
            await response.text();

        if (!response.ok) {

            const e =
                new Error(
                    `HTTP ${response.status}`
                );

            e.status =
                response.status;

            throw e;
        }

        if (text.length > maxBytes) {
            throw new Error(
                '响应过大，已停止解析'
            );
        }

        return JSON.parse(
            text
        );
    }

    function selectEventCandidates(
        trace,
        runId
    ) {

        if (!Array.isArray(trace?.events)) {
            return [];
        }

        let currentTurn =
            null;

        const selected =
            [];

        for (const event of trace.events) {

            if (
                !event ||
                event.runId !== runId ||
                typeof event.message !== 'string'
            ) {
                continue;
            }

            const turn =
                event.message.match(
                    /^chat turn (\d{1,4})$/
                );

            if (turn) {

                currentTurn =
                    Number(turn[1]);

                continue;
            }

            if (
                !DETAIL_MESSAGES.has(
                    event.message
                ) ||
                typeof event.spanId !== 'string'
            ) {
                continue;
            }

            selected.push({
                spanId:
                    event.spanId,

                runId:
                    event.runId,

                message:
                    event.message,

                turn:
                    currentTurn,

                partial:
                    event.isPartial !== false,

                path:
                    '$.events'
            });
        }

        const numbered =
            selected.filter(
                item =>
                    Number.isSafeInteger(
                        item.turn
                    )
            );

        const latestTurn =
            numbered.length
                ? Math.max(
                    ...numbered.map(
                        item => item.turn
                    )
                )
                : null;

        const latest =
            latestTurn === null
                ? selected
                : selected.filter(
                    item =>
                        item.turn === latestTurn
                );

        const seen =
            new Set();

        return latest
            .filter(item => {

                if (
                    seen.has(
                        item.spanId
                    )
                ) {
                    return false;
                }

                seen.add(
                    item.spanId
                );

                return true;
            })
            .slice(-24);
    }

    function selectTraceCandidates(
        spans
    ) {

        const exact =
            spans.filter(
                span =>
                    DETAIL_MESSAGES.has(
                        span.message
                    )
            );

        const ai =
            spans.filter(
                span =>
                    isLikelyAiSpan(
                        span
                    )
            );

        const source =
            exact.length
                ? [...exact, ...ai]
                : ai.length
                    ? ai
                    : spans;

        const seen =
            new Set();

        return source
            .filter(item => {

                if (
                    !item.spanId ||
                    seen.has(item.spanId)
                ) {
                    return false;
                }

                seen.add(item.spanId);

                return true;
            })
            .slice(-24);
    }

    function detailSetReady(
        candidates
    ) {

        const messages =
            new Set(
                candidates.map(
                    item => item.message
                )
            );

        return (
            messages.has(
                'ai.streamText.doStream'
            ) &&
            messages.has(
                'token.usage.recorded'
            ) &&
            messages.has(
                'spend.recorded'
            ) &&
            candidates.every(
                item => !item.partial
            )
        );
    }

    async function fetchTrace(
        runId,
        token
    ) {

        let candidates =
            [];

        let eventsWorked =
            false;

        try {

            /*
             * 先读取 /events。内部 modelName 通常不在 AI stream span，
             * 而在 token.usage.recorded / spend.recorded 中。
             */

            for (
                let attempt = 1;
                attempt <= 8;
                attempt++
            ) {

                setPanelVerifying(
                    `查询 Trace ${attempt}/8`
                );

                const url =
                    `https://api.trigger.dev/api/v1/runs/${encodeURIComponent(runId)}/events`;

                log(
                    'EVENTS REQUEST',
                    url
                );

                let json;

                try {

                    json =
                        await fetchJson(
                            url,
                            token
                        );

                    eventsWorked =
                        true;

                } catch (e) {

                    if (e?.status === 429) {
                        throw new Error(
                            'Trace 接口限流（HTTP 429）'
                        );
                    }

                    warn(
                        'EVENTS REQUEST FAILED - fallback to /trace',
                        e
                    );

                    break;
                }

                const current =
                    selectEventCandidates(
                        json,
                        runId
                    );

                if (current.length) {
                    candidates =
                        current;
                }

                log(
                    'DETAIL SPANS FOUND',
                    candidates.map(item => ({
                        message: item.message,
                        spanId: item.spanId,
                        turn: item.turn,
                        partial: item.partial
                    }))
                );

                if (
                    detailSetReady(
                        candidates
                    ) ||
                    attempt === 8
                ) {
                    break;
                }

                await wait(
                    1500
                );
            }

            /*
             * 兼容旧脚本使用的 /trace 树形接口；/events 不可用或未列出
             * 目标 span 时再回退，不会把任意字段误当思考档位。
             */

            const messages =
                new Set(
                    candidates.map(
                        item => item.message
                    )
                );

            if (
                !candidates.length ||
                (
                    !messages.has('token.usage.recorded') &&
                    !messages.has('spend.recorded')
                )
            ) {

                setPanelVerifying(
                    '查询 Trace（兼容接口）'
                );

                const url =
                    `https://api.trigger.dev/api/v1/runs/${encodeURIComponent(runId)}/trace`;

                const json =
                    await fetchJson(
                        url,
                        token
                    );

                const spans =
                    collectTraceSpans(
                        json
                    );

                log(
                    'TRACE SPANS FOUND',
                    spans.length
                );

                const fallback =
                    selectTraceCandidates(
                        spans
                    );

                const seen =
                    new Set();

                candidates =
                    [...candidates, ...fallback]
                        .filter(item => {

                            if (
                                !item.spanId ||
                                seen.has(item.spanId)
                            ) {
                                return false;
                            }

                            seen.add(item.spanId);

                            return true;
                        })
                        .slice(-24);

                if (!candidates.length) {

                    debugTrace(
                        json
                    );

                    throw new Error(
                        'Trace 中没有可读取的模型 span'
                    );
                }
            }

            setPanelVerifying(
                '读取模型与思考档位'
            );

            const result =
                await fetchSpanDetails(
                    runId,
                    token,
                    candidates
                );

            showModelResult(
                result
            );

            return result;

        } catch (e) {

            error(
                'TRACE FETCH FAILED',
                e
            );

            const result =
                buildFinalResult(
                    createAggregate(
                        runId
                    )
                );

            result.error =
                e?.message ||
                'Trace 读取失败';

            if (!eventsWorked) {
                result.reasoning.source =
                    result.error;
            }

            showModelResult(
                result
            );

            return result;
        }
    }

    /*
     * ------------------------------------------------------------
     * Trace span tree
     * ------------------------------------------------------------
     */

    function collectTraceSpans(
        traceResponse
    ) {

        const results =
            [];

        const visited =
            new WeakSet();

        const root =
            traceResponse?.trace
                ?.rootSpan;

        function visit(
            span,
            path
        ) {

            if (
                !span ||
                typeof span !== 'object'
            ) {
                return;
            }

            if (
                visited.has(span)
            ) {
                return;
            }

            visited.add(
                span
            );

            const data =
                span.data ||
                {};

            results.push({

                span,

                spanId:
                    span.id ||
                    span.spanId ||
                    null,

                parentId:
                    span.parentId ||
                    null,

                runId:
                    span.runId ||
                    null,

                message:
                    typeof data.message ===
                        'string'
                        ? data.message
                        : '',

                properties:
                    data.properties ||
                    span.properties ||
                    null,

                events:
                    data.events ||
                    span.events ||
                    null,

                output:
                    data.output,

                path
            });

            const children =
                Array.isArray(
                    span.children
                )
                    ? span.children
                    : [];

            for (
                let i = 0;
                i < children.length;
                i++
            ) {

                visit(
                    children[i],
                    `${path}.children[${i}]`
                );
            }
        }

        if (root) {

            visit(
                root,
                '$.trace.rootSpan'
            );

        } else {

            recursiveFindSpans(
                traceResponse?.trace ||
                    traceResponse,
                '$',
                results,
                visited
            );
        }

        return results;
    }

    function recursiveFindSpans(
        value,
        path,
        results,
        visited
    ) {

        if (
            !value ||
            typeof value !== 'object'
        ) {
            return;
        }

        if (
            visited.has(value)
        ) {
            return;
        }

        visited.add(
            value
        );

        if (
            value.id &&
            value.data &&
            typeof value.data === 'object'
        ) {

            results.push({

                span:
                    value,

                spanId:
                    value.id,

                parentId:
                    value.parentId ||
                    null,

                runId:
                    value.runId ||
                    null,

                message:
                    typeof value.data.message ===
                        'string'
                        ? value.data.message
                        : '',

                properties:
                    value.data.properties ||
                    null,

                events:
                    value.data.events ||
                    null,

                output:
                    value.data.output,

                path
            });
        }

        for (
            const [key, child]
                of Object.entries(value)
        ) {

            if (
                child &&
                typeof child === 'object'
            ) {

                recursiveFindSpans(
                    child,
                    `${path}.${key}`,
                    results,
                    visited
                );
            }
        }
    }

    /*
     * ------------------------------------------------------------
     * AI span detection
     * ------------------------------------------------------------
     */

    function isLikelyAiSpan(
        item
    ) {

        const strings =
            [];

        collectSearchableText(
            item.message,
            strings,
            0
        );

        collectSearchableText(
            item.properties,
            strings,
            0
        );

        collectSearchableText(
            item.events,
            strings,
            0
        );

        const text =
            strings
                .join(' ')
                .toLowerCase();

        return (
            text.includes(
                'ai.streamtext'
            ) ||
            text.includes(
                'streamtext'
            ) ||
            text.includes(
                'dostream'
            ) ||
            text.includes(
                'gen_ai'
            ) ||
            hasNestedKey(
                item.properties,
                'gen_ai'
            )
        );
    }

    function collectSearchableText(
        value,
        output,
        depth
    ) {

        if (
            depth > 20
        ) {
            return;
        }

        if (
            typeof value === 'string'
        ) {

            output.push(
                value
            );

            return;
        }

        if (
            !value ||
            typeof value !== 'object'
        ) {
            return;
        }

        for (
            const [key, child]
                of Object.entries(value)
        ) {

            output.push(
                key
            );

            collectSearchableText(
                child,
                output,
                depth + 1
            );
        }
    }

    function hasNestedKey(
        obj,
        target
    ) {

        if (
            !obj ||
            typeof obj !== 'object'
        ) {
            return false;
        }

        for (
            const [key, value]
                of Object.entries(obj)
        ) {

            if (
                key === target
            ) {
                return true;
            }

            if (
                value &&
                typeof value === 'object' &&
                hasNestedKey(
                    value,
                    target
                )
            ) {

                return true;
            }
        }

        return false;
    }

    /*
     * ------------------------------------------------------------
     * Span details
     * ------------------------------------------------------------
     */

    function createAggregate(
        runId
    ) {

        return {
            runId,
            spanIds: [],
            internalModels: [],
            requestModels: [],
            responseModels: [],
            fallbackModels: [],
            providers: [],
            operations: [],
            explicitEfforts: [],
            thinkingBudgets: [],
            thinkingStates: [],
            reasoningTokens: [],
            settingKeys: []
        };
    }

    function addUnique(
        list,
        value
    ) {

        if (
            value === null ||
            value === undefined ||
            value === ''
        ) {
            return;
        }

        if (
            !list.some(
                item =>
                    JSON.stringify(item) ===
                    JSON.stringify(value)
            )
        ) {
            list.push(value);
        }
    }

    function cleanLabel(
        value
    ) {

        return (
            typeof value === 'string' &&
            value.trim() &&
            value.length <= 240 &&
            !/[\u0000-\u001f\u007f]/.test(value)
        )
            ? value.trim()
            : null;
    }

    function cleanCount(
        value
    ) {

        return (
            Number.isSafeInteger(value) &&
            value >= 0
        )
            ? value
            : null;
    }

    function getPath(
        object,
        path
    ) {

        if (
            !object ||
            typeof object !== 'object'
        ) {
            return undefined;
        }

        if (
            Object.prototype.hasOwnProperty.call(
                object,
                path
            )
        ) {
            return object[path];
        }

        let current =
            object;

        for (
            const part of path.split('.')
        ) {

            if (
                !current ||
                typeof current !== 'object' ||
                !Object.prototype.hasOwnProperty.call(
                    current,
                    part
                )
            ) {
                return undefined;
            }

            current =
                current[part];
        }

        return current;
    }

    function firstLabel(
        object,
        paths
    ) {

        for (const path of paths) {

            const value =
                cleanLabel(
                    getPath(
                        object,
                        path
                    )
                );

            if (value) {
                return value;
            }
        }

        return null;
    }

    function parseObject(
        value
    ) {

        if (
            value &&
            typeof value === 'object'
        ) {
            return value;
        }

        if (
            typeof value === 'string' &&
            value.length < 65536
        ) {

            try {

                const parsed =
                    JSON.parse(value);

                return (
                    parsed &&
                    typeof parsed === 'object'
                )
                    ? parsed
                    : null;

            } catch {}
        }

        return null;
    }

    function normalizeTier(
        value
    ) {

        if (typeof value !== 'string') {
            return null;
        }

        const normalized =
            value
                .trim()
                .toLowerCase()
                .replace(/[\s_]+/g, '-')
                .replace(/^extra-high$/, 'xhigh')
                .replace(/^x-high$/, 'xhigh');

        return [
            'minimal',
            'low',
            'medium',
            'high',
            'xhigh',
            'max'
        ].includes(normalized)
            ? normalized
            : null;
    }

    function tierFromInternalModel(
        model
    ) {

        if (typeof model !== 'string') {
            return null;
        }

        /*
         * 同时兼容：xxx-high 与 xxx-max-20260910。
         * 只在 Arena 内部 modelName 上使用，不拿供应商型号猜档位。
         */

        const match =
            model
                .toLowerCase()
                .match(
                    /-(xhigh|high|medium|low|max|minimal)(?:-\d{8})?$/
                );

        return match?.[1] ||
            null;
    }

    function recordEffort(
        aggregate,
        value,
        path
    ) {

        const tier =
            normalizeTier(
                value
            );

        if (tier) {

            addUnique(
                aggregate.explicitEfforts,
                {
                    tier,
                    path
                }
            );

            return;
        }

        if (
            typeof value === 'boolean'
        ) {

            addUnique(
                aggregate.thinkingStates,
                {
                    value:
                        value
                            ? 'enabled'
                            : 'disabled',
                    path
                }
            );

            return;
        }

        if (typeof value === 'string') {

            const state =
                value
                    .trim()
                    .toLowerCase();

            if (
                [
                    'enabled',
                    'disabled',
                    'auto',
                    'on',
                    'off',
                    'none'
                ].includes(state)
            ) {

                addUnique(
                    aggregate.thinkingStates,
                    {
                        value: state,
                        path
                    }
                );
            }
        }
    }

    function scanReasoningObject(
        value,
        prefix,
        aggregate,
        depth = 0,
        budget = { left: 80 }
    ) {

        if (
            depth > 6 ||
            budget.left <= 0
        ) {
            return;
        }

        const parsed =
            parseObject(value) ||
            value;

        if (
            !parsed ||
            typeof parsed !== 'object'
        ) {
            return;
        }

        for (
            const [key, child]
                of Object.entries(parsed)
        ) {

            if (budget.left-- <= 0) {
                break;
            }

            const path =
                prefix
                    ? `${prefix}.${key}`
                    : key;

            const compact =
                key
                    .toLowerCase()
                    .replace(/[._-]/g, '');

            const context =
                path.toLowerCase();

            if (
                compact === 'reasoningeffort' ||
                (
                    compact === 'effort' &&
                    /reason|thinking/.test(context)
                )
            ) {

                recordEffort(
                    aggregate,
                    child,
                    path
                );
            }

            if (
                [
                    'budgettokens',
                    'thinkingbudget',
                    'thinkingbudgettokens'
                ].includes(compact)
            ) {

                const count =
                    cleanCount(child);

                if (count !== null) {

                    addUnique(
                        aggregate.thinkingBudgets,
                        {
                            tokens: count,
                            path
                        }
                    );
                }
            }

            if (
                [
                    'reasoningtokens',
                    'thinkingtokens'
                ].includes(compact)
            ) {

                const count =
                    cleanCount(child);

                if (count !== null) {

                    addUnique(
                        aggregate.reasoningTokens,
                        count
                    );
                }
            }

            if (
                /reason|thinking/.test(context) &&
                [
                    'type',
                    'mode',
                    'enabled'
                ].includes(compact)
            ) {

                recordEffort(
                    aggregate,
                    child,
                    path
                );
            }

            if (
                child &&
                typeof child === 'object'
            ) {

                scanReasoningObject(
                    child,
                    path,
                    aggregate,
                    depth + 1,
                    budget
                );
            }
        }
    }

    function mergeSpanDetail(
        aggregate,
        detail,
        candidate
    ) {

        const properties =
            (
                detail?.properties &&
                typeof detail.properties === 'object'
            )
                ? detail.properties
                : (
                    detail?.data?.properties &&
                    typeof detail.data.properties === 'object'
                )
                    ? detail.data.properties
                    : {};

        const message =
            cleanLabel(
                detail?.message
            ) ||
            candidate.message ||
            '';

        addUnique(
            aggregate.spanIds,
            candidate.spanId
        );

        const internalModel =
            firstLabel(
                properties,
                [
                    'modelName',
                    'model_name'
                ]
            );

        if (
            internalModel &&
            (
                message === 'token.usage.recorded' ||
                message === 'spend.recorded'
            )
        ) {

            addUnique(
                aggregate.internalModels,
                internalModel
            );
        }

        const requestModel =
            firstLabel(
                properties,
                [
                    'ai.telemetry.metadata.apiModelName',
                    'gen_ai.request.model',
                    'ai.model.id',
                    'apiModelName'
                ]
            );

        const responseModel =
            firstLabel(
                properties,
                [
                    'ai.response.model',
                    'gen_ai.response.model'
                ]
            );

        const provider =
            firstLabel(
                properties,
                [
                    'ai.model.provider',
                    'provider'
                ]
            );

        const operation =
            firstLabel(
                properties,
                [
                    'ai.operation.name',
                    'ai.operationName',
                    'operationName',
                    'operation_name'
                ]
            );

        addUnique(
            aggregate.requestModels,
            requestModel
        );

        addUnique(
            aggregate.responseModels,
            responseModel
        );

        addUnique(
            aggregate.providers,
            provider
        );

        addUnique(
            aggregate.operations,
            operation || message
        );

        /*
         * 显式 reasoning effort：值可直接作为档位证据。
         */

        for (
            const path of [
                'ai.settings.reasoningEffort',
                'ai.settings.reasoning_effort',
                'gen_ai.request.reasoning_effort',
                'gen_ai.request.reasoningEffort'
            ]
        ) {

            const value =
                getPath(
                    properties,
                    path
                );

            if (value !== undefined) {

                addUnique(
                    aggregate.settingKeys,
                    path
                );

                recordEffort(
                    aggregate,
                    value,
                    path
                );
            }
        }

        const thinking =
            getPath(
                properties,
                'ai.settings.thinking'
            );

        if (thinking !== undefined) {

            addUnique(
                aggregate.settingKeys,
                'ai.settings.thinking'
            );

            if (
                thinking &&
                typeof thinking === 'object'
            ) {

                scanReasoningObject(
                    thinking,
                    'ai.settings.thinking',
                    aggregate
                );

            } else {

                recordEffort(
                    aggregate,
                    thinking,
                    'ai.settings.thinking'
                );
            }
        }

        for (
            const path of [
                'ai.settings.providerOptions',
                'ai.prompt.providerOptions'
            ]
        ) {

            const options =
                getPath(
                    properties,
                    path
                );

            if (options !== undefined) {

                addUnique(
                    aggregate.settingKeys,
                    path
                );

                scanReasoningObject(
                    options,
                    path,
                    aggregate
                );
            }
        }

        const providerMetadata =
            getPath(
                properties,
                'ai.response.providerMetadata'
            );

        if (providerMetadata !== undefined) {

            addUnique(
                aggregate.settingKeys,
                'ai.response.providerMetadata'
            );

            /*
             * response metadata 主要是实际用量；只记录 token/budget/state，
             * 不把 reasoning_tokens 数量映射成 high/medium/low。
             */

            scanReasoningObject(
                providerMetadata,
                'ai.response.providerMetadata',
                aggregate
            );
        }

        for (
            const path of [
                'reasoningTokens',
                'ai.usage.reasoningTokens'
            ]
        ) {

            const count =
                cleanCount(
                    getPath(
                        properties,
                        path
                    )
                );

            if (count !== null) {

                addUnique(
                    aggregate.reasoningTokens,
                    count
                );
            }
        }

        /*
         * 保留原脚本的宽松模型兼容逻辑，但只作为最后回退，
         * 不用它判断思考档位。
         */

        const generic =
            extractAiInfo(
                detail
            );

        addUnique(
            aggregate.fallbackModels,
            cleanLabel(
                generic.model
            )
        );

        addUnique(
            aggregate.providers,
            cleanLabel(
                generic.provider
            )
        );

        addUnique(
            aggregate.operations,
            cleanLabel(
                generic.operationName
            )
        );
    }

    function resolveReasoning(
        aggregate
    ) {

        const explicit =
            [
                ...new Set(
                    aggregate.explicitEfforts.map(
                        item => item.tier
                    )
                )
            ];

        const modelTiers =
            aggregate.internalModels
                .map(model => ({
                    model,
                    tier:
                        tierFromInternalModel(
                            model
                        )
                }))
                .filter(item => item.tier);

        const suffixes =
            [
                ...new Set(
                    modelTiers.map(
                        item => item.tier
                    )
                )
            ];

        if (explicit.length) {

            const level =
                explicit.length === 1
                    ? explicit[0]
                    : null;

            let source =
                '显式参数 ' +
                aggregate.explicitEfforts
                    .map(item => item.path)
                    .join(' / ');

            if (
                suffixes.length &&
                (
                    suffixes.length !== explicit.length ||
                    suffixes.some(
                        tier =>
                            !explicit.includes(tier)
                    )
                )
            ) {

                source +=
                    `；内部 modelName 后缀=${suffixes.join('/')}`;
            }

            return {
                level,
                display:
                    level ||
                    `冲突（${explicit.join(' / ')}）`,
                source,
                kind:
                    'explicit'
            };
        }

        if (suffixes.length) {

            const level =
                suffixes.length === 1
                    ? suffixes[0]
                    : null;

            return {
                level,
                display:
                    level ||
                    `冲突（${suffixes.join(' / ')}）`,
                source:
                    'Arena 内部 modelName 后缀：' +
                    modelTiers
                        .map(
                            item => item.model
                        )
                        .join(' / '),
                kind:
                    'modelName-suffix'
            };
        }

        if (aggregate.thinkingBudgets.length) {

            const budgets =
                [
                    ...new Set(
                        aggregate.thinkingBudgets.map(
                            item => item.tokens
                        )
                    )
                ];

            return {
                level: null,
                display:
                    `已启用（budget ${budgets.join(' / ')} tokens）`,
                source:
                    '显式 thinking budget；没有可映射的 high/medium/low',
                kind:
                    'budget'
            };
        }

        if (aggregate.thinkingStates.length) {

            const states =
                [
                    ...new Set(
                        aggregate.thinkingStates.map(
                            item => item.value
                        )
                    )
                ];

            return {
                level: null,
                display:
                    states.join(' / '),
                source:
                    '显式 thinking 状态；未提供强度档位',
                kind:
                    'state'
            };
        }

        return {
            level: null,
            display: 'unknown',
            source:
                'trace 未提供 reasoningEffort/thinking 档位，且内部 modelName 无档位后缀',
            kind:
                'unknown'
        };
    }

    function joinValues(
        values
    ) {

        return values.length
            ? values.join(' / ')
            : null;
    }

    function buildFinalResult(
        aggregate
    ) {

        const responseModel =
            joinValues(
                aggregate.responseModels
            );

        const requestModel =
            joinValues(
                aggregate.requestModels
            );

        const fallbackModel =
            joinValues(
                aggregate.fallbackModels
            );

        const internalModel =
            joinValues(
                aggregate.internalModels
            );

        return {
            runId:
                aggregate.runId,

            spanIds:
                [...aggregate.spanIds],

            model:
                responseModel ||
                requestModel ||
                fallbackModel ||
                internalModel ||
                'unknown',

            internalModel,
            requestModel,
            responseModel,

            provider:
                joinValues(
                    aggregate.providers
                ) ||
                'unknown',

            operationName:
                joinValues(
                    aggregate.operations
                ) ||
                'unknown',

            reasoning:
                resolveReasoning(
                    aggregate
                ),

            reasoningTokens:
                [...aggregate.reasoningTokens],

            thinkingBudgets:
                aggregate.thinkingBudgets.map(
                    item => ({...item})
                ),

            settingKeys:
                [...aggregate.settingKeys]
        };
    }

    async function fetchSpanDetails(
        runId,
        token,
        candidates
    ) {

        const aggregate =
            createAggregate(
                runId
            );

        const seen =
            new Set();

        const selected =
            candidates
                .filter(candidate => {

                    if (
                        !candidate?.spanId ||
                        seen.has(candidate.spanId)
                    ) {
                        return false;
                    }

                    seen.add(candidate.spanId);

                    return true;
                })
                .slice(-24);

        for (
            let index = 0;
            index < selected.length;
            index++
        ) {

            const candidate =
                selected[index];

            if (index) {
                await wait(250);
            }

            setPanelVerifying(
                `读取 Span ${index + 1}/${selected.length}`
            );

            const url =
                `https://api.trigger.dev/api/v1/runs/${encodeURIComponent(runId)}/spans/${encodeURIComponent(candidate.spanId)}`;

            try {

                const json =
                    await fetchJson(
                        url,
                        token,
                        512 * 1024
                    );

                if (
                    json?.runId &&
                    json.runId !== runId
                ) {
                    continue;
                }

                if (
                    json?.spanId &&
                    json.spanId !== candidate.spanId
                ) {
                    continue;
                }

                mergeSpanDetail(
                    aggregate,
                    json,
                    candidate
                );

            } catch (e) {

                if (e?.status === 429) {

                    warn(
                        'SPAN DETAIL RATE LIMITED - stopped'
                    );

                    break;
                }

                warn(
                    'SPAN DETAIL FAILED',
                    candidate.spanId,
                    e
                );
            }
        }

        return buildFinalResult(
            aggregate
        );
    }

    /*
     * ------------------------------------------------------------
     * 从 span detail 中提取 AI 信息
     * ------------------------------------------------------------
     */

    function extractAiInfo(
        root
    ) {

        const result = {

            model: null,

            provider: null,

            operationName: null
        };

        const visited =
            new WeakSet();

        function visit(
            value,
            depth
        ) {

            if (
                depth > 40 ||
                !value ||
                typeof value !== 'object'
            ) {
                return;
            }

            if (
                visited.has(value)
            ) {
                return;
            }

            visited.add(
                value
            );

            /*
             * ai:
             *
             * {
             *   model,
             *   provider,
             *   operationName
             * }
             */

            if (
                value.ai &&
                typeof value.ai === 'object'
            ) {

                result.model =
                    result.model ||
                    getString(
                        value.ai,
                        [
                            'model',
                            'modelId',
                            'model_id',
                            'modelName',
                            'model_name'
                        ]
                    );

                result.provider =
                    result.provider ||
                    getString(
                        value.ai,
                        [
                            'provider',
                            'providerId',
                            'provider_id',
                            'providerName',
                            'provider_name'
                        ]
                    );

                result.operationName =
                    result.operationName ||
                    getString(
                        value.ai,
                        [
                            'operationName',
                            'operation',
                            'operation_name'
                        ]
                    );
            }

            /*
             * 通用字段兼容。
             */

            for (
                const [key, child]
                    of Object.entries(value)
            ) {

                const lower =
                    key.toLowerCase();

                if (
                    typeof child === 'string'
                ) {

                    if (
                        !result.model &&
                        (
                            lower === 'model' ||
                            lower === 'modelid' ||
                            lower === 'model_id' ||
                            lower === 'modelname' ||
                            lower === 'model_name' ||
                            lower.includes(
                                'request.model'
                            ) ||
                            lower.includes(
                                'response.model'
                            )
                        )
                    ) {

                        result.model =
                            child;
                    }

                    if (
                        !result.provider &&
                        (
                            lower === 'provider' ||
                            lower === 'providerid' ||
                            lower === 'provider_id' ||
                            lower === 'providername' ||
                            lower === 'provider_name'
                        )
                    ) {

                        result.provider =
                            child;
                    }

                    if (
                        !result.operationName &&
                        (
                            lower === 'operationname' ||
                            lower === 'operation_name'
                        )
                    ) {

                        result.operationName =
                            child;
                    }
                }

                if (
                    child &&
                    typeof child === 'object'
                ) {

                    visit(
                        child,
                        depth + 1
                    );
                }
            }
        }

        visit(
            root,
            0
        );

        return result;
    }

    function getString(
        obj,
        keys
    ) {

        if (
            !obj ||
            typeof obj !== 'object'
        ) {
            return null;
        }

        for (
            const key of keys
        ) {

            const value =
                obj[key];

            if (
                typeof value === 'string' &&
                value.trim()
            ) {

                return value.trim();
            }
        }

        return null;
    }

    /*
     * ------------------------------------------------------------
     * 最终显示
     * ------------------------------------------------------------
     */

    function showModelResult(
        result
    ) {

        const model =
            result?.model ||
            'unknown';

        const provider =
            result?.provider ||
            'unknown';

        const operation =
            result?.operationName ||
            'unknown';

        log(
            '%cMODEL + REASONING FOUND',
            'background:#075c2b;color:white;font-size:16px;font-weight:bold;padding:5px',
            {
                runId:
                    result?.runId,

                spanIds:
                    result?.spanIds,

                provider,

                model,

                internalModel:
                    result?.internalModel,

                requestModel:
                    result?.requestModel,

                responseModel:
                    result?.responseModel,

                reasoning:
                    result?.reasoning,

                reasoningTokens:
                    result?.reasoningTokens,

                operation
            }
        );

        setPanelResult(
            result
        );

        window.__ARENA_BACKEND_MODEL__ =
            model;

        window.__ARENA_INTERNAL_MODEL__ =
            result?.internalModel ||
            null;

        window.__ARENA_REQUEST_MODEL__ =
            result?.requestModel ||
            null;

        window.__ARENA_RESPONSE_MODEL__ =
            result?.responseModel ||
            null;

        window.__ARENA_REASONING_LEVEL__ =
            result?.reasoning?.level ||
            null;

        window.__ARENA_REASONING_INFO__ =
            result?.reasoning ||
            null;

        window.__ARENA_BACKEND_PROVIDER__ =
            provider;

        window.__ARENA_BACKEND_OPERATION__ =
            operation;

        window.__ARENA_MODEL_RESULT__ =
            result;
    }

    /*
     * ------------------------------------------------------------
     * Trace debug
     * ------------------------------------------------------------
     */

    function debugTrace(
        trace
    ) {

        console.group(
            '%c[ARENA TRACE DEBUG]',
            'background:#334;color:white;font-weight:bold'
        );

        console.dir(
            trace
        );

        console.groupEnd();
    }

    /*
     * ------------------------------------------------------------
     * fetch hook
     * ------------------------------------------------------------
     */

    window.fetch =
        function (...args) {

            let url = '';

            try {

                const input =
                    args[0];

                if (
                    typeof input ===
                        'string'
                ) {

                    url =
                        input;

                } else if (
                    input?.url
                ) {

                    url =
                        input.url;
                }

            } catch {}

            const isRealtime =
                /\/ai-proxy\/realtime\/v1\/sessions\/[^/]+\/out(?:\?|$)/
                    .test(url) ||
                /\/realtime\/v1\/sessions\/[^/]+\/out(?:\?|$)/
                    .test(url);

            if (!isRealtime) {

                return originalFetch.apply(
                    this,
                    args
                );
            }

            const promise =
                originalFetch.apply(
                    this,
                    args
                );

            log(
                'REALTIME OUT',
                url
            );

            promise.then(
                response => {

                    log(
                        'FETCH RESOLVED',
                        {
                            status:
                                response.status,

                            contentType:
                                response.headers.get(
                                    'content-type'
                                )
                        }
                    );

                    try {

                        const clone =
                            response.clone();

                        if (!clone.body) {
                            return;
                        }

                        const reader =
                            clone.body.getReader();

                        const decoder =
                            new TextDecoder();

                        let buffer =
                            '';

                        const readLoop =
                            async () => {

                                try {

                                    while (true) {

                                        const {
                                            value,
                                            done
                                        } =
                                            await reader.read();

                                        if (done) {
                                            break;
                                        }

                                        if (!value) {
                                            continue;
                                        }

                                        buffer +=
                                            decoder.decode(
                                                value,
                                                {
                                                    stream: true
                                                }
                                            );

                                        const pieces =
                                            buffer.split(
                                                /\r?\n\r?\n/
                                            );

                                        buffer =
                                            pieces.pop() ||
                                            '';

                                        for (
                                            const piece
                                                of pieces
                                        ) {

                                            processSseEvent(
                                                piece
                                            );
                                        }
                                    }

                                } catch (e) {

                                    if (
                                        e?.name ===
                                            'AbortError'
                                    ) {

                                        log(
                                            'SSE stream aborted by page'
                                        );

                                    } else {

                                        warn(
                                            'SSE READ ERROR',
                                            e
                                        );
                                    }
                                }
                            };

                        readLoop();

                    } catch (e) {

                        warn(
                            'SSE CLONE ERROR',
                            e
                        );
                    }
                },

                err => {

                    warn(
                        'REALTIME FETCH ERROR',
                        err
                    );
                }
            );

            return promise;
        };

    /*
     * ------------------------------------------------------------
     * Initialize
     * ------------------------------------------------------------
     */

    setPanelWaiting();

    log(
        '%cINSTALLED',
        'background:#111;color:#00ff66;font-size:16px;font-weight:bold'
    );

    /*
     * ------------------------------------------------------------
     * External helpers
     * ------------------------------------------------------------
     */

    window.__ARENA_DETECTOR__ = {

        getRunId() {

            return (
                window.__ARENA_RUN_ID__ ||
                null
            );
        },

        getModel() {

            return (
                window.__ARENA_BACKEND_MODEL__ ||
                null
            );
        },

        getInternalModel() {

            return (
                window.__ARENA_INTERNAL_MODEL__ ||
                null
            );
        },

        getRequestModel() {

            return (
                window.__ARENA_REQUEST_MODEL__ ||
                null
            );
        },

        getResponseModel() {

            return (
                window.__ARENA_RESPONSE_MODEL__ ||
                null
            );
        },

        getReasoningLevel() {

            return (
                window.__ARENA_REASONING_LEVEL__ ||
                null
            );
        },

        getReasoningInfo() {

            return (
                window.__ARENA_REASONING_INFO__ ||
                null
            );
        },

        getProvider() {

            return (
                window.__ARENA_BACKEND_PROVIDER__ ||
                null
            );
        },

        getOperation() {

            return (
                window.__ARENA_BACKEND_OPERATION__ ||
                null
            );
        },

        getResult() {

            return (
                window.__ARENA_MODEL_RESULT__ ||
                null
            );
        }
    };

})();
// END ORIGINAL DETECTOR v8.1.0
mountLegacyDisplayBridge();

// ====================================================================================
// Task feedback auto-continue (port of 9.23.2 ContinueWork.js, v2).
// Only the Arena "Was this task successful? / 此任务成功了吗？" card; only its single
// "Keep working / Continue working / 继续工作" option. Never generic confirmation dialogs.
// Always on.
// ====================================================================================
const continueWork = (() => {
  const KEY = 'amp.native.autoContinue';
  const norm = s => String(s || '').trim().replace(/\s+/g, ' ');
  const visible = el => !!el?.isConnected && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[aria-hidden="true"],[inert]');
  const label = el => norm(el.getAttribute('aria-label') || el.innerText || el.textContent);
  const controls = root => [...root.querySelectorAll('button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="option"],[role="radio"]')].filter(visible);
  const question = /^(?:此任务成功了吗[？?]?|这项任务成功了吗[？?]?|任务成功了吗[？?]?|Was this task successful[？?]?)$/i;
  const continueText = /^(?:继续工作|继续|Keep working|Continue working)$/i;
  const yesText = /^(?:是|成功|Yes)$/i, noText = /^(?:否|失败|No)$/i;
  const allowed = () => location.origin === 'https://arena.ai' && /^\/agent(?:\/[0-9a-f-]{36})?\/?$/i.test(location.pathname);
  const state = { url: '', sent: false, at: 0, absentAt: null, serial: 0, confirmed: 0, clicks: 0 };
  let onClick = null;
  const enabled = () => true; // always on (v1.5): the only choice clicked is Keep working
  function candidates() {
    const out = [];
    const pre = [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="option"],[role="radio"]')].filter(b => continueText.test(norm(b.getAttribute('aria-label') || b.textContent)));
    if (!pre.length) return out;
    for (const button of pre.filter(visible).filter(b => continueText.test(label(b)))) {
      if (button.closest('pre,code,[contenteditable="true"],[data-message-author-role="user"],[data-role="user"],[data-user-message-layout]')) continue;
      let root = button.parentElement;
      for (let depth = 0; root && depth < 8; depth++, root = root.parentElement) {
        if (['BODY', 'HTML', 'MAIN'].includes(root.tagName)) break;
        const lines = (root.innerText || root.textContent || '').split(/\r?\n/).map(norm);
        const heading = question.test(norm(root.getAttribute('aria-label'))) || lines.some(t => question.test(t)) ||
          [...root.querySelectorAll('h1,h2,h3,h4,p,span,div,[role="heading"]')].some(el => visible(el) && question.test(norm(el.innerText || el.textContent)));
        if (!heading) continue;
        const bs = controls(root);
        if (bs.some(b => yesText.test(label(b))) && bs.some(b => noText.test(label(b))) && bs.filter(b => continueText.test(label(b))).length === 1) { out.push({ button, root }); break; }
      }
    }
    return out;
  }
  function inspect() {
    const url = location.href, t = Date.now();
    if (state.url !== url) { state.url = url; state.sent = false; state.absentAt = null; state.at = 0; }
    if (!allowed()) return { status: 'out-of-scope', pending: false, serial: state.serial, confirmed: state.confirmed };
    const found = candidates();
    if (state.sent && state.absentAt !== null && t - state.absentAt >= 1000) { state.sent = false; state.confirmed = state.serial; state.absentAt = null; }
    if (!found.length) { if (state.sent && state.absentAt === null) state.absentAt = t; return { status: state.sent ? 'settling' : 'idle', pending: state.sent, serial: state.serial, confirmed: state.confirmed }; }
    state.absentAt = null;
    return { status: state.sent ? (t - state.at >= 12000 ? 'unconfirmed' : 'waiting') : found.length === 1 ? 'ready' : 'ambiguous', pending: true, serial: state.serial, confirmed: state.confirmed };
  }
  function tick(expectedUrl = location.href) {
    if (location.href !== expectedUrl) return { status: 'navigation-changed', pending: false };
    const r = inspect(); if (r.status !== 'ready') return r;
    const found = candidates(); if (found.length !== 1) return { ...r, status: 'ambiguous' };
    const b = found[0].button;
    if (b.disabled || b.getAttribute('aria-disabled') === 'true') return { ...r, status: 'disabled' };
    // Mark before dispatch so a rerender or a throwing handler can never cause a second click.
    state.sent = true; state.at = Date.now(); state.absentAt = null; state.serial++; state.clicks++;
    b.click(); try { onClick?.(); } catch {}
    return { status: 'clicked', pending: true, serial: state.serial, confirmed: state.confirmed };
  }
  let scheduled = false;
  const auto = () => { if (scheduled) return; scheduled = true; setTimeout(() => { scheduled = false; if (enabled()) tick(); else inspect(); }, 250); };
  function start() {
    if (!document.documentElement) return;
    new MutationObserver(auto).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'style', 'class'] });
    setInterval(auto, 2000);
  }
  const api = { version: 2, inspect, tick, enabled, set(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch {} if (v) auto(); }, onClick(fn) { onClick = fn; }, get clicks() { return state.clicks; } };
  if (!window.__arenaContinueWork || window.__arenaContinueWork.version < 2) window.__arenaContinueWork = api;
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  return api;
})();

// ====================================================================================
// Native gacha engine v1 — single-tab port of 模型探测工具 9.23.2 (ArenaCompanion) gacha.
// Replaces the Lite v2.10.1 auto-screening module (dual-tab locks, reload per job, heuristic selectors).
// Principles: exact PageBridge selectors; SPA New Chat click; send confirmed by POST status
// AND URL; resend in the same conversation (max 3); fatal pause on 401/403/429, login,
// human verification, terms, attachments or foreign drafts. Never bypasses CAPTCHA or
// rate limits; never waits out a limit automatically. No cookies/tokens are stored.
// ====================================================================================
const gacha = (() => {
  const SETTINGS = 'amp.native.gacha.settings.v1', RUN = 'amp.native.gacha.run.v1';
  const QUANTITIES = [5, 10, 15, 20, 30];
  const TIERS = ['none','minimal','low','medium','high','xhigh','max'];
  // Targets are vendors, not specific models: a draw hits when the identified name contains a vendor keyword.
  const VENDORS = [
    { id: 'openai', name: 'GPT', lab: 'OpenAI', kw: ['gpt'] },
    { id: 'anthropic', name: 'Claude', lab: 'Anthropic', kw: ['claude'] },
    { id: 'google', name: 'Gemini', lab: 'Google', kw: ['gemini'] },
    { id: 'xai', name: 'Grok', lab: 'xAI', kw: ['grok'] },
    { id: 'moonshot', name: 'Kimi', lab: 'Moonshot', kw: ['kimi'] }
  ];
  const vendorBy = id => VENDORS.find(v => v.id === id) || null;
  const vendorFromText = t => { t = String(t || '').toLowerCase(); return VENDORS.find(v => v.kw.some(k => t.includes(k)))?.id || ''; };
  const OLD_PROMPT = '只回答 1，不要多字。', OLD_PROMPTS = [OLD_PROMPT, '回复1', '只回复9，不要任何解释', '只回复9，不要任何解释。', '只回复9不要任何解释', '只回复9'];
  const DEFAULTS = {
    vendor: '', archiveKeywords: ['super', 'GLM', 'deepseek', 'qwen', 'doubao', 'gpt-5.5', 'spark', 'grok-4.5'],
    archiveOn: true, prompt: '直接回复我1+1', maxAttempts: 20, intervalMs: 800, stopOnThinking: true, sortSidebar: true
  };
  // Base waits for a normal device/network. Every wait is multiplied by pace.scale (1–4), learned from this run.
  // None of these skip a draw: a missing model triggers a resend in the same chat; a broken step pauses with a reason.
  const T = { newChat: 20000, sendReady: 5000, postSeen: 15000, urlSeen: 45000, settle: 500, idleWait: 90000,
    resendNoRun: 15000, resendPending: 45000, resendDefault: 30000, maxResends: 5, genStall: 600000, skipNap: 800 };
  const REASONS = {
    RATE_LIMIT: '当前 IP 被限流（HTTP 429），已暂停；请切换 IP 后点「我已更换 IP」',
    AUTH: '登录状态失效（HTTP 401/403），请先登录 Arena 后再继续',
    HTTP: '发送请求失败，已暂停',
    LOGIN: '请先登录 Arena',
    CAPTCHA: '需要人机验证，已暂停（请手动完成，本脚本不处理验证）',
    TERMS: '网站弹出首次使用条款，请手动确认后点“继续”',
    ALERT_LIMIT: '页面提示限流或额度用尽，已暂停',
    ATTACHMENT: '输入框中有附件，已保留；抽卡不会夹带附件',
    DRAFT: '输入框中有其他草稿，已保留；请清空后继续',
    LEFT: '已离开抽卡对话，已暂停',
    QUOTA: '额度或限流状态显示当前不可发送，已暂停',
    USD: '美元额度快照显示已用尽/超限，已暂停',
    SKIPS: '连续 8 次未能完成一轮，页面可能异常，已暂停（点 START 继续补抽）',
    STEP: '抽卡步骤未能完成，已暂停（点 START 继续）',
    NO_CORE: '模型识别核心尚未就绪',
    RELOADED: '页面刷新后已暂停，点“继续”恢复'
  };
  const nap = ms => new Promise(r => setTimeout(r, ms));
  const now = () => Date.now();
  let core = null, paintFn = null, rev = 0, token = 0, suppressReloadUntil = 0;
  const posts = []; let postSerial = 0;
  const readJSON = (store, key, otherwise = null) => { try { return JSON.parse(store.getItem(key)) ?? otherwise; } catch { return otherwise; } };
  const writeJSON = (store, key, value) => { try { if (store === localStorage) return ampStore.set(key, JSON.stringify(value)); store.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const list = (v, fallback) => Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string').map(x => x.trim()).filter(x => x && x.length <= 200))].slice(0, 50) : [...fallback];
  const WARMUP_TEXT = '（请先立即单独输出一行“思考中…”，然后再开始思考并完成任务；需要分析的内容直接写在回复正文里。）';
  function settings() {
    const s = readJSON(localStorage, SETTINGS, {}) || {};
    // v1.5 migration: an older free-text target (e.g. "gpt-6-astra") maps to its vendor.
    const customKeyword = typeof s.customKeyword === 'string' ? s.customKeyword.trim().slice(0, 60) : '';
    const vendor = typeof s.vendor === 'string' ? (vendorBy(s.vendor) ? s.vendor : (s.vendor === 'custom' && customKeyword ? 'custom' : '')) : vendorFromText(s.targetModel);
    const v = vendorBy(vendor), custom = vendor === 'custom';
    // 旧默认词（回复1 / 只回答数字 1…）自动换成新默认词；用户自己写的提示词原样保留。
    const prompt = typeof s.prompt === 'string' && s.prompt.trim() && (s.promptCustom === true || !OLD_PROMPTS.includes(s.prompt.trim())) ? s.prompt.slice(0, 4000) : DEFAULTS.prompt;
    return {
      vendor, customKeyword, targetModel: v ? v.name : custom ? customKeyword : '', targetKeywords: v ? [...v.kw] : custom ? [customKeyword] : [],
      archiveKeywords: list(s.archiveKeywords, DEFAULTS.archiveKeywords),
      archiveOn: typeof s.archiveOn === 'boolean' ? s.archiveOn : s.archiveMode !== 'off',
      prompt, maxAttempts: QUANTITIES.includes(s.maxAttempts) ? s.maxAttempts : DEFAULTS.maxAttempts,
      // v1.11.34：旧默认间隔 3 秒自动换成新默认 0.8 秒；用户自己保存过的值（intervalV2）原样保留。
      intervalMs: Number.isFinite(s.intervalMs) && (s.intervalV2 === true || s.intervalMs !== 3000) ? Math.max(0, Math.min(60000, Math.round(s.intervalMs))) : DEFAULTS.intervalMs, intervalV2: s.intervalV2 === true,
      stopOnThinking: s.stopOnThinking !== false, sortSidebar: s.sortSidebar !== false, earthTone: true,
      watchdog: s.watchdog === true, watchdogSec: [65, 70, 75, 80].includes(s.watchdogSec) ? s.watchdogSec : 75, watchdogRetries: [1, 2, 3].includes(s.watchdogRetries) ? s.watchdogRetries : 2,
      warmup: s.warmup === true, warmupText: typeof s.warmupText === 'string' && s.warmupText.trim() ? s.warmupText.slice(0, 300) : WARMUP_TEXT, promptCustom: s.promptCustom === true
    };
  }
  let saveOk = true;
  function saveSettings(patch) { const next = { ...settings(), ...patch }; if (patch && typeof patch.prompt === 'string') next.promptCustom = true; if (patch && Number.isFinite(patch.intervalMs)) next.intervalV2 = true; for (const k of ['targetModels', 'targets', 'targetModel', 'targetKeywords', 'targetTier', 'renameMode', 'archiveMode', 'archiveWhileDrawing', 'stopAfterIdentified']) delete next[k]; saveOk = writeJSON(localStorage, SETTINGS, next) && localStorage.getItem(SETTINGS) === JSON.stringify(next); changed(); return settings(); }
  function setVendor(id, keyword) {
    if (id === 'custom') { const k = String(keyword || '').trim().slice(0, 60); return saveSettings(k ? { vendor: 'custom', customKeyword: k } : { vendor: '' }); }
    return saveSettings({ vendor: vendorBy(id) ? id : '' });
  }

  // ---------------- run state (sessionStorage: one tab, one run) ----------------
  let run = readJSON(sessionStorage, RUN, null);
  if (run && typeof run === 'object' && Array.isArray(run.attempts)) {
    const navResume = run.status === 'running' && run.resumeNavUntil && run.resumeNavUntil > now();
    if (!navResume) {
      // A page refresh starts a clean log. Only the paused progress (count + archive queue) survives.
      if (!['running', 'stopping', 'paused'].includes(run.status)) run = null;
      else { run.archiveQueue = [...(run.archiveQueue || []), ...run.attempts.filter(a => a.verdict === 'archive' && a.sid && !a.archived).map(a => a.sid)].slice(-200); run.attempts = []; run.log = []; }
    }
  }
  if (run && typeof run === 'object' && Array.isArray(run.attempts)) {
    if (['running', 'stopping'].includes(run.status)) {
      if (run.resumeNavUntil && run.resumeNavUntil > now() && run.status === 'running') { run.resumeNavUntil = 0; run.autoResume = true; }
      else { run.status = 'paused'; run.reason = REASONS.RELOADED; run.code = 'RELOADED'; }
    }
    // An attempt interrupted by a reload is abandoned; it is never counted.
    const last = run.attempts.at(-1); if (last && !last.done) { last.done = true; last.verdict = 'abandoned'; last.note = '页面刷新中断'; }
  } else run = null;
  const persist = () => { if (run) { run.log = run.log.slice(-200); writeJSON(sessionStorage, RUN, run); } };
  function changed() { rev++; persist(); try { paintFn?.(); } catch {} try { window.dispatchEvent(new CustomEvent('amp-native-gacha')); } catch {} }
  function log(text, level = 'info') { if (!run) return; run.log.push({ at: now(), level, text: String(text).slice(0, 300) }); run.phase = level === 'phase' ? text : run.phase; changed(); }
  const phase = text => { if (run) { run.phase = text; run.log.push({ at: now(), level: 'phase', text }); changed(); } };
  class Stop extends Error { constructor(code, detail, kind = 'fatal') { super(REASONS[code] ? REASONS[code] + (detail ? ' · ' + detail : '') : detail || code); this.code = code; this.kind = kind; } }
  const fatal = (code, detail) => { throw new Stop(code, detail, 'fatal'); };
  const skip = detail => { throw new Stop('SKIP', detail, 'skip'); };
  const alive = my => my === token && run && run.status === 'running';
  async function waitFor(fn, ms, my, step = 250) {
    const end = now() + ms;
    for (;;) { if (my !== undefined && !alive(my)) throw new Stop('CANCEL', '', 'cancel'); const v = fn(); if (v) return v; if (now() >= end) return null; await nap(step); }
  }

  // ---------------- adaptive pacing ----------------
  // Each successful step records actual/expected time; the median ratio (1–4×) stretches every later wait,
  // so slow devices or networks get proportionally more patience instead of being skipped.
  const pace = {
    get scale() { const a = run?.stats?.slow || []; if (!a.length) return 1; const m = [...a].sort((x, y) => x - y)[a.length >> 1]; return Math.max(1, Math.min(4, m)); },
    note(ms, expected) { if (!run) return; const st = run.stats ||= { slow: [] }; st.slow.push(Math.max(0.2, ms / expected)); if (st.slow.length > 15) st.slow.shift(); },
    ms(base) { return Math.round(base * this.scale); },
    sec(base) { return Math.round(this.ms(base) / 1000); }
  };

  // ---------------- page adapter (exact PageBridge labels) ----------------
  const page = (() => {
    const visible = el => !!el && el.isConnected && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const label = el => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ');
    const buttons = scope => scope ? [...scope.querySelectorAll('button')].filter(visible) : [];
    const find = (names, scope = document) => scope ? [...scope.querySelectorAll('button')].find(e => names.includes(label(e)) && visible(e)) : undefined;
    const SEND = ['Send message', '发送消息'], STOP = ['Stop generating', '停止生成', 'Stop response'];
    const main = () => [...document.querySelectorAll('main')].find(visible) || null;
    const input = () => { const all = [...document.querySelectorAll('main div[contenteditable="true"]')].filter(visible); return all.find(e => e.closest('form')) || all.at(-1) || null; };
    // 草稿比较前统一空白：零宽字符、不间断空格、多余换行都不算差异（以前因此误判“草稿不一致”而暂停）。
    const norm = t => String(t || '').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const sendBtns = m => m ? [...m.querySelectorAll('button')].filter(e => SEND.includes(label(e)) && !e.closest('[role="log"]') && visible(e)) : [];
    const sendBtn = m => { const b = sendBtns(m).filter(e => !e.disabled && e.getAttribute('aria-disabled') !== 'true'); return b.find(e => e.closest('form')) || b.at(-1) || null; };
    const dialogs = () => [...document.querySelectorAll('[role="dialog"]')].filter(visible);
    const newChatLinks = () => [...document.querySelectorAll('a[href="/agent"]')].filter(e => visible(e) && label(e) === 'New Chat');
    const expander = () => find(['Expand sidebar', 'Open sidebar']);
    const stagedNames = m => m ? [...m.querySelectorAll('button')].filter(e => label(e).startsWith('Remove ') && !e.closest('[role="log"]') && visible(e)).map(label).map(t => t.slice(7)) : [];
    function completion(log) {
      const match = /^\/agent\/([0-9a-f-]{36})\/?$/i.exec(location.pathname);
      if (!log || !match) return null;
      try {
        let fiber = log[Object.keys(log).find(k => k.startsWith('__reactFiber'))];
        for (let n = 0; fiber && n < 100; n++, fiber = fiber.return) {
          const live = fiber.memoizedProps?.value;
          if (!live || live.id !== match[1] || !Array.isArray(live.messages)) continue;
          if (!['ready', 'submitted', 'streaming', 'error'].includes(live.status)) return null;
          const last = live.messages[live.messages.length - 1];
          const parts = Array.isArray(last?.parts) ? last.parts : [];
          const tool = p => p.type === 'dynamic-tool' || String(p.type || '').startsWith('tool-');
          const doneState = s => ['output-available', 'output-error', 'output-denied', 'result'].includes(s);
          const unfinished = last?.metadata?.pending === true || parts.some(p => p && (p.state === 'streaming' || (tool(p) && !doneState(p.state))));
          const answer = last?.role === 'assistant' && parts.some(p => p && ((p.type === 'text' && typeof p.text === 'string' && p.text.trim()) || (tool(p) && doneState(p.state))));
          // Routed thinking: the reply started without reasoning, then a reasoning part appears after answer text.
          // Natively thinking models reason before their first text, so they never match.
          const isReason = p => p && /reason|think/i.test(String(p.type || ''));
          const firstText = parts.findIndex(p => p && p.type === 'text' && typeof p.text === 'string' && p.text.trim());
          const firstReason = parts.findIndex(isReason);
          const routed = last?.role === 'assistant' && firstText >= 0 && firstReason > firstText ? String(last.id || live.messages.length) : '';
          return { busy: ['submitted', 'streaming'].includes(live.status) || unfinished, complete: live.status === 'ready' && !!answer && !unfinished, failed: live.status === 'error', routed };
        }
      } catch {}
      return null;
    }
    // 首包看门狗用：最后一条用户消息之后，助手是否已经产出任何内容（文字 / 推理文字 / 工具调用）。
    function chatState() {
      const m = main(), log = m && [...m.querySelectorAll('[role="log"]')].find(visible);
      const match = /^\/agent\/([0-9a-f-]{36})\/?$/i.exec(location.pathname); if (!log || !match) return null;
      try {
        let fiber = log[Object.keys(log).find(k => k.startsWith('__reactFiber'))];
        for (let n = 0; fiber && n < 100; n++, fiber = fiber.return) {
          const live = fiber.memoizedProps?.value;
          if (!live || live.id !== match[1] || !Array.isArray(live.messages)) continue;
          const msgs = live.messages; let ui = -1; for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i]?.role === 'user') { ui = i; break; }
          if (ui < 0) return null;
          const u = msgs[ui], userText = (u.parts || []).filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n').trim();
          const meaningful = p => p && ((typeof p.text === 'string' && p.text.trim()) || /reason|think/i.test(String(p.type || '')) || p.type === 'dynamic-tool' || String(p.type || '').startsWith('tool-') || p.type === 'file');
          const hasOutput = msgs.slice(ui + 1).some(x => x?.role === 'assistant' && (x.parts || []).some(meaningful));
          return { sid: match[1], status: live.status, userKey: match[1] + '|' + (u.id || ui), userText, hasOutput, waiting: ['submitted', 'streaming'].includes(live.status) && !hasOutput };
        }
      } catch {}
      return null;
    }
    function blocker() {
      const ds = dialogs();
      if (ds.some(e => /Security Verification|人机身份验证|Verify you are human/i.test(e.innerText || e.textContent || ''))) return 'CAPTCHA';
      if (find(['Log In']) || ds.some(e => /Log In to your account|Log In or Create Account/.test(e.innerText || e.textContent || ''))) return 'LOGIN';
      if (ds.some(e => /Terms of Use & Privacy Policy/.test(e.innerText || e.textContent || ''))) return 'TERMS';
      const alerts = [...document.querySelectorAll('[role="alert"]')].filter(visible).map(e => e.innerText || e.textContent || '').join('\n');
      if (/too many requests|rate limit|try again later|quota exceeded|limit reached/i.test(alerts)) return 'ALERT_LIMIT';
      return '';
    }
    function view() {
      const m = main(), log = m && [...m.querySelectorAll('[role="log"]')].find(visible);
      const text = log ? /\S/.test(log.textContent || '') : false; // 性能：不用 innerText（整段对话会强制重排）
      const live = completion(log);
      const feedbackPending = window.__arenaContinueWork?.inspect?.().pending === true;
      const stop = !!m && [...m.querySelectorAll('button')].some(e => STOP.includes(label(e)) && !e.closest('[role="log"]') && visible(e));
      const sb = sendBtn(m);
      const spinner = !!m && [...m.querySelectorAll('[role="progressbar"],.animate-spin')].some(e => visible(e) && !e.closest('[role="log"]'));
      const ed = input();
      return { main: !!m, conversation: !!text, generating: feedbackPending || (live ? live.busy || (!live.complete && stop) : stop),
        complete: !!live?.complete, routed: live?.routed || '', editor: !!ed, draft: norm(ed?.innerText ?? ed?.textContent ?? ''), sendReady: !!sb,
        spinner, attachments: stagedNames(m), newLinks: newChatLinks().length, canExpand: !!expander(), blocker: blocker() };
    }
    function writeDraft(value) {
      const el = input(); if (!el) throw new Error('输入框尚未就绪'); el.focus(); el.style.whiteSpace = 'pre-wrap';
      const range = document.createRange(); range.selectNodeContents(el);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      const lines = String(value).replace(/\r\n?/g, '\n').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (i && !document.execCommand('insertLineBreak', false)) throw new Error('未能填入提示词换行');
        if ((lines[i] || i === 0) && !document.execCommand('insertText', false, lines[i])) {
          // execCommand 被拒绝时改用 beforeinput/paste 事件，让编辑器自己插入文字。
          const dt = new DataTransfer(); dt.setData('text/plain', String(value));
          const ok = !el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
          if (!ok) el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: String(value), bubbles: true, cancelable: true }));
          return;
        }
      }
    }
    const clickSend = () => { const b = sendBtn(main()); if (!b) return false; b.click(); return true; };
    // 兜底：在输入框里按 Enter（Arena 的输入框回车即发送）。
    const pressEnter = () => { const el = input(); if (!el) return false; el.focus(); for (const type of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })); return true; };
    function clearDraft() { const el = input(); if (!el) return; el.focus(); const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand('delete', false); }
    const clickStop = () => { const m = main(), b = m && buttons(m).filter(e => STOP.includes(label(e)) && !e.closest('[role="log"]') && !e.disabled); if (!b || b.length !== 1) return false; b[0].click(); return true; };
    return { view, chatState, writeDraft, clickSend, clickStop, pressEnter, clearDraft, norm, newChatLinks, expander, visible, label };
  })();
  const sidOf = url => { try { return new URL(url, location.href).pathname.match(/^\/agent\/([0-9a-f-]{36})\/?$/i)?.[1] || null; } catch { return null; } };
  const blank = v => /^\/agent\/?$/.test(location.pathname) && v.main && v.editor && !v.conversation && !v.generating;

  // ---------------- model policy (ModelNamePolicy / InternalTitle) ----------------
  const BAD = /^(unknown|model-a|model-b|未知|未提供|none|null|undefined)$/i, GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validName = n => typeof n === 'string' && n.trim().length >= 2 && n.trim().length <= 100 && !GUID.test(n.trim()) && !BAD.test(n.trim());
  function identify(live, attempt) {
    if (!live || live.sid !== attempt.sid || !live.data) return null;
    if (attempt.sentAt && live.submittedAt && live.submittedAt < attempt.sentAt - 3000) return null;
    const calls = live.data.calls || [], last = calls.at(-1) || {};
    const internal = [last.internal, ...(live.data.internalNames || [])].find(validName) || null;
    const response = [last.response, ...calls.map(c => c.response)].find(validName) || null;
    const request = [last.request, ...calls.map(c => c.request)].find(validName) || null;
    const traced = [last.model, ...calls.map(c => c.model)].find(validName) || null;
    const name = internal || response || request || traced; if (!name) return null;
    const suffix = internal && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(internal) ? /-(none|minimal|low|medium|high|xhigh|max)$/i.exec(internal.replace(/-(vertex|agent)$/i, '')) : null;
    const tier = suffix ? suffix[1].toLowerCase() : (TIERS.includes(last.effort) ? last.effort : null);
    return { name: name.trim(), internal, response, request, traced, tier, partial: !!live.data.partial };
  }
  const has = (name, words) => { const n = String(name || '').toLowerCase(); return words.some(w => w && n.includes(String(w).toLowerCase())); };
  function classify(id, s) {
    const all = [id.name, id.internal, id.response, id.request].filter(Boolean).join(' ');
    if (s.targetKeywords?.length && has(all, s.targetKeywords)) return 'hit';
    return s.archiveOn && has(all, s.archiveKeywords) ? 'archive' : 'keep';
  }
  const titleOf = id => noVertex(id.internal && validName(id.internal) ? id.internal : id.name).slice(0, 100);

  // ---------------- network observation (called from the shared fetch/XHR hooks) ----------------
  function notePost(path, status) {
    const kind = /\/stream\/create-chat$/.test(path) ? 'chat' : /\/in\/append$/.test(path) ? 'append' : null; if (!kind) return;
    posts.push({ serial: ++postSerial, kind, status: Number(status) || 0, at: now(), path: String(path).slice(0, 200) }); if (posts.length > 40) posts.shift();
    if (run?.status === 'running' && [401, 402, 403, 429].includes(Number(status))) {
      const code = Number(status) === 429 ? 'RATE_LIMIT' : 'AUTH'; void halt(new Stop(code, 'HTTP ' + status));
    }
  }
  const postsSince = serial => posts.filter(p => p.serial > serial);
  let chatIds = [];
  function noteChatId(id) { if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) { chatIds.push({ id, at: now() }); chatIds = chatIds.slice(-10); } }
  async function api(url, init) {
    const res = await (core?.rawFetch || fetch)(location.origin + url, { credentials: 'same-origin', cache: 'no-store', ...init });
    if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; } return res;
  }
  // 改名会让 Arena 重新拉取会话列表/标题；对话正在生成时改名可能打断回复。所以先等页面空闲（最多 15 分钟），再多等 1.5 秒。
  async function waitIdle(max = 900000) {
    const end = Date.now() + max; let quiet = 0;
    while (Date.now() < end) {
      let busy = false; try { busy = !!page.view().generating; } catch {}
      if (busy) quiet = 0; else if (++quiet >= 3) return true;
      await nap(busy ? 800 : 500);
    }
    return false;
  }
  async function rename(sid, title) { if (sidOf(location.href) === sid && !(await waitIdle())) throw Object.assign(new Error('对话一直在生成，暂缓改名'), { status: 0 }); if (renameWant.get(sid) && renameWant.get(sid) !== title) return; await api('/api/history/agentic/' + encodeURIComponent(sid), { method: 'PATCH', headers: { 'content-type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ title: title.slice(0, 100) }) }); }
  // Titles owned by the gacha. Other writers (Lite local overlay / cloud sync) must skip these sids.
  const OWN = 'amp.native.gacha.titles.v1';
  const owned = new Map(Object.entries(readJSON(localStorage, OWN, {}) || {}).slice(-300));
  const ownTitle = (sid, title) => { owned.delete(sid); owned.set(sid, title); while (owned.size > 300) owned.delete(owned.keys().next().value); writeJSON(localStorage, OWN, Object.fromEntries(owned)); };
  const sidebarTitle = sid => { const a = [...document.querySelectorAll('a[href="/agent/' + sid + '"]')].find(e => e.closest('aside,nav,[data-sidebar]')); if (!a) return null; const sp = a.querySelector('span.truncate,div.truncate') || a; return (sp.textContent || '').trim() || null; };
  // One rename at a time, globally; a newer request for the same sid replaces an older pending one.
  let renameChain = Promise.resolve(); const renameWant = new Map(), renameAt = new Map();
  function queueRename(sid, title, own = true) {
    title = title.slice(0, 100); renameWant.set(sid, title); renameAt.set(sid, Date.now()); try { window.dispatchEvent(new Event('amp-title-sync')); } catch {} if (own || owned.has(sid)) ownTitle(sid, title);
    const job = async () => {
      if (renameWant.get(sid) !== title) return 'superseded';
      let lastErr = null;
      for (let i = 0; i < 3; i++) {
        try { await rename(sid, title); lastErr = null; break; }
        catch (e) { lastErr = e; if ([400, 401, 403, 429].includes(e.status)) break; await nap(1500 * (i + 1)); }
      }
      if (lastErr) throw lastErr;
      verifyLater(sid, title); return 'ok';
    };
    const p = renameChain.then(job, job); renameChain = p.catch(() => {}); return p;
  }
  // Arena writes its own generated title shortly after the first turn; check the sidebar and repair up to 3 times.
  function verifyLater(sid, title, round = 0) {
    if (round >= 3) return;
    setTimeout(() => {
      if (renameWant.get(sid) !== title) return;
      const shown = sidebarTitle(sid);
      if (shown === null || shown === title) { if (shown === null && round < 2) verifyLater(sid, title, round + 1); return; }
      if (run) log('对话名被改为“' + shown.slice(0, 40) + '”，已改回 ' + title, 'warn');
      rename(sid, title).catch(() => {}).finally(() => verifyLater(sid, title, round + 1));
    }, [4000, 10000, 25000][round]);
  }
  // Real-time model follow: when a conversation's latest turn is served by a different model, the old model name in
  // its title is replaced (prefix "#5 " / suffix " · 001" preserved). Custom titles without the old name are left alone.
  const escRe = v => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function followModel(sid, oldName, newName) {
    oldName = noVertex(oldName); newName = noVertex(newName);
    if (!sid || !newName || !validName(newName) || oldName === newName) return null;
    const a = run?.attempts?.at(-1); if (a && !a.done && a.sid === sid) return null; // the draw renames it itself
    const cur = noVertex(renameWant.get(sid) || sidebarTitle(sid) || owned.get(sid) || '');
    let next = null;
    if (oldName && cur && new RegExp(escRe(oldName), 'i').test(cur)) next = cur.replace(new RegExp(escRe(oldName), 'i'), newName);
    else if (owned.has(sid)) next = newName;
    if (!next || next === cur) return null;
    log('对话实际模型已变为 ' + newName + '，标题更新为 ' + next.slice(0, 60));
    queueRename(sid, next, false).catch(e => log('标题跟随模型失败 ' + (e.status ? 'HTTP ' + e.status : e.message), 'warn'));
    return next;
  }
  // Routed-thinking guard (all Agent chats, default on): stop once per reply when thinking appears mid-answer.
  let routedStopped = '';
  setInterval(() => {
    try {
      if (!settings().stopOnThinking || !/^\/agent\/[0-9a-f-]{36}/i.test(location.pathname)) return;
      const v = page.view(); if (!v.routed || !v.generating) return;
      const key = location.pathname + '|' + v.routed; if (key === routedStopped) return;
      if (page.clickStop()) { routedStopped = key; if (run?.status === 'running') log('回复中途被路由到 thinking，已停止生成', 'warn'); console.info('[Arena Native] 回复中途被路由到 thinking，已停止生成'); }
    } catch {}
  }, 600);
  // ---------------- 首包看门狗（实验，默认关闭）----------------
  // Arena 在原模型约 90 秒无首包时会改派其他模型并写入对话。赶在超时前停止并在同一对话重发，服务端没有记录失败，理论上仍是原模型。
  const WD_KEY = 'amp.native.watchdog.v1';
  let watchdogUntil = 0;
  const wd = { cur: '', t0: 0, chain: '', tries: 0, busy: false, told: '', checks: [] };
  const wdStats = readJSON(localStorage, WD_KEY, {}) || {};
  const wdSave = () => writeJSON(localStorage, WD_KEY, wdStats);
  function wdNote(level, text) { try { core?.note?.(level, text); } catch {} if (run?.status === 'running') log(text, level === 'warn' ? 'warn' : 'info'); console.info('[Arena Native] ' + text); }
  function wdVerify() {
    wd.checks = wd.checks.filter(c => {
      if (now() - c.at > 1200000) return false;
      const live = core?.runFor?.(c.sid); if (!live?.data?.calls?.length || !(live.submittedAt >= c.at - 2000)) return true;
      const pv = String(live.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 20); if (c.want && pv && pv !== c.want) return false;
      const last = live.data.calls.at(-1), got = last.request || last.model;
      if (!got || got === '未提供' || live.busy && !live.data.routing) return true;
      const sw = live.data.routing;
      const kept = !sw && (!c.expected || got === c.expected);
      wdStats[kept ? 'kept' : 'changed'] = (wdStats[kept ? 'kept' : 'changed'] || 0) + 1; wdSave();
      wdNote(kept ? 'info' : 'warn', '首包看门狗验证：重发后 ' + (kept ? '仍是原模型 ' + got : '模型为 ' + got + (c.expected ? '（原模型 ' + c.expected + '）' : '') + (sw ? ' · 被改派' : '')) + ' · 累计 保持 ' + (wdStats.kept || 0) + ' / 改变 ' + (wdStats.changed || 0));
      return false;
    });
  }
  async function wdFire(st, s) {
    wd.busy = true; watchdogUntil = now() + 30000; wd.tries++;
    const live = core?.runFor?.(st.sid), expected = live?.data?.calls?.at(-1)?.request || null;
    try {
      wdNote('warn', '首包看门狗：' + s.watchdogSec + ' 秒没有任何输出，停止并在同一对话重发（第 ' + wd.tries + '/' + s.watchdogRetries + ' 次）' + (expected ? ' · 当前模型 ' + expected : ''));
      if (!page.clickStop()) { wdNote('warn', '首包看门狗：找不到停止按钮，放弃'); return; }
      const end = now() + 15000; while (now() < end && page.view().generating) await nap(300);
      await nap(1500);
      if (page.view().draft) { wdNote('warn', '首包看门狗：输入框里有内容，未自动重发（请手动发送）'); return; }
      page.writeDraft(st.userText);
      const want = page.norm(st.userText), end2 = now() + 6000; let ok = false;
      while (now() < end2 && !(ok = page.view().sendReady && page.view().draft === want)) await nap(150);
      if (!ok || !page.clickSend()) { if (!page.pressEnter()) { wdNote('warn', '首包看门狗：重发失败，请手动发送'); return; } }
      wdStats.stops = (wdStats.stops || 0) + 1; wdSave();
      wd.checks.push({ sid: st.sid, expected, at: now(), want: String(st.userText).replace(/[\x00-\x1f\x7f]+|\s+/g, ' ').trim().slice(0, 20) });
    } catch (e) { wdNote('warn', '首包看门狗出错：' + (e.message || e)); }
    finally { wd.busy = false; watchdogUntil = now() + 6000; }
  }
  setInterval(() => {
    try {
      wdVerify();
      const s = settings(); if (!s.watchdog || wd.busy) return;
      const st = page.chatState(); if (!st) return;
      const chain = st.sid + '|' + page.norm(st.userText);
      if (chain !== wd.chain) { wd.chain = chain; wd.tries = 0; }
      if (st.hasOutput) { if (wd.tries && wd.told !== st.userKey) { wd.told = st.userKey; wdNote('info', '首包看门狗：重发后已开始输出（重发 ' + wd.tries + ' 次）'); } wd.cur = st.userKey; wd.t0 = 0; return; }
      if (!st.waiting) { wd.t0 = 0; return; }
      if (wd.cur !== st.userKey || !wd.t0) { wd.cur = st.userKey; wd.t0 = now(); return; }
      if (now() - wd.t0 >= s.watchdogSec * 1000 && st.userText) {
        if (wd.tries >= s.watchdogRetries) { if (wd.told !== st.userKey + '|max') { wd.told = st.userKey + '|max'; wdNote('warn', '首包看门狗：已重发 ' + wd.tries + ' 次仍无输出，不再干预'); } return; }
        void wdFire(st, s);
      }
    } catch {}
  }, 1000);
  async function archive(sid) { await api('/api/chat/' + encodeURIComponent(sid) + '/archive', { method: 'POST', headers: { Accept: 'application/json' } }); }

  // ---------------- guards ----------------
  function guard(v = page.view()) {
    if (v.blocker) fatal(v.blocker);
    const live = core?.huntLive?.();
    if (live?.blocked) fatal('QUOTA', live.blocked);
    const usd = core?.usdQuota?.();
    if (usd && (usd.overLimit === true || usd.balanceRemainingUsd <= 0) && now() - usd.at < 600000) fatal('USD', '剩余 $' + (+usd.balanceRemainingUsd).toFixed(2));
  }
  // During a draw the feedback card must never stall the run, even if auto-continue is off for manual chats.
  function tickContinue() { try { const r = window.__arenaContinueWork?.tick?.(location.href); if (r?.status === 'clicked') log('任务反馈窗口：已自动选择 Keep working'); } catch {} skipQuestion(); }
  // 模型有时会弹出“选项卡片”（带 Skip / Submit 的提问）：抽卡时直接点 Skip 结束这一问，不影响识别。
  let lastSkip = 0;
  function skipQuestion() {
    if (now() - lastSkip < 1500) return;
    const logEl = [...document.querySelectorAll('main [role="log"]')].find(page.visible); if (!logEl) return;
    const skipBtn = [...logEl.querySelectorAll('button')].reverse().find(b => page.visible(b) && !b.disabled && /^(skip|跳过)$/i.test(page.label(b)));
    if (!skipBtn) return;
    const card = skipBtn.closest('div'); let box = card; for (let i = 0; i < 6 && box && !/submit|提交/i.test(box.textContent || ''); i++) box = box.parentElement;
    if (!box) return;
    lastSkip = now(); skipBtn.click(); log('模型弹出选项卡片，已自动 Skip');
  }
  async function ensureIdle(my) {
    const ok = await waitFor(() => { tickContinue(); const v = page.view(); guard(v); return !v.generating; }, T.idleWait, my, 400);
    if (!ok) { page.clickStop(); log('当前页面持续生成 ' + pace.sec(T.idleWait) + ' 秒，已停止并开新对话', 'warn'); await nap(800); }
  }
  function clickNewChat(link) { suppressReloadUntil = now() + 3000; try { window.__AMP_NATIVE_GACHA_NAV__ = suppressReloadUntil; } catch {} link.click(); }
  async function openNewChat(my) {
    phase('打开新对话');
    for (let round = 1; ; round++) {
      if (blank(page.view())) return;
      let links = page.newChatLinks();
      if (links.length !== 1 && page.expander()) { page.expander().click(); await waitFor(() => page.newChatLinks().length === 1, 3000, my); links = page.newChatLinks(); }
      if (links.length === 1) clickNewChat(links[0]);
      else {
        // No unique sidebar link: fall back to one controlled navigation; the run resumes automatically after load.
        log('未找到唯一的 New Chat 按钮，改用页面跳转', 'warn'); run.resumeNavUntil = now() + 30000; persist();
        location.assign('/agent'); await nap(60000); throw new Stop('CANCEL', '', 'cancel');
      }
      const t0 = now();
      if (await waitFor(() => { const v = page.view(); guard(v); return blank(v); }, pace.ms(T.newChat), my)) { pace.note(now() - t0, 2500); return; }
      if (round >= 3) skip('新对话连续 3 次未就绪（每次等待 ' + pace.sec(T.newChat) + ' 秒）');
      log('新对话未就绪，重新点击 New Chat（第 ' + (round + 1) + ' 次）', 'warn');
    }
  }
  async function fillAndSend(my, attempt, fresh) {
    const s = run.settings, want = page.norm(s.prompt); phase(fresh ? '填写并发送' : '同一对话重发（第 ' + attempt.resends + ' 次）');
    let v = page.view(); guard(v);
    if (v.attachments.length) fatal('ATTACHMENT');
    // 残留草稿（上一轮没发出去的提示词、或用户误输入）：清空后重填，而不是直接暂停。
    if (v.draft && v.draft !== want) { log('输入框有残留内容，已清空后重填', 'warn'); try { page.clearDraft(); } catch {} await nap(150); }
    if (!await waitFor(() => { const x = page.view(); return x.editor && !x.spinner && !x.generating; }, pace.ms(10000), my, 150)) { if (fresh) skip('输入框 ' + pace.sec(10000) + ' 秒内未就绪，换新对话重试'); fatal('STEP', '输入框 ' + pace.sec(10000) + ' 秒内未就绪'); }
    let ready = false;
    for (let i = 0; i < 4 && !ready; i++) {
      const x0 = page.view();
      if (x0.draft !== want) { try { if (x0.draft) page.clearDraft(); page.writeDraft(s.prompt); } catch (e) { log('填写提示词失败：' + (e.message || e) + '，重试', 'warn'); } }
      // 轮询间隔 120ms：发送按钮一亮就发，不必等满 250ms。
      ready = !!await waitFor(() => { const x = page.view(); return x.sendReady && x.draft === want; }, pace.ms(i ? T.sendReady * 1.5 : T.sendReady), my, 120);
      if (!ready && i < 3) { log('发送按钮未就绪，重新填写提示词（第 ' + (i + 2) + ' 次）', 'warn'); await nap(300 + i * 400); }
    }
    if (!ready) {
      const x = page.view();
      // 草稿已对但按钮没亮（Arena 偶发不刷新按钮状态）：按 Enter 兜底发送。
      if (x.draft === want && page.pressEnter()) { log('发送按钮未亮，改用回车发送', 'warn'); }
      else if (fresh) skip('发送按钮未就绪或草稿不一致，换新对话重试');
      else fatal('STEP', '发送按钮未就绪或草稿不一致');
    }
    const serial = postSerial; let clicked = 0, post = null;
    const sentByPage = () => { const x = page.view(); return x.generating || (fresh && !!sidOf(location.href)) || (!x.draft && x.conversation) || postsSince(serial).some(p => p.kind === 'chat' || p.kind === 'append'); };
    for (;;) {
      guard(); attempt.sentAt = now();
      if (!ready && clicked === 0) { clicked = 1; } else if (!page.clickSend()) { if (sentByPage()) break; await nap(400); if (sentByPage()) break; if (!page.pressEnter()) { if (fresh) skip('发送按钮状态已改变'); fatal('STEP', '发送按钮状态已改变'); } }
      clicked++;
      post = await waitFor(() => postsSince(serial).find(p => p.kind === 'chat' || p.kind === 'append'), pace.ms(T.postSeen), my);
      if (post) { pace.note(now() - attempt.sentAt, 2500); break; }
      // The request hook can miss a POST on slow pages: if the page shows the message was sent, carry on.
      if (sentByPage()) { log('未捕获到发送请求，但页面已在回复，继续', 'warn'); break; }
      const x = page.view();
      if (clicked >= 2 || !(x.sendReady && x.draft === want)) { if (fresh && !sidOf(location.href)) skip('点击发送后 ' + pace.sec(T.postSeen) + ' 秒内未观察到发送'); fatal('STEP', '点击发送后 ' + pace.sec(T.postSeen) + ' 秒内未观察到发送'); }
      log('未观察到发送，再点一次发送', 'warn');
    }
    if (post) {
      if (post.status === 429) fatal('RATE_LIMIT'); if ([401, 403].includes(post.status)) fatal('AUTH', 'HTTP ' + post.status);
      if (post.status < 200 || post.status >= 300) fatal('HTTP', 'HTTP ' + post.status);
    }
    if (fresh) {
      // Prefer the address bar; Arena may push the URL late (queue), so the create-chat response id is accepted too.
      // Keep waiting while the page is still generating; only a silent page counts as a failure.
      const t0 = now(); let sid = null;
      for (;;) {
        sid = await waitFor(() => sidOf(location.href) || chatIds.find(c => c.at >= attempt.sentAt - 500)?.id, pace.ms(T.urlSeen), my);
        if (sid) break;
        if (!page.view().generating || now() - t0 > 4 * pace.ms(T.urlSeen)) fatal('STEP', Math.round((now() - t0) / 1000) + ' 秒内未拿到新对话地址');
        log('页面仍在生成，继续等待新对话地址', 'warn');
      }
      pace.note(now() - attempt.sentAt, 4000);
      attempt.sid = sid; attempt.url = location.origin + '/agent/' + sid;
    }
    changed();
  }
  async function monitor(my, attempt) {
    const s = run.settings; phase('等待模型识别');
    let settledAt = 0, idAt = 0, id = null, note = 0;
    for (;;) {
      if (!alive(my)) throw new Stop('CANCEL', '', 'cancel');
      tickContinue();
      const v = page.view(); guard(v);
      const here = sidOf(location.href);
      if (here ? here !== attempt.sid : !/^\/agent\/?$/.test(location.pathname)) fatal('LEFT');
      const live = core.runFor(attempt.sid), t = now();
      if (!v.generating && t >= watchdogUntil) settledAt ||= t; else settledAt = 0;
      const got = identify(live, attempt);
      if (got) {
        if (!id) pace.note(t - attempt.sentAt, 6000);
        if (!id || got.name !== id.name) { id = got; idAt ||= t; attempt.model = got.name; attempt.tier = got.tier; phase('已识别 ' + got.name); }
        // Rename only with a settled, final name: an internal name, or a stable fallback after 8s.
        if (settledAt && t - settledAt >= T.settle && ((got.internal && !got.partial) || t - idAt > pace.ms(8000))) return id;
        if (t - idAt > pace.ms(25000)) return id;
      } else if (settledAt) {
        // The reply is finished but no model yet: trace data can lag, so wait (longer while it is still being read),
        // then resend in the same chat. Never skip the draw.
        const idle = t - settledAt, why = !live?.runId ? '没有运行记录' : live.busy ? '记录读取中' : '记录不完整';
        const limit = pace.ms(!live?.runId ? T.resendNoRun : (live.busy || !live.data) ? T.resendPending : T.resendDefault);
        if (idle >= limit) {
          if (attempt.resends >= T.maxResends) fatal('STEP', '同一对话重发 ' + T.maxResends + ' 次仍未识别到模型（' + why + '）');
          attempt.resends++; log('回复结束 ' + Math.round(idle / 1000) + ' 秒仍未识别到模型（' + why + '），在同一对话重发', 'warn');
          await fillAndSend(my, attempt, false); settledAt = 0; continue;
        }
        if (idle > 3000 && t - note > 5000) { note = t; phase('等待模型信息 ' + Math.round(idle / 1000) + '/' + Math.round(limit / 1000) + ' 秒'); }
      } else {
        const since = t - attempt.sentAt;
        if (since > T.genStall) fatal('STEP', '回复持续 ' + Math.round(since / 60000) + ' 分钟仍未识别到模型');
        if (since > 30000 && t - note > 10000) { note = t; phase('回复中，继续等待模型信息（' + Math.round(since / 1000) + ' 秒）'); }
      }
      await nap(150);
    }
  }
  async function settle(attempt, verdict, id) {
    const s = run.settings;
    if (attempt.sid) {
      // 改名放后台排队，不阻塞下一抽（改的是刚抽完的那个对话，不是正在看的新对话）
      const nm = titleOf(id); attempt.renamed = nm; queueRename(attempt.sid, nm).catch(e => { attempt.note = '改名失败 ' + (e.status ? 'HTTP ' + e.status : e.message); log(attempt.note, 'warn'); });
    }
    if (verdict === 'archive') {
      try { await archive(attempt.sid); attempt.archived = true; } catch (e) { attempt.note = '归档失败 ' + (e.status ? 'HTTP ' + e.status : e.message); log(attempt.note, 'warn'); }
    }
  }
  async function one(my) {
    // 每轮开始都读取最新保存的提示词（以前一直用开始抽卡时的快照，改了设置也还发旧词）。
    { const cur = settings(); run.settings = { ...run.settings, prompt: cur.prompt, intervalMs: cur.intervalMs, stopOnThinking: cur.stopOnThinking }; }
    const s = run.settings, attempt = { no: (run.seq = (run.seq || run.attempts.length) + 1), at: now(), sid: null, url: null, resends: 0, done: false };
    run.attempts.push(attempt); if (run.attempts.length > 200) run.attempts.splice(0, run.attempts.length - 200); changed();
    try {
      await ensureIdle(my); guard(); await openNewChat(my); await fillAndSend(my, attempt, true);
      const id = await monitor(my, attempt), verdict = classify(id, s);
      attempt.verdict = verdict; attempt.done = true; run.completed++; run.skips = 0; run.recovered = false;
      log('#' + run.completed + ' ' + id.name + (id.tier ? ' · ' + id.tier : '') + ' → ' + ({ hit: '命中目标', keep: '保留', archive: '归档' }[verdict]));
      await settle(attempt, verdict, id);
      // 次数优先：命中只记录，不提前结束，直到抽满设定次数。
      if (verdict === 'hit') { run.hits = [...(run.hits || []), id.name].slice(-50); log('命中目标：' + id.name + '（已命中 ' + run.hits.length + ' 次，继续抽满 ' + s.maxAttempts + ' 次）'); }
    } catch (e) {
      attempt.done = true;
      if (e instanceof Stop && e.kind === 'fatal' && e.code === 'STEP') { e.kind = 'skip'; }
      if (e instanceof Stop && e.kind === 'skip') { attempt.verdict = 'skipped'; attempt.note = e.message; run.skips++; run.skipTotal = (run.skipTotal || 0) + 1; log('本轮未完成，不计次数，换新对话补抽：' + e.message.replace(/^SKIP · /, '').replace(/^抽卡步骤未能完成，已暂停（点 START 继续） · /, ''), 'warn'); changed(); await nap(T.skipNap); return; }
      attempt.verdict = e instanceof Stop && e.kind === 'cancel' ? 'cancelled' : 'error'; attempt.note = e.message; throw e;
    } finally { changed(); }
  }
  async function loop(my) {
    try {
      while (alive(my)) {
        const s = run.settings;
        if (run.completed >= s.maxAttempts) { const h = run.hits || []; finish(h.length ? 'hit' : 'done', '已完成 ' + run.completed + '/' + s.maxAttempts + ' 次' + (h.length ? '，命中 ' + h.length + ' 次：' + [...new Set(h)].join('、') : '，未命中目标')); break; }
        // 连续失败时逐步放慢（5/10/20/40 秒）再补抽；连续 8 次都失败才判定页面异常并暂停。补抽总数上限为设定次数的 2 倍。
        if (run.skips >= 8) fatal('SKIPS');
        if ((run.skipTotal || 0) > Math.max(10, s.maxAttempts * 2)) fatal('SKIPS', '补抽次数过多（' + run.skipTotal + ' 次）');
        if (run.skips >= 2) { const w = Math.min(40000, 5000 * 2 ** (run.skips - 2)); phase('连续 ' + run.skips + ' 次未完成，' + Math.round(w / 1000) + ' 秒后补抽'); await nap(w); if (!alive(my)) break; }
        await one(my);
        if (!alive(my)) break;
        phase('间隔等待'); await nap(s.intervalMs);
      }
    } catch (e) { if (my === token) await halt(e); }
    finally { if (my === token && run?.status === 'stopping') { run.status = 'paused'; run.reason = '已手动停止'; changed(); } if (run && !['running'].includes(run.status)) void archiveQueued(false); }
  }
  async function halt(e) {
    if (!run || !['running', 'stopping'].includes(run.status)) return;
    token++;
    if (e instanceof Stop && e.kind === 'cancel') { run.status = 'paused'; run.reason = run.reason || '已手动停止'; }
    else { run.status = 'paused'; run.code = e?.code || 'ERROR'; run.reason = e?.message || String(e); log(run.reason, 'error'); }
    run.phase = ''; run.ipOld = null;
    if (ipLimited()) {
      // 429 限流按 IP 计：提示切换 IP，并记下当前（Arena 看到的）IP，用来确认之后是否真的换了
      run.reasonRaw = run.reason; run.reason = '当前 IP 被限流（HTTP 429），请切换 IP 后点「我已更换 IP」';
      const id = run.id; void ipNow().then(ip => { if (run?.id === id && ipLimited() && ip) { run.ipOld = ip; run.reason += ' · 当前 IP ' + ip; changed(); } });
    }
    changed();
  }
  const ipLimited = () => !!run && run.status === 'paused' && (run.code === 'RATE_LIMIT' || run.code === 'ALERT_LIMIT' || (run.code === 'QUOTA' && /429|速率|限流/.test(run.reasonRaw || run.reason || '') && !/余额/.test(run.reasonRaw || run.reason || '')));
  // Arena 实际看到的出口 IP：同域 Cloudflare trace；取不到再用 ipify
  async function ipNow() {
    try { const r = await fetch('/cdn-cgi/trace', { cache: 'no-store', credentials: 'omit' }); const m = /(?:^|\n)ip=([^\n]+)/.exec(await r.text()); if (m) return m[1].trim(); } catch {}
    try { const r = await fetch('https://api.ipify.org?format=json', { cache: 'no-store', credentials: 'omit' }); const j = await r.json(); if (j?.ip) return String(j.ip); } catch {}
    return null;
  }
  // 用户点“我已更换 IP”：确认 IP 变了、新 IP 访问 Arena 正常（非 429），清掉本地限流记录后继续抽卡
  async function ipRetry() {
    if (!ipLimited()) return { ok: false, error: '当前不是 IP 限流暂停' };
    const old = run.ipOld || null, ip = await ipNow();
    if (old && ip && ip === old) return { ok: false, error: 'IP 还是 ' + ip + '，没有变化，请确认已切换（切换后可能要等几秒）' };
    try { const r = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' }); if (r.status === 429) return { ok: false, error: '新 IP ' + (ip || '') + ' 仍被限流（HTTP 429），请再换一个' }; }
    catch (e) { return { ok: false, error: '无法连接 Arena：' + (e?.message || e) }; }
    try { core?.clearLimits?.(); } catch {}
    const msg = 'IP 已从 ' + (old || '未知') + ' 更换为 ' + (ip || '未知') + '，检测正常，继续抽卡';
    log(msg); const res = start(true); return res.ok ? { ok: true, msg } : res;
  }
  function finish(status, reason) { if (!run) return; token++; run.status = status; run.reason = reason; run.phase = ''; run.endedAt = now(); log(reason); changed(); }
  async function archiveQueued(manual) {
    if (!run) return 0;
    const todo = manual ? run.attempts.filter(a => a.verdict === 'archive' && a.sid && !a.archived) : [];
    for (const sid of (run.archiveQueue || [])) todo.push({ sid, fromQueue: true });
    let n = 0; for (const a of todo) { try { await archive(a.sid); a.archived = true; n++; } catch (e) { a.note = '归档失败 ' + (e.status ? 'HTTP ' + e.status : e.message); } await nap(400); }
    run.archiveQueue = todo.filter(a => a.fromQueue && !a.archived).map(a => a.sid);
    if (todo.length) { log('整理完成：归档 ' + n + '/' + todo.length + ' 个本次抽卡产生的对话'); } return n;
  }
  function start(resume = false) {
    if (!core) return { ok: false, error: REASONS.NO_CORE };
    if (run && ['running', 'stopping'].includes(run.status)) return { ok: false, error: '抽卡正在进行' };
    const s = settings();
    if (resume && run && run.status === 'paused') { run.settings = { ...s, maxAttempts: run.settings?.maxAttempts ?? s.maxAttempts }; run.status = 'running'; run.reason = ''; run.code = ''; run.skips = 0; run.skipTotal = 0; log('继续抽卡 · 提示词“' + s.prompt.slice(0, 20) + '”'); }
    else run = { id: Math.random().toString(36).slice(2), status: 'running', startedAt: now(), settings: s, completed: 0, skips: 0, skipTotal: 0, hits: [], attempts: [], log: [], phase: '', reason: '' };
    if (!/^\/agent(\/|$)/.test(location.pathname)) {
      // Not on an Agent page: go to /agent (a fresh chat) and let the run resume automatically after load.
      log('当前不是 Agent 页面，正在前往 arena.ai/agent 新建对话'); run.resumeNavUntil = now() + 30000; run.autoResume = false; token++; persist(); changed();
      location.assign('/agent'); return { ok: true, navigating: true };
    }
    run.autoResume = false; const my = ++token; changed(); void loop(my); return { ok: true };
  }
  function stop() { if (!run || !['running'].includes(run.status)) return; run.status = 'stopping'; run.reason = '已手动停止'; token++; changed(); setTimeout(() => { if (run?.status === 'stopping') { run.status = 'paused'; changed(); } }, 300); }
  // 抽卡中用户亲手点了 Arena 的“停止生成”（isTrusted，脚本自己的 click() 不算）→ 视为暂停抽卡
  try { document.addEventListener('click', e => {
    if (!e.isTrusted || run?.status !== 'running') return;
    const b = e.target?.closest?.('button'); if (!b || b.closest('[role="log"]')) return;
    if (!['Stop generating', '停止生成', 'Stop response'].includes((b.getAttribute('aria-label') || b.textContent || '').trim())) return;
    log('检测到手动停止生成，抽卡已暂停'); stop();
  }, true); } catch {}
  function reset() { if (run && ['running', 'stopping'].includes(run.status)) return; run = null; try { sessionStorage.removeItem(RUN); } catch {} changed(); }
  function bindCore(c) { core = c; if (run?.autoResume && run.status === 'running') { run.autoResume = false; const my = ++token; setTimeout(() => void loop(my), 1500); } }
  // v8.1 detector reloads the page on sidebar New Chat clicks; gacha clicks set a short-lived flag to bypass it.
  const reloadSuppressed = () => now() < suppressReloadUntil || (run?.status === 'running');
  // 老虎机动画用：当前这一抽的实时识别进度（不复制整个 run，便宜，可高频调用）
  function peek() {
    if (!run) return null;
    const a = run.attempts.at(-1) || null; let partial = '', exact = '';
    if (a?.sid && core?.runFor && !a.done) { try { const live = core.runFor(a.sid), rc = live?.data?.calls?.at(-1); if (live && live.sid === a.sid && !(a.sentAt && live.submittedAt && live.submittedAt < a.sentAt - 3000)) { exact = rc?.internal || rc?.response || ''; partial = exact || rc?.request || (rc?.model && rc.model !== '未提供' ? rc.model : ''); } } catch {} }
    const ok = !!a?.done && ['hit', 'keep', 'archive'].includes(a.verdict);
    return { id: run.id, status: run.status, reason: run.reason || '', completed: run.completed || 0, max: run.settings?.maxAttempts || 0, hits: (run.hits || []).length, no: a?.no || 0, phase: run.phase || '', sid: a?.sid || null, sent: !!a?.sentAt, done: !!a?.done, ok, verdict: a?.verdict || '', model: a?.model || '', tier: a?.tier || null, partial: validName(partial) ? partial : '', exact: validName(exact) ? exact : '' };
  }
  return {
    QUANTITIES, DEFAULTS, REASONS, settings, saveSettings, saveOk: () => saveOk, VENDORS, vendorFromText, setVendor, noteChatId, ownsTitle: sid => owned.has(sid), waitIdle, pendingTitle: sid => { const t = renameWant.get(sid); return t && Date.now() - (renameAt.get(sid) || 0) < 600000 ? t : null; }, followModel, start, stop, reset, bindCore, ipLimited, ipRetry, notePost, reloadSuppressed, archiveQueued: () => archiveQueued(true), running: () => run?.status === 'running',
    state: () => run ? JSON.parse(JSON.stringify(run)) : null, peek, setPaint(fn) { paintFn = fn; }, get revision() { return rev; },
    running: () => !!run && ['running', 'stopping'].includes(run.status),
    _test: { identify, classify, validName, titleOf, page, T, pace }
  };
})();

// ====================================================================================
// 出错自动刷新：对话里出现 “Something went wrong. Please try again.” 时倒计时 5 秒后刷新当前对话。
// 整页刷新（手动 F5 或自动刷新）后滚到最新消息一次——只在加载阶段滚，之后不锁定，可随意往上翻看历史。
// 不自动刷新的情况：输入框有未发送内容、抽卡运行/停止中/暂停、页面显示限流提示、页面加载时就已存在的错误、刷新次数超限。
// ====================================================================================
const errReload = (() => {
  const CONV = /^\/agent\/([0-9a-f-]{36})\/?$/i;
  const LOG_KEY = 'amp.native.errReload', JUST_KEY = 'amp.native.errReload.just';
  const WAIT = 5, PER_SID_GAP = 60e3, WINDOW = 10 * 60e3, MAX_IN_WINDOW = 3, BASELINE = 6000;
  const PHRASE = /^(?:something went wrong[.!。]?(?:\s*please try again[.!。]?)?|出了点问题[，,。.]?(?:\s*请重试[。.!！]?)?|出错了[，,。.]?(?:\s*请重试[。.!！]?)?)$/i;
  const SKIP = 'pre,code,blockquote,[contenteditable="true"],textarea,.prose,[class*="markdown"],[data-streamdown],[data-message-author-role],[data-user-message-layout]';
  const sidNow = () => (CONV.exec(location.pathname) || [])[1] || null;
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = el => !!el?.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const read = (k, d) => { try { const v = JSON.parse(sessionStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
  const write = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const mainEl = () => document.querySelector('main');
  const logEl = () => { const m = mainEl(); return m && [...m.querySelectorAll('[role="log"]')].find(visible) || null; };

  // 只认“整段文字就是这句话”的提示元素；消息正文、代码、输入框里出现同样的句子不算
  function findError() {
    const m = mainEl(); if (!m) return null;
    let snap; try { snap = document.evaluate(".//*[contains(text(),'Something went wrong') or contains(text(),'something went wrong') or contains(text(),'出了点问题') or contains(text(),'出错了')]", m, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); } catch { return null; }
    for (let i = snap.snapshotLength - 1; i >= 0; i--) {
      let el = snap.snapshotItem(i);
      if (el.closest(SKIP)) continue;
      for (let up = el.parentElement, n = 0; up && up !== m && n < 3; up = up.parentElement, n++) { if (PHRASE.test(norm(up.textContent))) el = up; else break; }
      if (PHRASE.test(norm(el.textContent)) && visible(el)) return el;
    }
    return null;
  }
  function chatStatus() {
    const sid = sidNow(), log = logEl(); if (!sid || !log) return null;
    try { let f = log[Object.keys(log).find(k => k.startsWith('__reactFiber'))]; for (let n = 0; f && n < 100; n++, f = f.return) { const v = f.memoizedProps?.value; if (v && v.id === sid && Array.isArray(v.messages)) return String(v.status || ''); } } catch {}
    return null;
  }
  const draft = () => [...document.querySelectorAll('main div[contenteditable="true"], main textarea')].filter(visible).some(e => norm(e.value ?? e.innerText ?? e.textContent).length > 0);
  const gachaBusy = () => { try { const pk = gacha.peek(); return !!pk && ['running', 'stopping', 'paused'].includes(pk.status); } catch { return false; } };
  const limited = () => { try { return [...document.querySelectorAll('[role="alert"]')].some(e => visible(e) && /too many requests|rate limit|try again later|quota exceeded|limit reached|429/i.test(e.textContent || '')); } catch { return false; } };
  function budget(sid) { const now = Date.now(), list = read(LOG_KEY, []).filter(x => x && now - x.at < WINDOW); return { list, ok: !list.some(x => x.sid === sid && now - x.at < PER_SID_GAP) && list.length < MAX_IN_WINDOW, n: list.length }; }

  // ---------- 提示条 ----------
  let host = null, box = null, hideTimer = 0;
  function ui() {
    if (box?.isConnected) return box;
    host = document.createElement('div'); host.id = 'amp-err-reload'; host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483000';
    const root = host.attachShadow({ mode: 'open' }), st = document.createElement('style');
    st.textContent = '.b{position:fixed;display:flex;align-items:center;gap:8px;max-width:min(580px,calc(100vw - 24px));padding:8px 8px 8px 14px;border-radius:12px;background:rgba(38,37,34,.95);color:#f3f1ec;font:13px/1.45 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.28);transform:translateX(-50%);animation:in .18s ease-out}.b[hidden]{display:none}.t{flex:1;min-width:0}.b button{flex:none;height:26px;padding:0 10px;border:0;border-radius:7px;cursor:pointer;font:inherit;font-size:12px;background:rgba(255,255,255,.12);color:#f3f1ec}.b button:hover{background:rgba(255,255,255,.2)}.b button.p{background:#d8d3ca;color:#262522}.b button.p:hover{background:#fff}.b button.x{width:26px;padding:0;font-size:15px;background:transparent;color:rgba(243,241,236,.6)}@keyframes in{from{opacity:0;transform:translate(-50%,6px)}}';
    box = document.createElement('div'); box.className = 'b'; box.hidden = true; box.setAttribute('role', 'status');
    root.append(st, box); (document.body || document.documentElement).append(host);
    return box;
  }
  function place() {
    if (!box) return;
    const m = mainEl()?.getBoundingClientRect(), ed = [...document.querySelectorAll('main div[contenteditable="true"], main textarea')].find(visible), f = (ed?.closest('form') || ed)?.getBoundingClientRect();
    box.style.left = Math.round(m && m.width ? m.left + m.width / 2 : innerWidth / 2) + 'px';
    box.style.bottom = Math.round(f && f.height ? Math.max(12, innerHeight - f.top + 10) : 150) + 'px';
  }
  function show(text, actions = [], closable = false) {
    const b = ui(); clearTimeout(hideTimer); b.textContent = '';
    const t = document.createElement('span'); t.className = 't'; t.textContent = text; b.append(t);
    actions.forEach(([label, fn], i) => { const x = document.createElement('button'); x.type = 'button'; x.textContent = label; if (!i) x.className = 'p'; x.onclick = fn; b.append(x); });
    if (closable) { const x = document.createElement('button'); x.type = 'button'; x.className = 'x'; x.textContent = '×'; x.title = '关闭'; x.onclick = () => { stale = true; hide(); }; b.append(x); }
    b.hidden = false; place();
  }
  function hide() { clearInterval(timer); timer = 0; errBar = false; if (box) box.hidden = true; }
  function toast(text, ms = 3200) { show(text); hideTimer = setTimeout(hide, ms); }

  // ---------- 检测与自动刷新 ----------
  let timer = 0, busy = false, stale = false, baseSid = null, baseUntil = 0, errBar = false;
  function reloadNow(sid, auto) {
    sid = sid || sidNow();
    if (auto) { const b = budget(sid); b.list.push({ sid, at: Date.now() }); write(LOG_KEY, b.list); }
    write(JUST_KEY, { sid, at: Date.now(), auto: !!auto });
    clearInterval(timer); timer = 0; show('正在刷新当前对话…');
    location.reload();
  }
  function cancel() { stale = true; busy = false; hide(); }
  function countdown(sid) {
    let n = WAIT; busy = true;
    const paint = () => show('检测到 “Something went wrong”，' + n + ' 秒后自动刷新当前对话', [['立即刷新', () => reloadNow(sid, false)], ['取消', cancel]]);
    paint(); clearInterval(timer);
    timer = setInterval(() => {
      if (sidNow() !== sid || !findError()) { busy = false; hide(); return; } // 已恢复或已离开这个对话
      if (draft()) { clearInterval(timer); timer = 0; busy = false; stale = true; show('输入框里有未发送的内容，已取消自动刷新；需要时手动刷新', [['刷新', () => reloadNow(sid, false)]], true); errBar = true; return; }
      if (--n <= 0) { clearInterval(timer); timer = 0; reloadNow(sid, true); return; }
      paint();
    }, 1000);
  }
  function tick() {
    const sid = sidNow();
    if (!sid) { if (busy) { busy = false; hide(); } baseSid = null; return; }
    if (sid !== baseSid) { baseSid = sid; baseUntil = 0; stale = false; busy = false; hide(); }
    if (!baseUntil) { if (!logEl()) return; baseUntil = Date.now() + BASELINE; } // 对话渲染出来后的前几秒算“加载时就有”
    if (busy) return;
    const el = findError();
    if (!el) { stale = false; if (errBar) hide(); return; }
    if (Date.now() < baseUntil) { stale = true; return; }
    if (stale) return;
    const st = chatStatus(); if (st === 'submitted' || st === 'streaming') return;
    if (gachaBusy() || limited()) return;
    stale = true; // 这一次出错只处理一次；提示消失后再出现才会重新处理
    if (draft()) { show('检测到 “Something went wrong”。输入框里有未发送的内容，没有自动刷新', [['刷新', () => reloadNow(sid, false)]], true); errBar = true; return; }
    const b = budget(sid);
    if (!b.ok) { show('近 10 分钟已自动刷新 ' + b.n + ' 次，暂停自动刷新；需要时手动刷新', [['刷新', () => reloadNow(sid, false)]], true); errBar = true; return; }
    stale = false; countdown(sid);
  }

  // ---------- 刷新后滚到最新消息（一次，不锁定） ----------
  function findScroller() {
    const log = logEl(), cands = [];
    if (log) { for (let e = log; e && e !== document.body; e = e.parentElement) cands.push(e); cands.push(...log.querySelectorAll(':scope > *, :scope > * > *')); }
    let best = null, room = 0;
    for (const e of cands) { const r = e.scrollHeight - e.clientHeight; if (r > room + 1) { const oy = getComputedStyle(e).overflowY; if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') { best = e; room = r; } } }
    if (!best && log) { const se = document.scrollingElement; if (se && se.scrollHeight - se.clientHeight > 1) best = se; }
    return best;
  }
  function bottomOnce(msg) {
    const t0 = Date.now(); let done = false, lastH = -1, stableAt = Date.now(), sc = null, said = false;
    const off = () => { if (done) return; done = true; clearInterval(iv); removeEventListener('wheel', off, true); removeEventListener('touchstart', off, true); removeEventListener('keydown', onKey, true); removeEventListener('mousedown', onDown, true); };
    const onKey = e => { if (/^(PageUp|PageDown|Home|End|ArrowUp|ArrowDown)$/.test(e.key) || (e.key === ' ' && !e.target?.closest?.('[contenteditable="true"],textarea,input'))) off(); };
    const onDown = e => { if (sc && (e.target === sc || sc.contains(e.target))) off(); };
    addEventListener('wheel', off, { capture: true, passive: true }); addEventListener('touchstart', off, { capture: true, passive: true }); addEventListener('keydown', onKey, true); addEventListener('mousedown', onDown, true);
    const iv = setInterval(() => {
      if (done) return;
      if (Date.now() - t0 > 15000) { off(); return; }
      if (!sc || !sc.isConnected) sc = findScroller();
      if (!sc) return;
      const h = sc.scrollHeight, room = h - sc.clientHeight;
      if (h !== lastH) { lastH = h; stableAt = Date.now(); }
      if (room > 2 && sc.scrollTop < room - 2) sc.scrollTop = h;
      if (msg && !said) { said = true; toast(msg); }
      if (Date.now() - stableAt > 2500 && room > 2) off();
    }, 200);
  }
  function afterLoad() {
    const sid = sidNow(), j = read(JUST_KEY, null);
    try { sessionStorage.removeItem(JUST_KEY); } catch {}
    if (!sid) return;
    let nav = ''; try { nav = performance.getEntriesByType('navigation')[0]?.type || ''; } catch {}
    const ours = !!j && j.sid === sid && Date.now() - j.at < 60e3;
    if (nav === 'reload' || ours) bottomOnce(ours && j.auto ? '已自动刷新，回到最新消息' : '');
  }
  function start() { afterLoad(); setInterval(() => { try { tick(); } catch {} }, 2000); addEventListener('resize', () => { if (box && !box.hidden) place(); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  return { tick, findError, bottomOnce };
})();

// ====================================================================================
// VIP pin (request model clzui / dxzui), current-chat progress fill, model-change alert.
// ====================================================================================
const vip = (() => {
  const KEY = 'amp.native.vip.v1', RE = /clzui|dxzui/i;
  let map = new Map(); try { map = new Map(Object.entries(JSON.parse(localStorage.getItem(KEY)) || {}).slice(-300)); } catch {}
  let rev = 0;
  const save = () => { ampStore.set(KEY, JSON.stringify(Object.fromEntries(map))); rev++; };
  // Called with the request models of the latest turn. Any latest turn whose request model is not VIP drops the pin.
  function note(sid, requests) {
    if (!sid || !requests?.length) return null;
    const hit = requests.find(r => RE.test(r));
    if (hit) { if (map.get(sid) !== hit) { map.delete(sid); map.set(sid, hit); while (map.size > 300) map.delete(map.keys().next().value); save(); return 'set'; } return null; }
    if (map.has(sid)) { const old = map.get(sid); map.delete(sid); save(); return { dropped: old }; }
    return null;
  }
  try { window.addEventListener('storage', e => { if (e.key === KEY) { try { map = new Map(Object.entries(JSON.parse(e.newValue) || {})); rev++; } catch {} } }); } catch {}
  return { note, get: sid => map.get(sid) || null, get rev() { return rev; }, RE };
})();
const progress = (() => {
  // The selected conversation's card fills from its left bar to the full row as the chat loads.
  let path = '', fill = 0, done = false, startAt = 0, seenAt = 0, old = new WeakSet();
  const MSG = 'main [data-user-message-body-row],main [data-user-message-action],main [role="log"] p,main article';
  const sidNow = () => (location.pathname.match(/^\/agent\/([0-9a-f-]{36})/i) || [])[1] || '';
  function tick() {
    const p = location.pathname;
    // Messages of the previous chat stay mounted for a moment during SPA navigation: only NEW message nodes count as loaded.
    if (p !== path) { path = p; fill = 6; done = false; startAt = Date.now(); seenAt = 0; old = new WeakSet(document.querySelectorAll(MSG)); }
    if (!done && sidNow()) {
      const loaded = document.readyState === 'complete' && [...document.querySelectorAll(MSG)].some(n => !old.has(n));
      if (loaded && !seenAt) seenAt = Date.now();
      const el = Date.now() - startAt;
      if (seenAt && Date.now() - seenAt > 350) fill = Math.min(100, fill + 18);
      else fill = Math.min(88, fill + (88 - fill) * (seenAt ? 0.25 : 0.07));
      if (el > 9000) fill = 100;
      if (fill >= 100) { fill = 100; done = true; }
    }
    paint();
  }
  let links = [];
  function paint() {
    const sid = sidNow();
    for (const a of links.length ? links : document.querySelectorAll('a[data-amp-current]')) {
      const cur = !!sid && a.isConnected && a.getAttribute('href') === '/agent/' + sid;
      if (cur) { if (!a.hasAttribute('data-amp-current')) a.setAttribute('data-amp-current', ''); const f = fill + '%'; if (a.style.getPropertyValue('--amp-fill') !== f) a.style.setProperty('--amp-fill', f); a.toggleAttribute('data-amp-done', done); a.toggleAttribute('data-amp-ink', fill >= 55); }
      else if (a.hasAttribute('data-amp-current')) { a.removeAttribute('data-amp-current'); a.removeAttribute('data-amp-done'); a.removeAttribute('data-amp-ink'); a.style.removeProperty('--amp-fill'); }
    }
  }
  function mark(list) { links = list; paint(); }
  setInterval(() => { try { tick(); } catch {} }, 120);
  return { mark, get fill() { return fill; } };
})();
// Vendor/brand detection for sidebar logos: title first, then the local cache (internal name / request models / VIP model).
const brand = (() => {
  const LIST = [
    ['openai', /gpt|chatgpt|openai|codex|dall-?e|\bo[134](?:-mini|-pro)?\b/i],
    ['anthropic', /claude|anthropic|\bopus\b|\bsonnet\b|\bhaiku\b/i],
    ['google', /gemini|gemma|\bbard\b|google/i],
    ['xai', /grok|\bxai\b/i],
    ['moonshot', /kimi|moonshot/i],
    ['deepseek', /deepseek/i],
    ['qwen', /qwen|qwq|tongyi/i],
    ['zhipu', /\bglm|chatglm|zhipu/i],
    ['xiaomi', /\bmimo/i],
    ['bytedance', /doubao|\bseed-?\d/i],
    ['minimax', /minimax|\babab/i],
    ['mistral', /mistral|mixtral|codestral|magistral|devstral/i],
    ['meta', /llama|\bmeta\b/i]
  ];
  const of = t => { t = String(t || ''); if (!t) return ''; for (const [id, re] of LIST) if (re.test(t)) return id; return ''; };
  // Filled by the Lite catalog once it is ready: sid → cached names; rev changes when the cache changes.
  const hint = { get: () => '', rev: () => 0 };
  const NAME = { openai: 'GPT', anthropic: 'Claude', google: 'Gemini', xai: 'Grok', moonshot: 'Kimi', deepseek: 'DeepSeek', qwen: 'Qwen', zhipu: 'GLM', xiaomi: 'MiMo', bytedance: 'Doubao', minimax: 'MiniMax', mistral: 'Mistral', meta: 'Llama' };
  // 版本号：取名字里第一个数字 + 紧随的次版本（claude-opus-5.5 → 5.05、claude-fable-5-1 → 5.01、gpt-6 → 6）；日期等长数字忽略。
  const version = t => { const k = String(t || '').toLowerCase().replace(/^#\d+\s*/, '').replace(/\s*·\s*\d+\s*$/, '').replace(/(\d)([a-z])/g, '$1-$2').replace(/([a-z])(\d)/g, '$1-$2').split(/[^a-z0-9]+/).filter(Boolean); const i = k.findIndex(x => /^\d{1,2}$/.test(x)); if (i < 0) return null; const minor = /^\d{1,2}$/.test(k[i + 1] || '') ? +k[i + 1] : 0; return +k[i] + minor / 100; };
  // 有 logo 的地方不写厂商前缀：claude-opus-5.5-medium-vertex → opus-5.5-medium（去 -vertex，K3 大写）
  const VPRE = /^(?:[\w.-]+\/)?(?:gpt|chatgpt|claude|gemini|grok|kimi|qwen|deepseek|mimo|glm|llama|mistral|doubao|minimax)[-_ ]+(?=[\w])/i;
  const short = n => { n = noVertex(String(n || '')).trim(); if (!of(n)) return n; let r = n.replace(VPRE, ''); if (r === n) r = (n.match(/^[\w.-]+\/(.+)$/) || [])[1] || n; if (/^k\d/.test(r)) r = 'K' + r.slice(1); return r; };
  // 同一模型判定：去 -vertex / 厂商前缀 / 分隔符差异（5-5 与 5.5）后比较；只多了档位或更细的后缀视为同一模型（细化，不算变更）
  const TIERX = /-(none|minimal|low|medium|high|xhigh|max|thinking)$/;
  const canon = n => short(n).toLowerCase().replace(/-(agent)$/, '').replace(/[._\s/]+/g, '-').replace(/-+/g, '-');
  const same = (a, b) => { const x = canon(a), y = canon(b); if (!x || !y) return false; if (x === y) return true; const bx = x.replace(TIERX, ''), by = y.replace(TIERX, ''); const tx = (x.match(TIERX) || [])[1], ty = (y.match(TIERX) || [])[1]; if (bx === by) return !tx || !ty || tx === ty; return (by.startsWith(bx + '-') && !tx) || (bx.startsWith(by + '-') && !ty); };
  const tierOf = n => (canon(n).match(TIERX) || [])[1] || '';
  return { of, hint, NAME, version, short, same, canon, tierOf, forSid: (sid, title) => of(title) || of(hint.get(sid)) };
})();
// ====================================================================================
// 抽卡老虎机（v1.11.34）：抽卡进行时在屏幕中央显示三段式滚轮——厂商 → 型号 → 档位，
// 由实时识别驱动：识别到厂商第一轮停，拿到内部名第二轮停，整抽完成第三轮停；下面是总进度条。
const gachaSlot = (() => {
  const MOB = (window.innerWidth || 800) < 560, H = MOB ? 36 : 44, N = 12, SPIN = 15;
  const VW = new Set(['claude', 'gpt', 'chatgpt', 'gemini', 'grok', 'kimi', 'deepseek', 'qwen', 'glm', 'mimo', 'doubao', 'minimax', 'mistral', 'llama', 'anthropic', 'openai', 'google', 'xai', 'models', 'agent']);
  const FILL = [
    ['Claude', 'GPT', 'Gemini', 'Grok', 'Kimi', 'DeepSeek', 'Qwen', 'GLM'],
    ['opus', 'sonnet', 'haiku', 'luna', 'fable', 'pro', 'flash', 'astra', 'K3', 'nova', 'mini', 'ultra'],
    ['max', 'xhigh', 'high', 'medium', 'low', '标准']
  ];
  const TIER_RE = /^(none|minimal|low|medium|high|xhigh|max)$/;
  function parts(name, tier) {
    const n = noVertex(String(name || '')).replace(/-(agent)$/i, '').trim();
    const bid = brand.of(n), raw = n.toLowerCase().split(/[-_\s/·:]+/).filter(Boolean);
    let toks = raw.filter(t => !VW.has(t)), t = tier && TIER_RE.test(tier) ? tier : '';
    if (toks.length > 1 && TIER_RE.test(toks.at(-1))) { t = t || toks.at(-1); toks.pop(); }
    const out = [];
    for (const x of toks) { const last = out.at(-1); if (/^\d{1,2}$/.test(x) && last && /^\d{1,2}$/.test(last)) out[out.length - 1] = last + '.' + x; else out.push(x); }
    return { vendor: brand.NAME[bid] || (raw[0] || '—'), family: out.join('-') || '—', tier: !t || t === 'none' ? '标准' : t };
  }
  const dark = () => { const d = document.documentElement; return d.dataset.theme === 'dark' || d.classList.contains('dark') || (!d.classList.contains('light') && getComputedStyle(d).colorScheme === 'dark'); };
  const CSS = ':host{all:initial}'
    + '.wrap{position:fixed;left:50%;top:46%;z-index:2147482000;transform:translate(-50%,-50%) scale(.94);opacity:0;pointer-events:none;transition:opacity .22s ease,transform .36s cubic-bezier(.22,1,.36,1);font:500 14px/1.3 var(--font-basel-grotesk,var(--font-inter,system-ui)),-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;'
    + '--bg:rgba(250,248,244,.78);--fg:#262522;--mut:#7a746b;--line:#0000000f;--acc:#6a5e54;--accfg:#fff;--card:#fffdf9;--win:#e6ddd0;--track:#e6ddd0;color:var(--fg)}'
    + '.wrap.dark{--bg:rgba(30,29,27,.74);--fg:#ecebe7;--mut:#a9a59d;--line:#ffffff14;--acc:#d8d3ca;--accfg:#262522;--card:#34322e;--win:#4b4740;--track:#3a3733}'
    + '.wrap.on{opacity:1;transform:translate(-50%,-50%) scale(1)}'
    + '.box{pointer-events:none;width:min(480px,calc(100vw - 24px));box-sizing:border-box;padding:14px 14px 12px;border-radius:22px;background:transparent;border:0;box-shadow:none;transition:box-shadow .3s,border-color .3s}'
    + '.wrap.dark .box{box-shadow:none}.head,.cap,.foot{text-shadow:0 0 6px var(--halo),0 0 2px var(--halo)}.wrap{--halo:rgba(250,248,244,.95)}.wrap.dark{--halo:rgba(20,19,18,.95)}'
    + '.head{display:flex;align-items:center;gap:8px;margin:9px 2px 0;white-space:nowrap;font-size:12px;color:var(--mut)}.head b{color:var(--fg);font-weight:600;font-size:13px;font-variant-numeric:tabular-nums}.head .sp{flex:1}'
    + '.btn{pointer-events:auto;white-space:nowrap;appearance:none;border:0;background:transparent;color:var(--mut);font:inherit;font-size:11px;padding:3px 8px;border-radius:7px;cursor:pointer}.btn:hover{background:var(--card);color:var(--fg)}'
    + '.reels{display:grid;grid-template-columns:1fr 1.4fr .95fr;gap:14px;padding:0 6px}'
    + '.reel{position:relative;height:' + (H * 4) + 'px;margin:4px 0;perspective:520px}'
    + '.win{position:absolute;left:-6px;right:-6px;top:50%;height:' + (H + 6) + 'px;margin-top:-' + ((H + 6) / 2) + 'px;border-radius:14px;background:var(--win);box-shadow:0 10px 30px rgba(0,0,0,.2),0 0 0 3px color-mix(in srgb,var(--acc) 18%,transparent),inset 0 0 0 2px var(--acc);transition:box-shadow .25s,background .25s}'
    + '.reel.stop .win{box-shadow:0 10px 30px rgba(0,0,0,.24),0 0 0 5px color-mix(in srgb,var(--acc) 26%,transparent),inset 0 0 0 2px var(--acc)}'
    + '.drum{position:absolute;inset:0;transform-style:preserve-3d}'
    + '.it{position:absolute;left:0;right:0;top:50%;height:' + (H - 6) + 'px;margin-top:-' + ((H - 6) / 2) + 'px;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 12px;box-sizing:border-box;border-radius:12px;background:var(--card);color:var(--fg);box-shadow:0 4px 14px rgba(0,0,0,.14),inset 0 0 0 1px var(--line);backface-visibility:hidden;will-change:transform,opacity;white-space:nowrap}'
    + '.it .ic{display:none;width:18px;height:18px;align-items:center;justify-content:center;flex:none}.it .ic:not(:empty){display:inline-flex}.it .ic svg{width:16px;height:16px}'
    + '.it .nm{min-width:0;overflow:hidden;text-overflow:ellipsis}'
    + '.it.sel{background:transparent;box-shadow:none;font-weight:700;color:var(--acc)}.it.sel .ic{color:var(--fg)}'
    + '.reel.thunk .win{animation:thunk .36s cubic-bezier(.3,1.6,.5,1)}@keyframes thunk{0%{transform:scale(1)}35%{transform:scale(1.045)}100%{transform:scale(1)}}'
    + '.cap{display:grid;grid-template-columns:1fr 1.4fr .95fr;gap:14px;padding:0 6px;margin:2px 0 0;font-size:10px;color:var(--mut);text-align:center;letter-spacing:.04em}'
    + '.bar{position:relative;height:6px;margin:12px 2px 0;border-radius:6px;background:var(--track);box-shadow:0 1px 4px rgba(0,0,0,.12);overflow:hidden}'
    + '.fill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:6px;background:var(--acc);transition:width .45s cubic-bezier(.22,1,.36,1)}'
    + '.fill::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent);background-size:60px 100%;background-repeat:no-repeat;animation:shine 1.3s linear infinite}'
    + '.wrap.dark .fill::after{background:linear-gradient(90deg,transparent,rgba(0,0,0,.25),transparent);background-size:60px 100%;background-repeat:no-repeat}'
    + '.wrap.idle .fill::after{animation:none;opacity:0}@keyframes shine{from{background-position:-60px 0}to{background-position:calc(100% + 60px) 0}}'
    + '.foot{display:flex;align-items:center;gap:8px;margin:3px 2px 0;font-size:11px;color:var(--mut);min-height:18px}.foot .ph{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.badge{flex:none;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600;background:var(--card);color:var(--fg);opacity:0;transform:scale(.8);transition:opacity .2s,transform .3s cubic-bezier(.3,1.6,.5,1)}.badge.show{opacity:1;transform:scale(1)}'
    + '.badge.hit{background:var(--acc);color:var(--accfg)}'
    + '.wrap.hit .win{box-shadow:0 10px 30px rgba(0,0,0,.24),0 0 0 6px color-mix(in srgb,var(--acc) 34%,transparent),inset 0 0 0 2px var(--acc)}'
    + '.badge.gold{color:#3a2600;background:linear-gradient(100deg,#b8860b,#ffd76a 35%,#fff3c4 50%,#ffd76a 65%,#b8860b);background-size:220% 100%;animation:goldsweep 1.6s linear infinite;box-shadow:0 0 14px rgba(255,196,60,.65)}.badge.dim{background:#8884;color:var(--mut)}'
    + '.wrap.legend .win{background:linear-gradient(100deg,#b8860b,#ffd76a 35%,#fff3c4 50%,#ffd76a 65%,#b8860b);background-size:220% 100%;animation:goldsweep 1.6s linear infinite;box-shadow:0 0 0 2px #e0b23a,0 0 26px 6px rgba(255,190,50,.55),0 0 60px 14px rgba(255,190,50,.25)}'
    + '.wrap.legend .it.sel{color:#3a2600;text-shadow:0 1px 0 rgba(255,255,255,.5)}.wrap.legend .it.sel .ic{color:#3a2600}'
    + '.wrap.legend .reels{animation:legend 1.1s cubic-bezier(.3,1.5,.5,1)}@keyframes legend{0%{transform:scale(1)}30%{transform:scale(1.06)}100%{transform:scale(1)}}@keyframes goldsweep{from{background-position:120% 0}to{background-position:-100% 0}}'
    + '.wrap.legend .box::before{content:"";position:absolute;inset:-40px;pointer-events:none;background:radial-gradient(closest-side,rgba(255,200,70,.35),transparent 70%);animation:glow 1.8s ease-in-out infinite}.box{position:relative}@keyframes glow{50%{opacity:.45}}'
    + '.wrap.dim .reels,.wrap.dim .cap{filter:grayscale(1) brightness(.8);opacity:.45;transition:filter .5s,opacity .5s}.wrap.dim .win{box-shadow:inset 0 0 0 2px #8886}'
    + '@media (max-width:560px){.box{width:min(350px,calc(100vw - 36px));padding:6px 4px}.reels,.cap{gap:9px;padding:0 3px;grid-template-columns:1.2fr 1.25fr .95fr}.it{font-size:12px;padding:0 6px;gap:5px;border-radius:10px}.it .ic{width:14px;height:14px}.it .ic svg{width:13px;height:13px}.win{left:-3px;right:-3px;border-radius:12px}.head{font-size:11px;gap:6px}.head b{font-size:12px}.bar{height:5px;margin-top:9px}.btn{padding:3px 6px}}'
    + '@media (prefers-reduced-motion:reduce){.fill::after{animation:none}.reel.thunk{animation:none}.wrap.legend *,.wrap.legend .box::before{animation:none!important}}';

  let host = null, root = null, wrap = null, reels = [], fillEl, phEl, badgeEl, noEl, hitEl, raf = 0, hideT = 0, disp = null, lastPeek = 0, p = null, hiddenRun = '', endShown = '';
  function build() {
    host = document.createElement('div'); host.id = 'amp-gacha-slot';
    root = host.attachShadow({ mode: 'open' });
    // 老虎机上方不放任何信息（免得和对话里的提示词重叠）；状态、抽数、停止/收起都放在进度条下方
    root.innerHTML = '<style>' + CSS + '</style><div class="wrap"><div class="box">'
      + '<div class="reels"></div><div class="cap"><span>厂商</span><span>型号</span><span>档位</span></div><div class="bar"><div class="fill"></div></div>'
      + '<div class="head"><span>抽卡中</span><b class="no"></b><span class="hits"></span><span class="sp"></span><button class="btn stop" type="button">停止</button><button class="btn min" type="button" title="本次抽卡不再显示">收起</button></div>'
      + '<div class="foot"><span class="ph"></span><span class="badge"></span></div></div></div>';
    wrap = root.querySelector('.wrap'); fillEl = root.querySelector('.fill'); phEl = root.querySelector('.ph'); badgeEl = root.querySelector('.badge'); noEl = root.querySelector('.no'); hitEl = root.querySelector('.hits');
    root.querySelector('.stop').onclick = () => { try { gacha.stop(); } catch {} hide(); };
    root.querySelector('.min').onclick = () => { hiddenRun = p?.id || ''; hide(); };
    const box = root.querySelector('.reels');
    reels = FILL.map((list, k) => {
      const el = document.createElement('div'); el.className = 'reel'; box.appendChild(el);
      el.innerHTML = '<div class="win"></div><div class="drum"></div>'; const drum = el.lastChild;
      const items = Array.from({ length: N }, () => { const d = document.createElement('div'); d.className = 'it'; d.innerHTML = '<span class="ic"></span><span class="nm"></span>'; drum.appendChild(d); return d; });
      return { k, el, items, list, pos: Math.random() * N, mode: 'spin', from: 0, to: 0, t0: 0, dur: 0, stopAt: 0, label: '', sel: -1 };
    });
    (document.body || document.documentElement).appendChild(host);
  }
  const wrapI = i => ((i % N) + N) % N;
  function setItem(r, d, label) {
    d.lastChild.textContent = label; d.title = label;
    if (r.k === 0) { const id = brand.of(label); let ic = ''; try { ic = id ? gachaUi.vendorIcon(id, 16) : ''; } catch {} if (d.firstChild.innerHTML !== ic) d.firstChild.innerHTML = ic; }
  }
  function paintReel(r) {
    for (let i = 0; i < N; i++) {
      const off = ((((i - r.pos) % N) + N + N / 2) % N) - N / 2, a = Math.abs(off), d = r.items[i];
      // 与“切换厂商”弹巢一致：卡片绕水平轴排成圆柱，离中心越远越倾斜、越小、越淡
      d.style.transform = 'translateY(' + (off * H * .92) + 'px) rotateX(' + (-off * 24) + 'deg) translateZ(' + (-a * a * 6) + 'px) scale(' + Math.max(.72, 1 - a * .07) + ')';
      d.style.opacity = String(Math.max(0, 1 - a * .3)); d.style.zIndex = String(100 - Math.round(a * 10));
    }
    const k = wrapI(Math.round(r.pos)); if (k !== r.sel) { r.sel = k; r.items.forEach((d, i) => d.classList.toggle('sel', i === k)); }
  }
  function resetReels() {
    for (const r of reels) {
      r.mode = 'spin'; r.label = ''; r.coast = false; r.v = 0; r.el.classList.remove('stop', 'thunk');
      r.items.forEach((d, i) => setItem(r, d, r.list[(i + r.k * 3) % r.list.length]));
    }
  }
  function land(r, label, t) {
    // 目标项放在滚轮背面（看不见的位置），减速转过去停住；初速度与匀速旋转衔接
    const to = Math.ceil(r.pos) + N / 2 + 1, idx = wrapI(to);
    setItem(r, r.items[idx], label);
    r.mode = 'land'; r.label = label; r.from = r.pos; r.to = to; r.t0 = t;
    // 慢速落位：三次缓出的初速度 = 3·距离/时长，与当前转速衔接；追赶模式下短一些
    r.dur = disp?.fast ? 520 : Math.max(1000, Math.min(1700, 3 * (to - r.pos) / Math.max(4, r.v || SPIN) * 1000));
  }
  function show() {
    clearTimeout(hideT); hideT = 0;
    if (!host || !host.isConnected) build();
    wrap.classList.toggle('dark', dark());
    if (!wrap.classList.contains('on')) requestAnimationFrame(() => wrap.classList.add('on'));
    if (!raf) { let last = performance.now(); const step = t => { raf = 0; const dt = Math.min(.05, (t - last) / 1000); last = t; frame(t, dt); if (host && wrap.classList.contains('on')) raf = requestAnimationFrame(step); }; raf = requestAnimationFrame(step); }
  }
  function hide(delay = 0) {
    if (!wrap || hideT) return;
    hideT = setTimeout(() => { hideT = 0; wrap.classList.remove('on'); cancelAnimationFrame(raf); raf = 0; disp = null; }, delay);
  }
  function newDisp(no) { disp = { no, t0: performance.now(), targets: ['', '', ''], ok: false, verdict: '', endAt: 0 }; resetReels(); badgeEl.className = 'badge'; wrap.classList.remove('hit', 'legend', 'dim'); }
  function frame(t, dt) {
    if (t - lastPeek > 110) { lastPeek = t; try { p = gacha.peek(); } catch { p = null; } }
    if (!p) { hide(); return; }
    if (!disp) newDisp(p.no);
    const running = p.status === 'running' || p.status === 'stopping';
    // 当前这一抽的识别目标
    if (p.no === disp.no) {
      const cur = p.done ? p.model : (p.partial || '');
      if (cur) {
        const pr = parts(cur, p.tier);
        if (brand.of(cur) || p.done) disp.targets[0] = pr.vendor;
        if (p.exact || p.ok) disp.targets[1] = pr.family;
        if (p.ok) disp.targets[2] = pr.tier;
      }
      if (p.done && !p.ok) { disp.verdict = p.verdict; if (p.verdict === 'cancelled') disp.coast = true; else disp.targets = disp.targets.map(x => x || '—'); }
      if (p.ok) { disp.ok = true; disp.verdict = p.verdict; }
    } else if (!disp.endAt) {
      // 已经开始下一抽：把这一抽没停的轮子快速停下（结果已知的沿用，未知的显示 —）
      disp.targets = disp.targets.map(x => x || '—'); disp.fast = true;
    }
    // 依次停轮：前一轮停稳后，下一轮才开始减速
    for (const r of reels) {
      const prev = reels[r.k - 1], gap = disp.fast ? 80 : 200;
      const ready = r.k === 0 ? t - disp.t0 > (disp.fast ? 0 : 500) : (prev.mode === 'stop' && t - prev.stopAt > gap) || (!disp.fast && prev.mode === 'land' && !prev.coast && t - prev.t0 > prev.dur * .6);
      if (r.mode === 'spin' && (disp.coast || (!running && !disp.targets[r.k]))) { r.mode = 'land'; r.coast = true; r.from = r.pos; r.to = Math.ceil(r.pos) + 2; r.t0 = t; r.dur = 600; }
      // 每一抽：先慢慢转起来（错开启动），加速到全速，再慢速落位
      if (r.mode === 'spin') { const age = (t - disp.t0) / 1000 - r.k * .12; if (disp.fast) r.v = SPIN; else if (age > 0) r.v = Math.min(SPIN, (r.v || 0) + SPIN / .7 * dt); r.pos += (r.v || 0) * dt; if (disp.targets[r.k] && ready && (disp.fast || r.v >= SPIN * .95)) land(r, disp.targets[r.k], t); }
      if (r.mode === 'land') {
        const q = Math.min(1, (t - r.t0) / r.dur); r.pos = r.from + (r.to - r.from) * (1 - Math.pow(1 - q, 3));
        if (q >= 1 && r.coast) { r.mode = 'stop'; r.stopAt = t; r.pos = r.to; r.coast = false; }
        else if (q >= 1) { r.mode = 'stop'; r.stopAt = t; r.pos = r.to; r.el.classList.add('stop'); r.el.classList.remove('thunk'); void r.el.offsetWidth; r.el.classList.add('thunk'); try { navigator.vibrate?.(8); } catch {} }
      }
      paintReel(r);
    }
    const allStop = reels.every(r => r.mode === 'stop');
    if (allStop && !disp.endAt) {
      disp.endAt = t;
      const v = disp.verdict, txt = { hit: '命中！', keep: '保留', archive: '归档', skipped: '未完成 · 补抽', cancelled: '已停止', error: '出错' }[v] || '';
      // 命中目标厂商且档位为 max / xhigh / high → 金色传说；抽到归档词里的模型 → 整体变暗变灰
      const legend = v === 'hit' && /^(max|xhigh|high)$/.test(disp.targets[2] || ''), dim = v === 'archive';
      const label = legend ? '金色传说 · ' + disp.targets[2] : txt;
      if (label) { badgeEl.textContent = label; badgeEl.className = 'badge show' + (legend ? ' gold' : v === 'hit' ? ' hit' : dim ? ' dim' : ''); }
      wrap.classList.toggle('hit', v === 'hit' && !legend); wrap.classList.toggle('legend', legend); wrap.classList.toggle('dim', dim);
      if (legend) { try { navigator.vibrate?.([12, 60, 12, 60, 30]); } catch {} }
      // 金色传说 / 命中 / 归档 多停留一会儿再切到下一抽（即使下一抽已经开始）
      // 抽到具体模型：停留 3 秒展示（只影响显示，后台下一抽照常进行；显示落后时直接跳到最新一抽）
      disp.hold = ['hit', 'keep', 'archive'].includes(v) ? (legend ? 3500 : 3000) : disp.fast ? 250 : 650;
    }
    // 展示完这一抽（停稳后停留一下）再切到下一抽
    if (p.no !== disp.no && disp.endAt && t - disp.endAt > (disp.hold || 650)) newDisp(p.no);
    // 头部与进度
    noEl.textContent = '第 ' + (disp.no || Math.max(1, Math.min(p.max || 1, p.completed + 1))) + ' / ' + p.max + ' 抽';
    hitEl.textContent = p.hits ? '· 命中 ' + p.hits : '';
    const stops = reels.filter(r => r.mode === 'stop').length;
    const frac = p.done ? 0 : !p.sid && !p.sent ? (/新对话/.test(p.phase) ? .1 : .04) : !p.sid ? .25 : [.4, .6, .8, .92][stops];
    const pct = p.max ? Math.min(100, (p.completed + (running ? frac : 0)) / p.max * 100) : 0;
    const w = pct.toFixed(1) + '%'; if (fillEl.style.width !== w) fillEl.style.width = w;
    wrap.classList.toggle('idle', !running);
    let ph = running ? (p.phase || '准备中') : (p.reason || ({ done: '已完成', hit: '已完成', paused: '已暂停' }[p.status] || ''));
    if (phEl.textContent !== ph) phEl.textContent = ph;
    root.querySelector('.head span').textContent = running ? '抽卡中' : p.status === 'paused' ? '已暂停' : '抽卡结束';
    root.querySelector('.stop').style.display = running ? '' : 'none';
  }
  function tick() {
    let q = null; try { q = gacha.peek(); } catch {}
    const running = !!q && q.status === 'running';
    if (running && q.id !== hiddenRun) { endShown = ''; show(); return; }
    if (wrap?.classList.contains('on') && q && !running) {
      // 结束：停留几秒展示结果再淡出
      const key = q.id + q.status; if (endShown !== key) { endShown = key; hide(q.status === 'paused' || q.status === 'stopping' ? 0 : 4500); }
    } else if (wrap?.classList.contains('on') && (!q || q.id === hiddenRun)) hide();
  }
  setInterval(() => { try { tick(); } catch {} }, 250);
  return { parts };
})();
const routeAlert = (() => {
  // Pops a notice whenever a conversation's response model changes (e.g. routed to another model).
  const KEY = 'amp.native.resp.v1';
  let last = new Map(); try { last = new Map(Object.entries(JSON.parse(localStorage.getItem(KEY)) || {}).slice(-300)); } catch {}
  let host = null, box = null;
  function ensure() {
    if (host?.isConnected) return; if (!document.body) return;
    host = document.createElement('div'); host.id = 'amp-route-alert'; host.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>:host{all:initial}.stack{display:flex;flex-direction:column;gap:8px;align-items:center;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif}'
      + '.card{pointer-events:auto;min-width:280px;max-width:min(520px,92vw);background:#fff;color:#1f2430;border:1px solid #e2e6ed;border-left:4px solid var(--amp-acc,#2f6fed);border-radius:12px;box-shadow:0 8px 28px #0000002a;padding:10px 12px;display:grid;grid-template-columns:1fr auto;gap:2px 10px;animation:in .22s ease-out}'
      + '.lg{display:inline-flex;vertical-align:-2px;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#fff;color:#111;box-shadow:0 0 0 1px #0000001a;margin-right:5px;font-style:normal}.lg svg{width:11px;height:11px;fill:currentColor}.card.gold{border-left-color:#c9950c}.card.drop{border-left-color:#e38a1e}h4{margin:0;font-size:12px;font-weight:700;color:var(--amp-acc,#2f6fed)}.gold h4{color:#a87b06}.drop h4{color:#c26d0a}.m{grid-column:1;font-weight:600;word-break:break-all}.m b{color:var(--amp-acc,#2f6fed)}.m s{opacity:.6}.t{grid-column:1;font-size:11px;color:#6b7383;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + 'button{grid-column:2;grid-row:1/4;align-self:start;border:0;background:transparent;font-size:16px;line-height:1;color:#8a93a3;cursor:pointer;padding:2px 4px;border-radius:6px}button:hover{background:#f0f2f6}@keyframes in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}'
      + '@media (prefers-color-scheme:dark){.card{background:#2c2b28;color:#ecebe7;border-color:#3f3d39}.t{color:#a9a59d}button:hover{background:#363531}}.card{border-left-color:var(--amp-acc,#2f6fed)}h4{color:var(--amp-acc,#2f6fed)}.m b{color:var(--amp-acc,#2f6fed)}</style><div class="stack"></div>';
    box = root.querySelector('.stack'); document.body.append(host);
  }
  function show(title, from, to, sub, kind = '') {
    ensure(); if (!box) return;
    const c = document.createElement('div'); c.className = 'card ' + kind; c.setAttribute('role', 'alert');
    const h = document.createElement('h4'); h.textContent = title;
    const m = document.createElement('div'); m.className = 'm';
    // 有厂商 logo 时名字不带厂商前缀；前后厂商不同时各自带 logo
    const ico = n => { const v = brand.of(n); if (!v) return null; const i = document.createElement('i'); i.className = 'lg'; try { i.innerHTML = gachaUi.vendorIcon(v, 12); } catch {} return i; };
    const nm = n => brand.of(n) ? brand.short(n) : noVertex(String(n || ''));
    if (from) { const s = document.createElement('s'); const fi = ico(from); if (fi) m.append(fi); s.textContent = nm(from); m.append(s, ' → '); }
    const b = document.createElement('b'); const ti = ico(to); if (ti) m.append(ti); b.textContent = nm(to); m.append(b);
    const t = document.createElement('div'); t.className = 't'; t.textContent = String(sub || '').replace(/(#\d+\s*·\s*)(.+)$/, (_, a, x) => a + nm(x));
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', '关闭'); x.onclick = () => c.remove();
    c.append(h, x, m, t); box.prepend(c); while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => c.remove(), 8000);
  }
  function note(sid, model, sub, quiet) {
    if (!sid || !model) return;
    const old = last.get(sid);
    if (old === model) return;
    // 同一模型只是名字更精确（加了档位、-vertex、5-5→5.5）：静默更新记录，不弹提醒
    const refine = old && brand.same(old, model);
    last.delete(sid); last.set(sid, model); while (last.size > 300) last.delete(last.keys().next().value);
    ampStore.set(KEY, JSON.stringify(Object.fromEntries(last)));
    if (old && !quiet && !refine) show('模型变更提醒', old, model, sub, '');
  }
  return { note, show };
})();

// ====================================================================================
// Native slot-machine button + popover. Modeled on Arena-Web-Manager gacha-page-ui.ts:
// a 32×32 button before Send/Stop (108px with progress while running), a 256px ShadowRoot
// popover with the exact AWM popover CSS, pill slider 5/10/15/20/30 and html.dark theme.
// ====================================================================================
const gachaUi = (() => {
  const CSS = "/* Mirrored in apps/api/src/gacha-popover-style.ts for the isolated native ShadowRoot.\n   tests/gacha-panel.test.mjs verifies exact parity. */\n.gachaPopover {\n  --gp-bg:#fff; --gp-fg:#242936; --gp-muted:#626d7f; --gp-line:#e2e6ed;\n  --gp-hover:#f0f2f6; --gp-field:#f8f9fb; --gp-track:#e2e6ed;\n  --gp-accent:#1c1c1e; --gp-accent-fg:#fff; --gp-accent-hover:#3a3a3c; --gp-danger:#ba3445; --gp-shadow:0 4px 18px #00000012,0 1px 3px #0000000b;\n  box-sizing:border-box; width:256px; max-width:calc(100vw - 24px); padding:10px;\n  border:1px solid var(--gp-line); border-radius:16px; background:var(--gp-bg); color:var(--gp-fg);\n  box-shadow:var(--gp-shadow); font:400 13px/1.45 -apple-system,BlinkMacSystemFont,\"Segoe UI\",system-ui,sans-serif;\n  color-scheme:light; text-align:left; -webkit-font-smoothing:antialiased;\n}\n.gachaPopover[data-theme=\"dark\"] {\n  --gp-bg:#23262c; --gp-fg:#eceef4; --gp-muted:#a4adbf; --gp-line:#3a404c;\n  --gp-hover:#2d3139; --gp-field:#1c1f25; --gp-track:#3a404c;\n  --gp-accent:#dcdcdc; --gp-accent-fg:#1c1c1e; --gp-accent-hover:#c6c6c6;\n  --gp-danger:#ff9da8; --gp-shadow:0 5px 24px #0003,0 1px 3px #0002; color-scheme:dark;\n}\n.gachaPopover *, .gachaPopover *::before, .gachaPopover *::after { box-sizing:border-box; }\n.gachaPopover [hidden] { display:none!important; }\n.gachaPopover button { appearance:none; display:inline-flex; align-items:center; justify-content:center; gap:5px; min-height:0; margin:0; border:0; padding:0; background:transparent; color:inherit; font:inherit; cursor:pointer; box-shadow:none; letter-spacing:normal; }\n.gachaPopover button:hover { background:var(--gp-hover); }\n.gachaPopover button:disabled { opacity:.45; cursor:not-allowed; }\n.gachaPopover :is(button,input,textarea,select):focus-visible { outline:2px solid var(--gp-accent); outline-offset:3px; }\n.gachaPopover .gpHeader { display:flex; gap:4px; align-items:center; }\n.gachaPopover .gpIcon { width:28px; height:28px; flex:0 0 28px; border-radius:7px; color:var(--gp-muted); }\n.gachaPopover .gpIcon svg { width:16px; height:16px; }\n.gachaPopover .gpTextIcon { font-family:Georgia,serif; font-size:15px; }\n.gachaPopover .gpClose { font-size:18px; width:22px; flex-basis:22px; }\n.gachaPopover .gpChosen { flex:1; min-width:0; display:flex; flex-direction:column; gap:0; padding:3px 4px; border-radius:8px; }\n.gachaPopover .gpChosen small { color:var(--gp-muted); font-size:10px; line-height:15px; font-weight:400; }\n.gachaPopover .gpChosen span { display:block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:600; }\n.gachaPopover .gpQuantity { margin:9px 0 8px; }\n.gachaPopover .gpRange { position:relative; height:26px; border-radius:20px; background:linear-gradient(to right,var(--gp-accent) 0%,var(--gp-accent) var(--gp-fill,75%),var(--gp-track) var(--gp-fill,75%),var(--gp-track) 100%); }\n.gachaPopover .gpDots { position:absolute; inset:0 12px; display:flex; align-items:center; justify-content:space-between; pointer-events:none; }\n.gachaPopover .gpDots i { width:4px; height:4px; border-radius:50%; background:var(--gp-muted); opacity:.6; }\n.gachaPopover .gpRange input { appearance:none; -webkit-appearance:none; display:block; position:absolute; inset:0; width:100%; height:26px; margin:0; padding:0; border:0; background:transparent; cursor:pointer; box-shadow:none; }\n.gachaPopover .gpRange input::-webkit-slider-runnable-track { height:26px; background:transparent; border:0; }\n.gachaPopover .gpRange input::-webkit-slider-thumb { appearance:none; -webkit-appearance:none; width:26px; height:26px; border-radius:50%; background:#fff; border:1px solid #00000008; box-shadow:0 1px 4px #0002; }\n.gachaPopover .gpRange input::-moz-range-track { background:transparent; height:26px; border:0; }\n.gachaPopover[data-theme=\"dark\"] .gpRange input::-webkit-slider-thumb { border-color:#0000002e; }\n.gachaPopover[data-theme=\"dark\"] .gpRange input::-moz-range-thumb { border:1px solid #0000002e; }\n.gachaPopover .gpRange input::-moz-range-thumb { width:25px; height:25px; border-radius:50%; border:0; background:#fff; box-shadow:0 1px 4px #0002; }\n.gachaPopover .gpTicks { display:flex; justify-content:space-between; margin:5px 4px 0; }\n.gachaPopover .gpTicks button { width:20px; height:18px; border-radius:4px; font-size:10px; color:var(--gp-muted); font-variant-numeric:tabular-nums; }\n.gachaPopover .gpTicks button[aria-pressed=\"true\"] { color:var(--gp-fg); font-weight:600; }\n.gachaPopover .gpFooter { display:flex; align-items:center; justify-content:space-between; gap:8px; }\n.gachaPopover .gpProgress { font-size:11px; color:var(--gp-muted); font-variant-numeric:tabular-nums; }\n.gachaPopover .gpPrimary { background:var(--gp-accent); color:var(--gp-accent-fg); padding:6px 12px; min-height:30px; border-radius:9px; font-size:12px; font-weight:500; white-space:nowrap; }\n.gachaPopover .gpPrimary:hover { background:var(--gp-accent-hover); }\n.gachaPopover .gpSecondary { border:1px solid var(--gp-line); border-radius:8px; padding:6px 10px; font-size:12px; }\n.gachaPopover .gpStatus { display:flex; align-items:center; gap:6px; margin-top:8px; font-size:11px; color:var(--gp-muted); min-width:0; }\n.gachaPopover .gpStatus::before { content:\"\"; width:5px; height:5px; flex:0 0 5px; border-radius:50%; background:currentColor; opacity:.55; }\n.gachaPopover .gpStatus span:last-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\n.gachaPopover .gpMenu { margin:8px -5px 2px; padding:4px; border-radius:10px; background:var(--gp-bg); max-height:240px; overflow-y:auto; overscroll-behavior:contain; }\n.gachaPopover .gpCaption { color:var(--gp-muted); margin:0 6px 5px; font-size:11px; }\n.gachaPopover .gpOption { display:flex; width:100%; min-height:34px; padding:7px 9px; justify-content:space-between; border-radius:8px; font-size:12px; }\n.gachaPopover .gpOption span:first-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\n.gachaPopover .gpOption[aria-checked=\"true\"] { background:var(--gp-hover); }\n.gachaPopover .gpSettings { margin-top:10px; padding-top:10px; border-top:1px solid var(--gp-line); }\n.gachaPopover label { display:grid; gap:5px; margin:0 0 10px; color:var(--gp-muted); font-size:11px; min-width:0; }\n.gachaPopover :is(textarea,input:not([type=\"range\"]):not([type=\"checkbox\"]),select) { display:block; width:100%; min-width:0; border:1px solid var(--gp-line); border-radius:8px; padding:7px 8px; background:var(--gp-field); color:var(--gp-fg); font:400 12px/1.5 -apple-system,BlinkMacSystemFont,\"Segoe UI\",system-ui,sans-serif; box-shadow:none; }\n.gachaPopover textarea { min-height:64px; resize:vertical; }\n.gachaPopover .gpModelsInput { min-height:112px; }\n.gachaPopover .gpRow { display:grid; grid-template-columns:1fr 1fr; gap:8px; }\n.gachaPopover .gpCheck { display:flex; align-items:center; gap:7px; font-size:11px; }\n.gachaPopover .gpCheck input { width:13px; height:13px; margin:0; accent-color:var(--amp-acc,#2f6fed); }\n.gachaPopover .gpHelp { font-size:11px; color:var(--gp-muted); margin:0 0 10px; line-height:1.55; }\n.gachaPopover .gpSaveRow { display:flex; justify-content:flex-end; }\n.gachaPopover .gpMessage { margin:8px 0 0; color:var(--gp-muted); font-size:11px; line-height:1.5; overflow-wrap:anywhere; }\n.gachaPopover .gpMessage[data-error=\"true\"] { color:var(--gp-danger); }\n.gachaPopover.gpModelNotice { width:300px; padding:14px; }\n.gachaPopover .gpNoticeHead { display:flex; align-items:center; justify-content:space-between; font-size:12px; font-weight:600; }\n.gachaPopover .gpModelTransition { margin:9px 0 6px; font-size:13px; font-weight:500; overflow-wrap:anywhere; }\n.gachaPopover .gpNoticeReason { margin:0; color:var(--gp-muted); font-size:11px; line-height:1.6; }\n@media(prefers-reduced-motion:no-preference) { .gachaPopover .gpRange { transition:background .12s; } }\n@media (pointer:coarse) {\n  .gachaPopover .gpIcon { width:32px; height:32px; flex-basis:32px; }\n  .gachaPopover .gpPrimary,.gachaPopover .gpSecondary { min-height:36px; }\n  .gachaPopover .gpOption { min-height:40px; }\n  .gachaPopover .gpTicks button { height:24px; width:28px; }\n}\n";
  const slotIcon = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="4" width="14" height="16" rx="3"/><rect x="7" y="8" width="8" height="5" rx="1"/><path d="M8 17h6m4-9h2v4"/><circle cx="20" cy="14" r="1"/></svg>';
  const gear = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m9 3-.6 2.3-2 .9-2.1-.6-2 3.4 1.6 1.7v2.6l-1.6 1.7 2 3.4 2.2-.6 1.9.9L9 21h4l.6-2.3 2-.9 2.1.6 2-3.4-1.6-1.7v-2.6L19.7 9l-2-3.4-2.2.6-1.9-.9L13 3Z"/><circle cx="11" cy="12" r="3"/></svg>';
  const Q = gacha.QUANTITIES;
  const chevron = '<svg data-amp-chev width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  // ---------------- live Arena Agent leaderboard (strength ranking) ----------------
  // Read same-origin from /leaderboard/agent (public page), cached 6h; the snapshot below is only a fallback.
  const ranking = (() => {
    const KEY = 'amp.native.rank.v1', TTL = 6 * 3600000, FALLBACK = ["Claude Fable 5.1 (Max)", "GPT 6 Astra (Max)", "Claude Opus 5 (High)", "Claude Opus 5 (Max)", "Claude Fable 5 (High)", "Claude Opus 4.8 (High)", "GPT 5.6 Sol (xHigh)", "Kimi K3 (Max)", "Claude Sonnet 5 (High)", "GPT 5.5 (xHigh)", "Hy4 preview", "Deepseek V4.1 Flash (Max)", "Gemini 3.8 Flash (High)", "GLM 5.2 (Max)", "Muse Spark 1.3 (Max)", "DeepSeek V4 Pro (High)", "Qwen3.8 Max", "GLM 5.3 (Max)", "Grok 4.5", "GPT 5.5", "Grok 4.6 (xHigh)", "Deepseek V4 Flash (High)", "GPT 5.6 Terra (xHigh)", "GPT 5.4 (High)", "GLM 5.3 Flash", "Qwen3.8 Flash Next", "GPT 5.6 Luna (xHigh)", "Gemini 3.7 Flash (High)", "Qwen 3.8 27B", "DeepSeek V4 Pro", "Claude Sonnet 4.6", "Muse Spark 1.2 (xHigh)", "Muse Spark 1.1", "Qwen3.7 Max", "Hy3", "Mimo V2.5 Pro", "Minimax M3", "Gemini 3.1 Pro Preview", "Gemini 3.6 Flash (High)", "Qwen3.7 Plus", "Inkling Small", "Inkling", "Mistral Medium 3.5", "Minimax M2.7", "Gemini 3.5 Flash Lite", "Solar Pro 4"];
    const TIER = /^(none|minimal|low|medium|high|xhigh|max)$/;
    const toks = v => String(v || '').toLowerCase().replace(/(\d)([a-z])/g, '$1-$2').replace(/([a-z])(\d)/g, '$1-$2').split(/[^a-z0-9]+/).filter(Boolean);
    let list = null, at = 0, loading = false, rev = 0;
    const build = names => names.map((n, i) => { const t = toks(n.replace(/\((\d{4,})\)/g, '')), tier = t.filter(x => TIER.test(x)); return { rank: i + 1, name: n, base: t.filter(x => !TIER.test(x)), tier: tier[0] || '' }; }).filter(e => e.base.length);
    try { const c = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(c?.names) && c.names.length > 5) { list = build(c.names); at = c.at || 0; } } catch {}
    if (!list) list = build(FALLBACK);
    function parse(html) {
      const doc = new DOMParser().parseFromString(html, 'text/html'), out = [];
      for (const tr of doc.querySelectorAll('table tbody tr')) {
        const cells = tr.querySelectorAll('td'); if (cells.length < 3) continue;
        const cell = [...cells].slice(0, 3).find(c => c.querySelector('a[href^="http"]') || /·/.test(c.textContent || ''));
        if (!cell) continue;
        const link = cell.querySelector('a'); let name = (link?.textContent || '').trim();
        if (!name) name = [...cell.querySelectorAll('*')].filter(e => !e.children.length).map(e => (e.textContent || '').trim()).find(t => t && !t.includes('·')) || '';
        if (name && name.length < 80) out.push(name);
      }
      return out;
    }
    async function refresh(force = false) {
      if (loading || (!force && Date.now() - at < TTL)) return; loading = true;
      try {
        const res = await fetch('/leaderboard/agent', { credentials: 'same-origin', cache: 'no-store' });
        if (res.ok) { const names = parse(await res.text()); if (names.length > 5) { list = build(names); at = Date.now(); rev++; ampStore.set(KEY, JSON.stringify({ names, at })); } }
      } catch {} finally { loading = false; }
    }
    const find = (hay, needle) => { for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((x, j) => hay[i + j] === x)) return true; return false; };
    // Lower is stronger. Exact family match = rank (tier match preferred); unknown sibling (same first 2 tokens) = 100 + rank; unranked = 1000.
    function score(title) {
      const t = toks(String(title || '').replace(/^#\d+\s*/, '').replace(/\s*·\s*\d+\s*$/, ''));
      let best = null;
      for (const e of list) if (find(t, e.base)) { const tierOk = e.tier && t.includes(e.tier); const sc = e.rank - (tierOk ? 0.5 : 0) - e.base.length * 0.001; if (!best || e.base.length > best.len || (e.base.length === best.len && sc < best.sc)) best = { sc, len: e.base.length }; }
      if (best) return best.sc;
      const fam = list.find(e => e.base.length >= 2 && find(t, e.base.slice(0, 2)));
      return fam ? 100 + fam.rank : 1000;
    }
    // 档位强弱：max > xhigh > high > medium > low > minimal > 无后缀
    const TIER_RANK = { max: 6, xhigh: 5, high: 4, medium: 3, low: 2, minimal: 1, none: 0 };
    function tier(title) { const t = toks(String(title || '').replace(/\s*·\s*\d+\s*$/, '')); let b = 0; for (const x of t) if (TIER_RANK[x] > b) b = TIER_RANK[x]; return b; }
    // 系列强弱：去掉档位词后按排行榜比较（同系列不同档位得到相同的值）
    function family(title) { return score(toks(String(title || '').replace(/^#\d+\s*/, '').replace(/\s*·\s*\d+\s*$/, '')).filter(x => !TIER.test(x)).join('-')); }
    return { score, tier, family, refresh, get rev() { return rev; }, get at() { return at; }, get size() { return list.length; } };
  })();
  // ---------------- sidebar: highlight the chosen vendor, sort by live strength ----------------
  // Non-destructive: only CSS `order` on each list item and a data attribute. React-owned nodes are never moved.
  const sidebar = (() => {
    let stamp = '', touched = new Set(), lastRows = [], flatP = null, flatM = null, flatSet = new Set();
    function unflat() {
      for (const el of flatSet) { el.style.removeProperty('order'); el.style.removeProperty('margin-left'); el.style.removeProperty('margin-right'); el.style.removeProperty('margin-top'); }
      flatSet = new Set(); document.querySelectorAll('[data-amp-flat]').forEach(n => n.removeAttribute('data-amp-flat')); document.querySelectorAll('[data-amp-flatp]').forEach(n => n.removeAttribute('data-amp-flatp')); flatP = null; flatM = null;
    }
    try { const st = document.createElement('style'); st.textContent = '[data-amp-flat]{display:contents!important}[data-amp-flatp]{display:flex!important;flex-direction:column!important;row-gap:0!important;gap:0!important}'; (document.head || document.documentElement).append(st); } catch {}
    const titleOf = a => { const sp = a.querySelector('[data-amp-local-title]'); if (sp) return sp.getAttribute('data-amp-local-title');
      const tt = a.querySelector('span.truncate,div.truncate'); if (tt && !tt.querySelector('svg,button,[data-amp-vlogo],.sr-only')) return (tt.textContent || '').trim();
      let out = ''; const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement?.closest('[data-amp-vlogo],svg,button,.sr-only') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      while (w.nextNode()) out += w.currentNode.nodeValue; return out.trim(); };
    const clear = el => { el.style.removeProperty('order'); el.style?.removeProperty?.('--amp-tint'); el.removeAttribute('data-amp-target-hit'); el.removeAttribute('data-amp-vip'); el.removeAttribute('data-amp-brand'); unlogo(el); };
    const unlogo = a => { a.querySelectorAll?.('[data-amp-vlogo]').forEach(n => n.remove()); a.querySelectorAll?.('[data-amp-logo-hidden]').forEach(n => n.removeAttribute('data-amp-logo-hidden')); a.removeAttribute?.('data-amp-logo'); };
    // Replace the round native icon at the left of a pinned card with the vendor logo (titles cannot carry logos).
    function logo(a, vid) {
      if (!vid) { if (a.hasAttribute('data-amp-logo')) unlogo(a); return; }
      const holders = [...a.querySelectorAll('[data-amp-vlogo]')]; holders.slice(1).forEach(n => n.remove());
      let holder = holders[0] || null;
      if (holder && holder.getAttribute('data-amp-vlogo') !== vid) { holder.setAttribute('data-amp-vlogo', vid); holder.toggleAttribute('data-full', !!BADGE[vid]); holder.innerHTML = vendorIcon(vid, 12); }
      const title = a.querySelector('span.truncate,div.truncate,[data-amp-local-title]');
      // Hide every native icon before the title that is not hidden yet (React may re-render a fresh one).
      const icons = [...a.querySelectorAll('svg,img')].filter(n => !n.closest('button,[data-amp-vlogo],[data-amp-logo-hidden]') && !(title && title.contains(n)) && (!title || (n.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING)));
      const boxes = icons.map(icon => { let box = icon; while (box.parentElement && box.parentElement !== a && box.parentElement.children.length === 1 && !box.parentElement.contains(title)) box = box.parentElement; box.setAttribute('data-amp-logo-hidden', ''); return box; });
      if (!holder) {
        holder = document.createElement('span'); holder.setAttribute('data-amp-vlogo', vid); if (BADGE[vid]) holder.setAttribute('data-full', ''); holder.innerHTML = vendorIcon(vid, 12);
        if (a.hasAttribute('data-amp-logo-seen')) holder.setAttribute('data-noanim', ''); // 只有第一次出现时做入场动画
        const hidden = a.querySelector('[data-amp-logo-hidden]');
        if (boxes.length) boxes[0].before(holder); else if (hidden) hidden.before(holder); else if (title) title.before(holder); else a.prepend(holder);
      }
      a.setAttribute('data-amp-logo', vid); a.setAttribute('data-amp-logo-seen', '');
    }
    function sync(keywords) {
      const sortOn = gacha.settings().sortSidebar;
      if (sortOn) void ranking.refresh();
      const kw = (keywords || []).map(k => k.toLowerCase());
      const links = [...document.querySelectorAll('a[href^="/agent/"]')].filter(a => a.closest('aside,nav,[data-sidebar]') && /^\/agent\/[0-9a-f-]{8,}/i.test(a.getAttribute('href')));
      progress.mark(links);
      const key = sortOn + '|' + kw.join(',') + '|' + ranking.rev + '|' + vip.rev + '|' + brand.hint.rev() + '|' + links.map(a => a.getAttribute('href') + '=' + titleOf(a)).join(',');
      if (key === stamp) { for (const r of lastRows) { if (!r.a.isConnected) continue; const n = r.a.getElementsByTagName('svg').length + r.a.getElementsByTagName('img').length; if (n === r.ic && (!r.vid || r.a.querySelector('[data-amp-vlogo]'))) continue; logo(r.a, r.vid); r.ic = r.a.getElementsByTagName('svg').length + r.a.getElementsByTagName('img').length; } return; } stamp = key; lastRows = [];
      const groups = new Map();
      for (const a of links) {
        const item = a.closest('li') || a, list = item.parentElement; if (!list) continue; if (!groups.has(list)) groups.set(list, []);
        const title = titleOf(a).toLowerCase(), sid = (a.getAttribute('href').match(/[0-9a-f-]{36}/i) || [''])[0];
        // 金色传说置顶：命中目标厂商且档位为 max / xhigh / high（取代以前 dxzui / clzui 的金色置顶）
        const hitNow = sortOn && kw.length > 0 && kw.some(k => title.includes(k)), isVip = hitNow && /(^|[-\s·(])(max|xhigh|high)(?=$|[-\s·)])/i.test(title);
        groups.get(list).push({ a, item, vip: isVip, hit: hitNow, sc: sortOn ? ranking.score(title) : 0, fam: sortOn ? ranking.family(title) : 0, tier: sortOn ? ranking.tier(title) : 0, ver: brand.version(title), vid: brand.forSid(sid, title) || brand.of(vip.get(sid)) });
      }
      const next = new Set();
      // 金色只给同厂商里版本号最高的那一代（有 5.5 时 5 的 high/max 不再是金色；gpt 有 6 时 5.6 不是金色）
      { const topVer = new Map(); for (const rows of groups.values()) for (const r of rows) if (r.hit && r.ver != null) { const g = r.vid || ''; if (!(topVer.get(g) >= r.ver)) topVer.set(g, r.ver); }
        for (const rows of groups.values()) for (const r of rows) if (r.vip && !(r.ver != null && r.ver === topVer.get(r.vid || ''))) r.vip = false; }
      // 选了目标模型（或有 VIP）时：把所有日期分组（Today / Yesterday / Older）里命中的卡片统一置顶。
      // 仍然不移动 React 节点：把分组容器设为 display:contents，所有卡片成为同一个 flex 容器的子项，再用 order 排。
      const lists = [...groups.keys()], anyPin = [...groups.values()].some(rows => rows.some(r => r.vip || r.hit));
      let P = null;
      if (lists.length > 1 && anyPin) { P = lists[0].parentElement; while (P && !lists.every(l => P.contains(l))) P = P.parentElement; if (P && !P.closest('aside,nav,[data-sidebar]')) P = null; }
      if (P !== flatP) unflat();
      if (P) {
        flatP = P;
        if (!P.hasAttribute('data-amp-flatp')) {
          // 进入平铺前量一下原来的缩进/间距，平铺后补回去，看起来和分组时一样
          const pr = P.getBoundingClientRect(), cs = getComputedStyle(P), pl = pr.left + parseFloat(cs.paddingLeft || 0) + parseFloat(cs.borderLeftWidth || 0), prr = pr.right - parseFloat(cs.paddingRight || 0) - parseFloat(cs.borderRightWidth || 0);
          const li0 = groups.get(lists[0])[0]?.item, li1 = groups.get(lists[0])[1]?.item, r0 = li0?.getBoundingClientRect(), r1 = li1?.getBoundingClientRect();
          flatM = { l: r0 ? Math.max(0, r0.left - pl) : 0, r: r0 ? Math.max(0, prr - r0.right) : 0, gap: r0 && r1 ? Math.max(0, Math.min(12, r1.top - r0.bottom)) : 0, lab: null };
          for (const l of lists) { let n = l; while (n && n !== P) { n.setAttribute('data-amp-flat', ''); n = n.parentElement; } }
          P.setAttribute('data-amp-flatp', '');
        } else for (const l of lists) { let n = l; while (n && n !== P) { if (!n.hasAttribute('data-amp-flat')) n.setAttribute('data-amp-flat', ''); n = n.parentElement; } }
        const setO = (el, o, kind) => { el.style.order = String(o); if (kind === 'li') { el.style.marginLeft = flatM.l + 'px'; el.style.marginRight = flatM.r + 'px'; el.style.marginTop = flatM.gap + 'px'; } else if (kind === 'lab') { el.style.marginLeft = flatM.l + 'px'; el.style.marginRight = flatM.r + 'px'; el.style.marginTop = '10px'; } flatSet.add(el); };
        const all = [...groups.values()].flat(); all.forEach((r, i) => r.i = i);
        const best = new Map(); for (const r of all) { const g = r.vid || '~' + r.i; best.set(g, Math.min(best.get(g) ?? Infinity, r.sc)); }
        for (const r of all) { r.g = r.vid || '~' + r.i; r.gs = best.get(r.g); }
        const cmp = (x, y) => (y.vip - x.vip) || (y.hit - x.hit) || (sortOn ? (x.gs - y.gs) || (x.g < y.g ? -1 : x.g > y.g ? 1 : 0) || ((y.ver ?? -1) - (x.ver ?? -1)) || (x.fam - y.fam) || (y.tier - x.tier) || (x.sc - y.sc) : 0) || (x.i - y.i);
        let seg = 0, firstBase = null;
        for (const c of P.children) {
          const base = 100000 + (seg++) * 10000, L = lists.filter(l => c === l || c.contains(l));
          if (!L.length) { setO(c, base); continue; }
          if (firstBase === null) firstBase = base;
          for (const l of L) { let n = l; while (n !== c) { for (const sib of n.parentElement.children) if (sib !== n && !lists.some(x => sib === x || sib.contains(x))) setO(sib, base, 'lab'); n = n.parentElement; } }
          for (const l of L) groups.get(l).filter(r => !(r.vip || r.hit)).sort(cmp).forEach((r, k) => setO(r.item, base + 1 + k, 'li'));
        }
        all.filter(r => r.vip || r.hit).sort(cmp).forEach((r, k) => setO(r.item, (firstBase ?? 100000) - 5000 + k, 'li'));
      }
      for (const [list, rows] of groups) {
        const sortable = !P && /flex|grid/.test(getComputedStyle(list).display);
        if (!P) rows.forEach((r, i) => r.i = i);
        const pinned = rows.some(r => r.vip) || sortOn;
        // 同厂商先比版本号（opus-5.5 > fable-5.1，未上榜的新版本也能排前），版本相同再按排行榜（fable/opus、档位）。
        // 比较器必须可传递，否则同一输入在不同轮次可能排出不同顺序 → 卡片来回交换（频闪）。
        const best = new Map(); for (const r of rows) { const g = r.vid || '~' + r.i; best.set(g, Math.min(best.get(g) ?? Infinity, r.sc)); }
        if (!P) for (const r of rows) { r.g = r.vid || '~' + r.i; r.gs = best.get(r.g); }
        const sorted = rows.slice().sort((x, y) => (y.vip - x.vip) || (y.hit - x.hit) || (sortOn ? (x.gs - y.gs) || (x.g < y.g ? -1 : x.g > y.g ? 1 : 0) || ((y.ver ?? -1) - (x.ver ?? -1)) || (x.fam - y.fam) || (y.tier - x.tier) || (x.sc - y.sc) : 0) || (x.i - y.i));
        // Strength shading: the strongest pinned card gets 50% of the selected card's colour depth, the rest fade evenly.
        const hits = sorted.filter(r => r.hit && !r.vip), vips = sorted.filter(r => r.vip);
        const tint = (arr, r) => { const n = arr.length, k = arr.indexOf(r); return k < 0 ? '' : (50 * (n - k) / n).toFixed(1) + '%'; };
        sorted.forEach((r, rank) => {
          if (P) {} else if (sortable && pinned) r.item.style.order = String(rank); else r.item.style.removeProperty('order');
          const tv = r.vip ? tint(vips, r) : r.hit ? tint(hits, r) : ''; if (tv) r.a.style.setProperty('--amp-tint', tv); else r.a.style.removeProperty('--amp-tint');
          r.a.toggleAttribute('data-amp-target-hit', r.hit && !r.vip); r.a.toggleAttribute('data-amp-vip', r.vip);
          // Every conversation whose vendor is known (title keyword or local cache) shows that vendor's logo.
          logo(r.a, r.vid); if (r.vid) r.a.setAttribute('data-amp-brand', r.vid); else r.a.removeAttribute('data-amp-brand');
          next.add(r.item); next.add(r.a); lastRows.push(r);
        });
      }
      for (const el of touched) if (!next.has(el) && el.isConnected) clear(el);
      touched = next;
    }
    // 旧对话后台逐页加载：把侧栏底部的“加载更多”转圈临时贴在可视区底部（sticky），触发 Arena 自己的无限滚动拉下一页；
    // 每页加载完先取消，隔一会儿再贴，逐页慢慢拉，不滚动、不抢焦点，不影响其他操作。
    const older = { at: 0, n: 0, pages: 0, el: null };
    function olderStep() {
      if (!document.getElementById('amp-older-css') && document.head) { const st = document.createElement('style'); st.id = 'amp-older-css'; st.textContent = '[data-amp-older]{position:sticky!important;bottom:0!important;z-index:2;opacity:.5;pointer-events:none}[data-amp-flat]{display:contents!important}[data-amp-flatp]{display:flex!important;flex-direction:column!important;row-gap:0!important;gap:0!important}'; document.head.append(st); }
      const sortOn = (() => { try { return gacha.settings().sortSidebar; } catch { return false; } })();
      const sp = [...document.querySelectorAll('aside svg.animate-spin,nav svg.animate-spin,[data-sidebar] svg.animate-spin')].map(v => v.parentElement).find(d => d && d.classList.contains('justify-center') && d.classList.contains('pb-4'));
      if (older.el && older.el !== sp) { older.el.removeAttribute('data-amp-older'); older.el = null; }
      if (!sp || !sortOn || document.hidden || older.pages >= 60) return;
      const n = document.querySelectorAll('aside a[href^="/agent/"],nav a[href^="/agent/"],[data-sidebar] a[href^="/agent/"]').length;
      if (sp.hasAttribute('data-amp-older')) {
        // 新的一页到了（或等太久）就先放开，下一轮再贴
        if (n > older.n || Date.now() - older.at > 8000) { sp.removeAttribute('data-amp-older'); older.el = null; if (n > older.n) older.pages++; older.at = Date.now(); }
        return;
      }
      if (Date.now() - older.at < 1200) return;
      sp.setAttribute('data-amp-older', ''); older.el = sp; older.n = n; older.at = Date.now();
    }
    setInterval(() => { try { olderStep(); } catch {} }, 700);
    return { sync, reset: () => { unflat(); for (const el of touched) if (el.isConnected) clear(el); touched = new Set(); stamp = ''; lastRows = []; } };
  })();
  const ICON_PATH = {"openai": "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z", "anthropic": "M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z", "google": "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81", "xai": "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"};
  // Vendors outside the five targets get a coloured monogram badge (logo only; not selectable as a target).
  const BADGE = { deepseek: ['#4d6bfe', 'D'], qwen: ['#615ced', 'Q'], zhipu: ['#3859ff', 'Z'], xiaomi: ['#ff6900', 'Mi'], bytedance: ['#1e6fff', '豆'], minimax: ['#e73562', 'M'], mistral: ['#fa520f', 'M'], meta: ['#0467df', '∞'] };
  const badge = (id, size) => { const [bg, t] = BADGE[id]; return '<svg class="gpVIcon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="' + bg + '"/><text x="12" y="12" dy=".36em" text-anchor="middle" font-size="' + (t.length > 1 ? 10 : 13) + '" font-weight="700" font-family="system-ui,-apple-system,Segoe UI,sans-serif" fill="#fff">' + t + '</text></svg>'; };
  const vendorIcon = (id, size = 14) => BADGE[id] ? badge(id, size) : ICON_PATH[id] ? '<svg class="gpVIcon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + ICON_PATH[id] + '"/></svg>'
    : id === 'moonshot' ? '<svg class="gpVIcon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 3h3.6v7.6L14.2 3h4.5l-7.1 7.9L19.4 21h-4.6l-5.8-7.6-1.4 1.5V21H4z"/><circle cx="20.5" cy="3.5" r="1.8" fill="#2f6fed"/></svg>'
    : '<svg class="gpVIcon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M8 12h8"/></svg>';
  let mounted = false;
  function mount() {
    if (mounted || !document.body || location.hostname !== 'arena.ai') return; mounted = true;
    const host = document.createElement('div'); host.id = 'amp-native-gacha-host';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>:host{all:initial}' + CSS + '.panel{display:none;position:fixed;pointer-events:auto;max-height:calc(100dvh - 24px);overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain}.gachaPopover .choices,.gachaPopover .gpMenu{overflow:visible!important;overflow-x:visible!important;max-height:none!important}.panel.open{display:block}.launcher{display:none;position:fixed;pointer-events:auto;border:1px solid #8884;border-radius:8px;background:#fff;color:#333;height:32px;box-sizing:border-box;padding:0 8px;font:12px system-ui;align-items:center;justify-content:center;gap:5px;cursor:pointer}.launcher.show{display:inline-flex}.gpLog{margin:8px 0 0;max-height:132px;overflow:auto;font-size:11px;color:var(--gp-muted);line-height:1.5;border-top:1px solid var(--gp-line);padding-top:6px}.gpLog div{display:flex;gap:6px;white-space:nowrap}.gpLog time{flex:none;font-variant-numeric:tabular-nums;opacity:.8}.gpLog span{overflow:hidden;text-overflow:ellipsis}.gpLog [data-v=hit]{color:var(--gp-fg);font-weight:600}.gpLog [data-v=warn],.gpLog [data-v=error]{color:var(--gp-danger)}.gpOptRow{display:flex;align-items:center;gap:2px}.gpOptRow .gpOption{flex:1;min-width:0}.gpDel{width:26px;height:26px;flex:0 0 26px;border-radius:7px;color:var(--gp-muted);font-size:15px}.choices{max-height:320px!important}.gpAdd{display:flex;gap:6px;margin:6px 2px 2px}.gpAdd input{flex:1}.gpAdd .gpSecondary{flex:none}'
      // ---- compact v1.4 card: ~224px, one header row + one slider row; secondary panels collapsed by default ----
      + '.gachaPopover{width:224px;padding:8px;border-radius:14px}.gachaPopover .gpHeader{gap:2px}.gachaPopover .gpIcon{width:26px;height:26px;flex-basis:26px}'
      + '.gachaPopover .gpChosen{align-items:center;padding:2px 4px;line-height:1.2}.gachaPopover .gpChosen .gpCount{font-size:12px;font-weight:600;color:var(--amp-acc,#2f6fed);font-variant-numeric:tabular-nums;max-width:100%}.gachaPopover[data-theme=dark] .gpChosen .gpCount{color:var(--amp-acc-soft,#6ea0ff)}'
      + '.gachaPopover .gpChosen .gpName{font-size:12px;font-weight:500;color:var(--gp-fg)}.gachaPopover .gpQuantity{display:flex;align-items:center;gap:6px;margin:7px 0 0}.gachaPopover .gpRange{flex:1;height:24px}'
      + '.gachaPopover .gpRange{background:linear-gradient(to right,var(--amp-acc,#2f6fed) 0%,var(--amp-acc,#2f6fed) var(--gp-fill,75%),var(--gp-track) var(--gp-fill,75%),var(--gp-track) 100%)}.gachaPopover .gpRange input{height:24px}.gachaPopover .gpRange input::-webkit-slider-runnable-track{height:24px}'
      + '.gachaPopover .gpRange input::-webkit-slider-thumb{width:24px;height:24px}.gachaPopover .gpRange input::-moz-range-thumb{width:23px;height:23px}.gachaPopover .gpDots i{background:#fff;opacity:.55}'
      + '.gachaPopover .gpGo{flex:none;min-width:56px;height:24px;min-height:24px;padding:0 10px;border-radius:12px;font-size:11px;font-weight:700;letter-spacing:.06em}'
      + '.gachaPopover .gpGo[data-a=start]{background:#6a5e54;color:#fff}.gachaPopover .gpGo[data-a=start]:hover{background:#5b5048}.gachaPopover .gpGo[data-a=stop]{background:var(--gp-danger);color:#fff}.gachaPopover .gpStatus{margin-top:6px;gap:5px}.gachaPopover .gpStatus span:first-child{flex:none}.gachaPopover .gpStatus .gpReset{margin-left:auto;font-size:10px;color:var(--gp-muted);padding:0 4px;border-radius:5px}'
      + '.gachaPopover .gpIp{display:block;margin:7px 0 0;border:0;border-radius:8px;padding:6px 14px;background:#6a5e54;color:#fff;font:inherit;font-size:12px;font-weight:600;cursor:pointer}.gachaPopover .gpIp:hover{background:#5b5048}.gachaPopover .gpIp[disabled]{opacity:.6;cursor:wait}.gachaPopover .gpIp[hidden]{display:none}'
      + '.gachaPopover .gpMessage{margin:6px 0 0;font-size:11px;line-height:1.45;color:var(--gp-muted)}.gachaPopover .gpMessage[data-error=true]{color:var(--gp-danger)}.gachaPopover .gpSettings{margin-top:8px;padding-top:8px}.gachaPopover label{margin-bottom:8px}.gachaPopover textarea{min-height:52px}.gachaPopover .gpModelsInput{min-height:84px}'
      + '.gachaPopover .gpMenu{margin:6px -3px 0}.gachaPopover .gpOption{min-height:30px;padding:5px 8px;justify-content:flex-start;gap:8px}.gachaPopover .gpOption .gpMark{margin-left:auto;color:var(--amp-acc,#2f6fed)}.gachaPopover .gpName{display:inline-flex;align-items:center;gap:4px;max-width:100%;overflow:hidden}.gachaPopover .gpChosen span.gpName{display:inline-flex;align-items:center;justify-content:center;gap:4px}.gachaPopover .gpChosen .gpName span{display:inline-flex;align-items:center;max-width:none}'
      + '.gachaPopover .gpRow2{display:grid;grid-template-columns:1fr 72px;gap:6px}.gachaPopover .gpSaveRow{display:flex;justify-content:flex-end}.gachaPopover .gpSecondary{padding:4px 10px;font-size:11px}.gachaPopover .gpHead{font-size:12px;color:var(--gp-fg);margin-bottom:6px}.gachaPopover .gpModelsInput{min-height:72px;margin-bottom:6px}.gachaPopover .choices{display:grid;grid-template-columns:1fr 1fr;gap:4px}.gachaPopover .choices .gpOption{border:1px solid var(--gp-line);border-radius:9px;transition:background .15s,color .15s,border-color .15s}.gachaPopover .choices .gpOption[data-on=true]{background:var(--amp-acc,#2f6fed);border-color:var(--amp-acc,#2f6fed);color:var(--amp-acc-fg,#fff)}.gachaPopover .choices .gpOption[data-on=true]:hover{background:color-mix(in srgb,var(--amp-acc,#2f6fed) 86%,#000)}'
      + '.gachaPopover .gpCustom{display:flex;align-items:center;min-height:30px;border:1px solid var(--gp-line);border-radius:9px;overflow:hidden;background:var(--gp-field)}.gachaPopover .gpCustom[data-on=true]{border-color:var(--amp-acc,#2f6fed);background:var(--amp-acc,#2f6fed)}.gachaPopover .gpCustom input{flex:1;min-width:0;width:100%;height:28px;border:0;outline:0;background:transparent;padding:0 6px;font:inherit;font-size:12px;color:var(--gp-fg);box-shadow:none}.gachaPopover .gpCustom[data-on=true] input{color:var(--amp-acc-fg,#fff);font-weight:600}.gachaPopover .gpCustom input::placeholder{color:var(--gp-muted);font-weight:400}.gachaPopover .gpCustomGo{flex:none;width:24px;height:28px;font-size:12px;color:var(--gp-muted);border-radius:0}.gachaPopover .gpCustom[data-on=true] .gpCustomGo{color:var(--amp-acc-fg,#fff)}'
      + '.gachaPopover .gpChips{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 6px;max-height:132px;overflow:auto}.gachaPopover .gpChip{padding:1px 7px;min-height:20px;border:1px solid var(--gp-line);border-radius:10px;font-size:11px;line-height:17px;background:var(--gp-field);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gachaPopover .gpChip:hover,.gachaPopover .gpChip[data-pending=true]{border-color:var(--gp-danger);color:var(--gp-danger);background:transparent}.gachaPopover .gpChipEmpty{font-size:11px;color:var(--gp-muted)}'
      + '.gachaPopover .gpConfirm{display:flex;align-items:center;justify-content:space-between;gap:6px;margin:0 0 6px;padding:6px 8px;border:1px solid var(--gp-danger);border-radius:9px;font-size:11px}.gachaPopover .gpConfirm span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gachaPopover .gpConfirm div{display:flex;gap:4px;flex:none}.gachaPopover .gpDanger{background:var(--gp-danger)!important;color:#fff!important;border-color:var(--gp-danger)!important}'
      + '.gachaPopover .gpAddRow{display:flex;gap:4px;align-items:flex-end}.gachaPopover .gpModelsInput.gpAddInput{flex:1;min-height:28px!important;height:28px;margin:0!important;resize:none;overflow:hidden;scrollbar-width:none;padding:5px 7px;font-size:12px;line-height:16px}.gachaPopover .gpAddRow .gpSecondary{flex:none;height:28px}@media (max-width:480px){.gachaPopover{width:208px}}'
      + '@keyframes gpIn{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}.panel.open{animation:gpIn .2s cubic-bezier(.22,.9,.3,1);transform-origin:bottom right}'
      + '.gachaPopover .gpGo,.gachaPopover .choices .gpOption,.gachaPopover .gpChip,.gachaPopover .gpIcon,.gachaPopover .gpChosen,.launcher{transition:transform .5s cubic-bezier(.22,.9,.3,1),background .15s,color .15s,border-color .15s}'
      + '.gachaPopover .gpGo:not(:disabled):hover,.gachaPopover .choices .gpOption:not(:disabled):hover,.gachaPopover .gpChip:not(:disabled):hover,.gachaPopover .gpIcon:hover,.launcher:hover{transform:scale(1.07);transition:transform .28s cubic-bezier(.34,1.8,.5,1),background .15s,color .15s,border-color .15s}'
      + '.gachaPopover .gpGo:not(:disabled):active,.gachaPopover .choices .gpOption:not(:disabled):active,.gachaPopover .gpChip:not(:disabled):active,.gachaPopover .gpIcon:active{transform:scale(.94);transition-duration:.08s}'
      + '.gachaPopover .gpCustom{transition:border-color .15s,box-shadow .15s,background .15s}.gachaPopover .gpCustom:hover,.gachaPopover .gpCustom:focus-within{border-color:var(--amp-acc,#2f6fed);box-shadow:0 0 0 2px color-mix(in srgb,var(--amp-acc,#2f6fed) 22%,transparent)}.gachaPopover .gpCustom input{overflow:hidden}'
      + '.gachaPopover .gpChip{animation:gpIn .22s ease-out both}.gachaPopover .choices .gpOption[data-on=true]{box-shadow:0 2px 10px color-mix(in srgb,var(--amp-acc,#2f6fed) 35%,transparent)}'
      + '@media (prefers-reduced-motion:reduce){.panel.open,.gachaPopover *{animation:none!important;transition:none!important;transform:none!important}}</style>'
      + '<button class="launcher" type="button" aria-label="抽卡设置">' + slotIcon + '<span class="launcherProgress"></span></button><section class="gachaPopover panel" role="dialog" aria-label="抽卡设置"></section>';
    const panel = root.querySelector('.panel'), launcher = root.querySelector('.launcher');
    panel.innerHTML = '<div class="gpHeader"><button type="button" class="gpIcon" data-ui="models" title="归档设置" aria-label="归档设置">' + gear + '</button><button type="button" class="gpChosen" data-ui="choose" aria-label="选择目标模型" aria-haspopup="menu"><span class="gpCount" data-s="count">20张</span><span class="gpName"><span data-s="vicon"></span><span data-s="chosen">不限</span></span></button><button type="button" class="gpIcon gpTextIcon" data-ui="text" title="提示词与选项" aria-label="提示词与选项">T</button></div>'
      + '<div class="gpMenu choices" role="menu" aria-label="选择目标模型" hidden></div>'
      + '<div class="gpSettings modelEditor" hidden><label class="gpCheck gpHead"><input type="checkbox" data-k="archiveOn">归档黑名单</label><div class="gpChips" data-s="chips"></div><div class="gpConfirm" data-s="confirm" hidden><span data-s="confirmText"></span><div><button type="button" class="gpSecondary" data-ui="confirmNo">取消</button><button type="button" class="gpSecondary gpDanger" data-ui="confirmYes">删除</button></div></div><div class="gpAddRow"><textarea class="gpModelsInput gpAddInput" data-ui="archiveLines" rows="1" placeholder="输入关键词，换行可一次添加多个"></textarea><button type="button" class="gpSecondary" data-ui="saveModels">添加</button></div></div>'
      + '<div class="gpSettings advanced" hidden><div class="gpRow2"><label>提示词<input data-k="prompt" maxlength="4000"></label><label>间隔 秒<input data-k="intervalSec" type="number" min="0" max="60" step=".1"></label></div><label class="gpCheck"><input data-k="stopOnThinking" type="checkbox">路由到 Thinking 时停止</label><label class="gpCheck"><input data-k="sortSidebar" type="checkbox">左侧按实时排名排序</label><div class="gpSaveRow"><button type="button" class="gpSecondary" data-ui="saveText">保存</button></div><div class="gpLog" data-s="log" hidden></div></div>'
      + '<div class="gpQuantity"><div class="gpRange"><div class="gpDots" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><input type="range" min="0" max="4" step="1" aria-label="抽卡张数" data-ui="quantity"></div><button type="button" class="gpPrimary gpGo" data-a="start">START</button><button type="button" class="gpPrimary gpGo" data-a="stop" hidden>STOP</button></div>'
      + '<div class="gpStatus" role="status" hidden><span data-s="status"></span><span data-s="model"></span><button type="button" class="gpReset" data-a="reset" hidden>清除</button></div><p class="gpMessage" data-s="reason" role="status" hidden></p><button type="button" class="gpIp" data-a="ipok" hidden>我已更换 IP</button>';
    document.body.append(host);
    const $ = s => root.querySelector(s), field = k => $('[data-k="' + k + '"]'), text = (k, v) => { const e = $('[data-s="' + k + '"]'); if (e) e.textContent = v; };
    let anchor = null, lastAnchorRect = null, priorFocus = null, section = null, archiveConfirm = false, message = '', messageError = false, busy = false;
    const visible = el => el instanceof HTMLElement && el.isConnected && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden';
    const media = matchMedia('(prefers-color-scheme: dark)');
    let theme = 'light';
    const applyTheme = () => {
      const el = document.documentElement, explicit = el.dataset.theme;
      const dark = explicit === 'dark' || (explicit !== 'light' && (el.classList.contains('dark') || (!el.classList.contains('light') && (getComputedStyle(el).colorScheme === 'dark' || (getComputedStyle(el).colorScheme !== 'light' && media.matches)))));
      theme = dark ? 'dark' : 'light'; root.querySelectorAll('.gachaPopover').forEach(n => n.dataset.theme = theme);
      el.toggleAttribute('data-amp-dark', dark); el.setAttribute('data-amp-tone', gacha.settings().earthTone ? 'earth' : 'blue');
      const bg = composerBg(dark), pop = root.querySelector('.gachaPopover');
      if (pop) { pop.style.setProperty('--gp-bg', bg);
        if (dark) { pop.style.setProperty('--gp-fg', '#ecebe7'); pop.style.setProperty('--gp-muted', '#a9a59d'); pop.style.setProperty('--gp-line', 'color-mix(in srgb,' + bg + ',#fff 12%)'); pop.style.setProperty('--gp-hover', 'color-mix(in srgb,' + bg + ',#fff 7%)'); pop.style.setProperty('--gp-field', 'color-mix(in srgb,' + bg + ',#000 18%)'); pop.style.setProperty('--gp-track', 'color-mix(in srgb,' + bg + ',#fff 14%)'); }
        else for (const k of ['--gp-fg', '--gp-muted', '--gp-line', '--gp-hover', '--gp-field', '--gp-track']) pop.style.removeProperty(k); }
      launcher.style.background = bg; launcher.style.color = dark ? '#ecebe7' : '#242936';
    };
    // Colour of the native prompt box (walk up from the editor to the first opaque background).
    function composerBg(dark) {
      const ed = document.querySelector('form [contenteditable="true"],form textarea,[contenteditable="true"]');
      for (let n = ed; n && n !== document.body; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; const m = c.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); if (p.length < 4 || p[3] > 0.5) return c; } }
      return dark ? '#2c2b28' : '#fff';
    }
    applyTheme(); setInterval(applyTheme, 3000); window.addEventListener('amp-native-gacha', applyTheme); new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] }); media.addEventListener?.('change', applyTheme);
    const position = () => {
      if (!panel.classList.contains('open')) return;
      const vv = window.visualViewport, width = vv?.width || innerWidth, height = vv?.height || innerHeight;
      const r = anchor?.isConnected && visible(anchor) ? anchor.getBoundingClientRect() : lastAnchorRect;
      if (!r) { close(); return; }
      panel.style.width = Math.min(256, width - 24) + 'px'; panel.style.maxHeight = Math.max(120, height - 24) + 'px';
      const box = panel.getBoundingClientRect();
      panel.style.left = Math.max(12, Math.min(r.right - box.width, width - box.width - 12)) + 'px';
      const above = r.top - box.height - 8;
      panel.style.top = Math.max(12, Math.min(above >= 12 ? above : r.bottom + 8, height - box.height - 12)) + 'px';
    };
    try { new ResizeObserver(position).observe(panel); } catch {}
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true); window.visualViewport?.addEventListener('resize', position);
    const close = () => { if (!panel.classList.contains('open')) return; panel.classList.remove('open'); anchor?.setAttribute('aria-expanded', 'false'); collapse(); if (priorFocus?.isConnected) priorFocus.focus?.(); };
    const sections = { choose: '.choices', models: '.modelEditor', text: '.advanced' };
    const show = next => {
      section = section === next ? null : next;
      for (const [name, sel] of Object.entries(sections)) { $(sel).hidden = name !== section; $('[data-ui="' + name + '"]').setAttribute('aria-expanded', String(name === section)); }
      if (section === 'models') { const s = gacha.settings(); $('[data-ui="archiveLines"]').value = ''; field('archiveOn').checked = s.archiveOn; pendingDel = null; chips(); }
      position();
    };
    // Every open starts from the plain first-level card: all secondary panels collapsed.
    const collapse = () => { section = null; for (const [name, sel] of Object.entries(sections)) { $(sel).hidden = true; $('[data-ui="' + name + '"]').setAttribute('aria-expanded', 'false'); } };
    const say = (m, error = false) => { message = m; messageError = error; render(); };
    let pendingDel = null;
    function chips() {
      const s = gacha.settings(), box = $('[data-s="chips"]'), locked = gacha.running(); box.replaceChildren();
      for (const k of s.archiveKeywords) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'gpChip'; b.textContent = k; b.title = '点击删除“' + k + '”'; b.disabled = locked; b.dataset.pending = String(pendingDel === k);
        b.onclick = () => { pendingDel = k; chips(); };
        box.append(b);
      }
      if (!s.archiveKeywords.length) { const e = document.createElement('span'); e.className = 'gpChipEmpty'; e.textContent = '黑名单为空'; box.append(e); }
      const c = $('[data-s="confirm"]'); c.hidden = !pendingDel; if (pendingDel) text('confirmText', '删除“' + pendingDel + '”？');
      position();
    }
    function load() {
      const s = gacha.settings();
      field('prompt').value = s.prompt; field('intervalSec').value = String(s.intervalMs / 1000);
      field('stopOnThinking').checked = s.stopOnThinking; field('sortSidebar').checked = s.sortSidebar; field('archiveOn').checked = s.archiveOn;
    }
    // Second level of the vendor picker: GPT / Claude / Gemini / Grok / Kimi + custom keyword (2 columns × 3 rows).
    // Click lights a target, click again turns it off (= 不限).
    function choices() {
      const s = gacha.settings(), box = $('.choices'), locked = gacha.running(); box.replaceChildren();
      for (const v of gacha.VENDORS) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'gpOption'; b.setAttribute('role', 'menuitemcheckbox');
        const on = v.id === s.vendor; b.setAttribute('aria-checked', String(on)); b.dataset.on = String(on); b.title = v.lab + ' · 名称含 ' + v.kw.join('/') + (on ? ' · 再次点击取消' : '');
        b.innerHTML = vendorIcon(v.id, 15) + '<span></span>'; b.children[1].textContent = v.name;
        b.disabled = locked; b.onclick = () => { gacha.setVendor(on ? '' : v.id); choices(); render(); };
        box.append(b);
      }
      const wrap = document.createElement('div'); wrap.className = 'gpCustom'; const on = s.vendor === 'custom'; wrap.dataset.on = String(on);
      const inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 60; inp.placeholder = '自定义关键词'; inp.value = s.customKeyword || ''; inp.disabled = locked; inp.setAttribute('aria-label', '自定义目标关键词（回车确认）');
      const go = document.createElement('button'); go.type = 'button'; go.className = 'gpCustomGo'; go.disabled = locked; go.textContent = on ? '✓' : '↵'; go.title = on ? '点击取消自定义关键词' : '启用自定义关键词';
      const apply = toggle => { const k = inp.value.trim(); if (!k) { gacha.setVendor(''); } else if (toggle && on && k === s.customKeyword) gacha.setVendor(''); else gacha.setVendor('custom', k); choices(); render(); };
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); apply(true); } };
      go.onclick = () => apply(true);
      wrap.append(inp, go); box.append(wrap);
    }
    const clock = t => new Date(t).toLocaleTimeString('zh-CN', { hour12: false });
    let logStamp = '';
    function render() {
      const s = gacha.settings(), st = gacha.state(), active = gacha.running();
      const idx = Math.max(0, Q.indexOf(active ? st.settings.maxAttempts : s.maxAttempts));
      const slider = $('[data-ui="quantity"]'); slider.value = String(idx); slider.setAttribute('aria-valuetext', Q[idx] + ' 次'); $('.gpRange').style.setProperty('--gp-fill', 'calc(12px + (100% - 24px) * ' + idx / 4 + ')');
      text('count', Q[idx] + '张');
      const cfg = active ? st.settings : s, vend = gacha.VENDORS.find(v => v.id === cfg.vendor);
      const customOn = cfg.vendor === 'custom' && cfg.customKeyword;
      text('chosen', vend ? vend.name : customOn ? cfg.customKeyword : '不限'); const vi = $('[data-s="vicon"]'), vk = vend ? vend.id : ''; if (vi.dataset.v !== vk) { vi.dataset.v = vk; vi.innerHTML = vend ? vendorIcon(vend.id, 13) : ''; }
      root.querySelectorAll('[data-k]:not([data-k="sortSidebar"]):not([data-k="stopOnThinking"]):not([data-k="earthTone"]),[data-ui="quantity"],[data-ui="archiveLines"],[data-ui="saveModels"],[data-ui="saveText"],.gpChip,[data-ui="confirmYes"]').forEach(n => n.disabled = active || busy);
      const start = $('[data-a="start"]'), stop = $('[data-a="stop"]'), reset = $('[data-a="reset"]');
      { const ipb = $('[data-a="ipok"]'); if (ipb) { const on = !active && gacha.ipLimited(); ipb.hidden = !on; if (!on) { ipb.disabled = false; ipb.textContent = '我已更换 IP'; } } }
      start.hidden = active; stop.hidden = !active; stop.disabled = st?.status === 'stopping'; reset.hidden = active || !st;
      start.textContent = 'START'; start.title = st?.status === 'paused' ? '继续抽卡' : st && ['hit', 'done'].includes(st.status) ? '重新抽卡' : '开始抽卡';
      const total = st ? st.settings.maxAttempts : s.maxAttempts, done = st?.completed || 0;
      if (active) text('count', done + ' / ' + total + '张');
      const statusLabel = !st ? '' : active ? (st.status === 'stopping' ? '正在停止' : st.phase || '抽卡中') : ({ paused: '已暂停', hit: '已命中目标', done: '已完成' }[st.status] || st.status);
      text('status', statusLabel + (st && !active && st.status === 'paused' ? ' · ' + done + '/' + total : ''));
      const lastModel = st?.attempts?.filter(a => a.model).at(-1)?.model || ''; text('model', lastModel ? ' · ' + lastModel : '');
      $('.gpStatus').hidden = !st || (!active && !st.status);
      const reason = message || (st && !active && st.reason ? st.reason : '');
      const box = $('[data-s="reason"]'); box.textContent = reason; box.hidden = !reason; box.dataset.error = String(messageError || (st?.status === 'paused' && !!st.code && !message));
      const logBox = $('[data-s="log"]'), rows = (st?.attempts || []).slice(-30).reverse(), key = JSON.stringify(rows.map(a => [a.no, a.verdict, a.model, a.archived, a.note]));
      logBox.hidden = !rows.length;
      if (key !== logStamp) {
        logStamp = key; logBox.replaceChildren(...rows.map(a => { const d = document.createElement('div'), t = document.createElement('time'), sp = document.createElement('span');
          t.textContent = clock(a.at); sp.textContent = '#' + a.no + ' ' + (a.model || '') + (a.tier ? ' · ' + a.tier : '') + ' ' + ({ hit: '命中', keep: '保留', archive: a.archived ? '已归档' : '待归档', other: '保留', skipped: '跳过', error: '中断', cancelled: '取消', abandoned: '中断' }[a.verdict] || '进行中') + (a.resends ? ' · 重发 ' + a.resends : '') + (a.note ? ' · ' + a.note : '');
          d.dataset.v = a.verdict === 'hit' ? 'hit' : ['skipped', 'error'].includes(a.verdict) ? 'warn' : ''; d.title = sp.textContent; d.append(t, sp); return d; }));
      }
      const name = vend ? vend.name : customOn ? cfg.customKeyword : '不限', tgt = vend ? vend.id : customOn ? 'custom' : '';
      for (const b of document.querySelectorAll('[data-amp-native-gacha="1"]')) {
        b.title = active ? '抽卡中 ' + done + '/' + total + (st.phase ? ' · ' + st.phase : '') + ' · 点击查看' : st?.status === 'paused' ? '抽卡已暂停 · ' + (st.reason || '') : '目标模型：' + name + ' · 点击设置并抽卡';
        b.setAttribute('aria-label', active ? '抽卡进度 ' + done + '/' + total + '，目标 ' + name : '抽卡，目标模型 ' + name);
        b.dataset.running = String(active); b.toggleAttribute('data-empty', !tgt);
        const n = b.querySelector('[data-amp-name]'); if (n && n.textContent !== name) n.textContent = name;
        const ico = b.querySelector('[data-amp-icon]'); if (ico && ico.dataset.v !== tgt) { ico.dataset.v = tgt; ico.innerHTML = vend ? vendorIcon(vend.id, 14) : ''; ico.hidden = !vend; }
        b.toggleAttribute('data-empty', !tgt);
        const lab = b.querySelector('[data-amp-progress]'); if (lab) { lab.hidden = !active; lab.textContent = done + '/' + total; }
        const bar = b.querySelector('[data-amp-progress-bar]'); if (bar) { bar.hidden = !active; bar.style.width = (total ? Math.min(100, done / total * 100) : 0) + '%'; }
        const dot = b.querySelector('[data-amp-dot]'); if (dot) dot.hidden = active || st?.status !== 'paused';
      }
      sidebar.sync(cfg.targetKeywords);
      launcher.querySelector('.launcherProgress').textContent = active ? done + '/' + total : '';
      position();
    }
    const nativeStyle = document.createElement('style');
    nativeStyle.textContent = '[data-amp-native-gacha="1"]{position:relative;display:inline-flex!important;align-items:center;justify-content:center;gap:4px;height:32px!important;width:auto!important;max-width:220px;padding:0 8px!important;border:0;border-radius:8px!important;background:transparent;color:inherit;font-size:13px;font-weight:400;line-height:1.25;font-family:inherit;white-space:nowrap;overflow:hidden;cursor:pointer;flex-shrink:0;transition:background .12s ease}'
      + '[data-amp-native-gacha="1"]:hover{background:color-mix(in srgb,currentColor 9%,transparent)!important}[data-amp-native-gacha="1"]:focus-visible{outline:2px solid currentColor;outline-offset:2px}'
      + '[data-amp-native-gacha="1"] [data-amp-icon]{display:inline-flex;flex:none}[data-amp-native-gacha="1"] [data-amp-icon][hidden]{display:none}[data-amp-native-gacha="1"] [data-amp-name]{overflow:hidden;text-overflow:ellipsis;min-width:0}[data-amp-native-gacha="1"][data-empty] [data-amp-name]{opacity:.7}'
      + '[data-amp-native-gacha="1"] [data-amp-chev]{flex:none;opacity:.6}[data-amp-native-gacha="1"][data-running="true"] [data-amp-chev]{display:none}'
      + '[data-amp-progress]{font:11px system-ui;font-variant-numeric:tabular-nums;opacity:.75;flex:none}[data-amp-progress]::before{content:"· "}'
      + '[data-amp-progress-bar]{position:absolute;bottom:0;left:0;height:2px;background:currentColor;opacity:.6;transition:width .2s}[data-amp-dot]{position:absolute;top:5px;right:3px;width:6px;height:6px;border-radius:50%;background:#e38a1e}'
      + 'a[data-amp-target-hit],a[data-amp-vip],a[data-amp-current]{position:relative!important;isolation:isolate;border-radius:8px;transform-origin:left center;transition:transform .6s cubic-bezier(.22,.9,.3,1),background-color .3s ease,color .25s ease,box-shadow .3s ease}'
      + 'a[data-amp-target-hit]{background:color-mix(in srgb,var(--amp-acc,#2f6fed) var(--amp-tint,14%),transparent)!important;box-shadow:inset 3px 0 0 var(--amp-acc,#2f6fed);font-weight:650}'
      + 'a[data-amp-vip]{background:color-mix(in srgb,#d4a017 var(--amp-tint,22%),transparent)!important;box-shadow:inset 3px 0 0 #c9950c;font-weight:700}'
      + 'a[data-amp-target-hit] :is(span,div).truncate,a[data-amp-target-hit] [data-amp-local-title]::after{font-weight:650!important}a[data-amp-vip] :is(span,div).truncate,a[data-amp-vip] [data-amp-local-title]::after,a[data-amp-current][data-amp-done] [data-amp-local-title]::after{font-weight:700!important}'
      /* hover: grow quickly with a small overshoot, shrink back slowly on leave */
      + 'a[data-amp-target-hit],a[data-amp-vip],a[data-amp-current]{transform:scale(var(--amp-mag,1))}html[data-amp-mag-on] a[data-amp-target-hit],html[data-amp-mag-on] a[data-amp-vip],html[data-amp-mag-on] a[data-amp-current]{transition:transform .14s ease-out,background-color .3s ease,color .25s ease,box-shadow .3s ease}'
      + 'a[data-amp-target-hit]:active,a[data-amp-vip]:active,a[data-amp-current]:active{transform:scale(.985);transition-duration:.08s}'
      + '@keyframes ampPinIn{from{opacity:0;transform:translateX(-8px) scale(.98)}to{opacity:1;transform:none}}a[data-amp-target-hit],a[data-amp-vip]{animation:ampPinIn .38s cubic-bezier(.22,.9,.3,1) backwards}'
      /* current conversation: the left bar grows into a solid fill following the load progress */
      + 'a[data-amp-current]{box-shadow:inset 3px 0 0 var(--amp-cur,var(--amp-acc,#2f6fed))!important;overflow:hidden}a[data-amp-current][data-amp-vip]{--amp-cur:#c9950c}'
      + 'a[data-amp-current]::before{content:"";position:absolute;left:0;top:0;bottom:0;width:max(3px,var(--amp-fill,0%));background:var(--amp-cur,var(--amp-acc,#2f6fed));z-index:-1;border-radius:inherit;transition:width .35s cubic-bezier(.22,.9,.3,1);pointer-events:none}'
      + 'a[data-amp-current][data-amp-done]::before{box-shadow:0 2px 10px color-mix(in srgb,var(--amp-cur,var(--amp-acc,#2f6fed)) 45%,transparent)}'
      /* text turns white once the fill passes the text; the renamed-title span keeps its own text transparent (only ::after is visible) — fixes the overlapping names */
      + 'a[data-amp-current][data-amp-ink]{color:var(--amp-cur-fg,var(--amp-acc-fg,#fff))!important}a[data-amp-current][data-amp-ink] :is(span,div,p,svg):not([data-amp-local-title]):not([data-amp-vlogo]):not([data-amp-vlogo] *){color:var(--amp-cur-fg,var(--amp-acc-fg,#fff))!important}a[data-amp-current][data-amp-vip]{--amp-cur-fg:#fff}'
      + 'a[data-amp-current] span[data-amp-local-title][data-amp-local-title],a[data-amp-current] div[data-amp-local-title][data-amp-local-title]{color:transparent!important}a[data-amp-current][data-amp-ink] [data-amp-local-title]::after{color:var(--amp-cur-fg,var(--amp-acc-fg,#fff))!important}'
      + '[data-amp-vlogo]{display:inline-flex!important;align-items:center;justify-content:center;flex:none;width:18px;height:18px;border-radius:50%;background:#fff;color:#111;box-shadow:0 0 0 1px #0000001a;margin-right:6px;animation:ampLogoIn .3s ease-out both}[data-amp-vlogo] svg{width:12px;height:12px}[data-amp-vlogo][data-full]{background:transparent;box-shadow:none}[data-amp-vlogo][data-full] svg{width:18px;height:18px}a[data-amp-vip] [data-amp-vlogo]{box-shadow:0 0 0 1.5px #c9950c}'
      + '@keyframes ampLogoIn{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}'
      + '[data-amp-logo-hidden]{display:none!important}[data-amp-vlogo][data-noanim]{animation:none!important}[data-amp-vlogo]:not([data-full]),[data-amp-vlogo]:not([data-full]) svg{color:#111!important;fill:currentColor}[data-amp-vlogo]~[data-amp-vlogo]{display:none!important}'
      /* slot button next to Send: springy grow on hover (overshoot then settle), slow shrink on leave */
      + '[data-amp-native-gacha="1"]{transition:transform .5s cubic-bezier(.22,.9,.3,1),background .12s ease!important;will-change:transform}[data-amp-native-gacha="1"]:hover{transform:scale(1.07);transition:transform .3s cubic-bezier(.34,1.8,.5,1),background .12s ease!important}[data-amp-native-gacha="1"]:active{transform:scale(.95);transition-duration:.08s!important}'
      + '@media (prefers-reduced-motion:reduce){a[data-amp-target-hit],a[data-amp-vip],a[data-amp-current],[data-amp-native-gacha="1"],[data-amp-vlogo]{animation:none!important;transition:none!important;transform:none!important}}'
      + '';
    // Accent palette. Default = blue. 原色 (earth) mode: light = low-saturation burnt umber, dark = warm off-white matching Arena's greys.
    nativeStyle.textContent += 'html{--amp-acc:#6a5e54;--amp-acc-fg:#fff;--amp-acc-soft:#6a5e54}html[data-amp-dark]{--amp-acc:#d8d3ca;--amp-acc-fg:#262522;--amp-acc-soft:#e4dfd6}html[data-amp-tone=earth]{--amp-acc:#6a5e54;--amp-acc-fg:#fff;--amp-acc-soft:#6a5e54}html[data-amp-tone=earth][data-amp-dark]{--amp-acc:#d8d3ca;--amp-acc-fg:#262522;--amp-acc-soft:#e4dfd6}';
    (document.head || document.body).append(nativeStyle);
    // Dock-style magnification for the pinned sidebar cards: the closer the pointer, the larger the card.
    // Moving: quick follow (.14s). Leaving the sidebar: all cards shrink back slowly (.6s, CSS default transition).
    (() => {
      const SEL_CARD = 'a[data-amp-target-hit],a[data-amp-vip],a[data-amp-current]', MAX = 0.06;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      let raf = 0, last = null, active = new Set();
      const reset = () => { document.documentElement.removeAttribute('data-amp-mag-on'); for (const a of active) a.style.removeProperty('--amp-mag'); active = new Set(); };
      const frame = () => {
        raf = 0; const e = last; if (!e) return;
        const side = e.target?.closest?.('aside,nav,[data-sidebar]'); if (!side) { reset(); return; }
        document.documentElement.setAttribute('data-amp-mag-on', '');
        // 只放大鼠标所在（最近）的卡片和紧挨着的上下各一张，其余卡片完全不动。
        const next = new Set();
        const cards = [...side.querySelectorAll(SEL_CARD)].map(a => ({ a, r: a.getBoundingClientRect() })).filter(x => x.r.height).sort((x, y) => x.r.top - y.r.top);
        const inCol = cards.length && e.clientX >= Math.min(...cards.map(x => x.r.left)) - 12 && e.clientX <= Math.max(...cards.map(x => x.r.right)) + 12;
        let ni = -1, nd = Infinity;
        if (inCol) cards.forEach((x, k) => { const d = Math.abs(e.clientY - (x.r.top + x.r.height / 2)); if (d < nd) { nd = d; ni = k; } });
        if (ni >= 0 && nd > cards[ni].r.height * 1.2) ni = -1; // 离卡片区太远：都不放大
        for (let k = ni - 1; ni >= 0 && k <= ni + 1; k++) {
          const x = cards[k]; if (!x) continue;
          const h = x.r.height, d = Math.abs(e.clientY - (x.r.top + x.r.height / 2)), kk = Math.max(0, 1 - d / (h * 1.6));
          const v = 1 + (k === ni ? MAX : MAX * 0.45) * kk * kk * (3 - 2 * kk);
          if (v > 1.0005) { x.a.style.setProperty('--amp-mag', v.toFixed(4)); next.add(x.a); }
        }
        for (const a of active) if (!next.has(a)) a.style.removeProperty('--amp-mag');
        active = next;
      };
      document.addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; last = e; if (!raf) raf = requestAnimationFrame(frame); }, { passive: true });
      document.addEventListener('pointerleave', reset); window.addEventListener('blur', reset);
      document.addEventListener('pointerout', e => { if (!e.relatedTarget) reset(); }, { passive: true });
    })();
    const toggle = b => {
      if (panel.classList.contains('open')) { close(); return; }
      anchor = b || launcher; priorFocus = document.activeElement; load(); message = ''; collapse(); panel.classList.add('open'); anchor.setAttribute('aria-expanded', 'true'); render(); position(); $('[data-ui="quantity"]').focus({ preventScroll: true });
    };
    const SEL = 'button[aria-label="Send message"],button[aria-label="发送消息"],button[aria-label="Stop generating"],button[aria-label="Stop response"],button[aria-label="停止生成"]';
    // ---------------- 长按厂商按钮：左轮式竖向选择器 ----------------
    // 按住约 0.35 秒（或按住直接上推）弹出一列竖向卡片，像左轮弹巢一样滚动；上下推动切换，松开即选中中间那项。
    const REV_H = 46;
    let revCssOn = false;
    function revCss() {
      if (revCssOn) return; revCssOn = true;
      const st = document.createElement('style'); st.id = 'amp-revolver-css';
      st.textContent = '[data-amp-revolver]{position:fixed;z-index:2147483646;pointer-events:none;width:200px;height:' + (REV_H * 5) + 'px;perspective:520px;opacity:0;transform:translateY(10px) scale(.96);transition:opacity .18s ease,transform .28s cubic-bezier(.22,1,.36,1);font:500 14px/1 var(--font-basel-grotesk,var(--font-inter,system-ui)),"PingFang SC","Microsoft YaHei",sans-serif}'
        + '[data-amp-revolver].on{opacity:1;transform:none}[data-amp-revolver].out{opacity:0;transform:translateY(6px) scale(.97);transition:opacity .22s ease .08s,transform .3s ease .08s}'
        + '[data-amp-revolver] .rv-win{position:absolute;left:-6px;right:-6px;top:50%;height:' + (REV_H + 6) + 'px;margin-top:-' + ((REV_H + 6) / 2) + 'px;border-radius:14px;background:var(--rv-win);box-shadow:0 10px 30px rgba(0,0,0,.26),0 0 0 3px color-mix(in srgb,var(--rv-acc) 18%,transparent),inset 0 0 0 2px var(--rv-acc)}'
        + '[data-amp-revolver] .rv-drum{position:absolute;inset:0;transform-style:preserve-3d}'
        + '[data-amp-revolver] .rv-it{position:absolute;left:0;right:0;top:50%;height:' + (REV_H - 6) + 'px;margin-top:-' + ((REV_H - 6) / 2) + 'px;display:flex;align-items:center;gap:10px;padding:0 14px;box-sizing:border-box;border-radius:12px;background:var(--rv-card);color:var(--rv-fg);box-shadow:0 4px 14px rgba(0,0,0,.14),inset 0 0 0 1px var(--rv-line);backface-visibility:hidden;will-change:transform,opacity}'
        + '[data-amp-revolver] .rv-it.sel{background:transparent;box-shadow:none;font-weight:700;color:var(--rv-acc)}[data-amp-revolver] .rv-it.sel .rv-ic{color:var(--rv-fg)}[data-amp-revolver] .rv-it .rv-ic{display:inline-flex;width:18px;height:18px;align-items:center;justify-content:center;flex:none}[data-amp-revolver] .rv-it .rv-ic svg{width:16px;height:16px}'
        + '[data-amp-revolver] .rv-it .rv-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}[data-amp-revolver] .rv-it .rv-ck{opacity:0;font-size:12px;color:var(--rv-acc)}[data-amp-revolver] .rv-it.cur .rv-ck{opacity:1}'
        + '[data-amp-revolver] .rv-hint{position:absolute;left:0;right:0;top:4px;text-align:center;font-size:11px;font-weight:400;color:var(--rv-mut)}'
        + '[data-amp-native-gacha="1"]{touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}[data-amp-native-gacha="1"][data-amp-rv]{transform:scale(.94)!important}';
      (document.head || document.documentElement).append(st);
    }
    function revItems() {
      const s = gacha.settings(), out = [{ id: '', name: '不限', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M8 12h8"/></svg>' }];
      for (const v of gacha.VENDORS) out.push({ id: v.id, name: v.name, icon: vendorIcon(v.id, 16) });
      if (s.customKeyword) out.push({ id: 'custom', kw: s.customKeyword, name: s.customKeyword, icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h10M4 17h7"/></svg>' });
      return out;
    }
    function wheelOpen(b) {
      revCss();
      const items = revItems(), s = gacha.settings(), curId = s.vendor || '';
      const cur = Math.max(0, items.findIndex(it => it.id === curId)); let pos = cur, target = cur, shown = -1, done = false, raf = 0, idleT = 0, acc = 0;
      const dark = document.documentElement.classList.contains('dark');
      const root = document.createElement('div'); root.dataset.ampRevolver = '1';
      root.style.cssText = dark ? '--rv-card:#34322e;--rv-win:#4b4740;--rv-fg:#ecebe7;--rv-line:#ffffff14;--rv-acc:#d8d3ca;--rv-mut:#a9a59d' : '--rv-card:#fffdf9;--rv-win:#e6ddd0;--rv-fg:#262522;--rv-line:#0000000f;--rv-acc:#6a5e54;--rv-mut:#7a746b';
      root.innerHTML = '<div class="rv-win"></div><div class="rv-drum"></div><div class="rv-hint">滚轮选择 · 停下或移开确认</div>';
      const drum = root.querySelector('.rv-drum');
      const els = items.map((it, i) => { const d = document.createElement('div'); d.className = 'rv-it' + (i === cur ? ' cur' : ''); d.innerHTML = '<span class="rv-ic">' + it.icon + '</span><span class="rv-nm"></span><span class="rv-ck">当前</span>'; d.querySelector('.rv-nm').textContent = it.name; drum.append(d); return d; });
      document.body.append(root);
      const r = b.getBoundingClientRect(), W = 200, H = REV_H * 5;
      root.style.left = Math.max(8, Math.min(innerWidth - W - 8, r.left + r.width / 2 - W / 2)) + 'px';
      root.style.top = Math.max(8, r.top - H - 14) + 'px';
      b.setAttribute('data-amp-rv', ''); b._ampRv = true;
      const n = els.length, wrapI = k => ((k % n) + n) % n;
      const paint = () => {
        els.forEach((d, i) => {
          const off = ((((i - pos) % n) + n + n / 2) % n) - n / 2, a = Math.abs(off);
          d.style.transform = 'translateY(' + (off * REV_H * 0.92) + 'px) rotateX(' + (-off * 24) + 'deg) translateZ(' + (-a * a * 6) + 'px) scale(' + Math.max(.72, 1 - a * .07) + ')';
          d.style.opacity = String(Math.max(0, 1 - a * .3)); d.style.zIndex = String(100 - Math.round(a * 10));
        });
        const k = wrapI(Math.round(pos)); if (k !== shown) { shown = k; els.forEach((d, i) => d.classList.toggle('sel', i === k)); }
      };
      paint(); requestAnimationFrame(() => root.classList.add('on'));
      const loop = () => { raf = 0; pos += (target - pos) * .3; if (Math.abs(target - pos) < .003) pos = target; paint(); if (pos !== target) raf = requestAnimationFrame(loop); };
      const finish = pick => {
        if (done) return; done = true; clearTimeout(idleT); cancelAnimationFrame(raf);
        b.removeEventListener('mouseleave', leave); b.removeEventListener('click', clk, true); removeEventListener('keydown', esc, true); removeEventListener('blur', away); document.removeEventListener('visibilitychange', away);
        const kr = Math.round(target), k = wrapI(kr);
        const from = pos, t0 = performance.now(); const snap = t => { const p = Math.min(1, (t - t0) / 160); pos = from + (kr - from) * (1 - Math.pow(1 - p, 3)); paint(); if (p < 1) requestAnimationFrame(snap); }; requestAnimationFrame(snap);
        root.classList.add('out'); setTimeout(() => root.remove(), 420);
        b.removeAttribute('data-amp-rv'); b._ampRv = false; b._ampWh = null; b._ampRvSkip = Date.now();
        if (pick) { const it = items[k]; if (it.id !== curId || it.id === 'custom') { if (it.id === 'custom') gacha.setVendor('custom', it.kw); else gacha.setVendor(it.id); try { window.dispatchEvent(new CustomEvent('amp-native-gacha')); } catch {} } }
      };
      const leave = () => finish(true);
      const clk = ev => { ev.preventDefault(); ev.stopImmediatePropagation(); finish(true); };
      const esc = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); } else if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } };
      const away = ev => { if (ev?.type === 'visibilitychange' && document.visibilityState !== 'hidden') return; finish(false); };
      b.addEventListener('mouseleave', leave); b.addEventListener('click', clk, true); addEventListener('keydown', esc, true); addEventListener('blur', away); document.addEventListener('visibilitychange', away);
      return {
        push(d) {
          if (done) return;
          // 普通鼠标一格 ≈ 100 → 转一张；触控板的细碎滚动累积到 60 再转一张，避免一碰就飞
          if (Math.abs(d) >= 50) target += Math.sign(d); else { acc += d; if (Math.abs(acc) >= 60) { target += Math.sign(acc); acc = 0; } }
          if (!raf) raf = requestAnimationFrame(loop);
          clearTimeout(idleT); idleT = setTimeout(() => finish(true), 1200);
        }
      };
    }
    function attachRevolver(b) {
      if (b.dataset.ampRvBound) return; b.dataset.ampRvBound = '1';
      // 触屏：按钮一开始就禁止浏览器把上下滑当成页面滚动（以前样式要等弹巢打开后才注入，手机上手势被滚动抢走）
      revCss(); b.style.touchAction = 'none'; b.style.webkitTouchCallout = 'none'; b.style.userSelect = 'none';
      b.addEventListener('contextmenu', e => { if (b.hasAttribute('data-amp-rv') || b._ampRvT) e.preventDefault(); });
      // 电脑：鼠标停在厂商按钮上直接滚动滚轮 → 弹出同一个弹巢并跟着转；停下约 1.2 秒、移开鼠标或点一下即确认，Esc 取消
      b.addEventListener('wheel', e => {
        const st = gacha.state(); if (st && ['running', 'stopping'].includes(st.status)) return;
        if (b._ampRv && !b._ampWh) return; // 正在用手势/长按拨动
        if (!e.deltaY) return;
        e.preventDefault(); e.stopPropagation();
        const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        (b._ampWh ||= wheelOpen(b)).push(d);
      }, { passive: false });
      b.addEventListener('pointerdown', e => {
        if (e.button !== 0 || b._ampRv) return;
        const st = gacha.state(); if (st && ['running', 'stopping'].includes(st.status)) return; // 抽卡中不允许换厂商
        const x0 = e.clientX, y0 = e.clientY, pid = e.pointerId;
        try { b.setPointerCapture(pid); } catch {}
        // 事件挂在 window（捕获阶段）：按钮被重绘/移除、指针捕获丢失时仍能收到抬起/取消，不会卡住
        const cancel = () => { clearTimeout(b._ampRvT); b._ampRvT = 0; removeEventListener('pointermove', early, true); removeEventListener('pointerup', cancel, true); removeEventListener('pointercancel', cancel, true); removeEventListener('blur', cancel); };
        const touch = e.pointerType !== 'mouse';
        // 手机：在按钮上上下滑动（任一方向超过 8px）立即弹出弹巢，继续滑动选择，松手确认；电脑：长按或向上推
        const early = ev => { if (ev.pointerId !== pid) return; const dy = y0 - ev.clientY, dx = Math.abs(ev.clientX - x0); if (touch ? Math.abs(dy) > 8 && Math.abs(dy) > dx : dy > 12) { cancel(); open(ev, touch ? dy : 0); } else if (dx > (touch ? 24 : 14) || (!touch && ev.clientY - y0 > 14)) cancel(); };
        b._ampRvT = setTimeout(() => { cancel(); open(e); }, 350);
        addEventListener('pointermove', early, true); addEventListener('pointerup', cancel, true); addEventListener('pointercancel', cancel, true); addEventListener('blur', cancel);
        function open(ev0, pre = 0) {
          revCss(); try { b.setPointerCapture(pid); } catch {}
          const items = revItems(), s = gacha.settings(), curId = s.vendor || '';
          let cur = Math.max(0, items.findIndex(it => it.id === curId)), pos = cur, shown = -1, startY = ev0.clientY + pre, startPos = pos, done = false;
          const dark = document.documentElement.classList.contains('dark');
          const root = document.createElement('div'); root.dataset.ampRevolver = '1';
          root.style.cssText = dark ? '--rv-card:#34322e;--rv-win:#4b4740;--rv-fg:#ecebe7;--rv-line:#ffffff14;--rv-acc:#d8d3ca;--rv-mut:#a9a59d' : '--rv-card:#fffdf9;--rv-win:#e6ddd0;--rv-fg:#262522;--rv-line:#0000000f;--rv-acc:#6a5e54;--rv-mut:#7a746b';
          root.innerHTML = '<div class="rv-win"></div><div class="rv-drum"></div><div class="rv-hint">上下推动 · 松开选中</div>';
          const drum = root.querySelector('.rv-drum');
          const els = items.map((it, i) => { const d = document.createElement('div'); d.className = 'rv-it' + (i === cur ? ' cur' : ''); d.innerHTML = '<span class="rv-ic">' + it.icon + '</span><span class="rv-nm"></span><span class="rv-ck">当前</span>'; d.querySelector('.rv-nm').textContent = it.name; drum.append(d); return d; });
          document.body.append(root);
          const r = b.getBoundingClientRect(), W = 200, H = REV_H * 5;
          root.style.left = Math.max(8, Math.min(innerWidth - W - 8, r.left + r.width / 2 - W / 2)) + 'px';
          root.style.top = Math.max(8, r.top - H - 14) + 'px';
          b.setAttribute('data-amp-rv', ''); b._ampRv = true;
          const wrap = k => ((k % items.length) + items.length) % items.length;
          const paint = () => {
            els.forEach((d, i) => {
              const n = els.length, off = ((((i - pos) % n) + n + n / 2) % n) - n / 2, a = Math.abs(off);
              // 弹巢：卡片绕水平轴排成圆柱，离中心越远越倾斜、越小、越淡
              d.style.transform = 'translateY(' + (off * REV_H * 0.92) + 'px) rotateX(' + (-off * 24) + 'deg) translateZ(' + (-a * a * 6) + 'px) scale(' + Math.max(.72, 1 - a * .07) + ')';
              d.style.opacity = String(Math.max(0, 1 - a * .3)); d.style.zIndex = String(100 - Math.round(a * 10));
            });
            const k = wrap(Math.round(pos)); if (k !== shown) { if (shown >= 0) try { navigator.vibrate?.(6); } catch {} shown = k; els.forEach((d, i) => d.classList.toggle('sel', i === k)); }
          };
          paint(); requestAnimationFrame(() => root.classList.add('on'));
          // 循环滚动：不分首尾，最后一项之后接第一项
          const clampPos = p => p;
          const move = ev => { if (ev.pointerId !== pid || done) return; ev.preventDefault(); pos = clampPos(startPos + (startY - ev.clientY) / (REV_H * .92)); paint(); };
          const finish = (ev, pick) => {
            if (ev && ev.pointerId !== pid) return; if (done) return; done = true;
            removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', cc, true); removeEventListener('keydown', esc, true);
            removeEventListener('pointermove', touchT, true); removeEventListener('blur', away); removeEventListener('pagehide', away); document.removeEventListener('visibilitychange', away); clearInterval(dog);
            try { b.releasePointerCapture(pid); } catch {}
            const kr = Math.round(pos), k = wrap(kr);
            // 吸附到选中项再淡出
            const from = pos, t0 = performance.now(); const snap = t => { const p = Math.min(1, (t - t0) / 160); pos = from + (kr - from) * (1 - Math.pow(1 - p, 3)); paint(); if (p < 1) requestAnimationFrame(snap); }; requestAnimationFrame(snap);
            root.classList.add('out'); setTimeout(() => root.remove(), 420);
            b.removeAttribute('data-amp-rv'); b._ampRv = false; b._ampRvSkip = Date.now();
            if (pick) { const it = items[k]; if (it.id !== curId || it.id === 'custom') { if (it.id === 'custom') gacha.setVendor('custom', it.kw); else gacha.setVendor(it.id); try { window.dispatchEvent(new CustomEvent('amp-native-gacha')); } catch {} } }
          };
          const up = ev => finish(ev, true), cc = ev => finish(ev, false), esc = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(null, false); } };
          // 离开页面 / 切到后台 / 打开抽屉导致手势被系统拿走：一律收起弹巢（不改选择）
          const away = ev => { if (ev?.type === 'visibilitychange' && document.visibilityState !== 'hidden') return; finish(null, false); };
          let lastEv = Date.now(); const touchT = ev => { if (ev.pointerId === pid) lastEv = Date.now(); };
          const dog = setInterval(() => { if (done) return clearInterval(dog); if (!b.isConnected && Date.now() - lastEv > 1200) finish(null, false); else if (Date.now() - lastEv > 12000) finish(null, false); }, 400);
          addEventListener('pointermove', touchT, true);
          addEventListener('pointermove', move, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', cc, true); addEventListener('keydown', esc, true);
          addEventListener('blur', away); addEventListener('pagehide', away); document.addEventListener('visibilitychange', away);
        }
      });
    }
    function install() {
      let inserted = false;
      for (const action of [...document.querySelectorAll(SEL)].filter(visible)) {
        const toolbar = action.parentElement; let composer = action.closest('form') || toolbar;
        for (let i = 0; i < 4 && composer && !composer.querySelector('[contenteditable="true"],textarea'); i++) composer = composer.parentElement;
        if (!toolbar || !composer?.querySelector('[contenteditable="true"],textarea') || action.closest('[role="log"]')) continue;
        const existing = toolbar.querySelector('[data-amp-native-gacha="1"]');
        if (existing) { inserted = true; if (existing.nextElementSibling !== action) toolbar.insertBefore(existing, action); lastAnchorRect = existing.getBoundingClientRect(); if (panel.classList.contains('open') && !anchor?.isConnected) anchor = existing; continue; }
        // Prefer a native *text* button in the composer (e.g. "Agent ⌄" / "gpt-6 ⌄") so size and typography match.
        const own = b => b.matches('[data-amp-native-gacha]') || b === action;
        const textPeer = [...composer.querySelectorAll('button')].find(b => !own(b) && visible(b) && (b.innerText || '').trim() && !b.closest('[role="log"]'));
        const peer = textPeer || [...toolbar.querySelectorAll('button')].find(b => !own(b));
        const b = document.createElement('button'); b.type = 'button'; b.dataset.ampNativeGacha = '1'; b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false');
        b.className = peer?.className || '';
        b.innerHTML = '<span data-amp-icon hidden></span><span data-amp-name></span><span data-amp-progress hidden></span>' + chevron + '<i data-amp-progress-bar hidden></i><i data-amp-dot hidden></i>';
        if (textPeer) { const cs = getComputedStyle(textPeer); for (const k of ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'fontFamily']) if (cs[k]) b.style[k] = cs[k]; }
        b.onclick = e => { e.preventDefault(); e.stopPropagation(); if (b._ampRvSkip && Date.now() - b._ampRvSkip < 500) return; toggle(b); }; attachRevolver(b);
        toolbar.insertBefore(b, action); inserted = true; lastAnchorRect = b.getBoundingClientRect();
        if (panel.classList.contains('open')) anchor = b;
      }
      // The slot button lives and dies with the composer: no floating substitute. Orphans are removed.
      for (const b of document.querySelectorAll('[data-amp-native-gacha="1"]')) {
        const next = b.nextElementSibling;
        if (!next || !next.matches(SEL) || !visible(next)) b.remove();
      }
      launcher.classList.remove('show');
      if (panel.classList.contains('open') && !(anchor?.isConnected && anchor !== launcher)) {
        const b = [...document.querySelectorAll('[data-amp-native-gacha="1"]')].find(visible);
        if (b) anchor = b; else close();
      }
      render();
    }
    let scheduled = false;
    // 性能：流式输出（[role=log] 内）和脚本自己写入的节点不触发；只有侧栏变化时只同步侧栏，不重建抽卡按钮
    const OWN = '[data-amp-native-gacha],[data-amp-vlogo],[data-amp-hname],[data-amp-htier],[data-amp-hlogo],[data-amp-slot],#amp-lite-dock';
    const ownNode = n => n.nodeType === 1 && !!(n.matches(OWN) || n.hasAttribute('data-amp-local-title'));
    let needComp = false, needSide = false;
    const syncSide = () => { try { const st = gacha.state(), cfg = gacha.running() && st ? st.settings : gacha.settings(); sidebar.sync(cfg.targetKeywords); } catch {} };
    new MutationObserver(recs => {
      for (const rec of recs) {
        const t = rec.target, e = t.nodeType === 1 ? t : t.parentElement; if (!e) continue;
        if (e.closest('[role="log"]') || e.closest(OWN)) continue;
        if (rec.addedNodes.length + rec.removedNodes.length && [...rec.addedNodes, ...rec.removedNodes].every(ownNode)) continue;
        if (e.closest('aside,nav,[data-sidebar]')) needSide = true; else needComp = true;
        if (needComp) break;
      }
      if (scheduled || !(needComp || needSide)) return; scheduled = true;
      requestAnimationFrame(() => { scheduled = false; const c = needComp, sd = needSide; needComp = needSide = false; if (c) install(); else if (sd) syncSide(); });
    }).observe(document.body, { childList: true, subtree: true });
    setInterval(() => { if (!document.hidden) syncSide(); }, 1500); // 排行榜/厂商识别等异步结果到达后补一次
    for (const name of Object.keys(sections)) $('[data-ui="' + name + '"]').onclick = () => { if (name === 'choose') choices(); show(name); };

    $('[data-ui="quantity"]').oninput = e => { gacha.saveSettings({ maxAttempts: Q[Number(e.target.value)] }); render(); };
    const lines = v => [...new Set(v.split(/[\n,，]+/).map(s => s.trim()).filter(Boolean))];
    const addInput = $('[data-ui="archiveLines"]');
    const grow = () => { addInput.style.height = 'auto'; addInput.style.height = Math.min(96, addInput.scrollHeight + 2) + 'px'; position(); };
    addInput.oninput = grow;
    addInput.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('[data-ui="saveModels"]').click(); } };
    $('[data-ui="saveModels"]').onclick = () => {
      const add = lines(addInput.value); if (!add.length) { addInput.focus(); return; }
      const cur = gacha.settings().archiveKeywords, low = new Set(cur.map(x => x.toLowerCase()));
      const fresh = add.filter(x => !low.has(x.toLowerCase())), arch = [...cur, ...fresh];
      if (arch.length > 50 || arch.some(x => x.length > 200)) { say('最多 50 个关键词', true); return; }
      gacha.saveSettings({ archiveKeywords: arch, archiveOn: field('archiveOn').checked }); addInput.value = ''; grow(); pendingDel = null; chips();
      say(fresh.length ? '已添加 ' + fresh.length + ' 个' : '关键词已存在');
    };
    $('[data-ui="confirmNo"]').onclick = () => { pendingDel = null; chips(); };
    $('[data-ui="confirmYes"]').onclick = () => {
      const k = pendingDel; pendingDel = null; if (!k) return chips();
      gacha.saveSettings({ archiveKeywords: gacha.settings().archiveKeywords.filter(x => x !== k) }); chips(); say('已删除“' + k + '”');
    };
    field('archiveOn').onchange = () => { gacha.saveSettings({ archiveOn: field('archiveOn').checked }); render(); };
    for (const k of ['stopOnThinking', 'sortSidebar']) field(k).onchange = () => { gacha.saveSettings({ [k]: field(k).checked }); render(); };
    // 提示词改完即保存（失焦/回车），不必再点“保存”。
    const savePrompt = () => { const v = field('prompt').value.trim(); if (v && v !== gacha.settings().prompt) { gacha.saveSettings({ prompt: v }); if (!gacha.saveOk()) say('保存失败：浏览器本地存储已满或被禁用', true); else say(gacha.running() ? '已保存，下一轮生效' : '提示词已保存'); } };
    field('prompt').addEventListener('change', savePrompt); field('prompt').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); savePrompt(); field('prompt').blur(); } });
    $('[data-ui="saveText"]').onclick = () => {
      const sec = Number(field('intervalSec').value);
      if (!field('prompt').value.trim()) { say('提示词不能为空', true); return; }
      if (!Number.isFinite(sec) || sec < 0 || sec > 60) { say('间隔 0～60 秒', true); return; }
      gacha.saveSettings({ prompt: field('prompt').value.trim(), intervalMs: Math.round(sec * 1000), stopOnThinking: field('stopOnThinking').checked, sortSidebar: field('sortSidebar').checked }); if (gacha.saveOk()) say('已保存'); else say('保存失败：浏览器本地存储已满或被禁用', true);
    };
    $('[data-a="start"]').onclick = () => { message = ''; const st = gacha.state(), r = gacha.start(st?.status === 'paused'); if (!r.ok) { say(r.error, true); render(); return; } close(); render(); };
    $('[data-a="stop"]').onclick = () => { gacha.stop(); render(); };
    $('[data-a="reset"]').onclick = () => { gacha.reset(); message = ''; render(); };
    $('[data-a="ipok"]').onclick = async e => { const b = e.currentTarget; if (b.disabled) return; b.disabled = true; b.textContent = '检测中…'; let r; try { r = await gacha.ipRetry(); } catch (x) { r = { ok: false, error: String(x?.message || x) }; } b.disabled = false; b.textContent = '我已更换 IP'; if (r.ok) { say(r.msg); setTimeout(() => { if (message === r.msg) { message = ''; render(); } }, 5000); close(); } else say(r.error, true); };
    document.addEventListener('pointerdown', e => { if (!e.composedPath().includes(host) && !e.target.closest?.('[data-amp-native-gacha]')) close(); });
    document.addEventListener('keydown', e => {
      if (!panel.classList.contains('open')) return;
      if (e.key === 'Escape') { e.preventDefault(); if (pendingDel) { pendingDel = null; chips(); } else if (section) show(section); else close(); }
    }, true);
    window.addEventListener('amp-native-gacha', () => render());
    window.addEventListener('amp-native-gacha-open', () => { const b = [...document.querySelectorAll('[data-amp-native-gacha="1"]')].find(visible); if (b && !panel.classList.contains('open')) toggle(b); });
    load(); install();
    return { render, install, root };
  }
  return { mount, vendorIcon, get mounted() { return mounted; } };
})();


(function () {
  'use strict';
  const VERSION = 'native-1.11.58', KEY = 'amp.lite.v2', DB_VERSION = 3, LEVELS = ['none','minimal','low','medium','high','xhigh','max'];
  // 每轮最多详读的模型调用数 / 内存保留完整原始数据的轮数 / 每轮持久化精简原始数据的上限
  const TURN_CALL_LIMIT = 16, RAW_KEEP = 3, RAW_PERSIST_BYTES = 262144;
  // 原始数据总预算可选档位（MB）、发送时间缓存条数、额度刷新最小间隔
  const BUDGET_OPTIONS = [16, 32, 64, 128, 256], SENT_KEEP = 4000, BALANCE_INTERVAL = 60000;
  const RUN = /^run_[\w-]{1,100}$/, SPAN = /^[a-f0-9]{16,32}$/i;
  const number = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
  const label = v => typeof v === 'string' && v.length <= 200 && !/[\x00-\x1f\x7f]|Bearer\s|eyJ[\w-]+\.[\w-]+\./i.test(v) ? v : null;
  function get(o, path) {
    if (!o || typeof o !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(o, path)) return o[path];
    for (const k of path.split('.')) { if (!o || typeof o !== 'object' || !Object.prototype.hasOwnProperty.call(o,k)) return undefined; o = o[k]; }
    return o;
  }
  function object(v) { if (typeof v === 'string' && v.length < 524288) { try { v = JSON.parse(v); } catch { return {}; } } return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function sidOf(url) { try { return new URL(url,'https://arena.ai').pathname.match(/^\/agent\/([\w-]{1,128})\/?$/)?.[1] || null; } catch { return null; } }
  function streamSid(url) { try { return new URL(url,'https://arena.ai').pathname.match(/\/realtime\/v1\/sessions\/([\w-]{1,128})\//)?.[1] || null; } catch { return null; } }
  function authorized(token, expectedSid, now = Date.now()) {
    if (typeof token !== 'string' || token.length > 16384 || token.split('.').length !== 3) throw Error('运行令牌格式不符');
    let p; try { let s=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'); s+='='.repeat((4-s.length%4)%4); p=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s),c=>c.charCodeAt(0)))); } catch { throw Error('运行令牌无法解码'); }
    if (p?.pub !== true || p.iss !== 'https://id.trigger.dev' || ![p.aud].flat().includes('https://api.trigger.dev')) throw Error('不是公开运行令牌');
    if (!Number.isFinite(p.exp) || p.exp*1000 <= now+5000) throw Error('运行令牌已过期');
    const scopes=Array.isArray(p.scopes)?p.scopes:[], runs=scopes.filter(s=>typeof s==='string'&&s.startsWith('read:runs:'));
    const sessions=scopes.filter(s=>typeof s==='string'&&s.startsWith('read:sessions:')).map(s=>s.slice(14));
    const sid=expectedSid || (sessions.length===1?sessions[0]:null);
    if (!sid || !sessions.includes(sid) || runs.length!==1 || !RUN.test(runs[0].slice(10))) throw Error('会话与运行读取权限不匹配');
    return {sid,runId:runs[0].slice(10),expires:p.exp*1000};
  }
  // Trace 里的 startTime 是纳秒字符串（BigInt 序列化），duration 是纳秒数
  const toMs = v => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string' && /^\d{10,}$/.test(v)) { const n = Number(v.length > 15 ? v.slice(0, -6) : v); return Number.isSafeInteger(n) ? n : null; }
    if (typeof v === 'number' && Number.isFinite(v)) return v > 1e15 ? Math.round(v / 1e6) : v > 1e11 ? Math.round(v) : null;
    if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
    return null;
  };
  const toDurationMs = v => { const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : typeof v === 'number' ? v : NaN; return Number.isFinite(n) && n >= 0 ? Math.round(n / 1e5) / 10 : null; };

  // 1. 白名单解析：正文不参与档位判断，也不进入缓存。
  function configs(node, source='span', path='$.properties', out=[], depth=0) {
    if (!node || typeof node!=='object' || Array.isArray(node) || depth>8 || out.length>=48) return out;
    for (const [key,raw] of Object.entries(node).slice(0,160)) {
      if (!/^[\w.-]{1,180}$/.test(key) || key.split('.').some(k=>/^(messages?|parts|text|content|prompt|input|output|delta|headers|authorization|cookie|token|password|secret|signature)$/i.test(k))) continue;
      const p=path+'.'+key, leaf=key.split('.').at(-1), parent=p.split('.').at(-2);
      let v=raw;
      if (v && typeof v==='object' && Object.keys(v).length===1 && 'stringValue' in v) v=v.stringValue;
      if (/^(reasoning_effort|reasoningEffort|thinkingLevel|thinking_level)$/.test(leaf) || leaf==='effort' && /^(reasoning|output_config|outputConfig)$/.test(parent)) {
        if(typeof v==='string') out.push({kind:'effort',value:LEVELS.includes(v.trim().toLowerCase())?v.trim().toLowerCase():null,source,path:p});
      } else if (/^(thinkingBudget|thinking_budget|budget_tokens|budgetTokens)$/.test(leaf) && /^(thinking|thinkingConfig|thinking_config)$/.test(parent) && Number.isSafeInteger(v) && v>=-1) {
        out.push({kind:'budget',value:v,source,path:p});
      } else if (leaf==='type' && parent==='thinking' && ['enabled','disabled','adaptive'].includes(v)) {
        out.push({kind:'mode',value:v,source,path:p});
      } else {
        if (typeof v==='string' && /^(providerOptions|provider_options|reasoning|thinking|thinkingConfig|thinking_config|output_config|outputConfig)$/.test(leaf)) v=object(v);
        if (v && typeof v==='object') configs(v,source,p,out,depth+1);
      }
      if(out.length>=48)break;
    }
    return out;
  }
  function effort(items=[]) {
    const seen=new Set(), evidence=items.filter(x=>{const k=JSON.stringify(x);if(seen.has(k))return false;seen.add(k);return true;});
    const e=evidence.filter(x=>x.kind==='effort'), levels=[...new Set(e.map(x=>x.value).filter(x=>LEVELS.includes(x)))];
    const status=levels.length>1?'conflict':e.some(x=>x.value===null)?'unsupported':levels.length?'explicit':'unknown';
    return {status,value:status==='explicit'?levels[0]:null,levels,budgets:[...new Set(evidence.filter(x=>x.kind==='budget').map(x=>x.value))],modes:[...new Set(evidence.filter(x=>x.kind==='mode').map(x=>x.value))],evidence};
  }
  function hint(internal, request) {
    if(!internal)return {value:null,status:'未提供'};
    const strip=s=>s.replace(/-(vertex|agent)$/i,'').replace(/-\d{8}$|-\d{4}$/,'');
    const s=strip(internal), m=/-(none|minimal|low|medium|high|xhigh|max)$/i.exec(s);
    if(!m)return {value:null,status:'无后缀'};
    const norm=s=>s.toLowerCase().replace(/[._]/g,'-'), base=s.slice(0,-m[0].length);
    if(request && norm(strip(request))===norm(s))return {value:null,status:'型号本身的组成部分'};
    return {value:m[1].toLowerCase(),status:!request?'仅后缀，未核对基座':norm(strip(request))===norm(base)?'内部标签，非显式参数':'基座不一致，待核对'};
  }
  function reported(readings) {
    const evidence=readings.filter(x=>number(x.value)!==null), values=[...new Set(evidence.map(x=>x.value))];
    return {value:values.length===1?values[0]:null,status:values.length>1?'conflict':values.length?values[0]===0?'zero':'positive':'missing',evidence};
  }
  // 按 "chat turn N" 标记把 Trace 切成段；同一轮号再次出现记为第 attempt 次。
  // baseline 是页面提交新消息时记下的（标记数, 已见 span, 服务端最新事件时间），用于在后端不写新标记时仍能识别出新记录；
  // since 使用服务端时间域，避免本机时钟偏差把新记录过滤掉。
  function plan(trace, runId, baseline=null) {
    if(!Array.isArray(trace?.events))throw Error('Trace 缺少 events 数组');
    const segments=[], attempts={};let seg={index:0,turn:null,attempt:0,at:null,events:[],items:[],first:0,last:-1}, markers=0, newest=null;
    for(const [i,e] of trace.events.entries()) {
      if(!e||typeof e!=='object'||e.runId&&e.runId!==runId)continue;
      const at=toMs(e.startTime);if(at&&(!newest||at>newest))newest=at;
      const m=/^chat turn (\d+)$/.exec(e.message||'');
      if(m){markers++;const turn=+m[1];attempts[turn]=(attempts[turn]||0)+1;if(segments.length||seg.events.length)segments.push(seg);seg={index:segments.length,turn,attempt:attempts[turn],at:toMs(e.startTime),events:[],items:[],first:i,last:i};}
      seg.last=i;
      const pill=icon=>(e.style?.accessory?.items||[]).find(x=>x?.icon===icon&&label(x.text))?.text||null;
      const id=SPAN.test(e.spanId||'')?e.spanId:null, msg=label(e.message)||'';
      const kind=m?'marker':/^ai\.(streamText\.doStream|generateText\.doGenerate)$/.test(msg)?'stream':msg==='token.usage.recorded'?'usage':msg==='spend.recorded'?'cost':null;
      if(seg.events.length<2400)seg.events.push({spanId:id,parentId:typeof e.parentId==='string'?e.parentId.slice(0,64):null,message:msg,at:toMs(e.startTime),durationMs:toDurationMs(e.duration),isPartial:e.isPartial!==false,isError:e.isError===true,isCancelled:e.isCancelled===true,level:label(e.level),model:pill('tabler-cube'),totalLabel:pill('tabler-hash'),icon:label(e.style?.icon),kind});
      if(!kind||kind==='marker'||!id)continue;
      seg.items.push({id,kind,message:msg,at:toMs(e.startTime),turn:seg.turn,partial:e.isPartial!==false,model:pill('tabler-cube'),totalLabel:pill('tabler-hash'),properties:e.properties});
    }
    segments.push(seg);
    const cur=segments.at(-1), spanIds=new Set();for(const s of segments)for(const x of s.items)spanIds.add(x.id);
    let items=cur.items, prior=0, resumed=false;
    if(baseline&&markers<=(baseline.markers||0)){const fresh=items.filter(x=>!baseline.spans?.has(x.id)&&(!x.at||!baseline.since||x.at>=baseline.since));prior=items.filter(x=>x.kind==='stream').length-fresh.filter(x=>x.kind==='stream').length;items=fresh;resumed=true;}
    const streams=items.filter(x=>x.kind==='stream'), usage=items.filter(x=>x.kind==='usage'), cost=items.filter(x=>x.kind==='cost');
    // Arena 服务端故障转移：原模型首包超时/报错 → model.resample.attempt_failed → failover.record_inserted → model.resample.switched/committed
    const route=cur.events.filter(e=>/^(model\.resample\.(attempt_failed|switched|committed)|failover\.record_inserted|agent\.empty_turn|Agent turn failed)$/.test(e.message)).map(e=>({message:e.message,at:e.at,spanId:e.spanId,level:e.level}));
    const records=[...usage.slice(-TURN_CALL_LIMIT),...cost.slice(-4)];
    return {turn:cur.turn,attempt:cur.attempt,segment:cur.index,markers,at:resumed?(streams[0]?.at??cur.at):cur.at,range:[cur.first,cur.last],allStreams:streams,allRecords:[...usage,...cost],streams:streams.slice(-TURN_CALL_LIMIT),records,count:streams.length,limited:streams.length>TURN_CALL_LIMIT||usage.length>TURN_CALL_LIMIT||cost.length>4,ready:!!streams.length&&items.every(x=>!x.partial),events:cur.events,route,prior,resumed,spanIds,newest,segments:segments.map(s=>({index:s.index,turn:s.turn,attempt:s.attempt,at:s.at,calls:s.items.filter(x=>x.kind==='stream').length}))};
  }
  function detail(data,event,runId) {
    if(data?.runId && data.runId!==runId || data?.spanId && data.spanId!==event.id || data?.message && data.message!==event.message)throw Error('Span 返回了不同的调用标识');
    const p=object(data?.properties), text=paths=>paths.map(k=>label(get(p,k))).find(Boolean)||null;
    const readings=(paths,kind,source='span')=>paths.flatMap(path=>number(get(p,path))!==null?[{kind,value:get(p,path),source,path:'$.properties.'+path}]:[]);
    const d={id:event.id,kind:event.kind,at:event.at??null,partial:event.partial||data?.isPartial===true,available:!!data?.properties};
    if(event.kind!=='stream')return {...d,internal:text(['modelName','model_name','model','ai.model.id']),messageId:text(['messageId','message_id','assistantMessageId','nodeId']),route:text(['provider']),reasoning:readings(['reasoningTokens'],'reasoning','record'),input:readings(['inputTokens'],'input','record'),output:readings(['outputTokens'],'output','record'),total:readings(['totalTokens'],'total','record'),fields:event.kind==='cost'?costFields(p):[],usd:event.kind==='cost'?usdFields(p):null};
    d.request=text(['ai.telemetry.metadata.apiModelName','gen_ai.request.model','ai.model.id']);d.response=text(['ai.response.model','gen_ai.response.model']);
    d.route=text(['ai.telemetry.metadata.modelProvider']);d.adapter=text(['ai.model.provider']);d.finish=text(['ai.response.finishReason']);
    d.configs=configs(p);const opt=get(p,'ai.prompt.providerOptions');if(opt!==undefined)configs({providerOptions:opt},'span','$.properties.ai.prompt',d.configs);
    d.reasoning=readings(['ai.usage.reasoningTokens','gen_ai.usage.reasoning_tokens'],'reasoning');
    const meta=object(get(p,'ai.response.providerMetadata'));
    for(const path of ['anthropic.usage.output_tokens_details.thinking_tokens','vertex.usageMetadata.thoughtsTokenCount','google.usageMetadata.thoughtsTokenCount']) {
      const v=get(meta,path);if(number(v)!==null)d.reasoning.push({kind:'reasoning',value:v,source:'providerMetadata',path:'$.properties.ai.response.providerMetadata.'+path});
    }
    d.input=readings(['ai.usage.inputTokens','ai.usage.promptTokens','gen_ai.usage.input_tokens'],'input');d.output=readings(['ai.usage.outputTokens','ai.usage.completionTokens','gen_ai.usage.output_tokens'],'output');d.total=readings(['ai.usage.totalTokens','gen_ai.usage.total_tokens'],'total');
    d.settings={};for(const k of ['temperature','topP','maxOutputTokens']){const v=get(p,'ai.settings.'+k);if(typeof v==='number'&&Number.isFinite(v))d.settings[k]=v;}
    return d;
  }
  // 用量记录（token.usage.recorded）是 Arena 按消息写入的轮次级记录，携带内部名称。
  // 只有一次调用时其数字与该调用合并；多次调用时数字单独列为 records，不摊到某一次调用；
  // 记录数与调用数相等时仅按顺序配对名称。
  function snapshot(run,p,details) {
    const recs=p.allRecords.map(e=>({e,d:details.get(e.id)})), usage=recs.filter(x=>x.e.kind==='usage'), pool=usage.length?usage:recs;
    // 名称池取自全部用量与花费记录：用量记录缺名时仍可由花费记录提供
    const names=[...new Set(recs.map(x=>x.d?.internal).filter(Boolean))], single=p.count===1;
    const paired=pool.length>1&&pool.length===p.allStreams.length, one=pool.length===1;
    const calls=p.streams.map(e=>{
      const d=details.get(e.id)||{}, i=p.allStreams.indexOf(e), rec=paired?pool[i]?.d:one?pool[0].d:null;
      const internal=rec?.internal||(names.length===1?names[0]:null), scope=rec?.internal?(paired||single?'call':'turn'):internal?'turn':null;
      const first=k=>(d[k]?.length?d[k]:single&&rec?.[k]||[]), input=first('input'), output=first('output'), total=first('total');
      return {id:e.id,at:e.at?new Date(e.at).toISOString():null,model:d.request||e.model||'未提供',request:d.request||null,response:d.response||null,internal,internalScope:scope,route:d.route||rec?.route||null,adapter:d.adapter||null,finish:d.finish||null,hint:hint(internal,d.request),effort:effort([...(d.configs||[]),...(single?run.requestConfigs||[]:[])]),reasoning:reported([...(d.reasoning||[]),...(single&&rec?.reasoning||[])]),tokens:{input:input[0]?.value??null,output:output[0]?.value??null,total:total[0]?.value??null},tokenSources:[...input,...output,...total],totalLabel:e.totalLabel,settings:d.settings||{},partial:!d.available||d.partial===true};
    });
    const records=pool.filter(x=>x.d?.available).slice(-TURN_CALL_LIMIT).map(({e,d})=>({id:e.id,at:e.at?new Date(e.at).toISOString():null,kind:e.kind,internal:d.internal||null,messageId:d.messageId||null,input:d.input[0]?.value??null,output:d.output[0]?.value??null,reasoning:d.reasoning[0]?.value??null,total:d.total[0]?.value??null}));
    // 花费记录单独列出（spend.recorded 的费用类字段），不混入用量记录
    const costs=recs.filter(x=>x.e.kind==='cost'&&x.d?.available).slice(-4).map(({e,d})=>({id:e.id,at:e.at?new Date(e.at).toISOString():null,internal:d.internal||null,messageId:d.messageId||null,fields:d.fields||[]}));
    const partial=p.limited||calls.some(c=>c.partial)||[...p.streams,...p.records].some(e=>!details.get(e.id)?.available);
    const rt=p.route||[], sw=rt.find(x=>x.message==='model.resample.switched');
    let routing=null;
    if(sw){const nm=e=>e?(details.get(e.id)?.request||e.model||null):null,before=p.allStreams.filter(x=>x.at&&x.at<=sw.at).at(-1),after=p.allStreams.find(x=>x.at&&x.at>=sw.at),failAt=rt.find(x=>x.message==='model.resample.attempt_failed')?.at;
      routing={from:nm(before),to:nm(after),waitMs:before?.at&&failAt?Math.max(0,failAt-before.at):null,at:new Date(sw.at).toISOString(),committed:rt.some(x=>x.message==='model.resample.committed'),reason:run.routeReason||null,cause:run.routeCause||null};}
    const outcome=rt.some(x=>x.message==='Agent turn failed')?'failed':rt.some(x=>x.message==='agent.empty_turn')?'empty':null;
    return {routing,outcome,version:2,key:run.runId+':'+(p.allStreams[0]?.id||'s'+p.segment),sid:run.sid,runId:run.runId,turn:p.turn,attempt:p.attempt,segment:p.segment,resumed:p.resumed,at:new Date().toISOString(),startedAt:p.at?new Date(p.at).toISOString():null,revision:run.revision,prompt:run.prompt||null,sentAt:run.submittedAt?new Date(run.submittedAt).toISOString():null,calls,count:p.count,prior:p.prior,internalNames:names,records,costs,credits:run.credits||null,partial,raw:{events:p.events,spans:run.rawSpans?Object.fromEntries(run.rawSpans):{},probe:run.probe||null}};
  }
  // 原始数据精简：去掉提示词/回答/工具定义等正文键，长字符串截断。
  const RAW_DROP=/^(messages?|parts|text|content|delta|headers|authorization|cookie|password|secret|signature|tools|definitions|system|system_instructions|toolCalls|responseText|object|reasoningText)$/i;
  function trimRaw(v,depth=0) {
    if(v===null||typeof v!=='object'){if(typeof v==='string'&&v.length>200&&!/…\[共 \d+ 字符\]$/.test(v))return v.slice(0,200)+'…[共 '+v.length+' 字符]';return v;}
    if(depth>10)return '[层级过深]';
    if(Array.isArray(v))return v.slice(0,200).map(x=>trimRaw(x,depth+1));
    const out={};
    for(const [k,x] of Object.entries(v).slice(0,300)){
      if(RAW_DROP.test(k)){out[k]='[已省略 '+(typeof x==='string'?x.length+' 字符':Array.isArray(x)?x.length+' 项':typeof x)+']';continue;}
      out[k]=trimRaw(x,depth+1);
    }
    return out;
  }
  function trimSpan(data) {
    const out={};for(const k of ['spanId','parentId','runId','message','startTime','durationMs','isPartial','isError','isCancelled','level','entityType'])if(data?.[k]!==undefined)out[k]=data[k];
    if(data?.properties!==undefined)out.properties=trimRaw(object(data.properties));if(data?.ai&&typeof data.ai==='object')out.ai=trimRaw(data.ai);return out;
  }
  function sanitizeRaw(raw) {
    if(!raw||typeof raw!=='object')return {events:[],spans:{}};
    let events=(Array.isArray(raw.events)?raw.events:[]).slice(0,2400).filter(e=>e&&typeof e==='object').map(e=>({spanId:SPAN.test(e.spanId||'')?e.spanId:null,parentId:typeof e.parentId==='string'?e.parentId.slice(0,64):null,message:label(e.message)||'',at:number(e.at),durationMs:typeof e.durationMs==='number'&&Number.isFinite(e.durationMs)?e.durationMs:null,isPartial:e.isPartial===true,isError:e.isError===true,isCancelled:e.isCancelled===true,level:label(e.level),model:label(e.model),totalLabel:label(e.totalLabel),icon:label(e.icon),kind:['marker','stream','usage','cost'].includes(e.kind)?e.kind:null}));
    let size=JSON.stringify(events).length;if(size>RAW_PERSIST_BYTES/2){events=[...events.slice(0,300),...events.slice(-300)];size=JSON.stringify(events).length;}
    const spans={};
    for(const [id,v] of Object.entries(raw.spans&&typeof raw.spans==='object'?raw.spans:{}).slice(0,64)){if(!SPAN.test(id)||!v||typeof v!=='object')continue;const t=trimRaw(v), n=JSON.stringify(t).length;if(size+n>RAW_PERSIST_BYTES)continue;spans[id]=t;size+=n;}
    // 探测结果（run 记录 / 元数据 / 会话记录）：只保留状态与精简后的正文
    let probe=null;
    if(raw.probe&&typeof raw.probe==='object'){probe={};for(const k of ['run','metadata','session','cost']){const v=raw.probe[k];if(!v||typeof v!=='object')continue;const row={status:number(v.status)??0,at:typeof v.at==='string'?v.at.slice(0,40):null};if(typeof v.error==='string')row.error=v.error.slice(0,200);if(v.data!==undefined){const t=trimRaw(v.data);if(JSON.stringify(t).length<=65536)row.data=t;else row.error='已省略（超过 64 KB）';}probe[k]=row;}if(!Object.keys(probe).length)probe=null;}
    return {events,spans,probe};
  }
  // 从 /in/append 载荷提取用户消息开头（≤40 字），用于在轮次列表里辨认是哪个问题。
  function promptPreview(j) {
    let found=null;
    (function walk(n,depth){if(found||!n||typeof n!=='object'||depth>7)return;if(Array.isArray(n)){for(const v of n){walk(v,depth+1);if(found)return;}return;}
      if(n.role&&n.role!=='user')return;
      for(const [k,v] of Object.entries(n))if(typeof v==='string'&&/^(text|content|prompt|message|input)$/.test(k)&&v.trim()){found=v;return;}
      for(const v of Object.values(n)){walk(v,depth+1);if(found)return;}})(j,0);
    return found?found.replace(/[\x00-\x1f\x7f]+|\s+/g,' ').trim().slice(0,40)||null:null;
  }
  // 消息 id 是页面用 UUIDv7 生成的：前 48 位为 Unix 毫秒时间戳（版本位为 7 才解析）
  function uuidTime(id) {
    if(typeof id!=='string')return null;const m=/^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.exec(id.trim());if(!m)return null;
    const ms=parseInt(m[1]+m[2],16);return ms>1262304000000&&ms<4102444800000?ms:null;
  }
  const pad2=n=>String(n).padStart(2,'0');
  function stamp(ms,now=Date.now()) {
    if(!Number.isFinite(ms))return null;const d=new Date(ms),n=new Date(now),date=pad2(d.getMonth()+1)+'-'+pad2(d.getDate()),time=pad2(d.getHours())+':'+pad2(d.getMinutes());
    return (d.getFullYear()===n.getFullYear()?date:d.getFullYear()+'-'+date)+' '+time;
  }
  const fullStamp=ms=>Number.isFinite(ms)?new Date(ms).toLocaleString('zh-CN',{hour12:false}):null;
  // create-chat 响应头里的应用层限流：ratelimit-limit / remaining / reset（Unix 秒）/ retry-after（秒）
  // 429 正文的分类沿用页面自己的规则：每日 Agent 消息上限（100 条 / 24 小时）、每日花费上限、按模型限流、其余为通用限流
  const AGENT_DAILY_TEXT="You've reached the daily limit of 100 agent messages. Please try again later.";
  function quotaReason(body){
    if(typeof body!=='string'||!body.trim())return null;let j=null;try{j=JSON.parse(body);}catch{}
    const msg=j&&typeof j==='object'?(typeof j.error==='string'?j.error:typeof j.message==='string'?j.message:null):body.trim().slice(0,200);
    if(j&&typeof j==='object'&&typeof j.modelId==='string')return {kind:'model',reason:'该模型限流'+(label(j.modelId)?' · '+j.modelId.slice(0,60):'')};
    if(msg===AGENT_DAILY_TEXT)return {kind:'agent-daily',reason:'每日 Agent 消息上限（100 条 / 24 小时）'};
    if(msg==='daily spend limit reached')return {kind:'daily-spend',reason:'每日花费上限'};
    if(!msg||/^too many requests\.?$/i.test(msg)||/^</.test(msg))return null;
    return {kind:'generic',reason:label(msg.slice(0,160))};
  }
  function quotaOf(headers,status,now=Date.now(),body=null) {
    const h=k=>{const v=typeof headers?.get==='function'?headers.get(k):headers?.[k];return v===null||v===undefined?null:String(v);};
    const int=v=>v!==null&&/^\d{1,12}$/.test(v.trim())?Number(v.trim()):null;
    const limit=int(h('ratelimit-limit')),remaining=int(h('ratelimit-remaining')),reset=int(h('ratelimit-reset')),retry=int(h('retry-after'));
    if(limit===null&&remaining===null&&reset===null&&retry===null&&status!==429)return null;
    const retryDate=retry===null&&h('retry-after')?Date.parse(h('retry-after')):NaN;
    const resetAt=reset!==null?(reset>1e11?reset:reset>1e9?reset*1000:now+reset*1000):retry!==null?now+retry*1000:Number.isFinite(retryDate)&&retryDate>now?retryDate:null;
    // ratelimit-policy（如 "10;w=60"）给出窗口长度；服务端不一定发
    const policy=h('ratelimit-policy'),win=policy&&/(?:^|[;,\s])w=(\d{1,8})/.exec(policy),why=status===429?quotaReason(body):null;
    return {at:now,status:number(status)??null,limit,remaining,resetAt,blocked:status===429,window:win?Number(win[1]):null,kind:why?.kind||null,reason:why?.reason||null};
  }
  // 剩余时间的口语化：1 分钟内 / N 分钟后 / 当天 HH:mm / 跨天日期
  const until=(ms,now=Date.now())=>{const d=ms-now;return d<60000?'1 分钟内':d<3600000?Math.ceil(d/60000)+' 分钟后':(d<86400000?new Date(ms).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'}):stamp(ms,now))+' ';};
  // 限流状态的展示。窗口内：剩余/上限；窗口过后不再隐藏，按上限显示并标注“已重置”（推断值，下次观测时更新）；429 解除后同样保留
  function quotaView(q,kind,now=Date.now(),showReset=false){
    if(!q)return null;const label=kind==='chat'?'新会话':'消息',daily=q.kind==='agent-daily'||q.kind==='daily-spend',live=q.resetAt?q.resetAt>now:now-q.at<(daily?86400000:60000);
    const base=(kind==='chat'?'来自 create-chat 响应头 ratelimit-*；服务端按窗口计数，本机各标签页共享同一份记录':'来自 /in/append 响应头 ratelimit-*')+' · 记录于 '+new Date(q.at).toLocaleTimeString('zh-CN',{hour12:false})+(q.window?' · 窗口 '+q.window+' 秒':'')+(q.reason?' · '+q.reason:'');
    if(q.blocked){
      if(live)return {label,value:'限流中',tail:(q.resetAt?' · '+until(q.resetAt,now)+'解除':daily?' · 解除时间未知':'')+(q.kind==='agent-daily'?' · 每日上限':q.kind==='daily-spend'?' · 花费上限':''),cls:'blocked',title:base};
      if(q.limit===null||kind!=='chat')return now-(q.resetAt||q.at)<600000?{label,value:'已解除限流',tail:'',cls:'muted',title:base}:null;
      if(!showReset)return null;
      return {label,value:q.limit+'/'+q.limit,tail:' · 已解除',cls:'muted',title:base+' · 解除后按上限显示，属推断值'};
    }
    if(q.limit===null&&q.remaining===null)return null;
    if(live){const low=q.remaining!==null&&q.limit&&q.remaining<=Math.max(2,Math.floor(q.limit*0.2));return {label,value:(q.remaining??'?')+'/'+(q.limit??'?'),tail:q.resetAt?' · '+until(q.resetAt,now)+'重置':'',cls:low?'low':'',title:base};}
    // 只有新会话限流在窗口过后仍保留（它只能在新建会话时观测到）；消息限流窗口过后隐藏
    // “已重置”只是推断值，默认不显示（设置里可打开）
    if(kind!=='chat'||!showReset)return null;
    return {label,value:(q.limit??'?')+'/'+(q.limit??'?'),tail:' · 已重置',cls:'muted',title:base+' · 窗口已过，按上限显示，属推断值；下次新建会话时更新'};
  }
  // 花费记录（spend.recorded）里的费用类字段：键名含 cost/usd/credit/price/charge 等的数字，以及 strategy/source/currency 类短字符串。字段名不做假设，原样列出
  const COST_KEY=/(cost|usd|credit|price|charg|amount|cents?$|multiplier|margin|discount|rate$)/i;
  function costFields(node,path='$.properties',out=[],depth=0){
    if(!node||typeof node!=='object'||Array.isArray(node)||depth>3||out.length>=24)return out;
    for(const [key,raw] of Object.entries(node).slice(0,120)){
      if(!/^[\w.-]{1,120}$/.test(key)||RAW_DROP.test(key))continue;let v=raw;if(v&&typeof v==='object'&&Object.keys(v).length===1&&'stringValue' in v)v=v.stringValue;
      if(typeof v==='string'&&/^[\[{]/.test(v)&&v.length<65536&&/(cost|price|charge|usage|billing|pricing|credit)/i.test(key)){try{v=JSON.parse(v);}catch{}}
      const p=path+'.'+key;
      if(typeof v==='number'&&Number.isFinite(v)){if(COST_KEY.test(key))out.push({path:p,key,value:v});}
      else if(typeof v==='string'){if(v.length<=80&&/^(pricingStrategy|strategy|source|currency|billingMode|plan|tier)$/i.test(key))out.push({path:p,key,value:v});}
      else if(v&&typeof v==='object')costFields(v,p,out,depth+1);
      if(out.length>=24)break;
    }
    return out;
  }
  // 页面自带的费用接口 GET /api/chat/{id}/cost：messages 以助手消息节点 id 为键；1 美元 = 1000 credits（页面常量），优先用 totalChargedCredits
  const CREDITS_PER_USD=1000;
  const usdOf=e=>[e?.totalChargedUsd,e?.totalCharged,e?.charged?.totalCostUsd].find(v=>typeof v==='number'&&Number.isFinite(v))??null;
  function creditsOf(e){if(typeof e?.totalChargedCredits==='number'&&Number.isFinite(e.totalChargedCredits))return e.totalChargedCredits;const usd=usdOf(e);return usd===null?null:usd*CREDITS_PER_USD;}
  function costSummary(j){
    if(!j||typeof j!=='object')return null;const s=j.session&&typeof j.session==='object'?j.session:null,msgs=j.messages&&typeof j.messages==='object'&&!Array.isArray(j.messages)?j.messages:null;
    if(!s&&!msgs)return null;const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null,entries={};
    for(const [k,e] of Object.entries(msgs||{}).slice(0,2000)){if(!/^[\w-]{1,128}$/.test(k)||!e||typeof e!=='object')continue;entries[k]={credits:creditsOf(e),usd:usdOf(e),actualUsd:num(e.actual?.totalCostUsd),baseUsd:num(e.basePriceUsd),strategy:label(e.pricingStrategy),multiplier:num(e.costMultiplier),margin:num(e.marginMultiplier),fallback:e.actual?.isFallback===true,source:label(e.actual?.source)};}
    const agg=s?.aggregate&&typeof s.aggregate==='object'?s.aggregate:null;
    const session=s?{actualUsd:num(s.actualTotalUsd),chargedUsd:num(s.chargedTotalUsd),messages:num(s.messageCount),credits:agg&&creditsOf(agg)!==null?creditsOf(agg):num(s.chargedTotalUsd)!==null?s.chargedTotalUsd*CREDITS_PER_USD:null}:null;
    return {session,entries};
  }
  // 本轮消耗：优先取本轮消息 id 命中的条目（流里的 messageId / nodeId、用量记录的 messageId、页面最后一条助手消息）；否则取“提交时未见过的新条目”；再否则取会话累计的差值
  function resolveTurnCredits({entries={},candidates=[],strong=[],before=null,sessionBefore=null,session=null}){
    const sum=keys=>{let credits=0,usd=0,actual=0,ok=false;const parts=[];for(const k of keys){const e=entries[k];if(!e||e.credits===null)continue;ok=true;credits+=e.credits;usd+=e.usd??0;actual+=e.actualUsd??0;parts.push({key:k,credits:e.credits,usd:e.usd,actualUsd:e.actualUsd,strategy:e.strategy,multiplier:e.multiplier,margin:e.margin,fallback:e.fallback});}return ok?{credits,usd,actualUsd:actual,parts}:null;};
    // strong：来自本轮 Trace 记录的消息 id，直接认；candidates：流里收集的 id，基线里已有的条目属于之前的轮次（重连回放的旧帧可能混入），排除
    const seen=new Set(),pick=(list,strict)=>list.filter(k=>typeof k==='string'&&entries[k]&&!(strict&&before instanceof Set&&before.has(k))&&!seen.has(k)&&seen.add(k));
    let ids=pick(strong,false),r=sum(ids);if(r)return {...r,source:'message',keys:ids};
    ids=pick(candidates,true);r=sum(ids);if(r)return {...r,source:'message',keys:ids};
    if(before instanceof Set){const fresh=Object.keys(entries).filter(k=>!before.has(k));r=sum(fresh);if(r)return {...r,source:'new',keys:fresh};}
    if(sessionBefore&&session&&sessionBefore.credits!==null&&session.credits!==null&&session.credits>sessionBefore.credits)return {credits:session.credits-sessionBefore.credits,usd:session.chargedUsd!==null&&sessionBefore.chargedUsd!==null?session.chargedUsd-sessionBefore.chargedUsd:null,actualUsd:session.actualUsd!==null&&sessionBefore.actualUsd!==null?session.actualUsd-sessionBefore.actualUsd:null,parts:[],source:'session',keys:[]};
    return null;
  }
  // 本地标题取名：优先带推理强度后缀的内部名称，一旦取到就锁定；否则用首个内部名称，再退回请求型号。
  function pickName(s) {
    const names=Array.isArray(s?.internalNames)?s.internalNames.filter(Boolean):[], withSuffix=names.find(n=>hint(n,null).value), internal=withSuffix||names[0]||null;
    if(internal)return {name:noVertex(internal),source:'internal',locked:!!withSuffix};
    const request=(s?.calls||[]).map(c=>c.request||c.model).find(n=>n&&n!=='未提供');
    return request?{name:request,source:'request',locked:false}:null;
  }
  function nextName(old,pick) {
    if(!pick)return old?.name?old:null;
    if(old?.locked&&old.name)return old;
    if(!old?.name||pick.locked||old.source==='request'&&pick.source==='internal')return pick;
    return old;
  }
  function localSnapshot(s) {
    if(!s||![1,2].includes(s.version)||!/^\w[\w-]{0,127}$/.test(s.sid||'')||!RUN.test(s.runId||'')||!Array.isArray(s.calls))return null;
    const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
    const evidence=items=>(Array.isArray(items)?items:[]).slice(0,128).flatMap(e=>{if(!e||typeof e.path!=='string'||e.path.length>2000||!/^\$[\w.-]*$/.test(e.path))return[];const x={source:['span','record','providerMetadata','页面请求'].includes(e.source)?e.source:'未知来源',path:e.path};if(e.kind==='effort')return[{...x,kind:'effort',value:LEVELS.includes(e.value)?e.value:null}];if(e.kind==='budget')return Number.isSafeInteger(e.value)&&e.value>=-1?[{...x,kind:'budget',value:e.value}]:[];if(e.kind==='mode')return['enabled','disabled','adaptive'].includes(e.value)?[{...x,kind:'mode',value:e.value}]:[];return number(e.value)!==null?[{...x,kind:['input','output','total','reasoning'].includes(e.kind)?e.kind:'token',value:e.value}]:[];});
    const calls=s.calls.slice(0,TURN_CALL_LIMIT).filter(c=>c&&SPAN.test(c.id||'')).map(c=>{const request=label(c.request),internal=label(c.internal);return{id:c.id,at:iso(c.at),model:label(c.model)||'未提供',request,response:label(c.response),internal,internalScope:['call','turn'].includes(c.internalScope)?c.internalScope:internal?'turn':null,route:label(c.route),adapter:label(c.adapter),finish:label(c.finish),hint:hint(internal,request),effort:effort(evidence(c.effort?.evidence)),reasoning:reported(evidence(c.reasoning?.evidence)),tokens:{input:number(c.tokens?.input),output:number(c.tokens?.output),total:number(c.tokens?.total)},tokenSources:evidence(c.tokenSources),totalLabel:label(c.totalLabel),settings:Object.fromEntries(['temperature','topP','maxOutputTokens'].filter(k=>typeof c.settings?.[k]==='number'&&Number.isFinite(c.settings[k])).map(k=>[k,c.settings[k]])),partial:c.partial===true};});
    if(!calls.length)return null;
    const key=typeof s.key==='string'&&/^run_[\w-]{1,100}:[\w-]{1,40}$/.test(s.key)?s.key:s.runId+':'+calls[0].id;
    const rawRecords=Array.isArray(s.records)?s.records:s.turnUsage&&typeof s.turnUsage==='object'?[{...s.turnUsage,id:null,kind:'usage'}]:[];
    const mid=v=>typeof v==='string'&&/^[\w-]{4,128}$/.test(v)?v:null,fnum=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
    const records=rawRecords.slice(0,TURN_CALL_LIMIT).filter(r=>r&&typeof r==='object').map(r=>({id:SPAN.test(r.id||'')?r.id:null,at:iso(r.at),kind:r.kind==='cost'?'cost':'usage',internal:label(r.internal),messageId:mid(r.messageId),input:number(r.input),output:number(r.output),reasoning:number(r.reasoning),total:number(r.total)}));
    const costs=(Array.isArray(s.costs)?s.costs:[]).slice(0,4).filter(c=>c&&typeof c==='object').map(c=>({id:SPAN.test(c.id||'')?c.id:null,at:iso(c.at),internal:label(c.internal),messageId:mid(c.messageId),fields:(Array.isArray(c.fields)?c.fields:[]).slice(0,24).flatMap(f=>f&&typeof f.path==='string'&&/^\$[\w.-]{0,400}$/.test(f.path)&&typeof f.key==='string'&&f.key.length<=120&&(fnum(f.value)!==null||label(f.value))?[{path:f.path,key:f.key,value:fnum(f.value)??label(f.value)}]:[])}));
    const c=s.credits&&typeof s.credits==='object'?s.credits:null,credits=c?(()=>{const out={credits:fnum(c.credits),usd:fnum(c.usd),actualUsd:fnum(c.actualUsd),source:['message','new','session'].includes(c.source)?c.source:null,keys:(Array.isArray(c.keys)?c.keys:[]).filter(k=>typeof k==='string'&&/^[\w-]{1,128}$/.test(k)).slice(0,8),parts:(Array.isArray(c.parts)?c.parts:[]).slice(0,8).filter(p=>p&&typeof p==='object').map(p=>({key:typeof p.key==='string'&&/^[\w-]{1,128}$/.test(p.key)?p.key:null,credits:fnum(p.credits),usd:fnum(p.usd),actualUsd:fnum(p.actualUsd),strategy:label(p.strategy),multiplier:fnum(p.multiplier),margin:fnum(p.margin),fallback:p.fallback===true})),session:c.session&&typeof c.session==='object'?{credits:fnum(c.session.credits),chargedUsd:fnum(c.session.chargedUsd),actualUsd:fnum(c.session.actualUsd),messages:fnum(c.session.messages)}:null,balance:c.balance&&typeof c.balance==='object'?{before:fnum(c.balance.before),beforeAt:iso(c.balance.beforeAt),after:fnum(c.balance.after),afterAt:iso(c.balance.afterAt),delta:fnum(c.balance.delta)}:null,at:iso(c.at)};return out.credits!==null||out.session||out.balance?out:null;})():null;
    return{version:2,key,sid:s.sid,runId:s.runId,turn:number(s.turn),attempt:number(s.attempt)||1,segment:number(s.segment)||0,resumed:s.resumed===true,at:iso(s.at)||new Date().toISOString(),startedAt:iso(s.startedAt),revision:number(s.revision)||0,prompt:typeof s.prompt==='string'?s.prompt.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,40):null,sentAt:iso(s.sentAt),calls,count:number(s.count)??calls.length,prior:number(s.prior)||0,internalNames:(Array.isArray(s.internalNames)?s.internalNames:[]).map(label).filter(Boolean).slice(0,6),records,costs,credits,routing:s.routing&&typeof s.routing==='object'?{from:label(s.routing.from),to:label(s.routing.to),waitMs:number(s.routing.waitMs),at:iso(s.routing.at),committed:s.routing.committed===true,reason:typeof s.routing.reason==='string'?s.routing.reason.slice(0,300):null,cause:typeof s.routing.cause==='string'?s.routing.cause.slice(0,120):null}:null,outcome:['failed','empty'].includes(s.outcome)?s.outcome:null,partial:s.partial===true,raw:sanitizeRaw(s.raw)};
  }

  // 2. 逐行解析；一条坏消息不应终止整个读流循环。
  class Lines {
    constructor(onJSON,onIssue=()=>{}){this.onJSON=onJSON;this.onIssue=onIssue;this.decoder=new TextDecoder();this.buffer='';this.pending='';this.discard=false;}
    feed(bytes){
      const text=typeof bytes==='string'?bytes:this.decoder.decode(bytes,{stream:true});this.buffer+=text;
      let i;while((i=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,i).replace(/\r$/,'');this.buffer=this.buffer.slice(i+1);if(this.discard){this.discard=false;continue;}this.line(line);}
      if(this.buffer.length>2*1024*1024){this.buffer='';this.pending='';this.discard=true;this.onIssue('单行过大，已跳过；后续流仍继续解析');}
    }
    line(line){
      let s=line.trim();if(!s){this.pending='';return;}if(/^(event:|id:|retry:|:)/.test(s))return;
      if(s.startsWith('data:'))s=s.slice(5).trim();if(!s||s==='[DONE]')return;
      let value;try{value=JSON.parse(this.pending?this.pending+'\n'+s:s);this.pending='';}catch{if((this.pending||/^[\[{]/.test(s))&&this.pending.length+s.length<2*1024*1024)this.pending=this.pending?this.pending+'\n'+s:s;return;}
      try{this.onJSON(value);}catch(e){this.onIssue('帧处理异常',e);}
    }
    end(){if(!this.discard&&this.buffer.trim())this.line(this.buffer);this.buffer='';this.pending='';}
  }
  function inspect(node,onToken,onType,depth=0) {
    if(!node||typeof node!=='object'||depth>6)return;
    if(Array.isArray(node)){for(const v of node.slice(0,3000))inspect(v,onToken,onType,depth+1);return;}
    const headers=Array.isArray(node.headers)?node.headers:node.headers&&typeof node.headers==='object'?Object.entries(node.headers):[];
    for(const h of headers)if(Array.isArray(h)&&String(h[0]).toLowerCase()==='public-access-token'&&typeof h[1]==='string')onToken(h[1]);
    if(typeof node.type==='string'&&/^(start|start-step|finish|finish-step|text-start|text-delta|text-end|reasoning-start|reasoning-delta|reasoning-end|message-metadata|error|abort)$/.test(node.type))onType(node.type,node);
    if(Array.isArray(node.records))inspect(node.records,onToken,onType,depth+1);
    for(const key of ['body','data','message','response','payload','event']) {
      let v=node[key];if(typeof v==='string'&&/^[\[{]/.test(v.trim())){try{v=JSON.parse(v);}catch{continue;}}
      if(v&&typeof v==='object')inspect(v,onToken,onType,depth+1);
    }
    // 正文 delta 字符串不会被当作协议对象解析。
  }
  if(typeof window==='undefined'){if(typeof module!=='undefined')module.exports={get,authorized,configs,effort,hint,reported,plan,detail,snapshot,Lines,inspect,sidOf,streamSid,localSnapshot,pickName,nextName,promptPreview,trimRaw,trimSpan,sanitizeRaw,toMs,toDurationMs,uuidTime,stamp,quotaOf,quotaView,until,costFields,costSummary,creditsOf,resolveTurnCredits,CREDITS_PER_USD,BUDGET_OPTIONS};return;}
  if(window.top!==window.self)return;
  if(window.__AMP_LITE__?.version===VERSION)return;
  window.__AMP_LITE__?.stop?.();

  // 3. 页面上下文原生 fetch：不使用 unsafeWindow、GM 请求或跨上下文桥。
  let native=window.fetch;
  for(let i=0;i<8&&native?.__orig&&native.__orig!==native;i++)native=native.__orig;
  const rawFetch=native.bind(window), runs=new Map(), submissions=new Map(), readers=new Set(), logs=[], rawStore=new Map(), recentPosts=new Map();
  const load=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
  const store=(key,value)=>{try{return ampStore.set(key,JSON.stringify(value));}catch{return false;}};
  const clamp=(v,min,max,fallback)=>Number.isFinite(v)?Math.min(max,Math.max(min,Math.round(v))):fallback;
  const stored=load(KEY+'.prefs',{}), prefs={width:clamp(stored.width,280,720,340),sidebarWidth:clamp(stored.sidebarWidth,200,560,null),cloudSync:stored.cloudSync===true,cloudFormat:stored.cloudFormat==='name'?'name':'prefix',rawBudget:BUDGET_OPTIONS.includes(stored.rawBudget)?stored.rawBudget:64,showSent:stored.showSent!==false,showQuota:stored.showQuota!==false,showCredits:stored.showCredits!==false,showBar:stored.showBar!==false,barCollapsed:stored.barCollapsed===true,barOffset:stored.barOffset!==false,showSeq:stored.showSeq===true,hideDocIcon:stored.hideDocIcon!==false,stopOnResample:stored.stopOnResample!==false,showQuotaReset:stored.showQuotaReset===true};
  // 手机/窄屏：底部只留一条余额栏，点击余额栏才展开模型信息
  const miniBar=()=>innerWidth<768||!!document.getElementById('amp-lite-dock')?.hasAttribute('data-compact');
  const savePrefs=()=>store(KEY+'.prefs',prefs);
  let history=load(KEY+'.history',[]);if(!Array.isArray(history))history=[];history=history.map(x=>{const s=localSnapshot(x);return s?{...s,raw:{events:[],spans:{}}}:null;}).filter(Boolean).slice(0,20);
  let stopped=false,enabled=true,cooldown=0,pendingNew=null,lastRoute=location.pathname,frames=0,queries=0,ui=null,paintTimer=0,revision=0,onLog=null,onSnapshot=null,onSent=null;
  // 限流 / 额度状态：服务端按窗口计数、与标签页无关，所以放在 localStorage 并监听 storage 事件同步；窗口过后保留最后一次观测值（见 quotaView）
  const quotaShape=q=>q&&typeof q==='object'?{at:number(q.at)??0,status:number(q.status),limit:number(q.limit),remaining:number(q.remaining),resetAt:number(q.resetAt),blocked:q.blocked===true,window:number(q.window),kind:['agent-daily','daily-spend','model','generic'].includes(q.kind)?q.kind:null,reason:label(q.reason)}:null;
  const balanceShape=b=>b&&typeof b==='object'&&number(b.remaining)!==null?{remaining:number(b.remaining),daily:number(b.daily),refreshAt:number(b.refreshAt),at:number(b.at)??0}:null;
  let quota={chat:quotaShape(load(KEY+'.quota',{})?.chat),append:quotaShape(load(KEY+'.quota',{})?.append)},balance=balanceShape(load(KEY+'.balance',null)),balanceAt=0,balanceFail=0,balanceTimer=0,balanceResetTimer=0;
  const hhmm=ms=>Number.isFinite(ms)?new Date(ms).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'}):'--:--';
  // 已知不可用的可选接口：记住结果，冷却期内不再请求，也不再刷日志。
  const DENY_KEY='amp.lite.v2.deny';let deny={};try{deny=JSON.parse(localStorage.getItem(DENY_KEY))||{};}catch{}
  const denied=k=>(deny[k]||0)>Date.now();
  function denyFor(k,ms){const first=!denied(k);deny[k]=Date.now()+ms;ampStore.set(DENY_KEY,JSON.stringify(deny));return first;}
  function undeny(k){if(deny[k]){delete deny[k];ampStore.set(DENY_KEY,JSON.stringify(deny));}}
  function errorText(e){const s=(e?.name?e.name+': ':'')+(e?.message||String(e||''));return s.replace(/Bearer\s+\S+|eyJ[\w-]+\.[\w-]+\.[\w-]+/gi,'[令牌已隐藏]').slice(0,200);}
  function log(level,stage,text,e,ctx){const row={at:new Date().toISOString(),level,stage,text:text+(e?' · '+errorText(e):''),sid:ctx?.sid??sidOf(location.href),runId:RUN.test(ctx?.runId||'')?ctx.runId:null,spanId:SPAN.test(ctx?.spanId||'')?ctx.spanId:null};logs.push(row);if(logs.length>600)logs.shift();try{onLog?.(row);}catch{}paint();}
  legacyDisplay.onchange=()=>paint();
  gacha.setPaint(()=>paint());
  // ---------------- 美元额度（移植 probe-usd-stable v2.0.0 usd-quota 规则）----------------
  // 只取最新一轮最后一条 spend.recorded（cost）记录；要求 partial===false、本轮未截断；不回退到更早的轮次。
  const finiteNum=v=>typeof v==='number'&&Number.isFinite(v);
  const usdLabel=v=>typeof v==='string'&&v.length<=120&&!/[\u0000-\u001f\u007f]/.test(v)&&!/Bearer |^eyJ/.test(v)?v:null;
  function usdFields(p){
    const g=k=>get(p,k),out={allowanceUsd:finiteNum(g('allowanceUsd'))&&g('allowanceUsd')>=0?g('allowanceUsd'):null,balanceRemainingUsd:finiteNum(g('balanceRemainingUsd'))?g('balanceRemainingUsd'):null,
      chargedUserTotalUsd:finiteNum(g('chargedUserTotalUsd'))&&g('chargedUserTotalUsd')>=0?g('chargedUserTotalUsd'):null,allowanceTier:usdLabel(g('allowanceTier')),allowanceSource:usdLabel(g('allowanceSource')),
      windowStartAtMs:Number.isSafeInteger(g('windowStartAtMs'))&&g('windowStartAtMs')>=0&&g('windowStartAtMs')<=8640000000000000?g('windowStartAtMs'):null,overLimit:typeof g('overLimit')==='boolean'?g('overLimit'):null,
      costUsd:finiteNum(g('costUsd'))&&g('costUsd')>=0?g('costUsd'):null,chargedUsd:finiteNum(g('chargedUsd'))&&g('chargedUsd')>=0?g('chargedUsd'):null,unpriced:typeof g('unpriced')==='boolean'?g('unpriced'):null};
    return out.allowanceUsd===null&&out.balanceRemainingUsd===null?null:out;
  }
  const usdShape=u=>u&&typeof u==='object'&&finiteNum(u.allowanceUsd)&&finiteNum(u.balanceRemainingUsd)&&number(u.at)!==null?u:null;
  let usd=usdShape(load(KEY+'.usd',null));
  function noteUsd(r,p){
    if(!r?.data||p.limited)return;
    const costs=p.records.filter(e=>e.kind==='cost'),last=costs[costs.length-1];if(!last)return;
    const d=r.cache.get(last.id);if(!d?.available||d.partial||!d.usd)return;
    const u=d.usd;if(!finiteNum(u.allowanceUsd)||u.allowanceUsd<0||!finiteNum(u.balanceRemainingUsd))return;
    const spanAt=last.at||Date.now();if(usd&&usd.spanAt&&spanAt<usd.spanAt)return;
    if(usd&&usd.spanId===last.id)return;
    usd={...u,sid:r.sid,runId:r.runId,turn:p.turn,spanId:last.id,spanAt,at:Date.now()};store(KEY+'.usd',usd);
    log('info','美元额度','剩余 $'+u.balanceRemainingUsd.toFixed(2)+' / 总额度 $'+u.allowanceUsd.toFixed(2)+(u.overLimit?' · 已超限':'')+' · 第 '+(p.turn??'?')+' 轮计费记录',null,r);paint();
  }
  // ---------------- Pulse（/api/me/pulse，与 9.23.2 页脚一致：10 分钟一次；被限流不提前重试）----------------
  const pulseShape=v=>v&&typeof v==='object'&&['ready','signed-out','forbidden','rate-limited','server-error','invalid','network-error','timeout'].includes(v.status)?v:null;
  let pulse=pulseShape(load(KEY+'.pulse',null)),pulseBusy=false;
  async function refreshPulse(force=false){
    if(stopped||!enabled||pulseBusy||!prefs.showBar)return;if(!force&&pulse&&Date.now()-pulse.checkedAt<600000)return;
    pulseBusy=true;const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),8000);let next;
    try{const res=await rawFetch(location.origin+'/api/me/pulse',{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:ctrl.signal});
      if(res.status===401)next={status:'signed-out'};else if(res.status===403)next={status:'forbidden'};else if(res.status===429)next={status:'rate-limited'};else if(!res.ok)next={status:'server-error'};
      else if(!/application\/json/i.test(res.headers.get('content-type')||''))next={status:'invalid'};
      else{const j=await res.json(),ok=Number.isInteger(j?.pulse)&&j.pulse>=0&&j.pulse<=100,t=typeof j?.refreshedAt==='string'&&j.refreshedAt.length<=64?Date.parse(j.refreshedAt):NaN;next=ok?{status:'ready',pulse:j.pulse,refreshedAt:Number.isFinite(t)?t:null}:{status:'invalid'};}
    }catch(e){next={status:ctrl.signal.aborted?'timeout':'network-error'};}
    finally{clearTimeout(timer);pulseBusy=false;}
    // 失败时保留上一次的有效数值，只更新状态
    pulse={...(pulse?.status==='ready'||next.status==='ready'?{pulse:pulse?.pulse,refreshedAt:pulse?.refreshedAt}:{}),...next,checkedAt:Date.now()};store(KEY+'.pulse',pulse);paint();
  }
  // ---------------- 抽卡引擎所需的只读接口 ----------------
  function runFor(sid){
    const r=[...runs.values()].filter(x=>x.sid===sid).at(-1);if(!r)return null;
    const fresh=r.data&&r.data.revision===r.revision;
    return {sid:r.sid,runId:r.runId,submittedAt:r.submittedAt||0,busy:!!r.busy||!!r.timer,phase:r.phase||'',
      data:fresh?{calls:r.data.calls.map(c=>({model:c.model,request:c.request,response:c.response,internal:c.internal,effort:c.effort?.value||null})),internalNames:[...r.data.internalNames],partial:r.data.partial,routing:r.data.routing||null}:null,prompt:r.prompt||null};
  }
  function huntLive(){
    const blocks=[quota.chat,quota.append].filter(q=>q?.blocked&&(!q.resetAt||q.resetAt>Date.now()));
    return {blocked:Date.now()<cooldown?'Trace 接口限流冷却中（无法识别模型）':blocks.length?'消息额度或速率限制（'+blocks.map(q=>q.reason||('HTTP '+(q.status||429))).join('；')+'）':balance?.remaining===0&&!(balance.refreshAt&&balance.refreshAt<=Date.now())?'账户剩余额度为零':null};
  }
  // ---------------- 底部信息栏 ----------------
  const BAR_H=24;
  let bar=null;
  function mountBar(){
    if(bar||stopped||!document.body)return;
    const host=document.createElement('div');host.id='amp-native-bar';document.body.append(host);const root=host.attachShadow({mode:'open'});
    const barCss=`:host{all:initial;position:fixed;left:0;right:0;bottom:0;z-index:30;height:${BAR_H}px;display:block;font:400 11px/1 var(--font-basel-grotesk,var(--font-inter,system-ui)),'PingFang SC','Microsoft YaHei',sans-serif;
--bg:hsl(var(--surface-primary,36 45% 98%));--raised:hsl(var(--surface-tertiary,33 31% 94%));--line:hsl(var(--border-faint,30 5% 90%));--fg:hsl(var(--text-primary,24 6% 17%));--muted:hsl(var(--text-tertiary,35 6% 42%));--good:hsl(var(--interactive-positive,125 49% 38%));--warn:hsl(var(--syntax-yellow,40 92% 38%));--bad:#c2410c;color:var(--fg)}
:host([hidden]){display:none!important}:host([data-collapsed]){left:auto;right:8px;bottom:6px;height:auto}
.bar{box-sizing:border-box;height:${BAR_H}px;display:flex;align-items:center;gap:0;padding:0 8px 0 24px;background:var(--bg);border-top:1px solid var(--line);white-space:nowrap;overflow:hidden}
.items{display:flex;align-items:center;min-width:0;flex:1;overflow:hidden;gap:0}
.it{display:inline-flex;align-items:center;gap:4px;padding:0 9px;height:${BAR_H}px;border-left:1px solid var(--line);color:var(--muted);cursor:default;flex:none}
.it:first-child{border-left:0;padding-left:0}.it b{font-weight:500;color:var(--fg);font-variant-numeric:tabular-nums}
.it[data-state=good] b{color:var(--good)}.it[data-state=warn] b{color:var(--warn)}.it[data-state=low] b,.it[data-state=blocked] b{color:var(--bad)}
.dot{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.7}.it[data-state=good] .dot{color:var(--good)}.it[data-state=warn] .dot{color:var(--warn)}.it[data-state=low] .dot{color:var(--bad)}
.meter{width:36px;height:4px;border-radius:2px;background:var(--line);overflow:hidden}.meter i{display:block;height:100%;background:currentColor}
.it[data-state=good] .meter{color:var(--good)}.it[data-state=warn] .meter{color:var(--warn)}.it[data-state=low] .meter{color:var(--bad)}
.it.click{cursor:pointer}.it.click:hover{background:var(--raised)}
.it[data-key=usd] .meter{color:var(--amp-acc,#6a5e54)!important}.it[data-state=good] b,.it[data-state=good] .dot,.it[data-state=good] .meter{color:var(--amp-acc,#6a5e54)!important}.it b.pct{font-weight:600;color:var(--amp-acc,#6a5e54)}.it[data-key=usd]{cursor:default}
.tip{position:fixed;z-index:5;left:8px;bottom:${BAR_H+8}px;display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:14px;box-shadow:0 8px 28px #0000002a,0 1px 3px #0000000f;font:400 12px/1.4 var(--font-basel-grotesk,var(--font-inter,system-ui)),'PingFang SC','Microsoft YaHei',sans-serif;white-space:nowrap;opacity:0;transform:translateY(6px) scale(.97);transform-origin:bottom left;transition:opacity .18s ease,transform .22s cubic-bezier(.22,.9,.3,1);pointer-events:none}
.tip[data-show]{opacity:1;transform:none}.tip svg{width:88px;height:88px;flex:none;display:block}.tip .arc{transition:stroke-dasharray .6s cubic-bezier(.22,.9,.3,1)}
.tip .pc{font-size:15px;font-weight:700;fill:var(--amp-acc,#6a5e54);font-variant-numeric:tabular-nums}
.tip .info{display:flex;flex-direction:column;gap:2px;min-width:0}.tip .lab{font-size:11px;color:var(--muted)}
.tip .big{font-size:26px;line-height:1.15;font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums;color:var(--fg)}
.tip .sub{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}.tip .sub b{font-weight:600;color:var(--fg)}
.tip .foot{font-size:10px;color:var(--muted);margin-top:3px}
@media (prefers-reduced-motion:reduce){.tip,.tip .arc{transition:none}}
.tools{display:flex;align-items:center;gap:2px;flex:none;margin-left:6px}
button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:20px;min-width:20px;padding:0 6px;border-radius:4px;color:var(--muted);cursor:pointer;font:inherit}
button:hover{background:var(--raised);color:var(--fg)}button:focus-visible{outline:2px solid var(--fg);outline-offset:1px}
svg{width:12px;height:12px;display:block}.pill{display:none;border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:4px 8px;box-shadow:0 1px 4px #0001}
:host([data-collapsed]) .bar{display:none}:host([data-collapsed]) .pill{display:inline-flex;gap:6px}
.detail{display:none;flex:none;margin-left:6px;height:18px;padding:0 8px;border-radius:9px;border:1px solid var(--line);color:var(--fg);font-size:11px}:host([data-mini]) .detail{display:inline-flex}:host([data-mini]) .bar{padding-right:6px}:host([data-mini]) .tools{display:none}:host([data-mini]) .bar{cursor:default}:host([data-mini]) .it[data-key=usd]{cursor:pointer}:host([data-mini]) .it{border-left:0;padding:0 8px}:host([data-mini]) .it:first-child{padding-left:0}:host([data-mini]) .meter{width:44px}`;
    let sheet;try{sheet=new CSSStyleSheet();sheet.replaceSync(barCss);root.adoptedStyleSheets=[sheet];}catch{el('style','',barCss,root);}
    const wrap=el('div','bar',null,root),items=el('div','items',null,wrap),tools=el('div','tools',null,wrap);
    // 悬浮美金额度：圆环饼图（余额 / 已用）+ 总额度与余额，替代原来的文字提示。
    const tip=el('div','tip',null,root);tip.setAttribute('role','tooltip');let tipTimer=0;
    function showTip(anchor){
      clearTimeout(tipTimer);if(!usd){tip.removeAttribute('data-show');return;}
      const total=usd.allowanceUsd,rem=usd.balanceRemainingUsd,pct=total>0?Math.max(0,Math.min(100,rem/total*100)):0,used=Math.max(0,total-rem);
      const R=38,C=2*Math.PI*R,f=v=>'$'+(+v).toFixed(2),low=usd.overLimit||pct<20;
      const acc=low?'var(--bad)':'var(--amp-acc,#6a5e54)';
      const fm=v=>'$'+(+v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
      tip.innerHTML='<svg viewBox="0 0 88 88" aria-hidden="true"><circle cx="44" cy="44" r="'+R+'" fill="none" stroke="var(--line)" stroke-width="7"/>'
        +'<circle class="arc" cx="44" cy="44" r="'+R+'" fill="none" stroke="'+acc+'" stroke-width="7" stroke-linecap="round" stroke-dasharray="0 '+C+'" transform="rotate(-90 44 44)"/>'
        +'<text class="pc" x="44" y="44" dy=".35em" text-anchor="middle"'+(low?' style="fill:var(--bad)"':'')+'>'+(Math.round(pct*10)/10)+'%</text></svg>'
        +'<div class="info"><span class="lab">剩余金额</span><span class="big"'+(low?' style="color:var(--bad)"':'')+'>'+fm(rem)+'</span><span class="sub">总额度 <b>'+fm(total)+'</b></span>'
        +'<span class="foot">'+(usd.overLimit?'已超限 · ':'')+'更新于 '+ago(usd.at)+'</span></div>';
      const r=anchor.getBoundingClientRect();tip.style.left=Math.max(8,Math.min(r.left,innerWidth-tip.offsetWidth-8))+'px';
      tip.setAttribute('data-show','');
      requestAnimationFrame(()=>{const a=tip.querySelector('.arc');if(a)a.setAttribute('stroke-dasharray',(C*pct/100).toFixed(1)+' '+C.toFixed(1));});
    }
    const hideTip=()=>{clearTimeout(tipTimer);tipTimer=setTimeout(()=>tip.removeAttribute('data-show'),120);};
    // 手机（窄屏）：点美金只弹出金额卡片；右侧“详细”按钮才打开模型信息
    wrap.onclick=e=>{if(!miniBar())return;const it=e.target.closest?.('.it[data-key=usd]');if(it){e.stopPropagation();if(tip.hasAttribute('data-show'))tip.removeAttribute('data-show');else showTip(it);}};
    const detailBtn=el('button','detail','详细',wrap);detailBtn.title='打开模型信息';detailBtn.onclick=e=>{e.stopPropagation();tip.removeAttribute('data-show');ui?.toggle();};
    document.addEventListener('pointerdown',e=>{if(tip.hasAttribute('data-show')&&!e.composedPath().includes(host))tip.removeAttribute('data-show');},true);
    const pill=el('button','pill','',root);pill.title='展开底部信息栏';pill.onclick=()=>{prefs.barCollapsed=false;savePrefs();sync();};
    const refreshBtn=el('button','','',tools);refreshBtn.title='立即刷新额度、Pulse 与余额';refreshBtn.setAttribute('aria-label',refreshBtn.title);
    refreshBtn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>';
    refreshBtn.onclick=()=>{void refreshBalance(true);void refreshPulse(true);paint();};
    const panelBtn=el('button','','模型信息',tools);panelBtn.title='打开模型信息侧栏';panelBtn.onclick=()=>ui?.show();
    const hideBtn=el('button','','',tools);hideBtn.title='收起底部信息栏';hideBtn.setAttribute('aria-label',hideBtn.title);
    hideBtn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>';hideBtn.onclick=()=>{prefs.barCollapsed=true;savePrefs();sync();};
    const offsetCss=`html[data-amp-bar-offset] body .h-dvh,html[data-amp-bar-offset] body .h-screen,html[data-amp-bar-offset] body .h-svh{height:calc(100dvh - ${BAR_H}px)!important}html[data-amp-bar-offset] body .max-h-dvh,html[data-amp-bar-offset] body .max-h-screen{max-height:calc(100dvh - ${BAR_H}px)!important}html[data-amp-bar-overlap] main{padding-bottom:${BAR_H}px!important;box-sizing:border-box!important}`;
    let offsetSheet=null,offsetStyle=null;try{offsetSheet=new CSSStyleSheet();offsetSheet.replaceSync(offsetCss);document.adoptedStyleSheets=[...document.adoptedStyleSheets,offsetSheet];}catch{offsetStyle=el('style','',offsetCss,document.head||document.body);}
    const fmtUsd=v=>(v<0?'-$':'$')+Math.abs(v).toFixed(2),exactUsd=v=>'$'+String(v);
    const clock=t=>Number.isFinite(t)?new Date(t).toLocaleTimeString('zh-CN',{hour12:false}):'--:--:--';
    const ago=t=>{if(!Number.isFinite(t))return '';const d=Date.now()-t;return d<60000?'刚刚':d<3600000?Math.floor(d/60000)+' 分钟前':d<86400000?Math.floor(d/3600000)+' 小时前':Math.floor(d/86400000)+' 天前';};
    let stamp='';
    function item(key,state,parts,title,onclick){return {key,state,parts,title,onclick};}
    function build(){
      const out=[],now=Date.now();
      if(usd){const pct=usd.allowanceUsd>0?usd.balanceRemainingUsd/usd.allowanceUsd*100:null,state=usd.overLimit||usd.balanceRemainingUsd<0?'low':pct===null?'':pct>=50?'good':pct>=20?'warn':'low';
        out.push(item('usd',state,[['meter',pct===null?0:Math.max(0,Math.min(100,pct))],['t','美金 '],['b',fmtUsd(usd.balanceRemainingUsd)],['t',' / '+fmtUsd(usd.allowanceUsd)],['p',pct!==null?' · '+Math.round(pct)+'%':''],['t',usd.overLimit?' · 已超限':'']],
          '美元额度（来自 Trace spend.recorded，最新一轮最后一条已结算记录）\n剩余 '+exactUsd(usd.balanceRemainingUsd)+'\n总额度 '+exactUsd(usd.allowanceUsd)+(usd.chargedUserTotalUsd!==null?'\n窗口内已计费 '+exactUsd(usd.chargedUserTotalUsd):'')+(usd.allowanceTier?'\n档位 '+usd.allowanceTier:'')+(usd.allowanceSource?'\n来源 '+usd.allowanceSource:'')+(usd.windowStartAtMs?'\n窗口开始 '+new Date(usd.windowStartAtMs).toLocaleString('zh-CN',{hour12:false}):'')+(usd.chargedUsd!==null?'\n该条计费 '+exactUsd(usd.chargedUsd):'')+'\n记录于 '+new Date(usd.at).toLocaleString('zh-CN',{hour12:false})+'（'+ago(usd.at)+'）\n每次对话结束后自动更新；这是服务端快照，不是实时余额',miniBar()?()=>ui?.toggle():null));
      }else out.push(item('usd','',[['t','美金 '],['b','—']],'尚无美元额度快照：完成一轮对话后，从该轮 Trace 的计费记录读取',null));
      const mini=miniBar();
      // Pulse（GET /api/me/pulse，0–100 的整数）是 Arena 的独立指标，并非美元余额；两者数值相同时并入美金一项，不再重复显示。
      const usdPct=usd&&usd.allowanceUsd>0?Math.round(usd.balanceRemainingUsd/usd.allowanceUsd*100):null;
      const pulseSame=pulse?.status==='ready'&&typeof pulse.pulse==='number'&&usdPct!==null&&pulse.pulse===usdPct;
      if(pulse&&!mini&&!pulseSame){const ok=typeof pulse.pulse==='number',state=!ok?'':pulse.pulse>=50?'good':pulse.pulse>=20?'warn':'low';
        out.push(item('pulse',pulse.status==='ready'?state:'',[['t','脉冲额度 '],['b',ok?pulse.pulse+'%':'—'],['t',pulse.status!=='ready'?' · '+({'signed-out':'未登录',forbidden:'无权限','rate-limited':'限流',timeout:'超时','network-error':'网络错误','server-error':'服务错误',invalid:'格式异常'}[pulse.status]||pulse.status):'']],
          '脉冲额度（Arena Pulse，GET /api/me/pulse）· 与美金余额是两个不同的指标；数值与美金百分比相同时自动并入美金一项 · 每 10 分钟读取一次，点击立即刷新'+(pulse.refreshedAt?'\n服务端刷新于 '+new Date(pulse.refreshedAt).toLocaleString('zh-CN',{hour12:false}):'')+'\n读取于 '+clock(pulse.checkedAt),()=>void refreshPulse(true)));
      }
      if(balance){const stale=balance.refreshAt&&balance.refreshAt<=now,used=balance.daily?(balance.daily-balance.remaining)/balance.daily:0;
        out.push(item('credits',balance.remaining<=0&&!stale?'low':used>=0.5?'warn':'',[['t','额度 '],['b',balance.remaining.toLocaleString('zh-CN')+(balance.daily!==null?'/'+balance.daily.toLocaleString('zh-CN'):'')],['t',balance.refreshAt&&balance.refreshAt>now?' · '+until(balance.refreshAt,now).trim()+'重置':stale?' · 待刷新':'']],
          'GET /api/billing/balance（credits）· 读取于 '+clock(balance.at)+(balance.refreshAt?'\n重置时间 '+new Date(balance.refreshAt).toLocaleString('zh-CN',{hour12:false}):''),()=>void refreshBalance(true)));
      }
      if(!miniBar())for(const [kind,q] of [['chat',quota.chat],['append',quota.append]]){const v=quotaView(q,kind,now,prefs.showQuotaReset);if(v)out.push(item('q'+kind,v.cls==='blocked'?'blocked':v.cls==='low'?'warn':'',[['t',v.label+' '],['b',v.value],['t',v.tail||'']],v.title));}
      const r=selectedRun(),c=r?.data?.calls?.at(-1);
      if(mini){const g=gacha.state();if(g&&['running','stopping'].includes(g.status))out.push(item('gacha','good',[['t','抽卡 '],['b',g.completed+'/'+g.settings.maxAttempts]],'点击打开抽卡面板',()=>window.dispatchEvent(new CustomEvent('amp-native-gacha-open'))));return out;}
      if(c){const eff=c.effort?.value||({conflict:'冲突',unsupported:'不支持'}[c.effort?.status])||'';out.push(item('model','',[['t','模型 '],['b',(c.internal||c.model||'未提供').slice(0,48)],['t',eff?' · '+eff:'']],'当前会话最近一次模型调用\n请求 '+(c.request||'—')+'\n响应 '+(c.response||'—')+'\n内部 '+(c.internal||'—')+'\n显式档位 '+(eff||'未知'),()=>ui?.show()));}
      const sid=sidOf(location.href),cr=sid?costState.get(sid)?.credits||r?.data?.credits:null;
      if(cr&&cr.credits!==null&&cr.credits!==undefined)out.push(item('turn','',[['t','本轮 '],['b',Math.round(cr.credits).toLocaleString('zh-CN')+' cr'],['t',cr.usd!==null&&cr.usd!==undefined?' · $'+(+cr.usd).toFixed(4):'']],'GET /api/chat/{id}/cost · 本轮计费'));
      const g=gacha.state();
      if(g){const run=['running','stopping'].includes(g.status);out.push(item('gacha',run?'good':g.status==='hit'?'good':g.status==='paused'?'warn':'',[['t','抽卡 '],['b',g.completed+'/'+g.settings.maxAttempts],['t',' · '+(run?(g.phase||'进行中'):({hit:'已命中',done:'已完成',paused:'已暂停'}[g.status]||g.status))]],(g.reason||g.phase||'')+'\n点击打开抽卡面板',()=>window.dispatchEvent(new CustomEvent('amp-native-gacha-open'))));}
      const last=Math.max(usd?.at||0,pulse?.checkedAt||0,balance?.at||0);
      out.push(item('updated','',[['t','更新 '],['b',last?clock(last):'--:--:--']],'最近一次数据更新时间（美金 '+(usd?clock(usd.at):'—')+' · Pulse '+(pulse?clock(pulse.checkedAt):'—')+' · 额度 '+(balance?clock(balance.at):'—')+'）'));
      return out;
    }
    // 手机输入法弹出时：底栏和“给底栏让位”的高度改写都暂停，避免键盘上方留下一大块黑边
    // 手机：让输入法弹出时页面真正缩到键盘上方（Chrome/Edge 安卓的 interactive-widget），否则布局仍是整屏高、键盘上方空出一截
    const ensureVp=()=>{try{if(!matchMedia('(pointer:coarse)').matches)return;let m=document.querySelector('meta[name=viewport]');if(!m){m=document.createElement('meta');m.name='viewport';m.content='width=device-width, initial-scale=1';(document.head||document.documentElement).append(m);}const c=m.getAttribute('content')||'';if(!/interactive-widget/.test(c))m.setAttribute('content',c+(c?', ':'')+'interactive-widget=resizes-content');}catch{}};
    ensureVp();setTimeout(ensureVp,1500);setTimeout(ensureVp,5000);
    // 键盘弹出时：输入框底边到键盘的距离 = 输入框到屏幕左边的距离（按实际测量：先压掉外层底部留白，不够再整体下移）
    let kbBox=null,kbRaf=0;
    const kbClear=()=>{if(kbBox){kbBox.style.removeProperty('transform');kbBox.style.removeProperty('--amp-kb-dy');kbBox.style.removeProperty('z-index');kbBox.style.removeProperty('position');}kbBox=null;};
    // 整个输入面板 = 同时包含输入框和发送按钮、且有圆角边框/背景的那一层（不是内部的编辑区）
    const kbPanel=ed=>{let n=ed.parentElement;for(let i=0;i<12&&n&&n!==document.body&&n.tagName!=='MAIN';i++,n=n.parentElement){if(!n.querySelector('button[aria-label="Send message"],button[aria-label="发送消息"],button[type=submit]'))continue;const cs=getComputedStyle(n);if(parseFloat(cs.borderTopWidth)>0&&parseFloat(cs.borderTopLeftRadius)>=8)return n;}return null;};
    const kbFit=()=>{cancelAnimationFrame(kbRaf);kbRaf=requestAnimationFrame(()=>{try{
      if(!kbOpen()){kbClear();return;}
      const ed=document.activeElement;if(!ed?.closest?.('main'))return;
      if(!kbBox||!kbBox.isConnected||!kbBox.contains(ed)){kbClear();kbBox=kbPanel(ed);if(!kbBox)return;}
      const vv=window.visualViewport,vb=vv?vv.offsetTop+vv.height:innerHeight;
      const cur=parseFloat(kbBox.style.getPropertyValue('--amp-kb-dy')||'0')||0,r=kbBox.getBoundingClientRect();
      const want=Math.max(8,Math.round(r.left)),bottom=r.bottom-cur;
      // 面板底边到键盘 = 面板到屏幕左边的距离；整块面板（含发送按钮）一起上下移动，位移参与点击命中
      const dy=Math.max(-900,Math.min(600,Math.round(vb-want-bottom)));
      kbBox.style.setProperty('--amp-kb-dy',dy+'px');kbBox.style.setProperty('transform',dy?'translateY('+dy+'px)':'none','important');
      if(dy){if(getComputedStyle(kbBox).position==='static')kbBox.style.setProperty('position','relative');kbBox.style.setProperty('z-index','40');}
    }catch{}});};
    if(!document.getElementById('amp-kb-css')){const st=document.createElement('style');st.id='amp-kb-css';st.textContent='html[data-amp-kb] main{padding-bottom:0!important}';(document.head||document.documentElement).append(st);}
    let kbMax=0;const kbOpen=()=>document.documentElement.hasAttribute('data-amp-kb');
    const kbCheck=()=>{try{const vv=window.visualViewport,h=vv?vv.height:innerHeight;kbMax=Math.max(kbMax,innerHeight,h);const ae=document.activeElement,typing=!!ae&&(ae.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName));const kb=matchMedia('(pointer:coarse)').matches&&typing&&h<kbMax-120;if(kb!==kbOpen()){document.documentElement.toggleAttribute('data-amp-kb',kb);ensureVp();sync();}kbFit();}catch{}};
    window.visualViewport?.addEventListener('resize',kbCheck,{passive:true});window.visualViewport?.addEventListener('scroll',()=>{if(kbOpen())kbFit();},{passive:true});document.addEventListener('input',()=>{if(kbOpen())kbFit();},true);addEventListener('resize',kbCheck,{passive:true});addEventListener('orientationchange',()=>{kbMax=0;setTimeout(kbCheck,500);});document.addEventListener('focusin',()=>setTimeout(kbCheck,350),true);document.addEventListener('focusout',()=>setTimeout(kbCheck,350),true);
    function sync(){
      const eligible=prefs.showBar&&location.origin==='https://arena.ai'&&!kbOpen();host.hidden=!eligible;document.documentElement.style.setProperty('--amp-bar-h',eligible&&!prefs.barCollapsed?BAR_H+'px':'0px');host.toggleAttribute('data-collapsed',!!prefs.barCollapsed);
      const offset=eligible&&!prefs.barCollapsed&&prefs.barOffset;document.documentElement.toggleAttribute('data-amp-bar-offset',offset);
      if(!offset)document.documentElement.removeAttribute('data-amp-bar-overlap');
      else{const m=document.querySelector('main');if(m){const b=m.getBoundingClientRect().bottom;if(b>innerHeight-BAR_H+1&&!document.documentElement.hasAttribute('data-amp-bar-overlap'))document.documentElement.setAttribute('data-amp-bar-overlap','');}}
      if(!eligible)return;
      const mini=miniBar();host.toggleAttribute('data-mini',mini);if(mini&&prefs.barCollapsed){prefs.barCollapsed=false;savePrefs();host.removeAttribute('data-collapsed');}
      const list=build(),key=mini+JSON.stringify(list.map(x=>[x.key,x.state,x.parts,x.title]));
      pill.textContent=usd?'美金 '+fmtUsd(usd.balanceRemainingUsd):'信息栏';
      if(key===stamp)return;stamp=key;
      items.replaceChildren(...list.map(x=>{const s=el('span','it'+(x.onclick?' click':''));s.dataset.key=x.key;if(x.state)s.dataset.state=x.state;
        if(x.key==='usd'){s.onpointerenter=e=>{if(e.pointerType==='mouse'&&!miniBar())showTip(s);};s.onpointerleave=e=>{if(e.pointerType==='mouse'&&!miniBar())hideTip();};s.onfocus=()=>{if(!miniBar())showTip(s);};s.onblur=()=>{if(!miniBar())hideTip();};s.setAttribute('aria-label',x.parts.map(p=>p[0]==='meter'?'':p[1]).join(''));}else s.title=x.title;
        for(const [k,v] of x.parts){if(k==='meter'){const m=el('span','meter',null,s);el('i',null,null,m).style.width=v+'%';}else if(k==='b')el('b','',v,s);else if(k==='p'){if(v)el('b','pct',v,s);}else if(v)s.append(v);}
        if(x.onclick){s.tabIndex=0;s.setAttribute('role','button');s.onclick=x.onclick;s.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();x.onclick();}};}
        return s;}));
    }
    bar={host,sync,destroy(){if(offsetSheet)document.adoptedStyleSheets=document.adoptedStyleSheets.filter(s=>s!==offsetSheet);offsetStyle?.remove();document.documentElement.removeAttribute('data-amp-bar-offset');document.documentElement.removeAttribute('data-amp-bar-overlap');host.remove();}};sync();
  }
  function paint(){if(stopped||paintTimer)return;paintTimer=setTimeout(()=>{paintTimer=0;try{ui?.render();bar?.sync();}catch(e){console.warn('[AMP Lite] UI:',e?.name||'error',e?.message||'');}},100);}
  function selectedRun(){const sid=sidOf(location.href);return [...runs.values()].filter(r=>r.sid===sid).at(-1)||null;}
  const turnLabel=s=>!s?'':(s.turn?'第 '+s.turn+' 轮':'未标记轮次')+(s.attempt>1?' · 第 '+s.attempt+' 次':'')+(s.resumed?' · 续':'');
  function save(s){if(!s?.calls.some(c=>c.model&&c.model!=='未提供'))return;const c=localSnapshot(s);if(c){history=[{...c,raw:{events:[],spans:{}}},...history.filter(x=>x.key!==c.key)].slice(0,20);store(KEY+'.history',history.slice(0,6));}try{onSnapshot?.(s);}catch{}}
  // 内存中保留最近 RAW_KEEP 轮的完整原始 Trace 与 Span（持久化的是精简版）
  function keepRaw(r){if(!r.data)return;const key=r.data.key;rawStore.delete(key);rawStore.set(key,{trace:r.rawTrace,spans:r.rawSpans,probe:r.probe,at:Date.now()});while(rawStore.size>RAW_KEEP)rawStore.delete(rawStore.keys().next().value);}
  function later(r,ms=1200,final=false){if(stopped||!enabled||!r.token||Date.now()<cooldown)return;clearTimeout(r.timer);r.timer=setTimeout(()=>{r.timer=null;if(r.busy)later(r,400,final);else void poll(r,final);},ms);}
  function accept(token,sid){
    let auth;try{auth=authorized(token,sid);}catch(e){log('warn','权限',e.message,null,{sid});return;}
    let r=runs.get(auth.runId);
    if(r){if(r.sid!==auth.sid||r.rejectedToken===token)return;if(r.token!==token){r.token=token;r.expires=auth.expires;log('debug','权限','运行令牌已更新',null,r);if(r.phase!=='已读取'){r.tries=0;later(r);}}return;}
    const pending=submissions.get(auth.sid)||(pendingNew&&Date.now()-pendingNew.at<15000?pendingNew:null);
    r={...auth,token,revision:pending?.revision||++revision,requestConfigs:pending?.configs||[],prompt:pending?.prompt||null,submittedAt:pending?.at||null,baseline:null,markers:0,seen:new Set(),newest:null,tries:0,finalReads:0,busy:false,timer:null,abort:null,cache:new Map(),rawSpans:new Map(),rawTrace:[],missing:new Map(),probe:null,data:null,credits:costOf(auth.sid).credits,phase:'等待 Trace'};
    runs.set(auth.runId,r);while(runs.size>8){const [id,old]=runs.entries().next().value;clearTimeout(old.timer);old.abort?.abort();old.token=null;runs.delete(id);}
    pendingNew=null;log('detail','权限','检测到运行令牌 · '+r.runId+' · 有效期至 '+new Date(r.expires).toLocaleTimeString('zh-CN'),null,r);later(r,1600);paint();
  }
  // 首包提示：在页面发出的用户消息末尾追加一句，让模型先输出“思考中…”，服务端尽早收到首包，避免约 90 秒无首包被改派。
  function warmBody(url,body){
    try{
      const gs=gacha.settings();if(!gs.warmup||gacha.running())return null;
      if(typeof body!=='string'||body.length>1048576){try{const u=new URL(url,location.href);if(/(\/in\/append|\/stream\/create-chat)$/.test(u.pathname))log('warn','首包提示','消息请求体不是文本（'+(body?.constructor?.name||typeof body)+'），未追加',null,{});}catch{}return null;}
      const u=new URL(url,location.href);if(u.origin!==location.origin||!/(\/in\/append|\/stream\/create-chat)$/.test(u.pathname))return null;
      const j=JSON.parse(body),kind=typeof j.kind==='string'?j.kind:typeof j.type==='string'?j.type:'';
      if(kind&&kind!=='message'||/regenerate/i.test(j.trigger||j.payload?.trigger||''))return null;
      const tip=gs.warmupText.trim(),add='\n\n'+tip;let done=false,dup=false;
      // 与 promptPreview 同一套查找规则：第一个用户节点里的 text/content/prompt/message/input 字符串
      (function walk(n,depth){if(done||dup||!n||typeof n!=='object'||depth>7)return;if(Array.isArray(n)){for(const v of n){walk(v,depth+1);if(done||dup)return;}return;}
        if(n.role&&n.role!=='user')return;
        for(const [k,v] of Object.entries(n))if(typeof v==='string'&&/^(text|content|prompt|message|input)$/.test(k)&&v.trim()){if(v.includes(tip))dup=true;else{n[k]=v+add;done=true;}return;}
        for(const v of Object.values(n)){walk(v,depth+1);if(done||dup)return;}})(Array.isArray(j.messages)?[...j.messages].reverse().find(m=>m?.role==='user')||j:j,0);
      if(dup)return null;
      if(!done){log('warn','首包提示','未找到消息正文字段，未追加 · 键 '+Object.keys(j).slice(0,8).join(','),null,{});return null;}log('detail','首包提示','已在本条消息末尾追加首包提示',null,{sid:streamSid(url)||sidOf(location.href)});return JSON.stringify(j);
    }catch{return null;}
  }
  const WARMUP_DEFAULT='（请先立即单独输出一行“思考中…”，然后再开始思考并完成任务；需要分析的内容直接写在回复正文里。）';
  function notePost(path,kind,sid){const k=path+'|'+kind,now=Date.now();if(now-(recentPosts.get(k)||0)<1500)return;recentPosts.set(k,now);if(recentPosts.size>60)recentPosts.delete(recentPosts.keys().next().value);log('detail','请求','POST '+path.slice(0,160)+(kind?' · kind='+kind:''),null,{sid});}
  function requestSeen(url,body){
    if(!enabled)return;
    let u;try{u=new URL(url,location.href);}catch{return;}
    if(u.origin!==location.origin)return;
    let j={};if(typeof body==='string'&&body.length<1048576){try{j=JSON.parse(body);}catch{}}
    const kind=label(typeof j.kind==='string'?j.kind:typeof j.type==='string'?j.type:'')||null;
    if(['ping','heartbeat'].includes(kind))return;
    const sid=streamSid(url)||sidOf(location.href), session=/(\/in\/append|\/stream\/create-chat)$/.test(u.pathname);
    // 会话相关的其他 POST（反馈、撤回等）只记路径，便于核对页面行为
    if(!session){if(/^\/(api|ai-proxy|agent)\//.test(u.pathname)&&!/\/(events|spans)\b|telemetry|analytics|metrics|logs?\b|ping|heartbeat|presence/i.test(u.pathname))notePost(u.pathname,kind,sid);return;}
    notePost(u.pathname,kind,sid);
    const continuation=kind&&kind!=='message'||/regenerate/i.test(j.trigger||j.payload?.trigger||'');
    if(continuation){for(const r of runs.values())if(r.sid===sid){r.tries=0;r.finalReads=0;r.phase='工作流继续';later(r);}return;}
    const preview=promptPreview(j), entry={revision:++revision,at:Date.now(),configs:configs(j,'页面请求','$'),prompt:preview,balance:balance&&Date.now()-balance.at<180000?{remaining:balance.remaining,at:balance.at}:null};
    const mid=j.message?.id;if(typeof mid==='string'&&/^[\w-]{8,64}$/.test(mid)){try{onSent?.(mid,entry.at);}catch{}}
    if(sid){submissions.set(sid,entry);void costBaseline(sid,entry);}else pendingNew=entry;
    // 记下提交前已见过的标记数与 span：后端若不写新的轮次标记（如撤回后重发），仍能靠“新出现的 span”识别本轮
    for(const r of runs.values())if(r.sid===sid){clearTimeout(r.timer);r.abort?.abort();if(r.data)save(r.data);r.revision=entry.revision;r.requestConfigs=entry.configs;r.prompt=preview;r.submittedAt=entry.at;r.baseline={markers:r.markers,spans:new Set(r.seen),since:r.newest||null};r.tries=0;r.finalReads=0;r.cache.clear();r.missing=new Map();r.rawSpans=new Map();r.rawTrace=[];r.credits=null;if(r.probe)delete r.probe.cost;r.phase='等待新一轮';later(r,1800);}
    log('detail','提交','页面提交新消息'+(preview?' · “'+preview+'”':''),null,{sid});paint();
  }
  function frameSeen(frame,ctx){
    frames++;const sid=ctx.sid||sidOf(location.href);inspect(frame,t=>accept(t,ctx.sid),(type,node)=>{
      // 助手消息的 id / nodeId 出现在 start 与 message-metadata 帧里；费用接口按 nodeId（缺省为消息 id）计
      if(node&&typeof node==='object'){noteTurnId(sid,node.messageId);const meta=node.messageMetadata;if(meta&&typeof meta==='object'){noteTurnId(sid,meta.nodeId);noteTurnId(sid,meta.messageId);}}
      if(type==='finish'){for(const r of runs.values())if(r.sid===sid)r.huntFinishedAt=Date.now();log('detail','读流','检测到流结束（finish）',null,ctx);for(const r of runs.values())if(r.sid===sid&&r.finalReads<2)later(r,1200,true);clearTimeout(balanceTimer);balanceTimer=setTimeout(()=>{if(Date.now()-(balance?.at||0)>8000)void refreshBalance(true);},6000);scheduleCost(sid,COST_DELAYS[0],true);}
      else if(type==='error'||type==='abort'){log('detail','读流','检测到流事件 '+type,null,ctx);scheduleCost(sid,COST_DELAYS[1],true);}
    });paint();
  }
  async function json(r,path,signal){
    if(Date.now()<cooldown)throw Object.assign(Error('限流冷却中'),{status:429});
    const auth=authorized(r.token,r.sid);if(auth.runId!==r.runId)throw Error('运行权限不一致');
    // 页面令牌可读的只读接口：events / spans（Trace）以及 run 记录、run 元数据、会话记录（探测用）
    const tails={events:'/api/v1/runs/'+r.runId+'/events',metadata:'/api/v1/runs/'+r.runId+'/metadata',run:'/api/v3/runs/'+r.runId,session:'/api/v1/sessions/'+encodeURIComponent(r.sid)};
    const tail=/^spans\/[a-f0-9]{16,32}$/i.test(path)?'/api/v1/runs/'+r.runId+'/'+path:tails[path];if(!tail)throw Error('不允许的读取路径');
    const stage=path==='events'?'Trace':path.startsWith('spans/')?'Span':'探测',direct='https://api.trigger.dev',proxy=location.origin+'/ai-proxy',bases=denied('direct')?[proxy]:[direct,proxy];
    for(let i=0;i<bases.length;i++){
      const ctrl=new AbortController(),cancel=()=>ctrl.abort(),timeout=setTimeout(()=>ctrl.abort(),15000);
      if(signal.aborted){clearTimeout(timeout);throw new DOMException('已取消','AbortError');}signal.addEventListener('abort',cancel,{once:true});
      try{
        log('debug','请求','GET '+bases[i]+tail,null,r);queries++;const res=await rawFetch(bases[i]+tail,{method:'GET',headers:{Authorization:'Bearer '+r.token,Accept:'application/json'},credentials:'omit',redirect:'error',cache:'no-store',signal:ctrl.signal});
        if(res.ok||stage!=='探测')log('detail',stage,'HTTP '+res.status+' · '+path,null,{sid:r.sid,runId:r.runId,spanId:path.startsWith('spans/')?path.slice(6):null});if(!res.ok){const e=Error('HTTP '+res.status);e.status=res.status;if(res.status===429)cooldown=Date.now()+Math.max(120000,Math.min(600000,(Number(res.headers.get('Retry-After'))||0)*1000));throw e;}
        const text=await res.text();if(text.length>(path==='events'?4194304:path==='run'?2097152:524288))throw Object.assign(Error(stage+' 数据超过读取上限'),{format:true});
        try{return JSON.parse(text);}catch{throw Object.assign(Error(stage+' 返回内容不是有效 JSON'),{format:true});}
      }catch(e){
        if(!signal.aborted&&!e.status&&!e.format&&bases[i]===proxy&&bases.length===1)undeny('direct');
        if(signal.aborted||e.status||e.format||i===bases.length-1)throw e;
        // 浏览器直连 api.trigger.dev 失败（CORS/网络/拦截），改走本站 /ai-proxy；30 分钟内直接走代理，不再每次先失败一次。
        if(bases[i]===direct){if(denyFor('direct',1800000))log('detail','连接','直连 api.trigger.dev 不可用（'+errorText(e)+'），30 分钟内改走本站 /ai-proxy',null,r);}
      }finally{clearTimeout(timeout);signal.removeEventListener('abort',cancel);}
    }
  }
  // ---- 模型被改派（服务端故障转移）----
  const pageGenerating=()=>!!document.querySelector('button[aria-label="Stop generating"],button[aria-label="Stop response"],button[aria-label="停止生成"]');
  function flatProps(o,pre='',out=[],depth=0){if(!o||typeof o!=='object'||depth>4||out.length>200)return out;for(const [k,v] of Object.entries(o)){const p=pre?pre+'.'+k:k;if(v&&typeof v==='object')flatProps(v,p,out,depth+1);else out.push([p,v]);}return out;}
  async function noteRoute(r,p,signal){
    const sw=r.data?.routing;if(!sw)return;
    const k=r.runId+'|'+(p.turn??'')+'|'+sw.at;if(r.routeNoted===k)return;r.routeNoted=k;
    // 读取故障转移事件本身的属性（原因、前后模型等），只读一次
    const bits=[],props={};
    for(const x of (p.route||[]).filter(x=>x.spanId&&/^(model\.resample\.(attempt_failed|switched)|failover\.record_inserted)$/.test(x.message)).slice(0,3)){
      try{const d=await json(r,'spans/'+x.spanId,signal);r.rawSpans.set(x.spanId,d);for(const [kk,v] of flatProps(object(d?.properties)))if(['string','number','boolean'].includes(typeof v)&&(props[kk.replace(/^(properties\.)?/,'')]??=v,true)&&/reason|error|cause|timeout|status|code|failure|rawMessage|site|from|to|previous|next|model|attempt|elapsed|ms/i.test(kk)&&!/userId|sessionId|chatId|prompt|messages|originIp/i.test(kk))bits.push(kk.replace(/^(properties\.)?/,'')+'='+String(v).slice(0,80));}catch{}
    }
    const reason=[...new Set(bits)].slice(0,10).join(' · ')||null;r.routeReason=reason;if(r.data?.routing)r.data.routing.reason=reason;
    const wait=sw.waitMs?Math.round(sw.waitMs/1000)+' 秒':'';
    // 区分改派原因：内容审核拦截 / 空响应 / 首包超时 / 其他调用失败
    const fin=(r.data?.calls||[]).map(c=>c.finish).find(Boolean)||'',fk=String(props.failureKind||''),ec=String(props.errorCategory||'');
    const cause=/content.?filter/i.test(fin)?'被内容审核拦截（finish=content-filter），'+(wait?wait+'内':'')+'没有任何输出':fk==='empty_stream'?(wait?wait+'内':'')+'返回了空内容（empty_stream'+(fin?' · finish='+fin:'')+'）':sw.waitMs>=60000?wait+'内没有返回任何内容（首包超时）':'调用失败'+(fk||ec?'（'+[fk,ec].filter(Boolean).join(' · ')+'）':'')+(wait?'，用时 '+wait:'');
    r.routeCause=cause;if(r.data?.routing)r.data.routing.cause=cause;
    log('warn','路由',turnLabel(r.data)+' · '+(sw.from||'原模型')+' '+cause+'，Arena 自动改派 '+(sw.to||'其他模型')+(sw.committed?'（已写入本对话，后续轮次也会用新模型）':'')+(reason?' · '+reason:''),null,r);
    try{routeAlert.show('模型被 Arena 改派',sw.from||'原模型',sw.to||'其他模型','原模型'+cause+'，服务端自动故障转移'+(sw.committed?' · 本对话之后也会用新模型，想要原模型请新开对话':''),'drop');}catch{}
    if(prefs.stopOnResample&&sidOf(location.href)===r.sid&&pageGenerating()){
      const b=document.querySelector('button[aria-label="Stop generating"],button[aria-label="Stop response"],button[aria-label="停止生成"]');
      if(b){b.click();log('info','路由','已自动停止生成：改派后的模型不是原来那个，继续等待只会消耗额度（设置里可关闭）',null,r);}
    }
    save(r.data);paint();
  }
  // 长回复期间常规轮询早已用完：页面仍在生成时每 20 秒只读一次事件列表，尽快发现改派。
  async function watchRoute(){
    if(stopped||!enabled||Date.now()<cooldown||document.hidden||!pageGenerating())return;
    const sid=sidOf(location.href),r=[...runs.values()].find(x=>x.sid===sid&&x.token);if(!r||r.busy||r.watching)return;
    const age=Date.now()-(r.submittedAt||0);if(age<45000||age>1800000)return;
    r.watching=true;const ctrl=new AbortController();
    try{const trace=await json(r,'events',ctrl.signal);const p=plan(trace,r.runId,r.baseline);
      if(p.route.some(x=>x.message==='model.resample.switched')&&p.count){r.data=snapshot(r,p,r.cache);keepRaw(r);await noteRoute(r,p,ctrl.signal);}
    }catch{}finally{r.watching=false;}
  }
  const routeWatch=setInterval(()=>{void watchRoute();},20000);
  async function poll(r,final=false){
    if(stopped||!enabled||r.busy||Date.now()<cooldown||!r.token||r.tries>=8&&!final||final&&r.finalReads>=2)return;
    if(final)r.finalReads++;r.tries++;r.busy=true;r.phase='读取 Trace';
    const epoch=r.revision,ctrl=new AbortController();r.abort=ctrl;
    const live=()=>!stopped&&enabled&&r.revision===epoch&&!ctrl.signal.aborted&&runs.get(r.runId)===r;
    try{
      const trace=await json(r,'events',ctrl.signal);if(!live())return;
      const p=plan(trace,r.runId,r.baseline);r.markers=p.markers;for(const id of p.spanIds)r.seen.add(id);r.newest=Math.max(r.newest||0,p.newest||0)||null;
      // 刷新页面后首次提交时还没有基线：若最新段落明显早于本次提交，就把当前内容记为基线，之后只认新出现的标记或 span。
      // 基线一旦存在便不再用本机时钟判断，避免时钟偏差把新一轮吞掉
      const stale=!p.resumed&&!r.baseline&&r.tries<=6&&!!r.submittedAt&&!!p.at&&p.at<r.submittedAt-90000;
      if(stale)r.baseline={markers:p.markers,spans:new Set(p.spanIds),since:p.newest||null};
      log('detail','Trace',(p.turn?'第 '+p.turn+' 轮':'未标记轮次')+(p.attempt>1?' · 第 '+p.attempt+' 次':'')+(p.resumed?' · 同轮新记录':'')+' · '+p.count+' 次模型调用'+(p.prior?'（此前 '+p.prior+' 次）':'')+' · '+p.markers+' 个轮次标记 · '+trace.events.length+' 条事件'+(p.limited?' · 超出详读上限':''),null,r);
      if(!p.count||stale){r.phase='等待本轮记录';log('debug','轮次',stale?'最新轮次早于本次提交，继续等待':'尚无本轮模型调用记录',null,r);if(r.tries<8)later(r,Math.min(15000,2500*r.tries));else r.phase='暂未发现本轮记录';return;}
      r.rawTrace=trace.events.slice(p.range[0],p.range[1]+1);
      r.data=snapshot(r,p,r.cache);keepRaw(r);save(r.data);paint(); // 先显示模型标签，不等所有 span 成功。
      if(r.data.routing)void noteRoute(r,p,ctrl.signal);
      if(!r.probe)void probeRun(r,['run','session','metadata']);else if(final&&r.finalReads===1)void probeRun(r,['run','metadata']);
      if(p.ready||final||r.tries>=4){
        // 先读用量/花费记录（携带内部名称，条数少），再读模型调用；中途被新消息打断时名称也已到手
        const todo=[...p.records,...p.streams];let n=0;
        for(const e of todo){
          if(!live())return;n++;if(r.cache.get(e.id)?.available&&!r.cache.get(e.id)?.partial||(r.missing.get(e.id)||0)>=2)continue;
          if(e.properties){r.cache.set(e.id,detail({runId:r.runId,spanId:e.id,message:e.message,isPartial:e.partial,properties:e.properties},e,r.runId));r.rawSpans.set(e.id,{spanId:e.id,runId:r.runId,message:e.message,isPartial:e.partial,properties:e.properties});}
          else {
            try{const d=await json(r,'spans/'+e.id,ctrl.signal);if(!live())return;r.cache.set(e.id,detail(d,e,r.runId));r.rawSpans.set(e.id,d);}
            catch(err){
              if(err.status===404){const k=(r.missing.get(e.id)||0)+1;r.missing.set(e.id,k);log(k>1?'warn':'detail','Span','详情 HTTP 404，跳过此 Span'+(k>1?'（第 '+k+' 次）':''),null,{sid:r.sid,runId:r.runId,spanId:e.id});continue;}
              if([401,403].includes(err.status)){r.phase='模型已识别 · 详情未提供';log('warn','Span','详情接口 HTTP '+err.status+'；保留模型标签',null,{sid:r.sid,runId:r.runId,spanId:e.id});save(r.data);return;}
              throw err;}
          }
          const d=r.cache.get(e.id)||{};
          log('detail','字段',({stream:'模型调用',usage:'用量记录',cost:'花费记录'}[e.kind]||e.kind)+' '+n+'/'+todo.length+(d.request?' · '+d.request:'')+(d.internal?' · '+d.internal:'')+(d.configs?.find(x=>x.kind==='effort')?' · 显式 '+(d.configs.find(x=>x.kind==='effort').value||'不支持'):'')+(d.output?.[0]?' · 输出 '+d.output[0].value:'')+(d.reasoning?.[0]?' · 推理 '+d.reasoning[0].value:''),null,{sid:r.sid,runId:r.runId,spanId:e.id});
          r.data=snapshot(r,p,r.cache);keepRaw(r);if(n%4===0)save(r.data);paint();await new Promise(resolve=>setTimeout(resolve,300));
        }
      }
      if(!live())return;r.data=snapshot(r,p,r.cache);keepRaw(r);r.phase=r.data.partial?'部分记录':'已读取';save(r.data);noteUsd(r,p);if(r.data.routing)void noteRoute(r,p,ctrl.signal);
      if(r.data.outcome&&r.outcomeNoted!==r.data.key){r.outcomeNoted=r.data.key;const lc=r.data.calls.at(-1);log('warn','结果',turnLabel(r.data)+' · '+(r.data.outcome==='failed'?'Arena 记录本轮失败':'本轮没有产出回复')+(lc?.finish==='length'?' · '+(lc.model||'模型')+' 推理用尽输出上限（'+(lc.tokens?.output??'?')+' Token）仍未作答':''),null,r);}
      const last=r.data.calls.at(-1),eff=last?.effort;
      log('info','结果',turnLabel(r.data)+' · '+p.count+' 次调用 · '+(last?.model||'未提供')+(last?.internal?' · 内部名称 '+last.internal:'')+' · 显式 '+(eff?.value||({conflict:'冲突',unsupported:'不支持'}[eff?.status])||'未知')+' · 推理 Token '+(last?.reasoning.status==='conflict'?'冲突':last?.reasoning.value??'—')+(r.data.partial?' · 部分字段未取得':''),null,r);
      if(r.data.partial&&r.tries<8)later(r,Math.min(15000,2500*r.tries));
    }catch(e){
      if(!live()||e.name==='AbortError'&&ctrl.signal.aborted)return;
      r.phase=e.status===429?'限流暂停':[401,403].includes(e.status)?'权限失效':'Trace 读取失败';
      if([401,403].includes(e.status)){r.rejectedToken=r.token;r.token=null;}
      log('warn','Trace',r.phase,e,r);
    }finally{if(r.abort===ctrl)r.abort=null;r.busy=false;paint();}
  }

  // 探测：用同一枚页面令牌读取 run 记录 / run 元数据 / 会话记录，结果进原始标签页与导出；HTTP 状态一并记录，便于摸清权限边界
  async function probeRun(r,kinds){
    if(r.probing||!r.token||stopped||!enabled)return;r.probing=true;const ctrl=new AbortController(),epoch=r.revision;
    try{
      r.probe=r.probe||{};
      for(const kind of kinds){
        if(stopped||!enabled||runs.get(r.runId)!==r||!r.token)return;
        if(denied('probe.'+kind)){r.probe[kind]=r.probe[kind]||{status:0,at:new Date().toISOString(),error:'页面令牌无权读取，已跳过'};continue;}
        const at=new Date().toISOString();
        try{const d=await json(r,kind,ctrl.signal);r.probe[kind]={status:200,at,data:d};log('detail','探测',kind+' · 已读取 · '+(JSON.stringify(d).length/1024).toFixed(1)+' KB',null,r);}
        catch(e){r.probe[kind]={status:e.status||0,at,error:errorText(e)};
          // 401/403/404：页面令牌的权限范围不含该接口（仅探测用，不影响模型识别）。6 小时内不再请求。
          if([401,403,404].includes(e.status)){if(denyFor('probe.'+kind,21600000))log('detail','探测',kind+' · HTTP '+e.status+' · 页面令牌无权读取此接口（仅探测，不影响识别），6 小时内跳过',null,r);}
          else log('warn','探测',kind+' · '+(e.status?'HTTP '+e.status:errorText(e)),null,r);if(e.status===429)return;}
        await new Promise(resolve=>setTimeout(resolve,250));
      }
    }finally{r.probing=false;if(runs.get(r.runId)===r&&r.revision===epoch&&r.data){r.data={...r.data,raw:{...r.data.raw,probe:r.probe}};keepRaw(r);save(r.data);}paint();}
  }
  // 限流与额度
  function noteQuota(kind,headers,status,body=null){
    const q=quotaOf(headers,status,Date.now(),body),before=quota[kind];
    // 成功响应没有限流头（/in/append 常见）：若此前记录为限流中，视为已解除
    if(!q){if(before?.blocked&&status>=200&&status<400){quota={...quota,[kind]:null};store(KEY+'.quota',quota);log('info','限流',(kind==='chat'?'新会话':'消息')+' 限流已解除（请求成功）');paint();}return;}
    quota={...quota,[kind]:q};store(KEY+'.quota',quota);
    const text=(kind==='chat'?'新会话':'消息')+(q.blocked?' 限流 HTTP 429':'')+(q.reason?' · '+q.reason:'')+(q.limit!==null?' · 剩余 '+(q.remaining??'?')+'/'+q.limit:'')+(q.resetAt?' · '+hhmm(q.resetAt)+(q.blocked?' 解除':' 重置'):'')+(q.window?' · 窗口 '+q.window+' 秒':'');
    if(q.blocked||!before||before.remaining!==q.remaining||before.limit!==q.limit||before.blocked)log(q.blocked?'warn':'detail','限流',text.trim());paint();
  }
  function noteBalance(j,source){
    const b={remaining:number(j?.creditsRemaining),daily:number(j?.dailyFreeCredits),refreshAt:Number.isFinite(Date.parse(j?.refreshedAt||''))?Date.parse(j.refreshedAt):null,at:Date.now()};
    if(b.remaining===null)return false;const changed=!balance||balance.remaining!==b.remaining||balance.daily!==b.daily;balance=b;store(KEY+'.balance',b);
    // 到了每日重置时间再读一次（页面自身也这么做），避免状态行停在过期数字上
    clearTimeout(balanceResetTimer);if(b.refreshAt&&b.refreshAt>b.at&&b.refreshAt-b.at<90000000)balanceResetTimer=setTimeout(()=>void refreshBalance(true),b.refreshAt-b.at+1500);
    if(changed)log('detail','额度','剩余 '+b.remaining+(b.daily!==null?' / 每日 '+b.daily:'')+(b.refreshAt?' · '+hhmm(b.refreshAt)+' 重置':'')+' · '+source);costBalance();paint();return true;
  }
  // 每轮 credits：页面自带接口 GET /api/chat/{sid}/cost（同源 cookie，页面自己也在用）。提交时先记基线（已计费的消息 id 集合、会话累计、余额），
  // 流结束后按 2.5 / 6 / 15 / 40 秒读取，直到命中本轮消息的计费条目；命中不了时退化为“新出现的条目”或会话累计差值，余额变化另行记录
  const COST_DELAYS=[2500,6000,15000,40000],costState=new Map();let costFail=0,costFailAt=0;
  const MID=/^[\w-]{4,128}$/,midList=list=>[...new Set(list.filter(k=>typeof k==='string'&&MID.test(k)))];
  function costOf(sid){if(!costState.has(sid)){costState.set(sid,{baseline:null,latest:null,credits:null,timer:0,tries:0,ids:new Set(),busy:false,done:0});while(costState.size>12){const [k,v]=costState.entries().next().value;clearTimeout(v.timer);costState.delete(k);}}return costState.get(sid);}
  // 只在“本机提交之后、流结束前后 3 秒内”收集消息 id，避免重连回放的历史帧把上几轮的 id 混进来
  function noteTurnId(sid,id){if(!sid||typeof id!=='string'||!MID.test(id))return;const c=costOf(sid);if(!c.baseline||c.done&&Date.now()-c.done>3000||c.ids.has(id))return;if(c.ids.size>=8)c.ids.delete(c.ids.values().next().value);c.ids.add(id);}
  const costAllowed=()=>prefs.showCredits&&!stopped&&enabled&&!(costFail>=3&&Date.now()-costFailAt<600000);
  function creditsRow(resolved,session,bal){return {credits:resolved?.credits??null,usd:resolved?.usd??null,actualUsd:resolved?.actualUsd??null,source:resolved?.source||null,keys:resolved?.keys||[],parts:resolved?.parts||[],session:session||null,balance:bal||null,at:new Date().toISOString()};}
  const balDelta=(before,after)=>before&&after&&after.at>before.at?{before:before.remaining,beforeAt:new Date(before.at).toISOString(),after:after.remaining,afterAt:new Date(after.at).toISOString(),delta:before.remaining-after.remaining}:null;
  async function costGet(sid,ids){
    const q=ids?.length?'includeSession=false&messageIds='+encodeURIComponent([...new Set(ids)].sort().slice(0,50).join(',')):'includeSession=true';
    if(denied('cost')){const e=Error('费用接口暂不可用');e.status=403;e.known=true;throw e;}
    const path='/api/chat/'+encodeURIComponent(sid)+'/cost?'+q;
    let res=await rawFetch(location.origin+path,{headers:{Accept:'application/json'},credentials:'same-origin',cache:'no-store'});
    // 403/401 时换一条线路再试一次（相对路径 + include 凭据，与额度接口的备用方式相同）
    if(res.status===403||res.status===401){try{const r2=await rawFetch(path,{headers:{Accept:'application/json'},credentials:'include',cache:'no-store',redirect:'follow'});if(r2.ok)res=r2;}catch{}}
    if(!res.ok){const e=Error('HTTP '+res.status);e.status=res.status;
      // 其它接口正常而费用接口 401/403/404：该账号/对话不开放费用明细。1 小时内不再请求；本轮用量改用余额前后差值。
      if([401,403,404].includes(res.status)){e.first=denyFor('cost',3600000);}
      throw e;}
    undeny('cost');
    const text=await res.text();if(text.length>2097152)throw Error('费用数据超过读取上限');return JSON.parse(text);
  }
  // 上一轮的现场：用户发得快时（流结束后几秒内又提交），上一轮的 credits 还没读到；用之后到达的任一响应补记到上一轮的快照里
  function settlePrev(sid,sum,prev,run){
    if(!sum||!prev?.data||!prev.baseline||prev.credits&&prev.credits.source==='message')return false;
    const strong=midList([...(prev.data.records||[]).map(x=>x.messageId),...(prev.data.costs||[]).map(x=>x.messageId)]);
    const resolved=resolveTurnCredits({entries:sum.entries,candidates:midList(prev.ids),strong,before:prev.baseline.keys||null,sessionBefore:prev.baseline.session||null,session:sum.session});
    if(!resolved)return false;const base=run?.data?.key===prev.data.key?run.data:prev.data,credits=creditsRow(resolved,sum.session,balDelta(prev.baseline.balance,prev.balanceAfter)||prev.credits?.balance||null),data={...base,credits};
    if(run&&run.data===base)run.data=data;save(data);log('info','费用','补记上一轮 '+Math.round(resolved.credits)+' credits · '+({message:'按消息 id 命中',new:'按新出现的计费条目推断',session:'按会话累计差值推断'}[resolved.source]),null,{sid,runId:run?.runId});return true;
  }
  const prevOf=(c,run)=>({baseline:c.baseline,ids:[...c.ids],credits:c.credits,data:run?.data||null,balanceAfter:balance?{remaining:balance.remaining,at:balance.at}:null});
  async function costBaseline(sid,entry){
    if(!sid||stopped||!enabled)return;const c=costOf(sid),run=[...runs.values()].filter(x=>x.sid===sid).at(-1)||null;
    const prev=prevOf(c,run);
    clearTimeout(c.timer);c.timer=0;c.tries=0;c.credits=null;c.ids=new Set();c.done=0;
    const b={at:entry?.at||Date.now(),keys:null,session:null,balance:entry?.balance||null};c.baseline=b;if(!costAllowed())return;
    if(!b.balance){await refreshBalance(true);if(balance&&c.baseline===b&&Date.now()-balance.at<30000)b.balance={remaining:balance.remaining,at:balance.at};}
    try{const j=await costGet(sid),sum=costSummary(j);costFail=0;
      // 流已经结束才拿到基线（极快的一轮）：这份数据可能已含本轮计费，不能当基线用，只保留“按消息 id 命中”这一条路
      const late=c.baseline!==b||!!c.done;
      if(sum&&!late){b.keys=new Set(Object.keys(sum.entries));b.session=sum.session;c.latest={summary:sum,at:Date.now()};}
      log('debug','费用','提交前基线 · '+(sum?Object.keys(sum.entries).length+' 条已计费消息'+(sum.session?.credits!==null&&sum.session?.credits!==undefined?' · 会话累计 '+Math.round(sum.session.credits)+' credits':''):'无数据')+(late?' · 到得太晚，不作基线':''),null,{sid});
      if(sum)settlePrev(sid,sum,prev,run);
    }catch(e){if(e.known)return;if([401,403,404].includes(e.status)){costFail++;costFailAt=Date.now();}log('debug','费用','基线读取失败'+(e.status?' · HTTP '+e.status:''),e.status?null:e,{sid});}
  }
  function costNew(sid,at,bal){if(!sid)return;const c=costOf(sid);clearTimeout(c.timer);c.timer=0;c.tries=0;c.credits=null;c.ids=new Set();c.done=0;c.baseline={at:at||Date.now(),keys:new Set(),session:null,balance:bal||null};}
  function scheduleCost(sid,delay,restart=false){if(!sid||!costAllowed())return;const c=costOf(sid);if(restart){c.tries=0;if(!c.done)c.done=Date.now();}clearTimeout(c.timer);c.timer=setTimeout(()=>{c.timer=0;void costRead(sid);},delay);}
  function domAssistantId(sid){if(sidOf(location.href)!==sid)return null;const nodes=document.querySelectorAll('[data-agent-transcript-message][data-chat-message-id]');for(let i=nodes.length-1;i>=0;i--){const n=nodes[i];if(n.querySelector('[data-user-message-layout],[data-user-message-body-row]'))continue;return n.getAttribute('data-chat-message-id');}return null;}
  // 余额前后差值：账号级数字，其他标签页的消耗也会算进来，所以只作参考；流结束前不建条目
  function costBalance(){
    const sid=sidOf(location.href),c=sid&&costState.get(sid);if(!c||!c.done||!c.baseline?.balance||!balance||balance.at<=c.baseline.at)return;
    const bal=balDelta(c.baseline.balance,{remaining:balance.remaining,at:balance.at});if(!bal||c.credits?.balance&&c.credits.balance.after===bal.after)return;
    c.credits=c.credits?{...c.credits,balance:bal}:creditsRow(null,c.latest?.summary?.session||null,bal);
    const r=[...runs.values()].filter(x=>x.sid===sid).at(-1);if(r){r.credits=c.credits;if(r.data){r.data={...r.data,credits:r.credits};keepRaw(r);save(r.data);}}paint();
  }
  const trimCost=(j,keys)=>{const msgs=j?.messages&&typeof j.messages==='object'?j.messages:{},picked={};for(const k of keys)if(msgs[k])picked[k]=msgs[k];return {session:j?.session??null,messages:picked,messageCount:Object.keys(msgs).length};};
  async function costRead(sid){
    const c=costOf(sid);if(c.busy||!costAllowed())return;c.busy=true;c.tries++;
    const r=[...runs.values()].filter(x=>x.sid===sid).at(-1)||null,b=c.baseline,prev=prevOf(c,r);
    try{
      const strong=midList([...(r?.data?.records||[]).map(x=>x.messageId),...(r?.data?.costs||[]).map(x=>x.messageId)]),want=midList([...c.ids,...strong,domAssistantId(sid)]);
      let j=await costGet(sid),sum=costSummary(j);costFail=0;
      if(!sum){log('detail','费用','GET /api/chat/{sid}/cost 返回了无法识别的结构',null,{sid});return;}
      // 等待期间页面又提交了新一轮：这份响应属于上一轮，补记后退出（新一轮流结束时会另行读取）
      if(c.baseline!==b){settlePrev(sid,sum,prev,r);return;}
      const missing=want.filter(k=>!sum.entries[k]);
      if(missing.length){try{const j2=await costGet(sid,missing),s2=costSummary(j2);if(s2){Object.assign(sum.entries,s2.entries);j={...j,messages:{...(j.messages||{}),...(j2.messages||{})}};}}catch(e){log('debug','费用','按消息 id 读取失败'+(e.status?' · HTTP '+e.status:''),e.status?null:e,{sid});}}
      if(c.baseline!==b){settlePrev(sid,sum,prev,r);return;}
      c.latest={summary:sum,at:Date.now()};
      const resolved=resolveTurnCredits({entries:sum.entries,candidates:want,strong,before:b?.keys||null,sessionBefore:b?.session||null,session:sum.session});
      const bal=(b?.balance&&balance?balDelta(b.balance,{remaining:balance.remaining,at:balance.at}):null)||c.credits?.balance||null;
      c.credits=creditsRow(resolved,sum.session,bal);
      if(r){r.credits=c.credits;r.probe=r.probe||{};r.probe.cost={status:200,at:c.credits.at,data:trimCost(j,[...(resolved?.keys||[]),...want])};if(r.data){r.data={...r.data,credits:r.credits,raw:{...r.data.raw,probe:r.probe}};keepRaw(r);save(r.data);}}
      const srcText={message:'按本轮消息 id 命中',new:'按新出现的计费条目推断',session:'按会话累计差值推断'}[resolved?.source]||'';
      log(resolved?'info':'detail','费用',resolved?'本轮 '+Math.round(resolved.credits)+' credits'+(resolved.usd!==null&&resolved.usd!==undefined?' · 计费 $'+(+resolved.usd).toFixed(4):'')+(resolved.actualUsd?' · 实际 $'+(+resolved.actualUsd).toFixed(4):'')+(resolved.parts[0]?.strategy?' · '+resolved.parts[0].strategy:'')+' · '+srcText+(bal?' · 余额 '+bal.before+' → '+bal.after:''):'第 '+c.tries+' 次读取尚无本轮计费条目'+(sum.session?.credits!==null&&sum.session?.credits!==undefined?' · 会话累计 '+Math.round(sum.session.credits)+' credits':'')+(want.length?' · 候选 id '+want.length+' 个':' · 尚未捕获本轮消息 id'),null,{sid,runId:r?.runId});
      if(!(resolved&&resolved.source!=='session')&&c.tries<COST_DELAYS.length)scheduleCost(sid,COST_DELAYS[c.tries]);
    }catch(e){
      const refused=[401,403,404].includes(e.status);if(refused){costFail++;costFailAt=Date.now();if(r){r.probe=r.probe||{};r.probe.cost={status:e.status,at:new Date().toISOString(),error:errorText(e)};}}
      if(e.known){}else if(refused&&e.first)log('detail','费用','GET /api/chat/{id}/cost · HTTP '+e.status+' · 此账号不开放费用明细（登录正常，其它接口可用）；1 小时内不再读取，本轮用量改用余额前后差值',null,{sid});
      else if(!refused)log(c.tries<COST_DELAYS.length?'detail':'warn','费用','读取失败'+(e.status?' · HTTP '+e.status:''),e.status?null:e,{sid});
      if(!refused&&c.tries<COST_DELAYS.length)scheduleCost(sid,COST_DELAYS[c.tries]);
    }finally{c.busy=false;paint();}
  }
  async function refreshBalance(force=false){
    if(!prefs.showQuota||stopped||!enabled)return;const now=Date.now();
    if(!force&&now-balanceAt<BALANCE_INTERVAL||balanceFail>=3&&now-balanceAt<600000)return;balanceAt=now;
    // 403/网络失败时自动换路：当前地址 → 强制 HTTPS 同域 → 相对路径 + include 凭据 → 页面自身 fetch。全部失败只记调试日志，保留上次额度，不报错。
    const path='/api/billing/balance',httpsOrigin='https://'+location.host;
    const tries=[[rawFetch,location.origin+path,'same-origin'],[rawFetch,httpsOrigin+path,'include'],[rawFetch,path,'include'],[window.fetch.bind(window),httpsOrigin+path,'include']]
      .filter((t,i,a)=>a.findIndex(x=>x[0]===t[0]&&x[1]===t[1]&&x[2]===t[2])===i);
    const errs=[];
    for(const [fn,url,cred] of tries){
      try{const res=await fn(url,{method:'GET',headers:{Accept:'application/json'},credentials:cred,cache:'no-store',redirect:'follow'});
        if(!res.ok){errs.push('HTTP '+res.status+' · '+url);if(res.status===429)break;continue;}
        const ct=res.headers.get('content-type')||'';if(!/json/i.test(ct)){errs.push('非 JSON · '+url);continue;}
        if(noteBalance(await res.json(),'主动读取')){balanceFail=0;if(errs.length)log('debug','额度','已通过备用线路读取（'+url+'），此前：'+errs.join('；'));return;}
        errs.push('数据无效 · '+url);
      }catch(e){errs.push((e?.message||'网络错误')+' · '+url);}
    }
    balanceFail++;log('debug','额度','GET '+path+' 暂不可用，已保留上次额度：'+errs.join('；'));
  }
  window.addEventListener('storage',onStorage);function onStorage(e){if(e.key===KEY+'.quota'){const q=load(KEY+'.quota',{});quota={chat:quotaShape(q?.chat),append:quotaShape(q?.append)};paint();}else if(e.key===KEY+'.balance'){balance=balanceShape(load(KEY+'.balance',null));paint();}}
  // 4. tee 分流：AbortError 是流取消，不是 JSON 解析失败。
  function captureAllowed(url,ct){
    try{const u=new URL(url,location.href);return [location.origin,'https://api.trigger.dev'].includes(u.origin)&&!/^\/ai-proxy\/api\/v1\/runs\//.test(u.pathname)&&(/event-stream|ndjson|stream\+json/i.test(ct||'')||!!streamSid(url));}catch{return false;}
  }
  async function readBranch(reader,ctx,signal){
    const parser=new Lines(f=>frameSeen(f,ctx),(text,e)=>log('warn','解析',text,e,ctx));readers.add(reader);
    let lastData=Date.now(),bytes=0;
    try{
      while(!stopped){
        let chunk;
        try{chunk=await reader.read();}
        catch(e){
          if(enabled&&!stopped){
            if(e.name==='AbortError'||signal?.aborted)log('debug','读流','页面取消了这条流',null,ctx);
            // 空闲的长连接（会话实时通道）约每 30 秒被服务器/代理重置一次，Arena 会自动重连，不影响对话：降为调试日志
            else if(Date.now()-lastData>8000||bytes<2048)log('debug','读流','空闲连接被服务器重置（Arena 会自动重连，不影响对话）',e,ctx);
            else log('warn','读流','网络流断开（回复传输中）',e,ctx);
          }
          break;
        }
        if(chunk.done)break;
        lastData=Date.now();bytes+=chunk.value?.byteLength||0;
        if(enabled){try{parser.feed(chunk.value);}catch(e){parser.buffer='';parser.pending='';log('warn','解码','当前分块解码失败，跳过该块',e,ctx);}}
      }
      if(enabled){try{parser.end();}catch(e){log('warn','解析','尾帧处理失败',e,ctx);}}
    }finally{log('debug','读流','旁路流读取结束',null,ctx);readers.delete(reader);try{reader.releaseLock();}catch{}}
  }
  const wrapped=function(input,init){
    const url=typeof input==='string'?input:input?.url||String(input),method=String(init?.method||input?.method||'GET').toUpperCase();
    if(enabled&&method==='POST'){
      if(init?.body!==undefined){requestSeen(url,init.body);const nb=warmBody(url,init.body);if(nb!==null){init={...init,body:nb};arguments[1]=init;}}
      else if(input?.clone){
        const self=this,args=arguments;
        if(gacha.settings().warmup&&/(\/in\/append|\/stream\/create-chat)$/.test(String(url).split('?')[0]))
          return input.clone().text().then(body=>{requestSeen(url,body);const nb=warmBody(url,body);if(nb!==null){args[0]=new Request(input,{body:nb});}return wrapped.after.call(self,args,url,method,init);},()=>wrapped.after.call(self,args,url,method,init));
        input.clone().text().then(body=>requestSeen(url,body)).catch(()=>{});
      }
    }
    return wrapped.after.call(this,arguments,url,method,init);
  };
  wrapped.after=function(args,url,method,init){
    const input=args[0];
    return native.apply(this,args).then(res=>{
      if(!enabled||stopped)return res;
      let path='';try{path=new URL(res.url||url,location.href).pathname;}catch{}
      if(method==='POST'&&/(\/stream\/create-chat|\/in\/append)$/.test(path))gacha.notePost(path,res.status);
      if(method==='POST'&&/\/stream\/create-chat$/.test(path)){
        if(res.status===429)res.clone().text().then(t=>noteQuota('chat',res.headers,res.status,t)).catch(()=>noteQuota('chat',res.headers,res.status));
        else{noteQuota('chat',res.headers,res.status);if(res.ok&&res.clone){const pend=pendingNew;try{res.clone().json().then(j=>{gacha.noteChatId(j?.id);if(typeof j?.id==='string'&&/^[\w-]{8,128}$/.test(j.id))costNew(j.id,pend?.at,pend?.balance);}).catch(()=>{});}catch{}}}
      }
      else if(method==='POST'&&/\/in\/append$/.test(path)){if(res.status===429)res.clone().text().then(t=>noteQuota('append',res.headers,res.status,t)).catch(()=>noteQuota('append',res.headers,res.status));else noteQuota('append',res.headers,res.status);}
      if(res.status===200&&method==='GET'&&/\/api\/billing\/balance$/.test(path)&&res.clone){try{res.clone().json().then(j=>noteBalance(j,'页面请求')).catch(()=>{});}catch{}}
      if(res.status!==200)return res;
      const actual=res.url||url,ct=res.headers.get('content-type')||'';
      if(!captureAllowed(actual,ct))return res;
      const ctx={sid:streamSid(actual)||sidOf(location.href)};
      const t=res.headers.get('public-access-token');if(t)accept(t,ctx.sid);
      try{
        if(!res.body?.tee)return res;
        const [site,probe]=res.body.tee(),replacement=new Response(site,{status:res.status,statusText:res.statusText,headers:res.headers});
        const decorate=response=>{for(const key of ['url','redirected','type']){try{Object.defineProperty(response,key,{value:res[key],configurable:true});}catch{}}const clone=response.clone.bind(response);try{response.clone=()=>decorate(clone());}catch{}return response;};
        log('debug','分流','原生 tee 旁路已建立',null,ctx);void readBranch(probe.getReader(),ctx,init?.signal||input?.signal);return decorate(replacement);
      }catch(e){log('warn','分流','无法建立旁路读取器',e,ctx);return res;}
    });
  };
  wrapped.__orig=native;wrapped.__ampLite=true;window.fetch=wrapped;
  const XO=window.XMLHttpRequest?.prototype,oldOpen=XO&&(XO.open.__orig||XO.open),oldSend=XO&&(XO.send.__orig||XO.send),xhrInfo=new WeakMap();
  let xhrOpen,xhrSend;
  if(XO){
    xhrOpen=function(method,url){xhrInfo.set(this,{url:String(url),method:String(method).toUpperCase()});return oldOpen.apply(this,arguments);};
    xhrSend=function(body){
      const info=xhrInfo.get(this);if(info&&enabled){
        if(info.method==='POST'){requestSeen(info.url,body);const nb=warmBody(info.url,body);if(nb!==null){body=nb;arguments[0]=nb;}}
        let offset=0,parser=null,failed=false;
        const consume=()=>{if(stopped||!enabled||failed)return;try{
          const url=this.responseURL||info.url;if(!captureAllowed(url,this.getResponseHeader('content-type')))return;
          if(this.responseType&&this.responseType!=='text')return;
          parser ||= new Lines(f=>frameSeen(f,{sid:streamSid(url)||sidOf(location.href)}),(text,e)=>log('warn','解析',text,e));
          const text=this.responseText||'';if(text.length>offset){parser.feed(text.slice(offset));offset=text.length;}
        }catch(e){failed=true;log('warn','XHR','响应读取失败',e);}};
        this.addEventListener('progress',consume);this.addEventListener('load',()=>{consume();parser?.end();if(info.method==='POST'){let path='';try{path=new URL(info.url,location.href).pathname;}catch{}if(/(\/stream\/create-chat|\/in\/append)$/.test(path))gacha.notePost(path,this.status);if(/\/stream\/create-chat$/.test(path))noteQuota('chat',{get:k=>this.getResponseHeader(k)},this.status,this.status===429&&(!this.responseType||this.responseType==='text')?this.responseText:null);}},{once:true});
      }
      return oldSend.apply(this,arguments);
    };
    xhrOpen.__orig=oldOpen;xhrSend.__orig=oldSend;XO.open=xhrOpen;XO.send=xhrSend;
  }
  const ES=window.EventSource?.__orig||window.EventSource;let eventSource;
  if(ES){eventSource=function(url,options){const es=new ES(url,options);if(captureAllowed(url,'text/event-stream'))for(const name of ['message','batch'])es.addEventListener(name,e=>{if(!enabled||stopped)return;let data;try{data=JSON.parse(e.data);}catch{return;}try{frameSeen(data,{sid:streamSid(url)||sidOf(location.href)});}catch(err){log('warn','解析','EventSource 帧处理异常',err);}});return es;};eventSource.prototype=ES.prototype;Object.setPrototypeOf(eventSource,ES);eventSource.__orig=ES;window.EventSource=eventSource;}

  // 5. 本地缓存：IndexedDB v3（sessions / snapshots / turns / raw / sent / meta / logs）。事务内分配会话全局序号；原始数据单独存放并受总预算约束。
  class LocalCatalog {
    constructor(){this.entries=new Map();this.snapshots=new Map();this.loading=new Map();this.turnLists=new Map();this.turnCache=new Map();this.fingerprints=new Map();this.pending=new Map();this.localLogs=[];this.pendingLogs=[];this.sent=new Map();this.pendingSent=[];this.sentWrites=0;this.rawTotal=null;this.rawCount=null;this.queue=Promise.resolve();this.seq=0;this.revision=0;this.logRevision=0;this.persistent=false;this.closed=false;this.warned=false;this.ready=this.open();}
    changed(){this.revision++;this.onchange?.();}
    failure(sid){if(this.warned||this.closed)return;this.warned=true;log('warn','本地缓存','本地存储不可用或空间不足；编号与标题不会持久化',null,{sid});}
    open(){return new Promise(resolve=>{let request;try{request=indexedDB.open('amp.lite.local',DB_VERSION);}catch{resolve(null);return;}
      request.onupgradeneeded=e=>{const db=request.result,tx=request.transaction;
        if(e.oldVersion<1){const sessions=db.createObjectStore('sessions',{keyPath:'sid'});sessions.createIndex('seq','seq',{unique:true});db.createObjectStore('snapshots',{keyPath:'sid'});db.createObjectStore('meta',{keyPath:'key'});const logs=db.createObjectStore('logs',{keyPath:'id',autoIncrement:true});logs.createIndex('sid','sid');}
        if(e.oldVersion<2){const turns=db.createObjectStore('turns',{keyPath:'key'});turns.createIndex('sid','sid');
          if(e.oldVersion>=1){// 旧快照迁入 turns；会话名称按“优先带强度后缀的内部名称”重新推导
            const sessions=tx.objectStore('sessions'),cursor=tx.objectStore('snapshots').openCursor();
            cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;const s=localSnapshot(c.value?.data);if(s){turns.put(this.turnRow(s));const g=sessions.get(s.sid);g.onsuccess=()=>{const row=g.result;if(!row)return;const name=nextName(row.name||null,pickName(s));if(name){row.name=name;row.title=('#'+row.seq+' '+name.name).slice(0,100);sessions.put(row);}};}c.continue();};}}
        if(e.oldVersion<3){const raw=db.createObjectStore('raw',{keyPath:'key'});raw.createIndex('at','at');raw.createIndex('sid','sid');const sent=db.createObjectStore('sent',{keyPath:'id'});sent.createIndex('at','at');const meta=tx.objectStore('meta');
          // 原始数据从 turns / snapshots 拆到 raw 表，并统计总量
          let total=0,count=0;const moved=new Set(),empty={events:[],spans:{},probe:null};
          const move=d=>{const r=d?.raw,key=typeof d?.key==='string'?d.key:null;if(r&&typeof r==='object'&&key&&!moved.has(key)&&(r.events?.length||Object.keys(r.spans||{}).length)){moved.add(key);const bytes=JSON.stringify(r).length;total+=bytes;count++;raw.put({key,sid:d.sid,at:typeof d.at==='string'?d.at:new Date(0).toISOString(),bytes,data:r});}return {...d,raw:empty};};
          const finish=()=>{meta.put({key:'rawTotal',value:total});meta.put({key:'rawCount',value:count});};
          const snaps=()=>{const sc=tx.objectStore('snapshots').openCursor();sc.onsuccess=()=>{const c=sc.result;if(!c){finish();return;}const v=c.value;if(v?.data?.raw)c.update({...v,data:move(v.data)});c.continue();};sc.onerror=finish;};
          if(e.oldVersion>=2){const tc=tx.objectStore('turns').openCursor();tc.onsuccess=()=>{const c=tc.result;if(!c){snaps();return;}const v=c.value;if(v?.data?.raw)c.update({...v,data:move(v.data)});c.continue();};tc.onerror=snaps;}
          else if(e.oldVersion>=1)snaps();else finish();}
      };
      request.onerror=()=>resolve(null);request.onblocked=()=>{this.failure(sidOf(location.href));};request.onsuccess=()=>{if(this.closed){request.result.close();resolve(null);return;}this.db=request.result;this.db.onversionchange=()=>{this.db.close();this.persistent=false;this.failure(sidOf(location.href));};resolve(this.db);};
    }).then(async db=>{if(!db){this.failure(sidOf(location.href));return null;}this.persistent=true;await this.migrate().catch(()=>this.failure(sidOf(location.href)));const counters=await this.metaGet(['rawTotal','rawCount']);this.rawTotal=number(counters.rawTotal)??0;this.rawCount=number(counters.rawCount)??0;const rows=await this.rows('sessions',null,null,'next',100000);for(const row of rows){this.entries.set(row.sid,row);this.seq=Math.max(this.seq,row.seq||0);}try{this.channel=new BroadcastChannel('amp.lite.local');this.channel.onmessage=e=>{const row=e.data;if(row?.kind==='session'&&/^\w[\w-]{0,127}$/.test(row.entry?.sid||'')&&number(row.entry.seq)!==null){this.entries.set(row.entry.sid,row.entry);this.snapshots.delete(row.entry.sid);this.loading.delete(row.entry.sid);this.turnLists.delete(row.entry.sid);this.changed();}if(row?.kind==='logs'){this.logRevision++;this.onchange?.();}};}catch{}this.changed();return db;}).catch(()=>{this.persistent=false;this.failure(sidOf(location.href));return null;});}
    migrate(){const old=load('amp.sessions.v2',null);if(!old?.sessions)return Promise.resolve();return new Promise(resolve=>{const tx=this.db.transaction(['sessions','meta'],'readwrite'),store=tx.objectStore('sessions'),count=store.count();count.onsuccess=()=>{if(count.result)return;let max=number(old.seq)||0;const used=new Set();for(const [sid,value]of Object.entries(old.sessions).slice(0,10000)){const seq=number(value?.seq);if(!/^\w[\w-]{0,127}$/.test(sid)||!seq||used.has(seq))continue;used.add(seq);max=Math.max(max,seq);store.put({sid,seq,models:[],title:'',at:null,partial:true,legacy:true});}tx.objectStore('meta').put({key:'seq',value:max});};tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>resolve();});}
    rows(store,index,key,direction='prev',limit=300){if(!this.db)return Promise.resolve([]);return new Promise(resolve=>{const out=[];try{const tx=this.db.transaction(store),source=index?tx.objectStore(store).index(index):tx.objectStore(store),req=source.openCursor(key===null?null:IDBKeyRange.only(key),direction);req.onsuccess=()=>{const c=req.result;if(!c||out.length>=limit){resolve(out);return;}out.push(c.value);c.continue();};req.onerror=()=>resolve(out);}catch{resolve(out);}});}
    metaGet(keys){return new Promise(resolve=>{const out={};if(!this.db){resolve(out);return;}try{const tx=this.db.transaction('meta'),store=tx.objectStore('meta');for(const k of keys){const q=store.get(k);q.onsuccess=()=>{out[k]=q.result?.value;};}tx.oncomplete=()=>resolve(out);tx.onerror=tx.onabort=()=>resolve(out);}catch{resolve(out);}});}
    // turns / snapshots 只存结构化部分；原始数据在 raw 表按 key 关联
    static strip(s){return {...s,raw:{events:[],spans:{},probe:null}};}
    turnRow(s){const last=s.calls.at(-1);return {key:s.key,sid:s.sid,runId:s.runId,turn:s.turn,attempt:s.attempt,segment:s.segment,at:s.at,startedAt:s.startedAt,sentAt:s.sentAt||null,prompt:s.prompt,count:s.count,calls:s.calls.length,model:last?.model||null,internal:last?.internal||s.internalNames[0]||null,effort:last?.effort?.value||null,credits:s.credits?.credits??null,partial:s.partial,rawBytes:JSON.stringify(s.raw||{}).length,data:LocalCatalog.strip(s)};}
    withRaw(data){const s=localSnapshot(data);if(!s||!this.db)return Promise.resolve(s);return new Promise(resolve=>{try{const req=this.db.transaction('raw').objectStore('raw').get(s.key);req.onsuccess=()=>{const r=req.result?.data;if(r&&typeof r==='object')s.raw=sanitizeRaw(r);resolve(s);};req.onerror=()=>resolve(s);}catch{resolve(s);}});}
    getSnapshot(sid){if(this.snapshots.has(sid))return Promise.resolve(this.snapshots.get(sid));if(this.loading.has(sid))return this.loading.get(sid);const p=this.ready.then(()=>new Promise(resolve=>{if(!this.db){resolve(null);return;}try{const req=this.db.transaction('snapshots').objectStore('snapshots').get(sid);req.onsuccess=()=>resolve(this.withRaw(req.result?.data));req.onerror=()=>resolve(null);}catch{resolve(null);}})).then(s=>{if(s)this.snapshots.set(sid,s);return s;});this.loading.set(sid,p);return p;}
    // 某会话的轮次列表（不含快照正文），按开始时间升序
    turnsOf(sid){if(!sid)return [];if(!this.turnLists.has(sid)){this.turnLists.set(sid,[]);void this.loadTurns(sid);}return this.turnLists.get(sid);}
    async loadTurns(sid){await this.ready;const rows=this.db?await this.rows('turns','sid',sid,'next',400):[];const list=rows.map(({data,...meta})=>meta).sort((a,b)=>(a.startedAt||a.at).localeCompare(b.startedAt||b.at)||a.at.localeCompare(b.at));const memory=this.turnLists.get(sid)||[];for(const m of memory)if(!list.some(x=>x.key===m.key))list.push(m);this.turnLists.set(sid,list);this.changed();}
    remember(key,s){this.turnCache.delete(key);this.turnCache.set(key,s);while(this.turnCache.size>12)this.turnCache.delete(this.turnCache.keys().next().value);}
    getTurn(key){if(this.turnCache.has(key))return Promise.resolve(this.turnCache.get(key));return this.ready.then(()=>new Promise(resolve=>{if(!this.db){resolve(null);return;}try{const req=this.db.transaction('turns').objectStore('turns').get(key);req.onsuccess=()=>{resolve(this.withRaw(req.result?.data).then(s=>{if(s)this.remember(key,s);return s;}));};req.onerror=()=>resolve(null);}catch{resolve(null);}}));}
    // importOnly：来自 localStorage 旧历史的导入，只在 IndexedDB 尚无该会话时写入，避免覆盖更完整的记录
    record(input,quiet=false,importOnly=false){const s=localSnapshot(input);if(!s||!s.calls.some(c=>c.model!=='未提供'))return Promise.resolve(null);const fingerprint=JSON.stringify({...s,at:''});if(this.fingerprints.get(s.key)===fingerprint)return Promise.resolve(this.entries.get(s.sid));this.fingerprints.set(s.key,fingerprint);
      this.pending.set(s.key,{s,quiet,importOnly});
      this.queue=this.queue.then(()=>this.ready).then(()=>{const job=this.pending.get(s.key);if(!job||job.s!==s)return null;this.pending.delete(s.key);return this.commit(job.s,job.importOnly).then(result=>{if(!result)return null;const {entry,applied,turnWritten}=result,before=this.entries.get(s.sid);this.entries.set(s.sid,entry);if(applied){this.snapshots.set(s.sid,s);}else if(this.db){this.snapshots.delete(s.sid);this.loading.delete(s.sid);}
        if(turnWritten){this.remember(s.key,s);const list=this.turnLists.get(s.sid);if(list){const {data,...meta}=this.turnRow(s);const i=list.findIndex(x=>x.key===meta.key);if(i>=0)list[i]=meta;else{list.push(meta);list.sort((a,b)=>(a.startedAt||a.at).localeCompare(b.startedAt||b.at)||a.at.localeCompare(b.at));}}}
        this.seq=Math.max(this.seq,entry.seq);this.changed();try{this.channel?.postMessage({kind:'session',entry});}catch{}try{this.onentry?.(entry,before,s,job.quiet||job.importOnly);}catch{}
        if(!job.quiet&&(!before||before.title!==entry.title))log('info','本地标题',(this.persistent?'已保存':'临时记录')+' '+entry.title,null,{sid:s.sid,runId:s.runId});else if(!job.quiet&&applied)log('detail','本地缓存','已更新 #'+entry.seq+' '+turnLabel(s)+' 的快照',null,{sid:s.sid,runId:s.runId});return entry;});}).catch(()=>{this.fingerprints.delete(s.key);this.failure(s.sid);return null;});return this.queue;
    }
    commit(s,importOnly=false){const models=[...new Set(s.calls.map(c=>c.request||c.model).filter(n=>n&&n!=='未提供'))],pick=pickName(s);
      const make=(seq,old)=>{const newer=!old?.at||old.at<=s.at,follow=newer&&pick?.source==='internal'&&old?.name?.name&&pick.name!==old.name.name;const name=(follow?pick:nextName(old?.name||(old?.models?.length?{name:old.models.join(' / '),source:'request',locked:false}:null),pick))||{name:models.join(' / '),source:'request',locked:false};return {sid:s.sid,seq,models:[...new Set([...(old?.models||[]),...models])].slice(0,8),name,title:('#'+seq+' '+name.name).slice(0,100),vendor:brand.of(s.calls.map(c=>(c.internal||'')+' '+(c.response||'')).join(' ')+' '+(s.internalNames||[]).join(' '))||old?.vendor||null,vmodel:(()=>{const c=[...s.calls].reverse().find(c=>brand.of(c.internal)||brand.of(c.response));return c?(brand.of(c.internal)?c.internal:c.response):((s.internalNames||[]).find(n=>brand.of(n))||old?.vmodel||null);})(),at:old?.at&&old.at>s.at?old.at:s.at,partial:s.partial,temporary:!this.persistent,runId:s.runId,turn:s.turn,turns:old?.turns||1,cloud:old?.cloud||null};};
      if(!this.db){const old=this.entries.get(s.sid);if(importOnly&&old)return Promise.resolve({entry:old,applied:false,turnWritten:false});const entry=make(old?.seq||++this.seq,old);const applied=!old?.at||old.at<=s.at;return Promise.resolve({entry,applied,turnWritten:applied});}
      return new Promise((resolve,reject)=>{let entry,applied=true,turnWritten=false;const tx=this.db.transaction(['sessions','snapshots','turns','raw','meta'],'readwrite'),sessions=tx.objectStore('sessions'),turns=tx.objectStore('turns'),meta=tx.objectStore('meta'),req=sessions.get(s.sid);
        const put=(seq,old)=>{if(!Number.isSafeInteger(seq)||seq<1){tx.abort();return;}entry=make(seq,old);const prev=turns.get(s.key);prev.onsuccess=()=>{if(!prev.result?.at||prev.result.at<=s.at){turns.put(this.turnRow(s));turnWritten=true;this.writeRaw(tx,s);}const cnt=turns.index('sid').count(IDBKeyRange.only(s.sid));cnt.onsuccess=()=>{entry.turns=Math.max(1,cnt.result||0);sessions.put(entry);};};if(!old?.at||old.at<=s.at)tx.objectStore('snapshots').put({sid:s.sid,data:LocalCatalog.strip(s)});else applied=false;};
        req.onsuccess=()=>{if(req.result){if(importOnly){entry=req.result;applied=false;return;}put(req.result.seq,req.result);return;}const counter=meta.get('seq');counter.onsuccess=()=>{const seq=(number(counter.result?.value)||0)+1;meta.put({key:'seq',value:seq});put(seq,null);};};tx.oncomplete=()=>resolve({entry,applied,turnWritten});tx.onerror=tx.onabort=()=>reject(tx.error||Error('本地事务失败'));});
    }
    // 原始数据写入 raw 表并维护总量；超过预算时按时间从最旧的轮开始删除
    writeRaw(tx,s){const r=s.raw;if(!r||!(r.events?.length||Object.keys(r.spans||{}).length||r.probe))return;const store=tx.objectStore('raw'),meta=tx.objectStore('meta'),bytes=JSON.stringify(r).length,prev=store.get(s.key);
      prev.onsuccess=()=>{const old=prev.result?.bytes||0;store.put({key:s.key,sid:s.sid,at:s.at,bytes,data:r});const mt=meta.get('rawTotal'),mc=meta.get('rawCount');
        mc.onsuccess=()=>{let total=Math.max(0,(number(mt.result?.value)||0)-old)+bytes,count=(number(mc.result?.value)||0)+(prev.result?0:1),removed=0,freed=0;const budget=(BUDGET_OPTIONS.includes(prefs.rawBudget)?prefs.rawBudget:64)*1048576;
          const done=()=>{this.rawTotal=Math.max(0,total);this.rawCount=Math.max(0,count-removed);meta.put({key:'rawTotal',value:this.rawTotal});meta.put({key:'rawCount',value:this.rawCount});if(removed)log('detail','本地缓存','原始数据超出预算，已清理最旧 '+removed+' 轮（'+(freed/1048576).toFixed(1)+' MB）');};
          if(total<=budget){done();return;}const cur=store.index('at').openCursor();cur.onsuccess=()=>{const c=cur.result;if(!c||total<=budget){done();return;}if(c.value.key!==s.key){total-=c.value.bytes||0;freed+=c.value.bytes||0;removed++;c.delete();}c.continue();};cur.onerror=done;};};}
    setCloud(sid,cloud){return this.ready.then(()=>new Promise(resolve=>{const e=this.entries.get(sid);if(e){e.cloud=cloud;this.changed();}if(!this.db){resolve();return;}try{const tx=this.db.transaction('sessions','readwrite'),store=tx.objectStore('sessions'),q=store.get(sid);q.onsuccess=()=>{if(q.result){q.result.cloud=cloud;store.put(q.result);}};tx.oncomplete=tx.onerror=tx.onabort=()=>resolve();}catch{resolve();}}));}
    // 消息发送时间（非 UUIDv7 消息 id 的回退来源）
    noteSent(id,at,sid){if(this.closed||typeof id!=='string'||!Number.isFinite(at))return;this.sent.set(id,at);if(this.sent.size>SENT_KEEP)this.sent.delete(this.sent.keys().next().value);this.pendingSent.push({id,at,sid:sid||''});if(!this.sentTimer)this.sentTimer=setTimeout(()=>this.flushSent(),500);}
    async flushSent(){this.sentTimer=0;await this.ready;const items=this.pendingSent.splice(0);if(!this.db||this.closed||!items.length)return;try{const tx=this.db.transaction('sent','readwrite'),store=tx.objectStore('sent');for(const e of items)store.put(e);this.sentWrites+=items.length;if(this.sentWrites>=100){this.sentWrites=0;const cnt=store.count();cnt.onsuccess=()=>{let extra=cnt.result-SENT_KEEP;if(extra<=0)return;const cur=store.index('at').openCursor();cur.onsuccess=()=>{const c=cur.result;if(!c||extra<=0)return;c.delete();extra--;c.continue();};};}}catch{}}
    sentAt(ids){const out=new Map(),missing=[];for(const id of ids){if(this.sent.has(id)){const at=this.sent.get(id);if(at!==null)out.set(id,at);}else missing.push(id);}if(!missing.length)return Promise.resolve(out);
      return this.ready.then(()=>new Promise(resolve=>{if(!this.db){resolve(out);return;}try{const store=this.db.transaction('sent').objectStore('sent');let n=0;const step=()=>{if(++n===missing.length)resolve(out);};for(const id of missing){const q=store.get(id);q.onsuccess=()=>{const at=number(q.result?.at);this.sent.set(id,at);if(at!==null)out.set(id,at);step();};q.onerror=step;}}catch{resolve(out);}}));}
    count(store){return new Promise(resolve=>{if(!this.db){resolve(null);return;}try{const q=this.db.transaction(store).objectStore(store).count();q.onsuccess=()=>resolve(q.result);q.onerror=()=>resolve(null);}catch{resolve(null);}});}
    async usage(){await this.ready;let estimate=null;try{const e=await navigator.storage?.estimate?.();if(e)estimate={usage:number(Math.round(e.usage||0)),quota:number(Math.round(e.quota||0))};}catch{}const counts={};for(const st of ['sessions','turns','raw','logs','sent'])counts[st]=await this.count(st);return {rawTotal:this.rawTotal,rawCount:this.rawCount,counts,estimate,persistent:this.persistent};}
    async clearRaw(){await this.ready;if(this.db)await new Promise(resolve=>{try{const tx=this.db.transaction(['raw','meta'],'readwrite');tx.objectStore('raw').clear();tx.objectStore('meta').put({key:'rawTotal',value:0});tx.objectStore('meta').put({key:'rawCount',value:0});tx.oncomplete=tx.onerror=tx.onabort=()=>resolve();}catch{resolve();}});this.rawTotal=0;this.rawCount=0;for(const s of this.turnCache.values())s.raw={events:[],spans:{},probe:null};this.changed();}
    async exportAll(withRaw=false){await this.ready;const sessions=[...this.entries.values()].sort((a,b)=>(a.seq||0)-(b.seq||0)),rows=this.db?await this.rows('turns',null,null,'next',100000):[];const raw=new Map();if(withRaw&&this.db)for(const r of await this.rows('raw',null,null,'next',100000))raw.set(r.key,r.data);
      return {sessions,turns:rows.map(({data,...meta})=>({...meta,data:data?(withRaw?{...data,raw:raw.get(meta.key)||null}:LocalCatalog.strip(data)):null})),rawIncluded:withRaw};}
    addLog(entry){if(this.closed)return;const e={at:entry.at,level:entry.level,stage:String(entry.stage).slice(0,40),text:String(entry.text).slice(0,1600),sid:entry.sid||'',runId:entry.runId||null,spanId:entry.spanId||null};this.localLogs.push(e);if(this.localLogs.length>600)this.localLogs.shift();this.pendingLogs.push(e);this.logRevision++;if(!this.flushTimer)this.flushTimer=setTimeout(()=>this.flush(),350);}
    async flush(){this.flushTimer=0;await this.ready;const items=this.pendingLogs.splice(0);if(!this.db||this.closed||!items.length)return;try{const tx=this.db.transaction('logs','readwrite'),store=tx.objectStore('logs');let last=0;for(const [i,e]of items.entries()){const req=store.add(e);req.onsuccess=()=>{last=req.result;if(i===items.length-1&&last>4000){const cursor=store.openCursor(IDBKeyRange.upperBound(last-4000));cursor.onsuccess=()=>{const c=cursor.result;if(c){c.delete();c.continue();}};}};}tx.oncomplete=()=>{this.logRevision++;this.onchange?.();try{this.channel?.postMessage({kind:'logs'});}catch{}};tx.onerror=()=>{this.pendingLogs=[];};}catch{this.pendingLogs=[];}}
    async readLogs(sid){await this.ready;const memory=this.localLogs.filter(e=>!e.sid||e.sid===sid);if(!this.db)return memory.slice(-600);const persisted=await this.rows('logs','sid',sid||'','prev',600),global=await this.rows('logs','sid','','prev',40),seen=new Set();return [...persisted,...global,...memory].sort((a,b)=>a.at.localeCompare(b.at)).filter(e=>{const k=[e.at,e.level,e.stage,e.text,e.sid,e.runId,e.spanId].join('|');if(seen.has(k))return false;seen.add(k);return true;}).slice(-600);}
    async clearLogs(){this.localLogs=[];this.pendingLogs=[];logs.length=0;await this.ready;if(this.db)await new Promise(resolve=>{try{const tx=this.db.transaction('logs','readwrite');tx.objectStore('logs').clear();tx.oncomplete=tx.onerror=()=>resolve();}catch{resolve();}});this.logRevision++;this.onchange?.();try{this.channel?.postMessage({kind:'logs'});}catch{}}
    destroy(){this.closed=true;clearTimeout(this.flushTimer);clearTimeout(this.sentTimer);this.channel?.close();this.db?.close();}
  }
  const catalog=new LocalCatalog();onSnapshot=s=>void catalog.record(s);onLog=e=>catalog.addLog(e);onSent=(id,at)=>catalog.noteSent(id,at,sidOf(location.href));catalog.onchange=()=>{paint();brandTick();};
  // 厂商图标：对话名没有关键词时，用本地缓存里的内部名称/请求型号识别厂商。
  brand.hint.get=sid=>{const e=sid&&catalog.entries.get(sid);return e?[e.vendor,e.name?.name,...(e.models||[])].filter(Boolean).join(' '):'';};brand.hint.rev=()=>catalog.revision;
  let brandTimer=0;function brandTick(){if(brandTimer)return;brandTimer=setTimeout(()=>{brandTimer=0;try{window.dispatchEvent(new CustomEvent('amp-native-gacha'));}catch{}},250);}
  // 云端标题同步（可选，默认关闭）：PATCH /api/history/agentic/{sid}，即页面自带“重命名”所用接口；每个会话同一标题只发一次
  const cloudState=new Map();
  async function syncTitle(entry,manual=false){
    if(stopped||!enabled||!entry?.title||!entry.name?.name||entry.temporary||gacha.ownsTitle(entry.sid))return false;if(!prefs.cloudSync&&!manual)return false;
    const want=(prefs.cloudFormat==='name'?entry.name.name:entry.title).slice(0,100);
    if(entry.cloud?.title===want||!manual&&!(entry.name.locked||!entry.partial))return false;
    const st=cloudState.get(entry.sid)||{at:0,fails:0},now=Date.now();if(!manual&&(now-st.at<60000||st.fails>=3))return false;st.at=now;cloudState.set(entry.sid,st);
    if(!manual){await gacha.waitIdle();if(stopped||entry.cloud?.title===want)return false;}
    try{const res=await rawFetch(location.origin+'/api/history/agentic/'+encodeURIComponent(entry.sid),{method:'PATCH',headers:{'content-type':'application/json',Accept:'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({title:want})});
      if(!res.ok){st.fails++;log('warn','云端标题','PATCH HTTP '+res.status+(res.status===401||res.status===403?' · 需要登录':''),null,{sid:entry.sid});return false;}
      st.fails=0;await catalog.setCloud(entry.sid,{title:want,at:new Date().toISOString()});log('info','云端标题','已同步 '+want,null,{sid:entry.sid});paint();return true;
    }catch(e){st.fails++;log('warn','云端标题','同步失败',e,{sid:entry.sid});return false;}
  }
  catalog.onentry=(entry,before,snap,quiet)=>{try{if(snap?.calls?.length&&(!entry.at||!snap.at||snap.at>=entry.at)){const calls=snap.calls.filter(c=>c&&c.model!=='未提供'),reqs=[...new Set(calls.map(c=>c.request).filter(Boolean))],last=calls.at(-1)||{},resp=last.response||last.internal||last.request||null,label='#'+entry.seq+' · '+(entry.title||'').replace(/^#\d+\s*/,'');const v=vip.note(entry.sid,reqs);void v;if(resp)routeAlert.note(entry.sid,resp,label,quiet);}}catch{}const o=before?.name?.name,n=entry?.name?.name;if(o&&n&&o!==n&&entry.name.source==='internal'){log('info','模型变化',o+' → '+n,null,{sid:entry.sid});try{gacha.followModel(entry.sid,o,n);}catch{}if(entry.cloud?.title&&!gacha.ownsTitle(entry.sid))void syncTitle(entry,true);paint();}else void syncTitle(entry);try{window.dispatchEvent(new Event('amp-title-sync'));}catch{}};
  void catalog.ready.then(async()=>{for(const s of history.slice().reverse())await catalog.record(s,true,true);});
  const css=`
:host{all:initial;position:relative;color-scheme:inherit;font:400 13px/1.55 var(--font-basel-grotesk,var(--font-inter,system-ui)),'PingFang SC','Microsoft YaHei',sans-serif;color:var(--fg);--bg:hsl(var(--surface-primary,36 45% 98%));--raised:hsl(var(--surface-tertiary,33 31% 94%));--line:hsl(var(--border-faint,30 5% 93%));--edge:hsl(var(--border-medium,30 9% 87%));--fg:hsl(var(--text-primary,24 6% 17%));--secondary:hsl(var(--text-tertiary,35 6% 38%));--heading:hsl(var(--header-primary,60 3% 14%));--green:hsl(var(--interactive-positive,125 49% 43%));--warn:hsl(var(--syntax-yellow,48 92% 38%));--mono:var(--font-basel-grotesk-mono,var(--font-dm-mono,ui-monospace)),Consolas,monospace}
:host([hidden]),[hidden]{display:none!important}:host([data-floating]){position:fixed;top:12px;right:56px;z-index:40;margin:0}
*{box-sizing:border-box}button,select{font:inherit;color:inherit}button{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:none;border:0;border-radius:4px;padding:5px 8px;cursor:pointer;transition:background .12s,color .12s}button:hover{background:var(--raised);color:var(--heading)}button:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--heading);outline-offset:2px}button:disabled{opacity:.4;cursor:default}button:disabled:hover{background:none}svg{display:block;flex:none;width:16px;height:16px;pointer-events:none}h2,h3,p{margin:0}h2{font-size:14px;font-weight:500;color:var(--heading)}h3{font-size:12px;font-weight:500;color:var(--secondary)}.mono,code{font-family:var(--mono);font-variant-numeric:tabular-nums}code{overflow-wrap:anywhere}.muted{color:var(--secondary)}.warning{color:var(--warn)}.grow{flex:1;min-width:0}.icon-button{width:28px;height:28px;padding:6px;color:var(--secondary);flex:none}.icon-button svg{width:15px;height:15px}
.trigger{height:32px;max-width:310px;padding:0 8px;gap:8px;font-size:12px;white-space:nowrap}.trigger[aria-expanded=true]{background:var(--raised)}.trigger-label{overflow:hidden;text-overflow:ellipsis;max-width:168px}.trigger-mini{font-size:11px;color:var(--secondary);border-left:1px solid var(--edge);padding-left:8px}.chevron{width:12px;height:12px;color:var(--secondary)}
.head{display:flex;align-items:center;gap:8px;padding:12px 16px 8px;flex:none}.head>.grow{display:flex;align-items:center;gap:8px}.return-live{font-size:11px;padding:2px 5px}
.tabs{display:flex;gap:16px;padding:0 16px;border-bottom:1px solid var(--line);flex:none;overflow-x:auto;scrollbar-width:none}.tab{position:relative;border-radius:0;padding:8px 0 10px;color:var(--secondary);font-size:12px;flex:none}.tab[aria-selected=true]{color:var(--heading)}.tab[aria-selected=true]:after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:2px;background:var(--heading)}.tab:hover{background:none}
.pickers{display:flex;flex-direction:column;gap:6px;margin:12px 14px 0;flex:none}.call-picker{display:flex;align-items:center;gap:10px;font-size:11px;color:var(--secondary)}.call-picker>span:first-child{flex:none;width:28px}.selector{flex:1;min-width:0;border:1px solid var(--edge);border-radius:4px;background:var(--bg);color:var(--fg);padding:5px 7px;font-size:12px;max-width:100%}.selector option{background:var(--bg);color:var(--fg)}
.body{padding:16px;overflow:auto;overscroll-behavior:contain;min-height:0;scrollbar-width:thin;scrollbar-color:var(--edge) transparent}.section+.section{margin-top:20px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}.eyebrow{font-size:11px;color:var(--secondary)}.model-title{display:flex;align-items:flex-start;gap:6px;margin:4px 0 10px}.name{font:400 17px/1.5 var(--mono);letter-spacing:-.025em;overflow-wrap:anywhere;min-width:0;flex:1;color:var(--heading)}.model-title .icon-button{margin-right:-5px;margin-top:-1px}.row{display:grid;grid-template-columns:80px minmax(0,1fr);align-items:baseline;gap:10px;padding:6px 0;font-size:12px}.key{color:var(--secondary)}.value{overflow-wrap:anywhere;white-space:pre-wrap;min-width:0}.model-more{margin-top:5px;padding-top:6px;border-top:1px solid var(--line)}summary{display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;color:var(--secondary);list-style:none;padding:3px 0}summary::-webkit-details-marker{display:none}summary svg{width:12px;height:12px}details[open]>summary svg{transform:rotate(90deg)}
.config{border:1px solid var(--edge);border-radius:6px;overflow:hidden}.config-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 12px;font-size:12px}.config-row+.config-row{border-top:1px solid var(--line)}.config-label{color:var(--secondary)}.config-value{font:400 14px/1.3 var(--mono);overflow-wrap:anywhere;text-align:right;max-width:60%}.tag{font:400 15px/1.3 var(--mono);background:var(--raised);border-radius:4px;padding:4px 7px;color:var(--heading)}.note{font-size:11px;line-height:1.65;color:var(--secondary);margin-top:7px;overflow-wrap:anywhere}.note.warning{color:var(--warn)}.usage{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}.usage-cell{min-width:0}.usage-label{font-size:11px;color:var(--secondary)}.usage-value{font:400 17px/1.5 var(--mono);letter-spacing:-.035em;margin:3px 0 1px;overflow-wrap:anywhere;color:var(--heading)}.usage-total{display:flex;justify-content:space-between;gap:10px;padding-top:10px;margin-top:9px;border-top:1px solid var(--line);font-size:11px;color:var(--secondary)}.usage-total strong{font-weight:400;color:var(--fg)}.usage-turn{margin-top:10px;padding-top:8px;border-top:1px dashed var(--line);font-size:11px;color:var(--secondary);display:flex;flex-wrap:wrap;gap:3px 12px}.usage-turn strong{font-weight:400;color:var(--fg);font-family:var(--mono)}.pill{display:inline-block;font-size:10px;padding:1px 5px;border-radius:3px;background:var(--raised);color:var(--secondary);margin-left:6px;vertical-align:middle;font-family:inherit}
.empty{padding:28px 10px 32px;text-align:center}.empty-icon{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid var(--edge);border-radius:8px;color:var(--secondary);margin-bottom:12px}.empty-icon svg{width:19px;height:19px}.empty strong{font-size:14px;font-weight:500;display:block;color:var(--heading)}.empty p{font-size:12px;line-height:1.9;color:var(--secondary);margin-top:7px;white-space:pre-line}
.group-title{font-size:11px;color:var(--secondary);margin:16px 0 2px}.group-title:first-child{margin-top:0}.entry{padding:10px 0;border-top:1px solid var(--line);font-size:12px}.entry-top{display:flex;justify-content:space-between;gap:8px}.entry-source{font-size:10px;color:var(--secondary);flex:none}.entry code{display:block;margin-top:4px;font-size:11px;color:var(--secondary)}.legend{font-size:10px;line-height:1.7;color:var(--secondary);margin-top:12px;padding-top:8px;border-top:1px solid var(--line)}.legend code{font-size:10px}
.history-item{width:100%;display:block;text-align:left;padding:11px 8px;border-bottom:1px solid var(--line);border-radius:4px;font-size:12px}.history-item[data-open]{background:var(--raised)}.history-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono)}.history-meta{display:flex;justify-content:space-between;gap:8px;font-size:10px;color:var(--secondary);margin-top:4px}.turn-list{margin:4px 0 10px 6px;border-left:1px solid var(--edge);padding-left:6px}.turn-item{width:100%;display:block;text-align:left;padding:8px;border-radius:4px;font-size:12px}.turn-item[data-current]{outline:1px solid var(--edge)}.turn-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.turn-meta{display:flex;justify-content:space-between;gap:8px;font-size:10px;color:var(--secondary);margin-top:3px;font-family:var(--mono)}.clear{font-size:11px;color:var(--secondary);margin-top:12px}
.logline{border-top:1px solid var(--line);padding:10px 0;font-size:12px;overflow-wrap:anywhere}.log-meta{display:flex;justify-content:space-between;color:var(--secondary);font-size:10px;margin-bottom:4px}.logline.warn{color:var(--warn)}.logline.error{color:hsl(var(--interactive-negative,2 63% 54%))}.log-origin{margin-top:4px}.log-origin summary{font-size:10px}.log-origin code{display:block;font-size:10px;word-break:break-all;color:var(--secondary)}
.footer{padding:8px 10px;display:flex;align-items:center;gap:2px;border-top:1px solid var(--line);flex:none}.footer button{font-size:11px;color:var(--secondary);gap:5px}.footer svg{width:13px;height:13px}.upd{cursor:pointer;border:0;background:none;border-radius:6px;padding:3px 6px!important}.upd:hover{background:var(--line)}.upd[data-new='1']{color:#fff!important;background:#6a5e54}
.upds{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:1px;min-width:0}.upds .footer-note{margin-left:0;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}.upd[data-miss='1']{opacity:.7}.footer-note{margin-left:auto;font:10px var(--mono);color:var(--secondary);padding-right:3px}.toast{font-size:11px;text-align:center;color:var(--secondary);padding:6px 12px;border-top:1px solid var(--line);flex:none}
.raw-controls{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px}.raw-controls .selector{flex:1;min-width:110px}.raw-controls button{font-size:11px;border:1px solid var(--edge);padding:4px 7px}.event-row{display:grid;grid-template-columns:54px minmax(0,1fr) auto;gap:8px;padding:5px 0;border-top:1px solid var(--line);font-size:11px;align-items:baseline;width:100%;text-align:left;border-radius:0;color:var(--fg)}.event-row[data-kind=stream]{color:var(--heading)}.event-row[data-kind=marker]{color:var(--warn)}.event-row[data-active]{background:var(--raised)}.event-row time{font-family:var(--mono);font-size:10px;color:var(--secondary)}.event-msg{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.event-extra{font-family:var(--mono);font-size:10px;color:var(--secondary);white-space:nowrap}pre.json{margin:8px 0 0;padding:10px;border:1px solid var(--edge);border-radius:6px;background:var(--raised);font:11px/1.5 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere;max-height:60vh;overflow:auto;color:var(--fg)}
.theme-toggle{width:32px;max-width:32px;padding:0;justify-content:center}.theme-toggle .trigger-label,.theme-toggle .trigger-mini{display:none!important}.theme-toggle svg{transition:transform .4s cubic-bezier(.34,1.6,.5,1)}.theme-toggle:hover svg{transform:rotate(-20deg) scale(1.1)}@media(max-width:767px){.trigger{width:32px;max-width:32px;padding:0;justify-content:center}.trigger-label,.trigger-mini,.trigger>.chevron{display:none}.usage-value{font-size:17px}:host{margin-inline-end:4px}}@media(prefers-reduced-motion:reduce){button{transition:none}}
:host([data-entry]){display:inline-flex;vertical-align:top;margin-inline-end:6px;flex:none}
:host([data-dock]){display:block;flex:0 0 var(--amp-width,340px);width:var(--amp-width,340px);min-width:0;height:calc(100dvh - var(--amp-bar-h,0px));align-self:stretch;margin:0;z-index:1;position:relative}
.panel{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--bg);border-left:1px solid var(--edge);position:relative}.resizer{position:absolute;top:0;bottom:0;left:-3px;width:7px;cursor:col-resize;z-index:5;touch-action:none}.resizer:hover,.resizer[data-active]{background:var(--edge)}.drag-shield{position:fixed;inset:0;z-index:2147483000;cursor:col-resize;user-select:none}
.head{min-height:52px;padding:10px 14px}.head>.grow{gap:9px}.head .icon-button{margin-left:auto}.local-number{font-size:11px;color:var(--secondary)}.body{flex:1;padding:14px;min-height:0}.name{font-size:16px}.section+.section{margin-top:17px}.tabs{padding:0 14px}.config-row{padding:9px 10px}.config-label{font-size:12px}.row{grid-template-columns:76px minmax(0,1fr);gap:8px}.footer{padding:8px 9px}.cache-banner{display:flex;align-items:center;gap:8px;padding:5px 14px 9px;font-size:10px;color:var(--secondary)}.compact-bar{display:none}.log-controls{display:flex;align-items:center;gap:12px;margin-bottom:8px}.log-controls .selector{margin-left:auto;flex:none;width:100px}.log-actions{display:flex;gap:6px;flex-wrap:wrap}.log-actions button{font-size:11px;border:1px solid var(--edge);padding:4px 7px}
:host([data-compact]){width:100%;height:auto;flex:0 0 auto;margin:0;max-height:55dvh}.panel .compact-top{display:flex;align-items:center;gap:9px}.compact-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.compact-toggle{font-size:11px;color:var(--secondary);padding:4px 8px;flex:none}.compact-info{font-size:11px;color:var(--secondary);margin-top:3px}:host([data-compact]) .panel{height:auto;max-height:55dvh;border-left:0;border-top:1px solid var(--edge)}:host([data-compact]) .resizer{display:none}:host([data-compact]) .compact-bar{display:block;padding:8px 12px;flex:none}:host([data-compact]) .head{display:none}:host([data-compact]:not([data-expanded])) .tabs,:host([data-compact]:not([data-expanded])) .cache-banner,:host([data-compact]:not([data-expanded])) .pickers,:host([data-compact]:not([data-expanded])) .body,:host([data-compact]:not([data-expanded])) .footer,:host([data-compact]:not([data-expanded])) .toast{display:none}:host([data-compact]) .body{max-height:calc(55dvh - 145px)}
.logbar{padding:12px 14px 0;flex:none}:host([data-compact]:not([data-expanded])) .logbar{display:none}
@media(max-height:600px){:host([data-compact][data-expanded]),:host([data-compact][data-expanded]) .panel{max-height:75dvh}:host([data-compact][data-expanded]) .body{max-height:calc(75dvh - 145px)}}
:host([data-grip]){display:block;position:fixed;top:0;width:0;height:0;z-index:60}.grip{position:fixed;width:6px;cursor:col-resize;touch-action:none;z-index:60}.grip:hover,.grip[data-active]{background:var(--edge)}
.status{display:flex;flex-wrap:wrap;gap:4px 12px;padding:6px 14px 0;font-size:11px;color:var(--secondary);flex:none;min-height:0}.status[hidden]{display:none}.status strong{font-weight:400;color:var(--fg);font-family:var(--mono)}.status .blocked{color:hsl(var(--interactive-negative,2 63% 54%))}.status .low{color:var(--warn)}
.setting{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--line);font-size:12px}.setting:first-of-type{border-top:0}.setting .grow{display:flex;flex-direction:column;gap:2px}.setting .hint{font-size:10px;color:var(--secondary);line-height:1.5}.setting .selector{flex:none;width:112px}.switch{position:relative;width:34px;height:20px;border-radius:10px;background:var(--edge);flex:none;padding:0;transition:background .12s}.switch[aria-checked=true]{background:var(--green)}.switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--bg);transition:transform .12s}.switch[aria-checked=true]::after{transform:translateX(14px)}.switch:hover{background:var(--edge)}.switch[aria-checked=true]:hover{background:var(--green)}
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}.stat{border:1px solid var(--edge);border-radius:6px;padding:8px 10px}.stat-label{font-size:10px;color:var(--secondary)}.stat-value{font:400 13px/1.5 var(--mono);color:var(--heading);overflow-wrap:anywhere}.bar{height:4px;border-radius:2px;background:var(--raised);overflow:hidden;margin-top:6px}.bar i{display:block;height:100%;background:var(--heading)}
:host([data-fold]){display:block;position:fixed;top:0;left:0;width:0;height:0;z-index:45}.fold{position:fixed;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:22px;min-height:40px;padding:10px 0;border:1px solid var(--edge);border-right:0;border-radius:10px 0 0 10px;background:var(--bg);color:var(--secondary);box-shadow:-3px 2px 12px #00000014;font-size:11px;line-height:1.2}.fold:hover{background:var(--raised);color:var(--heading)}.fold svg{width:14px;height:14px;transform:rotate(180deg);transition:transform .2s}.fold[data-open] svg{transform:none}.fold-label{writing-mode:vertical-rl;letter-spacing:2px;font-weight:500}.fold[data-open] .fold-label{display:none}
.head-fold{margin-left:auto;flex:none;height:28px;padding:0 6px 0 10px;gap:2px;font-size:12px;color:var(--secondary);border:1px solid var(--edge);border-radius:14px}.head-fold svg{width:14px;height:14px}
.upd.chentry{opacity:.55}.upd.chentry:hover{opacity:1}.chform{display:flex;align-items:center;gap:4px;padding:2px 0 1px}.chform input{width:118px;height:22px;box-sizing:border-box;padding:0 7px;border:1px solid var(--edge);border-radius:6px;background:var(--bg);color:var(--fg);font:11px var(--mono);outline:0}.chform input:focus{border-color:var(--secondary)}.chform input[data-bad]{border-color:#c0584f;animation:chshake .28s}.chform button{height:22px;padding:0 8px!important;border:1px solid var(--edge);border-radius:6px}@keyframes chshake{25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
`;
  function el(tag,cls,text,parent){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined&&text!==null)e.textContent=text;if(parent)parent.append(e);return e;}
  function button(parent,text,title,fn,cls=''){const b=el('button',cls,text,parent);b.type='button';b.title=title;b.setAttribute('aria-label',title);b.dataset.focus=title;b.onclick=fn;return b;}
  const paths={sun:['M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4','M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z'],moon:['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z'],cube:['m12 3 9 5-9 5-9-5 9-5Z','M3 8v9l9 5 9-5V8M12 13v9'],chevron:['m9 5 7 7-7 7'],down:['m6 9 6 6 6-6'],copy:['M9 9h12v12H9z','M15 5V3H3v12h2'],download:['M12 3v12m-5-5 5 5 5-5','M4 16v5h16v-5']};
  function icon(name,parent,cls=''){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [k,v]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.5','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))s.setAttribute(k,v);if(cls)s.setAttribute('class',cls);for(const d of paths[name]||[]){const p=document.createElementNS(s.namespaceURI,'path');p.setAttribute('d',d);s.append(p);}parent?.append(s);return s;}
  function iconButton(parent,name,title,fn){const b=button(parent,'',title,fn,'icon-button');icon(name,b);return b;}
  function download(data,name='amp-lite-export.json'){const a=document.createElement('a'),u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),10000);}
  // 原始数据：内存里有完整版就用完整版，否则用缓存的精简版
  function rawOf(s){if(!s)return null;const mem=rawStore.get(s.key);if(mem)return {events:s.raw?.events?.length?s.raw.events:[],spans:Object.fromEntries(mem.spans),trace:mem.trace,probe:mem.probe||s.raw?.probe||null,full:true};return {events:s.raw?.events||[],spans:s.raw?.spans||{},trace:null,probe:s.raw?.probe||null,full:false};}
  function exported(){const s=ui?.view(),snap=localSnapshot(s),sid=snap?.sid||sidOf(location.href),raw=rawOf(s);return{tool:'Arena Model Probe Lite',version:VERSION,at:new Date().toISOString(),sid,pageSid:sidOf(location.href),frames,queries,cooldown,snapshot:snap?{...snap,raw:undefined}:null,local:catalog.entries.get(sid)||null,turns:catalog.turnsOf(sid),persistent:catalog.persistent,quota,balance,credits:costState.get(sid)?.credits||null,raw:raw?{full:raw.full,events:raw.events,trace:raw.trace,spans:raw.spans,probe:raw.probe}:null,logs:logs.slice()};}
  function refresh(){const r=selectedRun();if(!r){log('info','重读','当前没有可用的运行读取权限');return;}if(Date.now()<cooldown){log('warn','重读','限流冷却中',null,r);return;}r.tries=0;r.finalReads=0;later(r,0,true);if(prefs.showCredits&&!(r.credits&&r.credits.source==='message'))scheduleCost(r.sid,300,true);}
  async function fetchSpan(r,id){if(!r?.token||r.busy||!SPAN.test(id))return;const ctrl=new AbortController();try{const d=await json(r,'spans/'+id,ctrl.signal);r.rawSpans.set(id,d);if(r.data)keepRaw(r);log('detail','Span','已按需读取 '+id,null,{sid:r.sid,runId:r.runId,spanId:id});}catch(e){log('warn','Span','按需读取失败',e,{sid:r.sid,runId:r.runId,spanId:id});}paint();}
  function dragger(handle,hooks){
    handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();const start=hooks.start(e);if(!start)return;try{handle.setPointerCapture(e.pointerId);}catch{}handle.dataset.active='';const shield=el('div','drag-shield',null,handle.getRootNode());let moved=false;
      const move=ev=>{if(Math.abs(ev.clientX-start.x)>2)moved=true;if(moved)hooks.move(ev,start);},up=ev=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',up);delete handle.dataset.active;shield.remove();if(moved)hooks.end(ev,start);else hooks.tap?.(ev);};
      handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',up);});
    handle.addEventListener('dblclick',e=>{e.preventDefault();hooks.reset();});
  }
  // 把没有拖动的单击转发给被遮住的元素（Arena 侧栏边缘自带的折叠按钮）
  function forwardTap(handle,e){const host=handle.getRootNode().host||handle;const prev=host.style.pointerEvents;host.style.pointerEvents='none';try{const target=document.elementFromPoint(e.clientX,e.clientY);if(target&&target!==host)target.click();}finally{host.style.pointerEvents=prev;}}
  // Arena 左侧会话栏：shadcn 侧栏用 --sidebar-width 变量控制宽度，覆盖该变量即可调宽
  const sidebarOriginal=new WeakMap();
  function findSidebar(){const wrapper=[...document.querySelectorAll('[style*="--sidebar-width"]')].find(e=>e.style.getPropertyValue('--sidebar-width'));if(!wrapper)return null;const peer=wrapper.querySelector('[data-side][data-state]'),panel=wrapper.querySelector('[data-sidebar="sidebar"]')||peer;return {wrapper,peer,panel};}
  function sidebarWidth(sb){const v=sb.wrapper.style.getPropertyValue('--sidebar-width').trim();let n=NaN;if(/px$/.test(v))n=parseFloat(v);else if(/rem$/.test(v))n=parseFloat(v)*(parseFloat(getComputedStyle(document.documentElement).fontSize)||16);return Number.isFinite(n)&&n>0?n:sb.panel?.getBoundingClientRect().width||240;}
  function applySidebar(w){const sb=findSidebar();if(!sb)return null;if(!sidebarOriginal.has(sb.wrapper))sidebarOriginal.set(sb.wrapper,sb.wrapper.style.getPropertyValue('--sidebar-width'));const target=w?w+'px':sidebarOriginal.get(sb.wrapper)||'';if(sb.wrapper.style.getPropertyValue('--sidebar-width')!==target)sb.wrapper.style.setProperty('--sidebar-width',target);return sb;}
  function mount(){
    if(stopped||ui||!document.body)return;
    const saved=load(KEY+'.ui',{}),pref={open:saved.open!==false,level:['info','detail','debug'].includes(saved.level)?saved.level:'detail'};
    const persist=()=>store(KEY+'.ui',pref);
    const entry=el('div');entry.id='amp-lite-panel';entry.setAttribute('data-entry','');document.body.append(entry);
    const host=el('aside');host.id='amp-lite-dock';host.setAttribute('data-dock','');host.setAttribute('aria-label','模型信息');document.body.append(host);host.style.setProperty('--amp-width',prefs.width+'px');
    const gripHost=el('div');gripHost.id='amp-lite-grip';gripHost.setAttribute('data-grip','');document.body.append(gripHost);
    const foldHost=el('div');foldHost.id='amp-lite-fold';foldHost.setAttribute('data-fold','');foldHost.hidden=true;document.body.append(foldHost);
    const entryRoot=entry.attachShadow({mode:'open'}),root=host.attachShadow({mode:'open'}),gripRoot=gripHost.attachShadow({mode:'open'}),foldRoot=foldHost.attachShadow({mode:'open'});let sheet;
    try{sheet=new CSSStyleSheet();sheet.replaceSync(css);entryRoot.adoptedStyleSheets=[sheet];root.adoptedStyleSheets=[sheet];gripRoot.adoptedStyleSheets=[sheet];foldRoot.adoptedStyleSheets=[sheet];}catch{el('style','',css,entryRoot);el('style','',css,root);el('style','',css,gripRoot);el('style','',css,foldRoot);}
    // 右侧“模型信息”的收起 / 展开把手：展开时贴在侧栏左边缘（›），收起后贴在屏幕右边缘（‹ 模型信息）
    const fold=button(foldRoot,'','收起模型信息',()=>{pref.open=!pref.open;persist();render();},'fold');icon('chevron',fold);el('span','fold-label','模型信息',fold);const foldAt={on:false};
    function placeFold(){const on=foldAt.on;foldHost.hidden=!on;if(!on)return;const open=!!pref.open&&!host.hidden;fold.toggleAttribute('data-open',open);const t=open?'收起模型信息':'展开模型信息';if(fold.title!==t){fold.title=t;fold.setAttribute('aria-label',t);}fold.setAttribute('aria-expanded',String(open));
      const mr=document.querySelector('main')?.getBoundingClientRect();if(!mr)return;const w=22,h=fold.offsetHeight||44,vw=document.documentElement.clientWidth||innerWidth;let x=vw-w;if(open){const r=host.getBoundingClientRect();if(r.width>0)x=r.left-w;}
      fold.style.left=Math.round(x)+'px';fold.style.top=Math.round(mr.top+Math.max(8,(mr.height-h)/2))+'px';}
    try{new ResizeObserver(()=>placeFold()).observe(host);}catch{}
    const marks=new Map(),aliasCSS='[data-amp-local-title]{position:relative!important;color:transparent!important;display:block!important;flex:1 1 0%!important;min-width:0!important}[data-amp-local-title]>*{visibility:hidden!important}[data-amp-local-title]::after{content:attr(data-amp-short) / "";position:absolute;inset:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:hsl(var(--text-primary,24 6% 17%));pointer-events:none}[data-user-message-action][data-amp-sent]{display:flex!important;align-items:center;justify-content:flex-end;width:auto!important}[data-user-message-action][data-amp-sent]::before,[data-user-message-body-row][data-amp-sent]::after{content:attr(data-amp-sent);font-size:11px;line-height:1;font-family:inherit;font-variant-numeric:tabular-nums;color:hsl(var(--text-secondary,35 6% 45%));white-space:nowrap;pointer-events:none;opacity:.8}[data-user-message-action][data-amp-sent]::before{margin-right:6px}[data-user-message-body-row][data-amp-sent]::after{margin-top:2px}';
    let aliasSheet,aliasStyle;try{aliasSheet=new CSSStyleSheet();aliasSheet.replaceSync(aliasCSS);document.adoptedStyleSheets=[...document.adoptedStyleSheets,aliasSheet];}catch{aliasStyle=el('style','',aliasCSS,document.head||document.body);}
    let tab='overview',historyView=null,turnKey=null,selected=null,moreOpen=false,boundPath=location.pathname,compact=false,expanded=false,bodyStamp=[],pickerStamp='',turnStamp='',toastTimer=0,logItems=[],logKey='',logSerial=0,cacheLimit=50,openSid=null,confirmLogClear=false,lastLayout='',lastCooling=false,seenRevision=0,rawFilter='all',rawSpan=null,rawSerial=0,usageInfo=null,usageAt=0,confirmRawClear=false,settingsSerial=0,sentMarks=new Map(),sentPending=new Set(),sentStamp='';
    // 右上角按钮：切换深色 / 浅色模式（模型信息改由底部余额栏 / 信息栏打开）。
    const pageDark=()=>{const d=document.documentElement;return d.classList.contains('dark')||d.dataset.theme==='dark'||(!d.classList.contains('light')&&getComputedStyle(d).colorScheme==='dark');};
    function flipTheme(){const next=pageDark()?'light':'dark',d=document.documentElement;
      try{localStorage.setItem('theme',next);}catch{}
      d.classList.remove('dark','light');d.classList.add(next);if(d.dataset.theme)d.dataset.theme=next;d.style.colorScheme=next;
      try{window.dispatchEvent(new StorageEvent('storage',{key:'theme',newValue:next}));}catch{}paintTheme();}
    const trigger=button(entryRoot,'','切换深色 / 浅色模式',flipTheme,'trigger theme-toggle');const sunIcon=icon('sun',trigger),moonIcon=icon('moon',trigger);const triggerLabel=el('span','trigger-label','',trigger),mini=el('span','trigger-mini','',trigger);triggerLabel.hidden=true;mini.hidden=true;
    function paintTheme(){const dk=pageDark();sunIcon.style.display=dk?'':'none';moonIcon.style.display=dk?'none':'';trigger.title=dk?'切换到浅色模式':'切换到深色模式';trigger.setAttribute('aria-label',trigger.title);}
    paintTheme();new MutationObserver(paintTheme).observe(document.documentElement,{attributes:true,attributeFilter:['class','data-theme','style']});
    const panel=el('section','panel',null,root),resizer=el('div','resizer',null,panel);resizer.title='拖动调整宽度，双击恢复';
    dragger(resizer,{start:e=>({x:e.clientX,width:host.getBoundingClientRect().width}),move:(e,s)=>{const w=clamp(s.width+(s.x-e.clientX),280,Math.max(280,Math.min(720,innerWidth-480)),prefs.width);host.style.setProperty('--amp-width',w+'px');prefs.width=w;},end:()=>{savePrefs();paint();},reset:()=>{prefs.width=340;host.style.setProperty('--amp-width','340px');savePrefs();paint();}});
    const grip=el('div','grip',null,gripRoot);grip.hidden=true;grip.title='拖动调整 Arena 会话栏宽度，双击恢复';
    dragger(grip,{start:e=>{const sb=findSidebar();if(!sb?.panel)return null;return {x:e.clientX,width:sidebarWidth(sb)};},move:(e,s)=>{const w=clamp(s.width+(e.clientX-s.x),200,Math.max(200,Math.min(560,innerWidth-640)),s.width);prefs.sidebarWidth=w;applySidebar(w);placeGrip();},end:()=>{savePrefs();log('debug','侧栏','Arena 会话栏宽度 '+prefs.sidebarWidth+'px');paint();},reset:()=>{prefs.sidebarWidth=null;applySidebar(null);savePrefs();placeGrip();},tap:e=>forwardTap(grip,e)});
    function placeGrip(){const sb=innerWidth>=768?applySidebar(prefs.sidebarWidth):null,panelEl=sb?.panel;if(!panelEl||sb.peer&&sb.peer.dataset.state&&sb.peer.dataset.state!=='expanded'){grip.hidden=true;return;}const rect=panelEl.getBoundingClientRect();if(rect.width<120||rect.height<100){grip.hidden=true;return;}grip.hidden=false;grip.style.left=(rect.right-3)+'px';grip.style.top=rect.top+'px';grip.style.height=rect.height+'px';}
    const compactBar=el('div','compact-bar',null,panel),compactTop=el('div','compact-top',null,compactBar),compactName=el('span','compact-name mono','模型信息',compactTop);
    const compactToggle=button(compactTop,'详情','展开或收起详情',()=>{expanded=!expanded;render();},'compact-toggle');const compactInfo=el('div','compact-info','',compactBar);
    const head=el('header','head',null,panel),heading=el('div','grow',null,head);el('h2','','模型信息',heading);const numberLabel=el('span','local-number mono','',heading);numberLabel.title='本地会话编号（同一浏览器内统一递增）';
    {const hb=button(head,'','收起模型信息（收起后点屏幕右边缘的小按钮展开）',()=>{pref.open=false;persist();render();},'head-fold');el('span','','收起',hb);icon('chevron',hb);}
    const banner=el('div','cache-banner',null,panel),bannerText=el('span','grow','',banner);button(banner,'返回当前','返回当前会话的最新记录',()=>{historyView=null;turnKey=null;selected=null;rawSpan=null;tab=tab==='cache'?'overview':tab;render();},'return-live');
    const nav=el('div','tabs',null,panel);nav.setAttribute('role','tablist');nav.setAttribute('aria-label','模型信息视图');
    const tabs=[['overview','概览'],['detector','独立检测'],['hunt','抽卡'],['sources','来源'],['raw','原始'],['cache','缓存'],['logs','日志'],['settings','设置']];
    const tabButtons=tabs.map(([id,text])=>{const b=button(nav,text,text,()=>{tab=id;render();},'tab');b.setAttribute('role','tab');b.id='amp-tab-'+id;return b;});
    nav.onkeydown=e=>{let i=tabs.findIndex(x=>x[0]===tab);if(e.key==='ArrowRight')i=(i+1)%tabs.length;else if(e.key==='ArrowLeft')i=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')i=0;else if(e.key==='End')i=tabs.length-1;else return;e.preventDefault();tab=tabs[i][0];render();tabButtons[i].focus();};
    const status=el('div','status',null,panel);status.setAttribute('aria-live','polite');
    const pickers=el('div','pickers',null,panel);
    const turnPicker=el('label','call-picker',null,pickers);el('span','','轮次',turnPicker);const turnSelect=el('select','selector',null,turnPicker);turnSelect.setAttribute('aria-label','选择轮次');turnSelect.onchange=()=>{const live=liveKey();turnKey=turnSelect.value===live?null:turnSelect.value;selected=null;rawSpan=null;render();};
    const picker=el('label','call-picker',null,pickers);el('span','','调用',picker);const select=el('select','selector',null,picker);select.setAttribute('aria-label','选择调用');select.onchange=()=>{selected=select.value;rawSpan=null;render();};
    const logBar=el('div','logbar',null,panel),controls=el('div','log-controls',null,logBar);el('h3','','日志详细程度',controls);const level=el('select','selector',null,controls);level.setAttribute('aria-label','日志详细程度');for(const [id,text]of [['info','普通'],['detail','详细'],['debug','调试']]){const o=el('option','',text,level);o.value=id;}level.value=pref.level;level.onchange=()=>{pref.level=level.value;persist();bodyStamp=[];render();};
    const actions=el('div','log-actions',null,logBar),read=button(actions,'重读记录','重新读取当前运行记录',refresh);const clearLogs=button(actions,'清理日志','清理全部本地日志（不影响编号与缓存）',async()=>{if(!confirmLogClear){confirmLogClear=true;render();return;}await catalog.clearLogs();confirmLogClear=false;logKey='';bodyStamp=[];render();}),cancelClear=button(actions,'取消','取消清理日志',()=>{confirmLogClear=false;render();});
    const body=el('div','body',null,panel);body.setAttribute('role','tabpanel');
    const toast=el('div','toast','',panel);toast.hidden=true;toast.setAttribute('role','status');
    const footer=el('footer','footer',null,panel),exportButton=button(footer,'','导出当前视图的记录、原始数据和日志',async()=>{if(tab==='hunt'){download(gacha.state()||{},'arena-gacha-'+Date.now()+'.json');return;}if(tab==='detector'){download(legacyDisplay.snapshot(),'arena-independent-detector-'+Date.now()+'.json');return;}const data=exported();data.logs=await catalog.readLogs(data.sid);download(data,'amp-lite-'+(data.sid||'export').slice(0,8)+'-'+Date.now()+'.json');});icon('download',exportButton);el('span','','导出记录',exportButton);(()=>{const cmp=(x,y)=>{const p=String(x).split('.').map(Number),q=String(y).split('.').map(Number);for(let i=0;i<Math.max(p.length,q.length);i++){const d=(p[i]||0)-(q[i]||0);if(d)return d>0?1:-1;}return 0;};const box=el('div','upds',null,footer);const BASE='https://raw.githubusercontent.com/755287249/-/main/';const mk=(label,file,getCur)=>{const RAW=BASE+file,CK='amp.native.upd.'+file;let latest=null,busy=false,fresh=null;const ub=el('button','footer-note upd','',box);ub.type='button';const paint=(msg)=>{const cur=getCur();ub.dataset.new=cur&&latest&&cmp(latest,cur)>0?'1':'';ub.dataset.miss=cur?'':'1';ub.title=(cur?label+' 当前 v'+cur:label+' 未检测到（未安装或未启用）')+(latest?'，GitHub 最新 v'+latest+(ub.dataset.src?'（'+ub.dataset.src+'）':''):'')+'。点击'+(ub.dataset.new||!cur?'打开安装页':'重新检查');const old=!cur&&file.includes('Switch')&&!!document.querySelector('[data-amp-switch],[data-amp-login],[data-amp-switcher],#amp-switcher-css');const ahead=cur&&latest&&cmp(cur,latest)>0;ub.textContent=label+' '+(msg||(!cur?(old?'旧版（≤1.0.17）· 安装 v'+(latest||'新版'):latest?'未检测到 · 安装 v'+latest:'未检测到 · 安装'):ub.dataset.new?'v'+cur+' → v'+latest+' · 更新':ahead?'v'+cur+' · GitHub 仍是 v'+latest:latest?'v'+cur+' · 已是最新':'v'+cur+' · 检查更新'));if(!cur&&!msg)ub.title=label+' 未检测到版本号：可能是 v1.0.17 及更早的版本（不会上报版本），或未安装/未启用。安装最新版后即可显示。'+(latest?'GitHub 最新 v'+latest+'。':'');if(ahead&&!msg)ub.title=label+' 本地 v'+cur+' 比 GitHub 上的 v'+latest+' 新，请把新版上传到 GitHub。';};const check=async(force)=>{if(busy)return;try{const c=JSON.parse(localStorage.getItem(CK)||'null');if(!force&&c&&Date.now()-c.at<5*60e3&&!(getCur()&&cmp(getCur(),c.v)>0)){latest=c.v;paint();return;}}catch{}busy=true;paint('检查中…');try{const F=window.__ampNativeFetch||fetch,vOf=t=>(String(t).match(/\/\/\s*@version\s+([\d.]+)/)||[])[1]||null,errs=[];let best=null,src='';const take=(v,from)=>{if(v&&(!best||cmp(v,best)>0)){best=v;src=from;}};
          // 1) GitHub API 查这个文件最新提交的 sha，再按 sha 取原文（路径唯一，不会被 CDN/镜像缓存）；2) 兜底直接取 main
          try{const c=await F.call(window,'https://api.github.com/repos/755287249/-/commits?sha=main&per_page=1&path='+encodeURIComponent((/\/test\/$/.test(BASE)?'test/':'')+file),{cache:'no-store',credentials:'omit'});if(!c.ok)throw new Error('API HTTP '+c.status);const sha=(await c.json())?.[0]?.sha;if(!sha)throw new Error('API 无提交');const r=await F.call(window,BASE.replace('/main/','/'+sha+'/')+file,{cache:'no-store',credentials:'omit',headers:{Range:'bytes=0-4095'}});if(!r.ok)throw new Error('sha HTTP '+r.status);take(vOf(await r.text()),'commit '+sha.slice(0,7));fresh=BASE.replace('/main/','/'+sha+'/')+file;}catch(e){errs.push(e.message||String(e));}
          try{const r=await F.call(window,RAW+'?t='+Date.now(),{cache:'no-store',credentials:'omit',headers:{Range:'bytes=0-4095'}});if(!r.ok)throw new Error('raw HTTP '+r.status);take(vOf(await r.text()),'raw');}catch(e){errs.push(e.message||String(e));}
          if(!best)throw new Error(errs.join('；')||'未找到版本号');latest=best;ub.dataset.src=src;try{localStorage.setItem(CK,JSON.stringify({v:latest,at:Date.now()}));}catch{}busy=false;paint();const cu=getCur();if(cu&&cmp(cu,latest)>0&&(check.n=(check.n||0)+1)<=8)setTimeout(()=>void check(true),120e3);}catch(e){busy=false;paint('检查失败 · 重试');ub.title=String(e&&e.message||e);}};ub.onclick=()=>{if(busy)return;const cur=getCur();if(!cur||latest&&cmp(latest,cur)>0){window.open(fresh||RAW,'_blank');paint('请在新标签页确认安装');try{localStorage.removeItem(CK);}catch{}return;}void check(true);};paint();setTimeout(()=>void check(false),1500);return paint;};mk('套件','Arena-Native-Suite.user.js',()=>String(VERSION).replace(/^native-/,''));const sw=mk('账号切换','Arena-Account-Switch.user.js',()=>document.documentElement.dataset.ampSwitchVer||'');      // 测试版入口：正式版里输入密码后显示测试版的安装 / 更新；测试版里显示“正式版入口”（切回正式版，无需密码）。
      // 地址都由 BASE 推出来，发布时替换链接不会影响这里。脚本里只存密码的 SHA-256，不存明文。
      const IS_TEST=/\/test\/$/.test(BASE),CH_BASE=IS_TEST?BASE.replace(/test\/$/,''):BASE+'test/',CH_NAME=IS_TEST?'正式版':'测试版',CH_KEY='amp.native.chan.unlock',CH_HASH='a17502877cfc09fdcfd1c868acc7fb61e1842bb02fd89ffca9451a507f9caa7c';
      const chPaints=[];let chLines=[],chForm=null;
      const chVer=t=>(String(t).match(/\/\/\s*@version\s+([\d.]+)/)||[])[1]||null;
      const chLatest=async file=>{const F=window.__ampNativeFetch||fetch,path=(IS_TEST?'':'test/')+file,errs=[];let best=null,fresh=null;
        try{const c=await F.call(window,'https://api.github.com/repos/755287249/-/commits?sha=main&per_page=1&path='+encodeURIComponent(path),{cache:'no-store',credentials:'omit'});if(!c.ok)throw new Error('API HTTP '+c.status);const sha=(await c.json())?.[0]?.sha;if(!sha)throw new Error('API 无提交');const u=CH_BASE.replace('/main/','/'+sha+'/')+file,r=await F.call(window,u,{cache:'no-store',credentials:'omit',headers:{Range:'bytes=0-4095'}});if(!r.ok)throw new Error('sha HTTP '+r.status);const v=chVer(await r.text());if(v){best=v;fresh=u;}}catch(e){errs.push(e.message||String(e));}
        try{const r=await F.call(window,CH_BASE+file+'?t='+Date.now(),{cache:'no-store',credentials:'omit',headers:{Range:'bytes=0-4095'}});if(!r.ok)throw new Error('raw HTTP '+r.status);const v=chVer(await r.text());if(v&&(!best||cmp(v,best)>0)){best=v;fresh=null;}}catch(e){errs.push(e.message||String(e));}
        if(!best)throw new Error(errs.join('；')||'未找到版本号');return {v:best,fresh};};
      const chLine=(label,file,getCur)=>{let latest=null,fresh=null,busy=false;const b=el('button','footer-note upd',null,box);b.type='button';
        const paint=msg=>{const cur=getCur(),newer=!!latest&&(!cur||cmp(latest,cur)>0),same=!!latest&&!!cur&&cmp(latest,cur)===0;b.dataset.new=newer&&!msg?'1':'';b.textContent=CH_NAME+' '+label+' '+(msg||(latest?'v'+latest+' · '+(newer?'安装':same?'版本相同':'安装（较旧）'):'检查中…'));if(!msg&&latest)b.title=CH_NAME+' '+label+' v'+latest+(cur?'（当前 v'+cur+'）':'')+'。点击打开安装页'+(same?'；版本号相同，安装后会改为跟随'+CH_NAME+'自动更新':'');};
        const check=async()=>{if(busy)return;busy=true;paint('检查中…');try{const r=await chLatest(file);latest=r.v;fresh=r.fresh;busy=false;paint();}catch(e){busy=false;paint('检查失败 · 重试');b.title=String(e&&e.message||e);}};
        b.onclick=()=>{if(busy)return;if(!latest){void check();return;}window.open(fresh||CH_BASE+file,'_blank');paint('请在新标签页确认安装');setTimeout(()=>{if(!busy)paint();},8000);};
        chPaints.push(()=>{if(!busy)paint();});void check();return b;};
      const chEntry=el('button','footer-note upd chentry','',box);chEntry.type='button';
      const chHide=relock=>{for(const b of chLines)b.remove();chLines=[];chPaints.length=0;chForm?.remove();chForm=null;if(relock){try{localStorage.removeItem(CH_KEY);}catch{}}chEntry.textContent=CH_NAME+'入口';chEntry.title=IS_TEST?'显示正式版的安装入口（用于切回正式版）':'输入密码后可安装 / 更新测试版';};
      const chShow=()=>{chHide(false);chLines=[chLine('套件','Arena-Native-Suite.user.js',()=>String(VERSION).replace(/^native-/,'')),chLine('账号切换','Arena-Account-Switch.user.js',()=>document.documentElement.dataset.ampSwitchVer||'')];box.append(chEntry);chEntry.textContent='收起'+CH_NAME;chEntry.title=IS_TEST?'隐藏正式版入口':'隐藏测试版入口（再次打开需要输入密码）';};
      const chAsk=()=>{if(chForm){chForm.remove();chForm=null;return;}chForm=el('div','chform',null,box);const inp=el('input','',null,chForm);inp.type='password';inp.placeholder='测试版密码';inp.autocomplete='off';inp.spellcheck=false;
        const submit=async()=>{const v=inp.value;if(!v){inp.focus();return;}let h='';try{const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));h=[...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');}catch{}if(h===CH_HASH){try{localStorage.setItem(CH_KEY,'1');}catch{}chShow();}else{inp.value='';inp.placeholder=h?'密码不对':'浏览器不支持验证';inp.removeAttribute('data-bad');void inp.offsetWidth;inp.setAttribute('data-bad','');inp.focus();}};
        button(chForm,'确定','验证密码',()=>void submit());
        for(const t of ['keydown','keyup','keypress','input'])inp.addEventListener(t,e=>{e.stopPropagation();if(t!=='keydown')return;if(e.key==='Enter'){e.preventDefault();void submit();}else if(e.key==='Escape'){e.preventDefault();chForm?.remove();chForm=null;}});
        setTimeout(()=>inp.focus(),0);};
      chEntry.onclick=()=>{if(chLines.length){chHide(!IS_TEST);return;}let ok=IS_TEST;try{ok=ok||localStorage.getItem(CH_KEY)==='1';}catch{}if(ok)chShow();else chAsk();};
      chHide(false);try{if(!IS_TEST&&localStorage.getItem(CH_KEY)==='1')chShow();}catch{}
      try{const mo=new MutationObserver(()=>{sw();chPaints.forEach(f=>f());});mo.observe(document.documentElement,{attributes:true,attributeFilter:['data-amp-switch-ver']});}catch{}})();
    const fmt=v=>v===null||v===undefined?'—':Number(v).toLocaleString('zh-CN');
    const clock=v=>{const t=typeof v==='number'?v:Date.parse(v||'');return Number.isFinite(t)?new Date(t).toLocaleTimeString('zh-CN',{hour12:false}):'--:--:--';};
    const seqLabel=sid=>{const e=catalog.entries.get(sid);return e?(e.temporary?'临时 ':'')+'#'+e.seq:'';};
    const say=text=>{toast.textContent=text;toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true;},2000);};
    const liveView=sid=>selectedRun()?.data||catalog.snapshots.get(sid)||history.find(s=>s.sid===sid)||null;
    const liveKey=()=>liveView(sidOf(location.href))?.key||null;
    const view=()=>{if(historyView)return historyView;const sid=sidOf(location.href);if(turnKey){const r=selectedRun();if(r?.data?.key===turnKey)return r.data;const t=catalog.turnCache.get(turnKey);if(t)return t;void catalog.getTurn(turnKey).then(()=>paint());return null;}return liveView(sid);};
    const turnTitle=(t,current)=>turnLabel(t)+' · '+clock(t.startedAt||t.at)+(t.prompt?' · “'+t.prompt+'”':'')+(current?' · 当前':'');
    function row(parent,key,value,mono=true){const r=el('div','row',null,parent);el('span','key',key,r);el('span','value'+(mono?' mono':''),value??'未提供',r);return r;}
    function empty(title,description){const box=el('div','empty',null,body);icon('cube',el('div','empty-icon',null,box));el('strong','',title,box);el('p','',description,box);}
    async function copy(text,what='型号'){try{await navigator.clipboard.writeText(String(text));say('已复制'+what);}catch{say('复制不可用，请手动选中复制');}}
    function restoreMark(a,m){m.span.removeAttribute('data-amp-local-title');m.span.removeAttribute('data-amp-short');if(m.tip!==undefined){if(m.tip===null)a.removeAttribute('title');else a.setAttribute('title',m.tip);}if(m.description===null)a.removeAttribute('aria-description');else a.setAttribute('aria-description',m.description);}
    // 自定义/代号型号（如 dxzui）本身看不出厂商：若响应型号/内部名已识别出厂商，就显示成 dxzui-Claude。
    // 显示完整识别型号：dxzui + claude-opus-5-5 → dxzui-claude-opus-5-5（内部名优先，其次响应型号）。
    function modelOf(sid,record){if(record?.vmodel)return record.vmodel;const snap=catalog.snapshots.get(sid)||(sid===sidOf(location.href)?liveView(sid):null);if(!snap)return '';const c=[...(snap.calls||[])].reverse().find(c=>brand.of(c.internal)||brand.of(c.response));return c?(brand.of(c.internal)?c.internal:c.response):((snap.internalNames||[]).find(n=>brand.of(n))||'');}
    function withVendor(sid,record,name){name=String(name||'');if(!name||brand.of(name))return name;
      // dxzui / clzui 请求名：不再有特殊地位，只作为短前缀 dx- / cl- 加上识别到的模型（去厂商名）：dx-opus-5.5
      const zp=name.match(/^(dx|cl)zui\b/i);if(zp){const m=modelOf(sid,record);if(m&&brand.of(m))return zp[1].toLowerCase()+'-'+brand.short(m).replace(/(^|-)(\d{1,2})-(\d{1,2})(?=$|-)/,'$1$2.$3');return zp[1].toLowerCase()+'zui';}const m=modelOf(sid,record);if(m&&brand.of(m)&&!name.includes(m))return name+'-'+m;const v=record?.vendor;return v&&brand.NAME[v]?name+'-'+brand.NAME[v].toLowerCase():name;}
    // 左侧卡片已有厂商图标：文字去掉厂商/系列前缀（gpt-6-luna-max → 6-luna-max，kimi-k3 → K3），悬停显示全称
    function shortModel(n){n=String(n||'');if(!brand.of(n))return n;const m=n.match(/^(?:[\w.-]+\/)?(?:gpt|chatgpt|claude|gemini|grok|kimi|qwen|deepseek|mimo|glm|llama|mistral|doubao|minimax)[-_ ]+(.+)$/i);let r=m?m[1]:(n.match(/^[\w.-]+\/(.+)$/)||[])[1];if(!r||!/[\w]/.test(r))return n;if(/^k\d/.test(r))r='K'+r.slice(1);return r;}
    let titleSyncRaf=0;window.addEventListener('amp-title-sync',()=>{if(titleSyncRaf)return;titleSyncRaf=requestAnimationFrame(()=>{titleSyncRaf=0;try{localTitles();}catch{}try{headerTitle();}catch{}try{window.dispatchEvent(new CustomEvent('amp-native-gacha'));}catch{}});});
    const ltMemo=new WeakMap();
    function localTitles(){
      if(!catalog.persistent||document.readyState!=='complete')return;
      for(const [a,m]of marks){if(!a.isConnected||!m.span.isConnected||a.querySelector('input,textarea,[contenteditable="true"]')){restoreMark(a,m);marks.delete(a);ltMemo.delete(a);}}
      let count=0;
      for(const a of document.querySelectorAll('a[href*="/agent/"]')){
        if(!a.closest('aside,nav,[data-sidebar]')||a.querySelector('input,textarea,[contenteditable="true"]'))continue;
        const hm=/^(?:https:\/\/arena\.ai)?\/agent\/([\w-]{1,128})\/?(?:[?#].*)?$/.exec(a.getAttribute('href')||'');if(!hm)continue;
        const sid=hm[1],own=gacha.ownsTitle(sid),record=own?null:catalog.entries.get(sid);if(record?.temporary){const old=marks.get(a);if(old){restoreMark(a,old);marks.delete(a);}continue;}
        const pr0=a.querySelector('span.truncate,div.truncate'),memoKey=(pr0?pr0.textContent:'')+'|'+(record?.title||'')+'|'+(record?.name?.name||'')+'|'+(own?gacha.pendingTitle(sid)||'':'')+'|'+prefs.showSeq+'|'+vip.rev+'|'+brand.hint.rev(),mm=ltMemo.get(a);
        if(pr0&&mm&&mm.key===memoKey&&mm.pr===pr0&&pr0.isConnected)continue;ltMemo.set(a,{key:memoKey,pr:pr0});
        const primary=a.querySelector('span.truncate,div.truncate'),candidates=[...a.querySelectorAll('span')].filter(s=>!s.querySelector('svg,input,button,span,div')&&!s.classList.contains('sr-only')&&s.textContent.trim());const span=primary&&!primary.querySelector('svg,input,button')?primary:candidates.sort((a,b)=>b.textContent.length-a.textContent.length)[0];if(!span||!span.textContent.trim())continue;
        // 默认不显示本地编号 #N（与原标题/进度条挤在一起不好读）；设置里可打开。
        const shownTitle=own&&gacha.pendingTitle(sid)?gacha.pendingTitle(sid):record?.title?withVendor(sid,record,prefs.showSeq?record.title:(record.name?.name||String(record.title).replace(/^#\d+\s*/,''))||record.title):span.textContent.trim();
        const short=shortModel(noVertex(shownTitle));
        if(!record?.title&&short===shownTitle&&shownTitle===span.textContent.trim()){const old=marks.get(a);if(old){restoreMark(a,old);marks.delete(a);}continue;}
        const old=marks.get(a);if(old&&old.span!==span){restoreMark(a,old);marks.delete(a);}if(!marks.has(a))marks.set(a,{span,description:a.getAttribute('aria-description'),tip:a.getAttribute('title')});
        if(span.getAttribute('data-amp-local-title')===shownTitle&&span.getAttribute('data-amp-short')===short)continue;
        span.setAttribute('data-amp-local-title',shownTitle);span.setAttribute('data-amp-short',short);a.setAttribute('aria-description','本地显示 '+shownTitle);
        if(short!==shownTitle)a.setAttribute('title',shownTitle);else{const m=marks.get(a);if(m.tip===null)a.removeAttribute('title');else a.setAttribute('title',m.tip);}count++;
      }
      if(count)log('debug','本地标题','更新 '+count+' 个会话标题的本地显示');
    }
    // 顶部对话名：左侧加厂商 logo；下方小字显示显式档位与 Token；颜色随识别进度 浅色→赭石褐（深色模式 灰→白），识别完成变绿并加粗。
    try{CSS.registerProperty({name:'--amp-hp',syntax:'<percentage>',inherits:false,initialValue:'0%'});}catch{}
    const hdrCSS='[data-amp-horig]{display:none!important}[data-amp-htitle]{max-width:min(52vw,420px)!important;--amp-h-from:#cfc8bd;--amp-h-to:#6a5e54;background-image:linear-gradient(90deg,var(--amp-h-to) 0,var(--amp-h-to) var(--amp-hp,0%),var(--amp-h-from) var(--amp-hp,0%),var(--amp-h-from) 100%);-webkit-background-clip:text;background-clip:text;color:transparent!important;-webkit-text-fill-color:transparent;transition:--amp-hp .6s cubic-bezier(.22,.9,.3,1),font-weight .2s ease;display:inline-block!important;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;line-height:1.2!important;vertical-align:middle}'
      +'[data-amp-htitle] *{color:inherit!important;-webkit-text-fill-color:transparent}'
      +'[data-amp-htitle][data-amp-hdark]{--amp-h-from:#6f7680;--amp-h-to:#ffffff}[data-amp-htitle][data-amp-hdone]{font-weight:700!important}'
      +'[data-amp-htitle]::after{content:attr(data-amp-hsub);display:block;font-size:10px;line-height:1.25;font-weight:400;color:hsl(var(--text-secondary,35 6% 45%));-webkit-text-fill-color:hsl(var(--text-secondary,35 6% 45%));background:none;overflow:hidden;text-overflow:ellipsis;animation:ampWork 1.4s ease-in-out infinite}[data-amp-htitle][data-amp-hsub=""]::after{display:none}@keyframes ampWork{50%{opacity:.45}}'
      +'[data-amp-htitle][data-amp-hfresh]::after{animation:ampFresh 8s ease forwards}@keyframes ampFresh{0%,85%{opacity:1}100%{opacity:0}}'
      +'[data-amp-hlogo]{display:inline-flex!important;align-items:center;justify-content:center;flex:none;width:18px;height:18px;border-radius:50%;background:#fff;color:#111;box-shadow:0 0 0 1px #0000001a;margin-right:6px;vertical-align:middle;animation:ampHLogo .3s ease-out both}[data-amp-hlogo] svg{width:12px;height:12px;color:#111;fill:currentColor}[data-amp-hlogo][data-full]{background:transparent;box-shadow:none}[data-amp-hlogo][data-full] svg{width:18px;height:18px}'
      +'[data-amp-htier]{display:inline-flex!important;align-items:center;flex:none;height:18px;padding:0 7px;margin-left:6px;border-radius:999px;font-size:11px;font-weight:600;line-height:1;vertical-align:middle;color:#6a5e54;background:#6a5e5414;box-shadow:inset 0 0 0 1px #6a5e5433;white-space:nowrap}[data-amp-htier][hidden]{display:none!important}[data-amp-htier][data-hi]{color:#fff;background:#6a5e54;box-shadow:none}'
      +'[data-amp-htier][data-amp-hdark]{color:#d8d3ca;background:#d8d3ca14;box-shadow:inset 0 0 0 1px #d8d3ca33}[data-amp-htier][data-amp-hdark][data-hi]{color:#262522;background:#d8d3ca}[data-amp-htier][data-pop]{animation:ampHLogo .3s cubic-bezier(.3,1.6,.5,1) both}'
      +'@keyframes ampHLogo{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){[data-amp-htitle],[data-amp-hlogo]{transition:none!important;animation:none!important}}';
    el('style','',hdrCSS,document.head||document.body);
    let hdr={t:null,logo:null,name:null},hdrStart=new Map();
    const isDark=()=>{const d=document.documentElement;return d.dataset.theme==='dark'||d.classList.contains('dark')||(!d.classList.contains('light')&&getComputedStyle(d).colorScheme==='dark');};
    function clearHeader(){hdr.t?.removeAttribute('data-amp-horig');hdr.name?.remove();hdr.logo?.remove();hdr.tier?.remove();hdr={t:null,logo:null,name:null,tier:null};}
    function findHeaderTitle(sid){
      const main=document.querySelector('main');if(!main)return null;const mr=main.getBoundingClientRect();
      // 消息列表在可滚动容器里；顶部栏不在。任何位于滚动容器内的元素都不是标题（以前会误选到顶部的用户气泡“回复我1”）。
      const inScroller=n=>{for(let p=n.parentElement;p&&p!==main;p=p.parentElement){const cs=getComputedStyle(p);if(/(auto|scroll)/.test(cs.overflowY)&&p.scrollHeight>p.clientHeight+4)return true;}return false;};
      const top=b=>{if(b.closest('form,[role="log"],[data-amp-native-gacha],article,[data-message-id],[data-testid*="message"]'))return false;const r=b.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<mr.top+64&&r.bottom>mr.top-4&&(b.textContent||'').trim().length>0&&!/workspace|工作区|sidebar|侧边栏/i.test(b.getAttribute('aria-label')||'');};
      const hp=[...main.querySelectorAll('button[aria-haspopup]')].filter(b=>top(b)&&b.getBoundingClientRect().left<mr.left+mr.width*.6);
      let cands=hp.filter(b=>!inScroller(b));if(!cands.length)cands=hp;
      if(!cands.length)cands=[...main.querySelectorAll('h1,h2')].filter(b=>top(b)&&!inScroller(b));
      if(!cands.length)return null;
      const best=cands.sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left)[0];
      const leaves=[best,...best.querySelectorAll('*')].filter(n=>!n.closest('[data-amp-hlogo],[data-amp-hname]')&&!(n instanceof SVGElement)&&[...n.childNodes].some(c=>c.nodeType===3&&c.textContent.trim()));
      return leaves.sort((a,b)=>b.textContent.length-a.textContent.length)[0]||null;
    }
    function headerTitle(){
      const sid=sidOf(location.href);if(!sid){clearHeader();return;}
      let t=hdr.t;const tb=t&&t.isConnected&&t.closest('button,h1,h2'),mr_=tb&&t.closest('main')?.getBoundingClientRect();if(!t||!t.isConnected||!t.closest('main')||!tb||!mr_||tb.getBoundingClientRect().top>mr_.top+64||tb.closest('[role="log"],article,[data-message-id]')){clearHeader();t=findHeaderTitle(sid);if(!t)return;hdr.t=t;}
      const r=selectedRun(),live=liveView(sid),c=live?.calls?.at(-1),meta=catalog.entries.get(sid);
      let p=0,done=false;
      if(r){const k=r.runId+'|'+r.revision;if(!hdrStart.has(k)){hdrStart.set(k,Date.now());if(hdrStart.size>20)hdrStart.delete(hdrStart.keys().next().value);}const el_=(Date.now()-hdrStart.get(k))/1000;
        if(r.data&&['已读取','部分记录','模型已识别 · 详情未提供'].includes(r.phase)&&r.data.revision===r.revision){p=100;done=true;}
        else if(r.data)p=Math.min(92,70+el_*2);
        else p=Math.min(60,(r.phase==='读取 Trace'?30:12)+el_*3);
      }else if(c||meta){p=100;done=true;}
      // 顶部名称与左侧卡片保持一致：取左侧当前对话显示的名字（本地识别名优先），而不是 Arena 自己生成的标题（如“回复1”）。
      const link=document.querySelector('a[href="/agent/'+sid+'"]'),lt=link?.querySelector('[data-amp-local-title]');
      const shownName=noVertex(lt?.getAttribute('data-amp-local-title')||withVendor(sid,meta,prefs.showSeq?meta?.title:meta?.name?.name)||(link&&link.textContent.trim())||t.textContent||'').trim();
      let nm=hdr.name;
      if(!nm||!nm.isConnected||t.nextElementSibling!==nm){nm?.remove();nm=document.createElement('span');nm.setAttribute('data-amp-hname','');nm.setAttribute('data-amp-htitle','');t.after(nm);hdr.name=nm;}
      t.setAttribute('data-amp-horig','');
      // 三段式：logo（厂商） · 名称（不带厂商前缀，与左侧卡片一致） · 档位小标签；识别过程中依次出现
      const rc0=r?.data?.calls?.at(-1),known=!!brand.of(shownName),TSPLIT=/^(.*?)[-\s·]+(none|minimal|low|medium|high|xhigh|max)$/i;
      const split=n=>{const x=brand.of(n)?brand.short(n):n,m=x.match(TSPLIT);return m&&brand.of(n)?[m[1],m[2].toLowerCase()]:[x,''];};
      let [fam,tierTxt]=split(shownName);
      if(!known&&r){const exact=rc0?.internal||rc0?.response,fin=(rc0?.internal||meta?.name?.name||'').replace(/^未提供$/,'');
        if(done&&fin)[fam,tierTxt]=split(withVendor(sid,meta,fin));else if(exact){fam=split(exact)[0];tierTxt='';}else{fam='识别中…';tierTxt='';}}
      if(tierTxt==='none')tierTxt='';
      if(nm.textContent!==fam)nm.textContent=fam;nm.title=shownName;
      let tg=hdr.tier;if(!tg||!tg.isConnected||nm.nextElementSibling!==tg){tg?.remove();tg=document.createElement('span');tg.setAttribute('data-amp-htier','');nm.after(tg);hdr.tier=tg;}
      if(tg.textContent!==tierTxt){tg.textContent=tierTxt;tg.removeAttribute('data-pop');void tg.offsetWidth;if(tierTxt)tg.setAttribute('data-pop','');}
      tg.hidden=!tierTxt;tg.toggleAttribute('data-hi',/^(max|xhigh|high)$/.test(tierTxt));tg.toggleAttribute('data-amp-hdark',isDark());
      nm.style.setProperty('--amp-hp',Math.round(p)+'%');nm.toggleAttribute('data-amp-hdone',done);nm.toggleAttribute('data-amp-hdark',isDark());
      // 副标题：识别中… → 识别：Claude → 识别：claude-opus-5 → 识别模型为 claude-opus-5-5（8 秒后淡出）
      const generating=!!document.querySelector('button[aria-label="Stop generating"],button[aria-label="Stop response"],button[aria-label="停止生成"]');
      const VN={openai:'GPT',anthropic:'Claude',google:'Gemini',xai:'Grok',moonshot:'Kimi',deepseek:'DeepSeek',qwen:'Qwen',zhipu:'GLM',xiaomi:'MiMo',bytedance:'豆包',minimax:'MiniMax',mistral:'Mistral',meta:'Llama'};
      const rc=r?.data?.calls?.at(-1),partial=rc?.internal||rc?.response||rc?.request||(rc?.model&&rc.model!=='未提供'?rc.model:'');
      const finalName=(rc?.internal||meta?.name?.name||c?.internal||c?.model||'').replace(/^未提供$/,'');
      let sub='',fresh=false;
      if(r&&!done){const exact=rc?.internal||rc?.response,bv=brand.of(partial);sub=exact?'识别：'+brand.short(exact):bv?'识别中 · 已确定厂商':partial?'识别：'+noVertex(partial):'识别中…';}
      else if(r&&done){const key=r.runId+'|'+r.revision+'|done';if(!hdrStart.has(key))hdrStart.set(key,Date.now());if(Date.now()-hdrStart.get(key)<8000&&finalName){sub='识别模型为 '+brand.short(withVendor(sid,meta,finalName));fresh=true;}}
      if(!sub&&generating&&!done)sub='识别中…';
      const rt=r?.data?.routing||live?.routing;if(rt&&!fresh)sub='已被改派：'+(rt.from?brand.short(rt.from):'原模型')+' → '+(rt.to?brand.short(rt.to):'其他模型');
      if(nm.getAttribute('data-amp-hsub')!==sub)nm.setAttribute('data-amp-hsub',sub);nm.toggleAttribute('data-amp-hfresh',fresh);
      const vid=brand.of(finalName)||brand.of(shownName)||brand.of(partial)||brand.forSid(sid,'');
      if(!vid){hdr.logo?.remove();hdr.logo=null;return;}
      if(!hdr.logo||!hdr.logo.isConnected||hdr.logo.nextElementSibling!==t||hdr.logo.dataset.v!==vid){hdr.logo?.remove();const lg=document.createElement('span');lg.setAttribute('data-amp-hlogo','');lg.dataset.v=vid;if(['deepseek','qwen','zhipu','xiaomi','bytedance','minimax','mistral','meta'].includes(vid))lg.setAttribute('data-full','');lg.innerHTML=gachaUi.vendorIcon(vid,12);t.before(lg);hdr.logo=lg;}
    }
    // 输入框里目标按钮左边那个纸张/文档图标按钮：默认隐藏（只隐藏图标按钮，不删节点；设置里可恢复）。
    const DOC_KEY=KEY+'.docIconLabel';
    function docIcon(){
      const shown=[...document.querySelectorAll('[data-amp-doc-hidden]')];
      if(!prefs.hideDocIcon){for(const n of shown)n.removeAttribute('data-amp-doc-hidden');return;}
      const remembered=load(DOC_KEY,'');
      for(const g of document.querySelectorAll('[data-amp-native-gacha="1"]')){
        const prev=g.previousElementSibling;
        const cand=prev&&prev.matches('button')?prev:prev?.querySelector?.(':scope>button:only-child')?prev:null;
        if(!cand||cand.hasAttribute('data-amp-doc-hidden'))continue;
        const btn=cand.matches('button')?cand:cand.querySelector('button');
        const label=(btn.getAttribute('aria-label')||btn.title||'').trim();
        const iconOnly=!(btn.innerText||'').trim()&&!!btn.querySelector('svg');
        if(!iconOnly||/send|stop|发送|停止|model|模型|attach|附件|upload|上传|mic|voice|语音/i.test(label))continue;
        if(remembered&&label&&remembered!==label)continue;
        cand.setAttribute('data-amp-doc-hidden','');if(label&&!remembered){store(DOC_KEY,label);log('debug','界面','已隐藏输入框文档图标：'+label);}
      }
    }
    el('style','','[data-amp-doc-hidden]{display:none!important}',document.head||document.body);
    function attach(){
      if(stopped||!document.body)return;const cooling=Date.now()<cooldown;if(cooling!==lastCooling){lastCooling=cooling;paint();}const main=document.querySelector('main'),ready=document.readyState==='complete';
      const anchor=ready?[...document.querySelectorAll('main button[aria-label="Toggle workspace sidebar"],main button[aria-label="Open workspace"],main button[aria-label="Close workspace"],main button[aria-label="打开工作区"],main button[aria-label="切换工作区侧边栏"]')].find(b=>{const r=b.getBoundingClientRect(),m=b.closest('main').getBoundingClientRect();return r.width>0&&r.height>0&&r.top<m.top+100;}):null;
      if(anchor){if(entry.parentNode!==anchor.parentNode||entry.nextSibling!==anchor)anchor.before(entry);entry.removeAttribute('data-floating');}else{if(entry.parentNode!==document.body)document.body.append(entry);entry.setAttribute('data-floating','');}
      const eligible=/^\/agent(?:\/|$)/.test(location.pathname);entry.hidden=!eligible;let mode='none';
      if(eligible&&ready&&main){const parent=main.parentElement,p=getComputedStyle(parent),m=getComputedStyle(main),isSibling=host.parentNode===parent&&!host.hidden,available=main.getBoundingClientRect().width+(isSibling?host.getBoundingClientRect().width+(parseFloat(p.columnGap)||0):0),wide=innerWidth>=1024&&available>=900&&p.display.includes('flex')&&p.flexDirection==='row';
        if(wide){mode='wide';if(host.parentNode!==parent||host.previousSibling!==main)main.after(host);compact=false;}
        else if(m.display.includes('flex')&&m.flexDirection==='column'){mode='compact';if(host.parentNode!==main||host!==main.lastChild)main.append(host);compact=true;}
      }
      if(mode!==lastLayout){lastLayout=mode;if(mode==='compact')expanded=false;bodyStamp=[];paint();}
      host.toggleAttribute('data-compact',compact);host.toggleAttribute('data-expanded',expanded);host.hidden=!eligible||mode==='none'||!compact&&!pref.open||compact&&!expanded;foldAt.on=eligible&&mode==='wide';placeFold();
      if(ready){placeGrip();localTitles();sentTimes();try{headerTitle();}catch{}try{docIcon();}catch{}if(!((attach.n=(attach.n||0)+1)%4))statusBar();}
    }
    function cacheTab(){
      const list=[...catalog.entries.values()].filter(x=>x.models?.length||x.title).sort((a,b)=>(b.at||'').localeCompare(a.at||''));const h=el('div','section-heading',null,body);el('h3','','本地会话缓存',h);el('span','eyebrow',list.length+' 个会话',h);
      if(!list.length){empty('暂无模型缓存','新记录会自动保存。');return;}
      const current=sidOf(location.href);
      for(const e of list.slice(0,cacheLimit)){
        const open=openSid===e.sid;
        const b=button(body,'',(open?'收起':'展开')+' #'+e.seq+' 的轮次',()=>{openSid=open?null:e.sid;if(!open)catalog.turnsOf(e.sid);render();},'history-item');b.toggleAttribute('data-open',open);
        el('span','history-name',(e.temporary?'临时 ':'')+e.title+(e.sid===current?'（当前会话）':''),b);const meta=el('span','history-meta',null,b);el('span','',e.at?new Date(e.at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'',meta);el('span','',(e.turns?e.turns+' 轮 · ':'')+(e.partial?'部分字段':'缓存'),meta);
        if(!open)continue;
        const turns=catalog.turnsOf(e.sid),box=el('div','turn-list',null,body);
        if(!turns.length){el('p','note','正在读取轮次…如无结果说明此会话只有编号记录。',box);const legacy=button(box,'查看最近快照','查看此会话最近一次快照',async()=>{const s=await catalog.getSnapshot(e.sid);if(s){historyView=s;selected=null;rawSpan=null;tab='overview';render();}else say('此会话尚无可用的配置快照');},'clear');legacy.style.marginTop='4px';continue;}
        for(const t of turns.slice().reverse()){
          const tb=button(box,'','查看 '+turnLabel(t),async()=>{const s=await catalog.getTurn(t.key);if(!s){say('此轮快照不可用');return;}historyView=s;selected=null;rawSpan=null;tab='overview';render();},'turn-item');if(historyView?.key===t.key)tb.setAttribute('data-current','');
          el('span','turn-name',turnTitle(t,false),tb);const tm=el('span','turn-meta',null,tb);el('span','',t.count+' 次调用 · '+(t.internal||t.model||'未提供'),tm);el('span','',(t.credits!==null&&t.credits!==undefined?Math.round(t.credits)+' cr · ':'')+'显式 '+(t.effort||'未知'),tm);
        }
      }
      if(list.length>cacheLimit)button(body,'显示更多','显示更多会话缓存',()=>{cacheLimit+=50;render();},'clear');
    }
    function logTab(){
      const allowed=new Set(pref.level==='debug'?['info','warn','error','detail','debug']:pref.level==='detail'?['info','warn','error','detail']:['info','warn','error']),list=logItems.filter(e=>allowed.has(e.level));
      if(!list.length){el('p','note','这个级别下暂无日志。',body);return;}
      for(const e of list.slice(-300).reverse()){const line=el('div','logline '+e.level,null,body),meta=el('div','log-meta',null,line);el('span','',e.stage+' · '+({info:'普通',detail:'详细',debug:'调试',warn:'警告',error:'错误'}[e.level]||e.level),meta);el('time','mono',new Date(e.at).toLocaleTimeString('zh-CN',{hour12:false}),meta);el('p','',e.text,line);if(e.runId||e.spanId){const d=el('details','log-origin',null,line);el('summary','','标识',d);if(e.runId)el('code','',e.runId,d);if(e.spanId)el('code','',e.spanId,d);}}
    }
    function render(){
      if(boundPath!==location.pathname){boundPath=location.pathname;historyView=null;turnKey=null;selected=null;rawSpan=null;tab='overview';bodyStamp=[];logKey='';}
      attach();const sid=sidOf(location.href),r=selectedRun();if(sid&&!catalog.snapshots.has(sid)&&!catalog.loading.has(sid))void catalog.getSnapshot(sid).then(()=>paint());
      if(r&&r.revision!==seenRevision){seenRevision=r.revision;if(!historyView){turnKey=null;selected=null;rawSpan=null;}}
      const s=view(),c=s?.calls.find(x=>x.id===selected)||s?.calls.at(-1),live=liveView(sid),liveCall=live?.calls.at(-1),meta=catalog.entries.get(sid);
      const originTag=r?.data&&r.data.revision!==r.revision?'上次':!r?.data&&live?'缓存':'';
      const shown=meta?.name?.name||liveCall?.internal||liveCall?.model||'模型信息',eff=liveCall?.effort,effortText=eff?.value||({conflict:'冲突',unsupported:'不支持'}[eff?.status])||'未知';
      triggerLabel.textContent=(prefs.showSeq&&seqLabel(sid)?seqLabel(sid)+' ':'')+shown;mini.textContent=liveCall?(originTag?originTag+' · ':'')+'推理 '+effortText:'';mini.hidden=true;
      compactName.textContent=triggerLabel.textContent;compactInfo.textContent=liveCall?(originTag?originTag+' · ':'')+'显式 '+effortText+' · 推理 Token '+(liveCall.reasoning.status==='conflict'?'冲突':fmt(liveCall.reasoning.value)):'尚无模型记录';compactToggle.textContent=expanded?'收起':'详情';numberLabel.textContent=seqLabel(s?.sid||sid);
      const historical=!!historyView||!!turnKey||!r?.data&&!!s||!!r?.data&&r.data.revision!==r.revision;banner.hidden=['detector','hunt'].includes(tab)||!historical;
      bannerText.textContent=historyView?'本地缓存 · '+(seqLabel(historyView.sid)||'')+' · '+turnLabel(historyView):turnKey?'历史轮次 · '+turnLabel(s)+' · 非最新记录':r?.data?'上次记录 · 非本轮结论':'本地缓存 · 非本轮结论';banner.querySelector('button').hidden=!(historyView||turnKey);
      for(let i=0;i<tabs.length;i++){const on=tabs[i][0]===tab;tabButtons[i].setAttribute('aria-selected',String(on));tabButtons[i].tabIndex=on?0:-1;}body.setAttribute('aria-labelledby','amp-tab-'+tab);
      logBar.hidden=tab!=='logs';clearLogs.textContent=confirmLogClear?'确认清理全部日志':'清理日志';cancelClear.hidden=!confirmLogClear;read.disabled=['detector','hunt'].includes(tab)||!!historyView||!!r?.busy||Date.now()<cooldown;
      statusBar();
      const dataTabs=['overview','sources','raw'].includes(tab),turnSid=historyView?.sid||sid,turns=catalog.turnsOf(turnSid),liveData=liveView(turnSid),options=liveData&&!turns.some(t=>t.key===liveData.key)?[...turns,{...liveData,key:liveData.key}]:turns;
      turnPicker.hidden=!dataTabs||options.length<2;
      if(!turnPicker.hidden){const lk=historyView?null:liveKey(),key=options.map(t=>t.key+':'+t.prompt+':'+t.count).join('|')+'|'+lk;if(turnStamp!==key){turnStamp=key;turnSelect.replaceChildren();for(const t of options){const o=el('option','',turnTitle(t,t.key===lk),turnSelect);o.value=t.key;}}turnSelect.value=historyView?.key||turnKey||lk||'';}
      picker.hidden=!c||s.calls.length<2||!dataTabs;if(!picker.hidden){const key=s.calls.map(x=>x.id+':'+x.model+':'+x.tokens.output).join('|');if(pickerStamp!==key){pickerStamp=key;select.replaceChildren();for(const [i,call]of s.calls.entries()){const o=el('option','',(i+1+s.prior)+'. '+clock(call.at)+' · '+call.model+(call.tokens.output!==null?' · 出 '+fmt(call.tokens.output):''),select);o.value=call.id;}}select.value=c.id;}
      pickers.hidden=turnPicker.hidden&&picker.hidden;
      if(tab==='logs'){const logSid=historyView?.sid||sid,key=(logSid||'')+':'+catalog.logRevision;if(logKey!==key){logKey=key;void catalog.readLogs(logSid).then(rows=>{if(logKey!==key)return;logItems=rows;logSerial++;paint();});}}
      if(tab==='settings'&&Date.now()-usageAt>5000){usageAt=Date.now();void catalog.usage().then(u=>{usageInfo=u;settingsSerial++;paint();});}
      const next=[tab,tab==='detector'?legacyDisplay.revision:tab==='hunt'?gacha.revision:0,s,c,historical,moreOpen,tab==='cache'?catalog.revision:0,cacheLimit,openSid,tab==='logs'?logSerial:0,tab==='logs'?pref.level:null,!!r?.busy,Date.now()<cooldown,rawFilter,rawSpan,tab==='raw'?rawStore.get(s?.key)?.spans.size:0,tab==='settings'?settingsSerial:0,confirmRawClear,tab==='settings'?JSON.stringify(prefs):'',tab==='raw'?JSON.stringify(rawOf(s)?.probe&&Object.keys(rawOf(s).probe)):''];
      if(next.some((x,i)=>x!==bodyStamp[i])||!bodyStamp.length){const scroll=body.scrollTop,sameTab=bodyStamp[0]===tab,focus=root.activeElement?.dataset.focus;bodyStamp=next;body.replaceChildren();if(tab==='hunt')huntTab();else if(tab==='detector')detectorTab();else if(tab==='cache')cacheTab();else if(tab==='logs')logTab();else if(tab==='settings')settingsTab();else if(!c)empty(turnKey?'正在读取此轮缓存':'尚无模型记录',turnKey?'如长时间无内容，说明此轮快照不可用。':'发送一条新消息后，型号与配置会自动填入。');else if(tab==='sources')sources(s,c);else if(tab==='raw')rawTab(s,c);else overview(s,c);body.scrollTop=sameTab?scroll:0;if(focus)[...body.querySelectorAll('[data-focus]')].find(e=>e.dataset.focus===focus)?.focus({preventScroll:true});}
    }
    // Display adapter only. The original detector engine is not rewritten or fed Probe data.
    function detectorTab(){
      const data=legacyDisplay.snapshot();
      const section=el('section','section',null,body);
      el('h3','section-heading','独立检测 · 原脚本 v8.1.0',section);
      el('p','note','这里显示原脚本的最新状态和结果，与概览的检测逻辑独立，不跟随会话缓存或历史轮次选择。',section);
      const state=el('div','config-row',null,section);
      state.style.marginTop='14px';
      el('span','config-label','状态',state);
      el('span','config-value',data.state||'等待初始化',state);
      const text=el('pre','json',data.text||'等待发送内容',section);
      text.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:none;user-select:text;margin-top:14px;';
      text.tabIndex=0;
      const actions=el('div','log-actions',null,section);
      button(actions,'复制原始显示','复制原脚本完整显示文本',()=>copy(data.text,'独立检测信息'));
      button(actions,'导出本页','仅导出本页显示，不含运行令牌',()=>download(legacyDisplay.snapshot(),'arena-independent-detector-'+Date.now()+'.json'));
      if(data.at)el('p','note','显示更新时间：'+new Date(data.at).toLocaleString(),section);
      el('p','note','保留原脚本的 New Chat 自动刷新行为。两套检测分别请求数据，可能增加读取次数；本页不代表历史轮次结论。',section);
    }
    function overview(s,c){
      const model=el('section','section model',null,body),cap=el('div','section-heading',null,model);el('span','eyebrow',c.request?'请求型号':'Trace 模型标签',cap);el('span','eyebrow',turnLabel(s)+' · '+s.count+' 次调用'+(s.prior?'（此前 '+s.prior+' 次）':''),cap);
      const title=el('div','model-title',null,model);el('div','name',c.model,title);iconButton(title,'copy','复制型号',()=>copy(c.model));
      const internal=c.internal||(s.internalNames.length?s.internalNames.join(' / '):null), ir=row(model,'内部名称',internal);if(internal&&(c.internalScope==='turn'||!c.internal)&&s.count>1)el('span','pill','轮次级',ir.lastChild);
      if(s.routing){const rr=row(model,'路由改派',(s.routing.from||'原模型')+' → '+(s.routing.to||'其他模型'),true);el('span','pill',s.routing.cause?(/内容审核/.test(s.routing.cause)?'内容审核拦截':/空内容/.test(s.routing.cause)?'原模型空响应':/首包超时/.test(s.routing.cause)?'首包超时':'原模型失败'):s.routing.waitMs?'原模型 '+Math.round(s.routing.waitMs/1000)+' 秒无输出':'原模型失败',rr.lastChild);if(s.routing.cause)row(model,'改派类型',s.routing.cause);if(s.routing.reason)row(model,'改派原因',s.routing.reason);}
      if(s.outcome){const lc=s.calls.at(-1);row(model,'本轮结果',(s.outcome==='failed'?'Arena 记录失败':'空回复')+(lc?.finish==='length'?' · 推理用尽输出上限':''),false);}
      if(s.prompt)row(model,'提问开头','“'+s.prompt+'”',false);if(s.sentAt)row(model,'发送时间',fullStamp(Date.parse(s.sentAt)));
      const more=el('details','model-more',null,model);more.open=moreOpen;more.ontoggle=()=>{moreOpen=more.open;};const summary=el('summary','',null,more);summary.dataset.focus='更多型号信息';icon('chevron',summary);el('span','','更多型号信息',summary);row(more,'请求型号',c.request);row(more,'响应型号',c.response);row(more,'平台路由',c.route);row(more,'协议适配器',c.adapter);if(s.internalNames.length>1)row(more,'本轮内部名',s.internalNames.join('\n'));row(more,'调用时间',c.at?new Date(c.at).toLocaleString('zh-CN',{hour12:false}):null);row(more,'Run',s.runId);row(more,'Span',c.id);
      const config=el('section','section',null,body);el('h3','section-heading','推理配置',config);const table=el('div','config',null,config),e=c.effort;
      const configRow=(key,value,cls='')=>{const r=el('div','config-row',null,table);el('span','config-label',key,r);return el('span','config-value '+cls,value,r);};
      configRow('显式推理档位',e.value||({conflict:'冲突',unsupported:'不支持'}[e.status])||'未知',e.status==='explicit'?'tag':e.status==='conflict'?'warning':'muted');const suffix=configRow('内部名称后缀',c.hint.value||'—','muted');suffix.title=c.hint.status;
      for(const v of e.budgets)configRow('推理预算',v===-1?'自动 (-1)':fmt(v)+' tokens');for(const v of e.modes)configRow('思考模式',v);
      const configNote=e.value?(e.evidence.some(x=>x.kind==='effort'&&x.source==='span'&&x.value===e.value)?'来自 Span 的明确配置字段。':'仅见于页面请求参数。'):e.status==='conflict'?'字段存在不同值（'+e.levels.join(' / ')+'）。':e.status==='unsupported'?'档位字段值不在已知枚举内。':'未发现明确的档位参数。';
      el('p','note'+(e.status==='conflict'?' warning':''),configNote,config);if(!['内部标签，非显式参数','无后缀','未提供'].includes(c.hint.status))el('p','note warning','后缀：'+c.hint.status,config);
      const usage=el('section','section',null,body);const usageHead=el('div','section-heading',null,usage);el('h3','','报告用量',usageHead);el('span','eyebrow',s.count>1?'第 '+(s.calls.indexOf(c)+1+s.prior)+' 次调用':'单次调用',usageHead);
      const values=el('div','usage',null,usage);for(const [key,value]of [['输入',fmt(c.tokens.input)],['输出',fmt(c.tokens.output)],['推理',c.reasoning.status==='conflict'?'冲突':fmt(c.reasoning.value)]]){const cell=el('div','usage-cell',null,values);el('div','usage-label',key,cell);el('div','usage-value',value,cell);}
      const total=el('div','usage-total',null,usage);el('span','','总 Token',total);el('strong','mono',c.tokens.total!==null?fmt(c.tokens.total):c.totalLabel?'≈ '+c.totalLabel:'—',total);
      const usageNote={zero:'推理 Token 报告为 0。',missing:'推理 Token 未提供；“—”不是 0。',conflict:'推理 Token 来源冲突，不合并。'};if(usageNote[c.reasoning.status])el('p','note',usageNote[c.reasoning.status],usage);
      if(s.records.length&&(s.count>1||s.records.length>1)){for(const rec of s.records){const tu=el('div','usage-turn',null,usage);el('span','',(s.records.length>1?clock(rec.at)+' · ':'')+'本轮用量记录'+(rec.internal?' · '+rec.internal:''),tu).style.flexBasis='100%';for(const [k,v]of [['输入',rec.input],['输出',rec.output],['推理',rec.reasoning],['总',rec.total]]){const sp=el('span','',k+' ',tu);el('strong','',fmt(v),sp);}}}
      creditsSection(s);
      if(s.partial)el('p','note warning','部分记录：尚有字段未取得。',body);
    }
    // 本轮消耗：credits 来自页面费用接口；余额变化来自 /api/billing/balance 前后对比（账号级，可能含其他标签页的消耗）
    function creditsSection(s){
      if(!prefs.showCredits)return;const cr=s.credits,live=!historyView&&!turnKey&&liveKey()===s.key,st=live?costState.get(s.sid):null;
      const sec=el('section','section credits',null,body),head=el('div','section-heading',null,sec);el('h3','','本轮消耗',head);
      const srcText={message:'费用接口 · 按消息 id',new:'费用接口 · 新条目推断',session:'费用接口 · 累计差值'}[cr?.source]||(cr?.balance?'仅余额差值':'');el('span','eyebrow',srcText,head);
      const money=v=>v===null||v===undefined?null:'$'+(+v).toFixed(Math.abs(v)<0.01&&v!==0?5:4);
      if(cr&&cr.credits!==null&&cr.credits!==undefined){
        const values=el('div','usage',null,sec);for(const [k,v]of [['credits',Math.round(cr.credits).toLocaleString('zh-CN')],['计费',money(cr.usd)||'—'],['实际成本',money(cr.actualUsd)||'—']]){const cell=el('div','usage-cell',null,values);el('div','usage-label',k,cell);el('div','usage-value',v,cell);}
        const p=cr.parts[0];if(p&&(p.strategy||p.multiplier!==null||p.margin!==null))row(sec,'定价',[p.strategy,p.multiplier!==null&&p.multiplier!==undefined?'成本 ×'+p.multiplier:null,p.margin!==null&&p.margin!==undefined?'毛利 ×'+p.margin:null,p.fallback?'估算':null].filter(Boolean).join(' · '));
        if(cr.parts.length>1)row(sec,'条目',cr.parts.map(x=>Math.round(x.credits)+' credits').join(' + '));
        if(cr.keys.length)row(sec,'消息 id',cr.keys.join('\n'));
      }else{
        el('p','note',live?(st?.tries?'已读取 '+st.tries+' 次，尚未命中本轮的计费条目；'+(st.tries<COST_DELAYS.length?'稍后继续。':'已停止重试，可点“重读”再试。'):'流结束后约 3 秒读取 /api/chat/{id}/cost。'):'此轮没有取得费用记录。',sec);
      }
      if(cr?.session&&(cr.session.credits!==null||cr.session.chargedUsd!==null))row(sec,'会话累计',(cr.session.credits!==null?Math.round(cr.session.credits).toLocaleString('zh-CN')+' credits':'')+(cr.session.chargedUsd!==null?' · 计费 '+money(cr.session.chargedUsd):'')+(cr.session.actualUsd!==null?' · 实际 '+money(cr.session.actualUsd):'')+(cr.session.messages!==null?' · '+cr.session.messages+' 条消息':''));
      if(cr?.balance)row(sec,'余额变化',cr.balance.before+' → '+cr.balance.after+'（'+(cr.balance.delta>0?'−':cr.balance.delta<0?'+':'')+Math.abs(cr.balance.delta)+'）');
      if(s.costs?.length){const d=el('details','model-more',null,sec),sm=el('summary','',null,d);icon('chevron',sm);el('span','','Trace 花费记录（spend.recorded）',sm);for(const c of s.costs){if(!c.fields.length){el('p','note','该记录里没有识别出费用类字段。',d);continue;}for(const f of c.fields.slice(0,12))row(d,f.key.slice(0,14),String(f.value));}}
      if(cr&&cr.credits!==null&&cr.credits!==undefined&&cr.source!=='message')el('p','note','推断值：未能按本轮消息 id 命中，改用'+(cr.source==='new'?'基线之后新出现的计费条目':'会话累计的前后差值')+'；若其他标签页同时在此会话发消息，可能不准。',sec);
    }
    const SOURCE_TEXT={span:'Span · AI SDK 遥测',record:'用量记录 · token.usage.recorded',providerMetadata:'供应商元数据',页面请求:'页面请求参数'},KIND_TEXT={effort:'显式档位',budget:'预算',mode:'模式',input:'输入 Token',output:'输出 Token',total:'总 Token',reasoning:'推理 Token',token:'Token'};
    function sources(s,c){
      el('h3','section-heading','字段与记录来源',body);
      const ids=el('section','section',null,body);row(ids,'请求型号',c.request);row(ids,'内部名称',c.internal||(s.internalNames.join(' / ')||null));row(ids,'Run',s.runId);row(ids,'Span',c.id);row(ids,'后缀解读',c.hint.status,false);
      const evidence=[...c.effort.evidence,...c.reasoning.evidence,...c.tokenSources],groups=new Map();
      for(const e of evidence){const k=e.source||'span';if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e);}
      for(const [source,items]of groups){el('div','group-title',SOURCE_TEXT[source]||source,body);const seen=new Set();for(const e of items){const k=e.kind+'|'+e.path;if(seen.has(k))continue;seen.add(k);const d=el('div','entry',null,body),top=el('div','entry-top',null,d);el('span','',(KIND_TEXT[e.kind]||'Token')+' · '+(e.value??'不支持的值'),top);el('code','',e.path,d);}}
      if(!groups.has('record')&&s.records.length){el('div','group-title',SOURCE_TEXT.record,body);for(const rec of s.records){for(const [k,v,path]of [['input',rec.input,'inputTokens'],['output',rec.output,'outputTokens'],['reasoning',rec.reasoning,'reasoningTokens'],['total',rec.total,'totalTokens']]){if(v===null)continue;const d=el('div','entry',null,body),top=el('div','entry-top',null,d);el('span','',KIND_TEXT[k]+' · '+v,top);el('span','entry-source',rec.internal||'',top);el('code','','$.properties.'+path,d);}}}
      if(s.costs?.some(c=>c.fields.length)){el('div','group-title','花费记录 · spend.recorded',body);for(const c of s.costs)for(const f of c.fields.slice(0,24)){const d=el('div','entry',null,body),top=el('div','entry-top',null,d);el('span','',f.key+' · '+f.value,top);el('span','entry-source',c.internal||'',top);el('code','',f.path,d);}}
      if(!evidence.length&&!s.records.length)el('p','note','暂无明确配置或用量字段。',body);
      if(Object.keys(c.settings).length){const section=el('section','section',null,body);el('h3','section-heading','其他配置',section);for(const [k,v]of Object.entries(c.settings))row(section,k,v);}
      const legend=el('div','legend',null,body);legend.append('路径前缀：',el('code','','$.properties.ai.usage.*'),' = AI SDK 字段；',el('code','','$.properties.gen_ai.usage.*'),' = OpenTelemetry GenAI 标准字段（同一数值的重复上报）；',el('code','','$.properties.*Tokens'),'（无前缀）= Arena 用量记录，携带内部名称。');
    }
    function rawTab(s,c){
      const raw=rawOf(s),r=selectedRun(),liveRun=r&&r.data?.key===s.key?r:null;
      const h=el('div','section-heading',null,body);el('h3','','原始 Trace 事件',h);el('span','eyebrow',raw.events.length+' 条 · '+(raw.full?'内存完整版':'缓存精简版'),h);
      const ctl=el('div','raw-controls',null,body),filter=el('select','selector',null,ctl);filter.setAttribute('aria-label','筛选事件');for(const [id,text]of [['all','全部事件'],['stream','模型调用'],['usage','用量与花费'],['marker','轮次标记'],['error','错误']]){const o=el('option','',text,filter);o.value=id;}filter.value=rawFilter;filter.onchange=()=>{rawFilter=filter.value;render();};
      button(ctl,'导出本轮','导出本轮原始 Trace 与 Span',()=>{download({tool:'Arena Model Probe Lite',version:VERSION,at:new Date().toISOString(),sid:s.sid,runId:s.runId,turn:s.turn,attempt:s.attempt,full:raw.full,events:raw.events,trace:raw.trace,spans:raw.spans,probe:raw.probe},'amp-lite-raw-'+(s.turn||0)+'-'+Date.now()+'.json');});
      const list=raw.events.filter(e=>rawFilter==='all'||rawFilter==='usage'?rawFilter==='all'||e.kind==='usage'||e.kind==='cost':rawFilter==='error'?e.isError:e.kind===rawFilter);
      const box=el('div','',null,body);if(!list.length)el('p','note','没有匹配的事件。',box);
      for(const e of list.slice(0,400)){const b=button(box,'',e.message||'事件',()=>{if(e.spanId){rawSpan=e.spanId;render();}},'event-row');if(e.kind)b.dataset.kind=e.kind;if(e.spanId&&e.spanId===(rawSpan||c.id))b.setAttribute('data-active','');el('time','',clock(e.at),b);el('span','event-msg',(e.message||'')+(e.model?' · '+e.model:''),b);el('span','event-extra',[e.durationMs!==null&&e.durationMs!==undefined?e.durationMs>=1000?(e.durationMs/1000).toFixed(1)+'s':Math.round(e.durationMs)+'ms':'',e.isPartial?'进行中':'',e.isError?'错误':'',e.isCancelled?'已取消':''].filter(Boolean).join(' '),b);}
      if(list.length>400)el('p','note','仅显示前 400 条；导出可查看全部。',body);
      const spanId=rawSpan||c.id,data=raw.spans[spanId];
      const sh=el('div','section-heading',null,body);sh.style.marginTop='18px';el('h3','','Span 详情',sh);el('code','eyebrow',spanId,sh);
      const sc=el('div','raw-controls',null,body);
      if(data){button(sc,'复制 JSON','复制此 Span 的 JSON',()=>copy(JSON.stringify(data,null,2),'JSON'));const text=JSON.stringify(data,null,2),pre=el('pre','json',text.length>300000?text.slice(0,300000)+'\n…[已截断，导出可查看完整]':text,body);pre.setAttribute('tabindex','0');if(!raw.full)el('p','note','缓存精简版：正文类字段已省略、长字符串已截断。',body);}
      else{el('p','note',liveRun?'此 Span 尚未读取。':'此 Span 的详情不在缓存中。',body);if(liveRun&&liveRun.token)button(sc,'读取此 Span','按需读取此 Span 的详情',()=>{void fetchSpan(liveRun,spanId);say('正在读取…');},'clear');}
      const probe=raw.probe,ph=el('div','section-heading',null,body);ph.style.marginTop='18px';el('h3','','探测：run 记录 / 元数据 / 会话 / 费用',ph);
      const pc=el('div','raw-controls',null,body);if(liveRun?.token)button(pc,'重新探测','用当前令牌重新读取 run 记录、元数据与会话记录',()=>{if(liveRun.probing){say('探测进行中');return;}liveRun.probe=null;void probeRun(liveRun,['run','session','metadata']);say('正在探测…');},'clear');
      if(!probe||!Object.keys(probe).length)el('p','note',liveRun?'尚未探测；读到 Trace 后会自动进行一次。':'此轮没有探测结果。',body);
      else for(const k of ['run','session','metadata','cost']){const v=probe[k];if(!v)continue;const d=el('details','model-more',null,body),sm=el('summary','',null,d);icon('chevron',sm);el('span','',({run:'GET /api/v3/runs/{runId}',session:'GET /api/v1/sessions/{sid}',metadata:'GET /api/v1/runs/{runId}/metadata',cost:'GET /api/chat/{sid}/cost'})[k]+' · HTTP '+(v.status||'—')+(v.error?' · '+v.error:''),sm);if(v.data!==undefined){const text=JSON.stringify(v.data,null,2);el('pre','json probe',text.length>200000?text.slice(0,200000)+'\n…[已截断]':text,d);}}
    }
    // 状态行：新会话限流（create-chat 响应头，localStorage 跨标签页共享）、每日额度、本轮 credits。
    // 限流数字在窗口过后不再隐藏：按上限显示并标注“已重置”（推断值），下次新建会话时更新
    const creditsText=cr=>cr?cr.credits!==null&&cr.credits!==undefined?Math.round(cr.credits).toLocaleString('zh-CN')+' credits':cr.balance&&cr.balance.delta?'余额 '+(cr.balance.delta>0?'−':'+')+Math.abs(cr.balance.delta):null:null;
    function statusBar(){
      const now=Date.now(),items=[],s=view(),sid=sidOf(location.href);
      if(prefs.showQuota){
        for(const [kind,q] of [['chat',quota.chat],['append',quota.append]]){const v=quotaView(q,kind,now,prefs.showQuotaReset);if(!v)continue;const sp=el('span',v.cls);sp.append(v.label+' ');el('strong','',v.value,sp);if(v.tail)sp.append(v.tail);sp.title=v.title;items.push(sp);}
        if(balance){const used=balance.daily?(balance.daily-balance.remaining)/balance.daily:0,stale=balance.refreshAt&&balance.refreshAt<=now,sp=el('span',balance.remaining<=0&&!stale?'blocked':used>=0.5?'low':'');sp.append('额度 ');el('strong','',balance.remaining+(balance.daily!==null?'/'+balance.daily:''),sp);if(balance.refreshAt&&balance.refreshAt>now)sp.append(' · '+until(balance.refreshAt,now)+'重置');else if(stale)sp.append(' · 已到重置时间');sp.title='GET /api/billing/balance · '+new Date(balance.at).toLocaleTimeString('zh-CN',{hour12:false})+' 读取'+(stale?' · 重置时间已过，数字待刷新':'');items.push(sp);}
      }
      if(prefs.showCredits){const r=selectedRun(),hist=!!historyView||!!turnKey,cr=hist?s?.credits:(costState.get(sid)?.credits||s?.credits),text=creditsText(cr);if(text){const sp=el('span','');sp.append(hist?'该轮 ':r?.data&&r.data.revision!==r.revision&&!costState.get(sid)?.credits?'上次 ':'本轮 ');el('strong','',text,sp);sp.title='GET /api/chat/{id}/cost'+(cr.source?' · '+({message:'按本轮消息 id 命中',new:'按新出现的计费条目推断',session:'按会话累计差值推断'}[cr.source]||cr.source):' · 仅余额差值')+(cr.usd!==null&&cr.usd!==undefined?' · 计费 $'+(+cr.usd).toFixed(4):'')+(cr.balance?' · 余额 '+cr.balance.before+' → '+cr.balance.after:'');items.push(sp);}}
      const key=items.map(x=>x.textContent+'|'+x.className+'|'+x.title).join('\n');if(key!==status.dataset.key){status.dataset.key=key;status.replaceChildren(...items);}status.hidden=!items.length||!['overview','sources','raw'].includes(tab);
    }
    function huntTab(){
      const g=gacha.state(),s=gacha.settings(),active=gacha.running();
      const h=el('div','section-heading',null,body);el('h3','','老虎机抽卡（单标签页 · 9.23.2 引擎）',h);el('span','eyebrow',g?({running:'进行中',stopping:'正在停止',paused:'已暂停',hit:'已命中',done:'已完成'}[g.status]||g.status):'未开始',h);
      el('p','note','点击发送按钮左侧的厂商名称打开抽卡卡片。每抽：新对话 → 发送 → 识别模型 → 改名 → 黑名单归档；未识别时在同一对话重发。',body);
      const cfg=el('div','section',null,body);
      const gs=g?.settings??s;row(cfg,'目标厂商',gs.targetModel||'不限',false);
      row(cfg,'张数',String(gs.maxAttempts));row(cfg,'间隔',(gs.intervalMs/1000)+' 秒');row(cfg,'提示词',gs.prompt,false);
      row(cfg,'归档黑名单',gs.archiveOn?((gs.archiveKeywords||[]).join('、')||'—'):'关闭',false);row(cfg,'路由 Thinking 停止',gs.stopOnThinking?'开启':'关闭',false);
      const ctl=el('div','section',null,body);ctl.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
      button(ctl,'打开抽卡面板','打开发送按钮旁的抽卡面板',()=>window.dispatchEvent(new CustomEvent('amp-native-gacha-open')),'clear');
      if(active)button(ctl,'停止','停止抽卡',()=>{gacha.stop();render();},'clear');
      else if(g?.status==='paused')button(ctl,'继续','从暂停处继续',()=>{const r=gacha.start(true);if(!r.ok)say(r.error);render();},'clear');
      if(g&&!active)button(ctl,'导出','导出本次抽卡记录（不含令牌）',()=>download(g,'arena-gacha-'+Date.now()+'.json'),'clear');
      if(!g)return;
      const st=el('div','section',null,body);el('h3','section-heading','状态',st);
      row(st,'进度',g.completed+' / '+g.settings.maxAttempts);
      if(g.phase)row(st,'阶段',g.phase,false);if(g.reason)row(st,'原因',g.reason,false);
      const list=el('div','section',null,body);el('h3','section-heading','每一抽',list);
      for(const a of g.attempts.slice().reverse().slice(0,50))row(list,'#'+a.no+' '+new Date(a.at).toLocaleTimeString('zh-CN',{hour12:false}),(a.model||'—')+(a.tier?' · '+a.tier:'')+' · '+({hit:'命中',keep:'保留',archive:a.archived?'已归档':'待归档',other:'保留',skipped:'跳过',error:'中断',cancelled:'取消',abandoned:'中断'}[a.verdict]||'进行中')+(a.resends?' · 重发 '+a.resends:'')+(a.renamed?' · 已改名':'')+(a.note?'\n'+a.note:''));
      const lg=el('details','model-more',null,body),sm=el('summary','',null,lg);icon('chevron',sm);el('span','','运行日志',sm);
      for(const e of g.log.slice(-80).reverse())row(lg,new Date(e.at).toLocaleTimeString('zh-CN',{hour12:false}),e.text,false);
    }
    function settingsTab(){
      const toggle=(parent,title,hint,value,fn)=>{const r=el('div','setting',null,parent),g=el('div','grow',null,r);el('span','',title,g);if(hint)el('span','hint',hint,g);const b=el('button','switch','',r);b.type='button';b.setAttribute('role','switch');b.setAttribute('aria-checked',String(!!value));b.setAttribute('aria-label',title);b.dataset.focus=title;b.onclick=()=>{fn(!value);savePrefs();bodyStamp=[];render();};return b;};
      const sec=el('section','section',null,body);el('h3','section-heading','显示',sec);
      toggle(sec,'隐藏输入框里的文档图标','默认开启：目标按钮左边的纸张图标按钮没什么实际用途，隐藏后更宽松。',prefs.hideDocIcon,v=>{prefs.hideDocIcon=v;if(!v)store(DOC_KEY,'');docIcon();});
      toggle(sec,'显示“已重置”的推断限流','默认关闭：如“新会话 10/10 · 已重置”只是按上限推断的数值，不是必要信息。',prefs.showQuotaReset,v=>{prefs.showQuotaReset=v;});
      toggle(sec,'对话名显示本地编号 #N','默认关闭：左侧对话名只显示模型名，避免与加载进度、厂商图标挤在一起。',prefs.showSeq,v=>{prefs.showSeq=v;for(const m of marks.values()){m.span.removeAttribute('data-amp-local-title');m.span.removeAttribute('data-amp-short');}localTitles();});
      toggle(sec,'消息旁显示发送时间','来自消息 id 内的 UUIDv7 时间戳；无法解析时用本机记录的提交时间。',prefs.showSent,v=>{prefs.showSent=v;if(!v)clearSent();});
      toggle(sec,'显示限流与额度状态','新会话限流来自 create-chat 响应头；额度来自 /api/billing/balance。',prefs.showQuota,v=>{prefs.showQuota=v;if(v)void refreshBalance(true);});
      toggle(sec,'读取每轮 credits 消耗','流结束后读取页面自带的费用接口 GET /api/chat/{id}/cost（同源，与页面“N credits”同源数据），并记录提交前后的余额变化。',prefs.showCredits,v=>{prefs.showCredits=v;});
      {const gs=gacha.settings();toggle(sec,'首包看门狗（实验）','默认关闭：发送后 '+gs.watchdogSec+' 秒仍没有任何输出（Arena 约 90 秒会改派别的模型），自动停止并在同一对话重发，最多 '+gs.watchdogRetries+' 次；日志会验证重发后是否仍是原模型。',gs.watchdog,v=>{gacha.saveSettings({watchdog:v});});
        const wr=el('div','setting',null,sec),wg=el('div','grow',null,wr);el('span','','看门狗秒数 / 重试次数',wg);el('span','hint','秒数从点发送算起；服务端从开始调用模型才计时（通常晚 5–10 秒），不建议超过 80。',wg);
        const ss=el('select','selector',null,wr);for(const v of [65,70,75,80]){const o=el('option','',v+' 秒',ss);o.value=String(v);}ss.value=String(gs.watchdogSec);ss.onchange=()=>gacha.saveSettings({watchdogSec:+ss.value});
        const rs=el('select','selector',null,wr);for(const v of [1,2,3]){const o=el('option','',v+' 次',rs);o.value=String(v);}rs.value=String(gs.watchdogRetries);rs.onchange=()=>gacha.saveSettings({watchdogRetries:+rs.value});}
      {const gs=gacha.settings();toggle(sec,'首包提示（实验）','默认关闭：手动发送的每条消息末尾自动追加一句，让模型先输出“思考中…”再继续。服务端尽早收到首包就不会因约 90 秒无输出而改派；看门狗也会看到输出而不去停止。抽卡时不追加。代价：模型的隐藏深度思考会变短，分析改为写在正文里；刷新页面后消息里能看到这句。',gs.warmup,v=>{gacha.saveSettings({warmup:v});});
        const pr=el('div','setting',null,sec),pg=el('div','grow',null,pr);el('span','','首包提示内容',pg);const inp=el('textarea','',null,pg);inp.rows=2;inp.value=gs.warmupText;inp.style.cssText='width:100%;margin-top:6px;resize:vertical;font:inherit;font-size:12px;padding:6px 8px;border-radius:8px;border:1px solid var(--amp-line,rgba(128,128,128,.35));background:transparent;color:inherit;box-sizing:border-box';inp.onchange=()=>gacha.saveSettings({warmupText:inp.value.trim()||WARMUP_DEFAULT});inp.onkeydown=e=>e.stopPropagation();}
      toggle(sec,'模型被改派时自动停止生成','默认开启：原模型首包超时被 Arena 换成别的模型后立即停止，避免替补模型长时间推理白白消耗额度；关闭则让替补模型继续回答。',prefs.stopOnResample,v=>{prefs.stopOnResample=v;savePrefs();});
      toggle(sec,'页面底部信息栏','固定在页面最底部：美金额度、Pulse、credits、限流、当前模型、抽卡进度与更新时间。',prefs.showBar,v=>{prefs.showBar=v;bar?.sync();if(v)void refreshPulse(true);});
      toggle(sec,'为信息栏预留页面空间','把 Arena 的整屏容器高度减去信息栏高度，避免遮挡输入框；遇到布局异常时可关闭。',prefs.barOffset,v=>{prefs.barOffset=v;bar?.sync();});
      const cloud=el('section','section',null,body);el('h3','section-heading','云端标题',cloud);
      toggle(cloud,'把本地标题同步到 Arena 会话名','使用页面自带的重命名接口（PATCH /api/history/agentic/{id}），会覆盖 Arena 上已有的会话名；每个会话同一标题只发送一次。',prefs.cloudSync,v=>{prefs.cloudSync=v;if(v){const e=catalog.entries.get(sidOf(location.href));if(e)void syncTitle(e);}});
      const fr=el('div','setting',null,cloud),fg=el('div','grow',null,fr);el('span','','同步格式',fg);el('span','hint',prefs.cloudFormat==='name'?'仅内部名称，如 gpt-5.1-codex-high':'编号 + 内部名称，如 #12 gpt-5.1-codex-high',fg);const fs=el('select','selector',null,fr);fs.setAttribute('aria-label','同步格式');for(const [id,text]of [['prefix','#编号 名称'],['name','仅名称']]){const o=el('option','',text,fs);o.value=id;}fs.value=prefs.cloudFormat;fs.onchange=()=>{prefs.cloudFormat=fs.value;savePrefs();bodyStamp=[];render();};
      const cur=catalog.entries.get(sidOf(location.href));const cr=el('div','setting',null,cloud),cg=el('div','grow',null,cr);el('span','','当前会话',cg);el('span','hint',cur?(cur.cloud?.title?'已同步：'+cur.cloud.title:'未同步')+' · 本地：'+cur.title:'尚无本地标题',cg);if(cur)button(cr,'立即同步','把当前会话的本地标题写入 Arena',async()=>{say('正在同步…');const ok=await syncTitle(cur,true);say(ok?'已同步':'未同步，见日志');},'clear').style.marginTop='0';
      const st=el('section','section',null,body);el('h3','section-heading','本地存储',st);const u=usageInfo;
      const grid=el('div','stat-grid',null,st),cell=(label,value,ratio)=>{const c=el('div','stat',null,grid);el('div','stat-label',label,c);el('div','stat-value',value,c);if(ratio!==undefined){const b=el('div','bar',null,c);el('i','',null,b).style.width=Math.min(100,Math.round(ratio*100))+'%';}};
      const mb=v=>v===null||v===undefined?'—':v>=1073741824?(v/1073741824).toFixed(1)+' GB':(v/1048576).toFixed(v>=10485760?0:1)+' MB';
      cell('原始数据（raw 表）',u?mb(u.rawTotal)+' · '+(u.rawCount??'—')+' 轮':'读取中…',u&&u.rawTotal!==null?u.rawTotal/(prefs.rawBudget*1048576):undefined);
      cell('站点存储总量'+(u?.estimate?.quota?' · 上限 '+mb(u.estimate.quota):''),u?.estimate?mb(u.estimate.usage):'—',u?.estimate?.quota?u.estimate.usage/u.estimate.quota:undefined);
      cell('会话 / 轮次',u?(u.counts.sessions??'—')+' / '+(u.counts.turns??'—'):'—');cell('日志 / 发送时间',u?(u.counts.logs??'—')+' / '+(u.counts.sent??'—'):'—');
      const br=el('div','setting',null,st),bg=el('div','grow',null,br);el('span','','原始数据预算',bg);el('span','hint','超出后自动删除最旧轮次的原始 Trace 与 Span（结构化记录与标题不受影响）。',bg);const bs=el('select','selector',null,br);bs.setAttribute('aria-label','原始数据预算');for(const v of BUDGET_OPTIONS){const o=el('option','',v+' MB',bs);o.value=String(v);}bs.value=String(prefs.rawBudget);bs.onchange=()=>{prefs.rawBudget=Number(bs.value);savePrefs();bodyStamp=[];render();};
      const acts=el('div','log-actions',null,st);acts.style.marginTop='10px';
      const exportAll=async withRaw=>{say('正在整理…');const all=await catalog.exportAll(withRaw);download({tool:'Arena Model Probe Lite',version:VERSION,at:new Date().toISOString(),kind:withRaw?'all-turns-raw':'all-turns',quota,balance,...all},'amp-lite-all-'+(withRaw?'raw-':'')+Date.now()+'.json');say('已导出 '+all.turns.length+' 轮');};
      button(acts,'导出全部轮次','导出所有会话与轮次的结构化记录（不含原始数据）',()=>exportAll(false));button(acts,'导出全部（含原始）','同时附上 raw 表中每轮的原始 Trace 与 Span，文件可能很大',()=>exportAll(true));
      const clr=button(acts,confirmRawClear?'确认清理原始数据':'清理原始数据','删除全部已保存的原始 Trace 与 Span',async()=>{if(!confirmRawClear){confirmRawClear=true;render();return;}await catalog.clearRaw();confirmRawClear=false;usageAt=0;say('已清理');render();});
      if(confirmRawClear)button(acts,'取消','取消清理',()=>{confirmRawClear=false;render();});
      const note=el('p','note',null,st);note.textContent='站点存储总量由浏览器统计，包含 Arena 自身的缓存；本脚本的结构化记录每轮 2–20 KB，日志上限约 1 MB。';
    }
    // 用户消息旁的发送时间：写在气泡下方操作格（data-user-message-action，复制按钮所在）的属性上，由 ::before 渲染在按钮左侧；不插入节点
    function clearSent(){for(const [node]of sentMarks){node.removeAttribute('data-amp-sent');node.removeAttribute('title');}sentMarks.clear();}
    function sentTimes(){
      if(!prefs.showSent||document.readyState!=='complete')return;
      for(const [node]of sentMarks)if(!node.isConnected){sentMarks.delete(node);}
      const rows=document.querySelectorAll('[data-chat-message-id] [data-user-message-body-row]'),need=[];let changed=0;
      for(const rowEl of rows){
        const host=rowEl.closest('[data-chat-message-id]'),id=host?.getAttribute('data-chat-message-id'),node=rowEl.querySelector(':scope>[data-user-message-action]')||rowEl;if(!id||sentMarks.has(node))continue;
        const t=uuidTime(id);if(t!==null){apply(node,t,'UUIDv7');continue;}
        if(catalog.sent.has(id)){const at=catalog.sent.get(id);if(at!==null)apply(node,at,'本机记录');continue;}
        if(!sentPending.has(id)){sentPending.add(id);need.push(id);}
      }
      function apply(node,ms,source){const text=stamp(ms);if(!text)return;node.setAttribute('data-amp-sent',text);node.title='发送于 '+fullStamp(ms)+' · '+source;sentMarks.set(node,ms);changed++;}
      if(need.length)void catalog.sentAt(need).then(()=>{for(const id of need)sentPending.delete(id);paint();});
      if(changed)log('debug','发送时间','标注 '+changed+' 条消息');
    }
    ui={host,entry,attach,render,view,show(){if(compact)expanded=true;else pref.open=true;persist();render();},toggle(){if(compact)expanded=!expanded;else pref.open=!pref.open;persist();render();},destroy(){clearTimeout(toastTimer);try{clearHeader();}catch{}for(const [a,m]of marks)restoreMark(a,m);marks.clear();clearSent();if(aliasSheet)document.adoptedStyleSheets=document.adoptedStyleSheets.filter(s=>s!==aliasSheet);aliasStyle?.remove();applySidebar(null);entry.remove();host.remove();gripHost.remove();foldHost.remove();}};render();
  }
  const mountAll=()=>{mount();mountBar();gachaUi.mount();};
  if(document.body)mountAll();else{const observer=new MutationObserver(()=>{if(document.body){observer.disconnect();mountAll();}});observer.observe(document.documentElement||document,{childList:true,subtree:true});}
  const routeTimer=setInterval(()=>{if(location.pathname!==lastRoute){lastRoute=location.pathname;paint();}ui?.attach();bar?.sync();},500);
  // 状态行里的倒计时与“已重置”切换需要定期重绘；回到前台时顺带刷新额度
  const statusTimer=setInterval(()=>{if(!document.hidden&&(prefs.showQuota||prefs.showCredits))paint();},30000);
  const onVisible=()=>{if(document.hidden)return;paint();if(Date.now()-(balance?.at||0)>BALANCE_INTERVAL)void refreshBalance();};document.addEventListener('visibilitychange',onVisible);
  const resize=()=>{ui?.attach();paint();};window.addEventListener('resize',resize);
  const flushAll=()=>{for(const r of runs.values())if(r.data)save(r.data);void catalog.flush();};window.addEventListener('pagehide',flushAll);
  function stop(){gacha.stop();gacha.setPaint(null);bar?.destroy();bar=null;legacyDisplay.onchange=null;stopped=true;onLog=null;onSnapshot=null;clearInterval(routeTimer);clearInterval(routeWatch);clearTimeout(paintTimer);for(const r of runs.values()){clearTimeout(r.timer);r.abort?.abort();r.token=null;}for(const reader of readers){try{reader.cancel().catch(()=>{});}catch{}}if(window.fetch===wrapped)window.fetch=native;if(XO?.open===xhrOpen)XO.open=oldOpen;if(XO?.send===xhrSend)XO.send=oldSend;if(window.EventSource===eventSource)window.EventSource=ES;window.removeEventListener('resize',resize);window.removeEventListener('pagehide',flushAll);window.removeEventListener('storage',onStorage);document.removeEventListener('visibilitychange',onVisible);clearInterval(statusTimer);clearTimeout(balanceTimer);clearTimeout(balanceResetTimer);for(const c of costState.values())clearTimeout(c.timer);ui?.destroy();catalog.destroy();}
  window.__AMP_LITE__={version:VERSION,stop,huntLive(){
    const r=selectedRun();
    const blocks=[quota.chat,quota.append].filter(q=>q?.blocked&&(!q.resetAt||q.resetAt>Date.now()));
    const blocked=Date.now()<cooldown?'接口限流冷却中':blocks.length?'消息额度或速率限制':balance?.remaining===0?'账户剩余额度为零':null;
    return {sid:r?.sid||null,runId:r?.runId||null,submittedAt:r?.submittedAt||0,busy:!!r?.busy,phase:r?.phase||'',finished:!!r?.huntFinishedAt,blocked,
      data:r?.data?{calls:r.data.calls.map(c=>({request:c.request,response:c.response,internal:c.internal})),internalNames:[...r.data.internalNames],partial:r.data.partial,routing:r.data.routing||null}:null,prompt:r.prompt||null};
  },show(){ui?.show();},snapshot:()=>JSON.parse(JSON.stringify(exported())),exportAll:withRaw=>catalog.exportAll(withRaw===true).then(x=>JSON.parse(JSON.stringify(x)))};
  setTimeout(()=>void refreshBalance(),4000);
  setTimeout(()=>void refreshPulse(),5000);setInterval(()=>{if(!document.hidden)void refreshPulse();},60000);
  gacha.bindCore({rawFetch,runFor,huntLive,clearLimits:()=>{quota={chat:null,append:null};store(KEY+'.quota',quota);cooldown=0;log('info','限流','已更换 IP，清除本地限流记录');paint();},usdQuota:()=>usd,note:(level,text)=>log(level,'看门狗',text)});
  // 账号切换（配套脚本 Arena-Account-Switch）：限流/脉冲/credits 属于账号，切换后丢弃旧状态并立即重新读取
  function accountReset(reason){
    try{
      quota={chat:null,append:null};store(KEY+'.quota',quota);
      usd=usdShape(load(KEY+'.usd',null));
      pulse=null;try{localStorage.removeItem(KEY+'.pulse');}catch{}
      balance=null;balanceFail=0;try{localStorage.removeItem(KEY+'.balance');}catch{}
      log('info','账号','检测到账号切换（'+reason+'），已清除旧账号的限流状态并重新读取脉冲与额度');paint();
      void refreshPulse(true);void refreshBalance(true);
    }catch(e){log('warn','账号','刷新账号状态失败',e);}
  }
  window.addEventListener('amp:account',()=>accountReset('登录账号变化'));
  try{if(localStorage.getItem('amp.account.dirty')){localStorage.removeItem('amp.account.dirty');setTimeout(()=>accountReset('切换后首次加载'),800);}}catch{}
  window.__AMP_LITE__.gacha={start:r=>gacha.start(!!r),stop:gacha.stop,state:gacha.state,settings:gacha.settings,followModel:gacha.followModel};window.__AMP_LITE__.usd=()=>usd?{...usd}:null;window.__AMP_LITE__.pulse=()=>pulse?{...pulse}:null;
  log('debug','初始化','v'+VERSION+' 已就绪');
  // 存储自检：写入/读回一个测试键，失败时在日志里给出明确提示（保存无效的常见原因：存储已满、隐私模式、站点数据被清理）。
  try{const t='amp.selftest',v=String(Date.now()),ok=ampStore.set(t,v)&&localStorage.getItem(t)===v;try{localStorage.removeItem(t);}catch{}const u=ampStore.usage();log(ok?'debug':'info','存储',(ok?'本地存储正常':'本地存储不可写，设置将无法保存')+' · 已用约 '+Math.round(u.total/1024)+' KB（本脚本 '+Math.round(u.ours/1024)+' KB）');}catch{}
})();

})();
