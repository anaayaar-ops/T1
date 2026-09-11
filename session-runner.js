import wolfjs from "wolf.js";
import { io } from "socket.io-client";
import fs from "fs";
import path from "path";

const { WOLF, OnlineState } = wolfjs;

// ============================================================
// الإعدادات
// ============================================================

const GROUP_ID = 66266;

const WATCHED_SUBSCRIBER_IDS = [
    51660277
];

const LEAVE_COMMAND = "!كات نزول";
const JOIN_COMMAND = "!كات صعود";

const RUN_DURATION_MS = 5 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

const MAX_OCCUPANTS_TO_JOIN = 1;

// ============================================================
// الحالة
// ============================================================

let service = null;

let currentSlotId = null;

let checkIntervalHandle = null;

let autoCheckEnabled = true;

let shuttingDown = false;

let monitoringStarted = false;


// ============================================================
// قراءة إصدار wolf.js
// ============================================================

function getWolfVersion() {
    try {
        const packagePath = require.resolve("wolf.js/package.json");

        const packageJson = JSON.parse(
            fs.readFileSync(packagePath, "utf8")
        );

        return packageJson.version;
    } catch (error) {
        console.log(
            "[WOLF] Could not read wolf.js package version:",
            error.message
        );

        return undefined;
    }
}


// ============================================================
// قراءة التوكنات
// ============================================================

function getWolfSession() {
    const v3APIToken = process.env.WOLF_API_TOKEN;
    const appCheckToken = process.env.WOLF_APP_CHECK_TOKEN;

    if (!v3APIToken) {
        throw new Error(
            "WOLF_API_TOKEN is missing."
        );
    }

    if (!appCheckToken) {
        throw new Error(
            "WOLF_APP_CHECK_TOKEN is missing."
        );
    }

    console.log(
        "[WOLF] Using tokens from environment variables."
    );

    return {
        v3APIToken,
        appCheckToken
    };
}


// ============================================================
// تسجيل الدخول
// ============================================================

async function loginWithSession() {
    const session = getWolfSession();

    console.log(
        "[WOLF] Initializing wolf.js handlers..."
    );

    // مهم:
    // لا نضع appCheckToken داخل login.apiKey.
    // هذا هو الأسلوب الذي نجح مع النسخة المحلية لديك.

    service.config.framework.login.token =
        session.v3APIToken;

    await service.websocket.init();

    console.log(
        "[WOLF] Loaded",
        Object.keys(service.websocket.handlers || {}).length,
        "socket handlers."
    );

    // --------------------------------------------------------
    // إعدادات الاتصال التي يوفرها wolf.js
    // --------------------------------------------------------

    const connectionConfig =
        service._frameworkConfig.get("connection");

    if (!connectionConfig) {
        throw new Error(
            "wolf.js connection configuration was not found."
        );
    }

    const {
        host,
        port,
        query
    } = connectionConfig;

    const {
        device,
        version
    } = query;

    const loginConfig =
        service.config.framework.login;

    const onlineState =
        loginConfig.onlineState;

    const wolfVersion =
        version || getWolfVersion();

    console.log(
        "[WOLF] wolf.js version:",
        wolfVersion || "unknown"
    );

    console.log(
        "[WOLF] Creating Socket.IO connection..."
    );

    // --------------------------------------------------------
    // Socket.IO
    // --------------------------------------------------------

    const socket = io(
        `${host}:${port}`,
        {
            transports: ["websocket"],

            reconnection: true,

            autoConnect: false,

            query: {
                token: session.v3APIToken,

                device,

                state: onlineState,

                version: wolfVersion,

                isAppCheckEnabled: "true",

                appCheckToken: session.appCheckToken
            }
        }
    );


    // ========================================================
    // Engine.IO
    // ========================================================

    socket.io.engine?.on(
        "open",
        () => {
            console.log(
                "[DEBUG] Engine.IO open"
            );
        }
    );


    // ========================================================
    // Socket.IO connection
    // ========================================================

    socket.on(
        "connect",
        () => {
            console.log(
                "[DEBUG] Socket.IO connected."
            );

            console.log(
                "[WOLF] Socket.IO connected."
            );
        }
    );


    // ========================================================
    // Socket.IO errors
    // ========================================================

    socket.on(
        "connect_error",
        (error) => {
            console.error(
                "[WOLF] Socket.IO connect_error:",
                error?.message || error
            );
        }
    );


    socket.on(
        "error",
        (error) => {
            console.error(
                "[WOLF] Socket error:",
                error
            );
        }
    );


    // ========================================================
    // Disconnect
    // ========================================================

    socket.on(
        "disconnect",
        (reason) => {
            console.log(
                "[WOLF] Disconnected:",
                reason
            );
        }
    );


    // ========================================================
    // تمرير أحداث Socket إلى wolf.js
    // ========================================================

    socket.onAny(
        (eventString, data) => {

            const handler =
                service.websocket.handlers[eventString];

            const body =
                data?.body ?? data;

            if (!handler) {

                console.log(
                    `[DEBUG] No wolf.js handler for: ${eventString}`
                );

                return;
            }

            try {

                return handler.process(body);

            } catch (error) {

                console.error(
                    `[WOLF] Handler error for ${eventString}:`,
                    error
                );
            }
        }
    );


    // ========================================================
    // ربط Socket مع wolf.js
    // ========================================================

    service.websocket.socket = socket;

    console.log(
        "[WOLF] Connecting..."
    );

    socket.connect();


    // ========================================================
    // انتظار authorization
    // ========================================================

    console.log(
        "[WOLF] Waiting for authorization..."
    );

    const authorizationTimeout = 15000;

    const startedAt = Date.now();

    while (
        !service.currentSubscriber &&
        Date.now() - startedAt < authorizationTimeout
    ) {

        await new Promise(
            resolve => setTimeout(resolve, 250)
        );

        console.log(
            "[DEBUG] socket.connected:",
            socket.connected
        );

        console.log(
            "[DEBUG] currentSubscriber:",
            service.currentSubscriber
                ? "YES"
                : "NO"
        );
    }


    // ========================================================
    // تحقق من تسجيل الدخول
    // ========================================================

    if (!service.currentSubscriber) {

        throw new Error(
            "Socket connected, but WOLF authorization did not complete."
        );
    }

    console.log(
        "[WOLF] Authorization complete."
    );

    console.log(
        "[WOLF] Logged in as:",
        service.currentSubscriber.nickname ||
        service.currentSubscriber.username ||
        service.currentSubscriber.id
    );

    return socket;
}


