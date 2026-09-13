import wolfjs from "wolf.js";
import { io } from "socket.io-client";
import { loadSession } from "./session-loader.js";

const { WOLF, OnlineState } = wolfjs;

// ===========================================================
// Configuration
// ============================================================

const GROUP_ID = 18432094;

const WATCHED_SUBSCRIBER_IDS = [
    51660277,
    35543686,
    80014666,
    16327118,
    5507
];

const LEAVE_COMMAND = "!كات نزول";
const JOIN_COMMAND = "!كات صعود";

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const MAX_OCCUPANTS_TO_JOIN = 1;
const AUTHORIZATION_TIMEOUT_MS = 60000;

// ============================================================
// Runtime credentials
// ============================================================

let WOLF_TOKEN = "";
let WOLF_APP_CHECK_TOKEN = "";
let WOLF_DEVICE = "";
let WOLF_IS_APP_CHECK_ENABLED = false;

// ============================================================
// Runtime
// ============================================================

let service = null;
let socket = null;

let monitorInterval = null;
let currentSlotId = null;

let autoCheckEnabled = true;
let shuttingDown = false;

// ============================================================
// Helpers
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// Load credentials
// ============================================================

async function loadWolfCredentials() {
    console.log("");
    console.log("🐺 قراءة جلسة WOLF من Chrome...");
    console.log("");

    const session = await loadSession();

    if (!session?.token) {
        throw new Error(
            "لم يتم العثور على WOLF v3APIToken"
        );
    }

    // --------------------------------------------------------
    // Token from Chrome session
    // --------------------------------------------------------

    WOLF_TOKEN = session.token;

    // --------------------------------------------------------
    // App Check from Chrome session
    // --------------------------------------------------------

    WOLF_APP_CHECK_TOKEN =
        session.appCheckToken || "";

    // --------------------------------------------------------
    // Device ONLY from GitHub Secret
    // --------------------------------------------------------

    WOLF_DEVICE =
        process.env.WOLF_DEVICE || "web";

    // --------------------------------------------------------
    // App Check status
    // --------------------------------------------------------

    WOLF_IS_APP_CHECK_ENABLED =
        session.isAppCheckEnabled === true;

    // --------------------------------------------------------
    // Logs
    // --------------------------------------------------------

    console.log("");
    console.log("========================================");
    console.log("✅ تم استخراج WOLF credentials بنجاح");
    console.log("========================================");

    console.log(
        `📱 device: ${WOLF_DEVICE}`
    );

    console.log(
        `🛡️ isAppCheckEnabled: ${
            WOLF_IS_APP_CHECK_ENABLED
        }`
    );

    console.log(
        `🔐 token موجود: ${Boolean(WOLF_TOKEN)}`
    );

    console.log(
        `🔐 token length: ${WOLF_TOKEN.length}`
    );

    console.log(
        `🛡️ appCheckToken موجود: ${
            Boolean(WOLF_APP_CHECK_TOKEN)
        }`
    );

    console.log(
        `🛡️ appCheckToken length: ${
            WOLF_APP_CHECK_TOKEN.length
        }`
    );

    console.log("");
    console.log(
        "🔒 تم إغلاق Chrome."
    );

    console.log(
        "📡 سيتم الاتصال مباشرة عبر Socket.IO..."
    );

    console.log("");
}

// ============================================================
// Create WOLF service
// ============================================================

function createService() {
    service = new WOLF();

    service.config.framework.login.token =
        WOLF_TOKEN;

    service.config.framework.login.onlineState =
        OnlineState.INVISIBLE;

    if (WOLF_APP_CHECK_TOKEN) {
        service.config.framework.login.appCheckToken =
            WOLF_APP_CHECK_TOKEN;
    }

    return service;
}

// ============================================================
// Initialize handlers
// ============================================================

async function initializeHandlers() {
    console.log(
        "⚙️ Initializing service handlers..."
    );

    await service.websocket.init();

    const handlerCount =
        Object.keys(
            service.websocket.handlers || {}
        ).length;

    console.log(
        `⚙️ Loaded ${handlerCount} handlers`
    );
}

