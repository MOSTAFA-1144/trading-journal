/* ============================================================
   تدوين صفقاتي | Main Application Logic
   ============================================================ */

'use strict';

// ============================================================
// STATE
// ============================================================
let state = {
    accounts: [],
    trades: [],
    editingTradeId: null,
    editingAccountId: null,
    // Sorting & Pagination state
    sortColumn: 'date',
    sortDirection: 'desc',
    currentPage: 1,
    itemsPerPage: 50,
};

// ============================================================
// DATA SYNC (Supabase)
// ============================================================
async function loadState() {
    const user = authCurrentUser();
    if (!user) {
        state.accounts = [];
        state.trades = [];
        return;
    }

    try {
        const [accRes, trRes] = await Promise.all([
            db.from('accounts').select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
            db.from('trades').select('*').eq('user_id', user.id).order('created_at', { ascending: true })
        ]);

        if (accRes.error) throw accRes.error;
        if (trRes.error) throw trRes.error;

        // Map DB fields back to camelCase state
        state.accounts = (accRes.data || []).map(a => ({
            id: a.id,
            name: a.name,
            type: a.type,
            initialBalance: Number(a.initial_balance),
            notes: a.notes,
            createdAt: a.created_at
        }));

        state.trades = (trRes.data || []).map(t => ({
            id: t.id,
            accountId: t.account_id,
            title: t.title,
            direction: t.direction,
            date: t.date,
            entry: Number(t.entry),
            exit: t.exit_price ? Number(t.exit_price) : null,
            target: t.target ? Number(t.target) : null,
            stop: t.stop ? Number(t.stop) : null,
            lot: Number(t.lot),
            pnl: t.pnl !== null ? Number(t.pnl) : null,
            pipTP: t.pip_tp !== null ? Number(t.pip_tp) : null,
            pipSL: t.pip_sl !== null ? Number(t.pip_sl) : null,
            result: t.result,
            notes: t.notes,
            image: t.image,
            createdAt: t.created_at
        }));
    } catch (err) {
        console.error('Error loading data from Supabase:', err);
        showToast('❌ حدث خطأ أثناء جلب البيانات');
        state.accounts = [];
        state.trades = [];
    }
}

// ============================================================
// HELPERS
// ============================================================
function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmt(num, decimals = 2) {
    if (num === null || num === undefined || num === '') return '—';
    return Number(num).toFixed(decimals);
}

function fmtMoney(val) {
    if (val === null || val === undefined || val === '') return '—';
    const n = Number(val);
    const sign = n > 0 ? '+' : '';
    return sign + '$' + n.toFixed(2);
}

function calcPnL(direction, entry, exit, lot) {
    if (!exit || !entry || !lot) return null;
    const diff = direction === 'شراء' ? (exit - entry) : (entry - exit);
    return diff * lot * 100;
}

function calcPipTP(direction, entry, target) {
    if (!target || !entry) return null;
    const diff = direction === 'شراء' ? (target - entry) : (entry - target);
    return Math.round(diff * 10 * 10) / 10;
}

function calcPipSL(direction, entry, stop) {
    if (!stop || !entry) return null;
    const diff = direction === 'شراء' ? (entry - stop) : (stop - entry);
    return Math.round(diff * 10 * 10) / 10;
}

function getResult(pnl) {
    if (pnl === null || pnl === undefined) return null;
    if (pnl > 0) return 'ربح';
    if (pnl < 0) return 'خسارة';
    return 'تعادل';
}

function resultBadge(result) {
    if (!result) return '<span class="pnl-zero">—</span>';
    if (result === 'ربح') return '<span class="badge badge-win">🟢 ربح</span>';
    if (result === 'خسارة') return '<span class="badge badge-loss">🔴 خسارة</span>';
    return '<span class="badge badge-even">⚪ تعادل</span>';
}

function dirBadge(dir) {
    if (!dir) return '—';
    if (dir === 'شراء') return `<span class="dir-buy">📈 شراء</span>`;
    return `<span class="dir-sell">📉 بيع</span>`;
}

function pnlClass(pnl) {
    if (!pnl && pnl !== 0) return 'pnl-zero';
    return pnl > 0 ? 'pnl-pos' : pnl < 0 ? 'pnl-neg' : 'pnl-zero';
}

function accountTypeClass(type) {
    return 'type-' + (type || '').replace(/\s/g, '-');
}

function accountTypeBadgeClass(type) {
    return 'type-badge-' + (type || '').replace(/\s/g, '-');
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return dateStr; }
}

function accountById(id) {
    return state.accounts.find(a => a.id === id);
}

function tradesByAccount(accountId) {
    return state.trades.filter(t => t.accountId === accountId);
}

// ============================================================
// SIDEBAR & NAVIGATION
// ============================================================
function switchPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const pageEl = document.getElementById('page-' + page);
    const navEl = document.getElementById('nav-' + page);

    if (pageEl) pageEl.classList.add('active');
    if (navEl) navEl.classList.add('active');

    const titles = {
        dashboard: 'لوحة التحكم',
        accounts: 'الحسابات',
        trades: 'جدول الصفقات',
        gallery: 'معرض البطاقات',
        stats: 'الإحصائيات',
        admin: '👑 إدارة المستخدمين',
    };
    document.getElementById('topbarTitle').textContent = titles[page] || '';

    // Show/hide quick-add button (not relevant on admin page)
    const quickBtn = document.getElementById('quickAddBtn');
    if (quickBtn) quickBtn.style.display = page === 'admin' ? 'none' : '';

    // Render the page
    if (page === 'dashboard') renderDashboard();
    if (page === 'accounts') renderAccountsPage();
    if (page === 'trades') renderTradesTable();
    if (page === 'gallery') { populateGalleryFilters(); renderGallery(); }
    if (page === 'stats') renderStats();
    if (page === 'admin') adminRenderUsersPage();
}

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

document.getElementById('sidebarToggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const main = document.getElementById('mainContent');
    sidebar.classList.toggle('collapsed');
    main.classList.toggle('sidebar-collapsed');
});

document.getElementById('menuBtn').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    sidebar.classList.toggle('mobile-open');
    document.getElementById('mainContent').classList.toggle('sidebar-collapsed');
});

// ============================================================
// ACCOUNT MODAL
// ============================================================
function openAccountModal(id) {
    state.editingAccountId = id || null;
    const form = document.getElementById('accountForm');
    form.reset();

    if (id) {
        const acc = accountById(id);
        if (acc) {
            document.getElementById('a_name').value = acc.name;
            document.getElementById('a_type').value = acc.type;
            document.getElementById('a_balance').value = acc.initialBalance;
            document.getElementById('a_notes').value = acc.notes || '';
            document.getElementById('accountModalTitle').textContent = '✏️ تعديل الحساب';
        }
    } else {
        document.getElementById('accountModalTitle').textContent = '💼 إضافة حساب جديد';
    }

    document.getElementById('accountModalOverlay').classList.add('active');
}

function closeAccountModal() {
    document.getElementById('accountModalOverlay').classList.remove('active');
    state.editingAccountId = null;
}

