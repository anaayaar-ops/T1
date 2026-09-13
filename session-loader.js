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

    // Direct Chrome profile
    if (
        fs.existsSync(
            path.join(root, "Local State")
        ) ||
        fs.existsSync(
            path.join(root, "Default")
        )
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
            path.join(
                root,
                entry.name
            );

        if (
            fs.existsSync(
                path.join(
                    candidate,
                    "Local State"
                )
            ) ||
            fs.existsSync(
                path.join(
                    candidate,
                    "Default"
                )
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
            "Session ZIP not found: " +
            zipFile
        );
    }

    fs.mkdirSync(
        destination,
        {
            recursive: true
        }
    );

    const childProcess =
        await import(
            "child_process"
        );

    const execFileSync =
        childProcess.execFileSync;


    if (process.platform === "win32") {

        execFileSync(
            "powershell",
            [
                "-NoProfile",
                "-Command",

                "Expand-Archive -LiteralPath '" +
                    zipFile.replace(
                        /'/g,
                        "''"
                    ) +
                    "' -DestinationPath '" +
                    destination.replace(
                        /'/g,
                        "''"
                    ) +
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
// Read Credentials Directly From Chrome Local Storage
// ============================================================

async function readWolfCredentials(
    page
) {

    const data =
        await page.evaluate(() => {

            function read(key) {

                try {
                    return localStorage.getItem(
                        key
                    );
                } catch {
                    return null;
                }
            }

            return {

                v3APIToken:
                    read("v3APIToken"),

                appCheckToken:
                    read("appCheckToken"),

                deviceToken:
                    read("deviceToken")
            };
        });


    if (!data) {
        return null;
    }


    const v3APIToken =
        data.v3APIToken ||
        data.deviceToken ||
        null;

    const appCheckToken =
        data.appCheckToken ||
        null;


    if (
        !v3APIToken ||
        !appCheckToken
    ) {
        return null;
    }


    return {

        v3APIToken,

        appCheckToken,

        device:
            DEFAULT_DEVICE,

        isAppCheckEnabled:
            DEFAULT_APP_CHECK_ENABLED
    };
}


// ============================================================
// Diagnostic Storage Info
// ============================================================

async function printStorageStatus(
    page
) {

    const storage =
        await page.evaluate(() => {

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

                const value =
                    localStorage.getItem(
                        key
                    );

                result[key] =
                    value?.length || 0;
            }

            return result;
        });


    console.log("");
    console.log(
        "📦 WOLF localStorage status:"
    );


    for (
        const [key, length]
        of Object.entries(storage)
    ) {

        if (
            key === "v3APIToken" ||
            key === "appCheckToken" ||
            key === "deviceToken"
        ) {

            console.log(
                `🔐 ${key}: FOUND (${length})`
            );

        }

    }

    console.log("");
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
        "🔐 Loading WOLF session from Chrome"
    );
    console.log(
        "========================================"
    );
    console.log("");


    // ========================================================
    // Locate Profile
    // ========================================================

    let profileDir = null;


    if (
        !process.env.WOLF_PROFILE_ZIP &&
        fs.existsSync(
            LOCAL_PROFILE
        )
    ) {

        profileDir =
            LOCAL_PROFILE;

        console.log(
            "📁 Using local wolf-profile"
        );

    } else {

        console.log(
            "📦 Session archive detected."
        );


        if (
            !fs.existsSync(
                PROFILE_ZIP
            )
        ) {

            throw new Error(
                "Session ZIP not found: " +
                PROFILE_ZIP
            );
        }


        if (
            fs.existsSync(
                RUNTIME_DIR
            )
        ) {

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


        console.log(
            "📦 Extracting Chrome profile..."
        );


        await extractSessionArchive(
            PROFILE_ZIP,
            RUNTIME_DIR
        );


        profileDir =
            findProfileRoot(
                RUNTIME_DIR
            );


        if (!profileDir) {

            throw new Error(
                "Chrome profile could not be located inside session archive."
            );
        }

    }


    console.log("");
    console.log(
        "📁 Profile: " +
        profileDir
    );
    console.log("");


    // ========================================================
    // Launch Chrome
    // ========================================================

    console.log(
        "🌐 Opening saved Chrome session..."
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

        const pages =
            context.pages();


        if (
            pages.length > 0
        ) {

            page =
                pages[0];

        } else {

            page =
                await context.newPage();

        }


        // ====================================================
        // CDP
        // ====================================================

        const cdp =
            await context.newCDPSession(
                page
            );


        await cdp.send(
            "Network.enable"
        );

        await cdp.send(
            "Page.enable"
        );


        console.log(
            "✅ CDP Network enabled"
        );


        // ====================================================
        // Open WOLF
        // ====================================================

        console.log("");
        console.log(
            "🌐 Opening WOLF..."
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


        console.log("");
        console.log(
            "🌐 Session page: " +
            page.url()
        );


        // ====================================================
        // Wait for WOLF to initialize
        // ====================================================

        console.log("");
        console.log(
            "⏳ Waiting for WOLF session..."
        );


        await page.waitForTimeout(
            10000
        );


        // ====================================================
        // First credential read
        // ====================================================

        await printStorageStatus(
            page
        );


        let credentials =
            await readWolfCredentials(
                page
            );


        // ====================================================
        // Retry
        // ====================================================

        if (!credentials) {

            console.log(
                "⚠️ WOLF credentials not found yet."
            );

            console.log(
                "🔄 Reloading WOLF..."
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


            await printStorageStatus(
                page
            );


            credentials =
                await readWolfCredentials(
                    page
                );
        }


        // ====================================================
        // Final retry
        // ====================================================

        if (!credentials) {

            console.log(
                "⚠️ Credentials still not found."
            );

            console.log(
                "🔄 Opening WOLF again..."
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


            await printStorageStatus(
                page
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
                "WOLF credentials were not found in Chrome localStorage."
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
            "✅ WOLF credentials found"
        );

        console.log(
            "========================================"
        );


        console.log(
            "🔐 v3APIToken length: " +
            credentials
                .v3APIToken
                .length
        );


        console.log(
            "🛡️ App Check token length: " +
            credentials
                .appCheckToken
                .length
        );


        console.log(
            "📱 Device: " +
            credentials.device
        );


        console.log(
            "🛡️ App Check: " +
            (
                credentials.isAppCheckEnabled
                    ? "enabled"
                    : "disabled"
            )
        );


        // ====================================================
        // Close Chrome
        // ====================================================

        console.log("");
        console.log(
            "🔒 Closing Chrome session..."
        );


        await context.close();


        console.log(
            "✅ Chrome session closed."
        );


        console.log("");


        // ====================================================
        // Return
        // ====================================================

        return credentials;

    } catch (error) {

        try {
            await context.close();
        } catch {
            // Ignore close error
        }

        throw error;
    }
}