// ============================================================
// إعداد Events
// ============================================================

function setupEvents() {

    // --------------------------------------------------------
    // Private Message
    // --------------------------------------------------------

    service.on(
        "privateMessage",
        async (message) => {

            try {

                console.log(
                    "[PRIVATE MESSAGE]",
                    message
                );

                const senderId =
                    Number(
                        message.sourceSubscriberId
                    );

                if (
                    !WATCHED_SUBSCRIBER_IDS.includes(
                        senderId
                    )
                ) {
                    return;
                }

                const body =
                    String(
                        message.body || ""
                    ).trim();


                // ============================================
                // أمر النزول
                // ============================================

                if (
                    body === LEAVE_COMMAND
                ) {

                    console.log(
                        `📩 استلام أمر النزول من ${senderId}`
                    );

                    await leaveStage();

                    return;
                }


                // ============================================
                // أمر الصعود
                // ============================================

                if (
                    body === JOIN_COMMAND
                ) {

                    console.log(
                        `📩 استلام أمر الصعود من ${senderId}`
                    );

                    await forceJoinStage();

                    return;
                }

            } catch (error) {

                console.error(
                    "[WOLF] privateMessage error:",
                    error
                );
            }
        }
    );
}


// ============================================================
// فحص الاستيج والصعود
// ============================================================

