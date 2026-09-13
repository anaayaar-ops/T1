import wolfjs from "wolf.js";
import { io } from "socket.io-client";
import { loadSession } from "./session-loader.js";

const { WOLF, OnlineState } = wolfjs;

// ============================================================
// Configuration
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
// Diagnostics
// ============================================================

const DEBUG_SOCKET_EVENTS = true;
const DEBUG_SOCKET_OUTGOING = true;
const MAX_DEBUG_EVENTS = 100;

let debugEventCount = 0;
let debugOutgoingCount = 0;

// ============================================================
// Environment
// ============================================================

let WOLF_TOKEN = process.env.WOLF_TOKEN || "";

const WOLF_APP_CHECK_TOKEN =
    process.env.WOLF_APP_CHECK_TOKEN || "";

const WOLF_DEVICE =
    process.env.WOLF_DEVICE || "web";

const WOLF_IS_APP_CHECK_ENABLED =
    String(
        process.env.WOLF_IS_APP_CHECK_ENABLED ?? "false"
    ).toLowerCase() === "true";

// ============================================================
// Runtime state
// ============================================================

let service = null;
let socket = null;
let monitorTimer = null;

let autoCheckEnabled = true;
let currentSlotId = null;
let shuttingDown = false;

let connectionAttempts = 0;
let connectionCount = 0;
let disconnectCount = 0;

// ============================================================
// Helpers
// ============================================================

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function safeJson(value, maxLength = 4000) {
    try {
        const seen = new WeakSet();

        const json = JSON.stringify(
            value,
            (key, val) => {
                if (
                    key === "token" ||
                    key === "v3APIToken" ||
                    key === "appCheckToken" ||
                    key === "deviceToken" ||
                    key === "authorization" ||
                    key === "Authorization"
                ) {
                    return "[REDACTED]";
                }

                if (
                    typeof val === "object" &&
                    val !== null
                ) {
                    if (seen.has(val)) {
                        return "[Circular]";
                    }

                    seen.add(val);
                }

                return val;
            }
        );

        if (!json) {
            return String(value);
        }

        if (json.length > maxLength) {
            return (
                json.slice(0, maxLength) +
                "... [truncated]"
            );
        }

        return json;

    } catch (error) {
        return `[Unable to serialize: ${error?.message || error}]`;
    }
}

function getSubscriberId(source) {
    return (
        source?.sourceSubscriberId ??
        source?.senderId ??
        source?.sender?.id ??
        source?.subscriberId ??
        source?.subscriber?.id ??
        null
    );
}

function getMessageText(source) {
    return String(
        source?.body ??
        source?.text ??
        source?.message ??
        ""
    ).trim();
}

// ============================================================
// Create WOLF service
// ============================================================

function createService() {
    console.log(
        "⚙️ Creating WOLF service..."
    );

    service = new WOLF();

    service.config.framework.login.token =
        WOLF_TOKEN;

    service.config.framework.login.onlineState =
        OnlineState.INVISIBLE;

    if (WOLF_APP_CHECK_TOKEN) {
        service.config.framework.login.appCheckToken =
            WOLF_APP_CHECK_TOKEN;
    }

    console.log(
        "⚙️ WOLF service created."
    );
}

// ============================================================
// Initialize handlers
// ============================================================

async function initializeHandlers() {
    console.log(
        "⚙️ Initializing service handlers..."
    );

    if (
        !service?.websocket ||
        typeof service.websocket.init !==
            "function"
    ) {
        throw new Error(
            "WOLF websocket API is not available."
        );
    }

    await service.websocket.init();

    const handlers =
        service.websocket.handlers || {};

    console.log(
        `⚙️ Loaded ${Object.keys(handlers).length} handlers`
    );
}

// ============================================================
// Private command listener
// ============================================================

function setupCommandListener() {
    if (!service) {
        throw new Error(
            "Service is not initialized."
        );
    }

    service.on(
        "privateMessage",
        async message => {
            try {
                const senderId =
                    getSubscriberId(message);

                const text =
                    getMessageText(message);

                if (!senderId || !text) {
                    return;
                }

                const numericSenderId =
                    Number(senderId);

                if (
                    !WATCHED_SUBSCRIBER_IDS.includes(
                        numericSenderId
                    )
                ) {
                    return;
                }

                console.log(
                    `[PRIVATE ${numericSenderId}] ${text}`
                );

                if (
                    text.toLowerCase() ===
                    LEAVE_COMMAND.toLowerCase()
                ) {
                    await leaveStage();
                    return;
                }

                if (
                    text.toLowerCase() ===
                    JOIN_COMMAND.toLowerCase()
                ) {
                    await forceJoinStage();
                    return;
                }

            } catch (error) {
                console.error(
                    "❌ Private command error:",
                    error
                );
            }
        }
    );

    console.log(
        "📡 Command listener active"
    );
}

