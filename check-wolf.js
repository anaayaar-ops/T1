import wolfjs from "wolf.js";
import { io } from "socket.io-client";
import { loadSession } from "./session-loader.js";

const { WOLF, OnlineState } = wolfjs;

// ============================================================
// إعدادات البوت
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

const CHECK_INTERVAL_MS =
    10 * 60 * 1000;

const MAX_OCCUPANTS_TO_JOIN = 1;

// ============================================================
// WOLF ثابت
// ============================================================

const DEFAULT_DEVICE = "web";
const DEFAULT_APP_CHECK_ENABLED = true;

// ============================================================
// Variables
// ============================================================

let WOLF_TOKEN = null;
let WOLF_APP_CHECK_TOKEN = null;

let service = null;
let socket = null;

let monitorTimer = null;

let autoCheckEnabled = true;

let currentSlotId = null;

let shuttingDown = false;

// ============================================================
// Helpers
// ============================================================

function sleep(ms) {

    return new Promise(
        resolve => {
            setTimeout(
                resolve,
                ms
            );
        }
    );
}

function isWatchedSubscriber(id) {

    return WATCHED_SUBSCRIBER_IDS.includes(
        Number(id)
    );
}

function maskToken(value) {

    if (!value) {
        return "غير موجود";
    }

    const text =
        String(value);

    if (text.length <= 16) {

        return (
            `${text.slice(0, 4)}...${text.slice(-4)}`
        );
    }

    return (
        `${text.slice(0, 8)}...${text.slice(-8)}`
    );
}

// ============================================================
// Load WOLF Credentials
// ============================================================

async function loadWolfCredentials() {

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "🔐 تحميل WOLF Profile"
    );

    console.log(
        "========================================"
    );

    const session =
        await loadSession();

    if (!session) {

        throw new Error(
            "❌ تعذر تحميل WOLF Chrome Profile"
        );
    }

    WOLF_TOKEN =
        session.token;

    WOLF_APP_CHECK_TOKEN =
        session.appCheckToken;

    if (!WOLF_TOKEN) {

        throw new Error(
            "❌ لم يتم العثور على v3APIToken"
        );
    }

    if (!WOLF_APP_CHECK_TOKEN) {

        throw new Error(
            "❌ لم يتم العثور على appCheckToken"
        );
    }

    console.log(
        "✅ تم الحصول على WOLF credentials من Chrome"
    );

    console.log(
        `🔐 v3APIToken: ${maskToken(WOLF_TOKEN)}`
    );

    console.log(
        `🔐 WOLF token length: ${WOLF_TOKEN.length}`
    );

    console.log(
        `🛡️ appCheckToken: ${maskToken(WOLF_APP_CHECK_TOKEN)}`
    );

    console.log(
        `🛡️ AppCheck token length: ${WOLF_APP_CHECK_TOKEN.length}`
    );

    // ========================================================
    // ثابتة
    // ========================================================

    console.log(
        "📱 Device: web"
    );

    console.log(
        "🛡️ App Check Enabled: true"
    );

    console.log(
        "========================================"
    );
}

// ============================================================
// Create WOLF Service
// ============================================================

function createWolfService() {

    console.log("");
    console.log(
        "🐺 إنشاء WOLF service..."
    );

    service =
        new WOLF();

    // ========================================================
    // wolf.js 2.7.10
    // ========================================================

    service.config.framework.login.token =
        WOLF_TOKEN;

    service.config.framework.login.onlineState =
        OnlineState.INVISIBLE;

    if (WOLF_APP_CHECK_TOKEN) {

        service.config.framework.login.appCheckToken =
            WOLF_APP_CHECK_TOKEN;
    }

    console.log(
        "📱 Device: web"
    );

    console.log(
        "🛡️ App Check: true"
    );

    console.log(
        "👻 Online State: Invisible"
    );

    console.log(
        "✅ WOLF service جاهز"
    );

    return service;
}

// ============================================================
// Initialize WOLF Handlers
// ============================================================

