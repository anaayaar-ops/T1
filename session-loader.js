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
// Helpers
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function downloadFile(url, outputPath, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 10) {
            reject(new Error("Too many redirects while downloading profile"));
            return;
        }

        console.log(`🌐 تحميل من: ${url}`);

        const request = https.get(
            url,
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
                    "Accept":
                        "application/zip,application/octet-stream,*/*"
                }
            },
            response => {
                const statusCode = response.statusCode || 0;

                // Redirect
                if (
                    statusCode >= 300 &&
                    statusCode < 400 &&
                    response.headers.location
                ) {
                    const redirectUrl = new URL(
                        response.headers.location,
                        url
                    ).toString();

                    response.resume();

                    console.log(`↪️ Redirect -> ${redirectUrl}`);

                    downloadFile(
                        redirectUrl,
                        outputPath,
                        redirectCount + 1
                    )
                        .then(resolve)
                        .catch(reject);

                    return;
                }

                if (statusCode < 200 || statusCode >= 300) {
                    response.resume();

                    reject(
                        new Error(
                            `HTTP ${statusCode} while downloading profile`
                        )
                    );

                    return;
                }

                const file = fs.createWriteStream(outputPath);

                let totalBytes = 0;

                response.on("data", chunk => {
                    totalBytes += chunk.length;
                });

                response.pipe(file);

                file.on("finish", () => {
                    file.close(() => {
                        console.log(
                            `📦 تم تنزيل الملف: ${(totalBytes / 1024 / 1024).toFixed(
                                2
                            )} MB`
                        );

                        resolve({
                            bytes: totalBytes,
                            contentType:
                                response.headers["content-type"] || ""
                        });
                    });
                });

                file.on("error", error => {
                    try {
                        file.close();
                    } catch {}

                    reject(error);
                });
            }
        );

        request.on("error", reject);

        request.setTimeout(120000, () => {
            request.destroy(
                new Error("Profile download timeout")
            );
        });
    });
}

// ============================================================
// ZIP Validation
// ============================================================

function validateZipFile(zipPath, metadata = {}) {
    if (!fs.existsSync(zipPath)) {
        throw new Error("❌ ملف Profile غير موجود بعد التحميل");
    }

    const stat = fs.statSync(zipPath);

    console.log(
        `📏 حجم Profile: ${(stat.size / 1024 / 1024).toFixed(2)} MB`
    );

    console.log(
        `📄 Content-Type: ${
            metadata.contentType || "غير معروف"
        }`
    );

    if (stat.size === 0) {
        throw new Error(
            "❌ Profile ZIP فارغ — WOLF_PROFILE_URL لم يرجع ملفًا"
        );
    }

    // ZIP files normally start with PK
    const fd = fs.openSync(zipPath, "r");

    try {
        const header = Buffer.alloc(4);

        fs.readSync(fd, header, 0, 4, 0);

        const signature = header.toString("hex");

        console.log(`🔎 ZIP Signature: ${signature}`);

        if (
            signature !== "504b0304" &&
            signature !== "504b0506" &&
            signature !== "504b0708"
        ) {
            // Read first bytes for diagnostics
            const previewBuffer = Buffer.alloc(
                Math.min(200, stat.size)
            );

            fs.readSync(
                fd,
                previewBuffer,
                0,
                previewBuffer.length,
                0
            );

            const preview = previewBuffer
                .toString("utf8")
                .replace(/\s+/g, " ")
                .slice(0, 200);

            console.log(
                `⚠️ بداية الملف ليست ZIP: ${preview}`
            );

            throw new Error(
                "❌ WOLF_PROFILE_URL لا يرجع ZIP صالح. " +
                "غالبًا الرابط يرجع HTML أو صفحة تحميل بدل ملف ZIP."
            );
        }
    } finally {
        fs.closeSync(fd);
    }

    console.log("✅ ZIP signature صحيح");
}

// ============================================================
// Extract Profile
// ============================================================

function cleanChromeLocks(dir) {
    const lockFiles = [
        "SingletonLock",
        "SingletonSocket",
        "SingletonCookie",
        "DevToolsActivePort"
    ];

    for (const file of lockFiles) {
        const fullPath = path.join(dir, file);

        try {
            if (fs.existsSync(fullPath)) {
                fs.rmSync(fullPath, {
                    recursive: true,
                    force: true
                });
            }
        } catch {}
    }
}

function findUserDataDir(rootDir) {
    const candidates = [
        rootDir,
        path.join(rootDir, "User Data"),
        path.join(rootDir, "Chrome User Data"),
        path.join(rootDir, "Default")
    ];

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;

        const localState = path.join(
            candidate,
            "Local State"
        );

        const defaultDir = path.join(
            candidate,
            "Default"
        );

        if (
            fs.existsSync(localState) ||
            fs.existsSync(defaultDir)
        ) {
            return candidate;
        }
    }

    return rootDir;
}

async function extractProfile(zipPath, destination) {
    console.log("📦 جاري فك Chrome Profile...");

    validateZipFile(zipPath);

    let zip;

    try {
        zip = new AdmZip(zipPath);
    } catch (error) {
        throw new Error(
            `❌ تعذر فتح ZIP بعد التحقق منه: ${
                error?.message || error
            }`
        );
    }

    const entries = zip.getEntries();

    if (!entries.length) {
        throw new Error(
            "❌ ZIP لا يحتوي على أي ملفات"
        );
    }

    console.log(
        `📁 عدد ملفات Profile داخل ZIP: ${entries.length}`
    );

    fs.mkdirSync(destination, {
        recursive: true
    });

    zip.extractAllTo(destination, true);

    console.log("✅ تم فك Chrome Profile");

    return findUserDataDir(destination);
}

