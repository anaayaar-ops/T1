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

// ==================== ⚙️ البيانات الثابتة (عدّل حسب حاجتك) ====================
const GROUP_ID = 18432094;
const TARGET_DATE = "2026-09-14";           // التاريخ المطلوب (YYYY-MM-DD)
const TARGET_MEMBER_ID = 80055399;          // العضوية التي رفعت الفعالية
const MEMBERSHIP_NUMBER = "224";            // رقم عضويتك الأساسي في النموذج
const FORM_URL = "https://survey-poll.typeform.com/to/JTsKMIEB";
const TYPE_DELAY = 40;                      // تأخير بين الأحرف (مللي)
// =============================================================================

// ============================================================
// متغيرات الاتصال
// ============================================================

let service = null;
let socket = null;
let browserClosed = false;

// ============================================================
// أدوات مساعدة
// ============================================================

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

function formatTime(date) {

    const h = date.getUTCHours();

    const m = String(date.getUTCMinutes())
        .padStart(2, '0');

    const ampm = h >= 12 ? 'PM' : 'AM';

    return `${h % 12 || 12}:${m} ${ampm}`;
}

// ============================================================
// إغلاق آمن
// ============================================================

async function shutdown(code = 0) {

    console.log('');
    console.log('========================================');
    console.log('🛑 جاري إنهاء التشغيل...');
    console.log('========================================');

    try {

        if (socket) {
            socket.disconnect();
        }

    } catch {}

    try {

        if (service?.websocket?.socket) {
            service.websocket.socket.disconnect();
        }

    } catch {}

    try {

        if (!browserClosed) {

            browserClosed = true;

            await closeSessionBrowser();
        }

    } catch (err) {

        console.log(
            '⚠️ تعذر إغلاق جلسة Chrome:',
            err?.message || err
        );

    }

    console.log(
        `🏁 انتهى البرنامج — Code ${code}`
    );

    process.exit(code);
}

// ============================================================
// انتظار Authorization
// ============================================================

async function waitForSubscriber(
    timeoutMs = 60000
) {

    const started =
        Date.now();

    console.log(
        '⏳ انتظار Authorization...'
    );

    while (
        Date.now() - started <
        timeoutMs
    ) {

        if (
            service?.currentSubscriber?.id
        ) {

            console.log('');
            console.log('========================================');
            console.log('✅ Authorization complete');
            console.log('========================================');

            console.log(
                `👤 الحساب: ${
                    service.currentSubscriber.username ||
                    service.currentSubscriber.nickname ||
                    'غير معروف'
                }`
            );

            console.log(
                `🆔 ID: ${
                    service.currentSubscriber.id
                }`
            );

            return true;
        }

        await sleep(500);
    }

    return false;
}

// ============================================================
// تهيئة WOLF Handlers
// ============================================================

async function initializeHandlers() {

    console.log(
        '⚙️ تهيئة WOLF handlers...'
    );

    await service.websocket.init();

    const count =
        Object.keys(
            service.websocket.handlers || {}
        ).length;

    console.log(
        `⚙️ تم تحميل ${count} handlers`
    );
}

// ============================================================
// الاتصال باستخدام Google Chrome Profile
// ============================================================

