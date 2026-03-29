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
async function fetchAllRecords(table, userId) {
    let allData = [];
    let start = 0;
    const limit = 1000;
    while (true) {
        const { data, error } = await db.from(table)
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true })
            .range(start, start + limit - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData.push(...data);
        if (data.length < limit) break;
        start += limit;
    }
    return { data: allData, error: null };
}

async function loadState() {
    const user = authCurrentUser();
    if (!user) {
        state.accounts = [];
        state.trades = [];
        return;
    }

    try {
        const [accRes, trRes] = await Promise.all([
            fetchAllRecords('accounts', user.id),
            fetchAllRecords('trades', user.id)
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
            tags: t.tags || '',
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

// MT5 HELPER FUNCTIONS
function openMt5Modal(accountId) {
    const acc = accountById(accountId);
    if (!acc) return;

    document.getElementById('mt5ApiKey').value = acc.mt5_api_key || 'لم يتم توليد مفتاح بعد';
    
    // Generate the EA Code
    const supabaseUrl = SUPABASE_URL;
    const apiUrl = `${supabaseUrl}/functions/v1/mt5-sync`;
    const eaCode = generateMql5Code(acc.name, acc.mt5_api_key, apiUrl);
    document.getElementById('mt5EaCode').value = eaCode;

    document.getElementById('mt5ModalOverlay').classList.add('active');
}

function closeMt5Modal() {
    document.getElementById('mt5ModalOverlay').classList.remove('active');
}

function copyTextToClipboard(id) {
    const el = document.getElementById(id);
    el.select();
    document.execCommand('copy');
    showToast('✅ تم النسخ إلى الحافظة');
}

function generateMql5Code(accountName, apiKey, apiUrl) {
    return `//+------------------------------------------------------------------+
//|                                              MT5_Trade_Sync.mq5  |
//|                                  Copyright 2026, Notion Clone    |
//|                                       https://your-site.com      |
//+------------------------------------------------------------------+
#property copyright "Notion Clone"
#property link      "https://your-site.com"
#property version   "1.00"
#property strict

//--- input parameters
input string   InpApiKey = "${apiKey}"; // API Key
input string   InpApiUrl = "${apiUrl}"; // API URL

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   Print("MT5 Sync: Started for Account: ${accountName}");
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   Print("MT5 Sync: Stopped");
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
}

//+------------------------------------------------------------------+
//| Trade function                                                   |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction& trans,
                        const MqlTradeRequest& request,
                        const MqlTradeResult& result)
{
   // Check if it's a closed trade (deal)
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD)
   {
      ulong ticket = trans.deal;
      if(HistoryDealSelect(ticket))
      {
         long entryType = HistoryDealGetInteger(ticket, DEAL_ENTRY);
         if(entryType == DEAL_ENTRY_OUT) // Deal closed
         {
            SendTradeToApi(ticket);
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Send trade data via WebRequest                                   |
//+------------------------------------------------------------------+
void SendTradeToApi(ulong ticket)
{
   string symbol = HistoryDealGetString(ticket, DEAL_SYMBOL);
   long type = HistoryDealGetInteger(ticket, DEAL_TYPE);
   double lot = HistoryDealGetDouble(ticket, DEAL_VOLUME);
   double entryPrice = HistoryDealGetDouble(ticket, DEAL_PRICE);
   double pnl = HistoryDealGetDouble(ticket, DEAL_PROFIT) + HistoryDealGetDouble(ticket, DEAL_COMMISSION) + HistoryDealGetDouble(ticket, DEAL_SWAP);
   datetime closeTime = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
   
   // Find the open price (simplified)
   double openPrice = 0;
   HistorySelect(closeTime - 86400*30, closeTime); // Look back 30 days
   // This is a basic lookup, more robust logic can be added
   
   string direction = (type == DEAL_TYPE_SELL) ? "buy" : "sell"; // Reverse of closing deal
   
   string payload = StringFormat(
      "{\\"ticket\\":\\"%d\\", \\"symbol\\":\\"%s\\", \\"direction\\":\\"%s\\", \\"lot\\":%.2f, \\"entry\\":%.5f, \\"exit_price\\":%.5f, \\"pnl\\":%.2f, \\"close_time\\":\\"%s\\"}",
      ticket, symbol, direction, lot, entryPrice, entryPrice, pnl, TimeToString(closeTime, TIME_DATE|TIME_SECONDS)
   );

   char data[];
   StringToCharArray(payload, data, 0, WHOLE_ARRAY, CP_UTF8);
   char result[];
   string result_headers;
   
   string headers = "Content-Type: application/json\\r\\nx-mt5-api-key: " + InpApiKey + "\\r\\n";
   
   int res = WebRequest("POST", InpApiUrl, headers, 10000, data, result, result_headers);
   
   if(res == 200)
      Print("MT5 Sync: Trade sent successfully. Ticket: ", ticket);
   else
      Print("MT5 Sync: Error sending trade. Code: ", res, " Result: ", CharArrayToString(result));
}
//+------------------------------------------------------------------+
`;
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
    btn.addEventListener('click', () => {
        switchPage(btn.dataset.page);
        
        // On mobile, close sidebar after clicking a nav item
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('mobile-open')) {
            sidebar.classList.remove('mobile-open');
            sidebar.classList.add('collapsed');
            document.getElementById('mainContent').classList.remove('sidebar-collapsed');
            const overlay = document.getElementById('mobileOverlay');
            if (overlay) overlay.classList.remove('active');
        }
    });
});

document.getElementById('sidebarToggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const main = document.getElementById('mainContent');
    sidebar.classList.toggle('collapsed');
    main.classList.toggle('sidebar-collapsed');
    
    // Update toggle button arrow icon
    document.getElementById('sidebarToggle').textContent = sidebar.classList.contains('collapsed') ? '›' : '‹';

    // Trigger chart resize after transition
    setTimeout(() => {
        if (typeof equityChartInstance !== 'undefined' && equityChartInstance) {
            equityChartInstance.resize();
        }
        if (typeof monthlyChartInstance !== 'undefined' && monthlyChartInstance) {
            monthlyChartInstance.resize();
        }
        window.dispatchEvent(new Event('resize'));
    }, 450);
});

// Mobile Menu Toggle
const menuBtn = document.getElementById('menuBtn');
if (menuBtn) {
    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('mobileOverlay');
        if (sidebar) sidebar.classList.toggle('mobile-open');
        if (overlay) overlay.classList.toggle('active');
    });
}

