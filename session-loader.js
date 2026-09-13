import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { chromium } from "playwright";

const ZIP_FILE =
    process.env.WOLF_PROFILE_ZIP ||
    path.resolve("session.zip");

const RUNTIME_DIR =
    path.join(
        os.tmpdir(),
        "service-session-runtime"
    );

const START_URL =
    "https://wolf.live/mna";

function removePath(target) {
    try {
        if (fs.existsSync(target)) {
            fs.rmSync(target, {
                recursive: true,
                force: true
            });
        }
    } catch {}
}

function extractArchive() {
    if (!fs.existsSync(ZIP_FILE)) {
        throw new Error(
            "Session archive was not found."
        );
    }

    removePath(RUNTIME_DIR);

    fs.mkdirSync(
        RUNTIME_DIR,
        {
            recursive: true
        }
    );

    console.log(
        "Preparing session..."
    );

    if (process.platform === "win32") {
        const escapedZip =
            ZIP_FILE.replace(/'/g, "''");

        const escapedDestination =
            RUNTIME_DIR.replace(/'/g, "''");

        execFileSync(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedDestination}' -Force`
            ],
            {
                stdio: "inherit"
            }
        );
    } else {
        execFileSync(
            "unzip",
            [
                "-q",
                "-o",
                ZIP_FILE,
                "-d",
                RUNTIME_DIR
            ],
            {
                stdio: "inherit"
            }
        );
    }
}

function looksLikeProfile(directory) {
    if (!fs.existsSync(directory)) {
        return false;
    }

    const localState =
        path.join(
            directory,
            "Local State"
        );

    const defaultDirectory =
        path.join(
            directory,
            "Default"
        );

    const profileDirectory =
        path.join(
            directory,
            "Profile 1"
        );

    return (
        fs.existsSync(localState) ||
        fs.existsSync(defaultDirectory) ||
        fs.existsSync(profileDirectory)
    );
}

function findProfileRoot(root) {
    if (looksLikeProfile(root)) {
        return root;
    }

    const directCandidates = [
        "wolf-profile",
        "profile",
        "chrome-profile",
        "User Data",
        "Chrome"
    ];

    for (const name of directCandidates) {
        const candidate =
            path.join(root, name);

        if (looksLikeProfile(candidate)) {
            return candidate;
        }
    }

    function search(directory, depth) {
        if (depth > 5) {
            return null;
        }

        let entries;

        try {
            entries =
                fs.readdirSync(
                    directory,
                    {
                        withFileTypes: true
                    }
                );
        } catch {
            return null;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const candidate =
                path.join(
                    directory,
                    entry.name
                );

            if (
                looksLikeProfile(
                    candidate
                )
            ) {
                return candidate;
            }

            const result =
                search(
                    candidate,
                    depth + 1
                );

            if (result) {
                return result;
            }
        }

        return null;
    }

    return search(root, 0);
}

async function readLocalStorage(
    page,
    key
) {
    return page.evaluate(
        storageKey => {
            return localStorage.getItem(
                storageKey
            );
        },
        key
    );
}

function installNetworkCapture(page) {
    let appCheckToken = null;

    page.on(
        "request",
        request => {
            try {
                const headers =
                    request.headers();

                const possible =
                    headers[
                        "x-firebase-appcheck"
                    ];

                if (
                    possible &&
                    typeof possible === "string" &&
                    possible.length > 20
                ) {
                    appCheckToken =
                        possible;
                }
            } catch {}
        }
    );

    return {
        getToken() {
            return appCheckToken;
        }
    };
}

function installWebSocketCapture(page) {
    let appCheckToken = null;

    page.on(
        "websocket",
        websocket => {
            try {
                const url =
                    websocket.url();

                const parsed =
                    new URL(url);

                const candidates = [
                    "appCheckToken",
                    "app_check_token",
                    "appcheck",
                    "x-firebase-appcheck"
                ];

                for (
                    const key of candidates
                ) {
                    const value =
                        parsed.searchParams.get(
                            key
                        );

                    if (
                        value &&
                        value.length > 20
                    ) {
                        appCheckToken =
                            value;

                        break;
                    }
                }
            } catch {}
        }
    );

    return {
        getToken() {
            return appCheckToken;
        }
    };
}

