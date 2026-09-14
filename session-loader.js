import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import AdmZip from "adm-zip";
import { chromium } from "playwright";

let browser = null;
let context = null;
let profileDir = null;

// ============================================================
// Helpers
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getGoogleDriveFileId(url) {
    if (!url) return null;

    const match =
        url.match(/\/file\/d\/([^/]+)/) ||
        url.match(/[?&]id=([^&]+)/);

    return match ? match[1] : null;
}

// ============================================================
// HTTP GET
// ============================================================

function httpsGet(url, headers = {}, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 10) {
            reject(
                new Error(
                    "❌ Too many redirects while downloading file"
                )
            );
            return;
        }

        const request = https.get(
            url,
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
                    "Accept":
                        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    ...headers
                }
            },
            response => {
                const status = response.statusCode || 0;

                // Redirect
                if (
                    status >= 300 &&
                    status < 400 &&
                    response.headers.location
                ) {
                    const nextUrl = new URL(
                        response.headers.location,
                        url
                    ).toString();

                    response.resume();

                    console.log(
                        `↪️ Redirect -> ${nextUrl}`
                    );

                    httpsGet(
                        nextUrl,
                        headers,
                        redirectCount + 1
                    )
                        .then(resolve)
                        .catch(reject);

                    return;
                }

                const chunks = [];

                response.on("data", chunk => {
                    chunks.push(chunk);
                });

                response.on("end", () => {
                    resolve({
                        status,
                        headers: response.headers,
                        body: Buffer.concat(chunks)
                    });
                });
            }
        );

        request.on("error", reject);

        request.setTimeout(
            180000,
            () => {
                request.destroy(
                    new Error(
                        "❌ Download timeout"
                    )
                );
            }
        );
    });
}

// ============================================================
// Google Drive Download
// ============================================================

async function downloadGoogleDriveFile(
    fileId,
    outputPath
) {
    console.log(
        "☁️ Google Drive detected"
    );

    console.log(
        `🆔 File ID: ${fileId}`
    );

    // First request
    const initialUrl =
        `https://drive.usercontent.google.com/download?id=${encodeURIComponent(
            fileId
        )}&export=download`;

    console.log(
        "🌐 طلب تنزيل Google Drive..."
    );

    const response =
        await httpsGet(initialUrl);

    console.log(
        `📡 Google Drive HTTP: ${response.status}`
    );

    const contentType =
        String(
            response.headers["content-type"] || ""
        ).toLowerCase();

    // --------------------------------------------------------
    // Direct ZIP
    // --------------------------------------------------------

    if (
        response.body.length >= 4 &&
        response.body.subarray(0, 4).toString("hex") ===
            "504b0304"
    ) {
        fs.writeFileSync(
            outputPath,
            response.body
        );

        console.log(
            `📦 تم تنزيل ZIP مباشرة: ${(
                response.body.length /
                1024 /
                1024
            ).toFixed(2)} MB`
        );

        return {
            bytes: response.body.length,
            contentType:
                contentType || "application/zip"
        };
    }

    // --------------------------------------------------------
    // Virus Scan Confirmation
    // --------------------------------------------------------

    const html =
        response.body.toString(
            "utf8"
        );

    if (
        html.includes(
            "Google Drive - Virus scan warning"
        ) ||
        html.includes(
            "virus scan warning"
        ) ||
        html.includes(
            "confirm="
        )
    ) {
        console.log(
            "⚠️ Google Drive طلب تأكيد فحص الفيروسات"
        );

        // Find confirmation token
        const patterns = [
            /name="confirm"\s+value="([^"]+)"/i,
            /name='confirm'\s+value='([^']+)'/i,
            /confirm=([a-zA-Z0-9_-]+)/i
        ];

        let confirmToken = null;

        for (const pattern of patterns) {
            const match =
                html.match(pattern);

            if (match?.[1]) {
                confirmToken = match[1];
                break;
            }
        }

        // Find form action
        let action = null;

        const formMatch =
            html.match(
                /<form[^>]+action="([^"]+)"/i
            );

        if (formMatch?.[1]) {
            action = formMatch[1];
        }

        // ----------------------------------------------------
        // Build confirmation URL
        // ----------------------------------------------------

        let confirmUrl;

        if (action) {
            confirmUrl =
                new URL(
                    action,
                    initialUrl
                ).toString();

            const separator =
                confirmUrl.includes("?")
                    ? "&"
                    : "?";

            confirmUrl +=
                `${separator}id=${encodeURIComponent(
                    fileId
                )}&export=download`;

            if (confirmToken) {
                confirmUrl +=
                    `&confirm=${encodeURIComponent(
                        confirmToken
                    )}`;
            }
        } else {
            confirmUrl =
                `https://drive.usercontent.google.com/download?id=${encodeURIComponent(
                    fileId
                )}&export=download&confirm=${
                    confirmToken || "t"
                }`;
        }

        console.log(
            "🔐 إرسال تأكيد Google Drive..."
        );

        const confirmed =
            await httpsGet(
                confirmUrl
            );

        const confirmedBody =
            confirmed.body;

        const signature =
            confirmedBody
                .subarray(0, 4)
                .toString("hex");

        if (
            signature !== "504b0304" &&
            signature !== "504b0506" &&
            signature !== "504b0708"
        ) {
            console.log(
                `⚠️ Google Drive ما زال يرجع ${
                    confirmed.headers["content-type"] ||
                    "بيانات غير معروفة"
                }`
            );

            const preview =
                confirmedBody
                    .toString("utf8")
                    .replace(/\s+/g, " ")
                    .slice(0, 300);

            console.log(
                `🔎 بداية الرد: ${preview}`
            );

            throw new Error(
                "❌ Google Drive لم يسمح بتنزيل ZIP بعد تأكيد Virus Scan."
            );
        }

        fs.writeFileSync(
            outputPath,
            confirmedBody
        );

        console.log(
            `📦 تم تنزيل ZIP بعد التأكيد: ${(
                confirmedBody.length /
                1024 /
                1024
            ).toFixed(2)} MB`
        );

        return {
            bytes: confirmedBody.length,
            contentType:
                confirmed.headers["content-type"] ||
                "application/zip"
        };
    }

    // --------------------------------------------------------
    // Unknown response
    // --------------------------------------------------------

    console.log(
        `📄 Content-Type: ${contentType}`
    );

    const preview =
        html
            .replace(/\s+/g, " ")
            .slice(0, 500);

    console.log(
        `🔎 بداية الرد: ${preview}`
    );

    throw new Error(
        "❌ Google Drive لم يرجع ملف ZIP."
    );
}

