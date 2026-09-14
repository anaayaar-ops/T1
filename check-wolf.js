import fs from "fs";
import sharp from "sharp";
import wolfjs from "wolf.js";
import { io } from "socket.io-client";
import { loadSession, closeSessionBrowser } from "./session-loader.js";

const { WOLF, OnlineState } = wolfjs;

// ============================================================
// إعدادات WOLF
// ============================================================

const GROUP_ID = 18432094;

const DEFAULT_DEVICE = "web";

const DEFAULT_APP_CHECK_ENABLED = true;

// ============================================================
// إعدادات الفعاليات
// ============================================================

const EVENT_NAME = " ᷂فعاليآت ᷂خليجنا،ذوق.";

const TOTAL_EVENTS = 32;

const EVENT_DURATION_MINUTES = 45;

const FIRST_EVENT_TIME = new Date(
    2026, 8, 14, 21, 0,0 );

// ============================================================
// صورة الفعاليات
// ============================================================

const IMAGE_PATH = "./178332617173751.jpeg";

// ============================================================
// Variables
// ============================================================

let WOLF_TOKEN = null;

let WOLF_APP_CHECK_TOKEN = null;

let service = null;

let socket = null;

let shuttingDown = false;


// ============================================================
// Sleep
// ============================================================

function sleep(ms) {

    return new Promise(
        resolve => setTimeout(resolve, ms)
    );

}


// ============================================================
// Mask Token
// ============================================================

function maskToken(value) {

    if (!value) {
        return "غير موجود";
    }

    const text = String(value);

    if (text.length <= 16) {

        return `${text.slice(0, 4)}...${text.slice(-4)}`;

    }

    return `${text.slice(0, 8)}...${text.slice(-8)}`;

}


// ============================================================
// Format Time
// ============================================================

function formatAMPM(date) {

    let hours = date.getHours();

    let minutes = date.getMinutes();

    const ampm =
        hours >= 12
            ? "pm"
            : "am";

    hours =
        hours % 12 || 12;

    minutes =
        minutes < 10
            ? "0" + minutes
            : minutes;

    return `${hours}:${minutes}${ampm}`;

}


// ============================================================
// Format Date
// ============================================================

function formatDate(date) {

    const year =
        date.getFullYear();

    const month =
        String(
            date.getMonth() + 1
        ).padStart(2, "0");

    const day =
        String(
            date.getDate()
        ).padStart(2, "0");

    return `${year}-${month}-${day}`;


}


// ============================================================
// Load Chrome Session
// ============================================================

