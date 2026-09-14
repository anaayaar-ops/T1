import fs from 'fs';
import sharp from 'sharp';
import wolfjs from 'wolf.js';

import {
    loadSession,
    closeSessionBrowser
} from './session-loader.js';

const { WOLF, OnlineState } = wolfjs;

// ============================================================
// الإعدادات
// ============================================================

const GROUP_ID = 66266;

const EVENT_NAME = " ᷂فعاليآت ᷂خليجنا،ذوق.";

const TOTAL_EVENTS = 32;

const EVENT_DURATION_MIN = 45;

const IMAGE_PATH = './178332617173751.jpeg';

// 16 سبتمبر 2026 - الساعة 9:00 مساءً بتوقيت السعودية
const START_TIME = new Date('2026-09-16T21:00:00+03:00');

// ============================================================
// أدوات مساعدة
// ============================================================

const sleep = (ms) =>
    new Promise(resolve => setTimeout(resolve, ms));

function formatAMPM(date) {
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');

    const ampm = hours >= 12 ? 'pm' : 'am';

    hours = hours % 12 || 12;

    return `${hours}:${minutes}${ampm}`;
}

function formatDate(date) {
    return date.toLocaleString('ar-SA', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

// ============================================================
// تنظيف وإغلاق آمن
// ============================================================

let service = null;
let browserClosed = false;

async function shutdown(code = 0) {
    console.log('');
    console.log('🛑 جاري إنهاء التشغيل...');

    try {
        if (service?.websocket?.socket) {
            try {
                service.websocket.socket.disconnect();
            } catch {}
        }
    } catch {}

    try {
        if (!browserClosed) {
            browserClosed = true;
            await closeSessionBrowser();
        }
    } catch (err) {
        console.log('⚠️ تعذر إغلاق جلسة Chrome:', err.message);
    }

    console.log(`🏁 انتهى البرنامج — Code ${code}`);

    process.exit(code);
}

// ============================================================
// تحميل الصورة
// ============================================================

async function prepareThumbnail() {
    if (!fs.existsSync(IMAGE_PATH)) {
        throw new Error(`الصورة غير موجودة: ${IMAGE_PATH}`);
    }

    console.log(`🖼️ تجهيز الصورة: ${IMAGE_PATH}`);

    const buffer = await sharp(IMAGE_PATH)
        .jpeg({ quality: 90 })
        .toBuffer();

    console.log(`✅ تم تجهيز الصورة (${buffer.length} bytes)`);

    return buffer;
}

// ============================================================
// انتظار جاهزية WOLF
// ============================================================

async function waitForSubscriber(timeoutMs = 30000) {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
        if (service?.currentSubscriber?.id) {
            return true;
        }

        await sleep(500);
    }

    return false;
}

// ============================================================
// جلب الفعاليات الموجودة بالطريقة الصحيحة في wolf.js 2.7.10
// ============================================================

async function getExistingEvents() {
    console.log('');
    console.log('🔍 جاري جلب فعاليات الروم بالطريقة الرسمية...');
    console.log(`🏠 GROUP_ID: ${GROUP_ID}`);

    /*
     * في wolf.js 2.7.10:
     *
     * service.event.group
     *       ↓
     * Channel.getList()
     *
     * Channel.getList() يقوم داخليًا بإرسال:
     *
     * group event list
     * {
     *   id,
     *   subscribe,
     *   offset,
     *   limit
     * }
     *
     * ثم يستخدم event.getByIds()
     */

    const events = await service.event.group.getList(
        GROUP_ID,
        true,
        true
    );

    if (!Array.isArray(events)) {
        console.log('⚠️ نتيجة قائمة الفعاليات ليست Array.');
        console.log(events);

        return [];
    }

    console.log(`✅ تم جلب ${events.length} فعالية موجودة.`);

    return events;
}

// ============================================================
// استخراج وقت الفعالية
// ============================================================

function getEventStart(event) {
    if (!event) return NaN;

    if (event.startsAt instanceof Date) {
        return event.startsAt.getTime();
    }

    return new Date(event.startsAt).getTime();
}

function getEventEnd(event) {
    if (!event) return NaN;

    if (event.endsAt instanceof Date) {
        return event.endsAt.getTime();
    }

    return new Date(event.endsAt).getTime();
}

// ============================================================
// فحص التعارض
// ============================================================

function findConflict(existingEvents, startTime, endTime) {
    return existingEvents.find(event => {
        const eStart = getEventStart(event);
        const eEnd = getEventEnd(event);

        if (!Number.isFinite(eStart) || !Number.isFinite(eEnd)) {
            return false;
        }

        return (
            startTime.getTime() < eEnd &&
            endTime.getTime() > eStart
        );
    });
}

// ============================================================
// إنشاء الفعاليات
// ============================================================

async function createEvents(existingEvents) {
    const createdEventIds = [];

    let startTime = new Date(START_TIME);

    console.log('');
    console.log('========================================');
    console.log('🚀 بدء إنشاء الفعاليات');
    console.log('========================================');

    console.log(`📅 البداية: ${formatDate(startTime)}`);
    console.log(`⏱️ مدة كل فعالية: ${EVENT_DURATION_MIN} دقيقة`);
    console.log(`🔢 العدد المطلوب: ${TOTAL_EVENTS}`);
    console.log('');

    for (let i = 0; i < TOTAL_EVENTS; i++) {
        const endTime = new Date(
            startTime.getTime() +
            EVENT_DURATION_MIN * 60 * 1000
        );

        const number = i + 1;

        console.log(
            `\n[${number}/${TOTAL_EVENTS}] ` +
            `${formatDate(startTime)} → ${formatDate(endTime)}`
        );

        const conflict = findConflict(
            existingEvents,
            startTime,
            endTime
        );

        if (conflict) {
            console.log('⚠️ يوجد تعارض — تم تجاوز الفترة.');

            if (conflict.id) {
                console.log(`   ↳ Event ID: ${conflict.id}`);
            }

            if (conflict.startsAt && conflict.endsAt) {
                console.log(
                    `   ↳ ${formatDate(new Date(conflict.startsAt))}` +
                    ` → ${formatDate(new Date(conflict.endsAt))}`
                );
            }
        } else {
            try {
                /*
                 * API الرسمية الموجودة في:
                 *
                 * src/helper/event/Channel.js
                 *
                 * create(targetChannelId, {...})
                 */

                const response = await service.event.group.create(
                    GROUP_ID,
                    {
                        title: EVENT_NAME,
                        startsAt: startTime,
                        endsAt: endTime
                    }
                );

                /*
                 * create() في wolf.js 2.7.10 يعيد:
                 *
                 * response
                 *
                 * وليس الاستجابة القديمة التي كنا نرسلها يدويًا.
                 */

                if (response?.success) {
                    const eventId = response.body?.id;

                    if (eventId) {
                        createdEventIds.push(
                            parseInt(eventId, 10)
                        );

                        console.log(
                            `✅ تم إنشاء الفعالية` +
                            ` | ID: ${eventId}` +
                            ` | الوقت: ${formatAMPM(startTime)}`
                        );

                        /*
                         * نضيفها لقائمة الفعاليات حتى لا يحصل
                         * تعارض إذا كانت هناك أي معالجة لاحقة.
                         */
                        existingEvents.push({
                            id: parseInt(eventId, 10),
                            startsAt: new Date(startTime),
                            endsAt: new Date(endTime),
                            title: EVENT_NAME
                        });
                    } else {
                        console.log(
                            '⚠️ تم الإنشاء لكن لم يتم العثور على Event ID.'
                        );

                        console.log(
                            JSON.stringify(response, null, 2)
                        );
                    }
                } else {
                    console.log('❌ فشل إنشاء الفعالية.');

                    console.log(
                        JSON.stringify(response, null, 2)
                    );
                }
            } catch (err) {
                console.error(
                    `❌ خطأ في إنشاء الفعالية رقم ${number}:`,
                    err?.message || err
                );
            }
        }

        /*
         * الانتقال إلى الفترة التالية
         */
        startTime = new Date(endTime.getTime());

        /*
         * تأخير بسيط حتى لا نرسل الطلبات بسرعة كبيرة.
         */
        await sleep(700);
    }

    console.log('');
    console.log('========================================');
    console.log(`📊 تم إنشاء ${createdEventIds.length} من ${TOTAL_EVENTS}`);
    console.log('========================================');

    return createdEventIds;
}

// ============================================================
// رفع الصور
// ============================================================

async function uploadThumbnails(eventIds, thumbnailBuffer) {
    if (!eventIds.length) {
        console.log('');
        console.log('ℹ️ لا توجد فعاليات جديدة لرفع الصور لها.');
        return;
    }

    console.log('');
    console.log('========================================');
    console.log('🖼️ رفع صور الفعاليات');
    console.log('========================================');

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < eventIds.length; i++) {
        const eventId = eventIds[i];

        try {
            console.log(
                `🖼️ [${i + 1}/${eventIds.length}] ` +
                `رفع صورة ID ${eventId}...`
            );

            /*
             * API الرسمية في wolf.js 2.7.10:
             *
             * service.event.group.updateThumbnail()
             */
            const response =
                await service.event.group.updateThumbnail(
                    parseInt(eventId, 10),
                    thumbnailBuffer
                );

            if (response?.success) {
                successCount++;

                console.log(
                    `✅ تم رفع الصورة للفعالية ${eventId}`
                );
            } else {
                failedCount++;

                console.log(
                    `⚠️ فشل رفع صورة ${eventId}`
                );

                console.log(
                    JSON.stringify(response, null, 2)
                );
            }
        } catch (err) {
            failedCount++;

            console.error(
                `❌ خطأ برفع صورة ID ${eventId}:`,
                err?.message || err
            );
        }

        /*
         * تأخير بين رفع الصور
         */
        await sleep(800);
    }

    console.log('');
    console.log('========================================');
    console.log('🖼️ نتيجة رفع الصور');
    console.log(`✅ ناجح: ${successCount}`);
    console.log(`❌ فاشل: ${failedCount}`);
    console.log('========================================');
}

