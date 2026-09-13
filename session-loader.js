import { chromium } from "playwright";
import fs from "fs";
import path from "path";

// ============================================================
// WOLF Session Configuration
// ============================================================

const WOLF_URL = "https://app.wolf.live/mna";

const PROFILE_ZIP =
    process.env.WOLF_PROFILE_ZIP ||
    path.resolve("./session.zip");

const RUNTIME_DIR =
    process.env.WOLF_SESSION_DIR ||
    path.join(
        process.env.RUNNER_TEMP || process.cwd(),
        "wolf-session-runtime"
    );

const LOCAL_PROFILE =
    path.resolve("./wolf-profile");

const DEFAULT_DEVICE =
    process.env.WOLF_DEVICE || "web";

const DEFAULT_APP_CHECK_ENABLED =
    String(
        process.env.WOLF_IS_APP_CHECK_ENABLED || "true"
    ).toLowerCase() === "true";


// ============================================================
// Find Chrome Profile
// ============================================================

function findProfileRoot(root) {

    if (!fs.existsSync(root)) {
        return null;
    }

    if (
        fs.existsSync(path.join(root, "Local State")) ||
        fs.existsSync(path.join(root, "Default"))
    ) {
        return root;
    }

    const entries =
        fs.readdirSync(root, {
            withFileTypes: true
        });

    for (const entry of entries) {

        if (!entry.isDirectory()) {
            continue;
        }

        const candidate =
            path.join(root, entry.name);

        if (
            fs.existsSync(
                path.join(candidate, "Local State")
            ) ||
            fs.existsSync(
                path.join(candidate, "Default")
            )
        ) {
            return candidate;
        }
    }

    return null;
}


// ============================================================
// Extract ZIP
// ============================================================

