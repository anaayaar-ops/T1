import fs from "fs";
import sharp from "sharp";
import wolfjs from "wolf.js";
import { io } from "socket.io-client";

import {
    loadSession,
    closeSessionBrowser
} from "./session-loader.js";

import { Command } from "./node_modules/wolf.js/src/constants/index.js";

const { WOLF, OnlineState } = wolfjs;

// ============================================================
// الإعدادات
// ============================================================

const GROUP_ID = 18432094;

const EVENT_NAME = " ᷂فعاليآت ᷂خليجنا،ذوق.";

const TOTAL_EVENTS = 32;
const EVENT_DURATION_MIN = 45;

const IMAGE_PATH = "./178332617173751.jpeg";

// بداية الجدول:
// 16 سبتمبر 2026 - الساعة 12:00 AM
// توقيت السعودية UTC+3
const START_TIME = new Date("2026-09-16T00:00:00+03:00");

const SOCKET_HOST = "https://v3-rc.palringo.com";
const SOCKET_PORT = 443;

const REQUEST_TIMEOUT_MS = 30000;

// ============================================================
// متغيرات عامة
// ============================================================

let service = null;
let socket = null;
let shuttingDown = false;

// ============================================================
// أدوات
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatAMPM(date) {
    return new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Riyadh",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    }).format(date);
}

function formatDate(date) {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Riyadh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(date);
}

function withTimeout(promise, label, timeout = REQUEST_TIMEOUT_MS) {
    let timer;

    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(
                new Error(
                    `${label} تجاوز ${timeout / 1000} ثانية`
                )
            );
        }, timeout);
    });

    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        timeoutPromise
    ]);
}

// ============================================================
// إيقاف آمن
// ============================================================

async function shutdown(code = 0) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    console.log("");
    console.log("========================================");
    console.log("🛑 إيقاف البرنامج...");
    console.log("========================================");

    try {
        if (socket) {
            try {
                socket.removeAllListeners();
                socket.disconnect();
            } catch {}
        }
    } catch {}

    try {
        if (service?.websocket?.socket) {
            try {
                service.websocket.socket.disconnect();
            } catch {}
        }
    } catch {}

    try {
        await closeSessionBrowser();
    } catch {}

    console.log("✅ تم إنهاء البرنامج.");

    process.exit(code);
}

process.on("SIGINT", () => {
    shutdown(0);
});

process.on("SIGTERM", () => {
    shutdown(0);
});

// ============================================================
// تجهيز الصورة
// ============================================================

async function prepareThumbnail() {
    console.log("");
    console.log("========================================");
    console.log("🖼️ تجهيز الصورة");
    console.log("========================================");

    console.log(`📁 الملف: ${IMAGE_PATH}`);

    if (!fs.existsSync(IMAGE_PATH)) {
        throw new Error(`الصورة غير موجودة: ${IMAGE_PATH}`);
    }

    const buffer = await sharp(IMAGE_PATH)
        .jpeg({
            quality: 90
        })
        .toBuffer();

    console.log(`✅ تم تجهيز الصورة (${buffer.length} bytes)`);

    return buffer;
}

// ============================================================
// انتظار الحساب
// ============================================================

async function waitForSubscriber(timeout = 30000) {
    const started = Date.now();

    while (!service?.currentSubscriber?.id) {
        if (Date.now() - started > timeout) {
            throw new Error(
                "لم يظهر currentSubscriber خلال المهلة المحددة"
            );
        }

        await sleep(250);
    }

    return service.currentSubscriber;
}

// ============================================================
// Handlers
// ============================================================

function initializeHandlers() {
    if (!socket) {
        return;
    }

    socket.onAny((eventName, ...args) => {
        // هذا البوت لا يحتاج استقبال تحديثات الفعاليات.
        // تجاهلها حتى لا تسبب:
        // Handler error [group event update]
        if (eventName === "group event update") {
            return;
        }

        // لا نطبع كل أحداث Socket.IO
        // حتى يبقى اللوج نظيف.
    });
}

// ============================================================
// الاتصال باستخدام جلسة Chrome
// ============================================================

