import fs from 'fs';
import sharp from 'sharp';
import wolfjs from 'wolf.js';
import { io } from 'socket.io-client';

import {
    loadSession,
    closeSessionBrowser
} from './session-loader.js';

const { WOLF, OnlineState } = wolfjs;

// ============================================================
// إعدادات عامة
// ============================================================

const GROUP_ID = 18432094;

// اسم الفعالية الموحد
const EVENT_NAME = " ᷂فعاليآت ᷂خليجنا،ذوق.";

const TOTAL_EVENTS = 32;

const EVENT_DURATION_MIN = 45;

const IMAGE_PATH = './178332617173751.jpeg';


const START_TIME =
    new Date('2026-09-16T21:00:00+03:00');

// ============================================================
// متغيرات WOLF
// ============================================================

let WOLF_TOKEN = null;

let WOLF_APP_CHECK_TOKEN = null;

let WOLF_DEVICE = 'web';

let WOLF_IS_APP_CHECK_ENABLED = false;

// ============================================================
// متغيرات التشغيل
// ============================================================

let service = null;

let socket = null;

let shuttingDown = false;

// ============================================================
// أدوات مساعدة
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// إخفاء التوكن في Console
// ============================================================

function maskToken(value) {
    if (!value) {
        return 'غير موجود';
    }

    const text = String(value);

    if (text.length <= 16) {
        return `${text.slice(0, 4)}...${text.slice(-4)}`;
    }

    return `${text.slice(0, 8)}...${text.slice(-8)}`;
}

// ============================================================
// عرض الوقت
// ============================================================

function formatAMPM(date) {
    let hours = date.getHours();

    let minutes = date.getMinutes();

    const ampm =
        hours >= 12
            ? 'pm'
            : 'am';

    hours =
        hours % 12 || 12;

    minutes =
        minutes < 10
            ? '0' + minutes
            : minutes;

    return `${hours}:${minutes}${ampm}`;
}

// ============================================================
// عرض التاريخ السعودي
// ============================================================

function formatSaudiDate(date) {
    return new Intl.DateTimeFormat(
        'en-GB',
        {
            timeZone: 'Asia/Riyadh',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }
    ).format(date);
}

// ============================================================
// تحميل WOLF Credentials من Chrome Profile
// ============================================================

async function loadWolfCredentials() {
    console.log('');

    console.log('========================================');

    console.log('🔐 Loading WOLF Chrome Profile');

    console.log('========================================');

    const session =
        await loadSession();

    if (!session) {
        throw new Error(
            '❌ تعذر تحميل WOLF Chrome Profile'
        );
    }

    WOLF_TOKEN =
        session.token;

    WOLF_APP_CHECK_TOKEN =
        session.appCheckToken || null;

    WOLF_DEVICE =
        session.device || 'web';

    WOLF_IS_APP_CHECK_ENABLED =
        Boolean(
            session.appCheckToken
        );

    // --------------------------------------------------------
    // التحقق من Token الأساسي
    // --------------------------------------------------------

    if (!WOLF_TOKEN) {
        throw new Error(
            '❌ لم يتم العثور على WOLF_TOKEN'
        );
    }

    console.log('');

    console.log('========================================');

    console.log('🔐 Credentials Loaded');

    console.log('========================================');

    console.log(
        `🔐 v3APIToken: ${maskToken(WOLF_TOKEN)}`
    );

    console.log(
        `🔐 Token length: ${WOLF_TOKEN.length}`
    );

    console.log(
        `📱 Device: ${WOLF_DEVICE}`
    );

    console.log(
        `🛡️ App Check: ${
            WOLF_IS_APP_CHECK_ENABLED
                ? 'enabled'
                : 'disabled'
        }`
    );

    if (WOLF_APP_CHECK_TOKEN) {
        console.log(
            `🛡️ AppCheck Token: ${maskToken(WOLF_APP_CHECK_TOKEN)}`
        );
    } else {
        console.log(
            '⚠️ AppCheck Token: غير موجود'
        );
    }

    console.log(
        '========================================'
    );
}

// ============================================================
// إنشاء الخدمة Service
// ============================================================

function createService() {
    console.log('');

    console.log(
        '⚙️ Creating WOLF service...'
    );

    service = new WOLF();

    // --------------------------------------------------------
    // Token
    // --------------------------------------------------------

    service.config.framework.login.token =
        WOLF_TOKEN;

    // --------------------------------------------------------
    // Invisible
    // --------------------------------------------------------

    service.config.framework.login.onlineState =
        OnlineState.INVISIBLE;

    // --------------------------------------------------------
    // App Check اختياري
    // --------------------------------------------------------

    if (WOLF_APP_CHECK_TOKEN) {
        service.config.framework.login.appCheckToken =
            WOLF_APP_CHECK_TOKEN;
    }

    return service;
}