async function initializeWolfHandlers() {

    console.log("");
    console.log(
        "⚙️ [WOLF] Initializing wolf.js handlers..."
    );

    await service.websocket.init();

    const handlerCount =
        Object.keys(
            service.websocket.handlers || {}
        ).length;

    console.log(
        `⚙️ [WOLF] Loaded ${handlerCount} socket handlers`
    );
}

// ============================================================
// Private Command Listener
// ============================================================

function setupPrivateCommandListener() {

    service.on(
        "privateMessage",
        async message => {

            try {

                const senderId =
                    Number(
                        message?.sourceSubscriberId ??
                        message?.senderId ??
                        message?.sender?.id ??
                        message?.subscriberId
                    );

                const text =
                    String(
                        message?.body ??
                        message?.text ??
                        message?.message ??
                        ""
                    ).trim();

                if (!senderId || !text) {
                    return;
                }

                if (
                    !isWatchedSubscriber(
                        senderId
                    )
                ) {
                    return;
                }

                console.log(
                    `📩 [BOT] أمر من ${senderId}: ${text}`
                );

                // ------------------------------------------------
                // Leave
                // ------------------------------------------------

                if (
                    text === LEAVE_COMMAND
                ) {

                    await leaveStage();

                    return;
                }

                // ------------------------------------------------
                // Join
                // ------------------------------------------------

                if (
                    text === JOIN_COMMAND
                ) {

                    await forceJoinStage();

                    return;
                }

            } catch (error) {

                console.error(
                    "❌ privateMessage error:",
                    error?.message || error
                );
            }
        }
    );

    console.log(
        "📡 [BOT] Private command listener active"
    );
}

// ============================================================
// Connect WOLF Socket.IO
// ============================================================

