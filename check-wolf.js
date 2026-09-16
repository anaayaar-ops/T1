import wolfjs from 'wolf.js';
import { io } from 'socket.io-client';

import {
    loadSession,
    closeSessionBrowser
} from './session-loader.js';

const { WOLF, OnlineState } = wolfjs;

// ============================================================
// ⚙️ الإعدادات
// ============================================================

const settings = {

    // القناة التي سيتم الإرسال إليها
    channelId: 224,

    // ========================================================
    // المهمة الأولى: هجوم
    // ========================================================
    attack: {
        message: "!ملوك هجوم",
        repeat: 3,
        gapMs: 1000,           // ثانية بين كل رسالة
        waitMs: 5 * 60 * 1000 + 1000  // 5:01 دقائق
    },

    // ========================================================
    // المهمة الثانية: تدريب
    // ========================================================
    training: {
        message: "!ملوك تدريب",
        repeat: 1,
        gapMs: 0,
        waitMs: 2 * 60 * 1000 + 1000  // 2:01 دقائق
    },

    // ========================================================
    // المهمة الثالثة: مرتزقة
    // ========================================================
    mercenary: {
        message: "!ملوك مرتزقة 🪶",
        repeat: 3,
        gapMs: 1000,           // ثانية بين كل رسالة
        waitMs: 10 * 60 * 1000 + 1000 // 10:01 دقائق
    }
};

// ============================================================
// ⚙️ متغيرات الاتصال
// ============================================================

let service = null;
let socket = null;
let browserClosed = false;
let running = true;

// ============================================================
// أدوات مساعدة
// ============================================================

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

// ============================================================
// إغلاق آمن
// ============================================================

