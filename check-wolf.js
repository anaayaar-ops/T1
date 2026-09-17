// ============================================================
// WOLF Bot — check-wolf.js
// ============================================================

process.on('uncaughtException', err => {
    console.error('💥 UNCAUGHT EXCEPTION:', err?.stack || err);
    process.exitCode = 1;
});
process.on('unhandledRejection', err => {
    console.error('💥 UNHANDLED REJECTION:', err?.stack || err);
    process.exitCode = 1;
});

console.log('🚀 check-wolf.js starting...');

// ============================================================
// الإعدادات
// ============================================================

const settings = {
    channelId: 224,
    attack: { message: "!ملوك هجوم", repeat: 3, gapMs: 1000, waitMs: 5 * 60 * 1000 + 1000 },
    training: { message: "!ملوك تدريب", repeat: 1, gapMs: 0, waitMs: 2 * 60 * 1000 + 1000 },
    mercenary: { message: "!ملوك مرتزقة 🪶", repeat: 3, gapMs: 1000, waitMs: 10 * 60 * 1000 + 1000 }
};

// ============================================================
// متغيرات عامة
// ============================================================

let wolfjs = null;
let io = null;
let loadSession = null;
let closeSessionBrowser = null;
let OnlineState = null;

let service = null;
let socket = null;
let browserClosed = false;
let running = true;
let shuttingDown = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
// إغلاق سلس
// ============================================================

async function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    running = false;

    console.log('\n🛑 جاري إنهاء التشغيل...');
    try { if (socket) socket.disconnect(); } catch {}
    try { if (service?.websocket?.socket) service.websocket.socket.disconnect(); } catch {}
    try {
        if (!browserClosed && typeof closeSessionBrowser === 'function') {
            browserClosed = true;
            await closeSessionBrowser();
        }
    } catch (err) {}

    process.exitCode = code;
    setTimeout(() => process.exit(code), 3000).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));

// ============================================================
// انتظار Authorization
// ============================================================

async function waitForSubscriber(timeoutMs = 60000) {
    const started = Date.now();
    console.log('⏳ انتظار Authorization...');

    while (Date.now() - started < timeoutMs) {
        if (service?.currentSubscriber?.id) {
            console.log('✅ Authorization complete');
            console.log(`👤 الحساب: ${service.currentSubscriber.username || service.currentSubscriber.nickname || 'غير معروف'}`);
            return true;
        }
        await sleep(500);
    }
    return false;
}

// ============================================================
// تهيئة المعالجات
// ============================================================

async function initializeHandlers() {
    console.log('⚙️ تهيئة WOLF handlers...');
    await service.websocket.init();
    const count = Object.keys(service.websocket.handlers || {}).length;
    console.log(`⚙️ تم تحميل ${count} handlers`);
}

// ============================================================
// الاتصال باستخدام Chrome Profile
// ============================================================

async function connectUsingChromeProfile(credentials) {
    const token = credentials?.token;
    const appCheckToken = credentials?.appCheckToken || '';
    const device = credentials?.device || 'web';

    // ✅ منع الاتصال إذا لم يوجد appCheckToken
    if (!appCheckToken) {
        throw new Error('❌ لا يمكن الاتصال بـ WOLF بدون appCheckToken. Firebase رفض توليده، غالباً بسبب حظر IP السيرفر.');
    }

    if (!token) throw new Error('لم يتم العثور على v3APIToken.');

    console.log('🔐 Token length:', token.length);
    console.log('🛡️ AppCheck length:', appCheckToken.length);

    service = new wolfjs.WOLF();
    service.config.framework.login.token = token;
    service.config.framework.login.onlineState = OnlineState.BUSY;
    service.config.framework.login.appCheckToken = appCheckToken;

    await initializeHandlers();

    const connection = service._frameworkConfig?.get?.('connection');
    const host = connection?.host || 'https://v3-rc.palringo.com';
    const port = connection?.port ?? 443;

    console.log(`🌐 Host: ${host}:${port}`);

    socket = io(`${host}:${port}`, {
        transports: ['websocket'],
        reconnection: true,
        autoConnect: false,
        query: {
            token,
            device: device,
            state: service.config.framework.login.onlineState,
            isAppCheckEnabled: 'true',
            appCheckToken: appCheckToken
        }
    });

    service.websocket.socket = socket;

    socket.on('connect', () => console.log(`🔗 Connected — socket.id=${socket.id}`));
    socket.on('connect_error', error => console.error('❌ Connection error:', error?.message || error));
    socket.on('disconnect', reason => console.log(`🔌 Disconnected: ${reason}`));

    socket.onAny(async (eventName, data) => {
        try {
            if (eventName === 'group event update') return;
            const handler = service.websocket.handlers?.[eventName];
            if (!handler) return;
            await handler.process(data?.body ?? data);
        } catch (error) {
            console.error(`❌ Handler error [${eventName}]:`, error?.message || error);
        }
    });

    console.log('🔌 Connecting...');
    socket.connect();

    const ready = await waitForSubscriber(60000);
    if (!ready) throw new Error('WOLF اتصل لكن Authorization لم يكتمل.');
    console.log('🟢 WOLF جاهز.');
}

