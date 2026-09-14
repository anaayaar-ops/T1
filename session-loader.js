import fs from "fs";
import path from "path";

// ============================================================
// WOLF Session JSON Configuration
// ============================================================

// يمكن أن يكون:
// 1) رابط مباشر إلى JSON
// 2) رابط Google Drive sharing
// 3) مسار ملف JSON محلي
const WOLF_PROFILE_URL =
    process.env.WOLF_PROFILE_URL || "";

const DEFAULT_DEVICE = "web";
const DEFAULT_APP_CHECK_ENABLED = true;

// ============================================================
// Helpers
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// Mask sensitive values
// ============================================================

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

    // إزالة علامات الاقتباس إذا كانت موجودة
    if (
        (source.startsWith('"') && source.endsWith('"')) ||
        (source.startsWith("'") && source.endsWith("'"))
    ) {
        source = source.slice(1, -1).trim();
    }

    // إصلاح:
    // https:/example.com
    // إلى:
    // https://example.com

    if (
        source.startsWith("https:/") &&
        !source.startsWith("https://")
    ) {
        source = source.replace(/^https:\//, "https://");
    }

    // إصلاح:
    // http:/example.com
    // إلى:
    // http://example.com

    if (
        source.startsWith("http:/") &&
        !source.startsWith("http://")
    ) {
        source = source.replace(/^http:\//, "http://");
    }

    return source;
}

// ============================================================
// Google Drive URL -> Direct Download URL
// ============================================================

function convertGoogleDriveUrl(url) {
    if (!url) {
        return url;
    }

    const source = normalizeSource(url);

    // ========================================================
    // Google Drive:
    //
    // https://drive.google.com/file/d/FILE_ID/view?usp=sharing
    // ========================================================

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

    // ========================================================
    // Google Drive:
    //
    // https://drive.google.com/uc?id=FILE_ID
    // ========================================================

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

    // ========================================================
    // Google Drive:
    //
    // https://drive.google.com/open?id=FILE_ID
    // ========================================================

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
// Read JSON from URL
// ============================================================

async function readJsonFromUrl(url) {
    const source = normalizeSource(url);
    const directUrl = convertGoogleDriveUrl(source);

    console.log("");
    console.log("========================================");
    console.log("🌐 WOLF Session JSON Download");
    console.log("========================================");

    console.log(`🔗 المصدر: ${source}`);

    if (directUrl !== source) {
        console.log(
            "☁️ تم تحويل رابط Google Drive إلى رابط تحميل مباشر"
        );
    }

    console.log("📡 جاري تحميل JSON...");

    let response;

    try {
        response = await fetch(directUrl, {
            method: "GET",
            redirect: "follow",
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36",

                "Accept":
                    "application/json,text/plain,*/*"
            }
        });
    } catch (error) {
        throw new Error(
            `فشل الاتصال برابط WOLF session: ${error.message}`
        );
    }

    console.log(
        `📡 HTTP Status: ${response.status}`
    );

    if (!response.ok) {
        throw new Error(
            `فشل تحميل JSON: HTTP ${response.status} ${response.statusText}`
        );
    }

    const finalUrl =
        response.url || directUrl;

    console.log(
        `🔗 الرابط النهائي: ${finalUrl}`
    );

    const text =
        await response.text();

    if (!text || !text.trim()) {
        throw new Error(
            "ملف WOLF session JSON فارغ"
        );
    }

    console.log(
        `📦 حجم البيانات المستلمة: ${Buffer.byteLength(
            text,
            "utf8"
        )} bytes`
    );

    // ========================================================
    // Parse JSON
    // ========================================================

    try {
        return JSON.parse(text);
    } catch (error) {
        // غالبًا يعني أن Google Drive أعاد HTML
        const preview =
            text
                .replace(/\s+/g, " ")
                .slice(0, 200);

        console.log("");
        console.log(
            "⚠️ بداية البيانات المستلمة:"
        );
        console.log(preview);

        throw new Error(
            "الملف الذي تم تحميله ليس JSON صالحًا. " +
            "تأكد أن رابط Google Drive يشير إلى ملف JSON وأن الملف متاح للتنزيل."
        );
    }
}

// ============================================================
// Read local JSON
// ============================================================

function readJsonFromFile(filePath) {
    const absolutePath =
        path.resolve(filePath);

    console.log("");
    console.log("========================================");
    console.log("📁 قراءة WOLF session JSON من ملف محلي");
    console.log("========================================");

    console.log(
        absolutePath
    );

    if (!fs.existsSync(absolutePath)) {
        throw new Error(
            `ملف WOLF session غير موجود: ${absolutePath}`
        );
    }

    const stats =
        fs.statSync(absolutePath);

    if (!stats.isFile()) {
        throw new Error(
            `المسار ليس ملفًا: ${absolutePath}`
        );
    }

    const text =
        fs.readFileSync(
            absolutePath,
            "utf8"
        );

    if (!text || !text.trim()) {
        throw new Error(
            "ملف WOLF session JSON فارغ"
        );
    }

    console.log(
        `📦 حجم الملف: ${Buffer.byteLength(
            text,
            "utf8"
        )} bytes`
    );

    try {
        return JSON.parse(text);
    } catch {
        throw new Error(
            "ملف WOLF session المحلي ليس JSON صالحًا"
        );
    }
}

// ============================================================
// Load JSON
// ============================================================

async function loadSessionJson() {
    if (!WOLF_PROFILE_URL) {
        throw new Error(
            "WOLF_PROFILE_URL غير موجود"
        );
    }

    // ========================================================
    // Normalize source
    // ========================================================

    const source =
        normalizeSource(
            WOLF_PROFILE_URL
        );

    console.log("");
    console.log("========================================");
    console.log("🔐 WOLF Session Source");
    console.log("========================================");

    // لا نطبع الرابط كاملًا لحماية الـ Secret
    if (
        source.startsWith("https://") ||
        source.startsWith("http://")
    ) {
        console.log(
            "🌐 نوع المصدر: رابط HTTPS/HTTP"
        );
    } else {
        console.log(
            "📁 نوع المصدر: ملف محلي"
        );
    }

    console.log("========================================");

    // ========================================================
    // URL
    // ========================================================

    if (
        source.startsWith("http://") ||
        source.startsWith("https://")
    ) {
        return await readJsonFromUrl(
            source
        );
    }

    // ========================================================
    // Local file
    // ========================================================

    return readJsonFromFile(
        source
    );
}

// ============================================================
// Extract WOLF credentials from JSON
// ============================================================

function extractCredentials(session) {
    if (
        !session ||
        typeof session !== "object" ||
        Array.isArray(session)
    ) {
        throw new Error(
            "بيانات WOLF session غير صالحة"
        );
    }

    /*
     * الشكل المتوقع:
     *
     * {
     *   "localStorage": {
     *      "v3APIToken": "...",
     *      "appCheckToken": "..."
     *   }
     * }
     *
     * أو:
     *
     * {
     *   "v3APIToken": "...",
     *   "appCheckToken": "..."
     * }
     */

    const localStorage =
        session.localStorage || {};

    // ========================================================
    // v3APIToken
    // ========================================================

    const token =
        localStorage.v3APIToken ??
        session.v3APIToken ??
        null;

    // ========================================================
    // appCheckToken
    // ========================================================

    const appCheckToken =
        localStorage.appCheckToken ??
        session.appCheckToken ??
        null;

    // ========================================================
    // Validate token
    // ========================================================

    if (
        token === null ||
        token === undefined ||
        String(token).trim() === ""
    ) {
        throw new Error(
            "❌ لم يتم العثور على v3APIToken داخل JSON"
        );
    }

    // ========================================================
    // Validate App Check
    // ========================================================

    if (
        appCheckToken === null ||
        appCheckToken === undefined ||
        String(appCheckToken).trim() === ""
    ) {
        throw new Error(
            "❌ لم يتم العثور على appCheckToken داخل JSON"
        );
    }

    // ========================================================
    // Return credentials
    // ========================================================

    return {
        token: String(token).trim(),

        appCheckToken:
            String(appCheckToken).trim(),

        device:
            DEFAULT_DEVICE,

        isAppCheckEnabled:
            DEFAULT_APP_CHECK_ENABLED
    };
}

// ============================================================
// Main
// ============================================================

export async function loadSession() {
    console.log("");
    console.log("========================================");
    console.log("🐺 WOLF Session Loader - JSON");
    console.log("========================================");

    // ========================================================
    // Load JSON
    // ========================================================

    const session =
        await loadSessionJson();

    console.log("");
    console.log(
        "✅ تم تحميل WOLF session JSON بنجاح"
    );

    // ========================================================
    // Extract credentials
    // ========================================================

    const credentials =
        extractCredentials(
            session
        );

    // ========================================================
    // Print safe information
    // ========================================================

    console.log("");
    console.log("========================================");
    console.log("🔐 WOLF Credentials");
    console.log("========================================");

    console.log(
        `🔐 v3APIToken: موجود (${credentials.token.length})`
    );

    console.log(
        `🔐 v3APIToken: ${mask(
            credentials.token
        )}`
    );

    console.log(
        `🛡️ appCheckToken: موجود (${credentials.appCheckToken.length})`
    );

    console.log(
        `🛡️ appCheckToken: ${mask(
            credentials.appCheckToken
        )}`
    );

    console.log(
        `📱 DEFAULT_DEVICE: ${credentials.device}`
    );

    console.log(
        `🛡️ DEFAULT_APP_CHECK_ENABLED: ${credentials.isAppCheckEnabled}`
    );

    console.log(
        "========================================"
    );

    return credentials;
}