// ============================================================
// Generic Download
// ============================================================

async function downloadFile(
    url,
    outputPath
) {
    const googleDriveId =
        getGoogleDriveFileId(url);

    if (googleDriveId) {
        return await downloadGoogleDriveFile(
            googleDriveId,
            outputPath
        );
    }

    console.log(
        `🌐 تحميل من: ${url}`
    );

    const response =
        await httpsGet(url);

    if (
        response.status < 200 ||
        response.status >= 300
    ) {
        throw new Error(
            `❌ HTTP ${response.status}`
        );
    }

    fs.writeFileSync(
        outputPath,
        response.body
    );

    return {
        bytes: response.body.length,
        contentType:
            response.headers["content-type"] ||
            ""
    };
}

// ============================================================
// ZIP Validation
// ============================================================

function validateZipFile(
    zipPath,
    metadata = {}
) {
    if (!fs.existsSync(zipPath)) {
        throw new Error(
            "❌ ملف Profile غير موجود"
        );
    }

    const stat =
        fs.statSync(zipPath);

    console.log(
        `📏 حجم Profile: ${(
            stat.size /
            1024 /
            1024
        ).toFixed(2)} MB`
    );

    console.log(
        `📄 Content-Type: ${
            metadata.contentType ||
            "غير معروف"
        }`
    );

    if (stat.size === 0) {
        throw new Error(
            "❌ Profile ZIP فارغ"
        );
    }

    const fd =
        fs.openSync(
            zipPath,
            "r"
        );

    try {
        const header =
            Buffer.alloc(4);

        fs.readSync(
            fd,
            header,
            0,
            4,
            0
        );

        const signature =
            header.toString("hex");

        console.log(
            `🔎 ZIP Signature: ${signature}`
        );

        if (
            signature !== "504b0304" &&
            signature !== "504b0506" &&
            signature !== "504b0708"
        ) {
            throw new Error(
                "❌ الملف الذي تم تنزيله ليس ZIP صالحًا."
            );
        }

        console.log(
            "✅ ZIP signature صحيح"
        );
    } finally {
        fs.closeSync(fd);
    }
}

// ============================================================
// Extract Profile
// ============================================================

function cleanChromeLocks(dir) {
    const files = [
        "SingletonLock",
        "SingletonSocket",
        "SingletonCookie",
        "DevToolsActivePort"
    ];

    for (const file of files) {
        try {
            fs.rmSync(
                path.join(dir, file),
                {
                    recursive: true,
                    force: true
                }
            );
        } catch {}
    }
}

function findUserDataDir(rootDir) {
    const candidates = [
        rootDir,
        path.join(rootDir, "User Data"),
        path.join(rootDir, "Chrome User Data")
    ];

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) {
            continue;
        }

        if (
            fs.existsSync(
                path.join(
                    candidate,
                    "Local State"
                )
            ) ||
            fs.existsSync(
                path.join(
                    candidate,
                    "Default"
                )
            )
        ) {
            return candidate;
        }
    }

    return rootDir;
}

async function extractProfile(
    zipPath,
    destination
) {
    console.log(
        "📦 جاري فك Chrome Profile..."
    );

    validateZipFile(zipPath);

    const zip =
        new AdmZip(zipPath);

    const entries =
        zip.getEntries();

    if (!entries.length) {
        throw new Error(
            "❌ ZIP لا يحتوي على ملفات"
        );
    }

    console.log(
        `📁 عدد ملفات Profile: ${entries.length}`
    );

    fs.mkdirSync(
        destination,
        {
            recursive: true
        }
    );

    zip.extractAllTo(
        destination,
        true
    );

    console.log(
        "✅ تم فك Chrome Profile"
    );

    return findUserDataDir(
        destination
    );
}

