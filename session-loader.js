import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { chromium } from 'playwright';

// ============================================================
// الإعدادات
// ============================================================

const PROFILE_URL = process.env.WOLF_PROFILE_URL;

const PROFILE_CACHE_DIR = process.env.PROFILE_CACHE_DIR
    ? path.resolve(process.env.PROFILE_CACHE_DIR)
    : path.join(process.cwd(), 'profile-cache');

const USER_DATA_DIR = path.join(PROFILE_CACHE_DIR, 'user-data');

let browserContext = null;
let wolfPage = null;

// ============================================================
// أدوات
// ============================================================

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function maskToken(value) {
    if (!value) return 'غير موجود';
    const text = String(value);
    if (text.length <= 16) return `${text.slice(0, 4)}...${text.slice(-4)}`;
    return `${text.slice(0, 8)}...${text.slice(-8)}`;
}

// ============================================================
// Google Drive
// ============================================================

function extractGoogleDriveFileId(url) {
    if (!url) return null;
    const patterns = [
        /\/file\/d\/([a-zA-Z0-9_-]+)/,
        /[?&]id=([a-zA-Z0-9_-]+)/,
        /\/uc\?id=([a-zA-Z0-9_-]+)/
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m?.[1]) return m[1];
    }
    return null;
}

async function downloadGoogleDriveFile(fileId) {
    const baseUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`;
    console.log('🌐 تنزيل من Google Drive...');
    console.log('🆔 File ID:', fileId);

    let response = await fetch(baseUrl, { redirect: 'follow' });
    let buffer = Buffer.from(await response.arrayBuffer());

    const contentType = response.headers.get('content-type') || '';
    const textStart = buffer.subarray(0, Math.min(buffer.length, 200000)).toString('utf8');

    const looksLikeHtml =
        contentType.includes('text/html') ||
        textStart.includes('<html') ||
        textStart.includes('Google Drive') ||
        textStart.includes('Virus scan warning');

    if (looksLikeHtml) {
        console.log('⚠️ Google Drive طلب تأكيد...');
        const confirmMatch = textStart.match(/confirm=([0-9A-Za-z_-]+)/);
        if (confirmMatch?.[1]) {
            const url = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=${encodeURIComponent(confirmMatch[1])}`;
            response = await fetch(url, { redirect: 'follow' });
            buffer = Buffer.from(await response.arrayBuffer());
        } else {
            const formMatch = textStart.match(/name="confirm"[^>]*value="([^"]+)"/i);
            if (formMatch?.[1]) {
                const url = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=${encodeURIComponent(formMatch[1])}`;
                response = await fetch(url, { redirect: 'follow' });
                buffer = Buffer.from(await response.arrayBuffer());
            } else {
                throw new Error('❌ Google Drive أعاد صفحة تأكيد بدون رمز.');
            }
        }
    }

    console.log(`📦 تم التنزيل: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
    return buffer;
}

async function downloadFile(url) {
    if (!url) throw new Error('❌ WOLF_PROFILE_URL غير موجود');

    const gid = extractGoogleDriveFileId(url);
    if (gid) return await downloadGoogleDriveFile(gid);

    console.log('🌐 تنزيل من الرابط...');
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`❌ HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    console.log(`📦 تم التنزيل: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
    return buffer;
}

function validateZipFile(buffer) {
    if (!buffer || buffer.length < 4) throw new Error('❌ ملف فارغ');
    const sig = buffer.subarray(0, 4).toString('hex').toLowerCase();
    console.log('🔎 ZIP Signature:', sig);
    if (sig !== '504b0304' && sig !== '504b0506' && sig !== '504b0708') {
        throw new Error(`❌ ليس ZIP صالحًا (${sig})`);
    }
}

// ============================================================
// كشف بروفايل صالح
// ============================================================

function findUserDataRoot(dir) {
    if (!fs.existsSync(dir)) return null;

    if (fs.existsSync(path.join(dir, 'Default')) || fs.existsSync(path.join(dir, 'Local State'))) {
        return dir;
    }

    const knownNames = ['profile', 'Profile', 'chrome-profile', 'Chrome User Data', 'user-data', 'User Data'];
    for (const name of knownNames) {
        const sub = path.join(dir, name);
        if (fs.existsSync(path.join(sub, 'Default')) || fs.existsSync(path.join(sub, 'Local State'))) {
            return sub;
        }
    }

    let items = [];
    try { items = fs.readdirSync(dir); } catch { return null; }

    for (const name of items) {
        const sub = path.join(dir, name);
        try { if (!fs.statSync(sub).isDirectory()) continue; } catch { continue; }
        if (fs.existsSync(path.join(sub, 'Default')) || fs.existsSync(path.join(sub, 'Local State'))) {
            return sub;
        }
    }
    return null;
}

function extractProfile(buffer) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    console.log('📦 فك إلى:', USER_DATA_DIR);

    const zip = new AdmZip(buffer);
    console.log('📁 عدد الملفات:', zip.getEntries().length);
    zip.extractAllTo(USER_DATA_DIR, true);

    const root = findUserDataRoot(USER_DATA_DIR);
    if (!root) throw new Error('❌ لا يوجد بروفايل صالح بعد الفك');

    console.log('📂 User Data Root:', root);
    return root;
}

