import wolfjs from "wolf.js";
import { io } from "socket.io-client";
import { loadSession } from "./session-loader.js";

const { WOLF, OnlineState } = wolfjs;

// ============================================================
// Service Configuration
// ============================================================

const GROUP_ID = 18432094;

const WATCHED_SUBSCRIBER_IDS = [
    51660277,
    35543686,
    80014666,
    16327118,
    5507
];

const LEAVE_COMMAND = "!كات نزول";
const JOIN_COMMAND = "!كات صعود";

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const MAX_OCCUPANTS_TO_JOIN = 1;

// ============================================================
// Session Configuration
// ============================================================

let WOLF_TOKEN = "";
let WOLF_APP_CHECK_TOKEN = "";
let WOLF_DEVICE = "web";
let WOLF_IS_APP_CHECK_ENABLED = false;

// ============================================================
// Load Credentials From Chrome Session
// ============================================================

async function initializeSession() {
    console.log("");
    console.log(
        "🔐 Loading WOLF credentials from Chrome session..."
    );

    const session = await loadSession();

    if (!session) {
        console.error("");
        console.error(
            "❌ WOLF session was not loaded."
        );

        process.exit(1);
    }

    if (!session.token) {
        console.error("");
        console.error(
            "❌ WOLF token was not found in Chrome session."
        );

        process.exit(1);
    }

    if (
        session.isAppCheckEnabled &&
        !session.appCheckToken
    ) {
        console.error("");
        console.error(
            "❌ App Check is enabled but appCheckToken was not found."
        );

        process.exit(1);
    }

    WOLF_TOKEN =
        session.token;

    WOLF_APP_CHECK_TOKEN =
        session.appCheckToken || "";

    WOLF_DEVICE =
        session.device || "web";

    WOLF_IS_APP_CHECK_ENABLED =
        Boolean(
            session.isAppCheckEnabled
        );

    console.log(
        "✅ WOLF credentials loaded from Chrome session"
    );

    console.log(
        `🔐 WOLF token length: ${WOLF_TOKEN.length}`
    );

    console.log(
        `📱 Device: ${WOLF_DEVICE}`
    );

    console.log(
        `🛡️ App Check: ${
            WOLF_IS_APP_CHECK_ENABLED
                ? "enabled"
                : "disabled"
        }`
    );

    if (WOLF_APP_CHECK_TOKEN) {
        console.log(
            `🛡️ App Check token length: ${WOLF_APP_CHECK_TOKEN.length}`
        );
    }
}

// ============================================================
// Runtime Variables
// ============================================================

let service = null;
let socket = null;
let monitorTimer = null;

let autoCheckEnabled = true;
let currentSlotId = null;
let shuttingDown = false;

// ============================================================
// Helpers
// ============================================================

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function isWatchedSubscriber(id) {
    return WATCHED_SUBSCRIBER_IDS.includes(
        Number(id)
    );
}

// ============================================================
// Create Service
// ============================================================

function createService() {
    service = new WOLF();

    service.config.framework.login.token =
        WOLF_TOKEN;

    service.config.framework.login.onlineState =
        OnlineState.INVISIBLE;

    if (WOLF_APP_CHECK_TOKEN) {
        service.config.framework.login.appCheckToken =
            WOLF_APP_CHECK_TOKEN;
    }

    return service;
}

// ============================================================
// Initialize Handlers
// ============================================================

async function initializeHandlers() {
    console.log(
        "⚙️ Initializing service handlers..."
    );

    await service.websocket.init();

    const handlerCount =
        Object.keys(
            service.websocket.handlers || {}
        ).length;

    console.log(
        `⚙️ Loaded ${handlerCount} handlers`
    );
}

// ============================================================
// Private Command Listener
// ============================================================

