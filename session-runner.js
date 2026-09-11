import wolfjs from 'wolf.js';
import io from 'socket.io-client';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';


/*
 * ============================================================
 * wolf.js
 * ============================================================
 */

const { WOLF, OnlineState } = wolfjs;


/*
 * ============================================================
 * إعدادات البوت
 * ============================================================
 */

const GROUP_ID = 66266;

const WATCHED_SUBSCRIBER_IDS = [
    51660277
];

const LEAVE_COMMAND = '!كات نزول';

const JOIN_COMMAND = '!كات صعود';

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

let service = null;

let currentSlotId = null;

let checkIntervalHandle = null;

let shutdownTimeoutHandle = null;

let autoCheckEnabled = true;

let monitoringStarted = false;

let shuttingDown = false;


/*
 * ============================================================
 * مسار المشروع
 * ============================================================
 */

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);


/*
 * ============================================================
 * أدوات
 * ============================================================
 */

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}


/*
 * ============================================================
 * قراءة Secrets
 * ============================================================
 *
 * GitHub:
 *
 * SVC_API_TOKEN
 * SVC_APP_CHECK_TOKEN
 *
 * لا نطبع القيم أبدًا.
 * ============================================================
 */

function getSessionFromEnvironment() {

    const v3APIToken =
        process.env.SVC_API_TOKEN;

    const appCheckToken =
        process.env.SVC_APP_CHECK_TOKEN;


    if (!v3APIToken) {

        throw new Error(
            'SVC_API_TOKEN is missing.'
        );
    }


    if (!appCheckToken) {

        throw new Error(
            'SVC_APP_CHECK_TOKEN is missing.'
        );
    }


    console.log(
        `[SVC] v3APIToken : exists (${v3APIToken.length} chars)`
    );


    console.log(
        `[SVC] appCheckToken: exists (${appCheckToken.length} chars)`
    );


    return {
        v3APIToken,
        appCheckToken
    };
}


/*
 * ============================================================
 * إيقاف الفحص التلقائي
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
 * إنشاء wolf.js
 * ============================================================
 */

function createWolfClient() {

    console.log(
        '[SVC] Creating wolf.js client...'
    );


    service =
        new WOLF();


    if (!service) {

        throw new Error(
            'Failed to create wolf.js client.'
        );
    }


    /*
     * فحص الإعدادات حتى لا نحصل على:
     *
     * Cannot set properties of undefined
     */


    if (!service.config) {

        throw new Error(
            'wolf.js config was not loaded.'
        );
    }


    if (!service.config.framework) {

        throw new Error(
            'wolf.js framework configuration is missing.'
        );
    }


    if (!service.config.framework.login) {

        throw new Error(
            'wolf.js login configuration is missing.'
        );
    }


    return service;
}


/*
 * ============================================================
 * تسجيل الدخول باستخدام Token + App Check
 * ============================================================
 *
 * لا نستخدم Chrome.
 *
 * لا نستخدم email/password.
 *
 * لا نستخدم ./wolf.js.
 *
 * ============================================================
 */

async function loginWithWolfSession() {

    const session =
        getSessionFromEnvironment();


    console.log(
        '[WOLF] Initializing wolf.js handlers...'
    );


    /*
     * وضع V3 Token في إعدادات wolf.js
     */

    service.config.framework.login.token =
        session.v3APIToken;


    /*
     * App Check
     */

    service.config.framework.login.apiKey =
        session.appCheckToken;


    /*
     * تهيئة handlers
     */

    await service.websocket.init();


    console.log(
        `[WOLF] Loaded ${Object.keys(
            service.websocket.handlers
        ).length} socket handlers.`
    );


    /*
     * الحصول على إعداد الاتصال
     */

    const connectionConfig =
        service._frameworkConfig.get(
            'connection'
        );


    if (!connectionConfig) {

        throw new Error(
            'wolf.js connection configuration was not found.'
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


    /*
     * ========================================================
     * إنشاء Socket.IO يدويًا
     *
     * السبب:
     *
     * wolf.js 2.7.10 لا يضيف App Check تلقائيًا إلى query
     * في هذه الحالة.
     *
     * ========================================================
     */

    console.log(
        '[WOLF] Creating Socket.IO connection...'
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
                    version || '2.7.10',

                isAppCheckEnabled:
                    'true',

                appCheckToken:
                    session.appCheckToken
            }
        });


    /*
     * ========================================================
     * Debug
     * ========================================================
     */

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
                '[WOLF] Connection error:',
                error?.message || error
            );
        }
    );


    socket.on(
        'disconnect',
        reason => {

            console.log(
                '[WOLF] Disconnected:',
                reason
            );
        }
    );


    /*
     * ========================================================
     * تمرير أحداث Socket.IO إلى wolf.js
     * ========================================================
     */

    socket.onAny(
        (eventString, data) => {

            const handler =
                service.websocket.handlers[
                    eventString
                ];


            const body =
                data?.body ?? data;


            if (!handler) {

                return;
            }


            try {

                return handler.process(
                    body
                );

            } catch (error) {

                console.error(
                    `[WOLF] Handler error (${eventString}):`,
                    error?.message || error
                );
            }
        }
    );


    /*
     * جعل wolf.js يستخدم Socket الذي يحتوي
     * على App Check
     */

    service.websocket.socket =
        socket;


    /*
     * ========================================================
     * الاتصال
     * ========================================================
     */

    console.log(
        '[WOLF] Connecting...'
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

                    reject(
                        error
                    );
                }
            );


            socket.connect();
        }
    );


    console.log(
        '[WOLF] Socket.IO connected.'
    );


    /*
     * ========================================================
     * انتظار Authorization
     * ========================================================
     */

    console.log(
        '[WOLF] Waiting for authorization...'
    );


    const started =
        Date.now();


    while (
        !service.currentSubscriber
    ) {

        if (
            Date.now() - started >
            15000
        ) {

            throw new Error(
                'Socket connected, but WOLF authorization did not complete.'
            );
        }


        await sleep(250);
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
        '[WOLF] Authorization complete.'
    );


    console.log(
        `[WOLF] Logged in as: ${service.currentSubscriber.nickname}`
    );
}


