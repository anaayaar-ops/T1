// session-loader.js
// يقرأ الرموز من مستودع anaayaar-ops/too

// ============================================================
// الإعدادات
// ============================================================
const GITHUB_TOKEN = process.env.GH_READ_TOKEN || '';
const GITHUB_OWNER = process.env.GH_OWNER || 'anaayaar-ops';
const GITHUB_REPO = process.env.GH_REPO || 'too';
const GITHUB_FILE = process.env.GH_FILE || 'tokens.json';
const GITHUB_BRANCH = process.env.GH_BRANCH || 'main';

// ============================================================
// أدوات
// ============================================================
function mask(v) {
    if (!v) return 'غير موجود';
    const s = String(v);
    if (s.length <= 16) return '***';
    return `${s.slice(0, 10)}...${s.slice(-10)}`;
}

// ============================================================
// قراءة الرموز من GitHub
// ============================================================
async function fetchTokensFromGitHub() {
    if (!GITHUB_TOKEN) {
        throw new Error('❌ GH_READ_TOKEN غير موجود في متغيرات البيئة');
    }

    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}?ref=${GITHUB_BRANCH}`;
    console.log('🌐 قراءة الرموز من:', url);

    const res = await fetch(url, {
        headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'wolf-bot'
        }
    });

    if (res.status === 404) {
        throw new Error('❌ الملف tokens.json غير موجود في المستودع');
    }
    if (!res.ok) {
        throw new Error(`❌ فشل قراءة الملف: ${res.status} — ${await res.text()}`);
    }

    const data = await res.json();
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    const tokens = JSON.parse(content);

    console.log('✅ تم تحميل الرموز بنجاح');
    console.log('📅 آخر تحديث:', tokens.updatedAt || 'غير معروف');

    return tokens;
}

// ============================================================
// loadSession — الواجهة الرئيسية
// ============================================================
export async function loadSession() {
    console.log('');
    console.log('========================================');
    console.log('🔐 تحميل الجلسة من GitHub');
    console.log('========================================');
    console.log('📦 المستودع:', `${GITHUB_OWNER}/${GITHUB_REPO}`);
    console.log('📄 الملف:', GITHUB_FILE);
    console.log('🌿 الفرع:', GITHUB_BRANCH);
    console.log('');

    const tokens = await fetchTokensFromGitHub();

    if (!tokens.v3APIToken) throw new Error('❌ v3APIToken مفقود');
    if (!tokens.appCheckToken) throw new Error('❌ appCheckToken مفقود');

    console.log('');
    console.log('========================================');
    console.log('🔐 WOLF Credentials');
    console.log('========================================');
    console.log('🔐 v3APIToken:', mask(tokens.v3APIToken));
    console.log('🛡️ appCheckToken:', mask(tokens.appCheckToken));
    console.log('📱 deviceToken:', mask(tokens.deviceToken));
    console.log('📅 updatedAt:', tokens.updatedAt);
    console.log('========================================');

    return {
        token: tokens.v3APIToken,
        appCheckToken: tokens.appCheckToken,
        deviceToken: tokens.deviceToken || '',
        device: 'web',
        isAppCheckEnabled: true,
        page: null
    };
}

// ============================================================
// closeSessionBrowser — لا شيء لإغلاقه
// ============================================================
export async function closeSessionBrowser() {
    // لا يوجد متصفح
}