// ============================================================
// Socket diagnostics
// ============================================================

function installSocketDiagnostics() {
    if (!socket) {
        return;
    }

    // --------------------------------------------------------
    // Engine.IO diagnostics
    // --------------------------------------------------------

    socket.io.on(
        "open",
        () => {
            console.log(
                "🟢 Engine.IO: OPEN"
            );
        }
    );

    socket.io.on(
        "close",
        reason => {
            console.log(
                `🔴 Engine.IO: CLOSE`
            );

            console.log(
                `🔴 Engine.IO close reason: ${reason}`
            );
        }
    );

    socket.io.on(
        "error",
        error => {
            console.error(
                "❌ Engine.IO error:",
                error?.message ||
                safeJson(error)
            );
        }
    );

    socket.io.on(
        "ping",
        () => {
            console.log(
                "💓 Engine.IO: PING"
            );
        }
    );

    socket.io.on(
        "packet",
        packet => {
            if (!DEBUG_SOCKET_EVENTS) {
                return;
            }

            console.log(
                `📦 Engine packet: type=${packet?.type}`
            );
        }
    );

    // --------------------------------------------------------
    // Socket.IO incoming events
    // --------------------------------------------------------

    socket.onAny(
        async (
            eventName,
            data
        ) => {

            if (
                DEBUG_SOCKET_EVENTS &&
                debugEventCount <
                    MAX_DEBUG_EVENTS
            ) {
                debugEventCount++;

                console.log(
                    "📥 SOCKET EVENT"
                );

                console.log(
                    `   Event: ${eventName}`
                );

                console.log(
                    `   Data: ${safeJson(data)}`
                );
            }

            try {
                const handlers =
                    service.websocket.handlers ||
                    {};

                const handler =
                    handlers[eventName];

                if (
                    !handler ||
                    typeof handler.process !==
                        "function"
                ) {
                    return;
                }

                await handler.process(
                    data?.body ?? data
                );

            } catch (error) {
                console.error(
                    `❌ Handler error [${eventName}]:`,
                    error
                );
            }
        }
    );

    // --------------------------------------------------------
    // Socket.IO outgoing events
    // --------------------------------------------------------

    if (
        DEBUG_SOCKET_OUTGOING
    ) {
        socket.onAnyOutgoing(
            (
                eventName,
                ...args
            ) => {

                if (
                    debugOutgoingCount >=
                    MAX_DEBUG_EVENTS
                ) {
                    return;
                }

                debugOutgoingCount++;

                console.log(
                    "📤 SOCKET OUTGOING"
                );

                console.log(
                    `   Event: ${eventName}`
                );

                console.log(
                    `   Data: ${safeJson(args)}`
                );
            }
        );
    }
}

// ============================================================
// Socket.IO connection
// ============================================================