// ============================================================
// تهيئة Handlers
// ============================================================

async function initializeHandlers() {
    console.log('');

    console.log(
        '⚙️ Initializing service handlers...'
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
// الاتصال بالـ Socket.IO
// ============================================================

async function connectService() {
    const connection =
        service._frameworkConfig?.get?.(
            'connection'
        );

    const host =
        connection?.host ||
        'https://v3-rc.palringo.com';

    const port =
        connection?.port ??
        443;

    const device =
        connection?.query?.device ||
        WOLF_DEVICE ||
        'web';

    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        '🔌 Starting service connection...'
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
                ? 'enabled'
                : 'disabled'
        }`
    );

    console.log(
        '========================================'
    );

    // --------------------------------------------------------
    // Socket
    // --------------------------------------------------------

    socket = io(
        `${host}:${port}`,
        {
            transports: [
                'websocket'
            ],

            reconnection: true,

            autoConnect: false,

            query: {
                token: WOLF_TOKEN,

                device,

                state:
                    service.config
                        .framework
                        .login
                        .onlineState,

                version:
                    connection?.version ||
                    undefined,

                isAppCheckEnabled:
                    WOLF_IS_APP_CHECK_ENABLED
                        ? 'true'
                        : 'false',

                ...(WOLF_IS_APP_CHECK_ENABLED &&
                WOLF_APP_CHECK_TOKEN
                    ? {
                        appCheckToken:
                            WOLF_APP_CHECK_TOKEN
                    }
                    : {})
            }
        }
    );

    // --------------------------------------------------------
    // ربط Socket مع wolf.js
    // --------------------------------------------------------

    service.websocket.socket =
        socket;

    // --------------------------------------------------------
    // Connected
    // --------------------------------------------------------

    socket.on(
        'connect',
        () => {
            console.log('');

            console.log(
                '========================================'
            );

            console.log(
                '🔗 Service connection established'
            );

            console.log(
                `🔗 Connection ID: ${socket.id}`
            );

            console.log(
                '========================================'
            );
        }
    );

    // --------------------------------------------------------
    // Connection Error
    // --------------------------------------------------------

    socket.on(
        'connect_error',
        error => {
            console.error(
                '❌ Connection error:',
                error?.message ||
                error
            );
        }
    );

    // --------------------------------------------------------
    // Disconnect
    // --------------------------------------------------------

    socket.on(
        'disconnect',
        reason => {
            console.log(
                `🔌 Connection closed: ${reason}`
            );
        }
    );

    // --------------------------------------------------------
    // استقبال أحداث WOLF
    // --------------------------------------------------------

    socket.onAny(
        async (
            eventName,
            data
        ) => {
            try {
                const handler =
                    service.websocket
                        .handlers?.[
                            eventName
                        ];

                if (!handler) {
                    return;
                }

                await handler.process(
                    data?.body ??
                    data
                );

            } catch (error) {
                console.error(
                    `❌ Handler error [${eventName}]:`,
                    error?.message ||
                    error
                );
            }
        }
    );

    // --------------------------------------------------------
    // Connect
    // --------------------------------------------------------

    console.log(
        '🔌 Connecting...'
    );

    socket.connect();

    // --------------------------------------------------------
    // انتظار Authorization
    // --------------------------------------------------------

    await waitForAuthorization();
}

// ============================================================
// انتظار التوثيق
// ============================================================

async function waitForAuthorization(
    timeout = 60000
) {
    const start =
        Date.now();

    console.log('');

    console.log(
        '⏳ Waiting for authorization...'
    );

    while (
        Date.now() - start <
        timeout
    ) {
        if (
            service.currentSubscriber?.id
        ) {
            console.log('');

            console.log(
                '========================================'
            );

            console.log(
                '✅ Authorization complete'
            );

            console.log(
                `👤 Account: ${
                    service.currentSubscriber.username ||
                    service.currentSubscriber.nickname ||
                    'Unknown'
                }`
            );

            console.log(
                `🆔 Account ID: ${
                    service.currentSubscriber.id
                }`
            );

            console.log(
                '========================================'
            );

            return;
        }

        await sleep(500);
    }

    throw new Error(
        '❌ Authorization timeout'
    );
}

// ============================================================
// التحقق من الحساب
// ============================================================

async function verifyAccount() {
    if (
        !service.currentSubscriber?.id
    ) {
        throw new Error(
            '❌ الحساب لم يتم توثيقه'
        );
    }

    console.log('');

    console.log(
        '🟢 Authorization successful.'
    );

    console.log(
        `👤 ${
            service.currentSubscriber.username ||
            service.currentSubscriber.nickname ||
            'Unknown'
        }`
    );

    console.log(
        `🆔 ${
            service.currentSubscriber.id
        }`
    );

    console.log(
        '👻 Presence set to Invisible.'
    );
}

// ============================================================
// الحصول على الفعاليات الموجودة
// ============================================================

async function getExistingEvents() {
    console.log('');

    console.log(
        '🔍 فحص التعارض في الروم...'
    );

    const response =
        await service.websocket.emit(
            'group event list',
            {
                groupId: GROUP_ID,
                languageId: 1
            }
        );

    if (!response?.success) {
        throw new Error(
            `❌ فشل الحصول على قائمة الفعاليات: ${
                JSON.stringify(response)
            }`
        );
    }

    const events =
        Array.isArray(response.body)
            ? response.body
            : [];

    console.log(
        `📋 عدد الفعاليات الموجودة: ${events.length}`
    );

    return events;
}

// ============================================================
// فحص التعارض
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
                Number.isNaN(
                    eventStart
                ) ||
                Number.isNaN(
                    eventEnd
                )
            ) {
                return false;
            }

            return (
                startTime.getTime() <
                eventEnd &&
                endTime.getTime() >
                eventStart
            );
        }
    );
}

// ============================================================
// إنشاء الفعاليات ورفع الصور
// ============================================================

async function createEventsAndUploadThumbnails() {
    let startTime =
        new Date(
            START_TIME.getTime()
        );

    const createdEventIds = [];

    const existingEvents =
        await getExistingEvents();

    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        '🎯 بدء إنشاء الفعاليات'
    );

    console.log(
        `📌 Group ID: ${GROUP_ID}`
    );

    console.log(
        `📌 عدد الفعاليات: ${TOTAL_EVENTS}`
    );

    console.log(
        `⏱️ مدة كل فعالية: ${EVENT_DURATION_MIN} دقيقة`
    );

    console.log(
        `🕘 البداية: ${formatSaudiDate(START_TIME)}`
    );

    console.log(
        '========================================'
    );

    // ========================================================
    // إنشاء 32 فعالية
    // ========================================================

    for (
        let i = 0;
        i < TOTAL_EVENTS;
        i++
    ) {
        const endTime =
            new Date(
                startTime.getTime() +
                EVENT_DURATION_MIN *
                60000
            );

        console.log('');

        console.log(
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        );

        console.log(
            `📅 فعالية ${i + 1}/${TOTAL_EVENTS}`
        );

        console.log(
            `🕘 ${formatSaudiDate(startTime)}`
        );

        console.log(
            `🕙 ${formatSaudiDate(endTime)}`
        );

        // ----------------------------------------------------
        // فحص التعارض
        // ----------------------------------------------------

        const conflicting =
            isEventConflicting(
                existingEvents,
                startTime,
                endTime
            );

        if (conflicting) {
            console.log(
                `⚠️ تجاوز [${EVENT_NAME}]`
            );

            console.log(
                `⚠️ الوقت ${formatAMPM(startTime)} محجوز`
            );
        } else {
            try {
                console.log(
                    '🚀 جاري إنشاء الفعالية...'
                );

                const response =
                    await service.websocket.emit(
                        'group event create',
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

                        // ------------------------------------------------
                        // نضيف الفعالية الجديدة لقائمة التعارض
                        // ------------------------------------------------

                        existingEvents.push({
                            startsAt:
                                startTime.toISOString(),

                            endsAt:
                                endTime.toISOString()
                        });
                    }

                    console.log('');

                    console.log(
                        `🚀 تم الرفع: ${EVENT_NAME}`
                    );

                    console.log(
                        `🕘 الوقت: ${formatAMPM(startTime)}`
                    );

                    console.log(
                        `🆔 ID: ${eventId}`
                    );
                } else {
                    console.log(
                        `⚠️ فشل إنشاء فعالية: ${
                            JSON.stringify(
                                response
                            )
                        }`
                    );
                }

            } catch (error) {
                console.error(
                    `❌ خطأ بإنشاء فعالية ${i + 1}:`,
                    error?.message ||
                    error
                );
            }
        }

        // ----------------------------------------------------
        // الانتقال للفعالية التالية
        // ----------------------------------------------------

        startTime =
            new Date(
                endTime.getTime()
            );

        await sleep(500);
    }

    // ========================================================
    // رفع الصور
    // ========================================================

    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        '🖼️ جاري رفع الصور لكل الفعاليات...'
    );

    console.log(
        `📌 عدد الفعاليات التي تم إنشاؤها: ${createdEventIds.length}`
    );

    console.log(
        '========================================'
    );

    if (
        createdEventIds.length === 0
    ) {
        console.log(
            'ℹ️ لا توجد فعاليات جديدة لرفع الصور عليها.'
        );

        return;
    }

    // --------------------------------------------------------
    // التحقق من الصورة
    // --------------------------------------------------------

    if (
        !fs.existsSync(
            IMAGE_PATH
        )
    ) {
        console.error(
            `❌ الصورة غير موجودة بالمسار: ${IMAGE_PATH}`
        );

        return;
    }

    // --------------------------------------------------------
    // تحويل الصورة إلى JPEG
    // --------------------------------------------------------

    const thumbnailBuffer =
        await sharp(
            IMAGE_PATH
        )
            .jpeg({
                quality: 90
            })
            .toBuffer();

    console.log(
        `📦 حجم الصورة بعد التجهيز: ${
            (
                thumbnailBuffer.length /
                1024
            ).toFixed(2)
        } KB`
    );

    // --------------------------------------------------------
    // رفع الصورة لكل فعالية
    // --------------------------------------------------------

    for (
        const id of createdEventIds
    ) {
        try {
            console.log(
                `🖼️ رفع صورة للفعالية ID: ${id}`
            );

            const imageResponse =
                await service.event.group.updateThumbnail(
                    parseInt(
                        id,
                        10
                    ),
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
                    `⚠️ فشلت صورة ID ${id}: ${
                        JSON.stringify(
                            imageResponse
                        )
                    }`
                );
            }

        } catch (error) {
            console.error(
                `❌ خطأ برفع صورة ID ${id}:`,
                error?.message ||
                error
            );
        }

        await sleep(800);
    }

    console.log('');

    console.log(
        '🏁 انتهى إنشاء الفعاليات ورفع الصور.'
    );
}

// ============================================================
// الإغلاق الآمن
// ============================================================

async function shutdown(
    exitCode = 0
) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        '🛑 إغلاق البوت...'
    );

    console.log(
        '========================================'
    );

    // --------------------------------------------------------
    // Socket
    // --------------------------------------------------------

    try {
        if (socket) {
            socket.disconnect();
        }
    } catch {}

    // --------------------------------------------------------
    // Chrome
    // --------------------------------------------------------

    try {
        await closeSessionBrowser();
    } catch {}

    console.log(
        '🔌 Connection closed.'
    );

    console.log(
        '🧹 Chrome Profile closed.'
    );

    console.log(
        '✅ Shutdown complete.'
    );

    process.exit(
        exitCode
    );
}

// ============================================================
// Signals
// ============================================================

process.on(
    'SIGINT',
    () => shutdown(0)
);

process.on(
    'SIGTERM',
    () => shutdown(0)
);

// ============================================================
// التشغيل الرئيسي
// ============================================================

async function main() {
    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        '🚀 WOLF EVENT BOT'
    );

    console.log(
        '========================================'
    );

    console.log(
        '🐺 WOLF Merged Bot'
    );

    console.log(
        '🔐 Loading credentials from Chrome Profile'
    );

    console.log(
        `📱 Device: web`
    );

    console.log(
        '🎯 Task: Create Events + Upload Images'
    );

    console.log(
        '========================================'
    );

    // --------------------------------------------------------
    // تحميل Profile + Token
    // --------------------------------------------------------

    await loadWolfCredentials();

    // --------------------------------------------------------
    // إنشاء Service
    // --------------------------------------------------------

    createService();

    // --------------------------------------------------------
    // Handlers
    // --------------------------------------------------------

    await initializeHandlers();

    // --------------------------------------------------------
    // Socket
    // --------------------------------------------------------

    await connectService();

    // --------------------------------------------------------
    // التأكد من الحساب
    // --------------------------------------------------------

    await verifyAccount();

    // --------------------------------------------------------
    // إنشاء الفعاليات
    // --------------------------------------------------------

    await createEventsAndUploadThumbnails();

    // --------------------------------------------------------
    // انتهاء المهمة
    // --------------------------------------------------------

    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        '🎉 انتهت مهمة WOLF بالكامل'
    );

    console.log(
        '========================================'
    );

    console.log(
        '✅ تم فحص التعارض'
    );

    console.log(
        '✅ تم إنشاء الفعاليات'
    );

    console.log(
        '✅ تم رفع الصور'
    );

    console.log(
        '🛑 إغلاق البوت...'
    );

    console.log(
        '========================================'
    );

    await shutdown(0);
}

// ============================================================
// FATAL ERROR
// ============================================================

main().catch(
    async error => {
        console.error('');

        console.error(
            '========================================'
        );

        console.error(
            '❌ FATAL ERROR'
        );

        console.error(
            '========================================'
        );

        console.error(
            error?.stack ||
            error?.message ||
            error
        );

        try {
            if (socket) {
                socket.disconnect();
            }
        } catch {}

        try {
            await closeSessionBrowser();
        } catch {}

        process.exit(1);
    }
);
