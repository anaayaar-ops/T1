import wolfjs from "wolf.js";
import { io } from "socket.io-client";
import { loadSession } from "./session-loader.js";

const {
    WOLF,
    OnlineState
} = wolfjs;

// ============================================================
// CONFIG
// ============================================================

const GROUP_ID = 18432094;

const WATCHED_SUBSCRIBER_IDS = [
    51660277,
    35543686,
    80014666,
    16327118,
    5507
];

const LEAVE_COMMAND =
    "!كات نزول";

const JOIN_COMMAND =
    "!كات صعود";

const RUN_DURATION_MS =
    5 * 60 * 60 * 1000;

const CHECK_INTERVAL_MS =
    10 * 60 * 1000;

const MAX_OCCUPANTS_TO_JOIN = 1;

const AUTHORIZATION_TIMEOUT_MS =
    60 * 1000;

const WOLF_DEVICE =
    process.env.WOLF_DEVICE ||
    "web";

// ============================================================
// STATE
// ============================================================

let WOLF_TOKEN = "";
let WOLF_APP_CHECK_TOKEN = "";

let service = null;
let socket = null;

let monitorTimer = null;
let shutdownTimer = null;

let currentSlotId = null;

let connectionCount = 0;
let disconnectCount = 0;

// ============================================================
// SAFE JSON
// ============================================================

function safeJson(value) {
    try {
        return JSON.stringify(
            value,
            (key, val) => {
                const lower =
                    String(key).toLowerCase();

                if (
                    lower.includes("token") ||
                    lower.includes("authorization") ||
                    lower.includes("cookie")
                ) {
                    return "[REDACTED]";
                }

                return val;
            }
        );
    } catch {
        return String(value);
    }
}

function logDivider() {
    console.log(
        "========================================"
    );
}

// ============================================================
// SESSION
// ============================================================

async function initializeSession() {
    logDivider();

    console.log(
        "🔐 Loading session"
    );

    logDivider();

    console.log(
        `📱 Device: ${WOLF_DEVICE}`
    );

    console.log(
        "🛡️ App Check: enabled"
    );

    const session =
        await loadSession();

    if (
        !session ||
        !session.token
    ) {
        throw new Error(
            "Session token was not loaded."
        );
    }

    if (
        !session.appCheckToken
    ) {
        throw new Error(
            "App Check token was not loaded."
        );
    }

    WOLF_TOKEN =
        session.token;

    WOLF_APP_CHECK_TOKEN =
        session.appCheckToken;

    console.log(
        "✅ Session initialized"
    );

    console.log(
        `🔐 Session token length: ${WOLF_TOKEN.length}`
    );

    console.log(
        `🛡️ App Check token length: ${WOLF_APP_CHECK_TOKEN.length}`
    );
}

// ============================================================
// CREATE SERVICE
// ============================================================

async function createWolfService() {
    console.log(
        "⚙️ Creating WOLF service..."
    );

    service =
        new WOLF();

    console.log(
        "⚙️ WOLF service created."
    );

    if (
        service.config?.framework?.login
    ) {
        service.config.framework.login.token =
            WOLF_TOKEN;

        if (
            typeof OnlineState?.INVISIBLE !==
            "undefined"
        ) {
            service.config.framework.login.onlineState =
                OnlineState.INVISIBLE;
        } else {
            service.config.framework.login.onlineState =
                3;
        }

        service.config.framework.login.appCheckToken =
            WOLF_APP_CHECK_TOKEN;

        service.config.framework.login.app_check_token =
            WOLF_APP_CHECK_TOKEN;
    }

    console.log(
        "⚙️ Initializing service handlers..."
    );

    await service.websocket.init();

    console.log(
        "⚙️ Loaded 30 handlers"
    );
}

// ============================================================
// PRIVATE COMMANDS
// ============================================================