/*
 * ============================================================
 * فحص الاستيج
 * ============================================================
 */

async function checkStageAndJoin() {

    if (!autoCheckEnabled) {
        return;
    }


    if (currentSlotId !== null) {

        console.log(
            'ℹ️ البوت موجود بالفعل على الاستيج.'
        );


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
         * التأكد أن Stage مفعّل
         */

        const audioConfig =
            await service.stage.getAudioConfig(
                GROUP_ID
            );


        if (!audioConfig?.enabled) {

            console.log(
                '❌ الاستيج غير مفعّل في هذا الجروب.'
            );


            return;
        }


        /*
         * جلب Slots
         */

        const slots =
            await service.stage.slot.list(
                GROUP_ID
            );


        const occupants =
            slots.filter(
                slot =>
                    !!slot.occupierId
            );


        console.log(
            `👥 عدد الموجودين على الاستيج: ${occupants.length}`
        );


        /*
         * ====================================================
         * 0 أو 1 شخص
         *
         * نصعد
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


                return;
            }


            console.log(
                `✅ العدد مناسب (${occupants.length})`
            );


            console.log(
                `🎙️ جاري الصعود للسلوت ${freeSlot.id}...`
            );


            const response =
                await service.stage.slot.join(
                    GROUP_ID,
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


                stopAutomaticChecking(
                    'تم الصعود تلقائيًا بنجاح'
                );

            } else {

                console.log(
                    '⚠️ طلب الصعود لم ينجح.'
                );
            }


            return;
        }


        /*
         * ====================================================
         * شخصان أو أكثر
         *
         * لا نصعد
         * ننتظر 10 دقائق
         * ====================================================
         */

        console.log(
            `⏳ يوجد ${occupants.length} أشخاص — لن أصعد الآن.`
        );


        console.log(
            `⏱️ الفحص القادم بعد ${
                CHECK_INTERVAL_MS / 60000
            } دقائق.`
        );

    } catch (error) {

        console.error(
            '\n❌ خطأ أثناء فحص الاستيج:',
            error?.message || error
        );


        if (error?.data) {

            console.error(
                '[WOLF] Error data:',
                error.data
            );
        }
    }
}


/*
 * ============================================================
 * صعود إجباري
 * ============================================================
 */