async function saveAccount(e) {
    e.preventDefault();
    const user = authCurrentUser();
    if (!user) return;

    const name = document.getElementById('a_name').value.trim();
    const type = document.getElementById('a_type').value;
    const balance = parseFloat(document.getElementById('a_balance').value);
    const notes = document.getElementById('a_notes').value.trim();

    if (!name || !type || isNaN(balance)) { showToast('⚠️ يرجى ملء جميع الحقول المطلوبة'); return; }

    const btn = e.target.querySelector('button[type="submit"]');
    const origText = btn.textContent;
    btn.textContent = 'جارٍ الحفظ...';
    btn.disabled = true;

    try {
        let accountId = state.editingAccountId;
        const dbPayload = {
            user_id: user.id,
            name,
            type,
            initial_balance: balance,
            notes
        };

        if (accountId) {
            const { error } = await db.from('accounts').update(dbPayload).eq('id', accountId);
            if (error) throw error;
            showToast('✅ تم تحديث الحساب بنجاح');
        } else {
            accountId = uid();
            dbPayload.id = accountId;
            const { error } = await db.from('accounts').insert([dbPayload]);
            if (error) throw error;
            showToast('✅ تم إضافة الحساب بنجاح');
        }

        await loadState();
        closeAccountModal();
        populateAccountFilters();
        renderDashboard();
        renderAccountsPage();
    } catch (err) {
        console.error(err);
        showToast('❌ حدث خطأ أثناء الحفظ');
    } finally {
        btn.textContent = origText;
        btn.disabled = false;
    }
}

async function deleteAccount(id) {
    if (!confirm('هل أنت متأكد من حذف هذا الحساب؟ سيتم حذف جميع صفقاته أيضاً.')) return;
    
    try {
        const { error } = await db.from('accounts').delete().eq('id', id);
        if (error) throw error;
        
        await loadState();
        populateAccountFilters();
        renderDashboard();
        renderAccountsPage();
        showToast('🗑️ تم حذف الحساب');
    } catch (err) {
        console.error(err);
        showToast('❌ حدث خطأ أثناء الحذف');
    }
}

// ============================================================
// TRADE MODAL
// ============================================================
function openTradeModal(id) {
    state.editingTradeId = id || null;
    const form = document.getElementById('tradeForm');
    form.reset();

    // Set today's date
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('t_date').value = today;

    if (id) {
        const tr = state.trades.find(t => t.id === id);
        if (tr) {
            document.getElementById('t_title').value = tr.title;
            document.getElementById('t_account').value = tr.accountId;
            document.getElementById('t_direction').value = tr.direction;
            document.getElementById('t_date').value = tr.date;
            document.getElementById('t_entry').value = tr.entry;
            document.getElementById('t_exit').value = tr.exit || '';
            document.getElementById('t_target').value = tr.target || '';
            document.getElementById('t_stop').value = tr.stop || '';
            document.getElementById('t_lot').value = tr.lot;
            document.getElementById('t_notes').value = tr.notes || '';
            document.getElementById('tradeModalTitle').textContent = '✏️ تعديل الصفقة';
        }
    } else {
        document.getElementById('tradeModalTitle').textContent = '➕ إضافة صفقة جديدة';
    }

    // Auto-title
    document.getElementById('t_direction').addEventListener('change', updateAutoTitle, { once: false });
    document.getElementById('t_date').addEventListener('change', updateAutoTitle, { once: false });

    updateCalcPreview();
    document.getElementById('tradeModalOverlay').classList.add('active');
}

function updateAutoTitle() {
    const dir = document.getElementById('t_direction').value;
    const date = document.getElementById('t_date').value;
    const titleEl = document.getElementById('t_title');
    if (!state.editingTradeId && dir && date) {
        titleEl.value = (dir === 'شراء' ? 'شراء' : 'بيع') + ' ذهب ' + date;
    }
}

function closeTradeModal() {
    document.getElementById('tradeModalOverlay').classList.remove('active');
    state.editingTradeId = null;
}

// Live calc preview
['t_direction', 't_entry', 't_exit', 't_target', 't_stop', 't_lot'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateCalcPreview);
    document.getElementById(id)?.addEventListener('change', updateCalcPreview);
});

function updateCalcPreview() {
    const dir = document.getElementById('t_direction').value;
    const entry = parseFloat(document.getElementById('t_entry').value);
    const exit = parseFloat(document.getElementById('t_exit').value);
    const target = parseFloat(document.getElementById('t_target').value);
    const stop = parseFloat(document.getElementById('t_stop').value);
    const lot = parseFloat(document.getElementById('t_lot').value);

    const pnl = calcPnL(dir, entry, exit, lot);
    const pipTP = calcPipTP(dir, entry, target);
    const pipSL = calcPipSL(dir, entry, stop);
    const result = getResult(pnl);

    document.getElementById('prev_pipTP').textContent = pipTP !== null ? pipTP + ' pip' : '—';
    document.getElementById('prev_pipSL').textContent = pipSL !== null ? pipSL + ' pip' : '—';
    document.getElementById('prev_pnl').textContent = pnl !== null ? fmtMoney(pnl) : '—';
    document.getElementById('prev_result').textContent = result ? (result === 'ربح' ? '🟢 ربح' : result === 'خسارة' ? '🔴 خسارة' : '⚪ تعادل') : '—';

    // Color PnL
    const pnlEl = document.getElementById('prev_pnl');
    pnlEl.className = pnlClass(pnl);
}

async function saveTrade(e) {
    e.preventDefault();
    const user = authCurrentUser();
    if (!user) return;

    const title = document.getElementById('t_title').value.trim();
    const accountId = document.getElementById('t_account').value;
    const direction = document.getElementById('t_direction').value;
    const date = document.getElementById('t_date').value;
    const entry = parseFloat(document.getElementById('t_entry').value);
    const exit = parseFloat(document.getElementById('t_exit').value) || null;
    const target = parseFloat(document.getElementById('t_target').value) || null;
    const stop = parseFloat(document.getElementById('t_stop').value) || null;
    const lot = parseFloat(document.getElementById('t_lot').value);
    const notes = document.getElementById('t_notes').value.trim();
    const imgFile = document.getElementById('t_image').files[0];

    if (!title || !accountId || !direction || !date || isNaN(entry) || isNaN(lot)) {
        showToast('⚠️ يرجى ملء جميع الحقول المطلوبة'); return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    const origText = btn.textContent;
    btn.textContent = 'جارٍ الحفظ...';
    btn.disabled = true;

    try {
        const pnl = calcPnL(direction, entry, exit, lot);
        const pipTP = calcPipTP(direction, entry, target);
        const pipSL = calcPipSL(direction, entry, stop);
        const result = getResult(pnl);

        // Handle image (base64 string for now, could be Supabase Storage layer)
        let imageDataUrl = null;
        if (imgFile) {
            imageDataUrl = await fileToBase64(imgFile);
        }

        let tradeId = state.editingTradeId;

        const dbPayload = {
            user_id: user.id,
            account_id: accountId,
            title,
            direction,
            date,
            entry,
            exit_price: exit,
            target,
            stop,
            lot,
            notes,
            pnl,
            pip_tp: pipTP,
            pip_sl: pipSL,
            result
        };
        if (imageDataUrl) dbPayload.image = imageDataUrl;

        if (tradeId) {
            // keep old image if not uploading new one
            if (!imageDataUrl) {
                const existing = state.trades.find(t => t.id === tradeId);
                if (existing && existing.image) dbPayload.image = existing.image;
            }
            const { error } = await db.from('trades').update(dbPayload).eq('id', tradeId);
            if (error) throw error;
            showToast('✅ تم تحديث الصفقة بنجاح');
        } else {
            tradeId = uid();
            dbPayload.id = tradeId;
            const { error } = await db.from('trades').insert([dbPayload]);
            if (error) throw error;
            showToast('✅ تم تسجيل الصفقة بنجاح');
        }

        await loadState();
        closeTradeModal();
        renderDashboard();
        renderTradesTable();
        renderGallery();
        renderStats();
    } catch (err) {
        console.error(err);
        showToast('❌ حدث خطأ أثناء الحفظ');
    } finally {
        btn.textContent = origText;
        btn.disabled = false;
    }
}

async function deleteTrade(id) {
    if (!confirm('هل أنت متأكد من حذف هذه الصفقة؟')) return;
    
    try {
        const { error } = await db.from('trades').delete().eq('id', id);
        if (error) throw error;
        
        await loadState();
        renderDashboard();
        renderTradesTable();
        renderGallery();
        renderStats();
        showToast('🗑️ تم حذف الصفقة');
    } catch (err) {
        console.error(err);
        showToast('❌ حدث خطأ أثناء الحذف');
    }
}

function fileToBase64(file) {
    return new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
    });
}