// ============================================================
// إرسال رسالة
// ============================================================

async function sendToChannel(text) {
    try {
        await service.messaging.sendGroupMessage(settings.channelId, text);
        console.log(`🚀 [${settings.channelId}] ← "${text}"`);
    } catch (err) {
        console.error(`❌ فشل إرسال "${text}":`, err?.message || err);
    }
}

// ============================================================
// حلقة المهام
// ============================================================

async function taskLoop(name, config) {
    while (running) {
        try {
            console.log(`▶️ [${name}] إرسال ${config.repeat} مرة`);
            for (let i = 0; i < config.repeat; i++) {
                if (!running) return;
                await sendToChannel(config.message);
                if (i < config.repeat - 1 && config.gapMs > 0) await sleep(config.gapMs);
            }
            console.log(`⏳ [${name}] انتظار ${Math.round(config.waitMs / 1000)} ثانية`);
            await sleep(config.waitMs);
        } catch (err) {
            console.error(`❌ [${name}] خطأ:`, err?.message || err);
            await sleep(5000);
        }
    }
}

function startTasks() {
    console.log('\n⚙️ تشغيل المهام');
    taskLoop('هجوم', settings.attack);
    taskLoop('تدريب', settings.training);
    taskLoop('مرتزقة', settings.mercenary);
}

function startHeartbeat() {
    setInterval(() => {
        if (!running) return;
        const connected = socket?.connected;
        console.log(`💓 Heartbeat | socket=${connected ? 'ON' : 'OFF'} | queue/status`);
        if (!connected && socket) { try { socket.connect(); } catch {} }
    }, 60000).unref();
}

// ============================================================
// main
// ============================================================

async function main() {
    console.log('🐺 WOLF Bot — Multi-Task');
    console.log('📥 تحميل الحزم...');

    const wolfMod = await import('wolf.js');
    wolfjs = wolfMod.default || wolfMod;
    OnlineState = wolfjs.OnlineState;

    const socketMod = await import('socket.io-client');
    io = socketMod.io || socketMod.default?.io || socketMod.default;

    const loaderMod = await import('./session-loader.js');
    loadSession = loaderMod.loadSession;
    closeSessionBrowser = loaderMod.closeSessionBrowser;
    console.log('✅ الحزم محمّلة');

    console.log('🌐 قراءة جلسة WOLF...');
    const credentials = await loadSession();
    if (!credentials?.token) throw new Error('لم يتم العثور على v3APIToken.');

    await connectUsingChromeProfile(credentials);
    await service.setOnlineState(OnlineState.BUSY);

    startTasks();
    startHeartbeat();

    console.log('\n🟢 البوت يعمل الآن');

    const AUTO_SHUTDOWN_MS = (4 * 60 + 55) * 60 * 1000;
    setTimeout(() => {
        console.log('⏰ انتهت مدة التشغيل التلقائي — إغلاق سلس');
        shutdown(0);
    }, AUTO_SHUTDOWN_MS);
}

main().catch(async err => {
    console.error('\n❌ FATAL ERROR');
    console.error(err?.stack || err?.message || err);
    await shutdown(1);
});