async function connectWolfSocket() {

    const connection =
        service._frameworkConfig?.get?.(
            "connection"
        );

    const host =
        connection?.host ||
        "https://v3-rc.palringo.com";

    const port =
        connection?.port ?? 443;

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "🔌 تشغيل اتصال WOLF API"
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
        "📱 Device: web"
    );

    console.log(
        "🛡️ App Check: enabled"
    );

    console.log(
        `🔐 Token: ${maskToken(WOLF_TOKEN)}`
    );

    console.log(
        `🛡️ AppCheck: ${maskToken(WOLF_APP_CHECK_TOKEN)}`
    );

    console.log(
        "========================================"
    );

    // ========================================================
    // Socket.IO
    // ========================================================

    socket =
        io(
            `${host}:${port}`,
            {

                transports: [
                    "websocket"
                ],

                reconnection: true,

                autoConnect: false,

                query: {

                    token:
                        WOLF_TOKEN,

                    // ثابت
                    device:
                        "web",

                    state:
                        service.config.framework.login
                            .onlineState,

                    version:
                        connection?.version ||
                        undefined,

                    // ثابت
                    isAppCheckEnabled:
                        "true",

                    appCheckToken:
                        WOLF_APP_CHECK_TOKEN
                }
            }
        );

    // ========================================================
    // Attach Socket
    // ========================================================

    service.websocket.socket =
        socket;

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
                "🔗 [WOLF] Socket.IO connected"
            );

            console.log(
                `🔗 Socket ID: ${socket.id}`
            );

            console.log(
                "========================================"
            );
        }
    );

    // ========================================================
    // Connect Error
    // ========================================================

    socket.on(
        "connect_error",
        error => {

            console.error(
                "❌ [WOLF] Socket connect error:",
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
                `🔌 [WOLF] Socket disconnected: ${reason}`
            );
        }
    );

    // ========================================================
    // WOLF Events
    // ========================================================

    socket.onAny(
        async (
            eventName,
            data
        ) => {

            try {

                const handler =
                    service.websocket.handlers?.[
                        eventName
                    ];

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
        "🔌 [WOLF] Connecting..."
    );

    socket.connect();

    await waitForAuthorization();
}

// ============================================================
// Wait Authorization
// ============================================================

async function waitForAuthorization(
    timeout = 60000
) {

    const start =
        Date.now();

    console.log(
        "⏳ [WOLF] Waiting for authorization..."
    );

    while (
        Date.now() - start <
        timeout
    ) {

        if (
            service.currentSubscriber?.id
        ) {

            console.log("");
            console.log(
                "========================================"
            );

            console.log(
                "✅ [WOLF] Authorization complete"
            );

            console.log(
                `👤 Logged in as: ${
                    service.currentSubscriber.username ||
                    service.currentSubscriber.nickname ||
                    "Unknown"
                }`
            );

            console.log(
                `🆔 Subscriber ID: ${
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
        "Timeout waiting for WOLF authorization"
    );
}

// ============================================================
// Verify Stage API
// ============================================================

async function verifyStageAPI() {

    console.log(
        `🧪 [${GROUP_ID}] فحص Stage API...`
    );

    await service.stage.getAudioConfig(
        GROUP_ID
    );

    console.log(
        "✅ Stage API 2.7.10 جاهز"
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
        `🎙️ [${GROUP_ID}] جاري فحص Stage...`
    );

    try {

        const slots =
            await getStageSlots();

        console.log(
            `📦 [${GROUP_ID}] تم استلام ${slots.length} slots`
        );

        // ====================================================
        // Occupied
        // ====================================================

        const occupiedSlots =
            slots.filter(
                slot =>
                    !!slot?.occupierId
            );

        console.log(
            `👥 عدد الموجودين على Stage: ${occupiedSlots.length}`
        );

        // ====================================================
        // Too many
        // ====================================================

        if (
            occupiedSlots.length >
            MAX_OCCUPANTS_TO_JOIN
        ) {

            console.log(
                "⏭️ عدد الموجودين أكبر من الحد، لن نصعد."
            );

            return;
        }

        // ====================================================
        // Free slot
        // ====================================================

        const freeSlot =
            slots.find(
                slot =>
                    !slot?.occupierId
            );

        if (!freeSlot) {

            console.log(
                "⚠️ لا يوجد Slot فارغ."
            );

            return;
        }

        // ====================================================
        // Join
        // ====================================================

        console.log(
            `🎙️ جاري الصعود إلى Slot ${freeSlot.id}...`
        );

        await service.stage.slot.join(
            GROUP_ID,
            freeSlot.id
        );

        currentSlotId =
            freeSlot.id;

        console.log(
            `✅ تم الصعود بنجاح إلى Slot ${currentSlotId}`
        );

        autoCheckEnabled =
            false;

        stopMonitoring();

        console.log(
            "🛑 تم إيقاف الفحص التلقائي بعد الصعود"
        );

    } catch (error) {

        console.error(
            "❌ Stage check error:",
            error?.message || error
        );
    }
}

// ============================================================
// Force Join
// ============================================================

async function forceJoinStage() {

    console.log(
        `🎙️ [${GROUP_ID}] صعود إجباري إلى Stage...`
    );

    try {

        const slots =
            await getStageSlots();

        console.log(
            `📦 تم استلام ${slots.length} slots`
        );

        const freeSlot =
            slots.find(
                slot =>
                    !slot?.occupierId
            );

        if (!freeSlot) {

            console.log(
                "❌ لا يوجد Slot فارغ."
            );

            return;
        }

        console.log(
            `🎙️ جاري الصعود الإجباري إلى Slot ${freeSlot.id}...`
        );

        await service.stage.slot.join(
            GROUP_ID,
            freeSlot.id
        );

        currentSlotId =
            freeSlot.id;

        console.log(
            `✅ تم الصعود بنجاح إلى Slot ${currentSlotId}`
        );

        autoCheckEnabled =
            false;

        stopMonitoring();

        console.log(
            "🛑 تم إيقاف المراقبة التلقائية بعد الصعود"
        );

    } catch (error) {

        console.error(
            "❌ Force join error:",
            error?.message || error
        );
    }
}

// ============================================================
// Leave Stage
// ============================================================

async function leaveStage() {

    if (!currentSlotId) {

        console.log(
            "ℹ️ البوت ليس على Stage."
        );

        return;
    }

    console.log(
        `🛑 جاري النزول من Slot ${currentSlotId}...`
    );

    try {

        await service.stage.slot.leave(
            GROUP_ID,
            currentSlotId
        );

        console.log(
            "✅ تم النزول من Stage"
        );

    } catch (error) {

        console.error(
            "❌ Leave Stage error:",
            error?.message || error
        );
    }

    currentSlotId =
        null;

    autoCheckEnabled =
        false;

    stopMonitoring();

    console.log(
        "🛑 المراقبة التلقائية متوقفة بعد أمر النزول"
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
            "🛑 لا حاجة لتشغيل الفحص الدوري."
        );

        return;
    }

    console.log(
        "🔄 تم تشغيل مراقبة Stage"
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

        monitorTimer =
            null;
    }
}

// ============================================================
// Shutdown
// ============================================================

async function shutdown(
    signal
) {

    if (shuttingDown) {
        return;
    }

    shuttingDown =
        true;

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        `🛑 إغلاق البوت بسبب ${signal}`
    );

    console.log(
        "========================================"
    );

    stopMonitoring();

    // ========================================================
    // Leave Stage
    // ========================================================

    try {

        if (currentSlotId) {

            console.log(
                `🛑 جاري النزول من Stage قبل الإغلاق — Slot ${currentSlotId}`
            );

            await service.stage.slot.leave(
                GROUP_ID,
                currentSlotId
            );

            console.log(
                "✅ تم النزول من Stage."
            );
        }

    } catch (error) {

        console.error(
            "❌ فشل النزول:",
            error?.message || error
        );
    }

    // ========================================================
    // Disconnect
    // ========================================================

    try {

        socket?.disconnect();

    } catch {}

    console.log(
        "🔌 تم إغلاق اتصال WOLF."
    );

    console.log(
        "👋 تم إيقاف البوت."
    );

    process.exit(0);
}

// ============================================================
// Signals
// ============================================================

process.on(
    "SIGINT",
    () =>
        shutdown("SIGINT")
);

process.on(
    "SIGTERM",
    () =>
        shutdown("SIGTERM")
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

    console.log(
        "🔐 WOLF Chrome Profile Login"
    );

    console.log(
        "========================================"
    );

    // ========================================================
    // تحميل ZIP + Chrome + credentials
    // ========================================================

    await loadWolfCredentials();

    // ========================================================
    // Create service
    // ========================================================

    createWolfService();

    // ========================================================
    // Handlers
    // ========================================================

    await initializeWolfHandlers();

    // ========================================================
    // Private commands
    // ========================================================

    setupPrivateCommandListener();

    // ========================================================
    // Connect
    // ========================================================

    await connectWolfSocket();

    // ========================================================
    // Stage API
    // ========================================================

    await verifyStageAPI();

    console.log("");
    console.log(
        "🟢 تم تسجيل الدخول بنجاح."
    );

    console.log(
        "👻 تم ضبط الحالة على Invisible."
    );

    // ========================================================
    // First check
    // ========================================================

    await checkStage();

    // ========================================================
    // Monitoring
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
        "✅ [BOT] كل شيء يعمل والبوت مستمر..."
    );

    console.log(
        `🏠 GROUP_ID: ${GROUP_ID}`
    );

    console.log(
        `🎙️ MAX_OCCUPANTS_TO_JOIN: ${MAX_OCCUPANTS_TO_JOIN}`
    );

    console.log(
        "📱 DEVICE: web"
    );

    console.log(
        "🛡️ APP CHECK: true"
    );

    console.log(
        "⏱️ CHECK_INTERVAL: 10 minutes"
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
            "❌ FATAL ERROR"
        );

        console.error(
            error?.stack ||
            error?.message ||
            error
        );

        try {
            socket?.disconnect();
        } catch {}

        process.exit(1);
    }
);