// ============================================================
// VIEW TRADE MODAL
// ============================================================
function viewTrade(id) {
    const tr = state.trades.find(t => t.id === id);
    if (!tr) return;
    const acc = accountById(tr.accountId);

    let html = `<div class="view-trade-grid">`;
    const fields = [
        ['عنوان الصفقة', tr.title],
        ['الحساب', acc ? acc.name : '—'],
        ['الاتجاه', tr.direction === 'شراء' ? '📈 شراء (Long)' : '📉 بيع (Short)'],
        ['تاريخ الصفقة', formatDate(tr.date)],
        ['سعر الدخول', tr.entry ? fmt(tr.entry) : '—'],
        ['سعر الخروج', tr.exit ? fmt(tr.exit) : '—'],
        ['سعر الهدف (TP)', tr.target ? fmt(tr.target) : '—'],
        ['سعر الستوب (SL)', tr.stop ? fmt(tr.stop) : '—'],
        ['حجم العقد (لوت)', tr.lot],
        ['PIP الهدف', tr.pipTP !== null && tr.pipTP !== undefined ? tr.pipTP + ' pip' : '—'],
        ['PIP الستوب', tr.pipSL !== null && tr.pipSL !== undefined ? tr.pipSL + ' pip' : '—'],
        ['الربح / الخسارة', fmtMoney(tr.pnl)],
    ];

    fields.forEach(([label, val]) => {
        html += `<div class="view-field"><div class="view-label">${label}</div><div class="view-val">${val}</div></div>`;
    });

    html += `</div>`;

    if (tr.image) {
        html += `<img src="${tr.image}" alt="شارت الصفقة" class="view-chart-img" />`;
    }

    if (tr.notes) {
        html += `<div class="view-notes">📝 ${tr.notes}</div>`;
    }

    document.getElementById('viewTradeTitle').textContent = tr.title;
    document.getElementById('viewTradeContent').innerHTML = html;
    document.getElementById('viewModalOverlay').classList.add('active');
}

function closeViewModal() {
    document.getElementById('viewModalOverlay').classList.remove('active');
}

// ============================================================
// POPULATE SELECTS
// ============================================================
function populateAccountFilters() {
    const selects = ['t_account', 'filterAccount', 'galleryFilterAccount'];
    selects.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const currentVal = el.value;
        // Keep first option
        while (el.options.length > 1) el.remove(1);
        state.accounts.forEach(acc => {
            const opt = new Option(acc.name, acc.id);
            el.add(opt);
        });
        el.value = currentVal;
    });
}

function populateGalleryFilters() {
    populateAccountFilters();
}

// ============================================================
// RENDER DASHBOARD
// ============================================================
function renderDashboard() {
    const trades = state.trades;
    const accounts = state.accounts;

    const totalTrades = trades.length;
    const closedTrades = trades.filter(t => t.pnl !== null && t.pnl !== undefined);
    const winTrades = closedTrades.filter(t => t.pnl > 0).length;
    const lossTrades = closedTrades.filter(t => t.pnl < 0).length;
    const netPnL = closedTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    const winRate = closedTrades.length ? Math.round((winTrades / closedTrades.length) * 100) : 0;

    document.getElementById('kpi-totalTrades').textContent = totalTrades;
    document.getElementById('kpi-winTrades').textContent = winTrades;
    document.getElementById('kpi-lossTrades').textContent = lossTrades;
    document.getElementById('kpi-netPnL').textContent = fmtMoney(netPnL);
    document.getElementById('kpi-winRate').textContent = winRate + '%';
    document.getElementById('kpi-accountsCount').textContent = accounts.length;

    // Color net PnL
    const pnlEl = document.getElementById('kpi-netPnL');
    pnlEl.className = 'kpi-value ' + pnlClass(netPnL);

    // Recent trades (last 6)
    const recent = [...trades].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);
    renderTradeRows('recentTradesBody', recent, true);

    // Accounts mini
    const grid = document.getElementById('dashAccountsGrid');
    if (!accounts.length) {
        grid.innerHTML = '<div class="empty-accounts">لا توجد حسابات بعد. <a href="#" onclick="openAccountModal()" style="color:var(--gold)">أضف حساباً الآن</a></div>';
        return;
    }
    grid.className = 'accounts-grid';
    grid.innerHTML = accounts.map(acc => {
        const accTrades = tradesByAccount(acc.id);
        const closed = accTrades.filter(t => t.pnl !== null && t.pnl !== undefined);
        const net = closed.reduce((s, t) => s + (t.pnl || 0), 0);
        const wins = closed.filter(t => t.pnl > 0).length;
        return `
    <div class="dash-account-card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="dash-account-name">${acc.name}</span>
        <span class="account-type-badge ${accountTypeBadgeClass(acc.type)}">${acc.type}</span>
      </div>
      <div class="dash-account-meta">
        <span style="font-size:.78rem;color:var(--text-secondary)">صفقات: <b>${accTrades.length}</b></span>
        <span style="font-size:.78rem;color:var(--text-secondary)">رابحة: <b style="color:var(--green)">${wins}</b></span>
        <span style="font-size:.78rem" class="${pnlClass(net)}">P&L: <b>${fmtMoney(net)}</b></span>
      </div>
    </div>`;
    }).join('');
}

// ============================================================
// RENDER TRADES TABLE ROWS
// ============================================================
function renderTradeRows(tbodyId, trades, minimal) {
    const tbody = document.getElementById(tbodyId);
    if (!trades.length) {
        tbody.innerHTML = `<tr><td colspan="${minimal ? 8 : 15}" class="empty-row">لا توجد صفقات مسجلة</td></tr>`;
        return;
    }

    tbody.innerHTML = trades.map((tr, i) => {
        const acc = accountById(tr.accountId);
        if (minimal) {
            return `<tr onclick="viewTrade('${tr.id}')" style="cursor:pointer">
        <td class="mono">${tr.title}</td>
        <td>${formatDate(tr.date)}</td>
        <td>${acc ? acc.name : '—'}</td>
        <td>${dirBadge(tr.direction)}</td>
        <td class="mono">${fmt(tr.entry)}</td>
        <td class="mono">${tr.exit ? fmt(tr.exit) : '—'}</td>
        <td class="${pnlClass(tr.pnl)}">${tr.pnl !== null && tr.pnl !== undefined ? fmtMoney(tr.pnl) : '—'}</td>
        <td>${resultBadge(tr.result)}</td>
      </tr>`;
        }
        return `<tr>
      <td class="mono" style="color:var(--text-muted)">${i + 1}</td>
      <td style="cursor:pointer;color:var(--gold)" onclick="viewTrade('${tr.id}')">${tr.title}</td>
      <td>${formatDate(tr.date)}</td>
      <td>${acc ? acc.name : '—'}</td>
      <td>${dirBadge(tr.direction)}</td>
      <td class="mono">${fmt(tr.entry)}</td>
      <td class="mono">${tr.exit ? fmt(tr.exit) : '—'}</td>
      <td class="mono">${tr.target ? fmt(tr.target) : '—'}</td>
      <td class="mono">${tr.stop ? fmt(tr.stop) : '—'}</td>
      <td class="mono">${tr.lot}</td>
      <td class="mono">${tr.pipTP !== null && tr.pipTP !== undefined ? tr.pipTP : '—'}</td>
      <td class="mono">${tr.pipSL !== null && tr.pipSL !== undefined ? tr.pipSL : '—'}</td>
      <td class="${pnlClass(tr.pnl)}">${tr.pnl !== null && tr.pnl !== undefined ? fmtMoney(tr.pnl) : '—'}</td>
      <td>${resultBadge(tr.result)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn-edit" onclick="openTradeModal('${tr.id}')">✏️</button>
          <button class="btn-danger" onclick="deleteTrade('${tr.id}')">🗑️</button>
        </div>
      </td>
    </tr>`;
    }).join('');
}