async function shutdown(code = 0) {

    running = false;

    console.log('');
    console.log('========================================');
    console.log('🛑 جاري إنهاء التشغيل...');
    console.log('========================================');

    try {
        if (socket) socket.disconnect();
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

    console.log(`🏁 انتهى البرنامج — Code ${code}`);
    process.exit(code);
}

// ============================================================
// انتظار Authorization
// ============================================================

async function waitForSubscriber(timeoutMs = 60000) {

    const started = Date.now();

    console.log('⏳ انتظار Authorization...');

    while (Date.now() - started < timeoutMs) {

        if (service?.currentSubscriber?.id) {

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
                `🆔 ID: ${service.currentSubscriber.id}`
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

    console.log('⚙️ تهيئة WOLF handlers...');

    await service.websocket.init();

    const count = Object.keys(
        service.websocket.handlers || {}
    ).length;

    console.log(`⚙️ تم تحميل ${count} handlers`);
}

// ============================================================
// الاتصال باستخدام Chrome Profile
// ============================================================

async function connectUsingChromeProfile(credentials) {

    const token = credentials?.token;
    const appCheckToken = credentials?.appCheckToken || '';
    const device = credentials?.device || 'web';

    const isAppCheckEnabled = Boolean(
        credentials?.isAppCheckEnabled ?? appCheckToken
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

    console.log(`🔐 WOLF Token length: ${token.length}`);
    console.log(
        appCheckToken
            ? `🛡️ AppCheck length: ${appCheckToken.length}`
            : '⚠️ AppCheck Token غير موجود'
    );
    console.log(`📱 Device: ${device}`);
    console.log(
        `🛡️ App Check: ${
            isAppCheckEnabled ? 'enabled' : 'disabled'
        }`
    );
    console.log('========================================');

    service = new WOLF();

    service.config.framework.login.token = token;
    service.config.framework.login.onlineState =
        OnlineState.BUSY;

    if (appCheckToken) {
        service.config.framework.login.appCheckToken =
            appCheckToken;
    }

    await initializeHandlers();

    const connection =
        service._frameworkConfig?.get?.('connection');

    const host =
        connection?.host || 'https://v3-rc.palringo.com';

    const port = connection?.port ?? 443;

    const connectionDevice =
        connection?.query?.device || device || 'web';

    console.log('');
    console.log('========================================');
    console.log('🔌 بدء اتصال WOLF');
    console.log('========================================');
    console.log(`🌐 Host: ${host}`);
    console.log(`🔌 Port: ${port}`);
    console.log(`📱 Device: ${connectionDevice}`);
    console.log('👻 Online State: INVISIBLE');

    socket = io(
        `${host}:${port}`,
        {
            transports: ['websocket'],
            reconnection: true,
            autoConnect: false,
            query: {
                token,
                device: connectionDevice,
                state:
                    service.config.framework
                        .login.onlineState,
                version: connection?.version || undefined,
                isAppCheckEnabled:
                    isAppCheckEnabled ? 'true' : 'false',
                appCheckToken:
                    isAppCheckEnabled
                        ? appCheckToken
                        : undefined
            }
        }
    );

    service.websocket.socket = socket;

    socket.on('connect', () => {
        console.log('');
        console.log('========================================');
        console.log('🔗 تم الاتصال بـ WOLF Socket.IO');
        console.log(`🔗 Connection ID: ${socket.id}`);
        console.log('👻 الحالة: Invisible');
        console.log('========================================');
    });

    socket.on('connect_error', error => {
        console.error(
            '❌ Connection error:',
            error?.message || error
        );
    });

    socket.on('disconnect', reason => {
        console.log(`🔌 Connection closed: ${reason}`);
    });

    socket.onAny(async (eventName, data) => {
        try {
            if (eventName === 'group event update') return;

            const handler =
                service.websocket.handlers?.[eventName];

            if (!handler) return;

            await handler.process(data?.body ?? data);

        } catch (error) {
            console.error(
                `❌ Handler error [${eventName}]:`,
                error?.message || error
            );
        }
    });

    console.log('🔌 Connecting...');

    socket.connect();

    const ready = await waitForSubscriber(60000);

    if (!ready) {
        throw new Error(
            'WOLF اتصل لكن Authorization لم يكتمل.'
        );
    }

    console.log('');
    console.log('🟢 WOLF جاهز.');
}

// ============================================================
// إرسال رسالة إلى القناة
// ============================================================

async function sendToChannel(text) {

    try {

        await service.messaging.sendGroupMessage(
            settings.channelId,
            text
        );

        console.log(
            `🚀 [${settings.channelId}] ← "${text}"`
        );

    } catch (err) {

        console.error(
            `❌ فشل إرسال "${text}":`,
            err?.message || err
        );
    }
}

// ============================================================
// حلقة مهمة عامة
// ============================================================

async function taskLoop(name, config) {

    while (running) {

        try {

            console.log('');
            console.log(
                `▶️ [${name}] بدء الجولة — إرسال ${config.repeat} مرة`
            );

            for (let i = 0; i < config.repeat; i++) {

                if (!running) return;

                await sendToChannel(config.message);

                if (
                    i < config.repeat - 1 &&
                    config.gapMs > 0
                ) {
                    await sleep(config.gapMs);
                }
            }

            const waitSec = Math.round(
                config.waitMs / 1000
            );

            console.log(
                `⏳ [${name}] انتظار ${waitSec} ثانية...`
            );

            await sleep(config.waitMs);

        } catch (err) {

            console.error(
                `❌ [${name}] خطأ في الحلقة:`,
                err?.message || err
            );

            await sleep(5000);
        }
    }
}

// ============================================================
// تشغيل المهام الثلاث
// ============================================================

function startTasks() {

    console.log('');
    console.log('========================================');
    console.log('⚙️ تشغيل المهام');
    console.log('========================================');
    console.log(`🏠 القناة: ${settings.channelId}`);
    console.log(
        `1️⃣ هجوم    : "${settings.attack.message}" × ${settings.attack.repeat} كل 5:01 د`
    );
    console.log(
        `2️⃣ تدريب   : "${settings.training.message}" × ${settings.training.repeat} كل 2:01 د`
    );
    console.log(
        `3️⃣ مرتزقة  : "${settings.mercenary.message}" × ${settings.mercenary.repeat} كل 10:01 د`
    );
    console.log('========================================');

    // تشغيل المهام بالتوازي — كل واحدة مستقلة تماماً
    taskLoop('هجوم', settings.attack);
    taskLoop('تدريب', settings.training);
    taskLoop('مرتزقة', settings.mercenary);
}

// ============================================================
// البرنامج الرئيسي
// ============================================================

async function main() {

    console.log('');
    console.log('========================================');
    console.log('🐺 WOLF Bot — Multi-Task');
    console.log('🐺 wolf.js 2.7.10');
    console.log('========================================');
    console.log('');

    try {

        console.log(
            '🌐 قراءة جلسة WOLF من Chrome Profile...'
        );

        const credentials = await loadSession();

        if (!credentials?.token) {
            throw new Error(
                'لم يتم العثور على v3APIToken في جلسة Chrome.'
            );
        }

        console.log('✅ تم العثور على توكن WOLF');

        if (credentials.appCheckToken) {
            console.log(
                `🛡️ AppCheck length: ${credentials.appCheckToken.length}`
            );
            console.log('✅ تم العثور على App Check Token');
        } else {
            console.log('⚠️ لا يوجد App Check Token');
        }

        console.log(
            `📱 Device: ${credentials.device || 'web'}`
        );

        await connectUsingChromeProfile(credentials);

        // ضبط الحالة Invisible
        try {
            await service.setOnlineState(OnlineState.BUSY);
            console.log('👻 تم ضبط الحالة إلى Invisible');
        } catch (err) {
            console.log(
                '⚠️ تعذر ضبط الحالة عبر API:',
                err?.message || err
            );
        }

        // تشغيل المهام
        startTasks();

        console.log('');
        console.log('========================================');
        console.log('🟢 البوت يعمل الآن');
        console.log('👻 الحالة: Invisible');
        console.log('========================================');

    } catch (err) {

        console.error('');
        console.error('========================================');
        console.error('❌ حصل خطأ');
        console.error('========================================');

        console.error(
            err?.stack || err?.message || err
        );

        await shutdown(1);
    }
}

// ============================================================
// إيقاف آمن
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
