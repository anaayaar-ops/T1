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

const DEVICE =
process.env.WOLF_DEVICE || "web";

const APP_CHECK_ENABLED =
String(
process.env.WOLF_IS_APP_CHECK_ENABLED || "true"
).toLowerCase() === "true";

function log(message = "") {
console.log(message);
}

function ensureDirectory(dir) {
if (!fs.existsSync(dir)) {
fs.mkdirSync(dir, {
recursive: true
});
}
}

function findProfileRoot(root) {
if (!fs.existsSync(root)) {
return null;
}

```
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

const entries = fs
    .readdirSync(root, {
        withFileTypes: true
    })
    .filter(entry => entry.isDirectory());

for (const entry of entries) {
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
```

}

async function extractSessionArchive(
zipFile,
destination
) {
ensureDirectory(destination);

```
if (!fs.existsSync(zipFile)) {
    throw new Error(
        `Session ZIP not found: ${zipFile}`
    );
}

const {
    execFileSync
} = await import("child_process");

if (process.platform === "win32") {
    execFileSync(
        "powershell",
        [
            "-NoProfile",
            "-Command",
            `Expand-Archive -LiteralPath '${zipFile.replace(
                /'/g,
                "''"
            )}' -DestinationPath '${destination.replace(
                /'/g,
                "''"
            )}' -Force`
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
```

}

function extractSocketCredentials(url) {
try {
const parsed = new URL(url);

```
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
        params.get(
            "appCheckToken"
        );

    const device =
        params.get("device") ||
        DEVICE;

    const isAppCheckEnabled =
        params.get(
            "isAppCheckEnabled"
        );

    if (
        !token ||
        !appCheckToken
    ) {
        return null;
    }

    return {
        token,
        appCheckToken,
        device,
        isAppCheckEnabled:
            isAppCheckEnabled === null
                ? APP_CHECK_ENABLED
                : String(
                      isAppCheckEnabled
                  ).toLowerCase() ===
                  "true"
    };
} catch {
    return null;
}
```

}

export async function loadSession() {
log("");
log("========================================");
log("🔐 Loading WOLF session");
log("========================================");
log("");

```
let profileDir;

// ============================================================
// استخدام wolf-profile محليًا
// ============================================================

if (
    !process.env.WOLF_PROFILE_ZIP &&
    fs.existsSync(
        path.resolve("./wolf-profile")
    )
) {
    profileDir =
        path.resolve("./wolf-profile");

    log(
        "📁 Using local wolf-profile"
    );
} else {
    // ========================================================
    // استخراج session.zip
    // ========================================================

    log(
        "📦 Session archive detected."
    );

    if (!fs.existsSync(PROFILE_ZIP)) {
        throw new Error(
            `Session ZIP not found: ${PROFILE_ZIP}`
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

    ensureDirectory(
        RUNTIME_DIR
    );

    log(
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

log("");
log("📁 Profile:");
log(profileDir);
log("");

// ============================================================
// تشغيل Chrome
// ============================================================

log(
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

let pages =
    context.pages();

let page =
    pages[0];

if (!page) {
    page =
        await context.newPage();
}

// ============================================================
// CDP
// ============================================================

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

log(
    "✅ CDP Network enabled"
);

// ============================================================
// انتظار بيانات Socket
// ============================================================

let credentials = null;

let resolveCredentials;

const credentialsPromise =
    new Promise(resolve => {
        resolveCredentials =
            resolve;
    });

function acceptCredentials(
    data
) {
    if (credentials) {
        return;
    }

    if (
        !data ||
        !data.token ||
        !data.appCheckToken
    ) {
        return;
    }

    credentials = data;

    resolveCredentials(
        data
    );
}

// ============================================================
// Network.webSocketCreated
// ============================================================

cdp.on(
    "Network.webSocketCreated",
    event => {
        const url =
            event.url || "";

        const data =
            extractSocketCredentials(
                url
            );

        if (!data) {
            return;
        }

        log("");
        log(
            "🎯 WOLF Socket detected"
        );

        log(
            `📱 Device: ${data.device}`
        );

        log(
            `🛡️ App Check: ${
                data.isAppCheckEnabled
                    ? "enabled"
                    : "disabled"
            }`
        );

        log(
            "🔑 WOLF token captured"
        );

        log(
            "🛡️ App Check token captured"
        );

        acceptCredentials(
            data
        );
    }
);

// ============================================================
// Network.webSocketWillSendHandshakeRequest
// ============================================================

cdp.on(
    "Network.webSocketWillSendHandshakeRequest",
    event => {
        const request =
            event.request || {};

        const url =
            request.url || "";

        const data =
            extractSocketCredentials(
                url
            );

        if (!data) {
            return;
        }

        log("");
        log(
            "🤝 WOLF Socket handshake detected"
        );

        acceptCredentials(
            data
        );
    }
);

// ============================================================
// Playwright WebSocket fallback
// ============================================================

page.on(
    "websocket",
    ws => {
        const data =
            extractSocketCredentials(
                ws.url()
            );

        if (!data) {
            return;
        }

        log("");
        log(
            "🔌 WOLF WebSocket detected"
        );

        acceptCredentials(
            data
        );
    }
);

// ============================================================
// فتح WOLF
// ============================================================

log("");
log(
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

log("");
log(
    `🌐 Session page: ${page.url()}`
);

log("");
log(
    "⏳ Waiting for WOLF Socket..."
);

// ============================================================
// الانتظار الأول
// ============================================================

await Promise.race([
    credentialsPromise,
    new Promise(resolve =>
        setTimeout(
            resolve,
            30000
        )
    )
]);

// ============================================================
// Reload إذا لم نجد Socket
// ============================================================

if (!credentials) {
    log("");
    log(
        "⚠️ Socket credentials not captured."
    );

    log(
        "🔄 Reloading WOLF..."
    );

    await page.reload({
        waitUntil:
            "domcontentloaded",
        timeout: 60000
    });

    log(
        "⏳ Waiting after reload..."
    );

    await Promise.race([
        credentialsPromise,
        new Promise(resolve =>
            setTimeout(
                resolve,
                30000
            )
        )
    ]);
}

// ============================================================
// فشل
// ============================================================

if (!credentials) {
    await context.close();

    throw new Error(
        "WOLF Socket App Check token could not be captured."
    );
}

// ============================================================
// إغلاق Chrome
// ============================================================

await context.close();

log("");
log(
    "========================================"
);
log(
    "✅ WOLF credentials captured"
);
log(
    "========================================"
);

log("");
log(
    "🔒 Chrome session closed."
);

log("");

// ============================================================
// إرجاع القيم إلى check-wolf.js
// ============================================================

return {
    v3APIToken:
        credentials.token,

    appCheckToken:
        credentials.appCheckToken,

    device:
        credentials.device ||
        DEVICE,

    isAppCheckEnabled:
        credentials.isAppCheckEnabled
};