// ============================================================
// البرنامج الرئيسي
// ============================================================

async function main() {
    console.log('');
    console.log('========================================');
    console.log('🐺 WOLF Event Creator');
    console.log('🐺 wolf.js 2.7.10');
    console.log('========================================');
    console.log('');

    try {
        // --------------------------------------------------------
        // 1. تحميل جلسة Chrome
        // --------------------------------------------------------

        console.log('🌐 قراءة جلسة WOLF من Chrome Profile...');

        const credentials = await loadSession();

        if (!credentials?.token) {
            throw new Error(
                'لم يتم العثور على v3APIToken في جلسة Chrome.'
            );
        }

        console.log('✅ تم العثور على توكن WOLF');

        if (credentials.appCheckToken) {
            console.log('🛡️ تم العثور على App Check Token');
        } else {
            console.log('⚠️ لا يوجد App Check Token');
        }

        // --------------------------------------------------------
        // 2. إنشاء خدمة WOLF
        // --------------------------------------------------------

        service = new WOLF();

        // --------------------------------------------------------
        // 3. إعداد التوكن
        // --------------------------------------------------------

        service.config.framework.login.token =
            credentials.token;

        /*
         * نخلي الحساب Invisible أثناء التشغيل.
         */
        if (typeof OnlineState !== 'undefined') {
            service.config.framework.login.onlineState =
                OnlineState.INVISIBLE;
        }

        /*
         * App Check إذا كان موجودًا.
         */
        if (credentials.appCheckToken) {
            service.config.framework.login.appCheckToken =
                credentials.appCheckToken;
        }

        // --------------------------------------------------------
        // 4. انتظار ready
        // --------------------------------------------------------

        let readyResolve;
        let readyReject;

        const readyPromise = new Promise((resolve, reject) => {
            readyResolve = resolve;
            readyReject = reject;
        });

        const readyTimeout = setTimeout(() => {
            readyReject(
                new Error(
                    'انتهت مهلة انتظار WOLF ready.'
                )
            );
        }, 60000);

        service.once('ready', () => {
            clearTimeout(readyTimeout);

            console.log('');
            console.log('========================================');
            console.log('✅ WOLF جاهز');
            console.log('========================================');

            console.log(
                `👤 الحساب: ${
                    service.currentSubscriber?.nickname || 'غير معروف'
                }`
            );

            console.log(
                `🆔 ID: ${
                    service.currentSubscriber?.id || 'غير معروف'
                }`
            );

            readyResolve();
        });

        // --------------------------------------------------------
        // 5. معالجة أخطاء الخدمة
        // --------------------------------------------------------

        service.on('error', err => {
            console.error(
                '❌ WOLF Error:',
                err?.message || err
            );
        });

        // --------------------------------------------------------
        // 6. تسجيل الدخول
        // --------------------------------------------------------

        console.log('🔌 بدء اتصال WOLF...');

        /*
         * بما أن التوكن مأخوذ من جلسة Chrome،
         * لا نستخدم U_MAIL / U_PASS.
         */
        await service.login();

        // --------------------------------------------------------
        // 7. انتظار ready
        // --------------------------------------------------------

        await readyPromise;

        const subscriberReady =
            await waitForSubscriber(30000);

        if (!subscriberReady) {
            throw new Error(
                'WOLF اتصل لكن currentSubscriber غير جاهز.'
            );
        }

        console.log('✅ currentSubscriber جاهز');

        // --------------------------------------------------------
        // 8. تجهيز الصورة
        // --------------------------------------------------------

        const thumbnailBuffer =
            await prepareThumbnail();

        // --------------------------------------------------------
        // 9. جلب الفعاليات الحالية
        // --------------------------------------------------------

        const existingEvents =
            await getExistingEvents();

        // --------------------------------------------------------
        // 10. إنشاء الفعاليات
        // --------------------------------------------------------

        const createdEventIds =
            await createEvents(existingEvents);

        // --------------------------------------------------------
        // 11. رفع الصور
        // --------------------------------------------------------

        await uploadThumbnails(
            createdEventIds,
            thumbnailBuffer
        );

        // --------------------------------------------------------
        // 12. النهاية
        // --------------------------------------------------------

        console.log('');
        console.log('========================================');
        console.log('🎉 اكتملت العملية');
        console.log('========================================');

        console.log(
            `📅 البداية: ${formatDate(START_TIME)}`
        );

        console.log(
            `⏱️ مدة الفعالية: ${EVENT_DURATION_MIN} دقيقة`
        );

        console.log(
            `🔢 المطلوب: ${TOTAL_EVENTS}`
        );

        console.log(
            `✅ تم إنشاء: ${createdEventIds.length}`
        );

        console.log('========================================');

        await sleep(1500);

        await shutdown(0);

    } catch (err) {
        console.error('');
        console.error('========================================');
        console.error('❌ حصل خطأ');
        console.error('========================================');
        console.error(err?.stack || err?.message || err);

        await shutdown(1);
    }
}

// ============================================================
// تشغيل
// ============================================================

process.on('SIGINT', async () => {
    console.log('\n🛑 تم إيقاف البرنامج يدويًا.');
    await shutdown(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 تم إيقاف البرنامج.');
    await shutdown(0);
});

main();
