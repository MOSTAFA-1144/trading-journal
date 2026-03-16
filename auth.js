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
async function adminRenderUsersPage() {
    const container = document.getElementById('adminUsersTable');
    if (!container) return;

    container.innerHTML = '<div class="empty-state"><p>جارِ تحميل المستخدمين...</p></div>';

    const users = await adminGetUsers();

    if (!users.length) {
        container.innerHTML = `
        <div class="empty-state">
            <span class="empty-icon">👥</span>
            <p>لا يوجد مستخدمون مسجلون بعد</p>
        </div>`;
        return;
    }

    // Since we fetch async, re-render html
    container.innerHTML = `
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
                ${users.map((u, i) => `
                <tr id="admin-row-${u.id}">
                    <td class="mono" style="color:var(--text-muted)">${i + 1}</td>
                    <td style="font-weight:600">${u.fullname}</td>
                    <td class="mono">${u.username}</td>
                    <td class="mono" style="color:var(--text-muted)">${u.password_plain || '••••••'}</td>
                    <td>${new Date(u.created_at).toLocaleDateString('ar-SA')}</td>
                    <td>
                        <span class="status-badge ${u.is_active ? 'active' : 'inactive'}">
                            ${u.is_active ? '✅ مفعّل' : '⏳ غير مفعّل'}
                        </span>
                    </td>
                    <td>
                        <div style="display:flex;gap:8px;align-items:center">
                            <button class="btn-activate ${u.is_active ? 'btn-deactivate' : ''}" onclick="adminToggleUser('${u.id}', ${u.is_active})">
                                ${u.is_active ? '🔒 إلغاء التفعيل' : '✅ تفعيل'}
                            </button>
                            <button class="btn-danger" onclick="adminDeleteUserConfirm('${u.id}', '${u.fullname}')">🗑️</button>
                        </div>
                    </td>
                </tr>`).join('')}
            </tbody>
        </table>
    </div>`;
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