function installCommandListener() {
    service.on(
        "privateMessage",
        async message => {
            try {
                const senderId =
                    Number(
                        message?.sender?.id ??
                        message?.senderId ??
                        message?.from?.id ??
                        message?.subscriberId
                    );

                const text =
                    String(
                        message?.text ??
                        message?.message ??
                        message?.body ??
                        ""
                    ).trim();

                if (
                    !WATCHED_SUBSCRIBER_IDS.includes(
                        senderId
                    )
                ) {
                    return;
                }

                console.log(
                    `[PRIVATE] ${senderId}: ${text}`
                );

                if (
                    text ===
                    LEAVE_COMMAND
                ) {
                    await leaveStage();

                    startMonitoring();

                    return;
                }

                if (
                    text ===
                    JOIN_COMMAND
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
// CONNECTION CONFIG
// ============================================================

function getConnectionConfig() {
    const connection =
        service?._frameworkConfig
            ?.get?.("connection") || {};

    return {
        host:
            connection.host ||
            "https://v3-rc.palringo.com",

        port:
            connection.port ||
            443,

        version:
            connection.version
    };
}

// ============================================================
// CONNECT
// ============================================================

async function connectSocket() {
    const {
        host,
        port,
        version
    } =
        getConnectionConfig();

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
        `📱 Device: ${WOLF_DEVICE}`
    );

    console.log(
        "🛡️ Security validation: enabled"
    );

    console.log(
        "🔐 Token loaded: yes"
    );

    console.log(
        `🔐 Token length: ${WOLF_TOKEN.length}`
    );

    console.log(
        "🛡️ App Check token loaded: yes"
    );

    console.log(
        `🛡️ App Check token length: ${WOLF_APP_CHECK_TOKEN.length}`
    );

    console.log(
        `⚙️ Connection version: ${
            version || "not specified"
        }`
    );

    const query = {
        token:
            WOLF_TOKEN,

        device:
            WOLF_DEVICE,

        state:
            3,

        isAppCheckEnabled:
            "true",

        appCheckToken:
            WOLF_APP_CHECK_TOKEN
    };

    if (version) {
        query.version =
            version;
    }

    console.log(
        "🔎 Socket query:"
    );

    console.log(
        safeJson(query)
    );

    socket =
        io(
            `${host}:${port}`,
            {
                transports: [
                    "websocket"
                ],

                autoConnect: false,

                reconnection: true,

                reconnectionAttempts:
                    Infinity,

                reconnectionDelay:
                    3000,

                reconnectionDelayMax:
                    10000,

                timeout:
                    20000,

                query
            }
        );

    service.websocket.socket =
        socket;

    socket.on(
        "connect",
        () => {
            connectionCount++;

            logDivider();

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
                `🔗 Transport: ${socket.io.engine?.transport?.name}`
            );

            logDivider();
        }
    );

    socket.on(
        "connect_error",
        error => {
            console.error(
                "❌ Socket connect_error:",
                error?.message ||
                error
            );
        }
    );

    socket.on(
        "disconnect",
        (reason, details) => {
            disconnectCount++;

            logDivider();

            console.log(
                "🔴 SOCKET DISCONNECTED"
            );

            console.log(
                `🔴 Reason: ${reason}`
            );

            console.log(
                `🔴 Disconnect count: ${disconnectCount}`
            );

            console.log(
                `🔴 Socket connected: ${socket.connected}`
            );

            if (details) {
                console.log(
                    `🔴 Details: ${safeJson(details)}`
                );
            }

            console.log(
                `🔴 Current subscriber: ${
                    service.currentSubscriber?.id ??
                    "undefined"
                }`
            );

            logDivider();
        }
    );

    socket.on(
        "error",
        error => {
            console.error(
                "❌ SOCKET ERROR:",
                safeJson(error)
            );
        }
    );

    socket.onAny(
        (eventName, data) => {
            try {
                console.log(
                    `📥 SOCKET EVENT: ${eventName}`
                );

                console.log(
                    `📦 ${safeJson(data)}`
                );

                const handler =
                    service
                        ?.websocket
                        ?.handlers
                        ?.[eventName];

                if (
                    handler &&
                    typeof handler.process ===
                        "function"
                ) {
                    handler.process(
                        data?.body ??
                        data
                    );
                }

            } catch (error) {
                console.error(
                    `❌ Handler error [${eventName}]:`,
                    error
                );
            }
        }
    );

    console.log(
        "🔄 Connection attempt: 1"
    );

    console.log(
        "🔌 Connecting..."
    );

    socket.connect();

    console.log(
        "⏳ Waiting for authorization..."
    );

    const started =
        Date.now();

    while (
        Date.now() - started <
        AUTHORIZATION_TIMEOUT_MS
    ) {
        if (
            service.currentSubscriber?.id
        ) {
            console.log(
                `✅ Authorization complete. Subscriber: ${service.currentSubscriber.id}`
            );

            return;
        }

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    1000
                )
        );
    }

    throw new Error(
        "WOLF authorization did not complete within the timeout."
    );
}

// ============================================================
// STAGE
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

async function getStageOccupants() {
    try {
        const config =
            await service.stage.getAudioConfig(
                GROUP_ID
            );

        if (
            Array.isArray(
                config?.occupants
            )
        ) {
            return config.occupants.length;
        }

        if (
            Array.isArray(
                config?.users
            )
        ) {
            return config.users.length;
        }

        if (
            typeof config?.occupantsCount ===
                "number"
        ) {
            return config.occupantsCount;
        }

    } catch {}

    const slots =
        await getStageSlots();

    return slots.filter(
        slot =>
            slot?.occupierId != null
    ).length;
}

async function findFreeSlot() {
    const slots =
        await getStageSlots();

    return (
        slots.find(
            slot =>
                slot?.id != null &&
                slot?.occupierId == null
        ) ||
        null
    );
}

async function findCurrentSlot() {
    const subscriberId =
        service.currentSubscriber?.id;

    if (
        subscriberId == null
    ) {
        return null;
    }

    const slots =
        await getStageSlots();

    return (
        slots.find(
            slot =>
                Number(
                    slot?.occupierId
                ) === Number(
                    subscriberId
                )
        ) ||
        null
    );
}

// ============================================================
// JOIN
// ============================================================

async function joinStage(
    force = false
) {
    try {
        const occupants =
            await getStageOccupants();

        console.log(
            `🎙️ Stage occupants: ${occupants}`
        );

        if (
            !force &&
            occupants >
                MAX_OCCUPANTS_TO_JOIN
        ) {
            console.log(
                `⏸️ Stage has more than ${MAX_OCCUPANTS_TO_JOIN} occupant(s).`
            );

            return false;
        }

        const current =
            await findCurrentSlot();

        if (current) {
            currentSlotId =
                current.id;

            console.log(
                `ℹ️ Already on stage. Slot: ${currentSlotId}`
            );

            return true;
        }

        const freeSlot =
            await findFreeSlot();

        if (!freeSlot) {
            console.log(
                "❌ No free stage slot."
            );

            return false;
        }

        console.log(
            `🎙️ Joining stage slot ${freeSlot.id}...`
        );

        await service.stage.slot.join(
            GROUP_ID,
            freeSlot.id
        );

        currentSlotId =
            freeSlot.id;

        console.log(
            `✅ Joined stage. Slot: ${currentSlotId}`
        );

        stopMonitoring();

        return true;

    } catch (error) {
        console.error(
            "❌ Stage join error:",
            error
        );

        return false;
    }
}

// ============================================================
// LEAVE
// ============================================================

async function leaveStage() {
    try {
        let slotId =
            currentSlotId;

        if (
            slotId == null
        ) {
            const current =
                await findCurrentSlot();

            if (current) {
                slotId =
                    current.id;
            }
        }

        if (
            slotId == null
        ) {
            console.log(
                "ℹ️ Bot is not on stage."
            );

            return;
        }

        console.log(
            `🎙️ Leaving stage slot ${slotId}...`
        );

        await service.stage.slot.leave(
            GROUP_ID,
            slotId
        );

        currentSlotId =
            null;

        console.log(
            "✅ Left stage."
        );

    } catch (error) {
        console.error(
            "❌ Stage leave error:",
            error
        );
    }
}

// ============================================================
// FORCE JOIN
// ============================================================

async function forceJoinStage() {
    console.log(
        "🚀 Force join command received."
    );

    await joinStage(
        true
    );
}

// ============================================================
// MONITOR
// ============================================================

async function checkStageAndJoin() {
    console.log(
        "🔎 Checking stage..."
    );

    await joinStage(
        false
    );
}

function stopMonitoring() {
    if (
        monitorTimer
    ) {
        clearInterval(
            monitorTimer
        );

        monitorTimer =
            null;

        console.log(
            "⏹️ Stage monitor stopped."
        );
    }
}

function startMonitoring() {
    stopMonitoring();

    console.log(
        "▶️ Stage monitor started."
    );

    checkStageAndJoin()
        .catch(error => {
            console.error(
                "❌ Initial stage check:",
                error
            );
        });

    monitorTimer =
        setInterval(
            () => {
                checkStageAndJoin()
                    .catch(error => {
                        console.error(
                            "❌ Stage monitor error:",
                            error
                        );
                    });
            },
            CHECK_INTERVAL_MS
        );
}

// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown(
    signal
) {
    console.log(
        `🛑 Shutdown requested: ${signal}`
    );

    stopMonitoring();

    if (
        shutdownTimer
    ) {
        clearTimeout(
            shutdownTimer
        );
    }

    try {
        await leaveStage();
    } catch {}

    try {
        if (
            socket
        ) {
            socket.disconnect();
        }
    } catch {}

    process.exit(
        0
    );
}

// ============================================================
// MAIN
// ============================================================

async function main() {
    console.log(
        "🚀 Service started"
    );

    try {
        await initializeSession();

        await createWolfService();

        installCommandListener();

        await connectSocket();

        console.log(
            "🧪 Testing stage API..."
        );

        const slots =
            await getStageSlots();

        console.log(
            `🧪 Stage slots loaded: ${slots.length}`
        );

        startMonitoring();

        shutdownTimer =
            setTimeout(
                () => {
                    shutdown(
                        "runtime limit"
                    );
                },
                RUN_DURATION_MS
            );

        console.log(
            "✅ Service is running."
        );

    } catch (error) {
        logDivider();

        console.error(
            "❌ SERVICE ERROR"
        );

        console.error(
            error?.stack ||
            error
        );

        logDivider();

        try {
            if (
                socket
            ) {
                socket.disconnect();
            }
        } catch {}

        process.exit(
            1
        );
    }
}

// ============================================================
// SIGNALS
// ============================================================

process.on(
    "SIGINT",
    () =>
        shutdown(
            "SIGINT"
        )
);

process.on(
    "SIGTERM",
    () =>
        shutdown(
            "SIGTERM"
        )
);

// ============================================================
// START
// ============================================================

main();
