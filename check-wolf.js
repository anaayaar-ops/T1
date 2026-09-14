import fs from 'fs';
import sharp from 'sharp';
import wolfjs from 'wolf.js';
import { io } from 'socket.io-client';

import {
    loadSession,
    closeSessionBrowser
} from './session-loader.js';

const {
    WOLF,
    OnlineState
} = wolfjs;

// ============================================================
// إعدادات
// ============================================================

const GROUP_ID = 66266;

const EVENT_NAME =
    " ᷂فعاليآت ᷂خليجنا،ذوق.";

const TOTAL_EVENTS = 32;

const EVENT_DURATION_MIN = 45;

const IMAGE_PATH =
    './178332617173751.jpeg';

const START_TIME =
    new Date('2026-09-16T21:00:00+03:00');

// ============================================================
// Credentials
// ============================================================

let WOLF_TOKEN = null;

let WOLF_APP_CHECK_TOKEN = null;

let WOLF_DEVICE = 'web';

let WOLF_IS_APP_CHECK_ENABLED = false;

// ============================================================
// Runtime
// ============================================================

let service = null;

let socket = null;

let shuttingDown = false;

// ============================================================
// Helpers
// ============================================================

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function formatAMPM(date) {

    let hours =
        date.getHours();

    let minutes =
        date.getMinutes();

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

function maskToken(value) {

    if (!value) {
        return 'غير موجود';
    }

    const text =
        String(value);

    if (text.length <= 16) {
        return `${text.slice(0, 4)}...${text.slice(-4)}`;
    }

    return `${text.slice(0, 8)}...${text.slice(-8)}`;
}

// ============================================================
// تحميل Credentials من Chrome
// ============================================================

async function loadWolfCredentials() {

    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        '🔐 Loading WOLF Chrome Profile'
    );

    console.log(
        '========================================'
    );

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
            WOLF_APP_CHECK_TOKEN
        );

    if (!WOLF_TOKEN) {

        throw new Error(
            '❌ لم يتم العثور على v3APIToken'
        );
    }

    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        '🔐 WOLF Credentials'
    );

    console.log(
        '========================================'
    );

    console.log(
        `🔐 v3APIToken: ${maskToken(WOLF_TOKEN)}`
    );

    console.log(
        `🔐 Token length: ${WOLF_TOKEN.length}`
    );

    if (WOLF_APP_CHECK_TOKEN) {

        console.log(
            `🛡️ appCheckToken: ${maskToken(WOLF_APP_CHECK_TOKEN)}`
        );

        console.log(
            `🛡️ AppCheck length: ${WOLF_APP_CHECK_TOKEN.length}`
        );

    } else {

        console.log(
            '⚠️ appCheckToken غير موجود'
        );
    }

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

    console.log(
        '========================================'
    );
}

// ============================================================
// إنشاء Service
// ============================================================

function createService() {

    console.log(
        '⚙️ Creating WOLF service...'
    );

    service =
        new WOLF();

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
// Handlers
// ============================================================

async function initializeHandlers() {

    console.log(
        '⚙️ Initializing service handlers...'
    );

    await service.websocket.init();

    const count =
        Object.keys(
            service.websocket.handlers || {}
        ).length;

    console.log(
        `⚙️ Loaded ${count} handlers`
    );
}

// ============================================================
// الاتصال
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
        `🛡️ App Check: ${
            WOLF_IS_APP_CHECK_ENABLED
                ? 'enabled'
                : 'disabled'
        }`
    );

    console.log(
        '========================================'
    );

    const query = {

        token:
            WOLF_TOKEN,

        device,

        state:
            service.config.framework
                .login
                .onlineState,

        version:
            connection?.version ||
            undefined,

        isAppCheckEnabled:
            WOLF_IS_APP_CHECK_ENABLED
                ? 'true'
                : 'false'
    };

    if (
        WOLF_IS_APP_CHECK_ENABLED &&
        WOLF_APP_CHECK_TOKEN
    ) {

        query.appCheckToken =
            WOLF_APP_CHECK_TOKEN;
    }

    socket =
        io(
            `${host}:${port}`,
            {
                transports: [
                    'websocket'
                ],

                reconnection: true,

                autoConnect: false,

                query
            }
        );

    service.websocket.socket =
        socket;

    // ========================================================
    // Connected
    // ========================================================

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

    // ========================================================
    // Error
    // ========================================================

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

    // ========================================================
    // Disconnect
    // ========================================================

    socket.on(
        'disconnect',
        reason => {

            console.log(
                `🔌 Connection closed: ${reason}`
            );
        }
    );

    // ========================================================
    // WOLF handlers
    // ========================================================

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

    console.log(
        '🔌 Connecting...'
    );

    socket.connect();

    await waitForAuthorization();
}