// Robust Chart Resizing on Sidebar Toggle
const mainContentEl = document.getElementById('mainContent');
if (mainContentEl) {
    mainContentEl.addEventListener('transitionend', (e) => {
        // Check if the transitioned property affects layout
        if (e.propertyName === 'margin-right' || e.propertyName === 'margin-left' || e.propertyName === 'width') {
            if (typeof equityChartInstance !== 'undefined' && equityChartInstance) {
                equityChartInstance.resize();
            }
            if (typeof monthlyChartInstance !== 'undefined' && monthlyChartInstance) {
                monthlyChartInstance.resize();
            }
            // Trigger a global resize event for other components
            window.dispatchEvent(new Event('resize'));
        }
    });
}



// Close sidebar on click outside in mobile
document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobileOverlay');
    
    if (sidebar && sidebar.classList.contains('mobile-open')) {
        // If click is not inside sidebar
        if (!sidebar.contains(e.target)) {
            sidebar.classList.remove('mobile-open');
            sidebar.classList.add('collapsed');
            document.getElementById('mainContent').classList.remove('sidebar-collapsed');
            if (overlay) overlay.classList.remove('active');
        }
    }
});

// Also close on overlay click
document.getElementById('mobileOverlay')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobileOverlay');
    if (sidebar && sidebar.classList.contains('mobile-open')) {
        sidebar.classList.remove('mobile-open');
        sidebar.classList.add('collapsed');
        document.getElementById('mainContent').classList.remove('sidebar-collapsed');
        if (overlay) overlay.classList.remove('active');
    }
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
            document.getElementById('a_mt5').checked = acc.mt5_enabled || false;
            document.getElementById('accountModalTitle').textContent = '✏️ تعديل الحساب';
        }
    } else {
        document.getElementById('a_mt5').checked = false;
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
            notes,
            mt5_enabled: document.getElementById('a_mt5').checked
        };

        // If MT5 is enabled and no key exists, generate one
        const existingAcc = accountId ? accountById(accountId) : null;
        if (dbPayload.mt5_enabled) {
            if (existingAcc && existingAcc.mt5_api_key) {
                dbPayload.mt5_api_key = existingAcc.mt5_api_key;
            } else {
                dbPayload.mt5_api_key = uid().replace(/-/g, '') + uid().replace(/-/g, ''); // Long unique key
            }
        }

        if (accountId) {
            const { error } = await db.from('accounts').update(dbPayload).eq('id', accountId);
            if (error) throw error;
            showToast('✅ تم تحديث الحساب بنجاح');
            
            const existing = state.accounts.find(a => a.id === accountId);
            if (existing) {
                existing.name = dbPayload.name;
                existing.type = dbPayload.type;
                existing.initialBalance = Number(dbPayload.initial_balance);
                existing.notes = dbPayload.notes;
                existing.mt5_enabled = dbPayload.mt5_enabled;
                if (dbPayload.mt5_api_key) existing.mt5_api_key = dbPayload.mt5_api_key;
            }
        } else {
            accountId = uid();
            dbPayload.id = accountId;
            const { error } = await db.from('accounts').insert([dbPayload]);
            if (error) throw error;
            showToast('✅ تم إضافة الحساب بنجاح');
            
            state.accounts.push({
                id: dbPayload.id,
                name: dbPayload.name,
                type: dbPayload.type,
                initialBalance: Number(dbPayload.initial_balance),
                notes: dbPayload.notes,
                mt5_enabled: dbPayload.mt5_enabled,
                mt5_api_key: dbPayload.mt5_api_key,
                createdAt: new Date().toISOString()
            });
        }

        // await loadState(); // Removed for performance
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
        
        state.accounts = state.accounts.filter(a => a.id !== id);
        state.trades = state.trades.filter(t => t.accountId !== id);
        
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
            
            // Set tags
            const tags = (tr.tags || '').split(',');
            document.querySelectorAll('#tagsContainer input').forEach(cb => {
                cb.checked = tags.includes(cb.value);
            });
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
            result,
            tags: Array.from(document.querySelectorAll('#tagsContainer input:checked')).map(cb => cb.value).join(',')
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

            const existing = state.trades.find(t => t.id === tradeId);
            if (existing) {
                Object.assign(existing, {
                    accountId: dbPayload.account_id,
                    title: dbPayload.title,
                    direction: dbPayload.direction,
                    date: dbPayload.date,
                    entry: Number(dbPayload.entry),
                    exit: dbPayload.exit_price !== null ? Number(dbPayload.exit_price) : null,
                    target: dbPayload.target !== null ? Number(dbPayload.target) : null,
                    stop: dbPayload.stop !== null ? Number(dbPayload.stop) : null,
                    lot: Number(dbPayload.lot),
                    pnl: dbPayload.pnl !== null ? Number(dbPayload.pnl) : null,
                    pipTP: dbPayload.pip_tp !== null ? Number(dbPayload.pip_tp) : null,
                    pipSL: dbPayload.pip_sl !== null ? Number(dbPayload.pip_sl) : null,
                    result: dbPayload.result,
                    notes: dbPayload.notes,
                    tags: dbPayload.tags || ''
                });
                if (dbPayload.image) existing.image = dbPayload.image;
            }
        } else {
            tradeId = uid();
            dbPayload.id = tradeId;
            const { error } = await db.from('trades').insert([dbPayload]);
            if (error) throw error;
            showToast('✅ تم تسجيل الصفقة بنجاح');

            state.trades.push({
                id: dbPayload.id,
                accountId: dbPayload.account_id,
                title: dbPayload.title,
                direction: dbPayload.direction,
                date: dbPayload.date,
                entry: Number(dbPayload.entry),
                exit: dbPayload.exit_price !== null ? Number(dbPayload.exit_price) : null,
                target: dbPayload.target !== null ? Number(dbPayload.target) : null,
                stop: dbPayload.stop !== null ? Number(dbPayload.stop) : null,
                lot: Number(dbPayload.lot),
                pnl: dbPayload.pnl !== null ? Number(dbPayload.pnl) : null,
                pipTP: dbPayload.pip_tp !== null ? Number(dbPayload.pip_tp) : null,
                pipSL: dbPayload.pip_sl !== null ? Number(dbPayload.pip_sl) : null,
                result: dbPayload.result,
                notes: dbPayload.notes,
                image: dbPayload.image || null,
                tags: dbPayload.tags || '',
                createdAt: new Date().toISOString()
            });
        }

        // await loadState(); // Removed for performance
        closeTradeModal();
        renderDashboard();
        renderTradesTable();
        renderGallery();
        renderStats();
    } catch (err) {
        console.error('Trade Insert Error:', err);
        const msg = err.message || JSON.stringify(err);
        showToast('❌ حدث خطأ: ' + msg);
        alert('حدث خطأ أثناء حفظ الصفقة:\n' + msg + '\n\nتأكد من اختيار الحساب بشكل صحيح وتزامن البيانات.');
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
        
        state.trades = state.trades.filter(t => t.id !== id);
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

async function resizeImageFile(file, maxSize = 800) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let w = img.width;
                let h = img.height;
                if (w > maxSize || h > maxSize) {
                    if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                    else { w = Math.round(w * maxSize / h); h = maxSize; }
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

function fileToBase64(file) {
    if (file && file.type && file.type.startsWith('image/')) {
        return resizeImageFile(file);
    }
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
// PROFILE MODAL
// ============================================================
function openProfileModal() {
    const user = authCurrentUser();
    if (!user) return;
    
    document.getElementById('p_fullname').value = user.fullname || '';
    document.getElementById('p_username').value = user.username || '';
    document.getElementById('p_password').value = ''; 
    
    document.getElementById('profileModalOverlay').classList.add('active');
}

function closeProfileModal() {
    document.getElementById('profileModalOverlay').classList.remove('active');
}

async function saveProfile(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const origText = btn.textContent;
    btn.textContent = 'جارٍ الحفظ...';
    btn.disabled = true;

    const fn = document.getElementById('p_fullname').value;
    const un = document.getElementById('p_username').value;
    const pw = document.getElementById('p_password').value;

    const res = await authUpdateProfile(fn, un, pw);

    btn.textContent = origText;
    btn.disabled = false;

    if (!res.success) {
        showToast('❌ ' + res.message);
        return;
    }

    showToast('✅ تم تحديث بياناتك بنجاح');
    closeProfileModal();
    
    const user = authCurrentUser();
    if (user) {
        const sidebarFullname = document.getElementById('sidebarFullname');
        const sidebarUserName = document.getElementById('sidebarUserName');
        const heroUserName = document.getElementById('heroUserName');
        if (sidebarFullname) sidebarFullname.textContent = user.fullname;
        if (sidebarUserName) sidebarUserName.textContent = user.fullname.split(' ')[0];
        if (heroUserName) heroUserName.textContent = user.fullname.split(' ')[0];
    }
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

    // Populate Statistics Multi-Select
    populateStatsMultiSelect();
}

function populateStatsMultiSelect() {
    const dropdown = document.getElementById('statsAccountDropdown');
    if (!dropdown) return;
    
    // Save current selection if possible
    const checkedIds = Array.from(dropdown.querySelectorAll('input:checked:not([value="all"])')).map(i => i.value);
    const allChecked = dropdown.querySelector('input[value="all"]')?.checked;

    dropdown.innerHTML = `
        <label class="multi-select-option ${allChecked || (!checkedIds.length && !dropdown.innerHTML) ? 'selected' : ''}">
            <input type="checkbox" value="all" ${allChecked || (!checkedIds.length && !dropdown.innerHTML) ? 'checked' : ''} onchange="handleAccountSelection(event)"> الكل
        </label>
    ` + state.accounts.map(acc => `
        <label class="multi-select-option ${checkedIds.includes(acc.id) ? 'selected' : ''}">
            <input type="checkbox" value="${acc.id}" ${checkedIds.includes(acc.id) ? 'checked' : ''} onchange="handleAccountSelection(event)"> ${acc.name}
        </label>
    `).join('');

    updateMultiSelectTrigger();
}

function toggleMultiSelect(e) {
    e.stopPropagation();
    const container = document.getElementById('statsAccountMultiSelect');
    if (container) container.classList.toggle('open');
}

function updateMultiSelectTrigger() {
    const dropdown = document.getElementById('statsAccountDropdown');
    const trigger = document.querySelector('#statsAccountMultiSelect .multi-select-trigger');
    if (!dropdown || !trigger) return;

    const allChecked = dropdown.querySelector('input[value="all"]').checked;
    const checkedBoxes = Array.from(dropdown.querySelectorAll('input:checked:not([value="all"])'));
    
    if (allChecked || checkedBoxes.length === 0) {
        trigger.textContent = 'كل الحسابات';
    } else if (checkedBoxes.length === 1) {
        trigger.textContent = checkedBoxes[0].parentElement.textContent.trim();
    } else if (checkedBoxes.length === state.accounts.length) {
        trigger.textContent = 'كل الحسابات';
        // Auto-check "All" if all individual ones are checked
        dropdown.querySelector('input[value="all"]').checked = true;
        dropdown.querySelectorAll('input:not([value="all"])').forEach(i => i.checked = false);
        dropdown.querySelectorAll('.multi-select-option').forEach(el => el.classList.remove('selected'));
        dropdown.querySelector('.multi-select-option:first-child').classList.add('selected');
    } else {
        trigger.textContent = `محدد (${checkedBoxes.length}) حسابات`;
    }
}

function handleAccountSelection(e) {
    const val = e.target.value;
    const isChecked = e.target.checked;
    const dropdown = document.getElementById('statsAccountDropdown');
    
    if (val === 'all') {
        if (isChecked) {
            // Uncheck others if "All" is selected
            dropdown.querySelectorAll('input:not([value="all"])').forEach(i => i.checked = false);
        } else {
            // Don't allow unchecking "All" if nothing else is checked
            const othersChecked = dropdown.querySelector('input:checked:not([value="all"])');
            if (!othersChecked) e.target.checked = true;
        }
    } else {
        if (isChecked) {
            // Uncheck "All" if an individual account is selected
            dropdown.querySelector('input[value="all"]').checked = false;
        } else {
            // If all individual ones unchecked, check "All"
            const othersChecked = dropdown.querySelector('input:checked:not([value="all"])');
            if (!othersChecked) dropdown.querySelector('input[value="all"]').checked = true;
        }
    }

    // Update UI classes
    dropdown.querySelectorAll('.multi-select-option').forEach(opt => {
        const input = opt.querySelector('input');
        if (input.checked) opt.classList.add('selected');
        else opt.classList.remove('selected');
    });

    updateMultiSelectTrigger();
    renderStats();
}

// Close multi-select on click outside
document.addEventListener('click', (e) => {
    const container = document.getElementById('statsAccountMultiSelect');
    if (container && !container.contains(e.target)) {
        container.classList.remove('open');
    }
});

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
    const periodFilter = document.getElementById('tradesFilterPeriod')?.value || '';

    const customDateContainer = document.getElementById('tradesCustomDateRange');
    if (periodFilter === 'custom') {
        if (customDateContainer) customDateContainer.style.display = 'flex';
    } else {
        if (customDateContainer) customDateContainer.style.display = 'none';
        const startEl = document.getElementById('tradesStartDate');
        const endEl = document.getElementById('tradesEndDate');
        if (startEl) startEl.value = '';
        if (endEl) endEl.value = '';
    }

    let trades = [...state.trades];

    if (accFilter) trades = trades.filter(t => t.accountId === accFilter);
    if (dirFilter) trades = trades.filter(t => t.direction === dirFilter);
    if (resFilter) trades = trades.filter(t => t.result === resFilter);

    if (periodFilter === 'custom') {
        const startStr = document.getElementById('tradesStartDate')?.value;
        const endStr = document.getElementById('tradesEndDate')?.value;
        if (startStr) trades = trades.filter(t => new Date(t.date).getTime() >= new Date(startStr + "T00:00:00").getTime());
        if (endStr) trades = trades.filter(t => new Date(t.date).getTime() <= new Date(endStr + "T23:59:59").getTime());
    } else if (parseInt(periodFilter) > 0) {
        const cutoff = new Date(Date.now() - parseInt(periodFilter) * 86400000);
        trades = trades.filter(t => new Date(t.date) >= cutoff);
    }

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
        ${acc.mt5_enabled ? `<button class="btn-primary" style="margin-right:8px; font-size:.78rem; background:var(--blue); border-color:var(--blue);" onclick="openMt5Modal('${acc.id}')">🤖 إعدادات MT5</button>` : ''}
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
    const periodFilter = document.getElementById('galleryFilterPeriod')?.value || '';

    const customDateContainer = document.getElementById('galleryCustomDateRange');
    if (periodFilter === 'custom') {
        if (customDateContainer) customDateContainer.style.display = 'flex';
    } else {
        if (customDateContainer) customDateContainer.style.display = 'none';
        const startEl = document.getElementById('galleryStartDate');
        const endEl = document.getElementById('galleryEndDate');
        if (startEl) startEl.value = '';
        if (endEl) endEl.value = '';
    }

    let trades = [...state.trades].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (accFilter) trades = trades.filter(t => t.accountId === accFilter);
    if (resFilter) trades = trades.filter(t => t.result === resFilter);
    
    if (periodFilter === 'custom') {
        const startStr = document.getElementById('galleryStartDate')?.value;
        const endStr = document.getElementById('galleryEndDate')?.value;
        if (startStr) trades = trades.filter(t => new Date(t.date).getTime() >= new Date(startStr + "T00:00:00").getTime());
        if (endStr) trades = trades.filter(t => new Date(t.date).getTime() <= new Date(endStr + "T23:59:59").getTime());
    } else if (parseInt(periodFilter) > 0) {
        const cutoff = new Date(Date.now() - parseInt(periodFilter) * 86400000);
        trades = trades.filter(t => new Date(t.date) >= cutoff);
    }

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
    const dropdown = document.getElementById('statsAccountDropdown');
    const allChecked = dropdown?.querySelector('input[value="all"]')?.checked;
    const selectedAccountIds = allChecked ? [] : Array.from(dropdown?.querySelectorAll('input:checked') || []).map(i => i.value);
    
    const periodFilter = document.getElementById('statsFilterPeriod')?.value || '0';

    const customDateContainer = document.getElementById('customDateRange');
    if (periodFilter === 'custom') {
        customDateContainer.style.display = 'flex';
    } else {
        customDateContainer.style.display = 'none';
        document.getElementById('statsStartDate').value = '';
        document.getElementById('statsEndDate').value = '';
    }

    let trades = [...state.trades];
    if (selectedAccountIds.length > 0) {
        trades = trades.filter(t => selectedAccountIds.includes(t.accountId));
    }
    
    if (periodFilter === 'custom') {
        const startStr = document.getElementById('statsStartDate').value;
        const endStr = document.getElementById('statsEndDate').value;
        if (startStr) trades = trades.filter(t => new Date(t.date).getTime() >= new Date(startStr + "T00:00:00").getTime());
        if (endStr) trades = trades.filter(t => new Date(t.date).getTime() <= new Date(endStr + "T23:59:59").getTime());
    } else if (parseInt(periodFilter) > 0) {
        const cutoff = new Date(Date.now() - parseInt(periodFilter) * 86400000);
        trades = trades.filter(t => new Date(t.date) >= cutoff);
    }

    const closed = trades.filter(t => t.pnl !== null);
    const netTotal = closed.reduce((s, t) => s + (t.pnl || 0), 0);
    
    // Psychological Tags Analysis
    const tagsMap = {};
    closed.forEach(t => {
        const ts = (t.tags || 'غير محدد').split(',');
        ts.forEach(tag => {
            if (!tag.trim()) return;
            if (!tagsMap[tag]) tagsMap[tag] = { pnl: 0, wins: 0, losses: 0, evens: 0, count: 0 };
            tagsMap[tag].count++;
            tagsMap[tag].pnl += t.pnl;
            if (t.pnl > 0) tagsMap[tag].wins++;
            else if (t.pnl < 0) tagsMap[tag].losses++;
            else tagsMap[tag].evens++;
        });
    });

    const tagAnalysisEl = document.getElementById('tagsAnalysis');
    const sortedTags = Object.entries(tagsMap).sort((a,b) => b[1].pnl - a[1].pnl);
    tagAnalysisEl.innerHTML = sortedTags.map(([name, d]) => `
        <div class="tag-stat-card">
            <span class="tag-name">${name}</span>
            <span class="tag-pnl ${pnlClass(d.pnl)}">${fmtMoney(d.pnl)}</span>
            <span class="tag-winrate">فوز: ${Math.round((d.wins/d.count)*100)}% (${d.count})</span>
            <div class="tag-popover">
                <div class="popover-header">${name}</div>
                <div class="popover-row"><span>الربح/الخسارة:</span><span class="${pnlClass(d.pnl)}">${fmtMoney(d.pnl)}</span></div>
                <div class="popover-row"><span>إجمالي الصفقات:</span><span>${d.count}</span></div>
                <div class="popover-row"><span>رابحة:</span><span class="pnl-pos">${d.wins}</span></div>
                <div class="popover-row"><span>خاسرة:</span><span class="pnl-neg">${d.losses}</span></div>
                <div class="popover-row"><span>متعادلة:</span><span class="pnl-zero">${d.evens}</span></div>
            </div>
        </div>
    `).join('') || '<div style="color:var(--text-muted);padding:20px">لا يوجد بيانات للوسوم بعد</div>';

    const wins = closed.filter(t => t.pnl > 0);
    const losses = closed.filter(t => t.pnl < 0);
    const winRate = closed.length ? Math.round((wins.length / closed.length) * 100) : 0;
    
    const winsCount = wins.length;
    const lossesCount = losses.length;
    const evensCount = closed.length - winsCount - lossesCount;

    const winPct = closed.length ? Math.round((winsCount / closed.length) * 100) : 0;
    const lossPct = closed.length ? Math.round((lossesCount / closed.length) * 100) : 0;
    const evenPct = closed.length ? Math.round((evensCount / closed.length) * 100) : 0;

    const pctEl = document.getElementById('winratePct');
    if (pctEl) pctEl.textContent = winPct + '%';
    
    const circleEl = document.getElementById('winrateCircle');
    if (circleEl) {
        circleEl.style.background = `conic-gradient(var(--gold) ${winPct * 3.6}deg, var(--bg-hover) ${winPct * 3.6}deg)`;
    }

    const barEl = document.getElementById('winrateBar');
    if (barEl) {
        barEl.innerHTML = `
            <div class="winrate-bar-fill win" style="width: ${winPct}%"></div>
            <div class="winrate-bar-fill loss" style="width: ${lossPct}%"></div>
            <div class="winrate-bar-fill even" style="width: ${evenPct}%"></div>
        `;
    }

    const profitFactor = Math.abs(losses.reduce((s,t)=>s+t.pnl,0)) > 0 ? (wins.reduce((s,t)=>s+t.pnl,0) / Math.abs(losses.reduce((s,t)=>s+t.pnl,0))).toFixed(2) : '-';

    const kpisEl = document.getElementById('winrateKpis');
    if (kpisEl) {
        kpisEl.innerHTML = [
            ['إجمالي الصفقات 📑', closed.length, ''],
            ['رابحة 🟢', winsCount, 'pnl-pos'],
            ['خاسرة 🔴', lossesCount, 'pnl-neg'],
            ['صافي P&L 💰', fmtMoney(netTotal), pnlClass(netTotal)],
            ['عامل الربح ⚖️', profitFactor, ''],
            ['متوسط صفقة 📊', fmtMoney(closed.length ? netTotal/closed.length : 0), pnlClass(netTotal)]
        ].map(([l, v, cls]) => `
            <div class="wkpi-item">
                <span class="wkpi-label">${l}</span>
                <span class="wkpi-val ${cls}">${v}</span>
            </div>
        `).join('');
    }

    // === Best Worst Trade ===
    const bWCard = document.getElementById('bestWorstCard');
    const bWCont = document.getElementById('bestWorstContainer');
    if (bWCard && bWCont) {
        if (closed.length > 0) {
            bWCard.style.display = 'block';
            let bestT = closed[0];
            let worstT = closed[0];
            closed.forEach(t => {
                if(t.pnl > bestT.pnl) bestT = t;
                if(t.pnl < worstT.pnl) worstT = t;
            });
            bWCont.innerHTML = `
                <div class="bw-card best">
                    <div class="bw-card-header"><span>🏆 أفضل صفقة</span> <span>${bestT.title || 'بدون عنوان'}</span></div>
                    <div class="bw-pnl" style="color:var(--green)">${fmtMoney(bestT.pnl)}</div>
                    <div class="bw-date">${formatDate(bestT.date)}</div>
                </div>
                <div class="bw-card worst">
                    <div class="bw-card-header"><span>📉 أسوأ صفقة</span> <span>${worstT.title || 'بدون عنوان'}</span></div>
                    <div class="bw-pnl" style="color:var(--red)">${fmtMoney(worstT.pnl)}</div>
                    <div class="bw-date">${formatDate(worstT.date)}</div>
                </div>
            `;
        } else {
            bWCard.style.display = 'none';
        }
    }

    // === Comprehensive Grid ===
    const compGrid = document.getElementById('comprehensiveGrid');
    if (compGrid) {
        if (closed.length > 0) compGrid.style.display = 'grid';
        else compGrid.style.display = 'none';
        
        const sRow = (l, v, cls = '') => `<div class="stat-row"><span class="stat-row-label">${l}</span><span class="stat-row-val ${cls}">${v}</span></div>`;

        // 1. General
        document.getElementById('statGeneral').innerHTML = [
            ['إجمالي الصفقات', trades.length],
            ['صفقات مغلقة', closed.length],
            ['صفقات مفتوحة', trades.length - closed.length],
            ['صفقات رابحة 🟢', winsCount],
            ['صفقات خاسرة 🔴', lossesCount],
            ['صفقات تعادل ⚪', evensCount],
            ['نسبة الفوز', winPct + '%'],
            ['نسبة الخسارة', lossPct + '%'],
            ['عدد الحسابات', selectedAccountIds.length > 0 ? selectedAccountIds.length : state.accounts.length]
        ].map(([l, v]) => sRow(l, v)).join('');

        // 2. Financial
        const avgWin = winsCount ? wins.reduce((s,t)=>s+t.pnl,0)/winsCount : 0;
        const avgLoss = lossesCount ? losses.reduce((s,t)=>s+t.pnl,0)/lossesCount : 0;
        const totalWinPnl = wins.reduce((s,t)=>s+t.pnl,0);
        const totalLossPnl = losses.reduce((s,t)=>s+t.pnl,0);
        const avgLot = closed.length ? (closed.reduce((s,t)=>s+(parseFloat(t.lot)||0),0)/closed.length).toFixed(2) : '-';

        document.getElementById('statFinancial').innerHTML = [
            ['صافي P/L', fmtMoney(netTotal), pnlClass(netTotal)],
            ['إجمالي الأرباح', fmtMoney(totalWinPnl), 'pnl-pos'],
            ['إجمالي الخسائر', fmtMoney(totalLossPnl), 'pnl-neg'],
            ['متوسط ربح / صفقة', fmtMoney(closed.length ? netTotal/closed.length : 0), pnlClass(netTotal)],
            ['متوسط الربح', fmtMoney(avgWin), 'pnl-pos'],
            ['متوسط الخسارة', fmtMoney(avgLoss), 'pnl-neg'],
            ['عامل الربح (PF)', profitFactor],
            ['متوسط حجم اللوت', avgLot]
        ].map(([l, v, c]) => sRow(l, v, c)).join('');

        // 3. Trend Analysis
        const longs = closed.filter(t => t.direction === 'شراء');
        const shorts = closed.filter(t => t.direction === 'بيع');
        const longWins = longs.filter(t => t.pnl > 0).length;
        const shortWins = shorts.filter(t => t.pnl > 0).length;

        document.getElementById('statTrend').innerHTML = [
            ['صفقات شراء (Long)', longs.length],
            ['صفقات بيع (Short)', shorts.length],
            ['رابحة شراء', longWins],
            ['رابحة بيع', shortWins],
            ['نسبة فوز شراء', longs.length ? Math.round((longWins/longs.length)*100)+'%' : '-'],
            ['نسبة فوز بيع', shorts.length ? Math.round((shortWins/shorts.length)*100)+'%' : '-'],
            ['ربح شراء إجمالي', fmtMoney(longs.reduce((s,t)=>s+t.pnl,0)), pnlClass(longs.reduce((s,t)=>s+t.pnl,0))],
            ['ربح بيع إجمالي', fmtMoney(shorts.reduce((s,t)=>s+t.pnl,0)), pnlClass(shorts.reduce((s,t)=>s+t.pnl,0))]
        ].map(([l, v, c]) => sRow(l, v, c)).join('');

        // 4. PIP
        const withTP = closed.filter(t => parseFloat(t.pipTP) > 0);
        const withSL = closed.filter(t => parseFloat(t.pipSL) > 0);
        const avgPipTP = withTP.length ? 'pip ' + (withTP.reduce((s,t)=>s+parseFloat(t.pipTP),0)/withTP.length).toFixed(1) : '-';
        const avgPipSL = withSL.length ? 'pip ' + (withSL.reduce((s,t)=>s+parseFloat(t.pipSL),0)/withSL.length).toFixed(1) : '-';
        const RRPipTP = withTP.length ? (withTP.reduce((s,t)=>s+parseFloat(t.pipTP),0)/withTP.length) : 0;
        const RRPipSL = withSL.length ? (withSL.reduce((s,t)=>s+parseFloat(t.pipSL),0)/withSL.length) : 0;
        
        document.getElementById('statPip').innerHTML = [
            ['متوسط PIP الهدف', avgPipTP],
            ['متوسط PIP الستوب', avgPipSL],
            ['نسبة R:R المتوسطة', RRPipSL > 0 ? (RRPipTP/RRPipSL).toFixed(2) + ' : 1' : '-'],
            ['صفقات بهدف محدد', withTP.length],
            ['صفقات بستوب محدد', withSL.length]
        ].map(([l, v]) => sRow(l, v)).join('');

        // 5. Advanced
        let maxW = 0, curW = 0, maxL = 0, curL = 0;
        const sortedD = [...closed].sort((a,b) => new Date(a.date) - new Date(b.date));
        sortedD.forEach(t => {
            if(t.pnl > 0) { curW++; curL=0; maxW=Math.max(maxW, curW); }
            else if(t.pnl < 0) { curL++; curW=0; maxL=Math.max(maxL, curL); }
            else { curW=0; curL=0; }
        });

        document.getElementById('statAdvanced').innerHTML = [
            ['أطول سلسلة رابحة', maxW + ' صفقات'],
            ['أطول سلسلة خاسرة', maxL + ' صفقات'],
            ['نسبة الفوز', winPct+'%'],
            ['نسبة التعادل', evenPct+'%'],
            ['أفضل صفقة', sortedD.length ? fmtMoney(Math.max(...sortedD.map(t=>t.pnl))) : '-'],
            ['أسوأ صفقة', sortedD.length ? fmtMoney(Math.min(...sortedD.map(t=>t.pnl))) : '-']
        ].map(([l, v]) => sRow(l, v)).join('');

        // 6. Accounts Stats
        const accMap = {};
        state.accounts.forEach(a => accMap[a.id] = { name: a.name, trades: 0, wins: 0, pnl: 0 });
        closed.forEach(t => {
            if(accMap[t.accountId]) {
                accMap[t.accountId].trades++;
                accMap[t.accountId].pnl += t.pnl;
                if(t.pnl > 0) accMap[t.accountId].wins++;
            }
        });
        
        document.getElementById('statAccounts').innerHTML = Object.values(accMap).map(a => {
            const wr = a.trades ? Math.round((a.wins/a.trades)*100) : 0;
            return `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding:16px 0;">
                <div style="text-align:right">
                    <div style="font-size:0.9em; font-weight:600; color:var(--text-secondary); text-align:right">${a.name}</div>
                    <div style="font-size:0.8em; color:var(--text-muted); margin-top:6px; text-align:right">${a.trades} صفقة | فوز ${wr}%</div>
                </div>
                <div style="font-size:1.1em; font-weight:800; color:var(--text-primary)">
                    <span class="${pnlClass(a.pnl)}">${fmtMoney(a.pnl)}</span>
                </div>
            </div>`;
        }).join('') || '<div style="color:var(--text-muted)">لا يوجد بيانات</div>';
    }

    renderCharts(closed);
    
    // Pass closed trades to daily breakdown
    renderDailyBreakdown(closed);
    renderMonthlyBreakdown(closed);
    renderCalendar(trades);
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
    
    sortedTrades.forEach(t => {
        currentEquity += t.pnl;
        equityLabels.push(formatDate(t.date));
        equityData.push(currentEquity);
    });

    // 2. Monthly Bar Chart Data
    const mthMap = {};
    sortedTrades.forEach(t => {
        const d = new Date(t.date);
        const mName = d.toLocaleDateString('ar-SA', { year: 'numeric', month: 'short' });
        const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!mthMap[sortKey]) mthMap[sortKey] = { label: mName, net: 0 };
        mthMap[sortKey].net += t.pnl;
    });

    const mKeys = Object.keys(mthMap).sort();
    const barLabels = mKeys.map(k => mthMap[k].label);
    const barData = mKeys.map(k => mthMap[k].net);
    const barColors = barData.map(v => v >= 0 ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.8)');

    Chart.defaults.color = '#5a6080';
    Chart.defaults.font.family = "'Cairo', sans-serif";
    
    const commonOpts = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: 'rgba(22, 25, 35, 0.95)',
                padding: 12,
                borderColor: 'rgba(245, 200, 66, 0.3)',
                borderWidth: 1,
                callbacks: {
                    label: (ctx) => ' ' + fmtMoney(ctx.parsed.y)
                }
            }
        },
        scales: {
            x: { grid: { display: false } },
            y: { grid: { color: 'rgba(46, 51, 80, 0.3)', borderDash: [5, 5] }, ticks: { callback: v => '$' + v } }
        }
    };

    // Equity (Growth) Chart - Premium Gold Look
    const ctxEquity = document.getElementById('equityChart');
    if (ctxEquity) {
        if (equityChartInstance) equityChartInstance.destroy();
        const ctx = ctxEquity.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, 'rgba(245, 200, 66, 0.4)');
        gradient.addColorStop(1, 'rgba(245, 200, 66, 0.05)');

        equityChartInstance = new Chart(ctxEquity, {
            type: 'line',
            data: {
                labels: equityLabels,
                datasets: [{
                    label: 'الربح التراكمي',
                    data: equityData,
                    borderColor: '#f5c842',
                    borderWidth: 4,
                    pointBackgroundColor: '#1a1d28',
                    pointBorderColor: '#f5c842',
                    pointBorderWidth: 2,
                    pointRadius: sortedTrades.length > 30 ? 0 : 5,
                    pointHoverRadius: 7,
                    fill: true,
                    backgroundColor: gradient,
                    tension: 0.4
                }]
            },
            options: {
                ...commonOpts,
                interaction: { intersect: false, mode: 'index' }
            }
        });
    }

    // Monthly Chart
    const ctxM = document.getElementById('monthlyChart');
    if (ctxM) {
        if (monthlyChartInstance) monthlyChartInstance.destroy();
        monthlyChartInstance = new Chart(ctxM, {
            type: 'bar',
            data: {
                labels: barLabels,
                datasets: [{ 
                    data: barData, 
                    backgroundColor: barColors, 
                    borderRadius: 6,
                    barPercentage: 0.6
                }]
            },
            options: commonOpts
        });
    }
}