async function connectService() {
    console.log(
        "🔌 Starting service connection..."
    );

    const connection =
        service?._frameworkConfig
            ?.get?.("connection");

    if (!connection) {
        throw new Error(
            "WOLF connection configuration was not found."
        );
    }

    const host =
        connection.host ||
        "https://v3-rc.palringo.com";

    const port =
        connection.port ?? 443;

    // IMPORTANT:
    // Do not use connection.query.device.
    // Force the environment device.
    const device =
        WOLF_DEVICE || "web";

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

    console.log(
        `🔐 Token loaded: ${
            WOLF_TOKEN
                ? "yes"
                : "no"
        }`
    );

    console.log(
        `🔐 Token length: ${
            WOLF_TOKEN
                ? WOLF_TOKEN.length
                : 0
        }`
    );

    console.log(
        `🛡️ App Check token loaded: ${
            WOLF_APP_CHECK_TOKEN
                ? "yes"
                : "no"
        }`
    );

    console.log(
        `⚙️ Connection version: ${
            connection.version ||
            "not specified"
        }`
    );

    const socketQuery = {
        token: WOLF_TOKEN,

        device,

        state:
            service.config.framework.login.onlineState,

        version:
            connection.version ||
            undefined,

        isAppCheckEnabled:
            WOLF_IS_APP_CHECK_ENABLED
                ? "true"
                : "false"
    };

    if (
        WOLF_IS_APP_CHECK_ENABLED &&
        WOLF_APP_CHECK_TOKEN
    ) {
        socketQuery.appCheckToken =
            WOLF_APP_CHECK_TOKEN;
    }

    // Safe query logging
    console.log(
        "🔎 Socket query:"
    );

    console.log(
        safeJson(socketQuery)
    );

    socket = io(
        `${host}:${port}`,
        {
            transports: [
                "websocket"
            ],

            reconnection: true,

            reconnectionAttempts:
                Infinity,

            reconnectionDelay:
                2000,

            reconnectionDelayMax:
                10000,

            timeout:
                20000,

            autoConnect:
                false,

            query:
                socketQuery
        }
    );

    service.websocket.socket =
        socket;

    installSocketDiagnostics();

    // --------------------------------------------------------
    // Connect
    // --------------------------------------------------------

    socket.on(
        "connect",
        () => {
            connectionCount++;

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
                `🔗 Connection count: ${connectionCount}`
            );

            console.log(
                `🔗 Socket connected: ${socket.connected}`
            );

            console.log(
                `🔗 Transport: ${
                    socket.io?.engine?.transport?.name ||
                    "unknown"
                }`
            );

            console.log(
                "========================================"
            );
        }
    );

    // --------------------------------------------------------
    // Connect error
    // --------------------------------------------------------

    socket.on(
        "connect_error",
        error => {
            console.error(
                "========================================"
            );

            console.error(
                "❌ SOCKET CONNECT ERROR"
            );

            console.error(
                `❌ Message: ${
                    error?.message ||
                    "unknown"
                }`
            );

            console.error(
                `❌ Name: ${
                    error?.name ||
                    "unknown"
                }`
            );

            console.error(
                `❌ Description: ${
                    error?.description ||
                    "none"
                }`
            );

            console.error(
                `❌ Context: ${
                    safeJson(
                        error?.context
                    )
                }`
            );

            console.error(
                `❌ Data: ${
                    safeJson(
                        error?.data
                    )
                }`
            );

            console.error(
                `❌ Stack: ${
                    error?.stack ||
                    "none"
                }`
            );

            console.error(
                "========================================"
            );
        }
    );

    // --------------------------------------------------------
    // Disconnect
    // --------------------------------------------------------

    socket.on(
        "disconnect",
        (
            reason,
            details
        ) => {
            disconnectCount++;

            console.error(
                "========================================"
            );

            console.error(
                "🔴 SOCKET DISCONNECTED"
            );

            console.error(
                `🔴 Reason: ${reason}`
            );

            console.error(
                `🔴 Disconnect count: ${disconnectCount}`
            );

            console.error(
                `🔴 Socket connected: ${socket.connected}`
            );

            console.error(
                `🔴 Details: ${safeJson(details)}`
            );

            console.error(
                `🔴 Engine readyState: ${
                    socket.io?.engine?.readyState ||
                    "unknown"
                }`
            );

            console.error(
                `🔴 Engine transport: ${
                    socket.io?.engine?.transport?.name ||
                    "unknown"
                }`
            );

            console.error(
                `🔴 Current subscriber: ${
                    safeJson(
                        service?.currentSubscriber
                    )
                }`
            );

            console.error(
                "========================================"
            );
        }
    );

    // --------------------------------------------------------
    // Generic socket error
    // --------------------------------------------------------

    socket.on(
        "error",
        error => {
            console.error(
                "❌ SOCKET ERROR EVENT:"
            );

            console.error(
                safeJson(error)
            );
        }
    );

    // --------------------------------------------------------
    // Connect
    // --------------------------------------------------------

    connectionAttempts++;

    console.log(
        `🔄 Connection attempt: ${connectionAttempts}`
    );

    console.log(
        "🔌 Connecting..."
    );

    socket.connect();

    await waitForAuthorization();
}

// ============================================================
// Wait for WOLF authorization
// ============================================================