async function loadWolfCredentials() {

    console.log("");

    console.log(
        "========================================"
    );

    console.log(
        "🔐 تحميل WOLF Chrome Profile"
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
        `🔐 Token length: ${WOLF_TOKEN.length}`
    );


    console.log(
        `🛡️ appCheckToken: ${maskToken(WOLF_APP_CHECK_TOKEN)}`
    );


    console.log(
        `🛡️ AppCheck length: ${WOLF_APP_CHECK_TOKEN.length}`
    );


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
// Initialize Handlers
// ============================================================

async function initializeWolfHandlers() {

    console.log("");

    console.log(
        "⚙️ [WOLF] Initializing handlers..."
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
// Connect Socket.IO
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
        `🌐 Host: ${host}`
    );


    console.log(
        `🔌 Port: ${port}`
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

                    device:
                        "web",

                    state:
                        service.config.framework.login
                            .onlineState,

                    version:
                        connection?.version ||
                        undefined,

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
        "❌ Timeout waiting for WOLF authorization"
    );

}


// ============================================================
// Verify WOLF
// ============================================================

async function verifyWolf() {

    console.log("");

    console.log(
        "========================================"
    );

    console.log(
        "🧪 فحص اتصال WOLF"
    );

    console.log(
        "========================================"
    );


    if (
        !service.currentSubscriber?.id
    ) {

        throw new Error(
            "❌ الحساب غير مصرح"
        );

    }


    console.log(
        "✅ الحساب مصرح بنجاح"
    );


    console.log(
        `👤 ${
            service.currentSubscriber.nickname ||
            service.currentSubscriber.username ||
            "Unknown"
        }`
    );


    console.log(
        `🆔 ${
            service.currentSubscriber.id
        }`
    );


    console.log(
        "========================================"
    );

}


// ============================================================
// Get Existing Events
// ============================================================

async function getExistingEvents() {

    console.log("");

    console.log(
        "🔍 فحص التعارض في الروم..."
    );


    const response =
        await service.websocket.emit(
            "group event list",
            {
                groupId:
                    GROUP_ID,

                languageId:
                    1
            }
        );


    if (
        !response?.success
    ) {

        throw new Error(
            `❌ فشل الحصول على قائمة الفعاليات: ${
                JSON.stringify(response)
            }`
        );

    }


    const events =
        Array.isArray(
            response.body
        )
            ? response.body
            : [];


    console.log(
        `📋 عدد الفعاليات الموجودة: ${events.length}`
    );


    return events;

}


// ============================================================
// Check Event Conflict
// ============================================================

function isEventConflicting(
    existingEvents,
    startTime,
    endTime
) {

    return existingEvents.some(
        event => {

            const eventStart =
                new Date(
                    event.startsAt
                ).getTime();


            const eventEnd =
                new Date(
                    event.endsAt
                ).getTime();


            if (
                Number.isNaN(eventStart) ||
                Number.isNaN(eventEnd)
            ) {

                return false;

            }


            return (
                startTime.getTime() <
                eventEnd
            ) &&
            (
                endTime.getTime() >
                eventStart
            );

        }
    );

}


// ============================================================
// Create Events
// ============================================================

async function createEvents() {

    console.log("");

    console.log(
        "========================================"
    );

    console.log(
        "📅 بدء إنشاء الفعاليات"
    );

    console.log(
        "========================================"
    );


    console.log(
        `🏠 GROUP_ID: ${GROUP_ID}`
    );


    console.log(
        `🎯 عدد الفعاليات: ${TOTAL_EVENTS}`
    );


    console.log(
        `⏱️ مدة كل فعالية: ${EVENT_DURATION_MINUTES} دقيقة`
    );


    console.log(
        `📝 الاسم: ${EVENT_NAME}`
    );


    console.log(
        `📅 البداية: ${formatDate(FIRST_EVENT_TIME)} ${formatAMPM(FIRST_EVENT_TIME)}`
    );


    const existingEvents =
        await getExistingEvents();


    let startTime =
        new Date(
            FIRST_EVENT_TIME.getTime()
        );


    const createdEventIds = [];


    for (
        let i = 0;
        i < TOTAL_EVENTS;
        i++
    ) {

        const endTime =
            new Date(
                startTime.getTime() +
                EVENT_DURATION_MINUTES *
                60000
            );


        const eventNumber =
            i + 1;


        console.log("");

        console.log(
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        );


        console.log(
            `📌 فعالية ${eventNumber}/${TOTAL_EVENTS}`
        );


        console.log(
            `🕐 ${formatDate(startTime)} ${formatAMPM(startTime)} → ${formatAMPM(endTime)}`
        );


        // ====================================================
        // Conflict
        // ====================================================

        const isConflicting =
            isEventConflicting(
                existingEvents,
                startTime,
                endTime
            );


        if (isConflicting) {

            console.log(
                `⚠️ تجاوز [${EVENT_NAME}]`
            );


            console.log(
                `⚠️ الوقت ${formatAMPM(startTime)} محجوز`
            );


        } else {

            // ==================================================
            // Create
            // ==================================================

            try {

                const response =
                    await service.websocket.emit(
                        "group event create",
                        {

                            groupId:
                                GROUP_ID,

                            title:
                                EVENT_NAME,

                            startsAt:
                                startTime.toISOString(),

                            endsAt:
                                endTime.toISOString(),

                            category:
                                1,

                            languageId:
                                1

                        }
                    );


                if (
                    response?.success
                ) {

                    const eventId =
                        response.body?.id;


                    if (eventId) {

                        createdEventIds.push(
                            String(eventId)
                        );

                    }


                    console.log(
                        `🚀 تم الرفع: ${EVENT_NAME}`
                    );


                    console.log(
                        `🕐 الوقت: ${formatAMPM(startTime)}`
                    );


                    console.log(
                        `🆔 ID: ${eventId}`
                    );


                    // ------------------------------------------
                    // مهم:
                    // نضيف الفعالية الجديدة إلى القائمة
                    // حتى لا يحدث تعارض داخل نفس التشغيل
                    // ------------------------------------------

                    existingEvents.push({

                        startsAt:
                            startTime.toISOString(),

                        endsAt:
                            endTime.toISOString()

                    });


                } else {

                    console.log(
                        "⚠️ فشل إنشاء الفعالية:"
                    );


                    console.log(
                        JSON.stringify(
                            response
                        )
                    );

                }


            } catch (error) {

                console.error(
                    `❌ خطأ بإنشاء فعالية ${eventNumber}:`,
                    error?.message || error
                );

            }

        }


        // ====================================================
        // Next Event
        // ====================================================

        startTime =
            new Date(
                endTime.getTime()
            );


        // ====================================================
        // انتظار بسيط
        // ====================================================

        await sleep(500);

    }


    console.log("");

    console.log(
        "========================================"
    );

    console.log(
        "🏁 انتهى إنشاء الفعاليات"
    );

    console.log(
        `✅ تم إنشاء: ${createdEventIds.length}`
    );

    console.log(
        `⚠️ تم تجاوز/فشل: ${
            TOTAL_EVENTS -
            createdEventIds.length
        }`
    );

    console.log(
        "========================================"
    );


    return createdEventIds;

}


// ============================================================
// Upload Event Images
// ============================================================

async function uploadEventImages(
    createdEventIds
) {

    console.log("");

    console.log(
        "========================================"
    );

    console.log(
        "🖼️ رفع الصور للفعاليات"
    );

    console.log(
        "========================================"
    );


    if (
        !createdEventIds.length
    ) {

        console.log(
            "ℹ️ لا توجد فعاليات جديدة لرفع الصور."
        );

        return;

    }


    if (
        !fs.existsSync(
            IMAGE_PATH
        )
    ) {

        console.error(
            `❌ الصورة غير موجودة بالمسار: ${IMAGE_PATH}`
        );

        console.error(
            "⚠️ سيتم تخطي رفع الصور."
        );

        return;

    }


    console.log(
        `📁 الصورة: ${IMAGE_PATH}`
    );


    // ========================================================
    // Sharp
    // ========================================================

    console.log(
        "🔄 تجهيز الصورة..."
    );


    const thumbnailBuffer =
        await sharp(
            IMAGE_PATH
        )
        .jpeg({
            quality: 90
        })
        .toBuffer();


    console.log(
        `📦 حجم الصورة: ${thumbnailBuffer.length} bytes`
    );


    // ========================================================
    // Upload
    // ========================================================

    for (
        let i = 0;
        i < createdEventIds.length;
        i++
    ) {

        const id =
            createdEventIds[i];


        try {

            console.log(
                `🖼️ رفع صورة ${i + 1}/${createdEventIds.length} — ID ${id}`
            );


            const imageResponse =
                await service.event.group.updateThumbnail(
                    parseInt(id),
                    thumbnailBuffer
                );


            if (
                imageResponse?.success
            ) {

                console.log(
                    `✅ تم رفع صورة: ID ${id}`
                );

            } else {

                console.log(
                    `⚠️ فشلت صورة ID ${id}`
                );


                console.log(
                    JSON.stringify(
                        imageResponse
                    )
                );

            }


        } catch (error) {

            console.error(
                `❌ خطأ برفع صورة ID ${id}:`,
                error?.message || error
            );

        }


        await sleep(800);

    }


    console.log("");

    console.log(
        "✅ انتهى رفع الصور"
    );

}


// ============================================================
// Run Event Task
// ============================================================

async function runEventTask() {

    console.log("");

    console.log(
        "========================================"
    );

    console.log(
        "🎯 بدء مهمة إنشاء فعاليات خليجنا ذوق"
    );

    console.log(
        "========================================"
    );


    const createdEventIds =
        await createEvents();


    await uploadEventImages(
        createdEventIds
    );


    console.log("");

    console.log(
        "========================================"
    );

    console.log(
        "🎉 انتهت مهمة الفعاليات بالكامل"
    );

    console.log(
        "========================================"
    );

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


    try {

        socket?.disconnect();

    } catch {}


    try {

        await closeSessionBrowser();

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
// MAIN
// ============================================================

async function main() {

    console.log("");

    console.log(
        "🐺 WOLF Event Bot started"
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
    // 1. Chrome Profile
    // ========================================================

    await loadWolfCredentials();


    // ========================================================
    // 2. WOLF Service
    // ========================================================

    createWolfService();


    // ========================================================
    // 3. Handlers
    // ========================================================

    await initializeWolfHandlers();


    // ========================================================
    // 4. Socket
    // ========================================================

    await connectWolfSocket();


    // ========================================================
    // 5. Verify
    // ========================================================

    await verifyWolf();


    // ========================================================
    // 6. Run Event Task
    // ========================================================

    await runEventTask();


    // ========================================================
    // Keep connection alive
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
        "📱 DEVICE: web"
    );

    console.log(
        "🛡️ APP CHECK: true"
    );

    console.log(
        "🎯 Event task: completed"
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
            "========================================"
        );


        console.error(
            error?.stack ||
            error?.message ||
            error
        );


        try {

            socket?.disconnect();

        } catch {}


        try {

            await closeSessionBrowser();

        } catch {}


        process.exit(1);

    }
);
