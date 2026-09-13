import wolfjs from "wolf.js";
import { io } from "socket.io-client";
import { loadSession } from "./session-loader.js";

const { WOLF, OnlineState } = wolfjs;

// ============================================================
// Service Configuration
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

// ============================================================
// Runtime Variables
// ============================================================

let service = null;
let socket = null;
let monitorTimer = null;

let autoCheckEnabled = true;
let currentSlotId = null;
let shuttingDown = false;

// ============================================================
// Session Credentials
// ============================================================

let WOLF_TOKEN = "";
let WOLF_APP_CHECK_TOKEN = "";
let WOLF_DEVICE = "web";
let WOLF_IS_APP_CHECK_ENABLED = false;

// ============================================================
// Helpers
// ============================================================

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function isWatchedSubscriber(id) {
    return WATCHED_SUBSCRIBER_IDS.includes(Number(id));
}

// ============================================================
// Load Session From Chrome
// ============================================================

async function loadWolfCredentials() {
    console.log("");
    console.log(
        "========================================"
    );
    console.log(
        "🌐 فتح Chrome لاستخراج جلسة WOLF"
    );
    console.log(
        "========================================"
    );

    const session = await loadSession();

    if (!session) {
        throw new Error(
            "session-loader لم يرجع بيانات الجلسة"
        );
    }

    if (!session.token) {
        throw new Error(
            "لم يتم العثور على v3APIToken"
        );
    }

    WOLF_TOKEN = session.token;

    WOLF_APP_CHECK_TOKEN =
        session.appCheckToken || "";

    WOLF_DEVICE =
        session.device || "web";

    WOLF_IS_APP_CHECK_ENABLED =
        session.isAppCheckEnabled === true;

    console.log("");
    console.log(
        "========================================"
    );
    console.log(
        "✅ تم استخراج WOLF credentials"
    );
    console.log(
        "========================================"
    );

    console.log(
        `📱 device: ${WOLF_DEVICE}`
    );

    console.log(
        `🛡️ isAppCheckEnabled: ${
            WOLF_IS_APP_CHECK_ENABLED
        }`
    );

    console.log(
        `🔐 token موجود: ${
            WOLF_TOKEN ? "true" : "false"
        }`
    );

    console.log(
        `🔐 token length: ${WOLF_TOKEN.length}`
    );

    console.log(
        `🛡️ appCheckToken موجود: ${
            WOLF_APP_CHECK_TOKEN
                ? "true"
                : "false"
        }`
    );

    console.log(
        `🛡️ appCheckToken length: ${
            WOLF_APP_CHECK_TOKEN.length
        }`
    );

    console.log("");
    console.log(
        "🔒 Chrome انتهى استخدامه."
    );

    console.log(
        "🔌 سيتم الاتصال الآن عبر Socket.IO فقط."
    );

    console.log(
        "========================================"
    );
}

// ============================================================
// Create WOLF Service
// ============================================================

function createService() {
    service = new WOLF();

    service.config.framework.login.token =
        WOLF_TOKEN;

    service.config.framework.login.onlineState =
        OnlineState.INVISIBLE;

    return service;
}

// ============================================================
// Initialize WOLF Handlers
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
        `⚙️ Loaded ${handlerCount} socket handlers`
    );
}

// ============================================================
// Private Command Listener
// ============================================================

function setupCommandListener() {
    service.on(
        "privateMessage",
        async message => {
            try {
                const senderId = Number(
                    message?.sourceSubscriberId ??
                    message?.senderId ??
                    message?.sender?.id ??
                    message?.subscriberId
                );

                const text = String(
                    message?.body ??
                    message?.text ??
                    message?.message ??
                    ""
                ).trim();

                if (!senderId || !text) {
                    return;
                }

                if (!isWatchedSubscriber(senderId)) {
                    return;
                }

                console.log(
                    `📩 Command received from ${senderId}: ${text}`
                );

                if (text === LEAVE_COMMAND) {
                    await leaveStage();
                    return;
                }

                if (text === JOIN_COMMAND) {
                    await forceJoinStage();
                    return;
                }

            } catch (error) {
                console.error(
                    "❌ Command listener error:",
                    error?.stack ||
                    error?.message ||
                    error
                );
            }
        }
    );

    console.log(
        "📡 Private command listener active"
    );
}

