import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { chromium } from 'playwright';

// ============================================================
// الإعدادات
// ============================================================

const PROFILE_URL = process.env.WOLF_PROFILE_URL;
const FORCE_FRESH_DOWNLOAD = process.env.FORCE_FRESH_DOWNLOAD === 'true';

const PROFILE_CACHE_DIR = process.env.PROFILE_CACHE_DIR
    ? path.resolve(process.env.PROFILE_CACHE_DIR)
    : path.join(process.cwd(), 'profile-cache');

const USER_DATA_DIR = path.join(PROFILE_CACHE_DIR, 'user-data');

let browserContext = null;
let wolfPage = null;

// ============================================================
// أدوات مساعدة
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
    if (sig !== '504b0304' && sig !== '504b0506' && sig !== '504b0708') {
        throw new Error(`❌ ليس ZIP صالحًا (${sig})`);
    }
}

// ============================================================
// استخراج البروفايل
// ============================================================

function findUserDataRoot(dir) {
    if (!fs.existsSync(dir)) return null;
    if (fs.existsSync(path.join(dir, 'Default')) || fs.existsSync(path.join(dir, 'Local State'))) return dir;

    const knownNames = ['profile', 'Profile', 'chrome-profile', 'Chrome User Data', 'user-data', 'User Data'];
    for (const name of knownNames) {
        const sub = path.join(dir, name);
        if (fs.existsSync(path.join(sub, 'Default')) || fs.existsSync(path.join(sub, 'Local State'))) return sub;
    }

    let items = [];
    try { items = fs.readdirSync(dir); } catch { return null; }

    for (const name of items) {
        const sub = path.join(dir, name);
        try { if (!fs.statSync(sub).isDirectory()) continue; } catch { continue; }
        if (fs.existsSync(path.join(sub, 'Default')) || fs.existsSync(path.join(sub, 'Local State'))) return sub;
    }
    return null;
}

function extractProfile(buffer) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    console.log('📦 فك إلى:', USER_DATA_DIR);

    const zip = new AdmZip(buffer);
    zip.extractAllTo(USER_DATA_DIR, true);

    const root = findUserDataRoot(USER_DATA_DIR);
    if (!root) throw new Error('❌ لا يوجد بروفايل صالح بعد الفك');
    console.log('📂 User Data Root:', root);
    return root;
}

// ============================================================
// قراءة التوكنات (LocalStorage + IndexedDB)
// ============================================================

async function readWolfTokens(page) {
    return await page.evaluate(async () => {
        const result = { token: null, appCheckToken: null };

        const scanStorage = (storage) => {
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
        scanStorage(localStorage);
        scanStorage(sessionStorage);

        if (result.appCheckToken && result.token) return result;

        try {
            const databases = await indexedDB.databases();
            for (const dbInfo of databases) {
                if (!dbInfo.name) continue;
                const db = await new Promise((resolve) => {
                    const req = indexedDB.open(dbInfo.name);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => resolve(null);
                });
                if (!db) continue;

                if (db.objectStoreNames.contains('firebaseLocalStorage')) {
                    const tx = db.transaction('firebaseLocalStorage', 'readonly');
                    const store = tx.objectStore('firebaseLocalStorage');
                    const allRecords = await new Promise((resolve) => {
                        const req = store.getAll();
                        req.onsuccess = () => resolve(req.result);
                        req.onerror = () => resolve([]);
                    });

                    for (const record of allRecords) {
                        if (record && record.value && record.value.key) {
                            const k = record.value.key.toLowerCase();
                            const v = record.value.value;
                            if (!result.token && (k.includes('v3apitoken') || k.includes('v3_api_token'))) result.token = v;
                            if (!result.appCheckToken && (k.includes('appchecktoken') || k.includes('app_check_token'))) result.appCheckToken = v;
                        }
                    }
                }
                db.close();
            }
        } catch (e) {}
        return result;
    });
}

// ============================================================
// تشغيل المتصفح
// ============================================================

async function launchWolfBrowser(userDataDir) {
    console.log('🚀 تشغيل Chromium...');

    browserContext = await chromium.launchPersistentContext(userDataDir, {
        headless: false, // ✅ مرئي لضمان توليد appCheckToken
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
// تحميل الجلسة
// ============================================================

export async function loadSession() {
    console.log('');
    console.log('========================================');
    console.log('🔐 WOLF Chrome Profile');
    console.log('========================================');
    console.log('📂 Cache Dir:', PROFILE_CACHE_DIR);
    console.log('📂 User Data:', USER_DATA_DIR);

    let userDataDir;

    if (FORCE_FRESH_DOWNLOAD) {
        console.log('🔄 تفعيل التحميل المباشر (تجاهل الكاش)...');
        if (fs.existsSync(USER_DATA_DIR)) {
            fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
            console.log('🗑️ تم حذف البروفايل القديم.');
        }
        if (!PROFILE_URL) throw new Error('❌ WOLF_PROFILE_URL غير موجود');
        console.log('📥 تنزيل من Google Drive...');
        const zipBuffer = await downloadFile(PROFILE_URL);
        validateZipFile(zipBuffer);
        userDataDir = extractProfile(zipBuffer);
    } else {
        const existingRoot = findUserDataRoot(USER_DATA_DIR);
        if (existingRoot) {
            userDataDir = existingRoot;
            console.log('✅ استخدام البروفايل من Cache');
        } else {
            if (!PROFILE_URL) throw new Error('❌ لا Cache ولا WOLF_PROFILE_URL');
            console.log('📥 لا Cache — تنزيل من Drive...');
            const zipBuffer = await downloadFile(PROFILE_URL);
            validateZipFile(zipBuffer);
            userDataDir = extractProfile(zipBuffer);
        }
    }

    const page = await launchWolfBrowser(userDataDir);

    console.log('⏳ انتظار جلسة WOLF وتوليد appCheckToken...');
    await sleep(5000);

    let credentials = { token: null, appCheckToken: null };
    let attempts = 0;
    const maxAttempts = 90; 

    while (attempts < maxAttempts) {
        credentials = await readWolfTokens(page);
        console.log(`⏳ محاولة ${attempts + 1}/${maxAttempts} | v3APIToken: ${credentials.token ? '✅' : '❌'} | appCheckToken: ${credentials.appCheckToken ? '✅' : '❌'}`);

        if (credentials.token && credentials.appCheckToken) {
            console.log('🎉 تم إيجاد جميع التوكنات بنجاح!');
            break;
        }
        await sleep(1000);
        attempts++;
    }

    if (!credentials.token) throw new Error('❌ لم يتم العثور على v3APIToken');

    console.log('');
    console.log('========================================');
    console.log('🔐 WOLF Credentials');
    console.log('========================================');
    console.log('🔐 v3APIToken:', maskToken(credentials.token));
    if (credentials.appCheckToken) {
        console.log('🛡️ appCheckToken:', maskToken(credentials.appCheckToken));
    } else {
        console.log('⚠️ تحذير: لم يتم العثور على appCheckToken');
    }
    console.log('========================================');

    return {
        token: credentials.token,
        appCheckToken: credentials.appCheckToken || null,
        device: 'web',
        isAppCheckEnabled: Boolean(credentials.appCheckToken),
        page
    };
}

export async function closeSessionBrowser() {
    try {
        if (browserContext) {
            console.log('🔒 إغلاق المتصفح...');
            await browserContext.close();
            browserContext = null;
            wolfPage = null;
        }
    } catch (error) {
        console.error('⚠️ خطأ أثناء الإغلاق:', error?.message || error);
    }
}
