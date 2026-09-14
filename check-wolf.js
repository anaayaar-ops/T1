import wolfjs from 'wolf.js';
import { io } from 'socket.io-client';
import { chromium } from 'playwright';

import {
    loadSession,
    closeSessionBrowser
} from './session-loader.js';

import {
    Command
} from './node_modules/wolf.js/src/constants/index.js';

const { WOLF, OnlineState } = wolfjs;

// ============================================================
// ⚙️ الإعدادات
// ============================================================

const TARGET_GROUP = 18432094;

// التاريخ المطلوب
const TARGET_DATE = '2026-09-12';

// العضوية التي رفعت الفعاليات
const TARGET_MEMBER_ID = 80055399;

// رقم العضوية الأساسي في Typeform
const MEMBERSHIP_NUMBER = '224';

// رابط النموذج
const FORM_URL =
    'https://survey-poll.typeform.com/to/JTsKMIEB';

// سرعة الكتابة
const TYPE_DELAY = 40;


// ============================================================
// 🐺 WOLF SERVICE
// ============================================================

const service = new WOLF();

let socket = null;


// ============================================================
// 💤 Sleep
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


// ============================================================
// 🇸🇦 استخراج أجزاء التاريخ بتوقيت الرياض
// ============================================================

function getRiyadhParts(date) {

    const formatter =
        new Intl.DateTimeFormat(
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
        );

    const parts =
        formatter.formatToParts(date);

    const get = type =>
        parts.find(
            p => p.type === type
        )?.value;

    return {
        year: Number(get('year')),
        month: Number(get('month')),
        day: Number(get('day')),
        hour: Number(get('hour')),
        minute: Number(get('minute'))
    };
}


// ============================================================
// 🕐 تحويل الوقت إلى AM / PM بتوقيت السعودية
// ============================================================

function formatTime(date) {

    const p =
        getRiyadhParts(date);

    let hour = p.hour;

    const ampm =
        hour >= 12
            ? 'PM'
            : 'AM';

    hour =
        hour % 12 || 12;

    return (
        `${hour}:` +
        `${String(p.minute).padStart(2, '0')} ` +
        `${ampm}`
    );
}


// ============================================================
// 📅 تاريخ السعودية
// ============================================================

function formatSaudiDate(date) {

    const p =
        getRiyadhParts(date);

    return (
        `${p.year}-` +
        `${String(p.month).padStart(2, '0')}-` +
        `${String(p.day).padStart(2, '0')}`
    );
}


// ============================================================
// ⌨️ الكتابة الطبيعية
// ============================================================

async function typeReal(
    page,
    value,
    {
        pressEnterAfter = false
    } = {}
) {

    await page.keyboard.type(
        String(value),
        {
            delay: TYPE_DELAY
        }
    );

    if (pressEnterAfter) {

        await page.waitForTimeout(200);

        await page.keyboard.press(
            'Enter'
        );
    }
}


// ============================================================
// ⌨️ تعبئة الحقل النشط
// ============================================================

async function fillActiveQuestion(
    page,
    value,
    {
        pressEnterAfter = true,
        waitAfter = 500
    } = {}
) {

    try {

        await page.waitForFunction(
            () => {

                const el =
                    document.activeElement;

                return (
                    el &&
                    (
                        el.tagName === 'INPUT' ||
                        el.tagName === 'TEXTAREA'
                    )
                );
            },
            {
                timeout: 5000
            }
        );

        const active =
            page
                .locator(
                    'input:focus, textarea:focus'
                )
                .first();

        await active.waitFor({
            state: 'visible',
            timeout: 5000
        });

    } catch {

        console.log(
            '⚠️ لم يتم رصد الحقل النشط، أحاول استخدام آخر حقل ظاهر...'
        );

        const fallback =
            page
                .locator(
                    'input:visible, textarea:visible'
                )
                .last();

        await fallback.click({
            timeout: 5000
        });
    }

    await typeReal(
        page,
        value
    );

    if (pressEnterAfter) {

        await page.waitForTimeout(200);

        await page.keyboard.press(
            'Enter'
        );
    }

    await page.waitForTimeout(
        waitAfter
    );
}


// ============================================================
// 🔘 زر OK
// ============================================================

