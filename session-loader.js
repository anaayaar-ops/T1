import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import AdmZip from "adm-zip";
import { chromium } from "playwright";

let browser = null;
let context = null;
let profileDir = null;


// ============================================================
// تحميل الملف من الرابط
// ============================================================

function downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {

        const request = https.get(url, response => {

            // Redirect
            if (
                response.statusCode >= 300 &&
                response.statusCode < 400 &&
                response.headers.location
            ) {
                response.destroy();

                return downloadFile(
                    response.headers.location,
                    outputPath
                )
                    .then(resolve)
                    .catch(reject);
            }

            if (response.statusCode !== 200) {
                reject(
                    new Error(
                        `فشل تحميل Profile. HTTP ${response.statusCode}`
                    )
                );
                return;
            }

            const file = fs.createWriteStream(outputPath);

            response.pipe(file);

            file.on("finish", () => {
                file.close();
                resolve();
            });

            file.on("error", reject);
        });

        request.on("error", reject);
    });
}


// ============================================================
// تنظيف ملفات Chrome القديمة
// ============================================================

function cleanChromeLocks(dir) {

    const lockFiles = [
        "SingletonLock",
        "SingletonSocket",
        "SingletonCookie",
        "DevToolsActivePort"
    ];

    for (const file of lockFiles) {

        const filePath = path.join(dir, file);

        try {

            if (fs.existsSync(filePath)) {
                fs.rmSync(filePath, {
                    force: true
                });
            }

        } catch (err) {

            console.log(
                `⚠️ تعذر حذف ${file}: ${err.message}`
            );

        }
    }
}


// ============================================================
// البحث عن مجلد Chrome الحقيقي
// ============================================================

function findChromeProfile(root) {

    const possible = [

        path.join(root, "Default"),

        path.join(root, "Profile 1"),

        path.join(root, "Profile 2"),

        path.join(root, "User Data", "Default"),

        path.join(root, "User Data", "Profile 1"),

        path.join(root, "Chrome", "User Data", "Default"),

        path.join(root, "Chrome", "User Data", "Profile 1")

    ];

    for (const dir of possible) {

        if (fs.existsSync(dir)) {
            return dir;
        }
    }

    return null;
}


// ============================================================
// البحث عن Local State
// ============================================================

function findUserDataDir(root) {

    const possible = [

        root,

        path.join(root, "User Data"),

        path.join(root, "Chrome", "User Data")

    ];

    for (const dir of possible) {

        const localState = path.join(
            dir,
            "Local State"
        );

        if (fs.existsSync(localState)) {
            return dir;
        }
    }

    return root;
}


// ============================================================
// استخراج Profile
// ============================================================

async function extractProfile(zipPath) {

    const extractDir = path.join(
        os.tmpdir(),
        `wolf-profile-${Date.now()}`
    );

    fs.mkdirSync(
        extractDir,
        {
            recursive: true
        }
    );

    console.log("📦 جاري فك Chrome Profile...");

    const zip = new AdmZip(zipPath);

    zip.extractAllTo(
        extractDir,
        true
    );

    console.log("✅ تم فك Chrome Profile");

    return extractDir;
}


// ============================================================
// قراءة Tokens من localStorage
// ============================================================

async function readWolfTokens(page) {

    return await page.evaluate(() => {

        const result = {};

        for (let i = 0; i < localStorage.length; i++) {

            const key = localStorage.key(i);

            if (!key) continue;

            let value;

            try {
                value = localStorage.getItem(key);
            } catch {
                continue;
            }

            if (!value) continue;

            const lower = key.toLowerCase();

            if (
                lower.includes("v3apitoken") ||
                lower.includes("v3_api_token")
            ) {
                result.v3APIToken = value;
            }

            if (
                lower.includes("appchecktoken") ||
                lower.includes("app_check_token")
            ) {
                result.appCheckToken = value;
            }

        }

        // فحص إضافي للقيم
        if (!result.v3APIToken) {

            for (let i = 0; i < localStorage.length; i++) {

                const key = localStorage.key(i);

                const value = localStorage.getItem(key);

                if (
                    value &&
                    typeof value === "string" &&
                    value.length > 30 &&
                    value.length < 500 &&
                    value.includes(".")
                ) {

                    const lower =
                        (key || "").toLowerCase();

                    if (
                        lower.includes("token") &&
                        !lower.includes("appcheck")
                    ) {
                        result.v3APIToken = value;
                        break;
                    }
                }
            }
        }

        return result;
    });
}


// ============================================================
// تحميل جلسة WOLF
// ============================================================

export async function loadSession() {

    if (!process.env.WOLF_PROFILE_URL) {
        throw new Error(
            "WOLF_PROFILE_URL غير موجود"
        );
    }

    console.log("🐺 بدء تحميل WOLF Profile...");


    const workDir = path.join(
        os.tmpdir(),
        `wolf-loader-${Date.now()}`
    );

    fs.mkdirSync(
        workDir,
        {
            recursive: true
        }
    );


    const zipPath = path.join(
        workDir,
        "wolf-profile.zip"
    );


    console.log("🌐 جاري تحميل Profile...");

    await downloadFile(
        process.env.WOLF_PROFILE_URL,
        zipPath
    );

    console.log("✅ تم تحميل Profile");


    profileDir = await extractProfile(
        zipPath
    );


    const userDataDir =
        findUserDataDir(profileDir);


    console.log(
        `📁 Chrome User Data: ${userDataDir}`
    );


    cleanChromeLocks(
        userDataDir
    );


    // ========================================================
    // تشغيل Chrome
    // ========================================================

    console.log("🌐 تشغيل Chrome...");

    context = await chromium.launchPersistentContext(
        userDataDir,
        {
            headless: true,

            viewport: {
                width: 1365,
                height: 900
            },

            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-first-run",
                "--no-default-browser-check"
            ]
        }
    );


    browser = context.browser();


    const pages = context.pages();

    let page = pages[0];

    if (!page) {
        page = await context.newPage();
    }


    console.log("🌐 فتح WOLF...");

    await page.goto(
        "https://app.wolf.live/mna",
        {
            waitUntil: "domcontentloaded",
            timeout: 120000
        }
    ).catch(() => {});


    // ========================================================
    // انتظار تحميل LocalStorage
    // ========================================================

    let credentials = null;

    for (let i = 0; i < 30; i++) {

        credentials =
            await readWolfTokens(page);

        if (
            credentials?.v3APIToken &&
            credentials?.appCheckToken
        ) {
            break;
        }

        await new Promise(
            resolve => setTimeout(resolve, 2000)
        );
    }


    if (!credentials?.v3APIToken) {

        throw new Error(
            "❌ لم يتم العثور على v3APIToken داخل جلسة WOLF"
        );
    }


    console.log(
        "🔐 تم العثور على WOLF token"
    );


    if (credentials.appCheckToken) {

        console.log(
            "🛡️ تم العثور على App Check token"
        );

    } else {

        console.log(
            "⚠️ App Check token غير موجود"
        );

    }


    return {

        token: credentials.v3APIToken,

        appCheckToken:
            credentials.appCheckToken || "",

        device: "web",

        isAppCheckEnabled: true,

        page
    };
}


// ============================================================
// إغلاق Chrome
// ============================================================

export async function closeSessionBrowser() {

    try {

        if (context) {

            console.log(
                "🌐 إغلاق Chrome Session..."
            );

            await context.close();

        }

    } catch (err) {

        console.log(
            `⚠️ خطأ أثناء إغلاق Chrome: ${err.message}`
        );

    } finally {

        context = null;
        browser = null;

    }
}
