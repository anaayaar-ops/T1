import wolfjs from "wolf.js";
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

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const MAX_OCCUPANTS_TO_JOIN = 1;

// ============================================================
// Variables
// ============================================================

let WOLF_TOKEN = null;
let WOLF_APP_CHECK_TOKEN = null;
let WOLF_DEVICE = "web";
let WOLF_IS_APP_CHECK_ENABLED = true;

let service = null;
let socket = null;

let monitorTimer = null;
let autoCheckEnabled = true;
let currentSlotId = null;
let shuttingDown = false;

// ============================================================
// Helpers
// ============================================================

function isWatchedSubscriber(id) {
    return WATCHED_SUBSCRIBER_IDS.includes(Number(id));
}

// ============================================================
// تحميل Session
// ============================================================

async function loadWolfCredentials() {
    console.log("");
    console.log("========================================");
    console.log("🔐 تحميل WOLF credentials من Session");
    console.log("========================================");

    const session = await loadSession();

    if (!session) {
        throw new Error("❌ loadSession() لم يرجع Session");
    }

    WOLF_TOKEN = session.token;
    WOLF_APP_CHECK_TOKEN = session.appCheckToken;
    WOLF_DEVICE = session.device || "web";
    WOLF_IS_APP_CHECK_ENABLED = Boolean(
        session.isAppCheckEnabled
    );

    console.log("");
    console.log("📊 Session credentials:");
    console.log(`📱 device: ${WOLF_DEVICE}`);
    console.log(
        `🛡️ App Check: ${
            WOLF_IS_APP_CHECK_ENABLED
                ? "enabled"
                : "disabled"
        }`
    );

    console.log(
        `🔐 token موجود: ${Boolean(WOLF_TOKEN)}`
    );

    console.log(
        `🔐 token length: ${WOLF_TOKEN?.length ?? 0}`
    );

    console.log(
        `🛡️ appCheckToken موجود: ${Boolean(
            WOLF_APP_CHECK_TOKEN
        )}`
    );

    console.log(
        `🛡️ appCheckToken length: ${
            WOLF_APP_CHECK_TOKEN?.length ?? 0
        }`
    );

    if (!WOLF_TOKEN) {
        throw new Error(
            "❌ WOLF_TOKEN غير موجود"
        );
    }

    if (
        WOLF_IS_APP_CHECK_ENABLED &&
        !WOLF_APP_CHECK_TOKEN
    ) {
        throw new Error(
            "❌ App Check مفعل ولكن App Check Token غير موجود"
        );
    }

    console.log(
        "✅ تم تحميل WOLF credentials بنجاح"
    );
}

// ============================================================
// Create WOLF service
// ============================================================

function createWolfService() {
    service = new WOLF();

    // ========================================================
    // Token
    // ========================================================

    service.config.framework.login.token =
        WOLF_TOKEN;

    // ========================================================
    // Online State
    // ========================================================

    service.config.framework.login.onlineState =
        OnlineState.INVISIBLE;

    // ========================================================
    // Device
    // ========================================================

    const connection =
        service._frameworkConfig?.get?.(
            "connection"
        );

    if (
        connection?.query
    ) {
        connection.query.device =
            WOLF_DEVICE;
    }

    return service;
}

// ============================================================
// Initialize WOLF handlers
// ============================================================

async function initializeWolfHandlers() {
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

    // ========================================================
    // الحصول على Socket الذي أنشأه wolf.js
    // ========================================================

    socket =
        service.websocket.socket;

    if (!socket) {
        throw new Error(
            "❌ wolf.js لم ينشئ Socket.IO socket"
        );
    }

    // ========================================================
    // إضافة App Check إلى Query الخاصة بـ wolf.js
    //
    // Client.js في wolf.js لا يدعم appCheckToken
    // بشكل مباشر، لذلك نضيفه قبل socket.connect()
    // ========================================================

    if (
        socket.io?.opts?.query
    ) {
        socket.io.opts.query.device =
            WOLF_DEVICE;

        socket.io.opts.query.isAppCheckEnabled =
            WOLF_IS_APP_CHECK_ENABLED
                ? "true"
                : "false";

        if (
            WOLF_IS_APP_CHECK_ENABLED &&
            WOLF_APP_CHECK_TOKEN
        ) {
            socket.io.opts.query.appCheckToken =
                WOLF_APP_CHECK_TOKEN;
        }

        console.log(
            "🛡️ [WOLF] App Check query configured"
        );
    } else {
        console.warn(
            "⚠️ [WOLF] Socket.IO query object غير متاح"
        );
    }

    // ========================================================
    // Socket events
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

    socket.on(
        "connect_error",
        error => {
            console.error(
                "❌ [WOLF] Socket connect error:",
                error?.message || error
            );
        }
    );

    socket.on(
        "disconnect",
        reason => {
            console.log(
                `🔌 [WOLF] Socket disconnected: ${reason}`
            );
        }
    );
}

