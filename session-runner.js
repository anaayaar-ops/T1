import { config as loadEnv } from "dotenv";
import { WOLF, OnlineState } from "wolf.js";

loadEnv({
    path: ".env.local"
});

// ============================================================
// الإعدادات
// ============================================================

const ROOM_ID = 66266;

const AUTHORIZED_USER_IDS = [
    51660277
];

const EXIT_COMMAND = "!كات نزول";
const ENTER_COMMAND = "!كات صعود";

const RUN_DURATION_MS =
    5 * 60 * 60 * 1000;

const CHECK_INTERVAL_MS =
    10 * 60 * 1000;

const MAX_OCCUPANTS_TO_JOIN = 1;

// ============================================================
// حالة البوت
// ============================================================

let client = null;

let currentSlotId = null;

let checkIntervalHandle = null;

let autoCheckEnabled = true;

let stageCheckRunning = false;

let monitoringStarted = false;

let shuttingDown = false;

// ============================================================
// أدوات مساعدة
// ============================================================

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

// ============================================================
// إيقاف الفحص التلقائي نهائيًا
// ============================================================

function stopAutomaticChecking(reason = "") {

    if (!autoCheckEnabled) {
        return;
    }

    autoCheckEnabled = false;

    if (checkIntervalHandle) {
        clearInterval(checkIntervalHandle);
        checkIntervalHandle = null;
    }

    console.log(
        `🛑 تم إيقاف الفحص التلقائي نهائيًا${
            reason ? `: ${reason}` : ""
        }`
    );
}

// ============================================================
// قراءة التوكنات من GitHub Secrets / Environment
// ============================================================