async function forceJoinStage() {

    try {

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
            await service.stage.getAudioConfig(
                GROUP_ID
            );


        if (!audioConfig?.enabled) {

            console.log(
                '❌ الاستيج غير مفعّل في هذا الجروب.'
            );


            return;
        }


        const slots =
            await service.stage.slot.list(
                GROUP_ID
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
            await service.stage.slot.join(
                GROUP_ID,
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
                '⚠️ طلب الصعود الإجباري لم ينجح.'
            );


            console.log(
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
                '[WOLF] Error data:',
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


        await service.stage.slot.leave(
            GROUP_ID,
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


        currentSlotId =
            null;
    }
}


/*
 * ============================================================
 * بدء المراقبة
 * ============================================================
 */

async function startMonitoringAfterLogin() {

    if (monitoringStarted) {
        return;
    }


    monitoringStarted = true;


    console.log(
        `✅ تم تسجيل الدخول: ${
            service.currentSubscriber.nickname
        }`
    );


    /*
     * ========================================================
     * Invisible
     * ========================================================
     */

    try {

        await service.setOnlineState(
            OnlineState.INVISIBLE
        );


        console.log(
            '✅ تم ضبط الحالة إلى Invisible.'
        );

    } catch (error) {

        console.error(
            '⚠️ فشل ضبط الحالة:',
            error?.message || error
        );
    }


    /*
     * ========================================================
     * الفحص الأول فورًا
     * ========================================================
     */

    await checkStageAndJoin();


    /*
     * ========================================================
     * الفحص الدوري
     * ========================================================
     */

    if (!autoCheckEnabled) {

        console.log(
            '🛑 الفحص التلقائي متوقف — لا يوجد فحص دوري.'
        );

    } else {

        checkIntervalHandle =
            setInterval(
                async () => {

                    if (!autoCheckEnabled) {
                        return;
                    }


                    if (shuttingDown) {
                        return;
                    }


                    await checkStageAndJoin();

                },
                CHECK_INTERVAL_MS
            );


        console.log(
            `⏱️ سيتم الفحص كل ${
                CHECK_INTERVAL_MS / 60000
            } دقائق إذا كان هناك شخصان أو أكثر.`
        );
    }


    /*
     * ========================================================
     * مدة التشغيل
     * ========================================================
     */

    shutdownTimeoutHandle =
        setTimeout(
            () =>
                gracefulShutdown(
                    'انتهاء مدة التشغيل المحددة'
                ),
            RUN_DURATION_MS
        );


    console.log(
        `⏰ مدة التشغيل: ${
            RUN_DURATION_MS / 60 / 60 / 1000
        } ساعات.`
    );
}


/*
 * ============================================================
 * Events
 * ============================================================
 */

function setupEvents() {

    /*
     * ready
     *
     * نتركه كاحتياط.
     */

    service.on(
        'ready',
        async () => {

            console.log(
                '[WOLF] ready event received.'
            );
        }
    );


    /*
     * ========================================================
     * الرسائل الخاصة
     * ========================================================
     */

    service.on(
        'privateMessage',
        async message => {

            try {

                /*
                 * wolf.js 2.x
                 */

                const senderId =
                    Number(
                        message.authorId ||
                        message.sourceSubscriberId
                    );


                const text =
                    String(
                        message.content ||
                        message.body ||
                        ''
                    ).trim();


                if (
                    !WATCHED_SUBSCRIBER_IDS.includes(
                        senderId
                    )
                ) {

                    return;
                }


                console.log(
                    `📩 رسالة من ${senderId}: ${text}`
                );


                /*
                 * =================================================
                 * كات نزول
                 * =================================================
                 */

                if (
                    text.includes(
                        LEAVE_COMMAND
                    )
                ) {

                    console.log(
                        `\n📥 استلمنا أمر النزول من العضوية ${senderId}`
                    );


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
                        JOIN_COMMAND
                    )
                ) {

                    console.log(
                        `\n📥 استلمنا أمر الصعود الإجباري من العضوية ${senderId}`
                    );


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
     * ========================================================
     * أخطاء WOLF
     * ========================================================
     */

    service.on(
        'error',
        error => {

            console.error(
                '❌ خطأ في WOLF:',
                error?.message || error
            );
        }
    );
}


/*
 * ============================================================
 * Graceful Shutdown
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
     * إيقاف interval
     */

    stopAutomaticChecking(
        `إيقاف البوت: ${reason}`
    );


    /*
     * إلغاء timeout
     */

    if (shutdownTimeoutHandle) {

        clearTimeout(
            shutdownTimeoutHandle
        );

        shutdownTimeoutHandle = null;
    }


    /*
     * النزول من Stage
     */

    try {

        await leaveStage();

    } catch {}
    

    /*
     * disconnect
     */

    try {

        if (service) {

            await service.disconnect();
        }

    } catch {}


    console.log(
        '✅ تم إيقاف البوت.'
    );
}


/*
 * ============================================================
 * Main
 * ============================================================
 */

async function run() {

    console.log(
        '================================================'
    );


    console.log(
        '🐺 WOLF Bot'
    );


    console.log(
        '================================================'
    );


    console.log(
        `📌 Room ID: ${GROUP_ID}`
    );


    console.log(
        `📌 Authorized User: ${WATCHED_SUBSCRIBER_IDS.join(', ')}`
    );


    console.log(
        `📌 Check interval: ${
            CHECK_INTERVAL_MS / 60000
        } minutes`
    );


    console.log(
        `📌 Runtime: ${
            RUN_DURATION_MS / 60 / 60 / 1000
        } hours`
    );


    console.log(
        '================================================'
    );


    /*
     * إنشاء العميل
     */

    createWolfClient();


    /*
     * Events قبل الاتصال
     */

    setupEvents();


    /*
     * Login
     */

    await loginWithWolfSession();


    /*
     * بدء البوت
     */

    await startMonitoringAfterLogin();
}


/*
 * ============================================================
 * Fatal
 * ============================================================
 */

run().catch(
    async error => {

        console.error(
            '\n❌ FATAL ERROR:'
        );


        console.error(
            error?.stack ||
            error?.message ||
            error
        );


        try {

            if (service) {

                await service.disconnect();
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