// ============================================================
// Private command listener
// ============================================================

function setupPrivateCommandListener() {
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

                if (
                    !isWatchedSubscriber(senderId)
                ) {
                    return;
                }

                console.log(
                    `📩 [BOT] أمر من ${senderId}: ${text}`
                );

                if (
                    text === LEAVE_COMMAND
                ) {
                    await leaveStage();
                    return;
                }

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
// Connect using wolf.js official Websocket
// ============================================================

async function connectWolf() {
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

    const connection =
        service._frameworkConfig?.get?.(
            "connection"
        );

    console.log(
        `🌐 WOLF host: ${
            connection?.host || "unknown"
        }`
    );

    console.log(
        `🔌 WOLF port: ${
            connection?.port ?? "unknown"
        }`
    );

    console.log(
        `📱 Device: ${WOLF_DEVICE}`
    );

    console.log(
        `🛡️ App Check: ${
            WOLF_IS_APP_CHECK_ENABLED
                ? "enabled"
                : "disabled"
        }`
    );

    console.log("");
    console.log(
        "🔌 [WOLF] الاتصال باستخدام Websocket الداخلي للمكتبة..."
    );

    // ========================================================
    // مهم:
    //
    // لا نستخدم io() هنا.
    //
    // wolf.js هو المسؤول عن:
    // - Socket.IO
    // - handlers
    // - WELCOME
    // - LOGIN
    // - READY
    // ========================================================

    await service.connect();

    console.log(
        "⏳ [WOLF] بانتظار اكتمال WELCOME / LOGIN..."
    );

    await waitForAuthorization();

    console.log(
        "✅ [WOLF] اكتمل اتصال WOLF والتفويض"
    );
}

// ============================================================
// Wait Authorization
// ============================================================

async function waitForAuthorization(
    timeout = 60000
) {
    const start =
        Date.now();

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

        await new Promise(
            resolve =>
                setTimeout(resolve, 500)
        );
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
// Get Stage slots
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
// Automatic Stage check
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

        const occupiedSlots =
            slots.filter(
                slot =>
                    !!slot?.occupierId
            );

        console.log(
            `👥 عدد الموجودين على Stage: ${occupiedSlots.length}`
        );

        if (
            occupiedSlots.length >
            MAX_OCCUPANTS_TO_JOIN
        ) {
            console.log(
                "⏭️ عدد الموجودين أكبر من الحد، لن نصعد."
            );

            return;
        }

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

async function shutdown(signal) {
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
        if (
            currentSlotId &&
            service?.stage?.slot
        ) {
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

            currentSlotId =
                null;
        }
    } catch (error) {
        console.error(
            "❌ فشل النزول:",
            error?.message || error
        );
    }

    // ========================================================
    // Disconnect through wolf.js
    // ========================================================

    try {
        if (service) {
            await service.disconnect();
        }
    } catch (error) {
        console.error(
            "❌ فشل إغلاق WOLF:",
            error?.message || error
        );

        try {
            socket?.disconnect();
        } catch {}
    }

    console.log(
        "🔌 تم إغلاق اتصال WOLF."
    );

    console.log(
        "👋 تم إيقاف البوت."
    );

    process.exit(0);
}

// ============================================================
// Signal handlers
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
    console.log(
        "🐺 WOLF Bot started"
    );

    console.log(
        "========================================"
    );

    console.log(
        "🔐 WOLF Session Login"
    );

    console.log(
        "========================================"
    );

    // ========================================================
    // 1. قراءة Session
    // ========================================================

    await loadWolfCredentials();

    // ========================================================
    // 2. إنشاء WOLF Service
    // ========================================================

    createWolfService();

    // ========================================================
    // 3. تهيئة WOLF Handlers + Socket
    // ========================================================

    await initializeWolfHandlers();

    // ========================================================
    // 4. تشغيل مراقب الرسائل الخاصة
    // ========================================================

    setupPrivateCommandListener();

    // ========================================================
    // 5. الاتصال الرسمي عن طريق wolf.js
    // ========================================================

    await connectWolf();

    // ========================================================
    // 6. فحص Stage API
    // ========================================================

    await verifyStageAPI();

    console.log(
        "🟢 تم تسجيل الدخول بنجاح."
    );

    console.log(
        "👻 تم ضبط الحالة على Invisible."
    );

    // ========================================================
    // 7. فحص Stage مباشرة
    // ========================================================

    await checkStage();

    // ========================================================
    // 8. تشغيل المراقبة
    // ========================================================

    if (!currentSlotId) {
        startMonitoring();
    }

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
            await service?.disconnect();
        } catch {}

        try {
            socket?.disconnect();
        } catch {}

        process.exit(1);
    }
);