async function clickOkButton(page) {

    try {

        const okButton =
            page
                .getByRole(
                    'button',
                    {
                        name: /^OK$/i
                    }
                )
                .first();

        await okButton.click({
            timeout: 3000
        });

        return true;

    } catch {

        return false;
    }
}


// ============================================================
// 🔐 الاتصال بـ WOLF عن طريق Chrome Profile
// ============================================================

async function connectToWolf() {

    console.log('');
    console.log(
        '========================================'
    );

    console.log(
        '🐺 WOLF Chrome Profile Connection'
    );

    console.log(
        '========================================'
    );

    // --------------------------------------------------------
    // تحميل Chrome Profile
    // --------------------------------------------------------

    console.log(
        '🌐 جاري تحميل جلسة Chrome Profile...'
    );

    const session =
        await loadSession();

    if (!session) {

        throw new Error(
            'لم يتم تحميل جلسة Chrome.'
        );
    }

    // --------------------------------------------------------
    // اكتشاف مكان credentials
    // --------------------------------------------------------

    let credentials = null;

    if (
        session.v3APIToken ||
        session.appCheckToken
    ) {

        credentials =
            session;

    } else if (
        session.credentials?.v3APIToken
    ) {

        credentials =
            session.credentials;

    } else if (
        session.data?.v3APIToken
    ) {

        credentials =
            session.data;

    } else if (
        session.tokens?.v3APIToken
    ) {

        credentials =
            session.tokens;
    }

    // --------------------------------------------------------
    // احتمالات إضافية
    // --------------------------------------------------------

    if (
        !credentials &&
        typeof session === 'object'
    ) {

        const possibleKeys = [
            'wolf',
            'wolfCredentials',
            'wolfSession',
            'auth',
            'authentication'
        ];

        for (
            const key of possibleKeys
        ) {

            if (
                session[key]?.v3APIToken
            ) {

                credentials =
                    session[key];

                break;
            }
        }
    }

    // --------------------------------------------------------
    // التحقق
    // --------------------------------------------------------

    if (
        !credentials?.v3APIToken
    ) {

        console.log('');
        console.log(
            '🔎 لم أجد v3APIToken في نتيجة loadSession().'
        );

        try {

            console.log(
                JSON.stringify(
                    session,
                    (key, value) => {

                        if (
                            key === 'v3APIToken' ||
                            key === 'appCheckToken'
                        ) {

                            if (
                                typeof value === 'string'
                            ) {

                                return (
                                    value.slice(0, 8) +
                                    '...' +
                                    value.slice(-6)
                                );
                            }
                        }

                        return value;
                    },
                    2
                )
            );

        } catch {

            console.log(
                '[تعذر طباعة session]'
            );
        }

        throw new Error(
            'لم يتم العثور على v3APIToken داخل نتيجة loadSession().'
        );
    }

    // --------------------------------------------------------
    // عرض credentials
    // --------------------------------------------------------

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
        `🔐 v3APIToken: ` +
        `${credentials.v3APIToken.slice(0, 8)}...` +
        `${credentials.v3APIToken.slice(-8)}`
    );

    console.log(
        `🔐 Token length: ` +
        `${credentials.v3APIToken.length}`
    );

    if (
        credentials.appCheckToken
    ) {

        console.log(
            `🛡️ appCheckToken: ` +
            `${credentials.appCheckToken.slice(0, 10)}...` +
            `${credentials.appCheckToken.slice(-10)}`
        );

        console.log(
            `🛡️ AppCheck length: ` +
            `${credentials.appCheckToken.length}`
        );

        console.log(
            '✅ App Check token موجود'
        );

    } else {

        console.log(
            '⚠️ App Check token غير موجود'
        );
    }

    console.log(
        `📱 Device: ${
            credentials.device || 'web'
        }`
    );

    console.log(
        '========================================'
    );

    // --------------------------------------------------------
    // إعداد WOLF
    // --------------------------------------------------------

    service.config.framework.login.token =
        credentials.v3APIToken;

    service.config.framework.login.onlineState =
        OnlineState.INVISIBLE;

    if (
        credentials.appCheckToken
    ) {

        service.config.framework.login.appCheckToken =
            credentials.appCheckToken;
    }

    // --------------------------------------------------------
    // تهيئة WebSocket
    // --------------------------------------------------------

    console.log(
        '⚙️ تهيئة WOLF WebSocket handlers...'
    );

    await service.websocket.init();

    console.log(
        `✅ WOLF handlers: ${
            Object.keys(
                service.websocket.handlers || {}
            ).length
        }`
    );

    // --------------------------------------------------------
    // إعداد الاتصال
    // --------------------------------------------------------

    const connection =
        service
            ._frameworkConfig
            ?.get?.('connection');

    const host =
        connection?.host ||
        'https://v3-rc.palringo.com';

    const port =
        connection?.port ||
        443;

    const frameworkQuery =
        connection?.query || {};

    console.log('');
    console.log(
        '📡 إعداد الاتصال:'
    );

    console.log(
        `   Host: ${host}`
    );

    console.log(
        `   Port: ${port}`
    );

    // --------------------------------------------------------
    // Socket.IO Query
    // --------------------------------------------------------

    const socketQuery = {

        token:
            credentials.v3APIToken,

        device:
            frameworkQuery.device ||
            credentials.device ||
            'web',

        state:
            frameworkQuery.state ??
            1,

        version:
            frameworkQuery.version ||
            '2.7.10',

        isAppCheckEnabled:
            frameworkQuery.isAppCheckEnabled ??
            credentials.isAppCheckEnabled ??
            true,

        appCheckToken:
            credentials.appCheckToken ||
            frameworkQuery.appCheckToken ||
            ''
    };

    console.log(
        `📱 Socket Device: ${
            socketQuery.device
        }`
    );

    // --------------------------------------------------------
    // إنشاء Socket.IO
    // --------------------------------------------------------

    socket =
        io(
            host,
            {
                path: '/socket.io',

                transports: [
                    'websocket'
                ],

                query:
                    socketQuery,

                autoConnect:
                    false,

                reconnection:
                    true,

                reconnectionAttempts:
                    5,

                timeout:
                    20000
            }
        );

    // --------------------------------------------------------
    // تمرير أحداث WOLF
    // --------------------------------------------------------

    socket.onAny(
        async (
            eventName,
            data
        ) => {

            if (
                eventName ===
                'group event update'
            ) {
                return;
            }

            const handler =
                service
                    .websocket
                    .handlers?.[
                        eventName
                    ];

            if (!handler) {
                return;
            }

            try {

                await handler.process(
                    data?.body ??
                    data
                );

            } catch (err) {

                console.error(
                    `❌ خطأ في Handler ${eventName}:`,
                    err?.message || err
                );
            }
        }
    );

    // --------------------------------------------------------
    // Socket events
    // --------------------------------------------------------

    socket.on(
        'connect',
        () => {

            console.log(
                '🔌 Socket.IO connected'
            );
        }
    );

    socket.on(
        'disconnect',
        reason => {

            console.log(
                `🔌 Socket.IO disconnected: ${reason}`
            );
        }
    );

    socket.on(
        'connect_error',
        err => {

            console.error(
                '❌ Socket.IO connection error:',
                err?.message || err
            );
        }
    );

    // --------------------------------------------------------
    // ربط socket مع wolf.js
    // --------------------------------------------------------

    service.websocket.socket =
        socket;

    // --------------------------------------------------------
    // الاتصال
    // --------------------------------------------------------

    console.log('');
    console.log(
        '🚀 جاري الاتصال بـ WOLF...'
    );

    socket.connect();

    // --------------------------------------------------------
    // انتظار Authorization
    // --------------------------------------------------------

    const authorizationTimeout =
        30000;

    const started =
        Date.now();

    while (
        !service.currentSubscriber?.id
    ) {

        if (
            Date.now() -
            started >
            authorizationTimeout
        ) {

            throw new Error(
                'انتهت مهلة Authorization في WOLF.'
            );
        }

        await sleep(500);
    }

    // --------------------------------------------------------
    // نجاح الاتصال
    // --------------------------------------------------------

    console.log('');
    console.log(
        '========================================'
    );

    console.log(
        '✅ WOLF Authorization complete'
    );

    console.log(
        `👤 Nickname: ${
            service.currentSubscriber.nickname
        }`
    );

    console.log(
        `🆔 ID: ${
            service.currentSubscriber.id
        }`
    );

    console.log(
        '👻 Online State: Invisible'
    );

    console.log(
        '========================================'
    );

    return true;
}


