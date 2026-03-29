/* ============================================================
   نظام المصادقة مع Supabase – notion-clone
   ============================================================ */

'use strict';

// ============================================================
// CONSTANTS
// ============================================================
const AUTH_SESSION_KEY = 'tj_auth_session';

// ============================================================
// HELPERS
// ============================================================
function authHashPassword(password) {
    let hash = 0;
    const str = password + '_tj_salt_2025';
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36) + str.length.toString(36);
}

// ============================================================
// SESSION (Local for fast UI)
// ============================================================
function authGetSession() {
    try {
        const raw = localStorage.getItem(AUTH_SESSION_KEY);
        if (!raw) return null;
        const user = JSON.parse(raw);
        // Ensure user ID is a valid UUID to prevent Postgres DB errors
        const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
        if (user && user.id && !uuidRegex.test(user.id)) {
            // Old session format detected (e.g. custom uid text) - force logout
            authClearSession();
            // Reload page smoothly to return to Auth Screen
            setTimeout(() => window.location.reload(), 100);
            return null;
        }
        return user;
    } catch { return null; }
}

function authSetSession(user) {
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(user));
}

function authClearSession() {
    localStorage.removeItem(AUTH_SESSION_KEY);
}

function authCurrentUser() {
    return authGetSession();
}

function authIsLoggedIn() {
    return !!authGetSession();
}

// ============================================================
// AUTH ACTIONS (Supabase)
// ============================================================
async function authLogin(username, password) {
    try {
        const { data: users, error } = await db
            .from('users')
            .select('*')
            .ilike('username', username)
            .limit(1);

        if (error) throw error;

        const user = users[0];

        if (!user) {
            return { success: false, message: 'اسم المستخدم غير موجود' };
        }
        if (user.password_hash !== authHashPassword(password)) {
            return { success: false, message: 'كلمة السر غير صحيحة' };
        }
        if (!user.is_active) {
            return { success: false, message: 'حسابك غير مفعّل بعد. انتظر موافقة الأدمن' };
        }

        authSetSession({
            id: user.id,
            fullname: user.fullname,
            username: user.username,
            isAdmin: user.is_admin,
        });

        return { success: true, user };
    } catch (err) {
        console.error('Login error:', err);
        return { success: false, message: 'حدث خطأ في الاتصال بالسيرفر' };
    }
}

async function authUpdateProfile(fullname, username, password) {
    const user = authCurrentUser();
    if (!user) return { success: false, message: 'غير مسجل الدخول' };
    
    if (!fullname.trim() || !username.trim()) {
        return { success: false, message: 'يرجى ملء الاسم واسم المستخدم' };
    }
    
    if (username.length < 4) {
        return { success: false, message: 'اسم المستخدم يجب أن يكون 4 أحرف على الأقل' };
    }

    try {
        // check username uniqueness if changed
        if (username.trim().toLowerCase() !== user.username.toLowerCase()) {
            const { data: existing } = await db
                .from('users')
                .select('id')
                .ilike('username', username)
                .limit(1);

            if (existing && existing.length > 0) {
                return { success: false, message: 'اسم المستخدم مستخدم بالفعل' };
            }
        }

        const payload = {
            fullname: fullname.trim(),
            username: username.trim(),
        };

        if (password) {
            if (password.length < 6) return { success: false, message: 'كلمة السر يجب أن تكون 6 أحرف على الأقل' };
            payload.password_hash = authHashPassword(password);
            payload.password_plain = password;
        }

        const { error } = await db.from('users').update(payload).eq('id', user.id);
        if (error) throw error;

        // update session
        user.fullname = payload.fullname;
        user.username = payload.username;
        authSetSession(user);

        return { success: true };
    } catch (err) {
        console.error('Update profile error:', err);
        return { success: false, message: 'حدث خطأ أثناء تعديل البيانات' };
    }
}