// ============================================================
// PAGINATION & SORTING HELPERS
// ============================================================
function handleSort(column) {
    if (state.sortColumn === column) {
        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        state.sortColumn = column;
        state.sortDirection = 'desc'; // Default to descending on first click
    }
    
    // Always go back to page 1 when sort changes
    state.currentPage = 1;
    
    // Update headers UI
    document.querySelectorAll('.sortable').forEach(th => {
        th.classList.remove('active-sort');
        const icon = th.querySelector('.sort-icon');
        if (icon) icon.textContent = '';
    });
    
    const ths = document.querySelectorAll('.sortable');
    for (const th of ths) {
        if (th.getAttribute('onclick').includes(`'${column}'`)) {
            th.classList.add('active-sort');
            const icon = th.querySelector('.sort-icon');
            if (icon) icon.textContent = state.sortDirection === 'asc' ? '▲' : '▼';
            break;
        }
    }
    
    renderTradesTable();
}

function prevPage() {
    if (state.currentPage > 1) {
        state.currentPage--;
        renderTradesTable();
    }
}

function nextPage() {
    const filterAccount = document.getElementById('filterAccount')?.value || '';
    const dirFilter = document.getElementById('filterDirection')?.value || '';
    const resFilter = document.getElementById('filterResult')?.value || '';
    
    let tp = state.trades.length; // rough estimate, will be exact in render
    const maxPage = Math.ceil(tp / state.itemsPerPage) || 1;
    
    if (state.currentPage < maxPage) {
        state.currentPage++;
        renderTradesTable();
    }
}

function goToPage(page) {
    state.currentPage = page;
    renderTradesTable();
}

