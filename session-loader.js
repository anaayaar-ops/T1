```js
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
// Read ONLY the required four values
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
                token: read("v3APIToken"),
                appCheckToken: read("appCheckToken")
            };
        });

    if (
        !data?.token ||
        !data?.appCheckToken
    ) {
        return null;
    }

    // ONLY these four values are returned.
    return {
        device: DEFAULT_DEVICE,
        isAppCheckEnabled: DEFAULT_APP_CHECK_ENABLED,
        token: data.token,
        appCheckToken: data.appCheckToken
    };
}


// ============================================================
// Main
// ============================================================

export async function loadSession() {

    // ========================================================
    // Locate Profile
    // ========================================================

    let profileDir = null;

    if (
        !process.env.WOLF_PROFILE_ZIP &&
        fs.existsSync(LOCAL_PROFILE)
    ) {

        profileDir = LOCAL_PROFILE;

    } else {

        if (!fs.existsSync(PROFILE_ZIP)) {
            throw new Error(
                "Session ZIP not found: " + PROFILE_ZIP
            );
        }

        if (fs.existsSync(RUNTIME_DIR)) {
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

        await extractSessionArchive(
            PROFILE_ZIP,
            RUNTIME_DIR
        );

        profileDir =
            findProfileRoot(RUNTIME_DIR);

        if (!profileDir) {
            throw new Error(
                "Chrome profile could not be located inside session archive."
            );
        }
    }


    // ========================================================
    // Launch Chrome
    // ========================================================

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

        const pages = context.pages();

        if (pages.length > 0) {
            page = pages[0];
        } else {
            page = await context.newPage();
        }


        // ====================================================
        // Open WOLF
        // ====================================================

        await page.goto(
            WOLF_URL,
            {
                waitUntil: "domcontentloaded",
                timeout: 60000
            }
        );

        await page.waitForTimeout(10000);


        // ====================================================
        // Try to read credentials
        // ====================================================

        let credentials =
            await readWolfCredentials(page);


        // ====================================================
        // Retry #1
        // ====================================================

        if (!credentials) {

            await page.reload(
                {
                    waitUntil: "domcontentloaded",
                    timeout: 60000
                }
            );

            await page.waitForTimeout(15000);

            credentials =
                await readWolfCredentials(page);
        }


        // ====================================================
        // Retry #2
        // ====================================================

        if (!credentials) {

            await page.goto(
                WOLF_URL,
                {
                    waitUntil: "domcontentloaded",
                    timeout: 60000
                }
            );

            await page.waitForTimeout(15000);

            credentials =
                await readWolfCredentials(page);
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
        // Close Chrome
        // ========================================================

        await context.close();


        // ====================================================
        // Return ONLY four values
        // ========================================================

        return {
            device: credentials.device,
            isAppCheckEnabled:
                credentials.isAppCheckEnabled,
            token: credentials.token,
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
```

### الناتج من `loadSession()`

سيكون **بالضبط** بهذا الشكل:

```js
{
    device: "web",
    isAppCheckEnabled: true,
    token: "WE-...",
    appCheckToken: "eyJ..."
}
```

ولا يتم استخراج أو إرجاع `deviceToken` إطلاقًا، ولا يتم طباعة أي من التوكنات في الـ GitHub Actions logs.

**مهم:** إذا كان `check-wolf.js` الحالي عندك ما زال ينتظر `session.v3APIToken` و`session.appCheckToken`، لازم نعدله أيضًا ليستخدم الأسماء الجديدة `session.token` و`session.appCheckToken`.
