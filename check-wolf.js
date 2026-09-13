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

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const MAX_OCCUPANTS_TO_JOIN = 1;

// ============================================================
// Credentials
// ============================================================

let WOLF_TOKEN = "";
let WOLF_APP_CHECK_TOKEN = "";

let WOLF_DEVICE =
    process.env.WOLF_DEVICE || "web";

let WOLF_IS_APP_CHECK_ENABLED =
    String(
        process.env.WOLF_IS_APP_CHECK_ENABLED
    ).toLowerCase() === "true";

// ============================================================
// Variables
// ============================================================

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
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function isWatchedSubscriber(id) {
    return WATCHED_SUBSCRIBER_IDS.includes(
        Number(id)
    );
}

// ============================================================
// Load Chrome Session
// ============================================================

async function initializeSession() {

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "🔐 تحميل WOLF credentials من Chrome"
    );

    console.log(
        "========================================"
    );

    const session =
        await loadSession();

    if (!session) {
        throw new Error(
            "لم يتم الحصول على WOLF session"
        );
    }

    if (!session.v3APIToken) {
        throw new Error(
            "WOLF v3APIToken غير موجود في session"
        );
    }

    WOLF_TOKEN =
        session.v3APIToken;

    WOLF_APP_CHECK_TOKEN =
        session.appCheckToken || "";

    if (session.device) {
        WOLF_DEVICE =
            session.device;
    }

    if (
        typeof session.isAppCheckEnabled !==
        "undefined"
    ) {
        WOLF_IS_APP_CHECK_ENABLED =
            String(
                session.isAppCheckEnabled
            ).toLowerCase() === "true";
    }

    console.log(
        "✅ WOLF credentials loaded from Chrome session"
    );

    console.log(
        `🔐 WOLF token length: ${WOLF_TOKEN.length}`
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

    console.log(
        `🛡️ App Check token length: ${
            WOLF_APP_CHECK_TOKEN.length
        }`
    );

    console.log(
        "========================================"
    );
}

// ============================================================
// Create WOLF service
// ============================================================