function getSessionFromEnvironment() {

    const v3APIToken =
        process.env.SVC_API_TOKEN;

    const appCheckToken =
        process.env.SVC_APP_CHECK_TOKEN;

    if (!v3APIToken) {
        throw new Error(
            "SVC_API_TOKEN غير موجود في Environment / GitHub Secrets."
        );
    }

    if (!appCheckToken) {
        throw new Error(
            "SVC_APP_CHECK_TOKEN غير موجود في Environment / GitHub Secrets."
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

// ============================================================
// تسجيل الدخول باستخدام wolf.js
// ============================================================

async function loginWithWolfLibrary() {

    const {
        v3APIToken,
        appCheckToken
    } = getSessionFromEnvironment();

    console.log(
        "[SVC] Creating wolf.js client..."
    );

    client = new WOLF();

    // ========================================================
    // تمرير V3 Token إلى wolf.js
    // ========================================================

    client.config.framework.login.token =
        v3APIToken;

    // ========================================================
    // App Check Token
    //
    // في wolf.js v3:
    // apiKey = App Check Token
    // ========================================================

    client.config.framework.login.apiKey =
        appCheckToken;

    // ========================================================
    // الحالة
    // ========================================================

    client.config.framework.login.onlineState =
        OnlineState.INVISIBLE;

    console.log(
        "[SVC] V3 token and App Check token configured."
    );

    console.log(
        "[SVC] Connecting using wolf.js..."
    );

    // ========================================================
    // تسجيل الدخول من خلال المكتبة نفسها
    // ========================================================

    await client.login();

    // ========================================================
    // انتظار current user / subscriber
    //
    // بعض إصدارات v3 قد تستخدم currentUser،
    // لذلك نحاول الاثنين.
    // ========================================================

    const started =
        Date.now();

    while (
        !client.currentSubscriber &&
        !client.currentUser
    ) {

        if (
            Date.now() - started >
            30000
        ) {
            throw new Error(
                "تم الاتصال لكن لم يتم الحصول على بيانات المستخدم."
            );
        }

        await sleep(250);
    }

    const currentAccount =
        client.currentUser ||
        client.currentSubscriber;

    console.log(
        "[SVC] Authorization complete."
    );

    console.log(
        `[SVC] Logged in as: ${
            currentAccount?.nickname ||
            currentAccount?.name ||
            "Unknown"
        }`
    );
}

// ============================================================
// الحصول على معرف المستخدم الحالي
// ============================================================

function getCurrentUserId() {

    const user =
        client.currentUser ||
        client.currentSubscriber;

    return Number(
        user?.id
    );
}

// ============================================================
// جلب معلومات الاستيج
// ============================================================

async function getStageInfo() {

    const audioConfig =
        await client.stage.getAudioConfig(
            ROOM_ID
        );

    if (!audioConfig) {
        throw new Error(
            "لم يتم الحصول على Audio Config."
        );
    }

    const slots =
        await client.stage.slot.list(
            ROOM_ID
        );

    return {
        audioConfig,
        slots
    };
}

// ============================================================
// معرفة Occupants
// ============================================================

function isSlotOccupied(slot) {

    return Boolean(
        slot?.occupierId ??
        slot?.occupantId ??
        slot?.subscriberId ??
        slot?.userId ??
        slot?.occupier
    );
}

// ============================================================
// معرفة Slot المتاح
// ============================================================

function isSlotReserved(slot) {

    return Boolean(
        slot?.reservedOccupierId ??
        slot?.reservedSubscriberId ??
        slot?.reservedUserId ??
        slot?.reservedFor
    );
}

function findFreeSlot(slots) {

    return slots.find(slot => {

        if (!slot) {
            return false;
        }

        if (isSlotOccupied(slot)) {
            return false;
        }

        if (isSlotReserved(slot)) {
            return false;
        }

        return true;
    });
}

// ============================================================
// فحص الاستيج
// ============================================================

async function checkStageAndJoin() {

    if (!autoCheckEnabled) {
        return;
    }

    if (currentSlotId !== null) {

        stopAutomaticChecking(
            "البوت موجود بالفعل على الاستيج"
        );

        return;
    }

    if (stageCheckRunning) {
        return;
    }

    stageCheckRunning = true;

    try {

        console.log(
            "\n🔎 جاري فحص الاستيج..."
        );

        const {
            audioConfig,
            slots
        } = await getStageInfo();

        if (!autoCheckEnabled) {
            return;
        }

        if (!audioConfig.enabled) {

            console.log(
                "⚠️ الاستيج غير مفعّل حاليًا."
            );

            return;
        }

        const occupants =
            slots.filter(
                isSlotOccupied
            );

        console.log(
            `👥 عدد الموجودين على الاستيج: ${occupants.length}`
        );

        console.log(
            `🎙️ عدد السلوتات: ${slots.length}`
        );

        // ====================================================
        // 0 أو 1
        // => صعود تلقائي
        // ====================================================

        if (
            occupants.length <=
            MAX_OCCUPANTS_TO_JOIN
        ) {

            const freeSlot =
                findFreeSlot(slots);

            if (!freeSlot) {

                console.log(
                    "⚠️ العدد مناسب لكن لا يوجد Slot متاح."
                );

                return;
            }

            if (!autoCheckEnabled) {
                return;
            }

            console.log(
                `✅ العدد مناسب (${occupants.length})`
            );

            console.log(
                `🎙️ جاري الصعود إلى Slot ${freeSlot.id}...`
            );

            const response =
                await client.stage.slot.join(
                    ROOM_ID,
                    freeSlot.id
                );

            if (
                response?.success === false
            ) {
                throw new Error(
                    response?.message ||
                    "فشل الصعود للاستيج."
                );
            }

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

            return;
        }

        // ====================================================
        // 2 أو أكثر
        // => لا نصعد
        // ====================================================

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
            "❌ خطأ أثناء فحص الاستيج:",
            error?.message || error
        );

    } finally {

        stageCheckRunning = false;
    }
}

// ============================================================
// بدء المراقبة
// ============================================================

async function startStageMonitoring() {

    if (monitoringStarted) {
        return;
    }

    monitoringStarted = true;

    console.log(
        "\n🤖 بدء المراقبة التلقائية للاستيج..."
    );

    // ========================================================
    // الفحص الأول فورًا
    // ========================================================

    await checkStageAndJoin();

    // ========================================================
    // إذا انتهى الفحص
    // ========================================================

    if (!autoCheckEnabled) {

        console.log(
            "🛑 انتهت المراقبة التلقائية."
        );

        return;
    }

    // ========================================================
    // الفحص كل 10 دقائق
    // ========================================================

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
        `⏱️ سيتم الفحص كل ${
            CHECK_INTERVAL_MS / 60000
        } دقائق.`
    );
}

// ============================================================
// صعود إجباري
// ============================================================

async function forceJoinStage() {

    stopAutomaticChecking(
        "استلام أمر كات صعود"
    );

    if (currentSlotId !== null) {

        console.log(
            `ℹ️ البوت موجود بالفعل في Slot ${currentSlotId}.`
        );

        return;
    }

    try {

        const {
            audioConfig,
            slots
        } = await getStageInfo();

        if (!audioConfig.enabled) {

            console.log(
                "❌ الاستيج غير مفعّل."
            );

            return;
        }

        const freeSlot =
            findFreeSlot(slots);

        if (!freeSlot) {

            console.log(
                "❌ لا يوجد Slot متاح للصعود."
            );

            return;
        }

        console.log(
            `🚀 صعود إجباري إلى Slot ${freeSlot.id}...`
        );

        const response =
            await client.stage.slot.join(
                ROOM_ID,
                freeSlot.id
            );

        if (
            response?.success === false
        ) {
            throw new Error(
                response?.message ||
                "فشل الصعود الإجباري."
            );
        }

        currentSlotId =
            freeSlot.id;

        console.log(
            "✅ تم الصعود للاستيج بنجاح."
        );

        console.log(
            `🎙️ Slot ID: ${currentSlotId}`
        );

    } catch (error) {

        console.error(
            "❌ فشل الصعود الإجباري:",
            error?.message || error
        );
    }
}

// ============================================================
// النزول
// ============================================================

async function leaveStage() {

    if (currentSlotId === null) {

        console.log(
            "ℹ️ البوت ليس على الاستيج."
        );

        return;
    }

    const slotId =
        currentSlotId;

    try {

        console.log(
            `🛑 جاري النزول من Slot ${slotId}...`
        );

        await client.stage.slot.leave(
            ROOM_ID,
            slotId
        );

        currentSlotId = null;

        console.log(
            "✅ تم النزول من الاستيج."
        );

    } catch (error) {

        console.error(
            "❌ فشل النزول:",
            error?.message || error
        );

        currentSlotId = null;
    }
}

// ============================================================
// استقبال الرسائل الخاصة
// ============================================================

function setupEvents() {

    client.on(
        "privateMessage",
        async message => {

            try {

                // =================================================
                // v3 يستخدم sourceUserId
                // =================================================

                const senderId =
                    Number(
                        message?.sourceUserId ??
                        message?.authorId ??
                        message?.senderId
                    );

                const text =
                    String(
                        message?.body ??
                        message?.content ??
                        message?.text ??
                        ""
                    ).trim();

                if (!text) {
                    return;
                }

                if (
                    !AUTHORIZED_USER_IDS.includes(
                        senderId
                    )
                ) {
                    return;
                }

                // =================================================
                // كات صعود
                // =================================================

                if (
                    text.includes(
                        ENTER_COMMAND
                    )
                ) {

                    console.log(
                        `\n📥 استلمنا أمر الصعود الإجباري من العضوية ${senderId}`
                    );

                    await forceJoinStage();

                    return;
                }

                // =================================================
                // كات نزول
                // =================================================

                if (
                    text.includes(
                        EXIT_COMMAND
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

            } catch (error) {

                console.error(
                    "❌ خطأ في privateMessage:",
                    error?.message || error
                );
            }
        }
    );

    client.on(
        "ready",
        () => {

            console.log(
                "🟢 wolf.js ready."
            );
        }
    );

    client.on(
        "error",
        error => {

            console.error(
                "❌ WOLF ERROR:",
                error?.message || error
            );
        }
    );
}

// ============================================================
// إغلاق البوت
// ============================================================

async function gracefulShutdown(reason) {

    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    console.log(
        `\n🛑 إيقاف البوت: ${reason}`
    );

    stopAutomaticChecking(
        `إيقاف البوت: ${reason}`
    );

    try {

        await leaveStage();

    } catch {}

    try {

        if (client) {
            await client.disconnect();
        }

    } catch {}

    console.log(
        "👋 تم إغلاق البوت."
    );
}

// ============================================================
// Main
// ============================================================

async function run() {

    console.log(
        "================================================"
    );

    console.log(
        "🐺 WOLF Bot"
    );

    console.log(
        "================================================"
    );

    console.log(
        `📌 Room ID: ${ROOM_ID}`
    );

    console.log(
        `📌 Authorized User: ${AUTHORIZED_USER_IDS.join(", ")}`
    );

    console.log(
        `📌 Check interval: ${
            CHECK_INTERVAL_MS / 60000
        } minutes`
    );

    console.log(
        "================================================\n"
    );

    // ========================================================
    // إنشاء handlers قبل تسجيل الدخول
    // ========================================================

    // سننشئ client داخل loginWithWolfLibrary
    // لذلك هنا نحتاج فقط لاستدعاء login أولًا.
    // ========================================================

    await loginWithWolfLibrary();

    // ========================================================
    // بعد إنشاء client وتسجيل الدخول
    // ========================================================

    setupEvents();

    // ========================================================
    // الحالة
    // ========================================================

    try {

        await client.setOnlineState(
            OnlineState.INVISIBLE
        );

        console.log(
            "✅ تم ضبط الحالة إلى Invisible."
        );

    } catch (error) {

        console.error(
            "⚠️ فشل ضبط الحالة:",
            error?.message || error
        );
    }

    // ========================================================
    // مراقبة الاستيج
    // ========================================================

    await startStageMonitoring();

    console.log(
        "\n🤖 البوت يعمل الآن."
    );

    console.log(
        `📨 ${ENTER_COMMAND} = صعود إجباري`
    );

    console.log(
        `📨 ${EXIT_COMMAND} = نزول`
    );

    // ========================================================
    // مدة التشغيل
    // ========================================================

    setTimeout(
        () => {

            gracefulShutdown(
                "انتهاء مدة التشغيل"
            );

        },
        RUN_DURATION_MS
    );
}

// ============================================================
// Signals
// ============================================================

process.on(
    "SIGINT",
    async () => {

        await gracefulShutdown(
            "SIGINT"
        );

        process.exit(0);
    }
);

process.on(
    "SIGTERM",
    async () => {

        await gracefulShutdown(
            "SIGTERM"
        );

        process.exit(0);
    }
);

// ============================================================
// Start
// ============================================================

run().catch(
    async error => {

        console.error(
            "\n❌ FATAL ERROR:"
        );

        console.error(
            error?.message || error
        );

        if (error?.stack) {
            console.error(
                error.stack
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