async function authRegister(fullname, username, password) {
    if (!fullname.trim() || !username.trim() || !password.trim()) {
        return { success: false, message: 'يرجى ملء جميع الحقول' };
    }

    if (username.length < 4) {
        return { success: false, message: 'اسم المستخدم يجب أن يكون 4 أحرف على الأقل' };
    }

    if (password.length < 6) {
        return { success: false, message: 'كلمة السر يجب أن تكون 6 أحرف على الأقل' };
    }

    try {
        const { data: existing } = await db
            .from('users')
            .select('id')
            .ilike('username', username)
            .limit(1);

        if (existing && existing.length > 0) {
            return { success: false, message: 'اسم المستخدم مستخدم بالفعل' };
        }

        const { error } = await db.from('users').insert([{
            fullname: fullname.trim(),
            username: username.trim(),
            password_hash: authHashPassword(password),
            password_plain: password,
            is_admin: false,
            is_active: false
        }]);

        if (error) throw error;

        return { success: true };
    } catch (err) {
        console.error('Register error:', err);
        return { success: false, message: 'حدث خطأ أثناء إنشاء الحساب' };
    }
}

function authLogout() {
    authClearSession();
    authShowAuthScreen();
}

// ============================================================
// ADMIN FUNCTIONS (Supabase)
// ============================================================
async function adminGetUsers() {
    const { data: users, error } = await db
        .from('users')
        .select('*')
        .eq('is_admin', false)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching users:', error);
        return [];
    }
    return users || [];
}

async function adminToggleActivation(userId, currentStatus) {
    const { error } = await db
        .from('users')
        .update({ is_active: !currentStatus })
        .eq('id', userId);

    if (error) {
        console.error('Error toggling user:', error);
        return false;
    }
    return true;
}

async function adminDeleteUser(userId) {
    const { error } = await db
        .from('users')
        .delete()
        .eq('id', userId);

    if (error) {
        console.error('Error deleting user:', error);
        return false;
    }
    return true;
}

// ============================================================
// RENDER ADMIN PAGE
// ============================================================
// ============================================================
// ADMIN DATA AGGREGATION
// ============================================================
async function adminGetFullPlatformData() {
    try {
        // 1. Fetch all users
        const { data: users, error: uErr } = await db.from('users').select('*').order('created_at', { ascending: false });
        if (uErr) throw uErr;

        // 2. Fetch all trades
        const { data: trades, error: tErr } = await db.from('trades').select('user_id, pnl');
        if (tErr) throw tErr;

        // 3. Process data per user
        const stats = {};
        users.forEach(u => {
            stats[u.id] = {
                id: u.id,
                fullname: u.fullname,
                username: u.username,
                isActive: u.is_active,
                isAdmin: u.is_admin,
                createdAt: u.created_at,
                passwordPlain: u.password_plain,
                tradesCount: 0,
                netPnL: 0,
                wins: 0,
                losses: 0,
                grossProfit: 0,
                grossLoss: 0,
                winRate: 0,
                profitFactor: 0
            };
        });

        trades.forEach(t => {
            if (stats[t.user_id]) {
                const s = stats[t.user_id];
                const pnl = parseFloat(t.pnl) || 0;
                s.tradesCount++;
                s.netPnL += pnl;
                if (pnl > 0) {
                    s.wins++;
                    s.grossProfit += pnl;
                } else if (pnl < 0) {
                    s.losses++;
                    s.grossLoss += Math.abs(pnl);
                }
            }
        });

        // 4. Final calculations
        const processedUsers = Object.values(stats).map(s => {
            s.winRate = (s.wins + s.losses) > 0 ? (s.wins / (s.wins + s.losses)) * 100 : 0;
            s.profitFactor = s.grossLoss > 0 ? s.grossProfit / s.grossLoss : (s.grossProfit > 0 ? 99.9 : 0);
            return s;
        });

        return {
            users: processedUsers,
            totalPlatformPnL: processedUsers.reduce((sum, u) => sum + u.netPnL, 0),
            activeUsersCount: processedUsers.filter(u => u.isActive).length,
            totalTradesCount: trades.length
        };
    } catch (err) {
        console.error('Error in adminGetFullPlatformData:', err);
        return null;
    }
}

