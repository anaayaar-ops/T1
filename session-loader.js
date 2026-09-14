import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { chromium } from 'playwright';

// ============================================================
// إعدادات
// ============================================================

const PROFILE_URL = process.env.WOLF_PROFILE_URL;

let browserContext = null;
let wolfPage = null;
let extractedProfileDir = null;

// ============================================================
// أدوات مساعدة
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function maskToken(value) {
    if (!value) return 'غير موجود';

    const text = String(value);

    if (text.length <= 16) {
        return `${text.slice(0, 4)}...${text.slice(-4)}`;
    }

    return `${text.slice(0, 8)}...${text.slice(-8)}`;
}

// ============================================================
// استخراج Google Drive File ID
// ============================================================

function extractGoogleDriveFileId(url) {
    if (!url) return null;

    const patterns = [
        /\/file\/d\/([a-zA-Z0-9_-]+)/,
        /[?&]id=([a-zA-Z0-9_-]+)/,
        /\/uc\?id=([a-zA-Z0-9_-]+)/
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);

        if (match?.[1]) {
            return match[1];
        }
    }

    return null;
}

// ============================================================
// تنزيل Google Drive
// ============================================================

async function downloadGoogleDriveFile(fileId) {
    const baseUrl =
        `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`;

    console.log('🌐 تنزيل Chrome Profile من Google Drive...');
    console.log(`🆔 File ID: ${fileId}`);

    let response = await fetch(baseUrl, {
        redirect: 'follow'
    });

    let buffer = Buffer.from(await response.arrayBuffer());

    const contentType =
        response.headers.get('content-type') || '';

    // --------------------------------------------------------
    // إذا كانت Google أعادت صفحة Virus Scan
    // --------------------------------------------------------

    const textStart = buffer
        .subarray(0, Math.min(buffer.length, 200000))
        .toString('utf8');

    const looksLikeHtml =
        contentType.includes('text/html') ||
        textStart.includes('<html') ||
        textStart.includes('Google Drive') ||
        textStart.includes('Virus scan warning');

    if (looksLikeHtml) {
        console.log('⚠️ Google Drive طلب تأكيد تنزيل الملف...');

        const confirmMatch =
            textStart.match(/confirm=([0-9A-Za-z_-]+)/);

        if (confirmMatch?.[1]) {
            const confirmToken = confirmMatch[1];

            const confirmUrl =
                `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=${encodeURIComponent(confirmToken)}`;

            response = await fetch(confirmUrl, {
                redirect: 'follow'
            });

            buffer = Buffer.from(await response.arrayBuffer());

            console.log(
                `📦 تم تنزيل ZIP بعد التأكيد: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`
            );
        } else {
            // ------------------------------------------------
            // محاولة استخراج confirm من نموذج Google
            // ------------------------------------------------

            const formMatch =
                textStart.match(/name="confirm"[^>]*value="([^"]+)"/i);

            if (formMatch?.[1]) {
                const confirmToken = formMatch[1];

                const confirmUrl =
                    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=${encodeURIComponent(confirmToken)}`;

                response = await fetch(confirmUrl, {
                    redirect: 'follow'
                });

                buffer = Buffer.from(await response.arrayBuffer());

                console.log(
                    `📦 تم تنزيل ZIP بعد التأكيد: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`
                );
            } else {
                throw new Error(
                    '❌ Google Drive أعاد صفحة تأكيد ولم يتم العثور على رمز التأكيد.'
                );
            }
        }
    } else {
        console.log(
            `📦 تم تنزيل الملف: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`
        );
    }

    return buffer;
}

// ============================================================
// تنزيل الرابط العام
// ============================================================

async function downloadFile(url) {
    if (!url) {
        throw new Error('❌ WOLF_PROFILE_URL غير موجود');
    }

    const googleDriveId = extractGoogleDriveFileId(url);

    if (googleDriveId) {
        return await downloadGoogleDriveFile(googleDriveId);
    }

    console.log('🌐 تنزيل Profile من الرابط...');

    const response = await fetch(url, {
        redirect: 'follow'
    });

    if (!response.ok) {
        throw new Error(
            `❌ فشل تنزيل Profile: HTTP ${response.status}`
        );
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    console.log(
        `📦 تم تنزيل الملف: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`
    );

    return buffer;
}

// ============================================================
// التحقق من ZIP
// ============================================================

function validateZipFile(buffer) {
    if (!buffer || buffer.length < 4) {
        throw new Error('❌ ملف Profile فارغ أو غير صالح');
    }

    const signature = buffer
        .subarray(0, 4)
        .toString('hex')
        .toLowerCase();

    console.log(`🔎 ZIP Signature: ${signature}`);

    if (
        signature !== '504b0304' &&
        signature !== '504b0506' &&
        signature !== '504b0708'
    ) {
        throw new Error(
            `❌ الملف ليس ZIP صالحًا. Signature: ${signature}`
        );
    }

    console.log('✅ ZIP signature صحيح');
}

// ============================================================
// فك Profile
// ============================================================

function extractProfile(buffer) {
    const tempRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'wolf-profile-')
    );

    const zipPath = path.join(
        tempRoot,
        'wolf-profile.zip'
    );

    fs.writeFileSync(zipPath, buffer);

    console.log('📦 جاري فك Chrome Profile...');

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    console.log(`📁 عدد ملفات Profile: ${entries.length}`);

    zip.extractAllTo(tempRoot, true);

    // --------------------------------------------------------
    // تحديد مجلد Chrome User Data
    // --------------------------------------------------------

    let userDataDir = tempRoot;

    const possibleFolders = [
        path.join(tempRoot, 'profile'),
        path.join(tempRoot, 'Profile'),
        path.join(tempRoot, 'chrome-profile'),
        path.join(tempRoot, 'Chrome User Data'),
        path.join(tempRoot, 'user-data'),
        path.join(tempRoot, 'User Data')
    ];

    for (const folder of possibleFolders) {
        if (fs.existsSync(folder)) {
            userDataDir = folder;
            break;
        }
    }

    // --------------------------------------------------------
    // البحث عن Local State
    // --------------------------------------------------------

    const rootItems = fs.readdirSync(tempRoot);

    if (
        rootItems.includes('Local State') ||
        rootItems.includes('Default')
    ) {
        userDataDir = tempRoot;
    }

    // --------------------------------------------------------
    // إذا كان هناك مجلد واحد يحتوي Profile
    // --------------------------------------------------------

    if (userDataDir === tempRoot) {
        const dirs = rootItems
            .map(name => path.join(tempRoot, name))
            .filter(item => {
                try {
                    return fs.statSync(item).isDirectory();
                } catch {
                    return false;
                }
            });

        for (const dir of dirs) {
            const hasDefault =
                fs.existsSync(path.join(dir, 'Default'));

            const hasLocalState =
                fs.existsSync(path.join(dir, 'Local State'));

            if (hasDefault || hasLocalState) {
                userDataDir = dir;
                break;
            }
        }
    }

    extractedProfileDir = tempRoot;

    console.log(`📂 Chrome User Data: ${userDataDir}`);
    console.log('✅ تم فك Chrome Profile');

    return {
        root: tempRoot,
        userDataDir
    };
}

// ============================================================
// قراءة WOLF Credentials
// ============================================================

async function readWolfTokens(page) {
    const credentials = await page.evaluate(() => {
        const result = {
            token: null,
            appCheckToken: null
        };

        // ----------------------------------------------------
        // localStorage
        // ----------------------------------------------------

        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);

                if (!key) continue;

                const value = localStorage.getItem(key);

                if (!value) continue;

                const lowerKey = key.toLowerCase();

                // v3APIToken
                if (
                    lowerKey.includes('v3apitoken') ||
                    lowerKey.includes('v3_api_token')
                ) {
                    if (!result.token) {
                        result.token = value;
                    }
                }

                // App Check
                if (
                    lowerKey.includes('appchecktoken') ||
                    lowerKey.includes('app_check_token')
                ) {
                    if (!result.appCheckToken) {
                        result.appCheckToken = value;
                    }
                }
            }
        } catch {}

        // ----------------------------------------------------
        // sessionStorage
        // ----------------------------------------------------

        try {
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);

                if (!key) continue;

                const value = sessionStorage.getItem(key);

                if (!value) continue;

                const lowerKey = key.toLowerCase();

                if (
                    !result.token &&
                    (
                        lowerKey.includes('v3apitoken') ||
                        lowerKey.includes('v3_api_token')
                    )
                ) {
                    result.token = value;
                }

                if (
                    !result.appCheckToken &&
                    (
                        lowerKey.includes('appchecktoken') ||
                        lowerKey.includes('app_check_token')
                    )
                ) {
                    result.appCheckToken = value;
                }
            }
        } catch {}

        return result;
    });

    return credentials;
}

// ============================================================
// تشغيل Chrome + WOLF
// ============================================================

async function launchWolfBrowser(userDataDir) {
    console.log('🚀 تشغيل Chromium...');

    browserContext = await chromium.launchPersistentContext(
        userDataDir,
        {
            headless: true,

            viewport: {
                width: 1440,
                height: 900
            },

            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-default-browser-check'
            ]
        }
    );

    const pages = browserContext.pages();

    wolfPage =
        pages[0] ||
        await browserContext.newPage();

    console.log('🌐 فتح WOLF...');

    await wolfPage.goto(
        'https://app.wolf.live/mna',
        {
            waitUntil: 'domcontentloaded',
            timeout: 120000
        }
    );

    console.log(`🌐 WOLF URL: ${wolfPage.url()}`);

    return wolfPage;
}

// ============================================================
// تحميل الجلسة
// ============================================================

export async function loadSession() {
    if (!PROFILE_URL) {
        throw new Error(
            '❌ WOLF_PROFILE_URL غير موجود في Environment'
        );
    }

    console.log('');
    console.log('========================================');
    console.log('🔐 WOLF Chrome Profile');
    console.log('========================================');

    // --------------------------------------------------------
    // تنزيل
    // --------------------------------------------------------

    const zipBuffer = await downloadFile(PROFILE_URL);

    console.log(
        `📏 حجم Profile: ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB`
    );

    // --------------------------------------------------------
    // تحقق
    // --------------------------------------------------------

    validateZipFile(zipBuffer);

    // --------------------------------------------------------
    // فك الضغط
    // --------------------------------------------------------

    const profile = extractProfile(zipBuffer);

    // --------------------------------------------------------
    // تشغيل Chrome
    // --------------------------------------------------------

    const page = await launchWolfBrowser(
        profile.userDataDir
    );

    // --------------------------------------------------------
    // انتظار تحميل WOLF
    // --------------------------------------------------------

    console.log('⏳ انتظار جلسة WOLF...');

    await sleep(5000);

    let credentials = {
        token: null,
        appCheckToken: null
    };

    // --------------------------------------------------------
    // محاولة قراءة credentials
    // --------------------------------------------------------

    for (let i = 1; i <= 60; i++) {
        credentials = await readWolfTokens(page);

        console.log(
            `⏳ قراءة credentials: ${i}/60`
        );

        if (credentials.token) {
            break;
        }

        await sleep(1000);
    }

    // --------------------------------------------------------
    // التحقق من Token الأساسي
    // --------------------------------------------------------

    if (!credentials.token) {
        throw new Error(
            '❌ لم يتم العثور على v3APIToken في Chrome Profile'
        );
    }

    console.log('');
    console.log('========================================');
    console.log('🔐 WOLF Credentials');
    console.log('========================================');

    console.log(
        `🔐 v3APIToken: ${maskToken(credentials.token)}`
    );

    console.log(
        `🔐 Token length: ${credentials.token.length}`
    );

    // --------------------------------------------------------
    // App Check اختياري
    // --------------------------------------------------------

    if (credentials.appCheckToken) {
        console.log(
            `🛡️ appCheckToken: ${maskToken(credentials.appCheckToken)}`
        );

        console.log(
            `🛡️ AppCheck length: ${credentials.appCheckToken.length}`
        );

        console.log('✅ App Check token موجود');
    } else {
        console.log(
            '⚠️ لم يتم العثور على appCheckToken'
        );

        console.log(
            'ℹ️ سيتم المتابعة باستخدام v3APIToken فقط'
        );
    }

    console.log('📱 Device: web');
    console.log('========================================');

    return {
        token: credentials.token,

        appCheckToken:
            credentials.appCheckToken || null,

        device: 'web',

        isAppCheckEnabled:
            Boolean(credentials.appCheckToken),

        page
    };
}

// ============================================================
// إغلاق Chrome
// ============================================================

export async function closeSessionBrowser() {
    try {
        if (browserContext) {
            await browserContext.close();
            browserContext = null;
            wolfPage = null;
        }
    } catch (error) {
        console.error(
            '⚠️ خطأ أثناء إغلاق Chrome:',
            error?.message || error
        );
    }

    // --------------------------------------------------------
    // حذف الملفات المؤقتة
    // --------------------------------------------------------

    if (extractedProfileDir) {
        try {
            fs.rmSync(
                extractedProfileDir,
                {
                    recursive: true,
                    force: true
                }
            );
        } catch {}
    }

    extractedProfileDir = null;
}