async function checkStageAndJoin() {

    if (shuttingDown) {
        return;
    }

    if (!service) {
        return;
    }

    if (currentSlotId) {

        console.log(
            `🎙️ البوت موجود حاليًا في Slot ${currentSlotId}`
        );

        return;
    }

    try {

        console.log(
            "🔎 جاري فحص الاستيج..."
        );


        // ----------------------------------------------------
        // Audio Config
        // ----------------------------------------------------

        try {

            await service.stage.getAudioConfig(
                GROUP_ID
            );

        } catch (error) {

            console.log(
                "[STAGE] getAudioConfig warning:",
                error?.message || error
            );
        }


        // ----------------------------------------------------
        // Slots
        // ----------------------------------------------------

        const slots =
            await service.stage.slot.list(
                GROUP_ID
            );


        if (
            !Array.isArray(slots)
        ) {

            throw new Error(
                "Stage slots response is not an array."
            );
        }


        // ----------------------------------------------------
        // الأشخاص الموجودون
        // ----------------------------------------------------

        const occupants =
            slots.filter(
                slot => !!slot.occupierId
            );


        console.log(
            "👥 عدد الموجودين على الاستيج:",
            occupants.length
        );


        // ----------------------------------------------------
        // العدد أكبر من المطلوب
        // ----------------------------------------------------

        if (
            occupants.length >
            MAX_OCCUPANTS_TO_JOIN
        ) {

            console.log(
                `⏳ العدد غير مناسب (${occupants.length}) — سيتم إعادة الفحص لاحقًا.`
            );

            return;
        }


        // ----------------------------------------------------
        // البحث عن Slot فارغ
        // ----------------------------------------------------

        const freeSlot =
            slots.find(
                slot => !slot.occupierId
            );


        if (!freeSlot) {

            console.log(
                "⚠️ لا يوجد Slot فارغ حاليًا."
            );

            return;
        }


        // ----------------------------------------------------
        // الصعود
        // ----------------------------------------------------

        console.log(
            `🎙️ جاري الصعود للسلوت ${freeSlot.id}...`
        );


        const response =
            await service.stage.slot.join(
                GROUP_ID,
                freeSlot.id
            );


        console.log(
            "✅ تم الصعود تلقائيًا للاستيج بنجاح."
        );

        console.log(
            "🎙️ Slot ID:",
            freeSlot.id
        );


        currentSlotId =
            freeSlot.id;


        // ----------------------------------------------------
        // إيقاف الفحص الدوري
        // ----------------------------------------------------

        autoCheckEnabled = false;

        if (checkIntervalHandle) {

            clearInterval(
                checkIntervalHandle
            );

            checkIntervalHandle = null;
        }


        console.log(
            "🛑 تم إيقاف الفحص التلقائي نهائيًا: تم الصعود تلقائيًا بنجاح"
        );

        return response;

    } catch (error) {

        console.error(
            "❌ خطأ أثناء فحص الاستيج:",
            error
        );
    }
}


// ============================================================
// صعود إجباري
// ============================================================

async function forceJoinStage() {

    if (shuttingDown) {
        return;
    }

    if (currentSlotId) {

        console.log(
            `ℹ️ البوت موجود بالفعل على Slot ${currentSlotId}`
        );

        return;
    }

    try {

        console.log(
            "🎙️ محاولة الصعود الإجباري للاستيج..."
        );


        // ----------------------------------------------------
        // Audio Config
        // ----------------------------------------------------

        try {

            await service.stage.getAudioConfig(
                GROUP_ID
            );

        } catch (error) {

            console.log(
                "[STAGE] getAudioConfig warning:",
                error?.message || error
            );
        }


        // ----------------------------------------------------
        // Slots
        // ----------------------------------------------------

        const slots =
            await service.stage.slot.list(
                GROUP_ID
            );


        if (
            !Array.isArray(slots)
        ) {

            throw new Error(
                "Stage slots response is not an array."
            );
        }


        const freeSlot =
            slots.find(
                slot => !slot.occupierId
            );


        if (!freeSlot) {

            console.log(
                "❌ لا يوجد Slot فارغ للصعود."
            );

            return;
        }


        console.log(
            `🎙️ جاري الصعود للسلوت ${freeSlot.id}...`
        );


        await service.stage.slot.join(
            GROUP_ID,
            freeSlot.id
        );


        currentSlotId =
            freeSlot.id;


        console.log(
            "✅ تم الصعود بنجاح."
        );

        console.log(
            "🎙️ Slot ID:",
            currentSlotId
        );


        // ----------------------------------------------------
        // إيقاف الفحص
        // ----------------------------------------------------

        autoCheckEnabled = false;

        if (checkIntervalHandle) {

            clearInterval(
                checkIntervalHandle
            );

            checkIntervalHandle = null;
        }


    } catch (error) {

        console.error(
            "❌ فشل الصعود الإجباري:",
            error
        );
    }
}


// ============================================================
// النزول من الاستيج
// ============================================================

async function leaveStage() {

    if (!service) {
        return;
    }

    if (!currentSlotId) {

        console.log(
            "ℹ️ البوت ليس على الاستيج حاليًا."
        );

        return;
    }

    const slotId =
        currentSlotId;


    try {

        console.log(
            `🛑 جاري النزول من الاستيج، Slot ${slotId}...`
        );


        await service.stage.slot.leave(
            GROUP_ID,
            slotId
        );


        console.log(
            "✅ تم النزول من الاستيج."
        );


        currentSlotId =
            null;


    } catch (error) {

        console.error(
            "❌ خطأ أثناء النزول من الاستيج:",
            error
        );
    }
}


// ============================================================
// بدء المراقبة
// ============================================================

