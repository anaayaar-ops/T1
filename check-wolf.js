import 'dotenv/config';
import fs from 'fs';
import sharp from 'sharp';
import wolfjs from 'wolf.js';
import { io } from 'socket.io-client';

const { WOLF, OnlineState } = wolfjs;

// ============================================================
// إعدادات عامة
// ============================================================

const GROUP_ID = 18432094;

// اسم الفعالية الموحد (يتكرر لكل الفعاليات)
const EVENT_NAME = " ᷂فعاليآت ᷂خليجنا،ذوق.";
const TOTAL_EVENTS = 32;
const EVENT_DURATION_MIN = 45;
const IMAGE_PATH = './1783326171737511.jpeg'; // 👈 غيّر الاسم لو غيرت الصورة

// وقت بداية أول فعالية
const START_TIME = new Date(2026, 8, 13, 21, 0, 0);

// ============================================================
// إعدادات البيئة (نفس طريقة البوت الأول - توكن بدل يوزر/باسورد)
// ============================================================

const WOLF_TOKEN = process.env.WOLF_TOKEN;

const WOLF_APP_CHECK_TOKEN =
    process.env.WOLF_APP_CHECK_TOKEN || '';

const WOLF_DEVICE =
    process.env.WOLF_DEVICE || 'web';

const WOLF_IS_APP_CHECK_ENABLED =
    String(process.env.WOLF_IS_APP_CHECK_ENABLED ?? 'false')
        .toLowerCase() === 'true';

if (!WOLF_TOKEN) {
    console.error('');
    console.error('❌ WOLF_TOKEN is missing');
    console.error('Add WOLF_TOKEN to your environment / GitHub Actions Secrets.');
    process.exit(1);
}

if (WOLF_IS_APP_CHECK_ENABLED && !WOLF_APP_CHECK_TOKEN) {
    console.error('');
    console.error('❌ WOLF_APP_CHECK_TOKEN is missing');
    console.error('App Check is enabled but no token was supplied.');
    process.exit(1);
}

// ============================================================
// متغيرات وقت التشغيل
// ============================================================

let service = null;
let socket = null;

