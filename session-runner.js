import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
import CDP from 'chrome-remote-interface';
import coreLib from './core/index.js';
import io from 'socket.io-client';
import fs from 'fs';
import path from 'path';

const { Client, OnlineState } = coreLib;


/*
 * ============================================================
 * الإعدادات
 * ============================================================
 */

const ROOM_ID = 66266;

const AUTHORIZED_USER_IDS = [
    51660277
];

const EXIT_COMMAND = '!كات نزول';
const ENTER_COMMAND = '!كات صعود';

const RUN_DURATION_MS =
    5 * 60 * 60 * 1000;

const CHECK_INTERVAL_MS =
    10 * 60 * 1000;

const MAX_OCCUPANTS_TO_JOIN = 1;


/*
 * ============================================================
 * حالة البوت
 * ============================================================
 */

let client;

let currentSlotId = null;

let checkIntervalHandle = null;

/*
 * true = الفحص التلقائي يعمل
 * false = الفحص التلقائي توقف نهائيًا
 */
let autoCheckEnabled = true;

let shuttingDown = false;

/*
 * يمنع بدء المراقبة أكثر من مرة
 * (مرة يدويًا بعد تسجيل الدخول، ومرة أخرى لو أُطلق حدث ready)
 */
let monitoringStarted = false;


/*
 * ============================================================
 * أدوات مساعدة
 * ============================================================
 */

function stopAutomaticChecking(reason) {

    if (!autoCheckEnabled) {
        return;
    }

    autoCheckEnabled = false;

    if (checkIntervalHandle) {

        clearInterval(
            checkIntervalHandle
        );

        checkIntervalHandle = null;
    }

    console.log(
        `🛑 تم إيقاف الفحص التلقائي نهائيًا: ${reason}`
    );
}


/*
 * ============================================================
 * قراءة جلسة الخدمة من المتصفح
 * ============================================================
 */

async function getSessionFromBrowser() {

    /*
     * =========================================================
     * أولوية القراءة من متغيرات البيئة (GitHub Secrets)
     *
     * إذا كان التشغيل عبر GitHub Actions، سيتم تمرير هاتين
     * القيمتين كمتغيرات بيئة (SVC_API_TOKEN, SVC_APP_CHECK_TOKEN)
     * بدلًا من قراءتهما من Chrome المحلي — الذي لن يكون متاحًا
     * على السيرفر أصلًا.
     * =========================================================
     */

    if (
        process.env.SVC_API_TOKEN &&
        process.env.SVC_APP_CHECK_TOKEN
    ) {

        console.log(
            '[SVC] Using tokens from environment variables (GitHub Secrets).'
        );

        return {
            v3APIToken: process.env.SVC_API_TOKEN,
            appCheckToken: process.env.SVC_APP_CHECK_TOKEN
        };
    }

    let browser;

    try {

        console.log(
            '[SVC] No environment tokens found — reading existing Chrome session...'
        );

        browser = await CDP({
            host: '127.0.0.1',
            port: 9222
        });


        const targets =
            await browser.Target.getTargets();


        const pageTarget =
            targets.targetInfos.find(
                target =>
                    target.type === 'page' &&
                    target.url.includes(
                        ['app', 'wolf', 'live'].join('.')
                    )
            );


        if (!pageTarget) {

            throw new Error(
                'Target browser tab was not found.'
            );
        }


        console.log(
            '[SVC] Target tab found.'
        );


        const tab = await CDP({
            host: '127.0.0.1',
            port: 9222,
            target: pageTarget.targetId
        });


        await tab.Runtime.enable();


        const result =
            await tab.Runtime.evaluate({

                expression: `({
                    v3APIToken: localStorage.getItem('v3APIToken'),
                    appCheckToken: localStorage.getItem('appCheckToken')
                })`,

                returnByValue: true
            });


        await tab.close();


        const session =
            result?.result?.value;


        if (!session?.v3APIToken) {

            throw new Error(
                'v3APIToken was not found in local session storage.'
            );
        }


        if (!session?.appCheckToken) {

            throw new Error(
                'appCheckToken was not found in local session storage.'
            );
        }


        console.log(
            `[SVC] v3APIToken : exists (${session.v3APIToken.length} chars)`
        );


        console.log(
            `[SVC] appCheckToken: exists (${session.appCheckToken.length} chars)`
        );


        return session;

    } finally {

        if (browser) {

            try {
                await browser.close();
            } catch {}
        }
    }
}