// ============================================================
// Wait for authorization
// ============================================================

async function waitForAuthorization(
    timeout = AUTHORIZATION_TIMEOUT_MS
) {
    const start = Date.now();

    console.log(
        "⏳ Waiting for authorization..."
    );

    while (
        Date.now() - start < timeout
    ) {
        if (service.currentSubscriber?.id) {
            console.log("");
            console.log(
                "========================================"
            );

            console.log(
                "✅ Authorization complete"
            );

            console.log(
                `👤 Account: ${
                    service.currentSubscriber.username ||
                    service.currentSubscriber.nickname ||
                    "Unknown"
                }`
            );

            console.log(
                `🆔 Account ID: ${
                    service.currentSubscriber.id
                }`
            );

            console.log(
                "========================================"
            );

            return;
        }

        await sleep(500);
    }

    throw new Error(
        "Authorization timeout"
    );
}

// ============================================================
// Socket.IO connection
// ============================================================

async function connectService() {
    const connection =
        service._frameworkConfig?.get?.(
            "connection"
        );

    const host =
        connection?.host ||
        "https://v3-rc.palringo.com";

    const port =
        connection?.port ?? 443;

    // ========================================================
    // IMPORTANT
    // Device comes ONLY from GitHub Secret
    // ========================================================

    const device =
        process.env.WOLF_DEVICE || "web";

    console.log("");
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
        `📱 Device: ${device}`
    );

    console.log(
        `🛡️ Security validation: ${
            WOLF_IS_APP_CHECK_ENABLED
                ? "enabled"
                : "disabled"
        }`
    );

    // ========================================================
    // Socket.IO
    // ========================================================

    socket = io(
        `${host}:${port}`,
        {
            transports: ["websocket"],

            reconnection: true,

            autoConnect: false,

            query: {
                token: WOLF_TOKEN,

                device,

                state:
                    service.config.framework.login
                        .onlineState,

                version:
                    connection?.version ||
                    undefined,

                isAppCheckEnabled:
                    WOLF_IS_APP_CHECK_ENABLED
                        ? "true"
                        : "false",

                appCheckToken:
                    WOLF_IS_APP_CHECK_ENABLED
                        ? WOLF_APP_CHECK_TOKEN
                        : undefined
            }
        }
    );

    service.websocket.socket = socket;

    // ========================================================
    // Connected
    // ========================================================

    socket.on(
        "connect",
        () => {
            console.log("");
            console.log(
                "========================================"
            );

            console.log(
                "🔗 Service connection established"
            );

            console.log(
                `🔗 Connection ID: ${socket.id}`
            );

            console.log(
                "========================================"
            );
        }
    );

    // ========================================================
    // Connection error
    // ========================================================

    socket.on(
        "connect_error",
        error => {
            console.error(
                "❌ Connection error:",
                error?.message || error
            );
        }
    );

    // ========================================================
    // Disconnect
    // ========================================================

    socket.on(
        "disconnect",
        reason => {
            console.log(
                `🔌 Connection closed: ${reason}`
            );
        }
    );

    // ========================================================
    // WOLF event handlers
    // ========================================================

    socket.onAny(
        async (eventName, data) => {
            try {
                const handler =
                    service.websocket
                        .handlers?.[eventName];

                if (!handler) {
                    return;
                }

                await handler.process(
                    data?.body ?? data
                );

            } catch (error) {
                console.error(
                    `❌ Handler error [${eventName}]:`,
                    error?.message || error
                );
            }
        }
    );

    console.log(
        "🔌 Connecting..."
    );

    socket.connect();

    await waitForAuthorization();
}

// ============================================================
// Get Stage slots
// ============================================================

async function getStageSlots() {
    return await service.stage.slot.list(
        GROUP_ID
    );
}

// ============================================================
// Find free slot
// ============================================================

function findFreeSlot(slots) {
    return slots.find(
        slot =>
            slot.occupierId == null
    );
}

