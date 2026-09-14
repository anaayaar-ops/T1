import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import AdmZip from "adm-zip";
import { chromium } from "playwright";

// ============================================================
// WOLF Profile Configuration
// ============================================================

// رابط wolf-profile.zip من Google Drive
const WOLF_PROFILE_URL =
    process.env.WOLF_PROFILE_URL || "";

// ============================================================
// ثوابت ثابتة داخل الكود
// ============================================================

const DEFAULT_DEVICE = "web";
const DEFAULT_APP_CHECK_ENABLED = true;

// ============================================================
// Paths
// ============================================================

const WORK_DIR = path.resolve("./wolf-runtime");
const ZIP_PATH = path.join(WORK_DIR, "wolf-profile.zip");
const EXTRACT_DIR = path.join(WORK_DIR, "profile");

// ============================================================
// Browser
// ============================================================

let browserContext = null;
let wolfPage = null;

// ============================================================
// Helpers
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function mask(value) {
    if (!value) {
        return "غير موجود";
    }

    const text = String(value);

    if (text.length <= 16) {
        return `${text.slice(0, 4)}...${text.slice(-4)}`;
    }

    return `${text.slice(0, 8)}...${text.slice(-8)}`;
}

// ============================================================
// Normalize URL
// ============================================================

function normalizeSource(value) {
    if (!value) {
        return "";
    }

    let source = String(value).trim();

    if (
        (source.startsWith('"') && source.endsWith('"')) ||
        (source.startsWith("'") && source.endsWith("'"))
    ) {
        source = source.slice(1, -1).trim();
    }

    if (
        source.startsWith("https:/") &&
        !source.startsWith("https://")
    ) {
        source = source.replace(/^https:\//, "https://");
    }

    if (
        source.startsWith("http:/") &&
        !source.startsWith("http://")
    ) {
        source = source.replace(/^http:\//, "http://");
    }

    return source;
}

// ============================================================
// Google Drive URL
// ============================================================

function convertGoogleDriveUrl(url) {
    const source = normalizeSource(url);

    // --------------------------------------------------------
    // /file/d/FILE_ID/view
    // --------------------------------------------------------

    const fileMatch = source.match(
        /drive\.google\.com\/file\/d\/([^/?#]+)/i
    );

    if (fileMatch) {
        const fileId = fileMatch[1];

        return (
            "https://drive.usercontent.google.com/download" +
            `?id=${encodeURIComponent(fileId)}` +
            "&export=download" +
            "&confirm=t"
        );
    }

    // --------------------------------------------------------
    // /uc?id=FILE_ID
    // --------------------------------------------------------

    const ucMatch = source.match(
        /drive\.google\.com\/uc\?[^#]*id=([^&#]+)/i
    );

    if (ucMatch) {
        const fileId = ucMatch[1];

        return (
            "https://drive.usercontent.google.com/download" +
            `?id=${encodeURIComponent(fileId)}` +
            "&export=download" +
            "&confirm=t"
        );
    }

    // --------------------------------------------------------
    // /open?id=FILE_ID
    // --------------------------------------------------------

    const openMatch = source.match(
        /drive\.google\.com\/open\?[^#]*id=([^&#]+)/i
    );

    if (openMatch) {
        const fileId = openMatch[1];

        return (
            "https://drive.usercontent.google.com/download" +
            `?id=${encodeURIComponent(fileId)}` +
            "&export=download" +
            "&confirm=t"
        );
    }

    return source;
}

// ============================================================
// Download ZIP
// ============================================================

async function downloadProfileZip() {

    if (!WOLF_PROFILE_URL) {
        throw new Error(
            "❌ WOLF_PROFILE_URL غير موجود في GitHub Secret"
        );
    }

    const source =
        normalizeSource(WOLF_PROFILE_URL);

    const directUrl =
        convertGoogleDriveUrl(source);

    console.log("");
    console.log("========================================");
    console.log("☁️ WOLF Chrome Profile");
    console.log("========================================");

    console.log(
        "🌐 المصدر: Google Drive"
    );

    console.log(
        "📡 جاري تحميل wolf-profile.zip..."
    );

    let response;

    try {

        response = await fetch(
            directUrl,
            {
                method: "GET",
                redirect: "follow",

                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/152 Safari/537.36",

                    "Accept":
                        "application/zip,application/octet-stream,*/*"
                }
            }
        );

    } catch (error) {

        throw new Error(
            `❌ فشل الاتصال بـ Google Drive: ${error.message}`
        );
    }

    console.log(
        `📡 HTTP Status: ${response.status}`
    );

    if (!response.ok) {

        throw new Error(
            `❌ فشل تحميل Profile: HTTP ${response.status} ${response.statusText}`
        );
    }

    const buffer =
        Buffer.from(
            await response.arrayBuffer()
        );

    console.log(
        `📦 حجم الملف: ${buffer.length} bytes`
    );

    if (buffer.length < 1000) {

        throw new Error(
            "❌ الملف الذي تم تحميله صغير جدًا أو ليس wolf-profile.zip"
        );
    }

    fs.mkdirSync(
        WORK_DIR,
        {
            recursive: true
        }
    );

    fs.writeFileSync(
        ZIP_PATH,
        buffer
    );

    console.log(
        "✅ تم تحميل wolf-profile.zip"
    );
}

// ============================================================
// Extract ZIP
// ============================================================

function extractProfile() {

    console.log("");
    console.log(
        "📦 جاري فك ضغط wolf-profile.zip..."
    );

    if (!fs.existsSync(ZIP_PATH)) {

        throw new Error(
            "❌ wolf-profile.zip غير موجود"
        );
    }

    // حذف الاستخراج القديم
    if (fs.existsSync(EXTRACT_DIR)) {

        fs.rmSync(
            EXTRACT_DIR,
            {
                recursive: true,
                force: true
            }
        );
    }

    fs.mkdirSync(
        EXTRACT_DIR,
        {
            recursive: true
        }
    );

    const zip =
        new AdmZip(ZIP_PATH);

    zip.extractAllTo(
        EXTRACT_DIR,
        true
    );

    console.log(
        "✅ تم فك ضغط Chrome Profile"
    );

    // ========================================================
    // اكتشاف مكان الـ Profile
    // ========================================================

    const possibleProfiles = [
        EXTRACT_DIR,

        path.join(
            EXTRACT_DIR,
            "wolf-profile"
        ),

        path.join(
            EXTRACT_DIR,
            "Chrome User Data"
        ),

        path.join(
            EXTRACT_DIR,
            "Default"
        )
    ];

    for (const dir of possibleProfiles) {

        if (!fs.existsSync(dir)) {
            continue;
        }

        const hasDefault =
            fs.existsSync(
                path.join(
                    dir,
                    "Default"
                )
            );

        const hasLocalStorage =
            fs.existsSync(
                path.join(
                    dir,
                    "Local Storage"
                )
            );

        const hasCookies =
            fs.existsSync(
                path.join(
                    dir,
                    "Cookies"
                )
            );

        if (
            hasDefault ||
            hasLocalStorage ||
            hasCookies
        ) {

            console.log(
                `📁 Chrome User Data: ${dir}`
            );

            return dir;
        }
    }

    // إذا كان الملف يحتوي مباشرة على Default
    if (
        fs.existsSync(
            path.join(
                EXTRACT_DIR,
                "Default"
            )
        )
    ) {

        return EXTRACT_DIR;
    }

    console.log(
        `📁 استخدام مجلد الاستخراج: ${EXTRACT_DIR}`
    );

    return EXTRACT_DIR;
}

// ============================================================
// Find Chrome
// ============================================================

function findChrome() {

    const candidates = [

        // GitHub Ubuntu
        "/usr/bin/google-chrome",

        "/usr/bin/google-chrome-stable",

        "/usr/bin/chromium",

        "/usr/bin/chromium-browser",

        // Windows
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",

        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",

        path.join(
            process.env.LOCALAPPDATA || "",
            "Google",
            "Chrome",
            "Application",
            "chrome.exe"
        )
    ];

    for (const executable of candidates) {

        if (!executable) {
            continue;
        }

        if (fs.existsSync(executable)) {

            console.log(
                `🌐 Chrome: ${executable}`
            );

            return executable;
        }
    }

    console.log(
        "⚠️ لم يتم العثور على Google Chrome."
    );

    console.log(
        "⚠️ سيتم استخدام Chromium الخاص بـ Playwright."
    );

    return null;
}

// ============================================================
// Open Chrome
// ============================================================

async function startChrome(profileDir) {

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "🌐 تشغيل Chrome باستخدام WOLF Profile"
    );

    console.log(
        "========================================"
    );

    const executablePath =
        findChrome();

    const launchOptions = {

        headless: true,

        viewport: {
            width: 1366,
            height: 768
        },

        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--window-size=1366,768"
        ]
    };

    if (executablePath) {

        launchOptions.executablePath =
            executablePath;
    }

    browserContext =
        await chromium.launchPersistentContext(
            profileDir,
            launchOptions
        );

    const pages =
        browserContext.pages();

    if (pages.length > 0) {

        wolfPage = pages[0];

    } else {

        wolfPage =
            await browserContext.newPage();
    }

    console.log(
        "✅ Chrome يعمل بالـ WOLF Profile"
    );

    console.log(
        "🌐 فتح WOLF..."
    );

    await wolfPage.goto(
        "https://app.wolf.live/",
        {
            waitUntil: "domcontentloaded",
            timeout: 120000
        }
    );

    console.log(
        "✅ تم فتح WOLF"
    );

    // إعطاء WOLF وقتًا لتحميل الجلسة
    console.log(
        "⏳ انتظار تحميل جلسة WOLF..."
    );

    await sleep(10000);

    return browserContext;
}

// ============================================================
// Extract LocalStorage
// ============================================================

async function extractCredentialsFromChrome() {

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "🔐 قراءة WOLF credentials من Chrome"
    );

    console.log(
        "========================================"
    );

    let data = null;

    try {

        data =
            await wolfPage.evaluate(() => {

                const result = {};

                for (
                    let i = 0;
                    i < localStorage.length;
                    i++
                ) {

                    const key =
                        localStorage.key(i);

                    if (!key) {
                        continue;
                    }

                    result[key] =
                        localStorage.getItem(key);
                }

                return result;
            });

    } catch (error) {

        throw new Error(
            `❌ فشل قراءة LocalStorage: ${error.message}`
        );
    }

    // ========================================================
    // Token
    // ========================================================

    const token =
        data?.v3APIToken || null;

    const appCheckToken =
        data?.appCheckToken || null;

    if (!token) {

        console.log(
            "❌ لم يتم العثور على v3APIToken"
        );

        console.log(
            "📍 تأكد أن جلسة WOLF ما زالت صالحة."
        );

        throw new Error(
            "لم يتم العثور على v3APIToken داخل Chrome Profile"
        );
    }

    if (!appCheckToken) {

        console.log(
            "❌ لم يتم العثور على appCheckToken"
        );

        throw new Error(
            "لم يتم العثور على appCheckToken داخل Chrome Profile"
        );
    }

    console.log(
        `🔐 v3APIToken: موجود (${token.length})`
    );

    console.log(
        `🔐 v3APIToken: ${mask(token)}`
    );

    console.log(
        `🛡️ appCheckToken: موجود (${appCheckToken.length})`
    );

    console.log(
        `🛡️ appCheckToken: ${mask(appCheckToken)}`
    );

    console.log("");
    console.log(
        `📱 Device: ${DEFAULT_DEVICE}`
    );

    console.log(
        `🛡️ App Check: ${DEFAULT_APP_CHECK_ENABLED}`
    );

    console.log(
        "========================================"
    );

    return {

        token:
            String(token).trim(),

        appCheckToken:
            String(appCheckToken).trim(),

        // ====================================================
        // ثابتة داخل الكود
        // ====================================================

        device:
            DEFAULT_DEVICE,

        isAppCheckEnabled:
            DEFAULT_APP_CHECK_ENABLED
    };
}

// ============================================================
// Main Loader
// ============================================================

export async function loadSession() {

    console.log("");
    console.log("========================================");
    console.log("🐺 WOLF Chrome Profile Loader");
    console.log("========================================");

    console.log(
        "📦 المصدر: wolf-profile.zip"
    );

    console.log(
        "📱 DEVICE: web"
    );

    console.log(
        "🛡️ APP CHECK: true"
    );

    console.log("========================================");

    // ========================================================
    // Download
    // ========================================================

    await downloadProfileZip();

    // ========================================================
    // Extract
    // ========================================================

    const profileDir =
        extractProfile();

    // ========================================================
    // Start Chrome
    // ========================================================

    await startChrome(
        profileDir
    );

    // ========================================================
    // Read credentials
    // ========================================================

    const credentials =
        await extractCredentialsFromChrome();

    return credentials;
}

// ============================================================
// Optional Browser Access
// ============================================================

export function getBrowserContext() {
    return browserContext;
}

export function getWolfPage() {
    return wolfPage;
}