// ============================================================
// انتظار Authorization
// ============================================================

async function waitForAuthorization(
    timeout = 60000
) {

    const start =
        Date.now();

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
// انتظار Ready
// ============================================================

async function waitForServiceReady(
    timeout = 30000
) {

    const start =
        Date.now();

    console.log(
        '⏳ Waiting for WOLF service ready...'
    );

    while (
        Date.now() - start <
        timeout
    ) {

        if (
            service.currentSubscriber?.id &&
            service.websocket?.socket
        ) {

            await sleep(1500);

            console.log(
                '✅ WOLF service ready'
            );

            return;
        }

        await sleep(500);
    }

    throw new Error(
        '❌ WOLF service ready timeout'
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
            '❌ الحساب غير مصرح'
        );
    }

    console.log('');

    console.log(
        '🟢 Authorization successful.'
    );

    console.log(
        `👤 ${
            service.currentSubscriber.nickname ||
            service.currentSubscriber.username ||
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
// جلب الفعاليات
// ============================================================
//
// هنا لا نغيّر طريقة الاتصال.
// نختبر Event API نفسه.
//
// TEST 1:
// group event list مع groupId رقم
//
// TEST 2:
// group event list مع groupId نص
//
// TEST 3:
// إذا الاثنين فشلوا، نجرب group event create
//
// الهدف معرفة:
// هل المشكلة في LIST فقط؟
// أم أن Event API كاملًا يرفض الطلب؟
//

async function getExistingEvents() {

    console.log('');

    console.log(
        '🔍 فحص التعارض في الروم...'
    );

    // ========================================================
    // TEST 1
    // ========================================================

    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        '🧪 TEST 1'
    );

    console.log(
        '📡 group event list'
    );

    console.log(
        '📌 groupId = Number'
    );

    console.log(
        '========================================'
    );

    let listRes1 = null;

    try {

        listRes1 =
            await service.websocket.emit(
                'group event list',
                {
                    groupId:
                        GROUP_ID,

                    languageId:
                        1
                }
            );

        console.log(
            '📡 LIST NUMBER RESPONSE:'
        );

        console.log(
            JSON.stringify(
                listRes1,
                null,
                2
            )
        );

    } catch (error) {

        console.error(
            '❌ LIST NUMBER ERROR:'
        );

        console.error(
            error?.stack ||
            error?.message ||
            error
        );
    }

    // ========================================================
    // إذا نجح TEST 1
    // ========================================================

    if (
        listRes1?.success
    ) {

        const existingEvents =
            Array.isArray(
                listRes1.body
            )
                ? listRes1.body
                : [];

        console.log('');

        console.log(
            `✅ نجح Event List`
        );

        console.log(
            `📋 عدد الفعاليات الموجودة: ${existingEvents.length}`
        );

        return existingEvents;
    }

    // ========================================================
    // TEST 2
    // ========================================================

    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        '🧪 TEST 2'
    );

    console.log(
        '📡 group event list'
    );

    console.log(
        '📌 groupId = String'
    );

    console.log(
        '========================================'
    );

    let listRes2 = null;

    try {

        listRes2 =
            await service.websocket.emit(
                'group event list',
                {
                    groupId:
                        String(GROUP_ID),

                    languageId:
                        1
                }
            );

        console.log(
            '📡 LIST STRING RESPONSE:'
        );

        console.log(
            JSON.stringify(
                listRes2,
                null,
                2
            )
        );

    } catch (error) {

        console.error(
            '❌ LIST STRING ERROR:'
        );

        console.error(
            error?.stack ||
            error?.message ||
            error
        );
    }

    // ========================================================
    // إذا نجح TEST 2
    // ========================================================

    if (
        listRes2?.success
    ) {

        const existingEvents =
            Array.isArray(
                listRes2.body
            )
                ? listRes2.body
                : [];

        console.log('');

        console.log(
            `✅ نجح Event List باستخدام String`
        );

        console.log(
            `📋 عدد الفعاليات الموجودة: ${existingEvents.length}`
        );

        return existingEvents;
    }

    // ========================================================
    // TEST 3
    // ========================================================

    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        '🧪 TEST 3'
    );

    console.log(
        '📡 group event create'
    );

    console.log(
        '⚠️ هذا الاختبار سينشئ فعالية فعلية لمدة دقيقة'
    );

    console.log(
        '========================================'
    );

    const testStart =
        new Date(
            Date.now() +
            10 * 60 * 1000
        );

    const testEnd =
        new Date(
            testStart.getTime() +
            1 * 60 * 1000
        );

    console.log(
        `🕘 Test Start: ${testStart.toISOString()}`
    );

    console.log(
        `🕘 Test End: ${testEnd.toISOString()}`
    );

    let createTest = null;

    try {

        createTest =
            await service.websocket.emit(
                'group event create',
                {
                    groupId:
                        GROUP_ID,

                    title:
                        'WOLF EVENT API TEST',

                    startsAt:
                        testStart.toISOString(),

                    endsAt:
                        testEnd.toISOString(),

                    category:
                        1,

                    languageId:
                        1
                }
            );

        console.log(
            '📡 CREATE TEST RESPONSE:'
        );

        console.log(
            JSON.stringify(
                createTest,
                null,
                2
            )
        );

    } catch (error) {

        console.error(
            '❌ CREATE TEST ERROR:'
        );

        console.error(
            error?.stack ||
            error?.message ||
            error
        );
    }

    // ========================================================
    // إذا نجح CREATE
    // ========================================================

    if (
        createTest?.success
    ) {

        const testId =
            createTest.body?.id;

        console.log('');

        console.log(
            '========================================'
        );

        console.log(
            '🎯 النتيجة'
        );

        console.log(
            '========================================'
        );

        console.log(
            '✅ group event create يعمل'
        );

        console.log(
            '❌ group event list فقط يرجع 400'
        );

        console.log(
            `🆔 Test Event ID: ${testId}`
        );

        console.log(
            '========================================'
        );

        // نعيد القائمة فارغة مؤقتًا
        // حتى نعرف هل CREATE يعمل أم لا.
        return [];
    }

    // ========================================================
    // كل Event API فشل
    // ========================================================

    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        '❌ Event API FAILED'
    );

    console.log(
        '========================================'
    );

    console.log(
        `LIST NUMBER: ${JSON.stringify(listRes1)}`
    );

    console.log(
        `LIST STRING: ${JSON.stringify(listRes2)}`
    );

    console.log(
        `CREATE TEST: ${JSON.stringify(createTest)}`
    );

    console.log(
        '========================================'
    );

    throw new Error(
        `❌ Event API يرفض الطلبات. LIST=${JSON.stringify(listRes1)} CREATE=${JSON.stringify(createTest)}`
    );
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

            const eStart =
                new Date(
                    event.startsAt
                ).getTime();

            const eEnd =
                new Date(
                    event.endsAt
                ).getTime();

            if (
                Number.isNaN(eStart) ||
                Number.isNaN(eEnd)
            ) {

                return false;
            }

            return (
                startTime.getTime() <
                eEnd &&
                endTime.getTime() >
                eStart
            );
        }
    );
}

// ============================================================
// إنشاء الفعاليات
// ============================================================

async function createEvents() {

    const existingEvents =
        await getExistingEvents();

    let startTime =
        new Date(
            START_TIME.getTime()
        );

    const createdEventIds = [];

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
        `📌 Total: ${TOTAL_EVENTS}`
    );

    console.log(
        `⏱️ Duration: ${EVENT_DURATION_MIN} minutes`
    );

    console.log(
        `🕘 Start: ${formatSaudiDate(START_TIME)}`
    );

    console.log(
        '========================================'
    );

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
            `📅 فعالية ${i + 1}/${TOTAL_EVENTS}`
        );

        console.log(
            `🕘 ${formatAMPM(startTime)}`
        );

        // ====================================================
        // التعارض
        // ====================================================

        const isConflicting =
            isEventConflicting(
                existingEvents,
                startTime,
                endTime
            );

        if (
            isConflicting
        ) {

            console.log(
                `⚠️ تجاوز [${EVENT_NAME}]: الوقت ${formatAMPM(startTime)} محجوز.`
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

                console.log(
                    '📡 CREATE RESPONSE:',
                    JSON.stringify(
                        response
                    )
                );

                if (
                    response?.success
                ) {

                    const eventId =
                        response.body?.id;

                    if (
                        eventId
                    ) {

                        createdEventIds.push(
                            String(eventId)
                        );

                        existingEvents.push({

                            startsAt:
                                startTime.toISOString(),

                            endsAt:
                                endTime.toISOString()
                        });
                    }

                    console.log(
                        `🚀 تم الرفع: ${EVENT_NAME} | الوقت: ${formatAMPM(startTime)} | ID: ${eventId}`
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

        startTime =
            new Date(
                endTime.getTime()
            );

        await sleep(500);
    }

    return createdEventIds;
}

// ============================================================
// رفع الصور
// ============================================================

async function uploadImages(
    createdEventIds
) {

    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        '🖼️ جاري رفع الصور لكل الفعاليات...'
    );

    console.log(
        `📌 عدد الفعاليات: ${createdEventIds.length}`
    );

    console.log(
        '========================================'
    );

    if (
        createdEventIds.length === 0
    ) {

        console.log(
            'ℹ️ لا توجد فعاليات جديدة لرفع الصور.'
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

        return;
    }

    const thumbnailBuffer =
        await sharp(
            IMAGE_PATH
        )
            .jpeg({
                quality: 90
            })
            .toBuffer();

    for (
        const id of createdEventIds
    ) {

        try {

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
                    `🖼️ تم رفع صورة: ID ${id}`
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

    console.log(
        '🏁 انتهى رفع الصور.'
    );
}

// ============================================================
// المهمة كاملة
// ============================================================

async function runTask() {

    await waitForServiceReady();

    await verifyAccount();

    const createdEventIds =
        await createEvents();

    await uploadImages(
        createdEventIds
    );

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
        `✅ تم إنشاء ${createdEventIds.length} فعالية`
    );

    console.log(
        '========================================'
    );
}

// ============================================================
// Shutdown
// ============================================================

async function shutdown(
    exitCode = 0
) {

    if (
        shuttingDown
    ) {

        return;
    }

    shuttingDown = true;

    console.log('');

    console.log(
        '🛑 إغلاق البوت...'
    );

    try {

        socket?.disconnect();

    } catch {}

    try {

        await closeSessionBrowser();

    } catch {}

    console.log(
        '🔌 Connection closed.'
    );

    console.log(
        '🧹 Chrome Profile closed.'
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
// Main
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
        '🔐 Chrome Profile Authentication'
    );

    console.log(
        '🎯 Event API Diagnostic'
    );

    console.log(
        '========================================'
    );

    // ========================================================
    // 1. تحميل Chrome Profile
    // ========================================================

    await loadWolfCredentials();

    // ========================================================
    // 2. إنشاء WOLF Service
    // ========================================================

    createService();

    // ========================================================
    // 3. Handlers
    // ========================================================

    await initializeHandlers();

    // ========================================================
    // 4. Socket
    // ========================================================

    await connectService();

    // ========================================================
    // 5. المهمة
    // ========================================================

    await runTask();

    // ========================================================
    // 6. Finish
    // ========================================================

    await shutdown(0);
}

// ============================================================
// Fatal Error
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

            socket?.disconnect();

        } catch {}

        try {

            await closeSessionBrowser();

        } catch {}

        process.exit(1);
    }
);