/*
 * ============================================================
 * الاتصال باستخدام جلسة المتصفح
 * ============================================================
 */

async function loginWithChromeSession() {

    const session =
        await getSessionFromBrowser();


    console.log(
        '[SVC] Initializing library handlers...'
    );


    client.config.framework.login.token =
        session.v3APIToken;


    await client.websocket.init();


    console.log(
        `[SVC] Loaded ${Object.keys(client.websocket.handlers).length} socket handlers.`
    );


    const connectionConfig =
        client._frameworkConfig.get(
            'connection'
        );


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
        client.config.framework.login;


    const onlineState =
        loginConfig.onlineState;


    console.log(
        '[SVC] Creating Socket.IO connection...'
    );


    const socket =
        io(`${host}:${port}`, {

            transports: [
                'websocket'
            ],

            reconnection: true,

            autoConnect: false,

            query: {

                token:
                    session.v3APIToken,

                device,

                state:
                    onlineState,

                version:
                    version ||
                    JSON.parse(
                        fs.readFileSync(
                            path.join(
                                process.cwd(),
                                'core',
                                'package.json'
                            ),
                            'utf8'
                        )
                    ).version,

                isAppCheckEnabled:
                    'true',

                appCheckToken:
                    session.appCheckToken
            }
        });


    socket.io.on(
        'open',
        () => {

            console.log(
                '[DEBUG] Engine.IO open'
            );
        }
    );


    socket.on(
        'connect',
        () => {

            console.log(
                '[DEBUG] Socket.IO connected.'
            );
        }
    );


    socket.on(
        'connect_error',
        error => {

            console.error(
                '[SVC] Connection error:',
                error?.message || error
            );
        }
    );


    socket.on(
        'disconnect',
        reason => {

            console.log(
                '[SVC] Disconnected:',
                reason
            );
        }
    );


    /*
     * تمرير أحداث Socket.IO إلى المكتبة
     */

    socket.onAny(
        (eventString, data) => {

            const handler =
                client.websocket.handlers[
                    eventString
                ];


            const body =
                data?.body ?? data;


            if (!handler) {

                console.log(
                    `[DEBUG] No handler for: ${eventString}`
                );

                return;
            }


            try {

                return handler.process(
                    body
                );

            } catch (error) {

                console.error(
                    `[SVC] Handler error (${eventString}):`,
                    error?.message || error
                );
            }
        }
    );


    /*
     * نجعل المكتبة تستخدم الـSocket
     * الذي يحتوي على App Check
     */

    client.websocket.socket =
        socket;


    console.log(
        '[SVC] Connecting...'
    );


    await new Promise(
        (resolve, reject) => {

            const timeout =
                setTimeout(
                    () => {

                        reject(
                            new Error(
                                'Timed out waiting for Socket.IO connection.'
                            )
                        );

                    },
                    15000
                );


            socket.once(
                'connect',
                () => {

                    clearTimeout(
                        timeout
                    );

                    resolve();
                }
            );


            socket.once(
                'connect_error',
                error => {

                    clearTimeout(
                        timeout
                    );

                    reject(error);
                }
            );


            socket.connect();
        }
    );


    console.log(
        '[SVC] Socket.IO connected.'
    );


    console.log(
        '[SVC] Waiting for authorization...'
    );


    const started =
        Date.now();


    while (
        !client.currentSubscriber
    ) {

        if (
            Date.now() - started >
            15000
        ) {

            throw new Error(
                'Socket connected, but authorization did not complete.'
            );
        }


        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    250
                )
        );
    }


    console.log(
        '[DEBUG] socket.connected:',
        socket.connected
    );


    console.log(
        '[DEBUG] currentSubscriber:',
        'YES'
    );


    console.log(
        '[SVC] Authorization complete.'
    );


    console.log(
        `[SVC] Logged in as: ${client.currentSubscriber.nickname}`
    );
}


/*
 * ============================================================
 * الفحص التلقائي + الصعود
 * ============================================================
 */