// ============================================================
// Join Stage
// ============================================================

async function joinStage(force = false) {
    try {
        const slots =
            await getStageSlots();

        const occupants =
            slots.filter(
                slot =>
                    slot.occupierId != null
            );

        console.log("");
        console.log(
            `🎙️ Stage occupants: ${occupants.length}`
        );

        if (
            !force &&
            occupants.length >
                MAX_OCCUPANTS_TO_JOIN
        ) {
            console.log(
                "⏸️ عدد الموجودين في الستيج أكبر من الحد"
            );

            return false;
        }

        const freeSlot =
            findFreeSlot(slots);

        if (!freeSlot) {
            console.log(
                "⚠️ لا يوجد مكان شاغر في الستيج"
            );

            return false;
        }

        console.log(
            `🎙️ محاولة الصعود إلى Slot: ${freeSlot.id}`
        );

        await service.stage.slot.join(
            GROUP_ID,
            freeSlot.id
        );

        currentSlotId =
            freeSlot.id;

        console.log("");
        console.log(
            "========================================"
        );

        console.log(
            "🎙️ تم الصعود إلى الستيج"
        );

        console.log(
            `🎙️ Slot ID: ${currentSlotId}`
        );

        console.log(
            "========================================"
        );

        return true;

    } catch (error) {
        console.error(
            "❌ Stage join error:",
            error?.message || error
        );

        return false;
    }
}

// ============================================================
// Leave Stage
// ============================================================

async function leaveStage() {
    try {
        if (!currentSlotId) {
            console.log(
                "ℹ️ البوت ليس مسجلًا على Slot حالي"
            );

            return;
        }

        console.log(
            `🎙️ النزول من Slot: ${currentSlotId}`
        );

        await service.stage.slot.leave(
            GROUP_ID,
            currentSlotId
        );

        console.log(
            "✅ تم النزول من الستيج"
        );

        currentSlotId = null;

    } catch (error) {
        console.error(
            "❌ Stage leave error:",
            error?.message || error
        );
    }
}

// ============================================================
// Check Stage
// ============================================================

async function checkStageAndJoin() {
    if (
        shuttingDown ||
        !autoCheckEnabled
    ) {
        return;
    }

    try {
        console.log("");
        console.log(
            "🔎 Checking Stage..."
        );

        const slots =
            await getStageSlots();

        const occupants =
            slots.filter(
                slot =>
                    slot.occupierId != null
            );

        console.log(
            `🎙️ Current occupants: ${occupants.length}`
        );

        if (
            occupants.length >
            MAX_OCCUPANTS_TO_JOIN
        ) {
            console.log(
                "⏸️ لن أصعد حاليًا"
            );

            return;
        }

        const freeSlot =
            findFreeSlot(slots);

        if (!freeSlot) {
            console.log(
                "⚠️ لا يوجد Slot شاغر"
            );

            return;
        }

        const joined =
            await joinStage(false);

        if (joined) {
            autoCheckEnabled = false;

            if (monitorInterval) {
                clearInterval(
                    monitorInterval
                );

                monitorInterval = null;
            }
        }

    } catch (error) {
        console.error(
            "❌ Stage check error:",
            error?.message || error
        );
    }
}

// ============================================================
// Start Stage monitoring
// ============================================================

function startMonitoring() {
    if (monitorInterval) {
        clearInterval(
            monitorInterval
        );
    }

    autoCheckEnabled = true;

    console.log("");
    console.log(
        "📡 Stage monitor started"
    );

    console.log(
        `⏱️ Check every ${
            CHECK_INTERVAL_MS / 60000
        } minutes`
    );

    checkStageAndJoin();

    monitorInterval =
        setInterval(
            checkStageAndJoin,
            CHECK_INTERVAL_MS
        );
}

// ============================================================
// Private commands
// ============================================================