// ============================================================
// Connect Service
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

    const device =
        connection?.query?.device ||
        WOLF_DEVICE ||
        "web";

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "🔌 Starting WOLF Socket.IO connection"
    );

    console.log(
        "========================================"
    );

    console.log(
        "🐺 wolf.js version: 2.7.10"
    );

    console.log(
        `🌐 WOLF host: ${host}`
    );

    console.log(
        `🔌 WOLF port: ${port}`
    );

    console.log(
        `📱 Device: ${device}`
    );

    console.log(
        `🛡️ App Check: ${
            WOLF_IS_APP_CHECK_ENABLED
                ? "enabled"
                : "disabled"
        }`
    );

    // ========================================================
    // IMPORTANT
    //
    // هذا هو نفس أسلوب الاتصال الذي يعمل عندك.
    //
    // Chrome لم يعد مستخدمًا هنا.
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
                    service.config.framework
                        .login.onlineState,

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

    // ========================================================
    // ربط الـ Socket مع wolf.js
    // ========================================================

    service.websocket.socket = socket;

    // ========================================================
    // Socket Connected
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
    // Connection Error
    // ========================================================

    socket.on(
        "connect_error",
        error => {
            console.error(
                "❌ Connection error:",
                error?.message ||
                error
            );
        }
    );

    // ========================================================
    // Socket Error
    // ========================================================

    socket.on(
        "error",
        error => {
            console.error(
                "❌ Socket error:",
                error?.message ||
                error
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
    // WOLF Events
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
                    error?.stack ||
                    error?.message ||
                    error
                );
            }
        }
    );

    // ========================================================
    // Connect
    // ========================================================

    console.log(
        "🔌 Connecting..."
    );

    socket.connect();

    // ========================================================
    // Wait Until wolf.js Gets Subscriber
    // ========================================================

    await waitForAuthorization();
}

// ============================================================
// Wait For Authorization
// ============================================================

