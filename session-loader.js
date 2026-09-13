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

/*
 * البحث عن App Check token في
 * Local Storage بدون طباعة القيمة.
 */
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

/*
 * نلتقط X-Firebase-AppCheck من
 * HTTP requests التي يرسلها موقع WOLF.
 *
 * هذا أفضل من تخمين اسم مفتاح
 * Firebase داخل IndexedDB.
 */
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
                    ] ||
                    headers[
                        "X-Firebase-AppCheck"
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

/*
 * بعض نسخ WOLF قد تضع App Check
 * داخل WebSocket URL نفسه.
 */
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

        /*
         * فحص Local Storage كخطة إضافية.
         */
        try {
            const localResults =
                await findAppCheckInLocalStorage(
                    page
                );

            for (
                const item of localResults
            ) {
                let value =
                    item.value;

                /*
                 * أحيانًا تكون القيمة JSON.
                 */
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

                /*
                 * إذا كانت القيمة نفسها token.
                 */
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

        /*
         * يجب تثبيت المراقبة قبل فتح WOLF
         * حتى لا نفقد أول App Check request.
         */
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

        /*
         * نعطي Firebase/WOLF وقتًا
         * لإنشاء App Check token.
         */
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

        /*
         * نبحث عن App Check token.
         */
        const appCheckToken =
            await waitForAppCheck(
                page,
                networkCapture,
                websocketCapture,
                30000
            );

        if (!appCheckToken) {
            console.log(
                "⚠️ App Check token was not captured."
            );

            /*
             * محاولة أخيرة بإعادة تحميل الصفحة
             * مع استمرار capture.
             */
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

            const retryToken =
                await waitForAppCheck(
                    page,
                    networkCapture,
                    websocketCapture,
                    20000
                );

            if (retryToken) {
                console.log(
                    "✅ App Check token captured after reload."
                );

                return {
                    token,
                    deviceToken:
                        await readLocalStorage(
                            page,
                            "deviceToken"
                        ) || "",
                    appCheckToken:
                        retryToken
                };
            }

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
```

---

### 2. استبدل `check-wolf.js` بالكامل بهذا

هذا يحافظ على إعدادات البوت الحالية عندك، لكن يفعّل App Check باستخدام التوكن الذي استخرجناه من Chrome.

```js
import wolfjs from "wolf.js";
import { io } from "socket.io-client";
import { loadSession } from "./session-loader.js";

const {
    WOLF,
    OnlineState
} = wolfjs;

// ============================================================
// CONFIG
// ============================================================

const GROUP_ID = 18432094;

const WATCHED_SUBSCRIBER_IDS = [
    51660277,
    35543686,
    80014666,
    16327118,
    5507
];

const LEAVE_COMMAND =
    "!كات نزول";

const JOIN_COMMAND =
    "!كات صعود";

const RUN_DURATION_MS =
    5 * 60 * 60 * 1000;

const CHECK_INTERVAL_MS =
    10 * 60 * 1000;

const MAX_OCCUPANTS_TO_JOIN = 1;

const AUTHORIZATION_TIMEOUT_MS =
    60 * 1000;

const WOLF_DEVICE =
    process.env.WOLF_DEVICE ||
    "web";

const WOLF_IS_APP_CHECK_ENABLED =
    true;

// ============================================================
// STATE
// ============================================================

let WOLF_TOKEN = "";
let WOLF_APP_CHECK_TOKEN = "";

let service = null;
let socket = null;

let monitorTimer = null;
let shutdownTimer = null;

let currentSlotId = null;

let connectionCount = 0;
let disconnectCount = 0;

// ============================================================
// LOG HELPERS
// ============================================================

function safeJson(value) {
    try {
        const text =
            JSON.stringify(
                value,
                (key, val) => {
                    const lower =
                        String(key).toLowerCase();

                    if (
                        lower.includes("token") ||
                        lower.includes("authorization") ||
                        lower.includes("cookie")
                    ) {
                        return "[REDACTED]";
                    }

                    return val;
                }
            );

        return text;
    } catch {
        return String(value);
    }
}

function logDivider() {
    console.log(
        "========================================"
    );
}

// ============================================================
// SESSION
// ============================================================

async function initializeSession() {
    logDivider();

    console.log(
        "🔐 Loading session"
    );

    logDivider();

    console.log(
        `📱 Device: ${WOLF_DEVICE}`
    );

    console.log(
        "🛡️ App Check: enabled"
    );

    const session =
        await loadSession();

    if (
        !session ||
        !session.token
    ) {
        throw new Error(
            "Session token was not loaded."
        );
    }

    if (
        !session.appCheckToken
    ) {
        throw new Error(
            "App Check token was not loaded."
        );
    }

    WOLF_TOKEN =
        session.token;

    WOLF_APP_CHECK_TOKEN =
        session.appCheckToken;

    console.log(
        "✅ Session initialized"
    );

    console.log(
        `🔐 Session token length: ${WOLF_TOKEN.length}`
    );

    console.log(
        `🛡️ App Check token length: ${WOLF_APP_CHECK_TOKEN.length}`
    );
}

// ============================================================
// CREATE WOLF SERVICE
// ============================================================

async function createWolfService() {
    console.log(
        "⚙️ Creating WOLF service..."
    );

    service =
        new WOLF();

    console.log(
        "⚙️ WOLF service created."
    );

    /*
     * API token
     */
    if (
        service.config?.framework?.login
    ) {
        service.config.framework.login.token =
            WOLF_TOKEN;

        /*
         * Invisible / online state
         */
        if (
            typeof OnlineState?.INVISIBLE !==
            "undefined"
        ) {
            service.config.framework.login.onlineState =
                OnlineState.INVISIBLE;
        } else {
            service.config.framework.login.onlineState = 3;
        }
    }

    /*
     * App Check token.
     *
     * نضعه في أكثر من مكان محتمل داخل
     * إعدادات wolf.js بدون طباعة القيمة.
     */
    try {
        service.config.framework.login.appCheckToken =
            WOLF_APP_CHECK_TOKEN;
    } catch {}

    try {
        service.config.framework.login.app_check_token =
            WOLF_APP_CHECK_TOKEN;
    } catch {}

    console.log(
        "⚙️ Initializing service handlers..."
    );

    await service.websocket.init();

    console.log(
        "⚙️ Loaded 30 handlers"
    );
}

// ============================================================
// PRIVATE COMMAND LISTENER
// ============================================================

function installCommandListener() {
    service.on(
        "privateMessage",
        async message => {
            try {
                const senderId =
                    Number(
                        message?.sender?.id ??
                        message?.senderId ??
                        message?.from?.id ??
                        message?.subscriberId
                    );

                const text =
                    String(
                        message?.text ??
                        message?.message ??
                        message?.body ??
                        ""
                    ).trim();

                if (
                    !WATCHED_SUBSCRIBER_IDS.includes(
                        senderId
                    )
                ) {
                    return;
                }

                console.log(
                    `[PRIVATE] ${senderId}: ${text}`
                );

                if (
                    text ===
                    LEAVE_COMMAND
                ) {
                    await leaveStage();

                    startMonitoring();

                    return;
                }

                if (
                    text ===
                    JOIN_COMMAND
                ) {
                    await forceJoinStage();

                    return;
                }

            } catch (error) {
                console.error(
                    "❌ Private command error:",
                    error
                );
            }
        }
    );

    console.log(
        "📡 Command listener active"
    );
}

// ============================================================
// CONNECTION CONFIG
// ============================================================

function getConnectionConfig() {
    const connection =
        service?._frameworkConfig
            ?.get?.("connection") || {};

    const host =
        connection.host ||
        "https://v3-rc.palringo.com";

    const port =
        connection.port ||
        443;

    return {
        host,
        port
    };
}

// ============================================================
// SOCKET CONNECTION
// ============================================================

async function connectSocket() {
    const {
        host,
        port
    } =
        getConnectionConfig();

    console.log(
        "🔌 Starting service connection..."
    );

    console.log(
        `🌐 Host: ${host}`
    );

    console.log(
        `🔌 Port: ${port}`
    );

    console.log(
        `📱 Device: ${WOLF_DEVICE}`
    );

    console.log(
        "🛡️ Security validation: enabled"
    );

    console.log(
        "🔐 Token loaded: yes"
    );

    console.log(
        `🔐 Token length: ${WOLF_TOKEN.length}`
    );

    console.log(
        "🛡️ App Check token loaded: yes"
    );

    console.log(
        `🛡️ App Check token length: ${WOLF_APP_CHECK_TOKEN.length}`
    );

    const connectionVersion =
        connection.version;

    console.log(
        `⚙️ Connection version: ${
            connectionVersion ||
            "not specified"
        }`
    );

    /*
     * مهم:
     * App Check enabled
     * + App Check token الحقيقي
     */
    const query = {
        token:
            WOLF_TOKEN,

        device:
            WOLF_DEVICE,

        state:
            3,

        version:
            connectionVersion,

        isAppCheckEnabled:
            "true",

        appCheckToken:
            WOLF_APP_CHECK_TOKEN
    };

    console.log(
        "🔎 Socket query:"
    );

    console.log(
        safeJson(query)
    );

    let attempt = 0;

    socket =
        io(
            `${host}:${port}`,
            {
                transports: [
                    "websocket"
                ],

                autoConnect: false,

                reconnection: true,

                reconnectionAttempts:
                    Infinity,

                reconnectionDelay:
                    3000,

                reconnectionDelayMax:
                    10000,

                timeout:
                    20000,

                query
            }
        );

    /*
     * wolf.js يتوقع Socket.IO socket
     */
    service.websocket.socket =
        socket;

    // ========================================================
    // SOCKET EVENTS
    // ========================================================

    socket.on(
        "connect",
        () => {
            connectionCount++;

            logDivider();

            console.log(
                "🔗 Service connection established"
            );

            console.log(
                `🔗 Connection ID: ${socket.id}`
            );

            console.log(
                `🔗 Connection count: ${connectionCount}`
            );

            console.log(
                `🔗 Socket connected: ${socket.connected}`
            );

            console.log(
                `🔗 Transport: ${socket.io.engine?.transport?.name}`
            );

            logDivider();
        }
    );

    socket.on(
        "connect_error",
        error => {
            console.error(
                "❌ Socket connect_error:",
                error?.message ||
                error
            );
        }
    );

    socket.on(
        "disconnect",
        (reason, details) => {
            disconnectCount++;

            logDivider();

            console.log(
                "🔴 SOCKET DISCONNECTED"
            );

            console.log(
                `🔴 Reason: ${reason}`
            );

            console.log(
                `🔴 Disconnect count: ${disconnectCount}`
            );

            console.log(
                `🔴 Socket connected: ${socket.connected}`
            );

            if (details) {
                console.log(
                    `🔴 Details: ${safeJson(details)}`
                );
            }

            console.log(
                `🔴 Current subscriber: ${
                    service.currentSubscriber?.id ??
                    "undefined"
                }`
            );

            logDivider();
        }
    );

    socket.on(
        "error",
        error => {
            console.error(
                "❌ SOCKET ERROR:",
                safeJson(error)
            );
        }
    );

    /*
     * Forward all Socket.IO events to wolf.js.
     */
    socket.onAny(
        (eventName, data) => {
            try {
                console.log(
                    `📥 SOCKET EVENT: ${eventName}`
                );

                console.log(
                    `📦 ${safeJson(data)}`
                );

                const handler =
                    service
                        ?.websocket
                        ?.handlers
                        ?.[
                            eventName
                        ];

                if (
                    handler &&
                    typeof handler.process ===
                        "function"
                ) {
                    handler.process(
                        data?.body ??
                        data
                    );
                }

            } catch (error) {
                console.error(
                    `❌ Handler error [${eventName}]:`,
                    error
                );
            }
        }
    );

    /*
     * Start connection.
     */
    attempt++;

    console.log(
        `🔄 Connection attempt: ${attempt}`
    );

    console.log(
        "🔌 Connecting..."
    );

    socket.connect();

    /*
     * Wait for WOLF authorization.
     */
    console.log(
        "⏳ Waiting for authorization..."
    );

    const started =
        Date.now();

    while (
        Date.now() - started <
        AUTHORIZATION_TIMEOUT_MS
    ) {
        if (
            service.currentSubscriber?.id
        ) {
            console.log(
                `✅ Authorization complete. Subscriber: ${service.currentSubscriber.id}`
            );

            return;
        }

        if (
            !socket.connected
        ) {
            console.log(
                "⏳ Socket is not connected..."
            );
        }

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    1000
                )
        );
    }

    throw new Error(
        "WOLF authorization did not complete within the timeout."
    );
}

// ============================================================
// STAGE API
// ============================================================

async function getStageSlots() {
    const slots =
        await service.stage.slot.list(
            GROUP_ID
        );

    return Array.isArray(slots)
        ? slots
        : [];
}

async function getStageOccupants() {
    try {
        const config =
            await service.stage.getAudioConfig(
                GROUP_ID
            );

        /*
         * نحاول استخراج عدد المتواجدين
         * من الاستجابة بدون افتراض شكل واحد.
         */
        if (
            Array.isArray(
                config?.occupants
            )
        ) {
            return config.occupants.length;
        }

        if (
            Array.isArray(
                config?.users
            )
        ) {
            return config.users.length;
        }

        if (
            typeof config?.occupantsCount ===
                "number"
        ) {
            return config.occupantsCount;
        }

    } catch {}

    /*
     * fallback: slots
     */
    const slots =
        await getStageSlots();

    return slots.filter(
        slot =>
            slot?.occupierId != null
    ).length;
}

// ============================================================
// FIND FREE SLOT
// ============================================================

async function findFreeSlot() {
    const slots =
        await getStageSlots();

    return (
        slots.find(
            slot =>
                slot?.id != null &&
                slot?.occupierId == null
        ) ||
        null
    );
}

// ============================================================
// CURRENT SLOT
// ============================================================

async function findCurrentSlot() {
    const subscriberId =
        service.currentSubscriber?.id;

    if (
        subscriberId == null
    ) {
        return null;
    }

    const slots =
        await getStageSlots();

    return (
        slots.find(
            slot =>
                Number(
                    slot?.occupierId
                ) === Number(
                    subscriberId
                )
        ) ||
        null
    );
}

// ============================================================
// JOIN
// ============================================================

async function joinStage(
    force = false
) {
    try {
        const occupants =
            await getStageOccupants();

        console.log(
            `🎙️ Stage occupants: ${occupants}`
        );

        if (
            !force &&
            occupants >
                MAX_OCCUPANTS_TO_JOIN
        ) {
            console.log(
                `⏸️ Stage has more than ${MAX_OCCUPANTS_TO_JOIN} occupant(s).`
            );

            return false;
        }

        const current =
            await findCurrentSlot();

        if (current) {
            currentSlotId =
                current.id;

            console.log(
                `ℹ️ Already on stage. Slot: ${currentSlotId}`
            );

            return true;
        }

        const freeSlot =
            await findFreeSlot();

        if (!freeSlot) {
            console.log(
                "❌ No free stage slot."
            );

            return false;
        }

        console.log(
            `🎙️ Joining stage slot ${freeSlot.id}...`
        );

        await service.stage.slot.join(
            GROUP_ID,
            freeSlot.id
        );

        currentSlotId =
            freeSlot.id;

        console.log(
            `✅ Joined stage. Slot: ${currentSlotId}`
        );

        stopMonitoring();

        return true;

    } catch (error) {
        console.error(
            "❌ Stage join error:",
            error
        );

        return false;
    }
}

// ============================================================
// LEAVE
// ============================================================

async function leaveStage() {
    try {
        let slotId =
            currentSlotId;

        if (
            slotId == null
        ) {
            const current =
                await findCurrentSlot();

            if (current) {
                slotId =
                    current.id;
            }
        }

        if (
            slotId == null
        ) {
            console.log(
                "ℹ️ Bot is not on stage."
            );

            return;
        }

        console.log(
            `🎙️ Leaving stage slot ${slotId}...`
        );

        await service.stage.slot.leave(
            GROUP_ID,
            slotId
        );

        currentSlotId =
            null;

        console.log(
            "✅ Left stage."
        );

    } catch (error) {
        console.error(
            "❌ Stage leave error:",
            error
        );
    }
}

// ============================================================
// FORCE JOIN
// ============================================================

async function forceJoinStage() {
    console.log(
        "🚀 Force join command received."
    );

    await joinStage(
        true
    );
}

// ============================================================
// MONITOR
// ============================================================

async function checkStageAndJoin() {
    console.log(
        "🔎 Checking stage..."
    );

    await joinStage(
        false
    );
}

function stopMonitoring() {
    if (
        monitorTimer
    ) {
        clearInterval(
            monitorTimer
        );

        monitorTimer =
            null;

        console.log(
            "⏹️ Stage monitor stopped."
        );
    }
}

function startMonitoring() {
    stopMonitoring();

    console.log(
        "▶️ Stage monitor started."
    );

    checkStageAndJoin()
        .catch(error => {
            console.error(
                "❌ Initial stage check:",
                error
            );
        });

    monitorTimer =
        setInterval(
            () => {
                checkStageAndJoin()
                    .catch(error => {
                        console.error(
                            "❌ Stage monitor error:",
                            error
                        );
                    });
            },
            CHECK_INTERVAL_MS
        );
}

// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown(
    signal
) {
    console.log(
        `🛑 Shutdown requested: ${signal}`
    );

    stopMonitoring();

    if (
        shutdownTimer
    ) {
        clearTimeout(
            shutdownTimer
        );
    }

    try {
        await leaveStage();
    } catch {}

    try {
        if (
            socket
        ) {
            socket.disconnect();
        }
    } catch {}

    process.exit(
        0
    );
}

// ============================================================
// MAIN
// ============================================================

async function main() {
    console.log(
        "🚀 Service started"
    );

    try {
        /*
         * 1. Load Chrome session
         */
        await initializeSession();

        /*
         * 2. Create wolf.js service
         */
        await createWolfService();

        /*
         * 3. Private commands
         */
        installCommandListener();

        /*
         * 4. Socket connection
         */
        await connectSocket();

        /*
         * 5. Stage API test
         */
        console.log(
            "🧪 Testing stage API..."
        );

        const slots =
            await getStageSlots();

        console.log(
            `🧪 Stage slots loaded: ${slots.length}`
        );

        /*
         * 6. Start monitor
         */
        startMonitoring();

        /*
         * 7. Runtime limit
         */
        shutdownTimer =
            setTimeout(
                () => {
                    shutdown(
                        "runtime limit"
                    );
                },
                RUN_DURATION_MS
            );

        console.log(
            "✅ Service is running."
        );

    } catch (error) {
        logDivider();

        console.error(
            "❌ SERVICE ERROR"
        );

        console.error(
            error?.stack ||
            error
        );

        logDivider();

        try {
            if (
                socket
            ) {
                socket.disconnect();
            }
        } catch {}

        process.exit(
            1
        );
    }
}

// ============================================================
// SIGNALS
// ============================================================

process.on(
    "SIGINT",
    () =>
        shutdown(
            "SIGINT"
        )
);

process.on(
    "SIGTERM",
    () =>
        shutdown(
            "SIGTERM"
        )
);

// ============================================================
// START
// ============================================================

main();