// ============================================================
// 📋 جلب قائمة فعاليات الروم
// ============================================================

async function getGroupEvents() {

    console.log('');
    console.log(
        '========================================'
    );

    console.log(
        '🔍 جاري جلب فعاليات الروم...'
    );

    console.log(
        `🏠 GROUP_ID: ${TARGET_GROUP}`
    );

    console.log(
        '========================================'
    );

    try {

        console.log(
            '📡 إرسال GROUP_EVENT_LIST...'
        );

        const timeoutPromise =
            new Promise(
                (_, reject) => {

                    setTimeout(
                        () => {

                            reject(
                                new Error(
                                    'انتهت مهلة جلب قائمة الفعاليات بعد 30 ثانية.'
                                )
                            );

                        },
                        30000
                    );
                }
            );

        const requestPromise =
            service.websocket.emit(
                Command.GROUP_EVENT_LIST,
                {
                    id:
                        Number(
                            TARGET_GROUP
                        ),

                    subscribe:
                        true,

                    offset:
                        0,

                    limit:
                        service
                            ._frameworkConfig
                            ?.batching
                            ?.length ||
                        100
                }
            );

        const response =
            await Promise.race([
                requestPromise,
                timeoutPromise
            ]);

        console.log(
            '📦 تم استلام رد GROUP_EVENT_LIST'
        );

        if (!response) {

            console.log(
                '⚠️ لم يتم استلام Response.'
            );

            return [];
        }

        console.log(
            `📦 Success: ${response.success}`
        );

        if (
            !response.success
        ) {

            console.log(
                '❌ فشل جلب قائمة الفعاليات.'
            );

            console.log(
                JSON.stringify(
                    response,
                    null,
                    2
                )
            );

            return [];
        }

        const body =
            Array.isArray(
                response.body
            )
                ? response.body
                : [];

        console.log(
            `📋 تم العثور على ${body.length} فعالية.`
        );

        return body;

    } catch (err) {

        console.error('');
        console.error(
            '❌ خطأ أثناء جلب فعاليات الروم:'
        );

        console.error(
            err?.stack ||
            err?.message ||
            err
        );

        return [];
    }
}