// ============================================================
// RENDER ADMIN PAGE
// ============================================================
async function adminRenderUsersPage() {
    const tableContainer = document.getElementById('adminUsersTable');
    const statsContainer = document.getElementById('adminStatsGrid');
    const leaderboardContainer = document.getElementById('adminLeaderboard');
    const metricSelect = document.getElementById('adminRankingMetric');

    if (!tableContainer) return;

    // Show Loading
    tableContainer.innerHTML = '<div class="empty-state"><p>جارِ تحميل البيانات...</p></div>';
    if (leaderboardContainer) leaderboardContainer.innerHTML = '<div class="empty-state"><p>جارِ الحساب...</p></div>';

    const data = await adminGetFullPlatformData();
    if (!data) {
        tableContainer.innerHTML = '<div class="empty-state">❌ خطأ في تحميل البيانات</div>';
        return;
    }

    const { users, totalPlatformPnL, activeUsersCount, totalTradesCount } = data;
    const metric = metricSelect ? metricSelect.value : 'pnl';

    // 1. Render Summary Cards
    if (statsContainer) {
        statsContainer.innerHTML = `
            <div class="kpi-card">
                <div class="kpi-icon">👥</div>
                <div class="kpi-info">
                    <span class="kpi-label">إجمالي المستخدمين</span>
                    <span class="kpi-value">${users.length}</span>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon">✅</div>
                <div class="kpi-info">
                    <span class="kpi-label">المستخدمين النشطين</span>
                    <span class="kpi-value" style="color:var(--green)">${activeUsersCount}</span>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon">📊</div>
                <div class="kpi-info">
                    <span class="kpi-label">إجمالي الصفقات</span>
                    <span class="kpi-value">${totalTradesCount}</span>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon">💰</div>
                <div class="kpi-info">
                    <span class="kpi-label">أرباح المنصة</span>
                    <span class="kpi-value ${totalPlatformPnL >= 0 ? 'pnl-pos' : 'pnl-neg'}">${typeof fmtMoney === 'function' ? fmtMoney(totalPlatformPnL) : totalPlatformPnL.toFixed(2)}</span>
                </div>
            </div>
        `;
    }

    // 2. Render User Management Table (Excluding Admins)
    const managedUsers = users.filter(u => !u.isAdmin);
    if (!managedUsers.length) {
        tableContainer.innerHTML = '<div class="empty-state"><p>لا يوجد مستخدمون عاديون مسجلون بعد</p></div>';
    } else {
        tableContainer.innerHTML = `
        <div class="table-wrap">
            <table class="data-table admin-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>الاسم الكامل</th>
                        <th>اسم المستخدم</th>
                        <th>كلمة السر</th>
                        <th>تاريخ التسجيل</th>
                        <th>الحالة</th>
                        <th>إجراءات</th>
                    </tr>
                </thead>
                <tbody>
                    ${managedUsers.map((u, i) => `
                    <tr id="admin-row-${u.id}">
                        <td class="mono" style="color:var(--text-muted)">${i + 1}</td>
                        <td style="font-weight:600">${u.fullname}</td>
                        <td class="mono">${u.username}</td>
                        <td class="mono" style="color:var(--text-muted)">${u.passwordPlain || '••••••'}</td>
                        <td>${new Date(u.createdAt).toLocaleDateString('ar-SA')}</td>
                        <td>
                            <span class="status-badge ${u.isActive ? 'active' : 'inactive'}">
                                ${u.isActive ? '✅ مفعّل' : '⏳ غ/مفعّل'}
                            </span>
                        </td>
                        <td>
                            <div style="display:flex;gap:8px;align-items:center">
                                <button class="btn-activate ${u.isActive ? 'btn-deactivate' : ''}" onclick="adminToggleUser('${u.id}', ${u.isActive})">
                                    ${u.isActive ? '🔒' : '✅'}
                                </button>
                                <button class="btn-danger" onclick="adminDeleteUserConfirm('${u.id}', '${u.fullname}')">🗑️</button>
                            </div>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
    }

    // 3. Render Leaderboard (Ranked)
    if (leaderboardContainer) {
        // Sort users based on metric
        const rankedUsers = [...users].sort((a, b) => {
            if (metric === 'pnl') return b.netPnL - a.netPnL;
            if (metric === 'winrate') return b.winRate - a.winRate;
            if (metric === 'trades') return b.tradesCount - a.tradesCount;
            if (metric === 'pf') return b.profitFactor - a.profitFactor;
            return 0;
        });

        leaderboardContainer.innerHTML = `
            <div class="leaderboard-header leaderboard-row">
                <div class="rank-cell">#</div>
                <div class="user-cell">المتداول</div>
                <div class="val-cell">الربح ($)</div>
                <div class="val-cell">فوز %</div>
                <div class="val-cell">PF</div>
                <div class="val-cell">الصفقات</div>
            </div>
            ${rankedUsers.map((u, i) => {
                const rankClass = i === 0 ? 'rank-gold' : i === 1 ? 'rank-silver' : i === 2 ? 'rank-bronze' : '';
                const rankIcon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
                
                return `
                <div class="leaderboard-row">
                    <div class="rank-cell ${rankClass}">${rankIcon}</div>
                    <div class="user-cell">
                        <span class="user-name">${u.fullname} ${u.isAdmin ? '<small>(Ad)</small>' : ''}</span>
                        <span class="user-username">@${u.username}</span>
                    </div>
                    <div class="val-cell mono ${u.netPnL >= 0 ? 'pnl-pos' : 'pnl-neg'} ${metric === 'pnl' ? 'metric-highlight' : ''}">
                        ${typeof fmtMoney === 'function' ? fmtMoney(u.netPnL) : u.netPnL.toFixed(2)}
                    </div>
                    <div class="val-cell mono ${metric === 'winrate' ? 'metric-highlight' : ''}">${u.winRate.toFixed(1)}%</div>
                    <div class="val-cell mono ${metric === 'pf' ? 'metric-highlight' : ''}">${u.profitFactor.toFixed(2)}</div>
                    <div class="val-cell mono ${metric === 'trades' ? 'metric-highlight' : ''}">${u.tradesCount}</div>
                </div>`;
            }).join('')}
        `;
    }
}

