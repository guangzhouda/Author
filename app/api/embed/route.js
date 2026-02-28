// Gemini 原生 API & OpenAI 兼容 API — 文本向量化 (Text Embeddings)

export const runtime = 'edge';

function getDefaultBaseUrl(provider) {
    if (provider === 'zhipu') return 'https://open.bigmodel.cn/api/paas/v4';
    if (provider === 'deepseek') return 'https://api.deepseek.com/v1';
    if (provider === 'openai') return 'https://api.openai.com/v1';
    if (provider === 'gemini-native') return 'https://generativelanguage.googleapis.com/v1beta';
    if (provider === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta/openai';
    if (provider === 'siliconflow') return 'https://api.siliconflow.cn/v1';
    if (provider === 'moonshot') return 'https://api.moonshot.cn/v1';
    if (provider === 'custom') return '';
    return 'https://open.bigmodel.cn/api/paas/v4';
}

function getDefaultEmbedModel(provider) {
    if (provider === 'zhipu') return 'embedding-3';
    if (provider === 'openai') return 'text-embedding-3-small';
    if (provider === 'gemini-native') return 'text-embedding-004';
    if (provider === 'gemini') return 'text-embedding-004';
    if (provider === 'siliconflow') return 'Qwen/Qwen3-Embedding-4B';
    return 'text-embedding-v3-small';
}

export async function POST(request) {
    try {
        const { text, apiConfig } = await request.json();

        const isCustomEmbed = apiConfig?.useCustomEmbed;
        const provider = isCustomEmbed ? apiConfig.embedProvider : (apiConfig?.provider || 'zhipu');
        const apiKey = isCustomEmbed ? (apiConfig.embedApiKey || apiConfig?.apiKey) : apiConfig?.apiKey;

        let rawBaseUrl;
        if (isCustomEmbed) {
            rawBaseUrl = apiConfig.embedBaseUrl;
        } else {
            // 如果是自定义提供商且没开独立Embed，默认继承对聊的baseUrl
            rawBaseUrl = apiConfig?.baseUrl;
        }

        // 自动补全默认 baseUrl（兼容未填写的情况）
        if (!rawBaseUrl) rawBaseUrl = getDefaultBaseUrl(provider);
        // 兼容遗留的错误 URL：Gemini 原生接口不能用智谱的 baseUrl
        if (provider === 'gemini-native' && rawBaseUrl.includes('open.bigmodel.cn')) {
            rawBaseUrl = getDefaultBaseUrl(provider);
        }

        if (!rawBaseUrl) {
            return new Response(JSON.stringify({ error: '请在API配置中填写 Embedding API 地址' }), { status: 400 });
        }

        const baseUrl = rawBaseUrl.replace(/\/$/, '');

        let embedModelName;
        if (isCustomEmbed) {
            embedModelName = apiConfig.embedModel || getDefaultEmbedModel(provider);
        } else if (provider === 'custom') {
            // 如果没开独立 embed，但选了 custom，则尽量给出一个可用的默认值。
            embedModelName = getDefaultEmbedModel(provider);
        } else {
            embedModelName = getDefaultEmbedModel(provider);
        }

        if (!apiKey) {
            return new Response(JSON.stringify({ error: isCustomEmbed ? '请在API配置中填写独立的 Embedding API Key' : '请先配置 API Key' }), { status: 400 });
        }

        if (!text || typeof text !== 'string') {
            return new Response(JSON.stringify({ error: '无效的文本输入' }), { status: 400 });
        }

        let embeddings = [];

        if (provider === 'gemini-native') {
            const geminiModel = embedModelName || 'text-embedding-004';
            const url = `${baseUrl}/models/${geminiModel}:embedContent?key=${apiKey}`;
            console.log('Fetching Gemini Embeddings:', url);
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: `models/${geminiModel}`,
                    content: { parts: [{ text }] }
                })
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Gemini Embedding Error: ${errText}`);
            }
            const data = await res.json();
            embeddings = data.embedding.values;
        } else {
            // OpenAI 兼容格式
            const url = `${baseUrl}/embeddings`;

            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    input: text,
                    model: embedModelName
                })
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Embedding API Error: ${errText}`);
            }
            const data = await res.json();
            embeddings = data.data[0].embedding;
        }

        return new Response(JSON.stringify({ embedding: embeddings }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('Embedding API Error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