function createWolfService() {

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
                    !isWatchedSubscriber(
                        senderId
                    )
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
// Connect WOLF Socket.IO
// ============================================================

async function connectWolfSocket() {

    // ========================================================
    // نفس Host الذي تستخدمه Chrome
    // ========================================================

    const host =
        "https://v3.palringo.com";

    const port = 443;

    const device =
        WOLF_DEVICE || "web";

    // ========================================================
    // Chrome-like headers
    // ========================================================

    const chromeUserAgent =
        "Mozilla/5.0 (X11; Linux x86_64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/140.0.0.0 Safari/537.36";

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "🔌 تشغيل اتصال WOLF API..."
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

    console.log(
        `🔐 Token loaded: ${
            WOLF_TOKEN
                ? "yes"
                : "no"
        }`
    );

    console.log(
        `🔐 Token length: ${
            WOLF_TOKEN.length
        }`
    );

    console.log(
        `🛡️ App Check token loaded: ${
            WOLF_APP_CHECK_TOKEN
                ? "yes"
                : "no"
        }`
    );

    console.log(
        `🛡️ App Check token length: ${
            WOLF_APP_CHECK_TOKEN.length
        }`
    );

    console.log(
        "========================================"
    );

    // ========================================================
    // مهم جدًا:
    //
    // Chrome Socket URL الذي التقطناه لا يحتوي state.
    //
    // لذلك لا نرسل state هنا.
    // ========================================================

    const query = {
        device,

        isAppCheckEnabled:
            WOLF_IS_APP_CHECK_ENABLED
                ? "true"
                : "false",

        token:
            WOLF_TOKEN,

        appCheckToken:
            WOLF_IS_APP_CHECK_ENABLED
                ? WOLF_APP_CHECK_TOKEN
                : undefined
    };

    // ========================================================
    // إنشاء Socket.IO
    // ========================================================

    socket = io(
        `${host}:${port}`,
        {
            transports: [
                "websocket"
            ],

            path: "/socket.io",

            reconnection: true,

            autoConnect: false,

            query,

            extraHeaders: {
                Origin:
                    "https://app.wolf.live",

                Referer:
                    "https://app.wolf.live/mna",

                "User-Agent":
                    chromeUserAgent
            },

            transportOptions: {
                websocket: {
                    headers: {
                        Origin:
                            "https://app.wolf.live",

                        Referer:
                            "https://app.wolf.live/mna",

                        "User-Agent":
                            chromeUserAgent
                    }
                }
            }
        }
    );

    // ========================================================
    // ربط Socket مع wolf.js
    // ========================================================

    service.websocket.socket =
        socket;

    // ========================================================
    // عرض الإعدادات بدون Secrets
    // ========================================================

    console.log(
        "🔎 Socket configuration:"
    );

    console.log(
        JSON.stringify(
            {
                host,
                port,

                path:
                    "/socket.io",

                device,

                isAppCheckEnabled:
                    WOLF_IS_APP_CHECK_ENABLED
                        ? "true"
                        : "false",

                token:
                    WOLF_TOKEN
                        ? "[REDACTED]"
                        : null,

                appCheckToken:
                    WOLF_APP_CHECK_TOKEN
                        ? "[REDACTED]"
                        : null,

                origin:
                    "https://app.wolf.live",

                referer:
                    "https://app.wolf.live/mna"
            },
            null,
            2
        )
    );

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
                "🔗 [WOLF] Socket.IO connected"
            );

            console.log(
                `🔗 Socket ID: ${socket.id}`
            );

            console.log(
                `📱 Device: ${device}`
            );

            console.log(
                `🌐 Host: ${host}`
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

            console.error("");
            console.error(
                "❌ [WOLF] Socket connect error:"
            );

            console.error(
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
                `🔌 [WOLF] Socket disconnected: ${reason}`
            );
        }
    );

    // ========================================================
    // جميع أحداث WOLF
    // ========================================================

    socket.onAny(
        async (
            eventName,
            data
        ) => {

            try {

                console.log(
                    `📥 [WOLF EVENT] ${eventName}`
                );

                // ------------------------------------------------
                // Welcome / Error فقط
                // ------------------------------------------------

                if (
                    eventName === "welcome" ||
                    eventName === "error" ||
                    eventName === "connect_error"
                ) {

                    try {

                        let safeData =
                            data;

                        if (
                            typeof data ===
                            "object" &&
                            data !== null
                        ) {

                            safeData =
                                JSON.parse(
                                    JSON.stringify(
                                        data
                                    )
                                );

                            if (
                                safeData.token
                            ) {

                                safeData.token =
                                    "[REDACTED]";
                            }

                            if (
                                safeData.appCheckToken
                            ) {

                                safeData.appCheckToken =
                                    "[REDACTED]";
                            }
                        }

                        console.log(
                            "📦 Event data:",
                            JSON.stringify(
                                safeData,
                                null,
                                2
                            )
                        );

                    } catch {

                        console.log(
                            "📦 Event data:",
                            data
                        );
                    }
                }

                // ------------------------------------------------
                // wolf.js handler
                // ------------------------------------------------

                const handler =
                    service
                        .websocket
                        .handlers?.[
                            eventName
                        ];

                if (!handler) {

                    console.log(
                        `⚠️ No wolf.js handler for: ${eventName}`
                    );

                    return;
                }

                await handler.process(
                    data?.body ??
                    data
                );

                // ------------------------------------------------
                // تحقق من Subscriber
                // ------------------------------------------------

                if (
                    service.currentSubscriber?.id
                ) {

                    console.log("");
                    console.log(
                        "========================================"
                    );

                    console.log(
                        "👤 Subscriber detected!"
                    );

                    console.log(
                        `🆔 ID: ${
                            service
                                .currentSubscriber
                                .id
                        }`
                    );

                    console.log(
                        `👤 Username: ${
                            service
                                .currentSubscriber
                                .username ||
                            service
                                .currentSubscriber
                                .nickname ||
                            "Unknown"
                        }`
                    );

                    console.log(
                        "========================================"
                    );
                }

            } catch (error) {

                console.error(
                    `❌ Handler error [${eventName}]:`,
                    error?.message ||
                    error
                );
            }
        }
    );

    // ========================================================
    // Start
    // ========================================================

    console.log(
        "🔌 [WOLF] Connecting..."
    );

    socket.connect();

    // ========================================================
    // Wait authorization
    // ========================================================

    await waitForAuthorization();
}

// ============================================================
// Wait authorization
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
                    service
                        .currentSubscriber
                        .username ||
                    service
                        .currentSubscriber
                        .nickname ||
                    "Unknown"
                }`
            );

            console.log(
                `🆔 Subscriber ID: ${
                    service
                        .currentSubscriber
                        .id
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
            error?.message ||
            error
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

    try {

        if (
            currentSlotId &&
            service
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
        }

    } catch (error) {

        console.error(
            "❌ فشل النزول:",
            error?.message ||
            error
        );
    }

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
        "🔐 WOLF Chrome Session Login"
    );

    console.log(
        "========================================"
    );

    // ========================================================
    // Load credentials from Chrome
    // ========================================================

    await initializeSession();

    // ========================================================
    // Create WOLF service
    // ========================================================

    console.log(
        "⚙️ Creating WOLF service..."
    );

    createWolfService();

    console.log(
        "⚙️ WOLF service created."
    );

    // ========================================================
    // Initialize handlers
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
    // Verify Stage API
    // ========================================================

    await verifyStageAPI();

    console.log(
        "🟢 تم تسجيل الدخول بنجاح."
    );

    console.log(
        "👻 تم ضبط الحالة على Invisible."
    );

    // ========================================================
    // First Stage check
    // ========================================================

    await checkStage();

    // ========================================================
    // Start monitor
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
        `📱 DEVICE: ${WOLF_DEVICE}`
    );

    console.log(
        `🛡️ APP CHECK: ${
            WOLF_IS_APP_CHECK_ENABLED
                ? "enabled"
                : "disabled"
        }`
    );

    console.log(
        "========================================"
    );
}

// ============================================================
// Fatal Error
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