async function startMonitoringAfterLogin() {

    if (monitoringStarted) {
        return;
    }

    monitoringStarted = true;


    // --------------------------------------------------------
    // Invisible / Away
    // --------------------------------------------------------

    try {

        await service.setOnlineState(
            OnlineState.INVISIBLE
        );

        console.log(
            "✅ تم ضبط الحالة بنجاح إلى: بعيد (Away)"
        );

    } catch (error) {

        console.error(
            "⚠️ تعذر ضبط الحالة:",
            error
        );
    }


    // --------------------------------------------------------
    // أول فحص مباشرة
    // --------------------------------------------------------

    await checkStageAndJoin();


    // --------------------------------------------------------
    // الفحص الدوري
    // --------------------------------------------------------

    if (
        autoCheckEnabled &&
        !currentSlotId
    ) {

        console.log(
            `🔄 سيتم فحص الاستيج كل ${CHECK_INTERVAL_MS / 60000} دقائق.`
        );


        checkIntervalHandle =
            setInterval(
                async () => {

                    if (
                        shuttingDown ||
                        !autoCheckEnabled
                    ) {
                        return;
                    }

                    await checkStageAndJoin();

                },
                CHECK_INTERVAL_MS
            );

    } else {

        console.log(
            "🛑 الفحص التلقائي متوقف — لا يوجد فحص دوري."
        );
    }


    // --------------------------------------------------------
    // مؤقت إيقاف البوت
    // --------------------------------------------------------

    setTimeout(
        async () => {

            console.log(
                "⏰ انتهت مدة تشغيل البوت المحددة."
            );

            await shutdown(
                "RUN_DURATION_EXPIRED"
            );

        },
        RUN_DURATION_MS
    );
}


// ============================================================
// Shutdown
// ============================================================

async function shutdown(reason) {

    if (shuttingDown) {
        return;
    }

    shuttingDown = true;


    console.log(
        `🛑 جاري إيقاف البوت بسبب: ${reason}`
    );


    // --------------------------------------------------------
    // إيقاف interval
    // --------------------------------------------------------

    if (checkIntervalHandle) {

        clearInterval(
            checkIntervalHandle
        );

        checkIntervalHandle = null;
    }


    // --------------------------------------------------------
    // النزول من الاستيج
    // --------------------------------------------------------

    try {

        await leaveStage();

    } catch (error) {

        console.error(
            "[SHUTDOWN] leaveStage error:",
            error
        );
    }


    // --------------------------------------------------------
    // Socket disconnect
    // --------------------------------------------------------

    try {

        if (
            service?.websocket?.socket
        ) {

            service.websocket.socket.disconnect();
        }

    } catch (error) {

        console.error(
            "[SHUTDOWN] socket disconnect error:",
            error
        );
    }


    // --------------------------------------------------------
    // إنهاء العملية
    // --------------------------------------------------------

    setTimeout(
        () => {
            process.exit(0);
        },
        1000
    );
}


// ============================================================
// إشارات النظام
// ============================================================

process.on(
    "SIGINT",
    async () => {
        await shutdown("SIGINT");
    }
);

process.on(
    "SIGTERM",
    async () => {
        await shutdown("SIGTERM");
    }
);


// ============================================================
// أخطاء غير معالجة
// ============================================================

process.on(
    "unhandledRejection",
    (error) => {

        console.error(
            "❌ Unhandled Promise Rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    (error) => {

        console.error(
            "❌ Uncaught Exception:",
            error
        );
    }
);


// ============================================================
// Main
// ============================================================

async function main() {

    console.log(
        "============================================================"
    );

    console.log(
        "🐺 WOLF Bot starting..."
    );

    console.log(
        "============================================================"
    );


    // --------------------------------------------------------
    // تحقق من Secrets
    // --------------------------------------------------------

    if (!process.env.WOLF_API_TOKEN) {

        throw new Error(
            "WOLF_API_TOKEN GitHub Secret is missing."
        );
    }

    if (!process.env.WOLF_APP_CHECK_TOKEN) {

        throw new Error(
            "WOLF_APP_CHECK_TOKEN GitHub Secret is missing."
        );
    }


    // --------------------------------------------------------
    // إنشاء WOLF
    // --------------------------------------------------------

    service =
        new WOLF();


    // --------------------------------------------------------
    // Events
    // --------------------------------------------------------

    setupEvents();


    // --------------------------------------------------------
    // Login
    // --------------------------------------------------------

    await loginWithSession();


    console.log(
        "✅ تم تسجيل الدخول:",
        service.currentSubscriber?.nickname ||
        service.currentSubscriber?.username ||
        service.currentSubscriber?.id
    );


    // --------------------------------------------------------
    // Monitoring
    // --------------------------------------------------------

    await startMonitoringAfterLogin();
}


// ============================================================
// تشغيل
// ============================================================

main().catch(
    async (error) => {

        console.error(
            "============================================================"
        );

        console.error(
            "❌ WOLF BOT FAILED"
        );

        console.error(
            error
        );

        console.error(
            "============================================================"
        );

        await shutdown(
            "STARTUP_ERROR"
        );
    }
);
```