async function connectUsingChromeProfile() {
    console.log("");
    console.log("========================================");
    console.log("🐺 الاتصال بـ WOLF");
    console.log("========================================");

    console.log("🌐 قراءة جلسة WOLF من Chrome...");

    const credentials = await loadSession();

    if (!credentials) {
        throw new Error("لم يتم الحصول على بيانات جلسة WOLF");
    }

    if (!credentials.token) {
        throw new Error("لم يتم العثور على WOLF API token");
    }

    console.log("🔐 تم العثور على جلسة Chrome");

    if (credentials.token) {
        console.log(
            `🔐 v3APIToken موجود (${String(credentials.token).length})`
        );
    }

    if (credentials.appCheckToken) {
        console.log(
            `🛡️ appCheckToken موجود (${String(credentials.appCheckToken).length})`
        );
    }

    // --------------------------------------------------------
    // إنشاء WOLF
    // --------------------------------------------------------

    service = new WOLF();

    // لا تستخدم service.login()
    // wolf.js 2.7.10 يحاول email في login()
    // ونحن نعتمد على token المستخرج من Chrome.

    service.config.framework.login.token = credentials.token;

    service.config.framework.login.onlineState =
        OnlineState.INVISIBLE;

    // App Check
    if (credentials.appCheckToken) {
        service.config.framework.login.appCheckToken =
            credentials.appCheckToken;
    }

    // --------------------------------------------------------
    // إعداد websocket الداخلي
    // --------------------------------------------------------

    await service.websocket.init();

    const connectionConfig =
        service._frameworkConfig?.get?.("connection") || {};

    const host =
        connectionConfig.host ||
        SOCKET_HOST;

    const port =
        connectionConfig.port ||
        SOCKET_PORT;

    console.log(`📡 Socket host: ${host}`);
    console.log(`📡 Socket port: ${port}`);

    // --------------------------------------------------------
    // Query
    // --------------------------------------------------------

    const query = {
        token: credentials.token,

        device: credentials.device || "web",

        state: 1,

        version:
            connectionConfig.version ||
            service.config?.version ||
            "3",

        isAppCheckEnabled:
            credentials.isAppCheckEnabled ?? true
    };

    if (credentials.appCheckToken) {
        query.appCheckToken =
            credentials.appCheckToken;
    }

    console.log("📡 إنشاء Socket.IO...");

    socket = io(
        `${host}:${port}`,
        {
            transports: ["websocket"],

            query,

            reconnection: true,

            forceNew: true,

            timeout: 30000
        }
    );

    // --------------------------------------------------------
    // Socket events
    // --------------------------------------------------------

    socket.on("connect", () => {
        console.log("🔌 Socket.IO connected");
        console.log(`🆔 Socket ID: ${socket.id}`);
    });

    socket.on("connect_error", (error) => {
        console.error(
            "❌ Socket.IO connect_error:",
            error?.message || error
        );
    });

    socket.on("disconnect", (reason) => {
        if (!shuttingDown) {
            console.log(
                `⚠️ Socket.IO disconnected: ${reason}`
            );
        }
    });

    // --------------------------------------------------------
    // ربط Socket.IO مع wolf.js
    // --------------------------------------------------------

    service.websocket.socket = socket;

    initializeHandlers();

    // Forward socket events إلى wolf.js
    socket.onAny((eventName, ...args) => {
        try {
            if (
                service?.websocket?.handlers &&
                typeof service.websocket.handlers[eventName] === "function"
            ) {
                service.websocket.handlers[eventName](...args);
            }
        } catch (error) {
            // تجاهل group event update فقط
            if (eventName === "group event update") {
                return;
            }

            console.error(
                `❌ Handler error [${eventName}]:`,
                error?.message || error
            );
        }
    });

    // --------------------------------------------------------
    // انتظار الاتصال
    // --------------------------------------------------------

    await withTimeout(
        new Promise((resolve, reject) => {
            if (socket.connected) {
                resolve();
                return;
            }

            const onConnect = () => {
                cleanup();
                resolve();
            };

            const onError = (error) => {
                cleanup();
                reject(error);
            };

            const cleanup = () => {
                socket.off("connect", onConnect);
                socket.off("connect_error", onError);
            };

            socket.once("connect", onConnect);
            socket.once("connect_error", onError);
        }),
        "الاتصال بـ Socket.IO"
    );

    // --------------------------------------------------------
    // انتظار التفويض
    // --------------------------------------------------------

    console.log("🔐 انتظار اكتمال تفويض WOLF...");

    await waitForSubscriber();

    console.log("✅ Authorization complete");

    console.log(
        `👤 الحساب: ${service.currentSubscriber?.name || "غير معروف"}`
    );

    console.log(
        `🆔 ID: ${service.currentSubscriber?.id || "غير معروف"}`
    );

    console.log("🟢 WOLF جاهز للفعاليات.");

    return service;
}