async function checkStageAndJoin() {

    /*
     * إذا توقف الفحص لأي سبب،
     * لا نفعل أي شيء.
     */

    if (!autoCheckEnabled) {
        return;
    }


    /*
     * إذا كان البوت بالفعل على الـStage
     */

    if (currentSlotId !== null) {

        console.log(
            'ℹ️ البوت موجود بالفعل على الاستيج.'
        );

        /*
         * لا نحتاج فحصًا آخر.
         */

        stopAutomaticChecking(
            'البوت موجود بالفعل على الاستيج'
        );

        return;
    }


    try {

        console.log(
            '\n🔎 جاري فحص الاستيج...'
        );


        /*
         * التأكد أن الـStage مفعّل
         */

        const audioConfig =
            await client.stage.getAudioConfig(
                ROOM_ID
            );


        if (!audioConfig.enabled) {

            console.log(
                '❌ الاستيج غير مفعّل في هذا الجروب.'
            );

            /*
             * لا نوقف الفحص.
             * سيعود بعد 10 دقائق.
             */

            return;
        }


        /*
         * جلب الـSlots
         *
         * المكتبة تدير الـcache بنفسها.
         */

        const slots =
            await client.stage.slot.list(
                ROOM_ID
            );


        const occupants =
            slots.filter(
                slot => !!slot.occupierId
            );


        console.log(
            `👥 عدد الموجودين على الاستيج: ${occupants.length}`
        );


        /*
         * ====================================================
         * الحالة الأولى:
         *
         * 0 أو 1 شخص
         * => نصعد
         * => نوقف الفحص نهائيًا
         * ====================================================
         */

        if (
            occupants.length <=
            MAX_OCCUPANTS_TO_JOIN
        ) {

            const freeSlot =
                slots.find(
                    slot =>
                        !slot.occupierId &&
                        !slot.reservedOccupierId
                );


            if (!freeSlot) {

                console.log(
                    '⚠️ العدد مناسب ولكن لا يوجد Slot متاح.'
                );

                /*
                 * نترك الفحص مستمرًا.
                 */

                return;
            }


            console.log(
                `✅ العدد مناسب (${occupants.length})`
            );


            console.log(
                `🎙️ جاري الصعود للسلوت ${freeSlot.id}...`
            );


            const response =
                await client.stage.slot.join(
                    ROOM_ID,
                    freeSlot.id
                );


            if (response?.success) {

                currentSlotId =
                    freeSlot.id;


                console.log(
                    '✅ تم الصعود تلقائيًا للاستيج بنجاح.'
                );


                console.log(
                    `🎙️ Slot ID: ${currentSlotId}`
                );


                /*
                 * مهم جدًا:
                 *
                 * الصعود التلقائي الناجح
                 * = نهاية الفحص نهائيًا.
                 */

                stopAutomaticChecking(
                    'تم الصعود تلقائيًا بنجاح'
                );

            } else {

                console.log(
                    '⚠️ طلب الصعود لم ينجح.'
                );

                /*
                 * بما أنه لم يصعد،
                 * سيستمر الفحص بعد 10 دقائق.
                 */
            }


            return;
        }


        /*
         * ====================================================
         * الحالة الثانية:
         *
         * 2 أو أكثر
         * => لا نصعد
         * => ننتظر 10 دقائق
         * ====================================================
         */

        console.log(
            `⏳ يوجد ${occupants.length} أشخاص — لن أصعد الآن.`
        );


        console.log(
            `⏱️ الفحص القادم بعد ${CHECK_INTERVAL_MS / 60000} دقائق.`
        );

    } catch (error) {

        console.error(
            '\n❌ خطأ أثناء فحص الاستيج:',
            error?.message || error
        );


        if (error?.data) {

            console.error(
                '[SVC] Error data:',
                error.data
            );
        }


        /*
         * لا نوقف الفحص عند الخطأ.
         *
         * سيحاول مرة أخرى بعد 10 دقائق.
         */
    }
}


/*
 * ============================================================
 * الصعود الإجباري
 * ============================================================
 */