function renderDailyBreakdown(closedTrades) {
    const dailyMap = {};
    closedTrades.forEach(t => {
        const d = t.date;
        if (!dailyMap[d]) dailyMap[d] = { count: 0, pnl: 0, wins: 0 };
        dailyMap[d].count++;
        dailyMap[d].pnl += t.pnl;
        if (t.pnl > 0) dailyMap[d].wins++;
    });

    // Get current week range based on weekOffset
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 is Sunday
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek + (weekOffset * 7));
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    // Filter dates in this week
    const filteredDates = Object.keys(dailyMap)
        .filter(d => {
            const date = new Date(d);
            return date >= startOfWeek && date <= endOfWeek;
        })
        .sort((a,b) => new Date(b) - new Date(a));

    // Update range display
    const rangeDisplay = document.getElementById('weekRangeDisplay');
    if (rangeDisplay) {
        const fmtDate = (d) => d.toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' });
        rangeDisplay.textContent = `${fmtDate(startOfWeek)} - ${fmtDate(endOfWeek)}`;
    }

    const maxAbs = Math.max(...Object.values(dailyMap).map(i => Math.abs(i.pnl)), 1);
    const rows = filteredDates.map(d => {
        const item = dailyMap[d];
        const wr = item.count ? Math.round((item.wins / item.count) * 100) : 0;
        const perfPct = (Math.abs(item.pnl)/maxAbs)*100;
        const barClass = item.pnl >= 0 ? 'pos' : 'neg';
        const lossC = item.count - item.wins;
        return `<tr>
            <td style="color:var(--text-secondary)">${formatDate(d)}</td>
            <td style="text-align:center; font-weight:700">${item.count}</td>
            <td style="text-align:center; font-weight:700" class="pnl-pos">${item.wins}</td>
            <td style="text-align:center; font-weight:700" class="pnl-neg">${lossC}</td>
            <td style="text-align:center; font-weight:700" class="${pnlClass(item.pnl)}">${wr}%</td>
            <td class="${pnlClass(item.pnl)}" style="font-weight:700; text-align:center">${fmtMoney(item.pnl)}</td>
            <td style="text-align:left">
                <div class="perf-bar-wrapper">
                    <div class="perf-bar-fill ${barClass}" style="width: ${Math.max(perfPct, 2)}%"></div>
                </div>
            </td>
        </tr>`;
    }).join('');

    const container = document.getElementById('dailyBreakdown');
    if (container) {
        container.innerHTML = `<div class="table-wrap">
            <table class="professional-table">
                <thead>
                    <tr>
                        <th style="color:var(--blue); border-top-right-radius: var(--radius-sm);">التاريخ</th>
                        <th style="color:var(--text-secondary); text-align:center">صفقات</th>
                        <th style="color:var(--green); text-align:center">🟢 رابحة</th>
                        <th style="color:var(--red); text-align:center">🔴 خاسرة</th>
                        <th style="color:var(--gold); text-align:center">🎯 نسبة الفوز</th>
                        <th style="color:var(--text-primary); text-align:center">الربح/الخسارة</th>
                        <th style="color:var(--text-primary); text-align:left; border-top-left-radius: var(--radius-sm);">الأداء</th>
                    </tr>
                </thead>
                <tbody>${rows || '<tr><td colspan="7" style="text-align:center; padding: 20px;">لا توجد تداولات في هذا الأسبوع</td></tr>'}</tbody>
            </table>
        </div>`;
    }
}