async function waitForAuthorization(
    timeout = 60000
) {
    const start = Date.now();

    console.log(
        "⏳ Waiting for authorization..."
    );

    while (
        Date.now() - start < timeout
    ) {
        if (
            service.currentSubscriber?.id
        ) {
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
// Verify Stage API
// ============================================================

async function verifyStageAPI() {
    console.log(
        `🧪 Checking Stage service for group ${GROUP_ID}...`
    );

    await service.stage.getAudioConfig(
        GROUP_ID
    );

    console.log(
        "✅ Stage service is ready"
    );
}

// ============================================================
// Get Stage Slots
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

// ============================================================
// Automatic Stage Check
// ============================================================

async function checkStage() {
    if (!autoCheckEnabled) {
        return;
    }

    if (currentSlotId) {
        return;
    }

    console.log(
        `🎙️ Checking Stage for group ${GROUP_ID}...`
    );

    try {
        const slots =
            await getStageSlots();

        console.log(
            `📦 Received ${slots.length} slots`
        );

        const occupiedSlots =
            slots.filter(
                slot => !!slot?.occupierId
            );

        console.log(
            `👥 Current occupants: ${occupiedSlots.length}`
        );

        if (
            occupiedSlots.length >
            MAX_OCCUPANTS_TO_JOIN
        ) {
            console.log(
                "⏭️ Occupancy limit reached, skipping."
            );

            return;
        }

        const freeSlot =
            slots.find(
                slot => !slot?.occupierId
            );

        if (!freeSlot) {
            console.log(
                "⚠️ No available slot."
            );

            return;
        }

        console.log(
            `🎙️ Joining slot ${freeSlot.id}...`
        );

        await service.stage.slot.join(
            GROUP_ID,
            freeSlot.id
        );

        currentSlotId =
            freeSlot.id;

        console.log(
            `✅ Joined successfully: slot ${currentSlotId}`
        );

        autoCheckEnabled = false;

        stopMonitoring();

        console.log(
            "🛑 Automatic checking stopped after joining"
        );

    } catch (error) {
        console.error(
            "❌ Stage check error:",
            error?.stack ||
            error?.message ||
            error
        );
    }
}

// ============================================================
// Force Join
// ============================================================

async function forceJoinStage() {
    console.log(
        `🎙️ Forced Stage join requested for ${GROUP_ID}...`
    );

    try {
        const slots =
            await getStageSlots();

        console.log(
            `📦 Received ${slots.length} slots`
        );

        const freeSlot =
            slots.find(
                slot => !slot?.occupierId
            );

        if (!freeSlot) {
            console.log(
                "❌ No available slot."
            );

            return;
        }

        console.log(
            `🎙️ Joining slot ${freeSlot.id}...`
        );

        await service.stage.slot.join(
            GROUP_ID,
            freeSlot.id
        );

        currentSlotId =
            freeSlot.id;

        console.log(
            `✅ Joined successfully: slot ${currentSlotId}`
        );

        autoCheckEnabled = false;

        stopMonitoring();

        console.log(
            "🛑 Automatic monitoring stopped"
        );

    } catch (error) {
        console.error(
            "❌ Forced join error:",
            error?.stack ||
            error?.message ||
            error
        );
    }
}

// ============================================================
// Leave Stage
// ============================================================

async function leaveStage() {
    if (!currentSlotId) {
        console.log(
            "ℹ️ No active Stage slot."
        );

        return;
    }

    console.log(
        `🛑 Leaving slot ${currentSlotId}...`
    );

    try {
        await service.stage.slot.leave(
            GROUP_ID,
            currentSlotId
        );

        console.log(
            "✅ Stage slot released"
        );

    } catch (error) {
        console.error(
            "❌ Leave operation error:",
            error?.stack ||
            error?.message ||
            error
        );
    }

    currentSlotId = null;

    autoCheckEnabled = false;

    stopMonitoring();

    console.log(
        "🛑 Automatic monitoring stopped"
    );
}

// ============================================================
// Monitoring
// ============================================================

function startMonitoring() {
    stopMonitoring();

    if (
        !autoCheckEnabled ||
        currentSlotId
    ) {
        console.log(
            "🛑 Periodic monitoring not required."
        );

        return;
    }

    console.log(
        "🔄 Periodic monitoring started"
    );

    monitorTimer =
        setInterval(
            checkStage,
            CHECK_INTERVAL_MS
        );
}

function stopMonitoring() {
    if (monitorTimer) {
        clearInterval(
            monitorTimer
        );

        monitorTimer = null;
    }
}

// ============================================================
// Shutdown
// ============================================================

async function shutdown(signal) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        `🛑 Shutdown requested: ${signal}`
    );

    console.log(
        "========================================"
    );

    stopMonitoring();

    // --------------------------------------------------------
    // Release Stage
    // --------------------------------------------------------

    try {
        if (currentSlotId) {
            console.log(
                `🛑 Releasing active slot ${currentSlotId}...`
            );

            await service.stage.slot.leave(
                GROUP_ID,
                currentSlotId
            );

            console.log(
                "✅ Slot released"
            );
        }
    } catch (error) {
        console.error(
            "❌ Failed to release slot:",
            error?.stack ||
            error?.message ||
            error
        );
    }

    // --------------------------------------------------------
    // Close Socket.IO
    // --------------------------------------------------------

    try {
        socket?.disconnect();
    } catch {}

    console.log(
        "🔌 Connection closed."
    );

    console.log(
        "👋 Service stopped."
    );

    process.exit(0);
}

// ============================================================
// Process Signals
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
// Main
// ============================================================

async function main() {
    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "🐺 WOLF 2.7.10"
    );

    console.log(
        "========================================"
    );

    console.log(
        "🚀 Service started"
    );

    // ========================================================
    // STEP 1
    // فتح Chrome واستخراج credentials
    // ========================================================

    await loadWolfCredentials();

    // ========================================================
    // STEP 2
    // إنشاء wolf.js
    // ========================================================

    createService();

    // ========================================================
    // STEP 3
    // تحميل handlers
    // ========================================================

    await initializeHandlers();

    // ========================================================
    // STEP 4
    // Listener للأوامر الخاصة
    // ========================================================

    setupCommandListener();

    // ========================================================
    // STEP 5
    //
    // Chrome مغلق الآن.
    //
    // الاتصال التالي Socket.IO فقط.
    // ========================================================

    await connectService();

    // ========================================================
    // STEP 6
    // Verify Stage
    // ========================================================

    await verifyStageAPI();

    console.log(
        "🟢 Authorization successful."
    );

    console.log(
        "👻 Presence set to Invisible."
    );

    // ========================================================
    // STEP 7
    // أول فحص للـ Stage
    // ========================================================

    await checkStage();

    // ========================================================
    // STEP 8
    // تشغيل المراقبة
    // ========================================================

    if (!currentSlotId) {
        startMonitoring();
    }

    // ========================================================
    // Running
    // ========================================================

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "✅ Service is running..."
    );

    console.log(
        `🏠 Group: ${GROUP_ID}`
    );

    console.log(
        `🎙️ Occupancy threshold: ${MAX_OCCUPANTS_TO_JOIN}`
    );

    console.log(
        "⏱️ Check interval: 10 minutes"
    );

    console.log(
        "🌐 Chrome: CLOSED"
    );

    console.log(
        "🔌 Connection: Socket.IO / WebSocket"
    );

    console.log(
        "========================================"
    );
}

// ============================================================
// Start
// ============================================================

main().catch(
    async error => {
        console.error("");
        console.error(
            "========================================"
        );

        console.error(
            "❌ FATAL ERROR"
        );

        console.error(
            error?.stack ||
            error?.message ||
            error
        );

        console.error(
            "========================================"
        );

        try {
            socket?.disconnect();
        } catch {}

        process.exit(1);
    }
);