async function forceJoinStage() {

    try {

        /*
         * نوقف الفحص قبل تنفيذ الأمر.
         */

        stopAutomaticChecking(
            'استلام أمر كات صعود'
        );


        if (currentSlotId !== null) {

            console.log(
                'ℹ️ البوت موجود بالفعل على الاستيج.'
            );

            return;
        }


        const audioConfig =
            await client.stage.getAudioConfig(
                ROOM_ID
            );


        if (!audioConfig.enabled) {

            console.log(
                '❌ الاستيج غير مفعّل في هذا الجروب.'
            );

            return;
        }


        const slots =
            await client.stage.slot.list(
                ROOM_ID
            );


        const freeSlot =
            slots.find(
                slot =>
                    !slot.occupierId &&
                    !slot.reservedOccupierId
            );


        if (!freeSlot) {

            console.log(
                '❌ لا يوجد Slot فاضي حاليًا.'
            );

            return;
        }


        console.log(
            `✅ صعود إجباري — جاري الانضمام للسلوت ${freeSlot.id} ...`
        );


        const response =
            await client.stage.slot.join(
                ROOM_ID,
                freeSlot.id
            );


        if (response?.success) {

            currentSlotId =
                freeSlot.id;


            console.log(
                '✅ تم الانضمام للاستيج بنجاح (صعود إجباري).'
            );


            console.log(
                `🎙️ Slot ID: ${currentSlotId}`
            );

        } else {

            console.log(
                '⚠️ طلب الصعود الإجباري لم ينجح:',
                response
            );
        }

    } catch (error) {

        console.error(
            '❌ حصل خطأ أثناء الصعود الإجباري:',
            error?.message || error
        );


        if (error?.data) {

            console.error(
                '[SVC] Error data:',
                error.data
            );
        }
    }
}


/*
 * ============================================================
 * النزول من الاستيج
 * ============================================================
 */

async function leaveStage() {

    /*
     * حتى لو لم يكن على الـStage،
     * لا نعيد تشغيل الفحص.
     */

    if (currentSlotId === null) {

        console.log(
            'ℹ️ البوت مش واقف على الاستيج أصلاً.'
        );

        return;
    }


    const slotId =
        currentSlotId;


    try {

        console.log(
            `🛑 جاري النزول من الاستيج، Slot ${slotId}...`
        );


        await client.stage.slot.leave(
            ROOM_ID,
            slotId
        );


        currentSlotId =
            null;


        console.log(
            '✅ تم النزول من الاستيج.'
        );


    } catch (error) {

        console.error(
            '⚠️ حصل خطأ أثناء مغادرة الاستيج:',
            error?.message || error
        );


        /*
         * المكتبة تقوم بحذف الكائن الداخلي
         * داخل slot.leave().
         */

        currentSlotId =
            null;
    }
}


/*
 * ============================================================
 * بدء المراقبة التلقائية بعد تسجيل الدخول
 *
 * ملاحظة مهمة:
 * تسجيل الدخول هنا يتم يدويًا عبر جلسة المتصفح،
 * وليس عبر آلية تسجيل الدخول الرسمية في المكتبة.
 * لذلك حدث "ready" قد لا يُطلق إطلاقًا.
 * هذه الدالة تُستدعى مباشرة بعد نجاح تسجيل الدخول
 * بدلاً من انتظار "ready".
 * ============================================================
 */

async function startMonitoringAfterLogin() {

    if (monitoringStarted) {
        return;
    }

    monitoringStarted = true;

    console.log(
        `✅ تم تسجيل الدخول: ${client.currentSubscriber.nickname}`
    );

    /*
     * ضبط الحالة Invisible
     */

    try {

        await client.setOnlineState(
            OnlineState.INVISIBLE
        );

        console.log(
            '✅ تم ضبط الحالة بنجاح إلى: بعيد (Away)'
        );

    } catch (error) {

        console.error(
            '⚠️ فشل ضبط الحالة:',
            error?.message || error
        );
    }

    /*
     * =================================================
     * الفحص الأول فورًا
     * =================================================
     */

    await checkStageAndJoin();

    /*
     * إذا نجح الصعود أو توقف الفحص
     * لا ننشئ Interval.
     */

    if (!autoCheckEnabled) {

        console.log(
            '🛑 الفحص التلقائي متوقف — لا يوجد فحص دوري.'
        );

    } else {

        /*
         * =================================================
         * الفحص كل 10 دقائق
         * =================================================
         */

        checkIntervalHandle =
            setInterval(
                async () => {

                    if (!autoCheckEnabled) {
                        return;
                    }

                    await checkStageAndJoin();

                },
                CHECK_INTERVAL_MS
            );

        console.log(
            `⏱️ إذا كان هناك شخصان أو أكثر، سيتم إعادة الفحص كل ${CHECK_INTERVAL_MS / 60000} دقائق.`
        );
    }

    /*
     * =================================================
     * مدة تشغيل البوت
     * =================================================
     */

    setTimeout(
        () =>
            gracefulShutdown(
                'انتهاء مدة التشغيل المحددة'
            ),
        RUN_DURATION_MS
    );
}


