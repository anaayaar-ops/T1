import { chromium } from "playwright";
import fs from "fs";
import path from "path";

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

const DEFAULT_DEVICE =
    process.env.WOLF_DEVICE || "web";

const DEFAULT_APP_CHECK_ENABLED =
    String(
        process.env.WOLF_IS_APP_CHECK_ENABLED || "true"
    ).toLowerCase() === "true";


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

    const entries = fs.readdirSync(root, {
        withFileTypes: true
    });

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const candidate = path.join(
            root,
            entry.name
        );

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


async function extractSessionArchive(
    zipFile,
    destination
) {
    if (!fs.existsSync(zipFile)) {
        throw new Error(
            "Session ZIP not found: " + zipFile
        );
    }

    fs.mkdirSync(destination, {
        recursive: true
    });

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


function getSocketCredentials(url) {
    try {
        const parsed = new URL(url);

        if (
            !parsed.hostname.includes(
                "palringo.com"
            )
        ) {
            return null;
        }

        if (
            !parsed.pathname.includes(
                "/socket.io/"
            )
        ) {
            return null;
        }

        const params =
            parsed.searchParams;

        const token =
            params.get("token");

        const appCheckToken =
            params.get("appCheckToken");

        if (!token || !appCheckToken) {
            return null;
        }

        const device =
            params.get("device") ||
            DEFAULT_DEVICE;

        const appCheckValue =
            params.get(
                "isAppCheckEnabled"
            );

        const isAppCheckEnabled =
            appCheckValue === null
                ? DEFAULT_APP_CHECK_ENABLED
                : String(
                      appCheckValue
                  ).toLowerCase() === "true";

        return {
            token: token,
            appCheckToken: appCheckToken,
            device: device,
            isAppCheckEnabled:
                isAppCheckEnabled
        };
    } catch {
        return null;
    }
}


export async function loadSession() {
    console.log("");
    console.log(
        "========================================"
    );
    console.log(
        "🔐 Loading WOLF session"
    );
    console.log(
        "========================================"
    );
    console.log("");

    let profileDir = null;

    const localProfile =
        path.resolve("./wolf-profile");

    if (
        !process.env.WOLF_PROFILE_ZIP &&
        fs.existsSync(localProfile)
    ) {
        profileDir = localProfile;

        console.log(
            "📁 Using local wolf-profile"
        );
    }

    if (!profileDir) {
        console.log(
            "📦 Session archive detected."
        );

        if (!fs.existsSync(PROFILE_ZIP)) {
            throw new Error(
                "Session ZIP not found: " +
                    PROFILE_ZIP
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

        fs.mkdirSync(RUNTIME_DIR, {
            recursive: true
        });

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
        "📁 Profile: " + profileDir
    );
    console.log("");

    console.log(
        "🌐 Opening saved Chrome session..."
    );

    const context =
        await chromium.launchPersistentContext(
            profileDir,
            {
                headless: true,

                viewport: {
                    width: 1365,
                    height: 900
                },

                args: [
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu"
                ]
            }
        );

    let page;

    const pages = context.pages();

    if (pages.length > 0) {
        page = pages[0];
    } else {
        page = await context.newPage();
    }

    const cdp =
        await context.newCDPSession(page);

    await cdp.send("Network.enable");

    await cdp.send("Page.enable");

    console.log(
        "✅ CDP Network enabled"
    );

    let credentials = null;
    let resolveCredentials;

    const credentialsPromise =
        new Promise(function (resolve) {
            resolveCredentials = resolve;
        });


    function acceptCredentials(data) {
        if (credentials) {
            return;
        }

        if (!data) {
            return;
        }

        if (!data.token) {
            return;
        }

        if (!data.appCheckToken) {
            return;
        }

        credentials = data;

        resolveCredentials(data);
    }


    cdp.on(
        "Network.webSocketCreated",
        function (event) {
            const url =
                event.url || "";

            const data =
                getSocketCredentials(url);

            if (!data) {
                return;
            }

            console.log("");
            console.log(
                "🎯 WOLF Socket detected"
            );

            console.log(
                "📱 Device: " +
                    data.device
            );

            console.log(
                "🛡️ App Check: enabled"
            );

            console.log(
                "🔑 WOLF token captured"
            );

            console.log(
                "🛡️ App Check token captured"
            );

            acceptCredentials(data);
        }
    );


    cdp.on(
        "Network.webSocketWillSendHandshakeRequest",
        function (event) {
            const request =
                event.request || {};

            const url =
                request.url || "";

            const data =
                getSocketCredentials(url);

            if (!data) {
                return;
            }

            console.log("");
            console.log(
                "🤝 WOLF Socket handshake detected"
            );

            acceptCredentials(data);
        }
    );


    page.on(
        "websocket",
        function (websocket) {
            const url =
                websocket.url();

            const data =
                getSocketCredentials(url);

            if (!data) {
                return;
            }

            console.log("");
            console.log(
                "🔌 WOLF WebSocket detected"
            );

            acceptCredentials(data);
        }
    );


    console.log("");
    console.log(
        "🌐 Opening WOLF..."
    );

    await page.goto(
        WOLF_URL,
        {
            waitUntil:
                "domcontentloaded",
            timeout: 60000
        }
    );

    console.log("");
    console.log(
        "🌐 Session page: " +
            page.url()
    );

    console.log("");
    console.log(
        "⏳ Waiting for WOLF Socket..."
    );


    await Promise.race([
        credentialsPromise,

        new Promise(function (resolve) {
            setTimeout(
                resolve,
                30000
            );
        })
    ]);


    if (!credentials) {
        console.log("");
        console.log(
            "⚠️ Socket not captured."
        );

        console.log(
            "🔄 Reloading WOLF..."
        );

        await page.reload({
            waitUntil:
                "domcontentloaded",
            timeout: 60000
        });

        console.log(
            "⏳ Waiting after reload..."
        );

        await Promise.race([
            credentialsPromise,

            new Promise(function (resolve) {
                setTimeout(
                    resolve,
                    30000
                );
            })
        ]);
    }


    if (!credentials) {
        await context.close();

        throw new Error(
            "WOLF Socket App Check token could not be captured."
        );
    }


    await context.close();

    console.log("");
    console.log(
        "========================================"
    );
    console.log(
        "✅ WOLF credentials captured"
    );
    console.log(
        "========================================"
    );
    console.log("");

    console.log(
        "🔒 Chrome session closed."
    );

    console.log("");

    return {
        v3APIToken:
            credentials.token,

        appCheckToken:
            credentials.appCheckToken,

        device:
            credentials.device,

        isAppCheckEnabled:
            credentials.isAppCheckEnabled
    };
}