// ============================================================
// Read WOLF Tokens
// ============================================================

async function readWolfTokens(page) {
    return await page.evaluate(() => {
        const result = {
            token: null,
            appCheckToken: null
        };

        const entries = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);

            if (!key) continue;

            let value = null;

            try {
                value = localStorage.getItem(key);
            } catch {}

            entries.push({
                key,
                value
            });

            const lowerKey = key.toLowerCase();

            if (
                !result.token &&
                (
                    lowerKey.includes("v3apitoken") ||
                    lowerKey.includes("v3_api_token")
                )
            ) {
                result.token = value;
            }

            if (
                !result.appCheckToken &&
                (
                    lowerKey.includes("appchecktoken") ||
                    lowerKey.includes("app_check_token")
                )
            ) {
                result.appCheckToken = value;
            }
        }

        // Fallback search
        if (!result.token) {
            for (const item of entries) {
                if (!item.value) continue;

                const value = String(item.value);

                if (
                    value.length > 100 &&
                    (
                        value.includes("eyJ") ||
                        value.toLowerCase().includes("apitoken")
                    )
                ) {
                    result.token = value;
                    break;
                }
            }
        }

        // Fallback AppCheck
        if (!result.appCheckToken) {
            for (const item of entries) {
                if (!item.value) continue;

                const value = String(item.value);

                if (
                    value.length > 200 &&
                    value.toLowerCase().includes("appcheck")
                ) {
                    result.appCheckToken = value;
                    break;
                }
            }
        }

        return result;
    });
}

// ============================================================
// Load Session
// ============================================================

export async function loadSession() {
    const profileUrl = process.env.WOLF_PROFILE_URL;

    if (!profileUrl) {
        throw new Error(
            "❌ WOLF_PROFILE_URL غير موجود في GitHub Secrets"
        );
    }

    console.log("🐺 بدء تحميل WOLF Profile...");

    const tempRoot = fs.mkdtempSync(
        path.join(
            os.tmpdir(),
            "wolf-profile-"
        )
    );

    const zipPath = path.join(
        tempRoot,
        "wolf-profile.zip"
    );

    const extractPath = path.join(
        tempRoot,
        "profile"
    );

    try {
        console.log("🌐 جاري تحميل Profile...");

        const metadata = await downloadFile(
            profileUrl,
            zipPath
        );

        console.log("✅ تم تحميل Profile");

        validateZipFile(
            zipPath,
            metadata
        );

        profileDir = await extractProfile(
            zipPath,
            extractPath
        );

        cleanChromeLocks(profileDir);

        console.log(
            `📂 Chrome User Data: ${profileDir}`
        );

        console.log(
            "🚀 تشغيل Chromium..."
        );

        context = await chromium.launchPersistentContext(
            profileDir,
            {
                headless: true,

                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-background-networking",
                    "--disable-background-timer-throttling",
                    "--disable-renderer-backgrounding"
                ]
            }
        );

        browser = context.browser();

        let pages = context.pages();

        let page = pages[0];

        if (!page) {
            page = await context.newPage();
        }

        console.log(
            "🌐 فتح WOLF..."
        );

        await page.goto(
            "https://app.wolf.live/mna",
            {
                waitUntil: "domcontentloaded",
                timeout: 120000
            }
        );

        console.log(
            `🌐 WOLF URL: ${page.url()}`
        );

        console.log(
            "⏳ انتظار تحميل جلسة WOLF..."
        );

        let credentials = null;

        for (
            let attempt = 1;
            attempt <= 60;
            attempt++
        ) {
            try {
                credentials =
                    await readWolfTokens(page);
            } catch {}

            if (
                credentials?.token &&
                credentials?.appCheckToken
            ) {
                break;
            }

            if (attempt % 5 === 0) {
                console.log(
                    `⏳ محاولة قراءة WOLF credentials: ${attempt}/60`
                );
            }

            await sleep(1000);
        }

        if (!credentials?.token) {
            throw new Error(
                "❌ لم يتم العثور على v3APIToken داخل Chrome Profile"
            );
        }

        if (!credentials?.appCheckToken) {
            throw new Error(
                "❌ لم يتم العثور على appCheckToken داخل Chrome Profile"
            );
        }

        console.log(
            "✅ تم العثور على WOLF credentials"
        );

        return {
            token: credentials.token,
            appCheckToken: credentials.appCheckToken,
            device: "web",
            isAppCheckEnabled: true,
            page
        };
    } catch (error) {
        console.error(
            "❌ فشل تحميل WOLF Profile:"
        );

        console.error(
            error?.stack || error?.message || error
        );

        throw error;
    }
}

// ============================================================
// Close Browser
// ============================================================

export async function closeSessionBrowser() {
    console.log(
        "🧹 إغلاق Chrome Session..."
    );

    try {
        if (context) {
            await context.close();
        }
    } catch (error) {
        console.error(
            "⚠️ خطأ أثناء إغلاق Chrome:",
            error?.message || error
        );
    }

    browser = null;
    context = null;
    profileDir = null;

    console.log(
        "✅ تم إغلاق Chrome Session"
    );
}