// ============================================================
// أدوات مساعدة
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatAMPM(date) {
    let hours = date.getHours();
    let minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutes}${ampm}`;
}

// ============================================================
// إنشاء الخدمة (Service) - بنفس طريقة البوت الأول
// ============================================================

function createService() {
    service = new WOLF();

    service.config.framework.login.token = WOLF_TOKEN;
    service.config.framework.login.onlineState = OnlineState.INVISIBLE;

    if (WOLF_APP_CHECK_TOKEN) {
        service.config.framework.login.appCheckToken = WOLF_APP_CHECK_TOKEN;
    }

    return service;
}

// ============================================================
// تهيئة الـ handlers
// ============================================================

async function initializeHandlers() {
    console.log('⚙️ Initializing service handlers...');

    await service.websocket.init();

    const handlerCount = Object.keys(service.websocket.handlers || {}).length;
    console.log(`⚙️ Loaded ${handlerCount} handlers`);
}

// ============================================================
// الاتصال بالسوكيت - نفس طريقة البوت الأول بالضبط
// ============================================================

async function connectService() {
    const connection = service._frameworkConfig?.get?.('connection');

    const host = connection?.host || 'https://v3-rc.palringo.com';
    const port = connection?.port ?? 443;
    const device = connection?.query?.device || WOLF_DEVICE || 'web';

    console.log('');
    console.log('🔌 Starting service connection...');
    console.log(`🌐 Host: ${host}`);
    console.log(`🔌 Port: ${port}`);
    console.log(`📱 Device: ${device}`);
    console.log(`🛡️ Security validation: ${WOLF_IS_APP_CHECK_ENABLED ? 'enabled' : 'disabled'}`);

    socket = io(`${host}:${port}`, {
        transports: ['websocket'],
        reconnection: true,
        autoConnect: false,
        query: {
            token: WOLF_TOKEN,
            device,
            state: service.config.framework.login.onlineState,
            version: connection?.version || undefined,
            isAppCheckEnabled: WOLF_IS_APP_CHECK_ENABLED ? 'true' : 'false',
            appCheckToken: WOLF_IS_APP_CHECK_ENABLED ? WOLF_APP_CHECK_TOKEN : undefined
        }
    });

    service.websocket.socket = socket;

    socket.on('connect', () => {
        console.log('');
        console.log('========================================');
        console.log('🔗 Service connection established');
        console.log(`🔗 Connection ID: ${socket.id}`);
        console.log('========================================');
    });

    socket.on('connect_error', error => {
        console.error('❌ Connection error:', error?.message || error);
    });

    socket.on('disconnect', reason => {
        console.log(`🔌 Connection closed: ${reason}`);
    });

    socket.onAny(async (eventName, data) => {
        try {
            const handler = service.websocket.handlers?.[eventName];
            if (!handler) return;
            await handler.process(data?.body ?? data);
        } catch (error) {
            console.error(`❌ Handler error [${eventName}]:`, error?.message || error);
        }
    });

    console.log('🔌 Connecting...');
    socket.connect();

    await waitForAuthorization();
}

// ============================================================
// انتظار التوثيق (Authorization)
// ============================================================

async function waitForAuthorization(timeout = 60000) {
    const start = Date.now();

    console.log('⏳ Waiting for authorization...');

    while (Date.now() - start < timeout) {
        if (service.currentSubscriber?.id) {
            console.log('');
            console.log('========================================');
            console.log('✅ Authorization complete');
            console.log(`👤 Account: ${service.currentSubscriber.username || service.currentSubscriber.nickname || 'Unknown'}`);
            console.log(`🆔 Account ID: ${service.currentSubscriber.id}`);
            console.log('========================================');
            return;
        }
        await sleep(500);
    }

    throw new Error('Authorization timeout');
}

// ============================================================
// إنشاء الفعاليات ورفع الصور - نفس منطق البوت الثاني
// ============================================================

async function createEventsAndUploadThumbnails() {
    let startTime = new Date(START_TIME.getTime());
    const createdEventIds = [];

    console.log('🔍 فحص التعارض في الروم...');
    const listRes = await service.websocket.emit('group event list', {
        groupId: GROUP_ID,
        languageId: 1
    });
    const existingEvents = listRes.success ? listRes.body : [];

    for (let i = 0; i < TOTAL_EVENTS; i++) {
        const title = EVENT_NAME;
        const endTime = new Date(startTime.getTime() + EVENT_DURATION_MIN * 60000);

        const isConflicting = existingEvents.some(event => {
            const eStart = new Date(event.startsAt).getTime();
            const eEnd = new Date(event.endsAt).getTime();
            return startTime.getTime() < eEnd && endTime.getTime() > eStart;
        });

        if (isConflicting) {
            console.log(`⚠️ تجاوز [${title}]: الوقت ${formatAMPM(startTime)} محجوز.`);
        } else {
            const response = await service.websocket.emit('group event create', {
                groupId: GROUP_ID,
                title,
                startsAt: startTime.toISOString(),
                endsAt: endTime.toISOString(),
                category: 1, // Challenge
                languageId: 1
            });

            if (response.success) {
                const fTime = formatAMPM(startTime);
                createdEventIds.push(response.body.id.toString());
                console.log(`🚀 تم الرفع: ${title} | الوقت: ${fTime} | ID: ${response.body.id}`);
            } else {
                console.log(`⚠️ فشل إنشاء فعالية [${title}]: ${JSON.stringify(response)}`);
            }
        }

        startTime = new Date(endTime.getTime());
    }

    // ============ رفع الصور بعد ما خلصت كل الفعاليات ============
    console.log('\n🖼️ جاري رفع الصور لكل الفعاليات...');

    if (fs.existsSync(IMAGE_PATH)) {
        const thumbnailBuffer = await sharp(IMAGE_PATH).jpeg({ quality: 90 }).toBuffer();

        for (const id of createdEventIds) {
            try {
                const imageResponse = await service.event.group.updateThumbnail(
                    parseInt(id),
                    thumbnailBuffer
                );
                console.log(imageResponse.success
                    ? `🖼️ تم رفع صورة: ID ${id}`
                    : `⚠️ فشلت صورة ID ${id}: ${JSON.stringify(imageResponse)}`
                );
            } catch (err) {
                console.error(`❌ خطأ برفع صورة ID ${id}:`, err.message);
            }
            await sleep(800);
        }
    } else {
        console.error(`❌ الصورة غير موجودة بالمسار: ${IMAGE_PATH}`);
    }

    console.log('🏁 انتهى الرفع.');
}

// ============================================================
// الإغلاق الآمن
// ============================================================

async function shutdown(exitCode = 0) {
    try {
        socket?.disconnect();
    } catch {}
    console.log('🔌 Connection closed.');
    process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// ============================================================
// التشغيل الرئيسي
// ============================================================

async function main() {
    console.log('🚀 Service started');
    console.log('========================================');
    console.log('🐺 WOLF Merged Bot');
    console.log('🔐 Loading credentials');
    console.log('========================================');
    console.log(`📱 Device: ${WOLF_DEVICE}`);
    console.log(`🛡️ App Check: ${WOLF_IS_APP_CHECK_ENABLED ? 'enabled' : 'disabled'}`);

    createService();
    await initializeHandlers();
    await connectService();

    console.log('🟢 Authorization successful.');
    console.log('👻 Presence set to Invisible.');

    await createEventsAndUploadThumbnails();

    await shutdown(0);
}

main().catch(async error => {
    console.error('');
    console.error('❌ FATAL ERROR');
    console.error(error?.stack || error?.message || error);
    try {
        socket?.disconnect();
    } catch {}
    process.exit(1);
});
