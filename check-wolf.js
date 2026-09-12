import wolfjs from "wolf.js";
import { io } from "socket.io-client";
import WebSocket from "ws";

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
// Environment Configuration
// ============================================================

const WOLF_TOKEN =
    process.env.WOLF_TOKEN;

const WOLF_APP_CHECK_TOKEN =
    process.env.WOLF_APP_CHECK_TOKEN;

const WOLF_DEVICE =
    process.env.WOLF_DEVICE || "web";

const WOLF_IS_APP_CHECK_ENABLED =
    String(
        process.env.WOLF_IS_APP_CHECK_ENABLED
    ).toLowerCase() === "true";

// ============================================================
// Validate Environment
// ============================================================

if (!WOLF_TOKEN) {
    console.error(
        "❌ Required environment value is missing"
    );

    process.exit(1);
}

if (
    WOLF_IS_APP_CHECK_ENABLED &&
    !WOLF_APP_CHECK_TOKEN
) {
    console.error(
        "❌ Security validation value is missing"
    );

    process.exit(1);
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
                    !isWatchedSubscriber(senderId)
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

    const device =
        connection?.query?.device ||
        WOLF_DEVICE ||
        "web";

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
                token:
                    WOLF_TOKEN,

                device,

                state:
                    service.config.framework.login.onlineState,

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

    socket.on(
        "connect",
        () => {
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
        }
    );

    socket.on(
        "connect_error",
        error => {
            console.error(
                "❌ Connection error:",
                error?.message ||
                error
            );
        }
    );

    socket.on(
        "disconnect",
        reason => {
            console.log(
                `🔌 Connection closed: ${reason}`
            );
        }
    );

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
                    data?.body ??
                    data
                );

            } catch (error) {
                console.error(
                    `❌ Handler error [${eventName}]:`,
                    error?.message ||
                    error
                );
            }
        }
    );

    console.log(
        "🔌 Connecting..."
    );

    socket.connect();

    await waitForAuthorization();
}

// ============================================================
// Wait For Authorization
// ============================================================

async function waitForAuthorization(
    timeout = 60000
) {
    const start =
        Date.now();

    console.log(
        "⏳ Waiting for authorization..."
    );

    while (
        Date.now() - start <
        timeout
    ) {
        if (
            service.currentSubscriber?.id
        ) {
            console.log("");
            console.log(
                "========================================"
            );

            console.log(
                "✅ Authorization complete"
            );

            console.log(
                `👤 Account: ${
                    service.currentSubscriber.username ||
                    service.currentSubscriber.nickname ||
                    "Unknown"
                }`
            );

            console.log(
                `🆔 Account ID: ${
                    service.currentSubscriber.id
                }`
            );

            console.log(
                "========================================"
            );

            return;
        }

        await sleep(500);
    }

    throw new Error(
        "Authorization timeout"
    );
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
            error?.message ||
            error
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
            error?.message ||
            error
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
            error?.message ||
            error
        );
    }

    currentSlotId =
        null;

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

        monitorTimer =
            null;
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
            error?.message ||
            error
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
        "🔐 Loading credentials"
    );

    console.log(
        "========================================"
    );

    console.log(
        "🔐 Credentials loaded from environment"
    );

    createService();

    await initializeHandlers();

    setupCommandListener();

    await connectService();

    await verifyStageAPI();

    console.log(
        "🟢 Authorization successful."
    );

    console.log(
        "👻 Presence set to Invisible."
    );

    await checkStage();

    if (!currentSlotId) {
        startMonitoring();
    }

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