// ============================================================
// قراءة التوكنات
// ============================================================

async function readWolfTokens(page) {
    return await page.evaluate(() => {
        const result = { token: null, appCheckToken: null };
        const scan = (storage) => {
            try {
                for (let i = 0; i < storage.length; i++) {
                    const key = storage.key(i);
                    if (!key) continue;
                    const value = storage.getItem(key);
                    if (!value) continue;
                    const lk = key.toLowerCase();
                    if (!result.token && (lk.includes('v3apitoken') || lk.includes('v3_api_token'))) result.token = value;
                    if (!result.appCheckToken && (lk.includes('appchecktoken') || lk.includes('app_check_token'))) result.appCheckToken = value;
                }
            } catch {}
        };
        scan(localStorage);
        scan(sessionStorage);
        return result;
    });
}

// ============================================================
// تشغيل المتصفح
// ============================================================

async function launchWolfBrowser(userDataDir) {
    console.log('🚀 تشغيل Chromium...');

    browserContext = await chromium.launchPersistentContext(userDataDir, {
        headless: true,
        viewport: { width: 1440, height: 900 },
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        locale: 'ar-SA',
        timezoneId: 'Asia/Riyadh',
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check'
        ]
    });

    const pages = browserContext.pages();
    wolfPage = pages[0] || await browserContext.newPage();

    console.log('🌐 فتح WOLF...');
    await wolfPage.goto('https://app.wolf.live/mna', {
        waitUntil: 'domcontentloaded',
        timeout: 120000
    });
    console.log('🌐 URL:', wolfPage.url());

    return wolfPage;
}

// ============================================================
// loadSession
// ============================================================

export async function loadSession() {
    console.log('');
    console.log('========================================');
    console.log('🔐 WOLF Chrome Profile');
    console.log('========================================');
    console.log('📂 Cache Dir:', PROFILE_CACHE_DIR);
    console.log('📂 User Data:', USER_DATA_DIR);

    const existingRoot = findUserDataRoot(USER_DATA_DIR);
    let userDataDir;

    if (existingRoot) {
        userDataDir = existingRoot;
        console.log('✅ استخدام البروفايل من Cache');
        try {
            const stat = fs.statSync(existingRoot);
            console.log('🕐 آخر تعديل:', stat.mtime.toISOString());
        } catch {}
    } else {
        if (!PROFILE_URL) throw new Error('❌ لا Cache ولا WOLF_PROFILE_URL');
        console.log('📥 لا Cache — تنزيل من Drive...');
        const zipBuffer = await downloadFile(PROFILE_URL);
        validateZipFile(zipBuffer);
        userDataDir = extractProfile(zipBuffer);
    }

    const page = await launchWolfBrowser(userDataDir);

    console.log('⏳ انتظار جلسة WOLF...');
    await sleep(5000);

    let credentials = { token: null, appCheckToken: null };

    for (let i = 1; i <= 60; i++) {
        credentials = await readWolfTokens(page);
        console.log(`⏳ قراءة credentials: ${i}/60`);

        if (credentials.token) {
            console.log('✅ تم إيجاد v3APIToken');
            await sleep(8000);
            const refreshed = await readWolfTokens(page);
            if (refreshed.appCheckToken) credentials.appCheckToken = refreshed.appCheckToken;
            break;
        }
        await sleep(1000);
    }

    if (!credentials.token) {
        throw new Error('❌ لم يتم العثور على v3APIToken');
    }

    console.log('');
    console.log('========================================');
    console.log('🔐 WOLF Credentials');
    console.log('========================================');
    console.log('🔐 v3APIToken:', maskToken(credentials.token));
    console.log('🔐 Token length:', credentials.token.length);
    if (credentials.appCheckToken) {
        console.log('🛡️ appCheckToken:', maskToken(credentials.appCheckToken));
        console.log('🛡️ AppCheck length:', credentials.appCheckToken.length);
    } else {
        console.log('⚠️ لا يوجد appCheckToken');
    }
    console.log('📱 Device: web');
    console.log('========================================');

    return {
        token: credentials.token,
        appCheckToken: credentials.appCheckToken || null,
        device: 'web',
        isAppCheckEnabled: Boolean(credentials.appCheckToken),
        page
    };
}

// ============================================================
// إغلاق المتصفح (مع الحفاظ على البروفايل)
// ============================================================

export async function closeSessionBrowser() {
    try {
        if (browserContext) {
            console.log('🔒 إغلاق المتصفح — لحفظ التوكنات المُحدَّثة...');
            await browserContext.close();
            browserContext = null;
            wolfPage = null;
            console.log('✅ تم الإغلاق — البروفايل جاهز للحفظ في Cache');
        }
    } catch (error) {
        console.error('⚠️ خطأ أثناء الإغلاق:', error?.message || error);
    }
    // ⚠️ لا تحذف USER_DATA_DIR — يُحفظ في GitHub Cache
}