async function waitForAuthorization() {
    console.log(
        "⏳ Waiting for authorization..."
    );

    const timeout =
        Date.now() +
        60 * 1000;

    let lastSubscriberId =
        null;

    let lastStateLog =
        0;

    while (
        Date.now() <
        timeout
    ) {
        try {
            const subscriber =
                service.currentSubscriber;

            if (
                subscriber?.id
            ) {
                const id =
                    Number(
                        subscriber.id
                    );

                if (
                    id !==
                    lastSubscriberId
                ) {
                    lastSubscriberId =
                        id;

                    console.log(
                        "========================================"
                    );

                    console.log(
                        "🟢 WOLF AUTHORIZATION DETECTED"
                    );

                    console.log(
                        `👤 ID: ${id}`
                    );

                    console.log(
                        `👤 Username: ${
                            subscriber.username ||
                            "unknown"
                        }`
                    );

                    console.log(
                        `👤 Nickname: ${
                            subscriber.nickname ||
                            subscriber.displayName ||
                            "unknown"
                        }`
                    );

                    console.log(
                        "========================================"
                    );
                }

                return true;
            }

            // Periodic status
            if (
                Date.now() -
                    lastStateLog >
                5000
            ) {
                lastStateLog =
                    Date.now();

                console.log(
                    `⏳ Still waiting... socket.connected=${socket?.connected}, subscriber=${
                        service?.currentSubscriber
                            ? "present"
                            : "missing"
                    }`
                );
            }

        } catch (error) {
            console.error(
                "❌ Authorization check error:",
                error
            );
        }

        await sleep(1000);
    }

    console.error(
        "========================================"
    );

    console.error(
        "❌ AUTHORIZATION TIMEOUT"
    );

    console.error(
        `❌ Socket connected: ${
            socket?.connected
        }`
    );

    console.error(
        `❌ Socket ID: ${
            socket?.id ||
            "none"
        }`
    );

    console.error(
        `❌ Current subscriber: ${
            safeJson(
                service?.currentSubscriber
            )
        }`
    );

    console.error(
        "========================================"
    );

    throw new Error(
        "Authorization timeout: WOLF subscriber was not initialized."
    );
}

// ============================================================
// Verify Stage API
// ============================================================

async function verifyStageAPI() {
    console.log(
        "🎙️ Verifying Stage API..."
    );

    if (!service?.stage) {
        throw new Error(
            "service.stage is not available."
        );
    }

    if (
        typeof service.stage.getAudioConfig !==
        "function"
    ) {
        throw new Error(
            "service.stage.getAudioConfig() is not available."
        );
    }

    if (
        !service.stage.slot ||
        typeof service.stage.slot.list !==
            "function"
    ) {
        throw new Error(
            "service.stage.slot.list() is not available."
        );
    }

    if (
        typeof service.stage.slot.join !==
        "function"
    ) {
        throw new Error(
            "service.stage.slot.join() is not available."
        );
    }

    if (
        typeof service.stage.slot.leave !==
        "function"
    ) {
        throw new Error(
            "service.stage.slot.leave() is not available."
        );
    }

    console.log(
        "✅ Stage API verified."
    );
}

// ============================================================
// Get Stage slots
// ============================================================

async function getStageSlots() {
    await service.stage.getAudioConfig(
        GROUP_ID
    );

    const slots =
        await service.stage.slot.list(
            GROUP_ID
        );

    if (!Array.isArray(slots)) {
        return [];
    }

    return slots;
}

// ============================================================
// Find current bot slot
// ============================================================

function findCurrentSlot(
    slots
) {
    const currentSubscriberId =
        Number(
            service?.currentSubscriber?.id
        );

    if (!currentSubscriberId) {
        return null;
    }

    return (
        slots.find(
            slot =>
                Number(
                    slot?.occupierId
                ) ===
                currentSubscriberId
        ) || null
    );
}

// ============================================================
// Automatic Stage check
// ============================================================

async function checkStage() {
    if (shuttingDown) {
        return;
    }

    if (!autoCheckEnabled) {
        return;
    }

    if (currentSlotId) {
        return;
    }

    try {
        console.log(
            "🎙️ Checking Stage..."
        );

        const slots =
            await getStageSlots();

        console.log(
            `🎙️ Stage slots: ${slots.length}`
        );

        const occupiedSlots =
            slots.filter(
                slot =>
                    slot?.occupierId !=
                    null
            );

        console.log(
            `👥 Occupied slots: ${occupiedSlots.length}`
        );

        if (
            occupiedSlots.length >
            MAX_OCCUPANTS_TO_JOIN
        ) {
            console.log(
                `⏭️ Stage has more than ${MAX_OCCUPANTS_TO_JOIN} occupant(s).`
            );

            return;
        }

        const freeSlot =
            slots.find(
                slot =>
                    slot &&
                    slot.id != null &&
                    slot?.occupierId == null
            );

        if (!freeSlot) {
            console.log(
                "⚠️ No free Stage slot."
            );

            return;
        }

        console.log(
            `🎙️ Joining Stage slot: ${freeSlot.id}`
        );

        await service.stage.slot.join(
            GROUP_ID,
            freeSlot.id
        );

        currentSlotId =
            freeSlot.id;

        autoCheckEnabled =
            false;

        stopMonitoring();

        console.log(
            `✅ Joined Stage successfully. Slot: ${currentSlotId}`
        );

    } catch (error) {
        console.error(
            "❌ Stage check error:",
            error
        );
    }
}