async function extractSessionArchive(
    zipFile,
    destination
) {

    if (!fs.existsSync(zipFile)) {
        throw new Error(
            "Session ZIP not found: " + zipFile
        );
    }

    fs.mkdirSync(
        destination,
        {
            recursive: true
        }
    );

    const childProcess =
        await import("child_process");

    const execFileSync =
        childProcess.execFileSync;

    if (process.platform === "win32") {

        execFileSync(
            "powershell",
            [
                "-NoProfile",
                "-Command",
                "Expand-Archive -LiteralPath '" +
                    zipFile.replace(/'/g, "''") +
                    "' -DestinationPath '" +
                    destination.replace(/'/g, "''") +
                    "' -Force"
            ],
            {
                stdio: "inherit"
            }
        );

        return;
    }

    execFileSync(
        "unzip",
        [
            "-o",
            zipFile,
            "-d",
            destination
        ],
        {
            stdio: "inherit"
        }
    );
}


// ============================================================
// Read WOLF credentials
// ============================================================

async function readWolfCredentials(page) {

    const data =
        await page.evaluate(() => {

            const read = (key) => {
                try {
                    return localStorage.getItem(key);
                } catch {
                    return null;
                }
            };

            return {
                token:
                    read("v3APIToken"),

                appCheckToken:
                    read("appCheckToken")
            };
        });


    // ========================================================
    // Diagnostic information
    // ========================================================

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "🔎 فحص WOLF localStorage"
    );

    console.log(
        "========================================"
    );

    console.log(
        "🔐 v3APIToken موجود:",
        Boolean(data?.token)
    );

    console.log(
        "🔐 v3APIToken length:",
        data?.token?.length ?? 0
    );

    console.log(
        "🛡️ appCheckToken موجود:",
        Boolean(data?.appCheckToken)
    );

    console.log(
        "🛡️ appCheckToken length:",
        data?.appCheckToken?.length ?? 0
    );


    // ========================================================
    // Print partial values only
    // ========================================================

    if (data?.token) {

        console.log(
            "🔐 token البداية:",
            data.token.substring(0, 10)
        );

        console.log(
            "🔐 token النهاية:",
            data.token.slice(-10)
        );
    }

    if (data?.appCheckToken) {

        console.log(
            "🛡️ appCheckToken البداية:",
            data.appCheckToken.substring(0, 10)
        );

        console.log(
            "🛡️ appCheckToken النهاية:",
            data.appCheckToken.slice(-10)
        );
    }

    console.log(
        "========================================"
    );


    // ========================================================
    // Validate
    // ========================================================

    if (
        !data?.token ||
        !data?.appCheckToken
    ) {

        console.log(
            "❌ القيم المطلوبة غير مكتملة."
        );

        return null;
    }


    // ========================================================
    // Return ONLY four values
    // ========================================================

    return {

        device:
            DEFAULT_DEVICE,

        isAppCheckEnabled:
            DEFAULT_APP_CHECK_ENABLED,

        token:
            data.token,

        appCheckToken:
            data.appCheckToken
    };
}


// ============================================================
// Main
// ============================================================

export async function loadSession() {

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "🐺 WOLF Session Loader"
    );

    console.log(
        "========================================"
    );


    // ========================================================
    // Locate Profile
    // ========================================================

    let profileDir = null;

    if (
        !process.env.WOLF_PROFILE_ZIP &&
        fs.existsSync(LOCAL_PROFILE)
    ) {

        console.log(
            "📁 استخدام Chrome profile المحلي:"
        );

        console.log(
            LOCAL_PROFILE
        );

        profileDir =
            LOCAL_PROFILE;

    } else {

        console.log(
            "📦 استخدام WOLF Session ZIP:"
        );

        console.log(
            PROFILE_ZIP
        );


        if (!fs.existsSync(PROFILE_ZIP)) {

            throw new Error(
                "Session ZIP not found: " +
                PROFILE_ZIP
            );
        }


        // ====================================================
        // Clean old runtime
        // ====================================================

        if (fs.existsSync(RUNTIME_DIR)) {

            console.log(
                "🧹 حذف Session runtime القديم..."
            );

            fs.rmSync(
                RUNTIME_DIR,
                {
                    recursive: true,
                    force: true
                }
            );
        }


        fs.mkdirSync(
            RUNTIME_DIR,
            {
                recursive: true
            }
        );


        // ====================================================
        // Extract
        // ====================================================

        console.log(
            "📦 فك ضغط WOLF Chrome Session..."
        );

        await extractSessionArchive(
            PROFILE_ZIP,
            RUNTIME_DIR
        );


        // ====================================================
        // Find profile
        // ====================================================

        profileDir =
            findProfileRoot(
                RUNTIME_DIR
            );


        if (!profileDir) {

            throw new Error(
                "Chrome profile could not be located inside session archive."
            );
        }


        console.log(
            "✅ تم العثور على Chrome profile:"
        );

        console.log(
            profileDir
        );
    }


    // ========================================================
    // Launch Chrome
    // ========================================================

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "🌐 تشغيل Chrome..."
    );

    console.log(
        "========================================"
    );


    const context =
        await chromium.launchPersistentContext(
            profileDir,
            {

                headless: false,

                viewport: {
                    width: 1365,
                    height: 900
                },

                args: [

                    "--disable-blink-features=AutomationControlled",

                    "--no-sandbox",

                    "--disable-dev-shm-usage",

                    "--disable-gpu",

                    "--disable-software-rasterizer",

                    "--window-size=1365,900"
                ]
            }
        );


    try {

        let page;


        // ====================================================
        // Get existing page
        // ====================================================

        const pages =
            context.pages();


        if (pages.length > 0) {

            page =
                pages[0];

        } else {

            page =
                await context.newPage();
        }


        // ====================================================
        // Open WOLF
        // ====================================================

        console.log(
            "🌐 فتح WOLF..."
        );

        console.log(
            WOLF_URL
        );


        await page.goto(
            WOLF_URL,
            {
                waitUntil:
                    "domcontentloaded",

                timeout:
                    60000
            }
        );


        console.log(
            "⏳ انتظار تحميل WOLF..."
        );


        await page.waitForTimeout(
            10000
        );


        // ====================================================
        // First attempt
        // ====================================================

        console.log("");
        console.log(
            "🔎 محاولة قراءة Session..."
        );


        let credentials =
            await readWolfCredentials(
                page
            );


        // ====================================================
        // Retry #1
        // ====================================================

        if (!credentials) {

            console.log("");
            console.log(
                "🔄 Retry #1: إعادة تحميل WOLF..."
            );


            await page.reload(
                {
                    waitUntil:
                        "domcontentloaded",

                    timeout:
                        60000
                }
            );


            await page.waitForTimeout(
                15000
            );


            credentials =
                await readWolfCredentials(
                    page
                );
        }


        // ====================================================
        // Retry #2
        // ====================================================

        if (!credentials) {

            console.log("");
            console.log(
                "🔄 Retry #2: فتح WOLF من جديد..."
            );


            await page.goto(
                WOLF_URL,
                {
                    waitUntil:
                        "domcontentloaded",

                    timeout:
                        60000
                }
            );


            await page.waitForTimeout(
                15000
            );


            credentials =
                await readWolfCredentials(
                    page
                );
        }


        // ====================================================
        // Failed
        // ====================================================

        if (!credentials) {

            throw new Error(
                "Required WOLF credentials were not found."
            );
        }


        // ====================================================
        // Success
        // ====================================================

        console.log("");
        console.log(
            "========================================"
        );

        console.log(
            "✅ تم استخراج WOLF credentials بنجاح"
        );

        console.log(
            "========================================"
        );

        console.log(
            "📱 device:",
            credentials.device
        );

        console.log(
            "🛡️ isAppCheckEnabled:",
            credentials.isAppCheckEnabled
        );

        console.log(
            "🔐 token موجود:",
            Boolean(credentials.token)
        );

        console.log(
            "🔐 token length:",
            credentials.token?.length ?? 0
        );

        console.log(
            "🛡️ appCheckToken موجود:",
            Boolean(credentials.appCheckToken)
        );

        console.log(
            "🛡️ appCheckToken length:",
            credentials.appCheckToken?.length ?? 0
        );

        console.log(
            "========================================"
        );


        // ====================================================
        // Close Chrome
        // ====================================================

        console.log(
            "🔒 إغلاق Chrome..."
        );


        await context.close();


        console.log(
            "✅ تم إغلاق Chrome."
        );


        // ====================================================
        // Return ONLY four values
        // ====================================================

        return {

            device:
                credentials.device,

            isAppCheckEnabled:
                credentials.isAppCheckEnabled,

            token:
                credentials.token,

            appCheckToken:
                credentials.appCheckToken
        };


    } catch (error) {

        try {

            await context.close();

        } catch {
            // Ignore close error
        }

        throw error;
    }
}