function renderMonthlyBreakdown(closedTrades) {
    const mthMap = {};
    closedTrades.forEach(t => {
        const d = new Date(t.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!mthMap[key]) mthMap[key] = { count: 0, pnl: 0, wins: 0, label: d.toLocaleDateString('ar-SA', { year: 'numeric', month: 'long' }) };
        mthMap[key].count++;
        mthMap[key].pnl += t.pnl;
        if (t.pnl > 0) mthMap[key].wins++;
    });

    const sortedKeys = Object.keys(mthMap).sort((a,b) => b.localeCompare(a));
    const maxAbs = Math.max(...Object.values(mthMap).map(i => Math.abs(i.pnl)), 1);
    const rows = sortedKeys.map(k => {
        const item = mthMap[k];
        const wr = item.count ? Math.round((item.wins / item.count) * 100) : 0;
        const perfPct = (Math.abs(item.pnl)/maxAbs)*100;
        const barClass = item.pnl >= 0 ? 'pos' : 'neg';
        const lossC = item.count - item.wins;
        return `<tr>
            <td style="color:var(--text-secondary)">${item.label}</td>
            <td style="text-align:center; font-weight:700">${item.count}</td>
            <td style="text-align:center; font-weight:700" class="pnl-pos">${item.wins}</td>
            <td style="text-align:center; font-weight:700" class="pnl-neg">${lossC}</td>
            <td style="text-align:center; font-weight:700" class="${pnlClass(item.pnl)}">${wr}%</td>
            <td class="${pnlClass(item.pnl)}" style="font-weight:700; text-align:center">${fmtMoney(item.pnl)}</td>
            <td style="text-align:left">
                <div class="perf-bar-wrapper">
                    <div class="perf-bar-fill ${barClass}" style="width: ${Math.max(perfPct, 2)}%"></div>
                </div>
            </td>
        </tr>`;
    }).join('');

    const container = document.getElementById('monthlyBreakdown');
    if (container) {
        container.innerHTML = `<div class="table-wrap">
            <table class="professional-table">
                <thead>
                    <tr>
                        <th style="color:var(--blue); border-top-right-radius: var(--radius-sm);">الشهر</th>
                        <th style="color:var(--text-secondary); text-align:center">صفقات</th>
                        <th style="color:var(--green); text-align:center">🟢 رابحة</th>
                        <th style="color:var(--red); text-align:center">🔴 خاسرة</th>
                        <th style="color:var(--gold); text-align:center">🎯 نسبة الفوز</th>
                        <th style="color:var(--text-primary); text-align:center">الربح/الخسارة</th>
                        <th style="color:var(--text-primary); text-align:left; border-top-left-radius: var(--radius-sm);">الأداء</th>
                    </tr>
                </thead>
                <tbody>${rows || '<tr><td colspan="7" style="text-align:center">لا يوجد بيانات</td></tr>'}</tbody>
            </table>
        </div>`;
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
    if (!t) return;
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
    const el = document.getElementById('currentDate');
    if (el) el.textContent = d.toLocaleDateString('ar-SA', options);
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
// TRADING CALENDAR LOGIC
// ============================================================
let calendarDate = new Date();
let weekOffset = 0; // 0 is current week, -1 last week, etc.

function changeWeek(delta) {
    weekOffset += delta;
    renderStats();
}

function goToCurrentWeek() {
    weekOffset = 0;
    renderStats();
}

function changeMonth(delta) {
    calendarDate.setMonth(calendarDate.getMonth() + delta);
    renderStats(); // This will call renderCalendar
}

function goToCurrentMonth() {
    calendarDate = new Date();
    renderStats();
}

function renderCalendar(trades) {
    const calendarMonthYear = document.getElementById('calendarMonthYear');
    const statsCalendar = document.getElementById('statsCalendar');
    const weeklySummary = document.getElementById('calendarWeeklySummary');
    
    if (!calendarMonthYear || !statsCalendar) return;

    // Clear stale state immediately
    statsCalendar.innerHTML = '';
    if (weeklySummary) weeklySummary.innerHTML = '';

    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();

    // Show month number / year as requested
    calendarMonthYear.textContent = `${String(month + 1).padStart(2, '0')} / ${year}`;

    // Group trades by date for this month (Standardize date key)
    const dailyData = {};
    trades.forEach(t => {
        if (!t || !t.date) return;
        try {
            const d = new Date(t.date);
            if (d.getFullYear() === year && d.getMonth() === month) {
                // Ensure date string is in YYYY-MM-DD format for internal mapping
                const dKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                if (!dailyData[dKey]) dailyData[dKey] = { pnl: 0, count: 0, wins: 0, losses: 0, lot: 0, trades: [] };
                dailyData[dKey].pnl += (Number(t.pnl) || 0);
                dailyData[dKey].count++;
                if (Number(t.pnl) > 0) dailyData[dKey].wins++;
                else if (Number(t.pnl) < 0) dailyData[dKey].losses++;
                dailyData[dKey].lot += (Number(t.lot) || 0);
                dailyData[dKey].trades.push(t);
            }
        } catch (e) { console.error('Error grouping trade for calendar:', e); }
    });

    const firstDay = new Date(year, month, 1).getDay(); // 0 is Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Empty cells for previous month
    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day empty';
        statsCalendar.appendChild(emptyCell);
    }

    let weeklyPnL = [0, 0, 0, 0, 0, 0];
    let weeklyTrades = [0, 0, 0, 0, 0, 0];

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        try {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const data = dailyData[dateStr];
            const dayCell = document.createElement('div');
            dayCell.className = 'calendar-day';
            
            let html = `<span class="day-num">${day}</span>`;
            
            if (data) {
                const pnlClassStr = data.pnl > 0 ? 'pos' : data.pnl < 0 ? 'neg' : '';
                const statusClass = data.pnl > 0 ? 'profit' : data.pnl < 0 ? 'loss' : '';
                dayCell.classList.add('has-trades', statusClass);
                
                html += `
                    <div class="day-content">
                        <span class="day-pnl ${pnlClassStr}">${fmtMoney(data.pnl)}</span>
                        <span class="day-trades">${data.count} صفقات</span>
                    </div>
                    <div class="day-popover">
                        <div class="popover-header">${formatDate(dateStr)}</div>
                        <div class="popover-row"><span>إجمالي الربح/الخسارة:</span><span class="${pnlClassStr}">${fmtMoney(data.pnl)}</span></div>
                        <div class="popover-row"><span>عدد الصفقات:</span><span>${data.count}</span></div>
                        <div class="popover-row"><span>رابحة:</span><span class="pnl-pos">${data.wins}</span></div>
                        <div class="popover-row"><span>خاسرة:</span><span class="pnl-neg">${data.losses}</span></div>
                        <div class="popover-row"><span>حجم اللوت:</span><span>${(data.lot || 0).toFixed(2)}</span></div>
                    </div>
                `;

                // Track weekly summary
                const weekIdx = Math.floor((day + firstDay - 1) / 7);
                if (weekIdx >= 0 && weekIdx < 6) {
                    weeklyPnL[weekIdx] += data.pnl;
                    weeklyTrades[weekIdx] += data.count;
                }
            }
            
            dayCell.innerHTML = html;
            statsCalendar.appendChild(dayCell);
        } catch (dayError) {
            console.error(`Error rendering calendar day ${day}:`, dayError);
        }
    }

    // Weekly Summary Sidebar rendering
    if (weeklySummary) {
        const lastWeekIdx = Math.floor((daysInMonth + firstDay - 1) / 7);
        weeklySummary.innerHTML = weeklyPnL.map((pnl, i) => {
            if (i > lastWeekIdx) return '';
            return `
                <div class="week-stat">
                    <span class="week-label">الأسبوع ${i + 1}</span>
                    <span class="week-pnl ${pnlClass(pnl)}">${fmtMoney(pnl)}</span>
                    <span class="week-trades">${weeklyTrades[i]} صفقات</span>
                </div>
            `;
        }).join('');
    }
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