// ============================================================
// WOLF Credentials
// ============================================================

async function readWolfTokens(page) {
    return await page.evaluate(() => {
        const result = {
            token: null,
            appCheckToken: null
        };

        const entries = [];

        for (
            let i = 0;
            i < localStorage.length;
            i++
        ) {
            const key =
                localStorage.key(i);

            if (!key) continue;

            let value = null;

            try {
                value =
                    localStorage.getItem(
                        key
                    );
            } catch {}

            entries.push({
                key,
                value
            });

            const lower =
                key.toLowerCase();

            if (
                !result.token &&
                (
                    lower.includes(
                        "v3apitoken"
                    ) ||
                    lower.includes(
                        "v3_api_token"
                    )
                )
            ) {
                result.token = value;
            }

            if (
                !result.appCheckToken &&
                (
                    lower.includes(
                        "appchecktoken"
                    ) ||
                    lower.includes(
                        "app_check_token"
                    )
                )
            ) {
                result.appCheckToken =
                    value;
            }
        }

        return result;
    });
}

// ============================================================
// Load Session
// ============================================================

export async function loadSession() {
    const profileUrl =
        process.env.WOLF_PROFILE_URL;

    if (!profileUrl) {
        throw new Error(
            "❌ WOLF_PROFILE_URL غير موجود"
        );
    }

    console.log(
        "🐺 بدء تحميل WOLF Profile..."
    );

    const tempRoot =
        fs.mkdtempSync(
            path.join(
                os.tmpdir(),
                "wolf-profile-"
            )
        );

    const zipPath =
        path.join(
            tempRoot,
            "wolf-profile.zip"
        );

    const extractPath =
        path.join(
            tempRoot,
            "profile"
        );

    try {
        console.log(
            "🌐 جاري تحميل Profile..."
        );

        const metadata =
            await downloadFile(
                profileUrl,
                zipPath
            );

        console.log(
            "✅ تم تحميل Profile"
        );

        validateZipFile(
            zipPath,
            metadata
        );

        profileDir =
            await extractProfile(
                zipPath,
                extractPath
            );

        cleanChromeLocks(
            profileDir
        );

        console.log(
            `📂 Chrome User Data: ${profileDir}`
        );

        console.log(
            "🚀 تشغيل Chromium..."
        );

        context =
            await chromium.launchPersistentContext(
                profileDir,
                {
                    headless: true,
                    args: [
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--no-first-run",
                        "--no-default-browser-check"
                    ]
                }
            );

        browser =
            context.browser();

        let page =
            context.pages()[0];

        if (!page) {
            page =
                await context.newPage();
        }

        console.log(
            "🌐 فتح WOLF..."
        );

        await page.goto(
            "https://app.wolf.live/mna",
            {
                waitUntil:
                    "domcontentloaded",
                timeout: 120000
            }
        );

        console.log(
            `🌐 WOLF URL: ${page.url()}`
        );

        console.log(
            "⏳ انتظار جلسة WOLF..."
        );

        let credentials = null;

        for (
            let attempt = 1;
            attempt <= 60;
            attempt++
        ) {
            try {
                credentials =
                    await readWolfTokens(
                        page
                    );
            } catch {}

            if (
                credentials?.token &&
                credentials?.appCheckToken
            ) {
                break;
            }

            if (
                attempt % 5 === 0
            ) {
                console.log(
                    `⏳ قراءة credentials: ${attempt}/60`
                );
            }

            await sleep(1000);
        }

        if (!credentials?.token) {
            throw new Error(
                "❌ لم يتم العثور على v3APIToken"
            );
        }

        if (
            !credentials?.appCheckToken
        ) {
            throw new Error(
                "❌ لم يتم العثور على appCheckToken"
            );
        }

        console.log(
            "✅ تم العثور على WOLF credentials"
        );

        return {
            token:
                credentials.token,
            appCheckToken:
                credentials.appCheckToken,
            device: "web",
            isAppCheckEnabled: true,
            page
        };
    } catch (error) {
        console.error(
            "❌ فشل تحميل WOLF Profile:"
        );

        console.error(
            error?.stack ||
            error?.message ||
            error
        );

        throw error;
    }
}

// ============================================================
// Close
// ============================================================

export async function closeSessionBrowser() {
    console.log(
        "🧹 إغلاق Chrome Session..."
    );

    try {
        if (context) {
            await context.close();
        }
    } catch (error) {
        console.error(
            "⚠️ خطأ أثناء إغلاق Chrome:",
            error?.message || error
        );
    }

    browser = null;
    context = null;
    profileDir = null;

    console.log(
        "✅ تم إغلاق Chrome Session"
    );
}
