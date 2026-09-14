import fs from "fs";
import path from "path";

// ============================================================
// WOLF Session JSON Configuration
// ============================================================

// يمكن أن يكون:
// 1) رابط مباشر إلى JSON
// 2) Google Drive sharing URL
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

function mask(value) {
    if (!value) return "غير موجود";

    const text = String(value);

    if (text.length <= 16) {
        return `${text.slice(0, 4)}...${text.slice(-4)}`;
    }

    return `${text.slice(0, 8)}...${text.slice(-8)}`;
}

// ============================================================
// Google Drive URL -> Direct Download URL
// ============================================================

function convertGoogleDriveUrl(url) {
    if (!url) return url;

    // مثال:
    // https://drive.google.com/file/d/FILE_ID/view?usp=sharing

    const match = url.match(
        /drive\.google\.com\/file\/d\/([^/]+)/
    );

    if (match) {
        const fileId = match[1];

        return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(
            fileId
        )}&export=download&confirm=t`;
    }

    // مثال:
    // https://drive.google.com/uc?id=FILE_ID
    const ucMatch = url.match(
        /drive\.google\.com\/uc\?.*id=([^&]+)/
    );

    if (ucMatch) {
        const fileId = ucMatch[1];

        return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(
            fileId
        )}&export=download&confirm=t`;
    }

    return url;
}

// ============================================================
// Read JSON from URL
// ============================================================

async function readJsonFromUrl(url) {
    const directUrl = convertGoogleDriveUrl(url);

    console.log("🌐 تحميل WOLF session JSON...");
    console.log(`🔗 المصدر: ${url}`);

    if (directUrl !== url) {
        console.log("☁️ تم تحويل رابط Google Drive إلى رابط تحميل مباشر");
    }

    const response = await fetch(directUrl, {
        method: "GET",
        redirect: "follow",
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36",
            "Accept": "application/json,text/plain,*/*"
        }
    });

    if (!response.ok) {
        throw new Error(
            `فشل تحميل JSON: HTTP ${response.status} ${response.statusText}`
        );
    }

    const text = await response.text();

    if (!text.trim()) {
        throw new Error("ملف WOLF session JSON فارغ");
    }

    try {
        return JSON.parse(text);
    } catch {
        throw new Error(
            "الملف الذي تم تحميله ليس JSON صالحًا"
        );
    }
}

// ============================================================
// Read local JSON
// ============================================================

function readJsonFromFile(filePath) {
    const absolutePath = path.resolve(filePath);

    console.log("📁 قراءة WOLF session JSON من ملف محلي:");
    console.log(absolutePath);

    if (!fs.existsSync(absolutePath)) {
        throw new Error(
            `ملف WOLF session غير موجود: ${absolutePath}`
        );
    }

    const text = fs.readFileSync(
        absolutePath,
        "utf8"
    );

    if (!text.trim()) {
        throw new Error("ملف WOLF session JSON فارغ");
    }

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

    // إذا كان مسار ملف محلي
    if (
        WOLF_PROFILE_URL.startsWith(".") ||
        WOLF_PROFILE_URL.startsWith("/") ||
        WOLF_PROFILE_URL.includes(":\\") ||
        WOLF_PROFILE_URL.includes(":/")
    ) {
        return readJsonFromFile(WOLF_PROFILE_URL);
    }

    // إذا كان رابط
    if (
        WOLF_PROFILE_URL.startsWith("http://") ||
        WOLF_PROFILE_URL.startsWith("https://")
    ) {
        return await readJsonFromUrl(
            WOLF_PROFILE_URL
        );
    }

    // محاولة اعتباره ملفًا محليًا
    return readJsonFromFile(WOLF_PROFILE_URL);
}

// ============================================================
// Extract WOLF credentials from JSON
// ============================================================

function extractCredentials(session) {
    if (!session || typeof session !== "object") {
        throw new Error(
            "بيانات WOLF session غير صالحة"
        );
    }

    /*
     * الشكل المتوقع للملف:
     *
     * {
     *   "localStorage": {
     *      "v3APIToken": "...",
     *      "appCheckToken": "..."
     *   }
     * }
     *
     * ونسمح أيضًا إذا كانت القيم مباشرة:
     *
     * {
     *   "v3APIToken": "...",
     *   "appCheckToken": "..."
     * }
     */

    const localStorage =
        session.localStorage || {};

    const token =
        localStorage.v3APIToken ??
        session.v3APIToken ??
        null;

    const appCheckToken =
        localStorage.appCheckToken ??
        session.appCheckToken ??
        null;

    if (!token) {
        throw new Error(
            "❌ لم يتم العثور على v3APIToken داخل JSON"
        );
    }

    if (!appCheckToken) {
        throw new Error(
            "❌ لم يتم العثور على appCheckToken داخل JSON"
        );
    }

    return {
        token: String(token),
        appCheckToken: String(appCheckToken),

        // ثابت حسب طلبك
        device: DEFAULT_DEVICE,
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

    const session =
        await loadSessionJson();

    console.log("✅ تم تحميل JSON بنجاح");

    const credentials =
        extractCredentials(session);

    console.log("");
    console.log("========================================");
    console.log("🔐 WOLF Credentials");
    console.log("========================================");

    console.log(
        `🔐 v3APIToken: موجود (${credentials.token.length})`
    );

    console.log(
        `🔐 v3APIToken: ${mask(credentials.token)}`
    );

    console.log(
        `🛡️ appCheckToken: موجود (${credentials.appCheckToken.length})`
    );

    console.log(
        `🛡️ appCheckToken: ${mask(credentials.appCheckToken)}`
    );

    console.log(
        `📱 DEFAULT_DEVICE: ${credentials.device}`
    );

    console.log(
        `🛡️ DEFAULT_APP_CHECK_ENABLED: ${credentials.isAppCheckEnabled}`
    );

    console.log("========================================");

    return credentials;
}