function initializePrivateCommands() {
    console.log(
        "📡 Private command listener active"
    );

    service.on(
        "privateMessage",
        async message => {
            try {
                const senderId =
                    Number(
                        message?.sender?.id ??
                        message?.subscriber?.id ??
                        message?.from?.id
                    );

                if (
                    !WATCHED_SUBSCRIBER_IDS.includes(
                        senderId
                    )
                ) {
                    return;
                }

                const text =
                    String(
                        message?.text ??
                        message?.message ??
                        ""
                    ).trim();

                if (!text) {
                    return;
                }

                console.log(
                    `[PRIVATE ${senderId}] ${text}`
                );

                // ==================================================
                // نزول
                // ==================================================

                if (
                    text ===
                    LEAVE_COMMAND
                ) {
                    console.log(
                        "📩 أمر نزول مستلم"
                    );

                    autoCheckEnabled = false;

                    if (monitorInterval) {
                        clearInterval(
                            monitorInterval
                        );

                        monitorInterval =
                            null;
                    }

                    await leaveStage();

                    startMonitoring();

                    return;
                }

                // ==================================================
                // صعود
                // ==================================================

                if (
                    text ===
                    JOIN_COMMAND
                ) {
                    console.log(
                        "📩 أمر صعود مستلم"
                    );

                    autoCheckEnabled = false;

                    if (monitorInterval) {
                        clearInterval(
                            monitorInterval
                        );

                        monitorInterval =
                            null;
                    }

                    await joinStage(true);

                    return;
                }

            } catch (error) {
                console.error(
                    "❌ Private message error:",
                    error?.message || error
                );
            }
        }
    );
}

// ============================================================
// Shutdown
// ============================================================

async function shutdown(
    signal = "UNKNOWN"
) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    console.log("");
    console.log(
        `🛑 Shutdown signal: ${signal}`
    );

    try {
        if (monitorInterval) {
            clearInterval(
                monitorInterval
            );

            monitorInterval = null;
        }
    } catch {}

    try {
        if (currentSlotId) {
            await leaveStage();
        }
    } catch {}

    try {
        if (socket) {
            socket.disconnect();
        }
    } catch {}

    console.log(
        "👋 Bot stopped"
    );

    process.exit(0);
}

// ============================================================
// Process signals
// ============================================================

process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);

process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);

// ============================================================
// Fatal errors
// ============================================================

process.on(
    "uncaughtException",
    error => {
        console.error("");
        console.error(
            "❌ UNCAUGHT EXCEPTION"
        );

        console.error(
            error?.stack ||
            error?.message ||
            error
        );
    }
);

process.on(
    "unhandledRejection",
    error => {
        console.error("");
        console.error(
            "❌ UNHANDLED REJECTION"
        );

        console.error(
            error?.stack ||
            error?.message ||
            error
        );
    }
);

// ============================================================
// Main
// ============================================================

async function main() {
    console.log("");
    console.log(
        "🐺 WOLF Bot started"
    );

    console.log(
        "========================================"
    );

    // --------------------------------------------------------
    // 1. Open Chrome and extract credentials
    // --------------------------------------------------------

    await loadWolfCredentials();

    // --------------------------------------------------------
    // 2. Create service
    // --------------------------------------------------------

    createService();

    // --------------------------------------------------------
    // 3. Initialize WOLF handlers
    // --------------------------------------------------------

    await initializeHandlers();

    // --------------------------------------------------------
    // 4. Private command listener
    // --------------------------------------------------------

    initializePrivateCommands();

    // --------------------------------------------------------
    // 5. Direct Socket.IO connection
    // --------------------------------------------------------

    await connectService();

    // --------------------------------------------------------
    // 6. Stage monitoring
    // --------------------------------------------------------

    console.log("");
    console.log(
        "🚀 Starting Stage monitor..."
    );

    startMonitoring();
}

// ============================================================
// Start
// ============================================================

main().catch(error => {
    console.error("");
    console.error(
        "❌ FATAL ERROR"
    );

    console.error(
        error?.stack ||
        error?.message ||
        error
    );

    process.exit(1);
});