async function adminToggleUser(userId, currentStatus) {
    const success = await adminToggleActivation(userId, currentStatus);
    if (success) {
        adminRenderUsersPage();
        const msg = !currentStatus ? '✅ تم تفعيل الحساب' : '🔒 تم إلغاء تفعيل الحساب';
        if (typeof showToast === 'function') showToast(msg);
    } else {
        if (typeof showToast === 'function') showToast('❌ حدث خطأ أثناء التحديث');
    }
}

async function adminDeleteUserConfirm(userId, fullname) {
    if (!confirm(`هل أنت متأكد من حذف مستخدم "${fullname}" بجميع صفقاته وحساباته؟`)) return;
    const success = await adminDeleteUser(userId);
    if (success) {
        adminRenderUsersPage();
        if (typeof showToast === 'function') showToast('🗑️ تم حذف المستخدم');
    } else {
        if (typeof showToast === 'function') showToast('❌ حدث خطأ أثناء الحذف');
    }
}

// ============================================================
// UI – AUTH SCREEN
// ============================================================
function authShowAuthScreen() {
    document.getElementById('appWrapper').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
    authShowTab('login');
}

function authShowApp() {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appWrapper').style.display = 'flex';
}

function authShowTab(tab) {
    document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tab)?.classList.add('active');

    // Clear messages
    document.getElementById('loginError').textContent = '';
    document.getElementById('registerMsg').textContent = '';
    document.getElementById('registerMsg').className = 'auth-message';
}

async function authHandleLogin(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const origText = btn.textContent;
    btn.textContent = 'جارٍ التحقق...';
    btn.disabled = true;

    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    const result = await authLogin(username, password);

    btn.textContent = origText;
    btn.disabled = false;

    if (!result.success) {
        document.getElementById('loginError').textContent = result.message;
        return;
    }

    authShowApp();
    if (typeof initApp === 'function') initApp();
}

async function authHandleRegister(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const origText = btn.textContent;
    btn.textContent = 'جارٍ الإنشاء...';
    btn.disabled = true;

    const fullname = document.getElementById('regFullname').value.trim();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    
    const result = await authRegister(fullname, username, password);

    btn.textContent = origText;
    btn.disabled = false;

    const msgEl = document.getElementById('registerMsg');
    if (!result.success) {
        msgEl.textContent = result.message;
        msgEl.className = 'auth-message error';
        return;
    }

    msgEl.textContent = '✅ تم إنشاء حسابك بنجاح! انتظر تفعيل الأدمن قبل تسجيل الدخول.';
    msgEl.className = 'auth-message success';
    document.getElementById('registerForm').querySelector('form').reset();
    setTimeout(() => authShowTab('login'), 2500);
}

// ============================================================
// INIT
// ============================================================
function authInit() {
    if (authIsLoggedIn()) {
        authShowApp();
        return true; // app should init
    } else {
        authShowAuthScreen();
        return false;
    }
}