// ============================================================
// جلب الفعاليات الموجودة مباشرة
// بدون event.group.getList()
// ============================================================

async function getExistingEvents() {
    console.log("");
    console.log("========================================");
    console.log("🔍 جاري جلب فعاليات الروم...");
    console.log("========================================");

    console.log(`🏠 GROUP_ID: ${GROUP_ID}`);

    console.log("📡 إرسال GROUP_EVENT_LIST مباشرة...");

    const response = await withTimeout(
        service.websocket.emit(
            Command.GROUP_EVENT_LIST,
            {
                id: Number(GROUP_ID),

                subscribe: true,

                offset: 0,

                limit:
                    service._frameworkConfig.batching.length
            }
        ),
        "GROUP_EVENT_LIST"
    );

    console.log("📥 تم استلام رد WOLF.");

    if (!response) {
        console.log("⚠️ WOLF لم يرجع response.");
        return [];
    }

    console.log(
        `📦 success: ${response.success}`
    );

    if (!response.success) {
        console.log("⚠️ WOLF أعاد success=false");
        console.log(response);
        return [];
    }

    const rawEvents =
        Array.isArray(response.body)
            ? response.body
            : [];

    console.log(
        `📋 WOLF أعاد ${rawEvents.length} فعالية في الطلب.`
    );

    if (rawEvents.length === 0) {
        console.log("✅ لا توجد فعاليات موجودة.");
        return [];
    }

    const ids = rawEvents
        .map(event => event?.id)
        .filter(id =>
            id !== undefined &&
            id !== null &&
            Number(id) > 0
        )
        .map(Number);

    console.log(
        `🆔 عدد IDs الصحيحة: ${ids.length}`
    );

    if (ids.length === 0) {
        return [];
    }

    // --------------------------------------------------------
    // محاولة الحصول على التفاصيل
    // --------------------------------------------------------

    try {
        console.log("📚 جاري تحميل تفاصيل الفعاليات...");

        const events = await withTimeout(
            service.event.getByIds(ids),
            "تحميل تفاصيل الفعاليات"
        );

        if (Array.isArray(events)) {
            console.log(
                `✅ تم تحميل ${events.length} فعالية.`
            );

            return events;
        }
    } catch (error) {
        console.log(
            "⚠️ تعذر تحميل التفاصيل الكاملة."
        );

        console.log(
            `⚠️ السبب: ${error?.message || error}`
        );

        console.log(
            "↩️ سيتم استخدام بيانات GROUP_EVENT_LIST."
        );
    }

    return rawEvents;
}

// ============================================================
// استخراج بداية الفعالية
// ============================================================