function updatePaginationUI(totalItems) {
    const totalPages = Math.ceil(totalItems / state.itemsPerPage) || 1;
    
    // Ensure current page is valid
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;
    
    document.getElementById('currentPageNum').textContent = state.currentPage;
    document.getElementById('totalPagesNum').textContent = totalPages;
    document.getElementById('totalItemsNum').textContent = totalItems;
    
    const btnPrev = document.getElementById('btnPrevPage');
    const btnNext = document.getElementById('btnNextPage');
    
    if (btnPrev) btnPrev.disabled = state.currentPage === 1;
    if (btnNext) btnNext.disabled = state.currentPage === totalPages;
    
    // Build page numbers
    const pageNumContainer = document.getElementById('pageNumbers');
    if (!pageNumContainer) return;
    
    let html = '';
    
    // Show max 5 page buttons to prevent overflowing
    let startPage = Math.max(1, state.currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }
    
    if (startPage > 1) {
        html += `<button class="page-btn" onclick="goToPage(1)">1</button>`;
        if (startPage > 2) html += `<span style="align-self:end;margin:0 2px">...</span>`;
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn ${i === state.currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += `<span style="align-self:end;margin:0 2px">...</span>`;
        html += `<button class="page-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
    }
    
    pageNumContainer.innerHTML = html;
}

// ============================================================
// RENDER FULL TRADES TABLE
// ============================================================
function renderTradesTable() {
    const accFilter = document.getElementById('filterAccount')?.value || '';
    const dirFilter = document.getElementById('filterDirection')?.value || '';
    const resFilter = document.getElementById('filterResult')?.value || '';

    let trades = [...state.trades];

    if (accFilter) trades = trades.filter(t => t.accountId === accFilter);
    if (dirFilter) trades = trades.filter(t => t.direction === dirFilter);
    if (resFilter) trades = trades.filter(t => t.result === resFilter);

    // Apply Sorting
    trades.sort((a, b) => {
        let valA, valB;
        
        switch (state.sortColumn) {
            case 'title': valA = a.title; valB = b.title; break;
            case 'date': valA = new Date(a.date).getTime(); valB = new Date(b.date).getTime(); break;
            case 'account': 
                const accA = accountById(a.accountId); const accB = accountById(b.accountId);
                valA = accA ? accA.name : ''; valB = accB ? accB.name : ''; break;
            case 'direction': valA = a.direction; valB = b.direction; break;
            case 'entry': valA = a.entry; valB = b.entry; break;
            case 'exit': valA = a.exit || 0; valB = b.exit || 0; break;
            case 'lot': valA = a.lot; valB = b.lot; break;
            case 'pipTP': valA = a.pipTP || 0; valB = b.pipTP || 0; break;
            case 'pipSL': valA = a.pipSL || 0; valB = b.pipSL || 0; break;
            case 'pnl': valA = a.pnl || 0; valB = b.pnl || 0; break;
            case 'result': valA = a.result || ''; valB = b.result || ''; break;
            default: valA = new Date(a.date).getTime(); valB = new Date(b.date).getTime();
        }
        
        if (typeof valA === 'string' && typeof valB === 'string') {
            return state.sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else {
            return state.sortDirection === 'asc' ? (valA - valB) : (valB - valA);
        }
    });

    const totalItems = trades.length;
    
    // Update Pagination UI before slicing
    updatePaginationUI(totalItems);

    // Apply Pagination Slicing
    const startIndex = (state.currentPage - 1) * state.itemsPerPage;
    const endIndex = startIndex + state.itemsPerPage;
    const slicedTrades = trades.slice(startIndex, endIndex);

    renderTradeRows('tradesTableBody', slicedTrades, false);
}

// ============================================================
// RENDER ACCOUNTS PAGE
// ============================================================
function renderAccountsPage() {
    const grid = document.getElementById('accountsFullGrid');
    if (!state.accounts.length) {
        grid.innerHTML = `<div class="empty-state">
      <span class="empty-icon">💼</span>
      <p>لا توجد حسابات بعد</p>
      <button class="btn-primary" onclick="openAccountModal()">أضف حسابك الأول</button>
    </div>`;
        return;
    }

    grid.innerHTML = state.accounts.map(acc => {
        const accTrades = tradesByAccount(acc.id);
        const closed = accTrades.filter(t => t.pnl !== null && t.pnl !== undefined);
        const net = closed.reduce((s, t) => s + (t.pnl || 0), 0);
        const wins = closed.filter(t => t.pnl > 0).length;
        const losses = closed.filter(t => t.pnl < 0).length;
        const winRate = closed.length ? Math.round((wins / closed.length) * 100) : 0;
        const currentBalance = acc.initialBalance + net;

        return `
    <div class="account-card ${accountTypeClass(acc.type)}">
      <div class="account-header">
        <div class="account-name">${acc.name}</div>
        <span class="account-type-badge ${accountTypeBadgeClass(acc.type)}">${acc.type}</span>
      </div>
      <div class="account-stats">
        <div class="account-stat-row">
          <span class="account-stat-label">الرصيد الأولي</span>
          <span class="account-stat-val">$${fmt(acc.initialBalance)}</span>
        </div>
        <div class="account-stat-row">
          <span class="account-stat-label">الرصيد الحالي</span>
          <span class="account-stat-val ${pnlClass(currentBalance - acc.initialBalance)}">$${fmt(currentBalance)}</span>
        </div>
        <div class="account-stat-row">
          <span class="account-stat-label">صافي الربح / الخسارة</span>
          <span class="account-stat-val ${pnlClass(net)}">${fmtMoney(net)}</span>
        </div>
        <div class="account-stat-row">
          <span class="account-stat-label">إجمالي الصفقات</span>
          <span class="account-stat-val">${accTrades.length}</span>
        </div>
        <div class="account-stat-row">
          <span class="account-stat-label">رابحة / خاسرة</span>
          <span class="account-stat-val"><span style="color:var(--green)">${wins}</span> / <span style="color:var(--red)">${losses}</span></span>
        </div>
        <div class="account-stat-row">
          <span class="account-stat-label">نسبة الفوز</span>
          <span class="account-stat-val ${wins > losses ? 'pnl-pos' : 'pnl-neg'}">${winRate}%</span>
        </div>
      </div>
      ${acc.notes ? `<div style="font-size:.8rem;color:var(--text-muted);border-top:1px solid var(--border);padding-top:10px">📝 ${acc.notes}</div>` : ''}
      <div class="account-actions">
        <button class="btn-edit" onclick="openAccountModal('${acc.id}')">✏️ تعديل</button>
        <button class="btn-danger" onclick="deleteAccount('${acc.id}')">🗑️ حذف</button>
        <button class="btn-ghost" style="margin-right:auto;font-size:.78rem" onclick="switchPage('trades');document.getElementById('filterAccount').value='${acc.id}';renderTradesTable()">عرض الصفقات ←</button>
      </div>
    </div>`;
    }).join('');
}

// ============================================================
// RENDER GALLERY
// ============================================================
function renderGallery() {
    const accFilter = document.getElementById('galleryFilterAccount')?.value || '';
    const resFilter = document.getElementById('galleryFilterResult')?.value || '';

    let trades = [...state.trades].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (accFilter) trades = trades.filter(t => t.accountId === accFilter);
    if (resFilter) trades = trades.filter(t => t.result === resFilter);

    const grid = document.getElementById('galleryGrid');
    if (!trades.length) {
        grid.innerHTML = `<div class="empty-state"><span class="empty-icon">🖼️</span><p>لا توجد صفقات للعرض</p></div>`;
        return;
    }

    grid.innerHTML = trades.map(tr => {
        const acc = accountById(tr.accountId);
        const imgHtml = tr.image
            ? `<img src="${tr.image}" alt="شارت" class="gallery-img" />`
            : `<div class="gallery-img-placeholder">${tr.direction === 'شراء' ? '📈' : '📉'}</div>`;

        return `
    <div class="gallery-card" onclick="viewTrade('${tr.id}')">
      ${imgHtml}
      <div class="gallery-body">
        <div class="gallery-title">${tr.title}</div>
        <div class="gallery-meta">
          <span class="gallery-tag">${formatDate(tr.date)}</span>
          <span class="gallery-tag">${acc ? acc.name : '—'}</span>
          <span class="gallery-tag ${tr.direction === 'شراء' ? 'dir-buy' : 'dir-sell'}">${tr.direction === 'شراء' ? '📈 شراء' : '📉 بيع'}</span>
          ${tr.lot ? `<span class="gallery-tag">لوت: ${tr.lot}</span>` : ''}
        </div>
        <div class="gallery-pnl">
          ${resultBadge(tr.result)}
          <span class="${pnlClass(tr.pnl)}" style="font-family:var(--font-mono);font-weight:800;font-size:1rem">
            ${tr.pnl !== null && tr.pnl !== undefined ? fmtMoney(tr.pnl) : '—'}
          </span>
        </div>
      </div>
    </div>`;
    }).join('');
}

// ============================================================
// RENDER STATS & CHARTS
// ============================================================
let equityChartInstance = null;
let monthlyChartInstance = null;

function renderStats() {
    // Filters
    const accFilter = document.getElementById('statsFilterAccount')?.value || '';
    const periodFilter = document.getElementById('statsFilterPeriod')?.value || '0';

    // Show/hide custom date range pickers
    const customDateContainer = document.getElementById('customDateRange');
    if (periodFilter === 'custom') {
        customDateContainer.style.display = 'flex';
    } else {
        customDateContainer.style.display = 'none';
        document.getElementById('statsStartDate').value = '';
        document.getElementById('statsEndDate').value = '';
    }

    // Populate stats account filter dropdown
    const statsAccSel = document.getElementById('statsFilterAccount');
    if (statsAccSel) {
        const cur = statsAccSel.value;
        while (statsAccSel.options.length > 1) statsAccSel.remove(1);
        state.accounts.forEach(acc => statsAccSel.add(new Option(acc.name, acc.id)));
        statsAccSel.value = cur || accFilter;
    }

    let trades = [...state.trades];
    if (accFilter) trades = trades.filter(t => t.accountId === accFilter);
    
    if (periodFilter === 'custom') {
        const startDateStr = document.getElementById('statsStartDate').value;
        const endDateStr = document.getElementById('statsEndDate').value;
        
        if (startDateStr) {
            const startStr = startDateStr + "T00:00:00";
            const startTup = new Date(startStr).getTime();
            trades = trades.filter(t => new Date(t.date).getTime() >= startTup);
        }
        if (endDateStr) {
            const endStr = endDateStr + "T23:59:59";
            const endTup = new Date(endStr).getTime();
            trades = trades.filter(t => new Date(t.date).getTime() <= endTup);
        }
    } else if (parseInt(periodFilter) > 0) {
        const days = parseInt(periodFilter);
        const cutoff = new Date(Date.now() - days * 86400000);
        trades = trades.filter(t => new Date(t.date) >= cutoff);
    }

    const closed = trades.filter(t => t.pnl !== null && t.pnl !== undefined);
    const wins = closed.filter(t => t.pnl > 0);
    const losses = closed.filter(t => t.pnl < 0);
    const evens = closed.filter(t => t.pnl === 0);
    const netTotal = closed.reduce((s, t) => s + (t.pnl || 0), 0);

    const winRate = closed.length ? Math.round((wins.length / closed.length) * 100) : 0;
    const lossRate = closed.length ? Math.round((losses.length / closed.length) * 100) : 0;
    const evenRate = closed.length ? Math.round((evens.length / closed.length) * 100) : 0;
    const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
    const avgPnL = closed.length ? netTotal / closed.length : 0;
    const avgLot = trades.length ? (trades.reduce((s, t) => s + (t.lot || 0), 0) / trades.length).toFixed(2) : '—';

    const totalWinAmt = wins.reduce((s, t) => s + t.pnl, 0);
    const totalLossAmt = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = totalLossAmt > 0 ? (totalWinAmt / totalLossAmt).toFixed(2)
        : wins.length ? '\u221e' : '—';

    const bestTr = closed.length ? closed.reduce((a, b) => a.pnl > b.pnl ? a : b) : null;
    const worstTr = closed.length ? closed.reduce((a, b) => a.pnl < b.pnl ? a : b) : null;

    // PIP stats
    const withTP = closed.filter(t => t.pipTP !== null && t.pipTP !== undefined);
    const withSL = closed.filter(t => t.pipSL !== null && t.pipSL !== undefined);
    const avgPipTP = withTP.length ? (withTP.reduce((s, t) => s + t.pipTP, 0) / withTP.length).toFixed(1) : '—';
    const avgPipSL = withSL.length ? (withSL.reduce((s, t) => s + t.pipSL, 0) / withSL.length).toFixed(1) : '—';
    const rrRatio = (avgPipSL !== '—' && avgPipTP !== '—' && avgPipSL > 0)
        ? (avgPipTP / avgPipSL).toFixed(2) : '—';

    // Consecutive wins/losses
    let maxW = 0, maxL = 0, curW = 0, curL = 0;
    [...closed].sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(t => {
        if (t.pnl > 0) { curW++; curL = 0; maxW = Math.max(maxW, curW); }
        else if (t.pnl < 0) { curL++; curW = 0; maxL = Math.max(maxL, curL); }
        else { curW = 0; curL = 0; }
    });

    const buyTrades = trades.filter(t => t.direction === '\u0634\u0631\u0627\u0621');
    const sellTrades = trades.filter(t => t.direction === '\u0628\u064a\u0639');
    const buyWins = buyTrades.filter(t => t.pnl > 0).length;
    const sellWins = sellTrades.filter(t => t.pnl > 0).length;
    const buyNet = buyTrades.filter(t => t.pnl).reduce((s, t) => s + t.pnl, 0);
    const sellNet = sellTrades.filter(t => t.pnl).reduce((s, t) => s + t.pnl, 0);

    // Win rate circle
    const deg = Math.round(winRate * 3.6);
    document.getElementById('statsWinRatePct').textContent = winRate + '%';
    document.getElementById('statsWinRateCircle').style.background =
        `conic-gradient(var(--gold) ${deg}deg, var(--bg-hover) ${deg}deg)`;
    document.getElementById('statsBarWin').style.width = winRate + '%';
    document.getElementById('statsBarLoss').style.width = lossRate + '%';
    document.getElementById('statsBarEven').style.width = evenRate + '%';

    document.getElementById('statsKpiRow').innerHTML = [
        ['\uD83D\uDCCB \u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0635\u0641\u0642\u0627\u062A', trades.length, ''],
        ['\uD83D\uDFE2 \u0631\u0627\u0628\u062D\u0629', wins.length, 'pnl-pos'],
        ['\uD83D\uDD34 \u062E\u0627\u0633\u0631\u0629', losses.length, 'pnl-neg'],
        ['\uD83D\uDCB0 \u0635\u0627\u0641\u064A P&L', fmtMoney(netTotal), pnlClass(netTotal)],
        ['\u2696\uFE0F \u0639\u0627\u0645\u0644 \u0627\u0644\u0631\u0628\u062D', profitFactor, ''],
        ['\uD83D\uDCCA \u0645\u062A\u0648\u0633\u0637 \u0635\u0641\u0642\u0629', fmtMoney(avgPnL), pnlClass(avgPnL)],
    ].map(([l, v, cls]) => `<div class="wkpi-item"><span class="wkpi-label">${l}</span><span class="wkpi-val ${cls}">${v}</span></div>`).join('');

    const sRow = (l, v, cls = '') =>
        `<div class="stat-row"><span class="stat-row-label">${l}</span><span class="stat-row-val ${cls}">${v}</span></div>`;

    // Render Charts
    renderCharts(closed);

    document.getElementById('statGeneral').innerHTML = [
        ['\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0635\u0641\u0642\u0627\u062A', trades.length],
        ['\u0635\u0641\u0642\u0627\u062A \u0645\u063A\u0644\u0642\u0629', closed.length],
        ['\u0635\u0641\u0642\u0627\u062A \u0645\u0641\u062A\u0648\u062D\u0629', trades.length - closed.length],
        ['\u0635\u0641\u0642\u0627\u062A \u0631\u0627\u0628\u062D\u0629 \uD83D\uDFE2', wins.length],
        ['\u0635\u0641\u0642\u0627\u062A \u062E\u0627\u0633\u0631\u0629 \uD83D\uDD34', losses.length],
        ['\u0635\u0641\u0642\u0627\u062A \u062A\u0639\u0627\u062F\u0644 \u26AA', evens.length],
        ['\u0646\u0633\u0628\u0629 \u0627\u0644\u0641\u0648\u0632', winRate + '%'],
        ['\u0646\u0633\u0628\u0629 \u0627\u0644\u062E\u0633\u0627\u0631\u0629', lossRate + '%'],
        ['\u0639\u062F\u062F \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A', state.accounts.length],
    ].map(([l, v]) => sRow(l, v)).join('');

    document.getElementById('statFinancial').innerHTML = [
        ['\u0635\u0627\u0641\u064A P/L', fmtMoney(netTotal), pnlClass(netTotal)],
        ['\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0623\u0631\u0628\u0627\u062D', fmtMoney(totalWinAmt), 'pnl-pos'],
        ['\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u062E\u0633\u0627\u0626\u0631', '-$' + totalLossAmt.toFixed(2), 'pnl-neg'],
        ['\u0645\u062A\u0648\u0633\u0637 \u0631\u0628\u062D / \u0635\u0641\u0642\u0629', fmtMoney(avgPnL), pnlClass(avgPnL)],
        ['\u0645\u062A\u0648\u0633\u0637 \u0627\u0644\u0631\u0627\u0628\u062D\u0629', fmtMoney(avgWin), 'pnl-pos'],
        ['\u0645\u062A\u0648\u0633\u0637 \u0627\u0644\u062E\u0627\u0633\u0631\u0629', fmtMoney(avgLoss), 'pnl-neg'],
        ['\u0639\u0627\u0645\u0644 \u0627\u0644\u0631\u0628\u062D (Profit Factor)', profitFactor],
        ['\u0645\u062A\u0648\u0633\u0637 \u062D\u062C\u0645 \u0627\u0644\u0644\u0648\u062A', avgLot],
    ].map(([l, v, cls = '']) => sRow(l, v, cls)).join('');

    document.getElementById('statDirection').innerHTML = [
        ['\u0635\u0641\u0642\u0627\u062A \u0634\u0631\u0627\u0621 (Long)', buyTrades.length],
        ['\u0635\u0641\u0642\u0627\u062A \u0628\u064A\u0639 (Short)', sellTrades.length],
        ['\u0631\u0627\u0628\u062D\u0629 \u0634\u0631\u0627\u0621', buyWins],
        ['\u0631\u0627\u0628\u062D\u0629 \u0628\u064A\u0639', sellWins],
        ['\u0646\u0633\u0628\u0629 \u0641\u0648\u0632 \u0634\u0631\u0627\u0621', buyTrades.length ? Math.round((buyWins / buyTrades.length) * 100) + '%' : '\u2014'],
        ['\u0646\u0633\u0628\u0629 \u0641\u0648\u0632 \u0628\u064A\u0639', sellTrades.length ? Math.round((sellWins / sellTrades.length) * 100) + '%' : '\u2014'],
        ['\u0631\u0628\u062D \u0634\u0631\u0627\u0621 \u0625\u062C\u0645\u0627\u0644\u064A', fmtMoney(buyNet), pnlClass(buyNet)],
        ['\u0631\u0628\u062D \u0628\u064A\u0639 \u0625\u062C\u0645\u0627\u0644\u064A', fmtMoney(sellNet), pnlClass(sellNet)],
    ].map(([l, v, cls = '']) => sRow(l, v, cls)).join('');

    document.getElementById('statPip').innerHTML = [
        ['\u0645\u062A\u0648\u0633\u0637 PIP \u0627\u0644\u0647\u062F\u0641', avgPipTP !== '\u2014' ? avgPipTP + ' pip' : '\u2014'],
        ['\u0645\u062A\u0648\u0633\u0637 PIP \u0627\u0644\u0633\u062A\u0648\u0628', avgPipSL !== '\u2014' ? avgPipSL + ' pip' : '\u2014'],
        ['\u0646\u0633\u0628\u0629 R:R \u0627\u0644\u0645\u062A\u0648\u0633\u0637\u0629', rrRatio !== '\u2014' ? '1 : ' + rrRatio : '\u2014'],
        ['\u0635\u0641\u0642\u0627\u062A \u0628\u0647\u062F\u0641 \u0645\u062D\u062F\u062F', withTP.length],
        ['\u0635\u0641\u0642\u0627\u062A \u0628\u0633\u062A\u0648\u0628 \u0645\u062D\u062F\u062F', withSL.length],
    ].map(([l, v]) => sRow(l, v)).join('');

    document.getElementById('statAdvanced').innerHTML = [
        ['\u0623\u0637\u0648\u0644 \u0633\u0644\u0633\u0644\u0629 \u0631\u0627\u0628\u062D\u0629', maxW + ' \u0635\u0641\u0642\u0627\u062A'],
        ['\u0623\u0637\u0648\u0644 \u0633\u0644\u0633\u0644\u0629 \u062E\u0627\u0633\u0631\u0629', maxL + ' \u0635\u0641\u0642\u0627\u062A'],
        ['\u0646\u0633\u0628\u0629 \u0627\u0644\u0641\u0648\u0632', winRate + '%'],
        ['\u0646\u0633\u0628\u0629 \u0627\u0644\u062A\u0639\u0627\u062F\u0644', evenRate + '%'],
        ['\u0623\u0641\u0636\u0644 \u0635\u0641\u0642\u0629', bestTr ? fmtMoney(bestTr.pnl) : '\u2014'],
        ['\u0623\u0633\u0648\u0623 \u0635\u0641\u0642\u0629', worstTr ? fmtMoney(worstTr.pnl) : '\u2014'],
    ].map(([l, v]) => sRow(l, v)).join('');

    document.getElementById('statAccounts').innerHTML = state.accounts.map(acc => {
        const at = tradesByAccount(acc.id).filter(t => !accFilter || t.accountId === accFilter);
        const cl = at.filter(t => t.pnl !== null && t.pnl !== undefined);
        const nt = cl.reduce((s, t) => s + t.pnl, 0);
        const wr = cl.length ? Math.round((cl.filter(t => t.pnl > 0).length / cl.length) * 100) : 0;
        return `<div class="stat-row" style="flex-direction:column;align-items:flex-start;gap:4px">
            <div style="display:flex;width:100%;justify-content:space-between">
                <span class="stat-row-label">${acc.name} <span style="font-size:.7rem;opacity:.6">(${acc.type})</span></span>
                <span class="stat-row-val ${pnlClass(nt)}">${fmtMoney(nt)}</span>
            </div>
            <div style="font-size:.73rem;color:var(--text-muted)">${cl.length} \u0635\u0641\u0642\u0629 | \u0641\u0648\u0632 ${wr}%</div>
        </div>`;
    }).join('') || sRow('\u0644\u0627 \u062A\u0648\u062C\u062F \u062D\u0633\u0627\u0628\u0627\u062A', '\u2014');

    // Best/Worst
    const bwGrid = document.getElementById('bestWorstGrid');
    if (!bestTr) {
        bwGrid.innerHTML = '<div style="color:var(--text-muted);padding:20px">\u0644\u0627 \u062A\u0648\u062C\u062F \u0635\u0641\u0642\u0627\u062A \u0645\u063A\u0644\u0642\u0629 \u0628\u0639\u062F</div>';
    } else {
        bwGrid.innerHTML = `
        <div class="bw-card best">
            <div class="bw-label" style="color:var(--green)">\uD83C\uDFC6 \u0623\u0641\u0636\u0644 \u0635\u0641\u0642\u0629</div>
            <div class="bw-title">${bestTr.title}</div>
            <div class="bw-val" style="color:var(--green)">${fmtMoney(bestTr.pnl)}</div>
            <div style="font-size:.8rem;margin-top:6px;opacity:.7">${formatDate(bestTr.date)}</div>
        </div>
        <div class="bw-card worst">
            <div class="bw-label" style="color:var(--red)">\uD83D\uDCC9 \u0623\u0633\u0648\u0623 \u0635\u0641\u0642\u0629</div>
            <div class="bw-title">${worstTr.title}</div>
            <div class="bw-val" style="color:var(--red)">${fmtMoney(worstTr.pnl)}</div>
            <div style="font-size:.8rem;margin-top:6px;opacity:.7">${formatDate(worstTr.date)}</div>
        </div>`;
    }

    // Monthly Breakdown
    const monthlyMap = {};
    closed.forEach(t => {
        const key = t.date ? t.date.slice(0, 7) : 'other';
        if (!monthlyMap[key]) monthlyMap[key] = { wins: 0, losses: 0, net: 0, count: 0 };
        monthlyMap[key].count++;
        monthlyMap[key].net += t.pnl;
        if (t.pnl > 0) monthlyMap[key].wins++;
        else if (t.pnl < 0) monthlyMap[key].losses++;
    });
    const maxAbs = Math.max(...Object.values(monthlyMap).map(m => Math.abs(m.net)), 1);
    const monthDiv = document.getElementById('monthlyBreakdown');
    if (!Object.keys(monthlyMap).length) {
        monthDiv.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center">\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u064A\u0627\u0646\u0627\u062A \u0634\u0647\u0631\u064A\u0629 \u0628\u0639\u062F</div>';
    } else {
        const rows = Object.entries(monthlyMap)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([month, data]) => {
                const wr = data.count ? Math.round((data.wins / data.count) * 100) : 0;
                const bw = Math.round((Math.abs(data.net) / maxAbs) * 100);
                const bc = data.net >= 0 ? 'var(--green)' : 'var(--red)';
                let label = month;
                try { label = new Date(month + '-01').toLocaleDateString('ar-SA', { year: 'numeric', month: 'long' }); } catch (e) { }
                return `<tr>
                    <td style="font-weight:700">${label}</td>
                    <td style="text-align:center">${data.count}</td>
                    <td style="text-align:center;color:var(--green)">${data.wins}</td>
                    <td style="text-align:center;color:var(--red)">${data.losses}</td>
                    <td style="text-align:center">${wr}%</td>
                    <td class="${pnlClass(data.net)}" style="font-family:var(--font-mono);font-weight:700">${fmtMoney(data.net)}</td>
                    <td style="min-width:90px"><div class="month-bar-bg"><div class="month-bar-inner" style="width:${bw}%;background:${bc}"></div></div></td>
                </tr>`;
            }).join('');
        monthDiv.innerHTML = `<div class="table-wrap">
            <table class="monthly-table"><thead><tr>
                <th>\u0627\u0644\u0634\u0647\u0631</th>
                <th style="text-align:center">\u0635\u0641\u0642\u0627\u062A</th>
                <th style="text-align:center">\uD83D\uDFE2 \u0631\u0627\u0628\u062D\u0629</th>
                <th style="text-align:center">\uD83D\uDD34 \u062E\u0627\u0633\u0631\u0629</th>
                <th style="text-align:center">\u0646\u0633\u0628\u0629 \u0627\u0644\u0641\u0648\u0632</th>
                <th>\u0627\u0644\u0631\u0628\u062D / \u0627\u0644\u062E\u0633\u0627\u0631\u0629</th>
                <th>\u0627\u0644\u0623\u062F\u0627\u0621</th>
            </tr></thead><tbody>${rows}</tbody></table></div>`;
    }
}


// ============================================================
// MODAL OVERLAY CLICK CLOSE
// ============================================================
function closeModalOnOverlay(e, overlayId) {
    if (e.target.id === overlayId) {
        if (overlayId === 'tradeModalOverlay') closeTradeModal();
        if (overlayId === 'accountModalOverlay') closeAccountModal();
        if (overlayId === 'viewModalOverlay') closeViewModal();
    }
}

// ============================================================
// TOAST
// ============================================================
let toastTimer;
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ============================================================
// DATE DISPLAY
// ============================================================
function updateDate() {
    const d = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('currentDate').textContent = d.toLocaleDateString('ar-SA', options);
}

// ============================================================
// CHART RENDERING (Chart.js)
// ============================================================
function renderCharts(closedTrades) {
    const sortedTrades = [...closedTrades].sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // 1. Equity Curve Data
    const equityLabels = [];
    const equityData = [];
    let currentEquity = 0;
    
    // If we have an account filter, we can start the equity curve at the account balance
    // For now, let's just do cumulative PnL
    
    sortedTrades.forEach(t => {
        currentEquity += t.pnl;
        equityLabels.push(formatDate(t.date));
        equityData.push(currentEquity);
    });

    // 2. Monthly Bar Chart Data
    const mthMap = {};
    sortedTrades.forEach(t => {
        const d = new Date(t.date);
        // Format: Jan 2025
        const mName = d.toLocaleDateString('ar-SA', { year: 'numeric', month: 'short' });
        // Use a sortable key format: YYYY-MM
        const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        
        if (!mthMap[sortKey]) mthMap[sortKey] = { label: mName, net: 0 };
        mthMap[sortKey].net += t.pnl;
    });

    const mKeys = Object.keys(mthMap).sort(); // Sort chronologically
    const barLabels = mKeys.map(k => mthMap[k].label);
    const barData = mKeys.map(k => mthMap[k].net);
    const barColors = barData.map(v => v >= 0 ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.8)');

    // Common Chart Options
    Chart.defaults.color = '#5a6080'; // text-muted
    Chart.defaults.font.family = "'Cairo', sans-serif";
    Chart.defaults.font.size = 13;
    
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
            padding: { top: 20, right: 20, bottom: 10, left: 10 }
        },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: 'rgba(22, 25, 35, 0.9)',
                titleFont: { size: 14, family: "'Cairo', sans-serif" },
                bodyFont: { size: 14, family: "'IBM Plex Mono', monospace" },
                padding: 12,
                borderColor: 'rgba(37, 41, 64, 1)',
                borderWidth: 1,
                displayColors: false,
                callbacks: {
                    label: function(context) {
                        let label = context.dataset.label || '';
                        if (label) { label += ': '; }
                        if (context.parsed.y !== null) {
                            label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y);
                        }
                        return label;
                    }
                }
            }
        },
        scales: {
            x: { 
                grid: { display: false, drawBorder: false },
                ticks: { padding: 10 }
            },
            y: { 
                grid: { color: 'rgba(46, 51, 80, 0.4)', drawBorder: false, borderDash: [5, 5] },
                border: { display: false },
                ticks: {
                    padding: 15,
                    callback: function(value) { return '$' + value; },
                    maxTicksLimit: 6
                }
            }
        },
        interaction: {
            mode: 'index',
            intersect: false,
        },
    };

    // Render Equity Line Chart
    const ctxEquity = document.getElementById('equityChart');
    if (ctxEquity) {
        if (equityChartInstance) equityChartInstance.destroy();
        
        // Create Gradient
        const gradient = ctxEquity.getContext('2d').createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, 'rgba(245, 200, 66, 0.4)'); // Gold
        gradient.addColorStop(1, 'rgba(245, 200, 66, 0.0)');

        equityChartInstance = new Chart(ctxEquity, {
            type: 'line',
            data: {
                labels: equityLabels,
                datasets: [{
                    label: 'الربح التراكمي',
                    data: equityData,
                    borderColor: '#f5c842',
                    backgroundColor: gradient,
                    borderWidth: 3,
                    pointBackgroundColor: '#1a1d28',
                    pointBorderColor: '#f5c842',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    fill: true,
                    tension: 0.4 // Smoother curve
                }]
            },
            options: commonOptions
        });
    }

    // Render Monthly Bar Chart
    const ctxMonthly = document.getElementById('monthlyChart');
    if (ctxMonthly) {
        if (monthlyChartInstance) monthlyChartInstance.destroy();
        monthlyChartInstance = new Chart(ctxMonthly, {
            type: 'bar',
            data: {
                labels: barLabels,
                datasets: [{
                    label: 'صافي الربح',
                    data: barData,
                    backgroundColor: barColors,
                    borderRadius: 6,
                    borderSkipped: false,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8
                }]
            },
            options: commonOptions
        });
    }
}

// ============================================================
// XAU/USD SIMULATED TICKER
// ============================================================
function simulateTicker() {
    const base = 2650;
    let price = base + (Math.random() * 60 - 30);

    setInterval(() => {
        const change = (Math.random() - 0.5) * 2;
        price = Math.max(2500, Math.min(2800, price + change));
        const el = document.getElementById('tickerPrice');
        if (el) el.textContent = price.toFixed(2);
    }, 2000);
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closeTradeModal();
        closeAccountModal();
        closeViewModal();
    }
    // Ctrl+N = new trade
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        openTradeModal();
    }
});

// ============================================================
// INIT APP (called after successful login)
// ============================================================
async function initApp() {
    const user = authCurrentUser();
    if (!user) return;

    // Update UI with user's fullname
    const fullname = user.fullname || user.username;
    const els = [
        document.getElementById('sidebarUserName'),
        document.getElementById('heroUserName'),
    ];
    els.forEach(el => { if (el) el.textContent = fullname; });

    // Update sidebar user info
    const fnEl = document.getElementById('sidebarFullname');
    const roleEl = document.getElementById('sidebarRole');
    if (fnEl) fnEl.textContent = fullname;
    if (roleEl) roleEl.textContent = user.isAdmin ? '👑 مدير النظام' : 'مستخدم';

    // Update page title
    document.title = 'تدوين صفقاتي – ' + fullname;

    // Show admin nav only for admin
    const adminNav = document.getElementById('nav-admin');
    if (adminNav) adminNav.style.display = user.isAdmin ? 'flex' : 'none';

    // Load data and render
    await loadState();
    populateAccountFilters();
    updateDate();
    renderDashboard();
    simulateTicker();

    // Set today's date default
    const today = new Date().toISOString().slice(0, 10);
    const dateEl = document.getElementById('t_date');
    if (dateEl) dateEl.value = today;
}

// ============================================================
// STARTUP
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    const shouldInitApp = authInit();
    if (shouldInitApp) {
        initApp();
    }
});