// ============================================================
// 🔎 العثور على الفعاليات المطلوبة
// ============================================================

async function findTargetEvents() {

    const list =
        await getGroupEvents();

    if (
        !list.length
    ) {

        console.log(
            '⚠️ لا توجد فعاليات في الروم.'
        );

        return [];
    }

    // --------------------------------------------------------
    // تحديد فعاليات التاريخ
    // --------------------------------------------------------

    const dayEventIds = [];

    for (
        const ev of list
    ) {

        const info =
            ev.additionalInfo || {};

        const startTimeStr =
            info.startsAt ||
            ev.startsAt;

        if (
            !startTimeStr
        ) {
            continue;
        }

        const startTime =
            new Date(
                startTimeStr
            );

        if (
            Number.isNaN(
                startTime.getTime()
            )
        ) {
            continue;
        }

        const dateStr =
            formatSaudiDate(
                startTime
            );

        if (
            dateStr !==
            TARGET_DATE
        ) {
            continue;
        }

        dayEventIds.push({

            id:
                ev.id,

            dateStr,

            start:
                startTime
        });
    }

    console.log('');
    console.log(
        `📅 فعاليات التاريخ ${TARGET_DATE}: ${dayEventIds.length}`
    );

    if (
        !dayEventIds.length
    ) {

        return [];
    }

    // --------------------------------------------------------
    // جلب التفاصيل
    // --------------------------------------------------------

    console.log(
        `🔎 جاري جلب تفاصيل ${dayEventIds.length} فعالية...`
    );

    const ids =
        dayEventIds
            .map(
                e => e.id
            )
            .filter(Boolean);

    const fullEvents =
        await service.event.getByIds(
            ids
        );

    if (
        !Array.isArray(
            fullEvents
        )
    ) {

        console.log(
            '⚠️ تفاصيل الفعاليات ليست Array.'
        );

        return [];
    }

    console.log(
        `✅ تم جلب ${fullEvents.length} فعالية بالتفاصيل.`
    );

    // --------------------------------------------------------
    // فلترة العضوية
    // --------------------------------------------------------

    const foundEvents = [];

    for (
        const fullEv of fullEvents
    ) {

        const meta =
            dayEventIds.find(
                e =>
                    Number(e.id) ===
                    Number(fullEv.id)
            );

        if (!meta) {
            continue;
        }

        if (
            fullEv.createdBy !== null &&
            fullEv.createdBy !== undefined &&
            parseInt(
                fullEv.createdBy,
                10
            ) === TARGET_MEMBER_ID
        ) {

            foundEvents.push({

                id:
                    fullEv.id,

                dateStr:
                    meta.dateStr,

                timeStr:
                    formatTime(
                        meta.start
                    ),

                start:
                    meta.start
            });
        }
    }

    // --------------------------------------------------------
    // ترتيب حسب الوقت
    // --------------------------------------------------------

    foundEvents.sort(
        (a, b) =>
            a.start -
            b.start
    );

    console.log('');
    console.log(
        '========================================'
    );

    console.log(
        `📋 تم العثور على ${foundEvents.length} فعالية مطابقة.`
    );

    console.log(
        '========================================'
    );

    for (
        let i = 0;
        i < foundEvents.length;
        i++
    ) {

        const event =
            foundEvents[i];

        console.log(
            `${i + 1}. ` +
            `ID: ${event.id} | ` +
            `${event.dateStr} | ` +
            `${event.timeStr}`
        );
    }

    return foundEvents;
}