async function findAppCheckInLocalStorage(page) {
    return page.evaluate(() => {
        const results = [];

        try {
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

                const lower =
                    key.toLowerCase();

                if (
                    lower.includes("appcheck") ||
                    lower.includes("app_check") ||
                    lower.includes("firebaseappcheck")
                ) {
                    const value =
                        localStorage.getItem(key);

                    if (
                        value &&
                        value.length > 20
                    ) {
                        results.push({
                            key,
                            value
                        });
                    }
                }
            }
        } catch {}

        return results;
    });
}

async function waitForAppCheck(
    page,
    networkCapture,
    websocketCapture,
    timeoutMs = 30000
) {
    const started =
        Date.now();

    while (
        Date.now() - started <
        timeoutMs
    ) {
        const networkToken =
            networkCapture.getToken();

        if (networkToken) {
            return networkToken;
        }

        const websocketToken =
            websocketCapture.getToken();

        if (websocketToken) {
            return websocketToken;
        }

        try {
            const localResults =
                await findAppCheckInLocalStorage(
                    page
                );

            for (
                const item of localResults
            ) {
                const value =
                    item.value;

                try {
                    const parsed =
                        JSON.parse(value);

                    if (
                        parsed &&
                        typeof parsed ===
                            "object"
                    ) {
                        const candidates = [
                            parsed.token,
                            parsed.appCheckToken,
                            parsed.tokenResponse?.token,
                            parsed.tokenResponse?.appCheckToken
                        ];

                        for (
                            const candidate
                            of candidates
                        ) {
                            if (
                                typeof candidate ===
                                    "string" &&
                                candidate.length > 20
                            ) {
                                return candidate;
                            }
                        }
                    }
                } catch {}

                if (
                    typeof value === "string" &&
                    value.length > 100
                ) {
                    return value;
                }
            }
        } catch {}

        await page.waitForTimeout(
            1000
        );
    }

    return null;
}

export async function loadSession() {
    extractArchive();

    const profileRoot =
        findProfileRoot(
            RUNTIME_DIR
        );

    if (!profileRoot) {
        removePath(
            RUNTIME_DIR
        );

        throw new Error(
            "Could not locate the browser profile inside the archive."
        );
    }

    console.log(
        "Session profile detected."
    );

    let context = null;

    try {
        context =
            await chromium.launchPersistentContext(
                profileRoot,
                {
                    headless: true,

                    viewport: {
                        width: 1280,
                        height: 900
                    },

                    locale: "en-US",

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

        let page =
            context.pages()[0];

        if (!page) {
            page =
                await context.newPage();
        }

        const networkCapture =
            installNetworkCapture(
                page
            );

        const websocketCapture =
            installWebSocketCapture(
                page
            );

        console.log(
            "Opening session..."
        );

        await page.goto(
            START_URL,
            {
                waitUntil:
                    "domcontentloaded",
                timeout: 120000
            }
        );

        console.log(
            `Session page: ${page.url()}`
        );

        await page.waitForTimeout(
            10000
        );

        let token = null;

        for (
            let attempt = 0;
            attempt < 20;
            attempt++
        ) {
            token =
                await readLocalStorage(
                    page,
                    "v3APIToken"
                );

            if (token) {
                break;
            }

            await page.waitForTimeout(
                1000
            );
        }

        if (!token) {
            throw new Error(
                "Required v3APIToken was not found."
            );
        }

        console.log(
            "WOLF API token loaded."
        );

        let appCheckToken =
            await waitForAppCheck(
                page,
                networkCapture,
                websocketCapture,
                30000
            );

        if (!appCheckToken) {
            console.log(
                "⚠️ App Check token was not captured. Reloading..."
            );

            try {
                await page.reload({
                    waitUntil:
                        "domcontentloaded",
                    timeout: 120000
                });

                await page.waitForTimeout(
                    15000
                );
            } catch {}

            appCheckToken =
                await waitForAppCheck(
                    page,
                    networkCapture,
                    websocketCapture,
                    20000
                );
        }

        if (!appCheckToken) {
            throw new Error(
                "App Check token could not be captured from the saved WOLF session."
            );
        }

        console.log(
            "✅ App Check token captured."
        );

        const deviceToken =
            await readLocalStorage(
                page,
                "deviceToken"
            );

        return {
            token,

            deviceToken:
                deviceToken || "",

            appCheckToken
        };

    } finally {
        if (context) {
            try {
                await context.close();
            } catch {}
        }

        removePath(
            RUNTIME_DIR
        );
    }
}