function setupCommandListener() {
    service.on(
        "privateMessage",
        async message => {
            try {
                const senderId = Number(
                    message?.sourceSubscriberId ??
                    message?.senderId ??
                    message?.sender?.id ??
                    message?.subscriberId
                );

                const text = String(
                    message?.body ??
                    message?.text ??
                    message?.message ??
                    ""
                ).trim();

                if (!senderId || !text) {
                    return;
                }

                if (
                    !isWatchedSubscriber(
                        senderId
                    )
                ) {
                    return;
                }

                console.log(
                    `📩 Command received from ${senderId}: ${text}`
                );

                if (
                    text === LEAVE_COMMAND
                ) {
                    await leaveStage();
                    return;
                }

                if (
                    text === JOIN_COMMAND
                ) {
                    await forceJoinStage();
                    return;
                }

            } catch (error) {
                console.error(
                    "❌ Command listener error:",
                    error?.message || error
                );
            }
        }
    );

    console.log(
        "📡 Command listener active"
    );
}

// ============================================================
// Connect Service
// ============================================================

async function connectService() {
    const connection =
        service._frameworkConfig?.get?.(
            "connection"
        );

    const host =
        connection?.host ||
        "https://v3-rc.palringo.com";

    const port =
        connection?.port ?? 443;

    // ========================================================
    // IMPORTANT:
    // استخدم device القادم من session-loader
    // ولا تستخدم connection.query.device
    // ========================================================

    const device =
        WOLF_DEVICE || "web";

    console.log("");

    console.log(
        "🔌 Starting service connection..."
    );

    console.log(
        `🌐 Host: ${host}`
    );

    console.log(
        `🔌 Port: ${port}`
    );

    console.log(
        `📱 Device: ${device}`
    );

    console.log(
        `🛡️ Security validation: ${
            WOLF_IS_APP_CHECK_ENABLED
                ? "enabled"
                : "disabled"
        }`
    );

    socket = io(
        `${host}:${port}`,
        {
            transports: [
                "websocket"
            ],

            reconnection: true,

            autoConnect: false,

            query: {
                token: WOLF_TOKEN,

                device,

                state:
                    service.config
                        .framework
                        .login
                        .onlineState,

                version:
                    connection?.version ||
                    undefined,

                isAppCheckEnabled:
                    WOLF_IS_APP_CHECK_ENABLED
                        ? "true"
                        : "false",

                appCheckToken:
                    WOLF_IS_APP_CHECK_ENABLED
                        ? WOLF_APP_CHECK_TOKEN
                        : undefined
            }
        }
    );

    service.websocket.socket =
        socket;

    // ========================================================
    // Socket Connected
    // ========================================================

    socket.on(
        "connect",
        async () => {
            console.log("");

            console.log(
                "========================================"
            );

            console.log(
                "🔗 Service connection established"
            );

            console.log(
                `🔗 Connection ID: ${socket.id}`
            );

            console.log(
                "========================================"
            );

            // ==================================================
            // START STAGE IMMEDIATELY
            // لا تنتظر Authorization
            // ==================================================

            try {
                console.log(
                    "🎙️ Starting Stage check immediately..."
                );

                await verifyStageAPI();

                await checkStage();

                if (!currentSlotId) {
                    startMonitoring();
                }

            } catch (error) {
                console.error(
                    "❌ Immediate Stage check error:",
                    error?.message || error
                );
            }
        }
    );

    // ========================================================
    // Connection Error
    // ========================================================

    socket.on(
        "connect_error",
        error => {
            console.error(
                "❌ Connection error:",
                error?.message || error
            );
        }
    );

    // ========================================================
    // Disconnect
    // ========================================================

    socket.on(
        "disconnect",
        reason => {
            console.log(
                `🔌 Connection closed: ${reason}`
            );
        }
    );

    // ========================================================
    // WOLF Events
    // ========================================================

    socket.onAny(
        async (
            eventName,
            data
        ) => {
            try {
                const handler =
                    service.websocket
                        .handlers?.[
                            eventName
                        ];

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

    console.log(
        "🔌 Connecting..."
    );

    socket.connect();

    // ========================================================
    // IMPORTANT:
    // لا يوجد waitForAuthorization()
    // ========================================================

    return;
}

// ============================================================
// Verify Stage API
// ============================================================

async function verifyStageAPI() {
    console.log(
        `🧪 Checking Stage service for group ${GROUP_ID}...`
    );

    await service.stage.getAudioConfig(
        GROUP_ID
    );

    console.log(
        "✅ Stage service is ready"
    );
}

// ============================================================
// Get Stage Slots
// ============================================================

async function getStageSlots() {
    const slots =
        await service.stage.slot.list(
            GROUP_ID
        );

    return Array.isArray(slots)
        ? slots
        : [];
}

// ============================================================
// Automatic Stage Check
// ============================================================

async function checkStage() {
    if (!autoCheckEnabled) {
        return;
    }

    if (currentSlotId) {
        return;
    }

    console.log(
        `🎙️ Checking Stage for group ${GROUP_ID}...`
    );

    try {
        const slots =
            await getStageSlots();

        console.log(
            `📦 Received ${slots.length} slots`
        );

        const occupiedSlots =
            slots.filter(
                slot =>
                    !!slot?.occupierId
            );

        console.log(
            `👥 Current occupants: ${occupiedSlots.length}`
        );

        if (
            occupiedSlots.length >
            MAX_OCCUPANTS_TO_JOIN
        ) {
            console.log(
                "⏭️ Occupancy limit reached, skipping."
            );

            return;
        }

        const freeSlot =
            slots.find(
                slot =>
                    !slot?.occupierId
            );

        if (!freeSlot) {
            console.log(
                "⚠️ No available slot."
            );

            return;
        }

        console.log(
            `🎙️ Joining slot ${freeSlot.id}...`
        );

        await service.stage.slot.join(
            GROUP_ID,
            freeSlot.id
        );

        currentSlotId =
            freeSlot.id;

        console.log(
            `✅ Joined successfully: slot ${currentSlotId}`
        );

        autoCheckEnabled =
            false;

        stopMonitoring();

        console.log(
            "🛑 Automatic checking stopped after joining"
        );

    } catch (error) {
        console.error(
            "❌ Stage check error:",
            error?.message || error
        );
    }
}

// ============================================================
// Force Join
// ============================================================

async function forceJoinStage() {
    console.log(
        `🎙️ Forced Stage join requested for ${GROUP_ID}...`
    );

    try {
        const slots =
            await getStageSlots();

        console.log(
            `📦 Received ${slots.length} slots`
        );

        const freeSlot =
            slots.find(
                slot =>
                    !slot?.occupierId
            );

        if (!freeSlot) {
            console.log(
                "❌ No available slot."
            );

            return;
        }

        console.log(
            `🎙️ Joining slot ${freeSlot.id}...`
        );

        await service.stage.slot.join(
            GROUP_ID,
            freeSlot.id
        );

        currentSlotId =
            freeSlot.id;

        console.log(
            `✅ Joined successfully: slot ${currentSlotId}`
        );

        autoCheckEnabled =
            false;

        stopMonitoring();

        console.log(
            "🛑 Automatic monitoring stopped"
        );

    } catch (error) {
        console.error(
            "❌ Forced join error:",
            error?.message || error
        );
    }
}

// ============================================================
// Leave Stage
// ============================================================

async function leaveStage() {
    if (!currentSlotId) {
        console.log(
            "ℹ️ No active Stage slot."
        );

        return;
    }

    console.log(
        `🛑 Leaving slot ${currentSlotId}...`
    );

    try {
        await service.stage.slot.leave(
            GROUP_ID,
            currentSlotId
        );

        console.log(
            "✅ Stage slot released"
        );

    } catch (error) {
        console.error(
            "❌ Leave operation error:",
            error?.message || error
        );
    }

    currentSlotId = null;

    autoCheckEnabled =
        false;

    stopMonitoring();

    console.log(
        "🛑 Automatic monitoring stopped"
    );
}

// ============================================================
// Monitoring
// ============================================================

function startMonitoring() {
    stopMonitoring();

    if (
        !autoCheckEnabled ||
        currentSlotId
    ) {
        console.log(
            "🛑 Periodic monitoring not required."
        );

        return;
    }

    console.log(
        "🔄 Periodic monitoring started"
    );

    monitorTimer =
        setInterval(
            checkStage,
            CHECK_INTERVAL_MS
        );
}

function stopMonitoring() {
    if (monitorTimer) {
        clearInterval(
            monitorTimer
        );

        monitorTimer = null;
    }
}

// ============================================================
// Shutdown
// ============================================================

async function shutdown(
    signal
) {
    if (shuttingDown) {
        return;
    }

    shuttingDown =
        true;

    console.log("");

    console.log(
        "========================================"
    );

    console.log(
        `🛑 Shutdown requested: ${signal}`
    );

    console.log(
        "========================================"
    );

    stopMonitoring();

    try {
        if (currentSlotId) {
            console.log(
                `🛑 Releasing active slot ${currentSlotId}...`
            );

            await service.stage.slot.leave(
                GROUP_ID,
                currentSlotId
            );

            console.log(
                "✅ Slot released"
            );
        }

    } catch (error) {
        console.error(
            "❌ Failed to release slot:",
            error?.message || error
        );
    }

    try {
        socket?.disconnect();
    } catch {}

    console.log(
        "🔌 Connection closed."
    );

    console.log(
        "👋 Service stopped."
    );

    process.exit(0);
}

process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);

process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);

// ============================================================
// Main
// ============================================================

async function main() {
    console.log(
        "🚀 Service started"
    );

    console.log(
        "========================================"
    );

    console.log(
        "🐺 WOLF 2.7.10"
    );

    console.log(
        "🔐 Loading credentials from Chrome session"
    );

    console.log(
        "========================================"
    );

    // ========================================================
    // Load credentials from Chrome session
    // ========================================================

    await initializeSession();

    console.log(
        `📱 Device: ${WOLF_DEVICE}`
    );

    console.log(
        `🛡️ App Check: ${
            WOLF_IS_APP_CHECK_ENABLED
                ? "enabled"
                : "disabled"
        }`
    );

    // ========================================================
    // Create Service
    // ========================================================

    createService();

    // ========================================================
    // Initialize wolf.js
    // ========================================================

    await initializeHandlers();

    // ========================================================
    // Private Commands
    // ========================================================

    setupCommandListener();

    // ========================================================
    // Connect
    // ========================================================

    await connectService();

    // ========================================================
    // لا يوجد انتظار Authorization
    // ولا يوجد checkStage هنا
    //
    // لأن connectService() يقوم بالفحص
    // مباشرة داخل socket "connect"
    // ========================================================

    console.log(
        "🟢 Socket connection started."
    );

    console.log(
        "👻 Presence configured as Invisible."
    );

    console.log("");

    console.log(
        "========================================"
    );

    console.log(
        "✅ Service is running..."
    );

    console.log(
        `🏠 Group: ${GROUP_ID}`
    );

    console.log(
        `🎙️ Occupancy threshold: ${MAX_OCCUPANTS_TO_JOIN}`
    );

    console.log(
        "⏱️ Check interval: 10 minutes"
    );

    console.log(
        "========================================"
    );
}

// ============================================================
// Start
// ============================================================

main().catch(
    async error => {
        console.error("");

        console.error(
            "❌ FATAL ERROR"
        );

        console.error(
            error?.stack ||
            error?.message ||
            error
        );

        try {
            socket?.disconnect();
        } catch {}

        process.exit(1);
    }
);