// ============================================================
// Force Join
// ============================================================

async function forceJoinStage() {
    if (shuttingDown) {
        return;
    }

    try {
        console.log(
            "🎙️ Force join requested..."
        );

        const slots =
            await getStageSlots();

        const currentSlot =
            findCurrentSlot(
                slots
            );

        if (currentSlot) {
            currentSlotId =
                currentSlot.id;

            autoCheckEnabled =
                false;

            stopMonitoring();

            console.log(
                `ℹ️ Already on Stage. Slot: ${currentSlotId}`
            );

            return;
        }

        const freeSlot =
            slots.find(
                slot =>
                    slot &&
                    slot.id != null &&
                    slot?.occupierId == null
            );

        if (!freeSlot) {
            console.log(
                "❌ Cannot force join: no free Stage slot."
            );

            return;
        }

        console.log(
            `🎙️ Force joining slot: ${freeSlot.id}`
        );

        await service.stage.slot.join(
            GROUP_ID,
            freeSlot.id
        );

        currentSlotId =
            freeSlot.id;

        autoCheckEnabled =
            false;

        stopMonitoring();

        console.log(
            `✅ Force joined Stage. Slot: ${currentSlotId}`
        );

    } catch (error) {
        console.error(
            "❌ Force join error:",
            error
        );
    }
}

// ============================================================
// Leave Stage
// ============================================================

async function leaveStage() {
    if (shuttingDown) {
        return;
    }

    try {
        if (!currentSlotId) {
            console.log(
                "ℹ️ Bot is not currently on Stage."
            );

            autoCheckEnabled =
                false;

            stopMonitoring();

            return;
        }

        const slotId =
            currentSlotId;

        console.log(
            `🎙️ Leaving Stage slot: ${slotId}`
        );

        await service.stage.slot.leave(
            GROUP_ID,
            slotId
        );

        currentSlotId =
            null;

        autoCheckEnabled =
            true;

        console.log(
            "✅ Left Stage successfully."
        );

        startMonitoring();

    } catch (error) {
        console.error(
            "❌ Leave Stage error:",
            error
        );
    }
}

// ============================================================
// Monitoring
// ============================================================

function startMonitoring() {
    if (shuttingDown) {
        return;
    }

    if (!autoCheckEnabled) {
        return;
    }

    if (currentSlotId) {
        return;
    }

    if (monitorTimer) {
        return;
    }

    console.log(
        "⏱️ Stage monitoring started."
    );

    monitorTimer =
        setInterval(
            async () => {
                await checkStage();
            },
            CHECK_INTERVAL_MS
        );
}

function stopMonitoring() {
    if (!monitorTimer) {
        return;
    }

    clearInterval(
        monitorTimer
    );

    monitorTimer =
        null;

    console.log(
        "⏹️ Stage monitoring stopped."
    );
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

    console.log(
        `🛑 Shutdown requested: ${signal}`
    );

    stopMonitoring();

    try {
        if (
            currentSlotId &&
            service?.stage?.slot
        ) {
            console.log(
                `🎙️ Releasing Stage slot: ${currentSlotId}`
            );

            await service.stage.slot.leave(
                GROUP_ID,
                currentSlotId
            );
        }
    } catch (error) {
        console.error(
            "❌ Error releasing Stage slot:",
            error
        );
    }

    currentSlotId =
        null;

    try {
        if (socket) {
            socket.disconnect();
        }
    } catch {}

    console.log(
        "👋 Service stopped."
    );

    process.exit(0);
}

// ============================================================
// Signals
// ============================================================

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
        "🔐 Loading session"
    );

    console.log(
        "========================================"
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

    const session =
        await loadSession();

    if (
        !session ||
        !session.token
    ) {
        throw new Error(
            "Session loader did not return a valid token"
        );
    }

    WOLF_TOKEN =
        session.token;

    console.log(
        "✅ Session initialized"
    );

    console.log(
        `🔐 Session token length: ${WOLF_TOKEN.length}`
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
        console.error(
            "========================================"
        );

        console.error(
            "❌ FATAL ERROR"
        );

        console.error(
            error?.message ||
            error
        );

        console.error(
            error?.stack ||
            ""
        );

        console.error(
            "========================================"
        );

        try {
            if (socket) {
                socket.disconnect();
            }
        } catch {}

        process.exit(1);
    }
);