/*
 * ============================================================
 * إيقاف البوت
 * ============================================================
 */

async function gracefulShutdown(reason) {

    if (shuttingDown) {
        return;
    }


    shuttingDown = true;


    console.log(
        `\n🛑 جاري إيقاف البوت بسبب: ${reason}`
    );


    /*
     * إيقاف الفحص
     */

    stopAutomaticChecking(
        `إيقاف البوت: ${reason}`
    );


    /*
     * النزول إذا كان على الـStage
     */

    try {

        await leaveStage();

    } catch {}


    /*
     * إغلاق الخدمة
     */

    try {

        await client.disconnect();

    } catch {}
}


/*
 * ============================================================
 * Events
 * ============================================================
 */

function setupEvents() {


    /*
     * عندما يكتمل تسجيل الدخول عبر الآلية الرسمية للمكتبة
     * (قد لا يُطلق في حالتنا، لكن نبقيه احتياطًا)
     */

    client.on(
        'ready',
        async () => {

            await startMonitoringAfterLogin();
        }
    );


    /*
     * =========================================================
     * الرسائل الخاصة
     * =========================================================
     */

    client.on(
        'privateMessage',
        async message => {

            try {

                const senderId =
                    Number(
                        message.authorId ||
                        message.sourceSubscriberId
                    );


                const text =
                    message.content ||
                    message.body ||
                    '';


                /*
                 * تجاهل أي شخص غير موجود
                 * في قائمة المراقبة.
                 */

                if (
                    !AUTHORIZED_USER_IDS.includes(
                        senderId
                    )
                ) {

                    return;
                }


                /*
                 * =================================================
                 * كات نزول
                 * =================================================
                 */

                if (
                    text.includes(
                        EXIT_COMMAND
                    )
                ) {

                    console.log(
                        `\n📥 استلمنا أمر النزول من العضوية ${senderId}`
                    );


                    /*
                     * الأمر يوقف الفحص نهائيًا.
                     */

                    stopAutomaticChecking(
                        'استلام أمر كات نزول'
                    );


                    await leaveStage();


                    return;
                }


                /*
                 * =================================================
                 * كات صعود
                 * =================================================
                 */

                if (
                    text.includes(
                        ENTER_COMMAND
                    )
                ) {

                    console.log(
                        `\n📥 استلمنا أمر الصعود الإجباري من العضوية ${senderId}`
                    );


                    /*
                     * forceJoinStage نفسه
                     * يوقف الفحص أولًا.
                     */

                    await forceJoinStage();


                    return;
                }

            } catch (error) {

                console.error(
                    '❌ خطأ أثناء معالجة الرسالة:',
                    error?.message || error
                );
            }
        }
    );


    /*
     * =========================================================
     * أخطاء الخدمة
     * =========================================================
     */

    client.on(
        'error',
        error => {

            console.error(
                '❌ خطأ في الخدمة:',
                error?.message || error
            );
        }
    );
}


/*
 * ============================================================
 * التشغيل
 * ============================================================
 */

async function run() {

    client =
        new Client();


    setupEvents();


    await loginWithChromeSession();


    /*
     * =========================================================
     * مهم جدًا:
     *
     * لا ننتظر حدث "ready" لبدء المراقبة، لأن تسجيل الدخول
     * تم يدويًا عبر جلسة المتصفح وقد لا يُطلق هذا الحدث أبدًا.
     * نبدأ المراقبة مباشرة بعد نجاح تسجيل الدخول.
     * =========================================================
     */

    await startMonitoringAfterLogin();
}


run().catch(
    async error => {

        console.error(
            '\n❌ FATAL:',
            error?.message || error
        );


        if (error?.data) {

            console.error(
                '[SVC] DATA:',
                error.data
            );
        }


        try {

            if (client) {
                await client.disconnect();
            }

        } catch {}


        process.exit(1);
    }
);


/*
 * ============================================================
 * Ctrl+C
 * ============================================================
 */

process.on(
    'SIGINT',
    async () => {

        await gracefulShutdown(
            'SIGINT'
        );

        process.exit(0);
    }
);


process.on(
    'SIGTERM',
    async () => {

        await gracefulShutdown(
            'SIGTERM'
        );

        process.exit(0);
    }
);