async function connectUsingChromeProfile(
    credentials
) {

    const token =
        credentials?.token;

    const appCheckToken =
        credentials?.appCheckToken || '';

    const device =
        credentials?.device || 'web';

    const isAppCheckEnabled =
        Boolean(
            credentials?.isAppCheckEnabled ??
            appCheckToken
        );

    if (!token) {

        throw new Error(
            'لم يتم العثور على v3APIToken في Google Chrome Profile.'
        );
    }

    console.log('');
    console.log('========================================');
    console.log('🔐 بيانات جلسة Chrome');
    console.log('========================================');

    console.log(
        `🔐 WOLF Token length: ${token.length}`
    );

    console.log(
        appCheckToken
            ? `🛡️ AppCheck length: ${appCheckToken.length}`
            : '⚠️ AppCheck Token غير موجود'
    );

    console.log(
        `📱 Device: ${device}`
    );

    console.log(
        `🛡️ App Check: ${
            isAppCheckEnabled
                ? 'enabled'
                : 'disabled'
        }`
    );

    console.log('========================================');

    // ========================================================
    // إنشاء WOLF
    // ========================================================

    service = new WOLF();

    service.config.framework.login.token =
        token;

    service.config.framework.login.onlineState =
        OnlineState.INVISIBLE;

    if (appCheckToken) {

        service.config.framework.login.appCheckToken =
            appCheckToken;
    }

    // ========================================================
    // تهيئة Handlers
    // ========================================================

    await initializeHandlers();

    // ========================================================
    // إعداد الاتصال
    // ========================================================

    const connection =
        service._frameworkConfig?.get?.(
            'connection'
        );

    const host =
        connection?.host ||
        'https://v3-rc.palringo.com';

    const port =
        connection?.port ?? 443;

    const connectionDevice =
        connection?.query?.device ||
        device ||
        'web';

    console.log('');
    console.log('========================================');
    console.log('🔌 بدء اتصال WOLF');
    console.log('========================================');

    console.log(
        `🌐 Host: ${host}`
    );

    console.log(
        `🔌 Port: ${port}`
    );

    console.log(
        `📱 Device: ${connectionDevice}`
    );

    // ========================================================
    // Socket.IO
    // ========================================================

    socket =
        io(
            `${host}:${port}`,
            {
                transports: [
                    'websocket'
                ],

                reconnection: true,

                autoConnect: false,

                query: {

                    token,

                    device:
                        connectionDevice,

                    state:
                        service.config.framework
                            .login.onlineState,

                    version:
                        connection?.version ||
                        undefined,

                    isAppCheckEnabled:
                        isAppCheckEnabled
                            ? 'true'
                            : 'false',

                    appCheckToken:
                        isAppCheckEnabled
                            ? appCheckToken
                            : undefined
                }
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
            console.log('========================================');
            console.log(
                '🔗 تم الاتصال بـ WOLF Socket.IO'
            );
            console.log(
                `🔗 Connection ID: ${socket.id}`
            );
            console.log('========================================');

        }
    );

    // ========================================================
    // Connection error
    // ========================================================

    socket.on(
        'connect_error',
        error => {

            console.error(
                '❌ Connection error:',
                error?.message || error
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
    // تمرير أحداث WOLF إلى Handlers
    // ========================================================

    socket.onAny(
        async (
            eventName,
            data
        ) => {

            try {

                if (
                    eventName ===
                    'group event update'
                ) {

                    return;
                }

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
                    error?.message || error
                );

            }

        }
    );

    // ========================================================
    // الاتصال
    // ========================================================

    console.log(
        '🔌 Connecting...'
    );

    socket.connect();

    // ========================================================
    // انتظار Authorization
    // ========================================================

    const ready =
        await waitForSubscriber(
            60000
        );

    if (!ready) {

        throw new Error(
            'WOLF اتصل لكن Authorization لم يكتمل.'
        );
    }

    console.log('');
    console.log(
        '🟢 WOLF جاهز للفعاليات.'
    );
}

// ============================================================
// جلب فعاليات اليوم المستهدف الخاصة بالعضوية المستهدفة
// ============================================================

async function getTargetDayEvents() {

    console.log('');
    console.log(
        '🔍 جاري جلب فعاليات الروم...'
    );

    console.log(
        `🏠 GROUP_ID: ${GROUP_ID}`
    );

    console.log(
        `📅 TARGET_DATE: ${TARGET_DATE}`
    );

    console.log(
        `👤 TARGET_MEMBER_ID: ${TARGET_MEMBER_ID}`
    );

    try {

        console.log(
            '📡 إرسال GROUP_EVENT_LIST...'
        );

        const timeoutPromise =
            new Promise((_, reject) => {

                setTimeout(() => {

                    reject(
                        new Error(
                            'انتهت مهلة جلب قائمة الفعاليات بعد 30 ثانية.'
                        )
                    );

                }, 30000);

            });

        const requestPromise =
            service.websocket.emit(
                Command.GROUP_EVENT_LIST,
                {
                    id: Number(GROUP_ID),
                    languageId: 1,
                    subscribe: true,
                    offset: 0,
                    limit:
                        service._frameworkConfig
                            ?.batching
                            ?.length || 100
                }
            );

        const listResponse =
            await Promise.race([
                requestPromise,
                timeoutPromise
            ]);

        if (!listResponse?.success) {

            console.log(
                '❌ فشل جلب قائمة الفعاليات.'
            );

            console.log(
                JSON.stringify(
                    listResponse,
                    null,
                    2
                )
            );

            return [];
        }

        const body =
            Array.isArray(listResponse.body)
                ? listResponse.body
                : [];

        console.log(
            `📋 تم جلب ${body.length} فعالية من الروم.`
        );

        // ====================================================
        // فلترة حسب التاريخ (بتوقيت السعودية UTC+3)
        // ====================================================

        const dayEventIds = [];

        for (const ev of body) {

            const info =
                ev.additionalInfo || {};

            const startTimeStr =
                info.startsAt ||
                ev.startsAt;

            if (!startTimeStr) {
                continue;
            }

            const startTime =
                new Date(startTimeStr);

            const ksaStart =
                new Date(
                    startTime.getTime() +
                    (3 * 60 * 60 * 1000)
                );

            const dateStr =
                `${ksaStart.getUTCFullYear()}-` +
                `${String(
                    ksaStart.getUTCMonth() + 1
                ).padStart(2, '0')}-` +
                `${String(
                    ksaStart.getUTCDate()
                ).padStart(2, '0')}`;

            if (dateStr !== TARGET_DATE) {
                continue;
            }

            dayEventIds.push({
                id: ev.id,
                dateStr,
                start: ksaStart
            });
        }

        if (!dayEventIds.length) {

            console.log(
                'ℹ️ لا توجد فعاليات في هذا التاريخ.'
            );

            return [];
        }

        console.log(
            `🔎 جاري جلب تفاصيل ${dayEventIds.length} فعالية...`
        );

        // ====================================================
        // جلب تفاصيل الفعاليات وفلترة حسب منشئ الفعالية
        // ====================================================

        const fullEvents =
            await service.event.getByIds(
                dayEventIds.map(e => e.id),
                true
            );

        const foundEvents = [];

        (Array.isArray(fullEvents)
            ? fullEvents
            : []
        ).forEach(fullEv => {

            const meta =
                dayEventIds.find(
                    e => e.id === fullEv.id
                );

            if (!meta) {
                return;
            }

            if (
                fullEv.createdBy !== null &&
                parseInt(fullEv.createdBy, 10) ===
                    TARGET_MEMBER_ID
            ) {

                foundEvents.push({
                    id: fullEv.id,
                    dateStr: meta.dateStr,
                    timeStr:
                        formatTime(meta.start),
                    start: meta.start
                });
            }
        });

        foundEvents.sort(
            (a, b) => a.start - b.start
        );

        console.log(
            `✅ تم العثور على ${foundEvents.length} فعالية مطابقة.`
        );

        return foundEvents;

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
// أدوات Typeform (Playwright)
// ============================================================

const typeReal = async (page, value, { pressEnterAfter = false } = {}) => {
    await page.keyboard.type(String(value), { delay: TYPE_DELAY });
    if (pressEnterAfter) {
        await page.waitForTimeout(200);
        await page.keyboard.press('Enter');
    }
};

const fillActiveQuestion = async (page, value, { pressEnterAfter = true, waitAfter = 500 } = {}) => {
    try {
        await page.waitForFunction(() => {
            const el = document.activeElement;
            return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
        }, { timeout: 5000 });
        const active = page.locator('input:focus, textarea:focus').first();
        await active.waitFor({ state: 'visible', timeout: 5000 });
    } catch (e) {
        console.log('⚠️ لم يتم رصد فوكس تلقائي، أحاول أضغط على آخر حقل ظاهر...');
        const fallback = page.locator('input:visible, textarea:visible').last();
        await fallback.click({ timeout: 5000 });
    }
    await typeReal(page, value);
    if (pressEnterAfter) {
        await page.waitForTimeout(200);
        await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(waitAfter);
};

const clickOkButton = async (page) => {
    try {
        const okButton = page.getByRole('button', { name: /^OK$/i }).first();
        await okButton.click({ timeout: 3000 });
        return true;
    } catch (e) {
        return false;
    }
};

// ============================================================
// رفع الفعاليات إلى نموذج Typeform
// ============================================================

async function submitEventsToForm(events) {

    if (events.length === 0) {
        console.log("⚠️ لا توجد فعاليات مطابقة في هذا التاريخ ليتم رفعها.");
        return;
    }

    console.log(`\n🚀 تم العثور على (${events.length}) فعالية. بدء الرفع التلقائي للنموذج...`);

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox']
    });

    const context = await browser.newContext();
    const topicLetters = ['A', 'B', 'C'];

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const currentLetter = topicLetters[i % topicLetters.length];
        const [year, month, day] = event.dateStr.split('-');

        const page = await context.newPage();
        console.log(`\n----------------------------------------`);
        console.log(`[رفع الفعالية ${i + 1} من ${events.length}] 🆔 ID: ${event.id} | ⏰ الوقت: ${event.timeStr}`);

        try {
            console.log('  ↳ [الخطوة 0] فتح صفحة النموذج...');
            await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(600);

            try {
                const startButton = page.getByText('سجل برنامجك الآن', { exact: false });
                await startButton.waitFor({ timeout: 3000 });
                await startButton.click();
                await page.waitForTimeout(400);
            } catch (e) {}

            console.log('  ↳ [الخطوة 1] رقم العضوية...');
            await fillActiveQuestion(page, MEMBERSHIP_NUMBER);

            console.log('  ↳ [الخطوة 2] رقم عضوية القناة...');
            await fillActiveQuestion(page, String(GROUP_ID));

            console.log('  ↳ [الخطوة 3] الثيم الأسبوعي (نعم)...');
            try {
                const option = page.getByText('نعم', { exact: false }).first();
                await option.click();
            } catch (e) {
                await page.keyboard.press('a');
            }
            await page.waitForTimeout(400);

            console.log(`  ↳ [الخطوة 4] اختيار المواضيع (الحرف ${currentLetter})...`);
            try {
                const badge = page.getByText(currentLetter.toUpperCase(), { exact: true }).first();
                await badge.click({ timeout: 3000 });
            } catch (e) {
                await page.keyboard.press(currentLetter.toLowerCase());
            }
            await page.waitForTimeout(300);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(400);

            console.log('  ↳ [الخطوة 5] تاريخ الفعالية...');
            const clickAndType = async (placeholder, value) => {
                try {
                    const input = page.getByPlaceholder(placeholder).first();
                    await input.click({ timeout: 3000 });
                    await page.keyboard.press('Control+A');
                    await page.keyboard.press('Backspace');
                    await typeReal(page, value);
                    await page.waitForTimeout(200);
                    const actual = await input.inputValue().catch(() => null);
                    if (!actual || !actual.includes(String(parseInt(value, 10)))) {
                        console.log(`⚠️ حقل "${placeholder}" لم يُعبأ بشكل صحيح، أعيد المحاولة...`);
                        await input.click({ timeout: 3000 });
                        await page.keyboard.press('Control+A');
                        await page.keyboard.press('Backspace');
                        await typeReal(page, value);
                        await page.waitForTimeout(200);
                    }
                    return true;
                } catch (e) {
                    console.log(`⚠️ لم يتم إيجاد حقل placeholder="${placeholder}"`);
                    return false;
                }
            };

            await clickAndType('MM', month);
            await page.waitForTimeout(250);
            await clickAndType('DD', day);
            await page.waitForTimeout(250);
            await clickAndType('YYYY', year);
            await page.waitForTimeout(250);

            const okClicked = await clickOkButton(page);
            if (!okClicked) {
                console.log('⚠️ لم أجد زر OK، أضغط Enter...');
                await page.keyboard.press('Enter');
            }
            await page.waitForTimeout(500);

            console.log('  ↳ [الخطوة 6] وقت الفعالية...');
            await fillActiveQuestion(page, event.timeStr);

            console.log('  ↳ [الخطوة 7] معرف الفعالية (ID)...');
            await fillActiveQuestion(page, String(event.id), { pressEnterAfter: false, waitAfter: 300 });

            console.log('  ↳ [الإرسال النهائي] Ctrl+Enter...');
            await page.keyboard.press('Control+Enter');
            await page.waitForTimeout(800);

            try {
                const submitEl = page.getByText('Submit', { exact: true }).first();
                await submitEl.click({ force: true });
                await page.waitForTimeout(500);
            } catch (e) {}

            let confirmed = false;
            try {
                await page.getByText(/شكرا|تم استلام|Thank you/i).first().waitFor({ timeout: 3500 });
                confirmed = true;
            } catch (e) {}

            if (confirmed) {
                console.log(`✅ تم إرسال الفعالية (ID: ${event.id}) بنجاح.`);
            } else {
                console.log(`⚠️ لم تظهر صفحة الشكر للفعالية (ID: ${event.id}).`);
            }
        } catch (err) {
            console.error(`❌ خطأ أثناء رفع الفعالية (ID: ${event.id}):`, err.message);
        } finally {
            await page.close();
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    await browser.close();
    console.log(`\n========================================`);
    console.log('🏁 تم الانتهاء من رفع جميع الفعاليات.');
    console.log(`========================================\n`);
}

// ============================================================
// البرنامج الرئيسي
// ============================================================

async function main() {

    console.log('');
    console.log('========================================');
    console.log('🐺 WOLF Events → Typeform');
    console.log('🐺 wolf.js 2.7.10');
    console.log('========================================');
    console.log('');

    try {

        // ====================================================
        // 1. قراءة Google Chrome Profile
        // ====================================================

        console.log(
            '🌐 قراءة جلسة WOLF من Chrome Profile...'
        );

        const credentials =
            await loadSession();

        if (!credentials?.token) {

            throw new Error(
                'لم يتم العثور على v3APIToken في جلسة Chrome.'
            );
        }

        console.log(
            '✅ تم العثور على توكن WOLF'
        );

        if (credentials.appCheckToken) {

            console.log(
                `🛡️ AppCheck length: ${
                    credentials.appCheckToken.length
                }`
            );

            console.log(
                '✅ تم العثور على App Check Token'
            );

        } else {

            console.log(
                '⚠️ لا يوجد App Check Token'
            );
        }

        console.log(
            `📱 Device: ${
                credentials.device || 'web'
            }`
        );

        // ====================================================
        // 2. الاتصال باستخدام Chrome Profile
        // ====================================================

        await connectUsingChromeProfile(
            credentials
        );

        // ====================================================
        // 3. جلب فعاليات اليوم المستهدف
        // ====================================================

        const foundEvents =
            await getTargetDayEvents();

        console.log(
            `\n📋 تم العثور على ${foundEvents.length} فعالية مطابقة.`
        );

        // ====================================================
        // 4. رفعها إلى نموذج Typeform
        // ====================================================

        await submitEventsToForm(
            foundEvents
        );

        // ====================================================
        // 5. النهاية
        // ====================================================

        console.log('');
        console.log('========================================');
        console.log('🎉 اكتملت العملية');
        console.log('========================================');

        await sleep(1000);

        await shutdown(0);

    } catch (err) {

        console.error('');
        console.error('========================================');
        console.error('❌ حصل خطأ');
        console.error('========================================');

        console.error(
            err?.stack ||
            err?.message ||
            err
        );

        await shutdown(1);
    }
}

// ============================================================
// إيقاف
// ============================================================

process.on('SIGINT', async () => {
    await shutdown(0);
});

process.on('SIGTERM', async () => {
    await shutdown(0);
});

// ============================================================
// START
// ============================================================

main();