// ============================================================
// 🌐 رفع الفعاليات إلى Typeform
// ============================================================

async function submitEventsToForm(
    events
) {

    if (
        events.length === 0
    ) {

        console.log('');
        console.log(
            '⚠️ لا توجد فعاليات مطابقة لرفعها.'
        );

        return;
    }

    console.log('');
    console.log(
        `🚀 تم العثور على (${events.length}) فعالية.`
    );

    console.log(
        '🚀 بدء الرفع التلقائي للنموذج...'
    );

    // --------------------------------------------------------
    // Playwright
    // --------------------------------------------------------

    const browser =
        await chromium.launch({
            headless: true,

            args: [
                '--no-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

    const context =
        await browser.newContext();

    const topicLetters = [
        'A',
        'B',
        'C'
    ];

    try {

        for (
            let i = 0;
            i < events.length;
            i++
        ) {

            const event =
                events[i];

            const currentLetter =
                topicLetters[
                    i %
                    topicLetters.length
                ];

            const [
                year,
                month,
                day
            ] =
                event.dateStr.split('-');

            const page =
                await context.newPage();

            console.log('');
            console.log(
                '----------------------------------------'
            );

            console.log(
                `[رفع الفعالية ${i + 1} من ${events.length}]`
            );

            console.log(
                `🆔 ID: ${event.id}`
            );

            console.log(
                `⏰ الوقت: ${event.timeStr}`
            );

            console.log(
                `🔤 الموضوع: ${currentLetter}`
            );

            try {

                // ------------------------------------------------
                // الخطوة 0
                // ------------------------------------------------

                console.log(
                    '  ↳ [الخطوة 0] فتح صفحة النموذج...'
                );

                await page.goto(
                    FORM_URL,
                    {
                        waitUntil:
                            'domcontentloaded',

                        timeout:
                            30000
                    }
                );

                await page.waitForTimeout(
                    600
                );

                // ------------------------------------------------
                // زر البداية
                // ------------------------------------------------

                try {

                    const startButton =
                        page.getByText(
                            'سجل برنامجك الآن',
                            {
                                exact: false
                            }
                        );

                    await startButton.waitFor({
                        timeout: 3000
                    });

                    await startButton.click();

                    await page.waitForTimeout(
                        400
                    );

                } catch {
                    // لا مشكلة
                }

                // ------------------------------------------------
                // الخطوة 1
                // ------------------------------------------------

                console.log(
                    '  ↳ [الخطوة 1] رقم العضوية...'
                );

                await fillActiveQuestion(
                    page,
                    MEMBERSHIP_NUMBER
                );

                // ------------------------------------------------
                // الخطوة 2
                // ------------------------------------------------

                console.log(
                    '  ↳ [الخطوة 2] رقم عضوية القناة...'
                );

                await fillActiveQuestion(
                    page,
                    String(
                        TARGET_GROUP
                    )
                );

                // ------------------------------------------------
                // الخطوة 3
                // ------------------------------------------------

                console.log(
                    '  ↳ [الخطوة 3] الثيم الأسبوعي (نعم)...'
                );

                try {

                    const option =
                        page
                            .getByText(
                                'نعم',
                                {
                                    exact: false
                                }
                            )
                            .first();

                    await option.click();

                } catch {

                    await page.keyboard.press(
                        'a'
                    );
                }

                await page.waitForTimeout(
                    400
                );

                // ------------------------------------------------
                // الخطوة 4
                // ------------------------------------------------

                console.log(
                    `  ↳ [الخطوة 4] اختيار المواضيع (${currentLetter})...`
                );

                try {

                    const badge =
                        page
                            .getByText(
                                currentLetter.toUpperCase(),
                                {
                                    exact: true
                                }
                            )
                            .first();

                    await badge.click({
                        timeout: 3000
                    });

                } catch {

                    await page.keyboard.press(
                        currentLetter.toLowerCase()
                    );
                }

                await page.waitForTimeout(
                    300
                );

                await page.keyboard.press(
                    'Enter'
                );

                await page.waitForTimeout(
                    400
                );

                // ------------------------------------------------
                // الخطوة 5 - التاريخ
                // ------------------------------------------------

                console.log(
                    '  ↳ [الخطوة 5] تاريخ الفعالية...'
                );

                const clickAndType =
                    async (
                        placeholder,
                        value
                    ) => {

                        try {

                            const input =
                                page
                                    .getByPlaceholder(
                                        placeholder
                                    )
                                    .first();

                            await input.click({
                                timeout: 3000
                            });

                            await page.keyboard.press(
                                'Control+A'
                            );

                            await page.keyboard.press(
                                'Backspace'
                            );

                            await typeReal(
                                page,
                                value
                            );

                            await page.waitForTimeout(
                                200
                            );

                            const actual =
                                await input
                                    .inputValue()
                                    .catch(
                                        () => null
                                    );

                            if (
                                !actual ||
                                !actual.includes(
                                    String(
                                        parseInt(
                                            value,
                                            10
                                        )
                                    )
                                )
                            ) {

                                console.log(
                                    `⚠️ حقل "${placeholder}" لم يُعبأ بشكل صحيح، أعيد المحاولة...`
                                );

                                await input.click({
                                    timeout: 3000
                                });

                                await page.keyboard.press(
                                    'Control+A'
                                );

                                await page.keyboard.press(
                                    'Backspace'
                                );

                                await typeReal(
                                    page,
                                    value
                                );

                                await page.waitForTimeout(
                                    200
                                );
                            }

                            return true;

                        } catch {

                            console.log(
                                `⚠️ لم يتم إيجاد حقل placeholder="${placeholder}"`
                            );

                            return false;
                        }
                    };

                await clickAndType(
                    'MM',
                    month
                );

                await page.waitForTimeout(
                    250
                );

                await clickAndType(
                    'DD',
                    day
                );

                await page.waitForTimeout(
                    250
                );

                await clickAndType(
                    'YYYY',
                    year
                );

                await page.waitForTimeout(
                    250
                );

                const okClicked =
                    await clickOkButton(
                        page
                    );

                if (
                    !okClicked
                ) {

                    console.log(
                        '⚠️ لم أجد زر OK، أضغط Enter...'
                    );

                    await page.keyboard.press(
                        'Enter'
                    );
                }

                await page.waitForTimeout(
                    500
                );

                // ------------------------------------------------
                // الخطوة 6 - الوقت
                // ------------------------------------------------

                console.log(
                    '  ↳ [الخطوة 6] وقت الفعالية...'
                );

                await fillActiveQuestion(
                    page,
                    event.timeStr
                );

                // ------------------------------------------------
                // الخطوة 7 - ID
                // ------------------------------------------------

                console.log(
                    '  ↳ [الخطوة 7] معرف الفعالية (ID)...'
                );

                await fillActiveQuestion(
                    page,
                    String(
                        event.id
                    ),
                    {
                        pressEnterAfter:
                            false,

                        waitAfter:
                            300
                    }
                );

                // ------------------------------------------------
                // الإرسال
                // ------------------------------------------------

                console.log(
                    '  ↳ [الإرسال النهائي] Ctrl+Enter...'
                );

                await page.keyboard.press(
                    'Control+Enter'
                );

                await page.waitForTimeout(
                    800
                );

                // ------------------------------------------------
                // Submit
                // ------------------------------------------------

                try {

                    const submitEl =
                        page
                            .getByText(
                                'Submit',
                                {
                                    exact: true
                                }
                            )
                            .first();

                    await submitEl.click({
                        force: true
                    });

                    await page.waitForTimeout(
                        500
                    );

                } catch {
                    // تم الإرسال مسبقًا
                }

                // ------------------------------------------------
                // التأكيد
                // ------------------------------------------------

                let confirmed =
                    false;

                try {

                    await page
                        .getByText(
                            /شكرا|تم استلام|Thank you/i
                        )
                        .first()
                        .waitFor({
                            timeout: 3500
                        });

                    confirmed =
                        true;

                } catch {

                    confirmed =
                        false;
                }

                if (
                    confirmed
                ) {

                    console.log(
                        `✅ تم إرسال الفعالية (ID: ${event.id}) بنجاح.`
                    );

                } else {

                    console.log(
                        `⚠️ لم تظهر صفحة الشكر للفعالية (ID: ${event.id}).`
                    );
                }

            } catch (err) {

                console.error(
                    `❌ خطأ أثناء رفع الفعالية (ID: ${event.id}):`,
                    err?.message || err
                );

            } finally {

                await page.close();

                await sleep(500);
            }
        }

    } finally {

        await browser.close();
    }

    console.log('');
    console.log(
        '========================================'
    );

    console.log(
        '🏁 تم الانتهاء من رفع جميع الفعاليات.'
    );

    console.log(
        '========================================'
    );
}


// ============================================================
// 🧹 إغلاق البرنامج
// ============================================================

async function shutdown(
    code = 0
) {

    console.log('');
    console.log(
        '🧹 جاري إغلاق الاتصالات...'
    );

    try {

        if (socket) {

            try {
                socket.disconnect();
            } catch {}
        }

        try {

            service.websocket.socket =
                null;

        } catch {}

        try {

            await closeSessionBrowser();

        } catch {}

    } catch (err) {

        console.error(
            '⚠️ خطأ أثناء الإغلاق:',
            err?.message || err
        );
    }

    process.exit(
        code
    );
}


// ============================================================
// 🚀 MAIN
// ============================================================

async function main() {

    console.log('');
    console.log(
        '========================================'
    );

    console.log(
        '🐺 WOLF Event → Typeform Bot'
    );

    console.log(
        '========================================'
    );

    console.log(
        `🏠 GROUP: ${TARGET_GROUP}`
    );

    console.log(
        `📅 TARGET DATE: ${TARGET_DATE}`
    );

    console.log(
        `👤 TARGET MEMBER: ${TARGET_MEMBER_ID}`
    );

    console.log(
        `🔢 MEMBERSHIP: ${MEMBERSHIP_NUMBER}`
    );

    console.log(
        '========================================'
    );

    try {

        // --------------------------------------------------------
        // 1. الاتصال عن طريق Chrome Profile
        // --------------------------------------------------------

        await connectToWolf();

        // --------------------------------------------------------
        // 2. جلب الفعاليات
        // --------------------------------------------------------

        const events =
            await findTargetEvents();

        // --------------------------------------------------------
        // 3. رفعها إلى Typeform
        // --------------------------------------------------------

        await submitEventsToForm(
            events
        );

        // --------------------------------------------------------
        // نجاح
        // --------------------------------------------------------

        console.log('');
        console.log(
            '========================================'
        );

        console.log(
            '✅ اكتملت جميع المهام بنجاح.'
        );

        console.log(
            '========================================'
        );

        await sleep(1000);

        await shutdown(
            0
        );

    } catch (err) {

        console.error('');
        console.error(
            '========================================'
        );

        console.error(
            '❌ حدث خطأ رئيسي:'
        );

        console.error(
            err?.stack ||
            err?.message ||
            err
        );

        console.error(
            '========================================'
        );

        await shutdown(
            1
        );
    }
}


// ============================================================
// ▶️ START
// ============================================================

main();