function getEventStart(event) {
    const value =
        event?.startsAt ??
        event?.startAt ??
        event?.start ??
        event?.startTime;

    if (!value) {
        return null;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

// ============================================================
// استخراج نهاية الفعالية
// ============================================================

function getEventEnd(event) {
    const value =
        event?.endsAt ??
        event?.endAt ??
        event?.end ??
        event?.endTime;

    if (!value) {
        return null;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

// ============================================================
// فحص التعارض
// ============================================================

function findConflict(existingEvents, start, end) {
    for (const event of existingEvents) {
        const existingStart = getEventStart(event);
        const existingEnd = getEventEnd(event);

        if (!existingStart || !existingEnd) {
            continue;
        }

        // يوجد تعارض إذا تداخل الوقتان
        if (
            start < existingEnd &&
            end > existingStart
        ) {
            return event;
        }
    }

    return null;
}

// ============================================================
// إنشاء الفعاليات
// ============================================================

async function createEvents(existingEvents) {
    console.log("");
    console.log("========================================");
    console.log("📅 إنشاء جدول الفعاليات");
    console.log("========================================");

    console.log(
        `🕛 البداية: ${formatDate(START_TIME)}`
    );

    console.log(
        `⏱️ مدة كل فعالية: ${EVENT_DURATION_MIN} دقيقة`
    );

    console.log(
        `🔢 العدد المطلوب: ${TOTAL_EVENTS}`
    );

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < TOTAL_EVENTS; i++) {
        const start = new Date(
            START_TIME.getTime() +
            i * EVENT_DURATION_MIN * 60 * 1000
        );

        const end = new Date(
            start.getTime() +
            EVENT_DURATION_MIN * 60 * 1000
        );

        console.log("");
        console.log(
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        );

        console.log(
            `📌 الفعالية ${i + 1}/${TOTAL_EVENTS}`
        );

        console.log(
            `🕐 ${formatAMPM(start)} → ${formatAMPM(end)}`
        );

        console.log(
            `📅 ${formatDate(start)} → ${formatDate(end)}`
        );

        const conflict =
            findConflict(
                existingEvents,
                start,
                end
            );

        if (conflict) {
            skipped++;

            console.log(
                `⏭️ يوجد تعارض، تم التخطي.`
            );

            console.log(
                `🆔 الفعالية الموجودة: ${conflict.id ?? "غير معروف"}`
            );

            continue;
        }

        try {
            console.log("📡 إرسال طلب إنشاء الفعالية...");

            const response = await withTimeout(
                service.event.group.create(
                    GROUP_ID,
                    {
                        title: EVENT_NAME,

                        startsAt: start,

                        endsAt: end
                    }
                ),
                `إنشاء الفعالية ${i + 1}`
            );

            // ------------------------------------------------
            // استخراج event من الرد
            // ------------------------------------------------

            let event = null;

            if (Array.isArray(response)) {
                event = response[0]?.body ??
                    response[0];
            } else {
                event =
                    response?.body ??
                    response;
            }

            const eventId =
                event?.id ??
                response?.body?.id;

            if (
                response?.success === false
            ) {
                throw new Error(
                    response?.message ||
                    "WOLF أعاد success=false"
                );
            }

            if (
                eventId === undefined ||
                eventId === null
            ) {
                console.log(
                    "⚠️ تم إنشاء الطلب لكن لم يظهر Event ID في الرد."
                );

                console.log(
                    "📦 الرد:",
                    response
                );

                failed++;
                continue;
            }

            const numericEventId =
                Number(eventId);

            console.log(
                `✅ تم إنشاء الفعالية`
            );

            console.log(
                `🆔 Event ID: ${numericEventId}`
            );

            console.log(
                `🕐 ${formatAMPM(start)} → ${formatAMPM(end)}`
            );

            created++;

            // نضيفها للقائمة حتى لا يتم إنشاء
            // تعارض معها في نفس التشغيل.
            existingEvents.push({
                id: numericEventId,
                title: EVENT_NAME,
                startsAt: start,
                endsAt: end
            });

        } catch (error) {
            failed++;

            console.error(
                `❌ فشل إنشاء الفعالية ${i + 1}`
            );

            console.error(
                `❌ ${error?.message || error}`
            );
        }

        // تأخير بسيط بين الطلبات
        await sleep(300);
    }

    console.log("");
    console.log("========================================");
    console.log("📊 نتيجة الإنشاء");
    console.log("========================================");

    console.log(`✅ تم الإنشاء: ${created}`);
    console.log(`⏭️ تم التخطي: ${skipped}`);
    console.log(`❌ فشل: ${failed}`);

    return {
        created,
        skipped,
        failed
    };
}

// ============================================================
// رفع الصورة
// ============================================================

async function uploadThumbnails(thumbnailBuffer, events) {
    console.log("");
    console.log("========================================");
    console.log("🖼️ رفع صورة الفعاليات");
    console.log("========================================");

    console.log(
        `📦 حجم الصورة: ${thumbnailBuffer.length} bytes`
    );

    const validEvents = events.filter(event => {
        const id = Number(event?.id);

        return Number.isFinite(id) && id > 0;
    });

    console.log(
        `📋 عدد الفعاليات التي سيتم تحديثها: ${validEvents.length}`
    );

    let success = 0;
    let failed = 0;

    for (let i = 0; i < validEvents.length; i++) {
        const event = validEvents[i];

        const eventId = Number(event.id);

        console.log("");
        console.log(
            `🖼️ [${i + 1}/${validEvents.length}] Event ${eventId}`
        );

        try {
            const response = await withTimeout(
                service.event.group.updateThumbnail(
                    eventId,
                    thumbnailBuffer
                ),
                `رفع صورة Event ${eventId}`
            );

            // مهم:
            // لا نعتمد على socket handler.
            // نعتبر العملية ناجحة إذا لم ترجع استثناء.
            if (
                response?.success === false
            ) {
                throw new Error(
                    response?.message ||
                    "WOLF أعاد success=false"
                );
            }

            success++;

            console.log(
                `✅ تم رفع الصورة للفعالية ${eventId}`
            );

        } catch (error) {
            failed++;

            console.error(
                `❌ فشل رفع الصورة للفعالية ${eventId}`
            );

            console.error(
                `❌ ${error?.message || error}`
            );
        }

        // تأخير بين رفع الصور
        await sleep(500);
    }

    console.log("");
    console.log("========================================");
    console.log("📊 نتيجة رفع الصور");
    console.log("========================================");

    console.log(`✅ نجح: ${success}`);
    console.log(`❌ فشل: ${failed}`);

    return {
        success,
        failed
    };
}

// ============================================================
// البرنامج الرئيسي
// ============================================================

async function main() {
    console.log("");
    console.log("========================================");
    console.log("🐺 WOLF EVENTS BOT");
    console.log("========================================");

    console.log(`🏠 GROUP_ID: ${GROUP_ID}`);

    console.log(
        `📅 البداية: ${formatDate(START_TIME)}`
    );

    console.log(
        `🔢 عدد الفعاليات: ${TOTAL_EVENTS}`
    );

    console.log(
        `⏱️ المدة: ${EVENT_DURATION_MIN} دقيقة`
    );

    console.log(
        `📝 الاسم: ${EVENT_NAME}`
    );

    console.log("========================================");

    try {
        // ----------------------------------------------------
        // 1. الصورة
        // ----------------------------------------------------

        const thumbnailBuffer =
            await prepareThumbnail();

        // ----------------------------------------------------
        // 2. الاتصال
        // ----------------------------------------------------

        await connectUsingChromeProfile();

        // ----------------------------------------------------
        // 3. جلب الموجود مباشرة
        // ----------------------------------------------------

        const existingEvents =
            await getExistingEvents();

        console.log("");
        console.log(
            `📋 الفعاليات الموجودة: ${existingEvents.length}`
        );

        // ----------------------------------------------------
        // 4. إنشاء الفعاليات
        // ----------------------------------------------------

        const result =
            await createEvents(existingEvents);

        // ----------------------------------------------------
        // 5. جمع الفعاليات التي أنشأناها
        // ----------------------------------------------------

        const createdEvents =
            existingEvents.filter(event => {
                const start =
                    getEventStart(event);

                const end =
                    getEventEnd(event);

                if (!start || !end) {
                    return false;
                }

                // نأخذ فقط الفعاليات الموجودة
                // داخل جدولنا المحدد
                return (
                    start >= START_TIME &&
                    end <= new Date(
                        START_TIME.getTime() +
                        TOTAL_EVENTS *
                        EVENT_DURATION_MIN *
                        60 *
                        1000
                    ) &&
                    event.title === EVENT_NAME
                );
            });

        console.log("");
        console.log(
            `📋 فعاليات جدولنا: ${createdEvents.length}`
        );

        // ----------------------------------------------------
        // 6. رفع الصور
        // ----------------------------------------------------

        if (createdEvents.length > 0) {
            await uploadThumbnails(
                thumbnailBuffer,
                createdEvents
            );
        } else {
            console.log(
                "⚠️ لم يتم العثور على فعاليات لرفع الصور لها."
            );
        }

        // ----------------------------------------------------
        // النهاية
        // ----------------------------------------------------

        console.log("");
        console.log("========================================");
        console.log("🎉 اكتملت العملية");
        console.log("========================================");

        console.log(
            `✅ إنشاء: ${result.created}`
        );

        console.log(
            `⏭️ تخطي: ${result.skipped}`
        );

        console.log(
            `❌ فشل: ${result.failed}`
        );

        console.log("");
        console.log("🐺 WOLF جاهز.");
        console.log("========================================");

    } catch (error) {
        console.error("");
        console.error("========================================");
        console.error("❌ حدث خطأ");
        console.error("========================================");

        console.error(
            error?.stack ||
            error?.message ||
            error
        );

        await shutdown(1);
    }
}

// ============================================================
// تشغيل
// ============================================================

main();
