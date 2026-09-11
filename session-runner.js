```js
import wolfjs from "./wolf.js/index.js";
import io from "socket.io-client";
import fs from "fs";
import path from "path";

const { WOLF, OnlineState } = wolfjs;

/*
 * ============================================================
 * الإعدادات
 * ============================================================
 */

const GROUP_ID = 66266;

const WATCHED_SUBSCRIBER_IDS = [
    51660277
];

const LEAVE_COMMAND = "!كات نزول";
const JOIN_COMMAND = "!كات صعود";

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

let autoCheckEnabled = true;

let shuttingDown = false;

let monitoringStarted = false;


/*
 * ============================================================
 * قراءة Session من GitHub Secrets
 * ============================================================
 */

function getWolfSessionFromEnvironment() {

    const v3APIToken =
        process.env.WOLF_API_TOKEN;

    const appCheckToken =
        process.env.WOLF_APP_CHECK_TOKEN;

    console.log(
        "[WOLF] Reading tokens from environment..."
    );

    console.log(
        `[WOLF] v3APIToken : ${
            v3APIToken
                ? `exists (${v3APIToken.length} chars)`
                : "MISSING"
        }`
    );

    console.log(
        `[WOLF] appCheckToken: ${
            appCheckToken
                ? `exists (${appCheckToken.length} chars)`
                : "MISSING"
        }`
    );

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

    return {
        v3APIToken,
        appCheckToken
    };
}


/*
 * ============================================================
 * إصدار wolf.js
 * ============================================================
 */

function getWolfVersion() {

    try {

        const packagePath =
            path.join(
                process.cwd(),
                "wolf.js",
                "package.json"
            );

        const packageData =
            JSON.parse(
                fs.readFileSync(
                    packagePath,
                    "utf8"
                )
            );

        return packageData.version;

    } catch (error) {

        console.log(
            "[WOLF] Could not read wolf.js/package.json."
        );

        console.log(
            "[WOLF] Using fallback version: 2.7.10"
        );

        return "2.7.10";
    }
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
 * تسجيل الدخول عبر Session
 * ============================================================
 */

async function loginWithWolfSession() {

    const session =
        getWolfSessionFromEnvironment();

    console.log(
        "[WOLF] Initializing wolf.js handlers..."
    );

    /*
     * مهم:
     *
     * نضع v3APIToken هنا فقط.
     *
     * لا نضع appCheckToken في:
     *
     * service.config.framework.login.apiKey
     */

    service.config.framework.login.token =
        session.v3APIToken;

    await service.websocket.init();

    console.log(
        `[WOLF] Loaded ${
            Object.keys(
                service.websocket.handlers
            ).length
        } socket handlers.`
    );

    /*
     * ========================================================
     * Connection
     * ========================================================
     */

    const connectionConfig =
        service._frameworkConfig.get(
            "connection"
        );

    if (!connectionConfig) {
        throw new Error(
            "WOLF connection configuration is missing."
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
        "[WOLF] Creating Socket.IO connection..."
    );

    /*
     * ========================================================
     * Socket.IO
     * ========================================================
     */

    const socket =
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
                        session.v3APIToken,

                    device,

                    state:
                        onlineState,

                    version:
                        wolfVersion,

                    isAppCheckEnabled:
                        "true",

                    appCheckToken:
                        session.appCheckToken
                }
            }
        );


    /*
     * ========================================================
     * Engine.IO
     * ========================================================
     */

    socket.io.on(
        "open",
        () => {

            console.log(
                "[DEBUG] Engine.IO open"
            );
        }
    );


    socket.io.on(
        "error",
        error => {

            console.error(
                "[DEBUG] Engine.IO error:",
                error?.message ||
                error
            );
        }
    );


    /*
     * ========================================================
     * Socket connected
     * ========================================================
     */

    socket.on(
        "connect",
        () => {

            console.log(
                "[DEBUG] Socket.IO connected."
            );
        }
    );


    /*
     * ========================================================
     * Socket error
     * ========================================================
     */

    socket.on(
        "connect_error",
        error => {

            console.error(
                "[WOLF] Connection error:",
                error?.message ||
                error
            );
        }
    );


    /*
     * ========================================================
     * Socket disconnected
     * ========================================================
     */

    socket.on(
        "disconnect",
        reason => {

            console.log(
                "[WOLF] Disconnected:",
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
                data?.body ??
                data;

            if (!handler) {

                console.log(
                    `[DEBUG] No wolf.js handler for: ${eventString}`
                );

                return;
            }

            try {

                return handler.process(
                    body
                );

            } catch (error) {

                console.error(
                    `[WOLF] Handler error (${eventString}):`,
                    error?.message ||
                    error
                );
            }
        }
    );


    /*
     * ========================================================
     * إعطاء Socket إلى wolf.js
     * ========================================================
     */

    service.websocket.socket =
        socket;


    /*
     * ========================================================
     * الاتصال
     * ========================================================
     */

    console.log(
        "[WOLF] Connecting..."
    );

    await new Promise(
        (resolve, reject) => {

            const timeout =
                setTimeout(
                    () => {

                        reject(
                            new Error(
                                "Timed out waiting for Socket.IO connection."
                            )
                        );

                    },
                    15000
                );


            socket.once(
                "connect",
                () => {

                    clearTimeout(
                        timeout
                    );

                    resolve();
                }
            );


            socket.once(
                "connect_error",
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
        "[WOLF] Socket.IO connected."
    );

    console.log(
        "[WOLF] Waiting for authorization..."
    );


    /*
     * ========================================================
     * انتظار authorization
     * ========================================================
     */

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
                "Socket connected, but WOLF authorization did not complete."
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
        "[DEBUG] socket.connected:",
        socket.connected
    );

    console.log(
        "[DEBUG] currentSubscriber:",
        "YES"
    );

    console.log(
        "[WOLF] Authorization complete."
    );


    console.log(
        `[WOLF] Logged in as: ${
            service.currentSubscriber.nickname
        }`
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


    /*
     * إذا كان البوت بالفعل على الاستيج
     */

    if (currentSlotId !== null) {

        console.log(
            "ℹ️ البوت موجود بالفعل على الاستيج."
        );

        stopAutomaticChecking(
            "البوت موجود بالفعل على الاستيج"
        );

        return;
    }


    try {

        console.log(
            "\n🔎 جاري فحص الاستيج..."
        );


        /*
         * التأكد من أن الاستيج مفعّل
         */

        const audioConfig =
            await service.stage.getAudioConfig(
                GROUP_ID
            );


        if (!audioConfig.enabled) {

            console.log(
                "❌ الاستيج غير مفعّل في هذا الجروب."
            );

            return;
        }


        /*
         * جلب الـSlots
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
         * العدد مناسب
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
                    "⚠️ العدد مناسب ولكن لا يوجد Slot متاح."
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
                    "✅ تم الصعود تلقائيًا للاستيج بنجاح."
                );


                console.log(
                    `🎙️ Slot ID: ${currentSlotId}`
                );


                stopAutomaticChecking(
                    "تم الصعود تلقائيًا بنجاح"
                );

            } else {

                console.log(
                    "⚠️ طلب الصعود لم ينجح."
                );
            }


            return;
        }


        /*
         * ====================================================
         * الاستيج فيه أكثر من شخص
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
            "\n❌ خطأ أثناء فحص الاستيج:",
            error?.message ||
            error
        );


        if (error?.data) {

            console.error(
                "[WOLF] Error data:",
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
            "استلام أمر كات صعود"
        );


        if (currentSlotId !== null) {

            console.log(
                "ℹ️ البوت موجود بالفعل على الاستيج."
            );

            return;
        }


        const audioConfig =
            await service.stage.getAudioConfig(
                GROUP_ID
            );


        if (!audioConfig.enabled) {

            console.log(
                "❌ الاستيج غير مفعّل في هذا الجروب."
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
                "❌ لا يوجد Slot فاضي حاليًا."
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
                "✅ تم الانضمام للاستيج بنجاح (صعود إجباري)."
            );


            console.log(
                `🎙️ Slot ID: ${currentSlotId}`
            );

        } else {

            console.log(
                "⚠️ طلب الصعود الإجباري لم ينجح:",
                response
            );
        }

    } catch (error) {

        console.error(
            "❌ حصل خطأ أثناء الصعود الإجباري:",
            error?.message ||
            error
        );


        if (error?.data) {

            console.error(
                "[WOLF] Error data:",
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
            "ℹ️ البوت مش واقف على الاستيج أصلاً."
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
            "✅ تم النزول من الاستيج."
        );

    } catch (error) {

        console.error(
            "⚠️ حصل خطأ أثناء مغادرة الاستيج:",
            error?.message ||
            error
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
     * ضبط الحالة Away
     * ========================================================
     */

    try {

        await service.setOnlineState(
            OnlineState.INVISIBLE
        );


        console.log(
            "✅ تم ضبط الحالة بنجاح إلى: بعيد (Away)"
        );

    } catch (error) {

        console.error(
            "⚠️ فشل ضبط الحالة:",
            error?.message ||
            error
        );
    }


    /*
     * ========================================================
     * الفحص الأول
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
            "🛑 الفحص التلقائي متوقف — لا يوجد فحص دوري."
        );

    } else {

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
            `⏱️ إذا كان هناك شخصان أو أكثر، سيتم إعادة الفحص كل ${
                CHECK_INTERVAL_MS / 60000
            } دقائق.`
        );
    }


    /*
     * ========================================================
     * مدة التشغيل
     * ========================================================
     */

    setTimeout(
        () =>
            gracefulShutdown(
                "انتهاء مدة التشغيل المحددة"
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


    stopAutomaticChecking(
        `إيقاف البوت: ${reason}`
    );


    /*
     * النزول من الاستيج
     */

    try {

        await leaveStage();

    } catch {}


    /*
     * إغلاق Socket
     */

    try {

        if (
            service?.websocket?.socket
        ) {

            service.websocket.socket.disconnect();
        }

    } catch {}


    /*
     * disconnect الرسمي إن كان متاحًا
     */

    try {

        if (
            typeof service?.disconnect ===
            "function"
        ) {

            await service.disconnect();
        }

    } catch {}
}


/*
 * ============================================================
 * Events
 * ============================================================
 */

function setupEvents() {


    /*
     * ========================================================
     * privateMessage
     * ========================================================
     */

    service.on(
        "privateMessage",
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
                    "";


                /*
                 * تجاهل غير المراقبين
                 */

                if (
                    !WATCHED_SUBSCRIBER_IDS.includes(
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
                        LEAVE_COMMAND
                    )
                ) {

                    console.log(
                        `\n📥 استلمنا أمر النزول من العضوية ${senderId}`
                    );


                    stopAutomaticChecking(
                        "استلام أمر كات نزول"
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
                    "❌ خطأ أثناء معالجة الرسالة:",
                    error?.message ||
                    error
                );
            }
        }
    );


    /*
     * ========================================================
     * WOLF error
     * ========================================================
     */

    service.on(
        "error",
        error => {

            console.error(
                "❌ خطأ في WOLF:",
                error?.message ||
                error
            );
        }
    );
}


/*
 * ============================================================
 * Main
 * ============================================================
 */

async function run() {

    console.log(
        "============================================================"
    );

    console.log(
        "[WOLF] Starting WOLF bot..."
    );

    console.log(
        "============================================================"
    );


    service =
        new WOLF();


    setupEvents();


    await loginWithWolfSession();


    /*
     * مهم:
     *
     * لا ننتظر ready.
     *
     * تسجيل الدخول اليدوي للـSocket تم بالفعل.
     */

    await startMonitoringAfterLogin();
}


/*
 * ============================================================
 * تشغيل
 * ============================================================
 */

run().catch(
    async error => {

        console.error(
            "\n❌ FATAL ERROR:"
        );


        console.error(
            error?.stack ||
            error
        );


        try {

            await gracefulShutdown(
                "FATAL ERROR"
            );

        } catch {}


        process.exit(1);
    }
);


/*
 * ============================================================
 * SIGINT
 * ============================================================
 */

process.on(
    "SIGINT",
    async () => {

        await gracefulShutdown(
            "SIGINT"
        );

        process.exit(0);
    }
);


/*
 * ============================================================
 * SIGTERM
 * ============================================================
 */

process.on(
    "SIGTERM",
    async () => {

        await gracefulShutdown(
            "SIGTERM"
        );

        process.exit(0);
    }
);
```
