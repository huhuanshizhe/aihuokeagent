/**
 * Firecrawl 结构化提取 - 精简版
 * 用于从企业官网提取结构化信息（联系方式、产品、能力等）
 */
import { config } from '../config.js';
import { chatCompletion, parseAIJson } from '../ai/client.js';
const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v1/scrape';
/**
 * 使用 Firecrawl 抓取网页并用 AI 提取结构化信息
 */
export async function scrapeWithFirecrawl(url) {
    if (!config.firecrawl.apiKey) {
        throw new Error('FIRECRAWL_API_KEY not configured');
    }
    // 1. 抓取网页内容
    const res = await fetch(FIRECRAWL_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.firecrawl.apiKey}`,
        },
        body: JSON.stringify({
            url,
            formats: ['markdown'],
            onlyMainContent: true,
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Firecrawl scrape failed: ${res.status} ${err}`);
    }
    const data = await res.json();
    if (!data.success || !data.data?.markdown) {
        throw new Error('Firecrawl returned empty content');
    }
    const content = data.data.markdown.slice(0, 8000); // 限制长度
    // 2. AI 提取结构化信息
    const aiResponse = await chatCompletion([
        { role: 'system', content: 'You extract structured business information from website content. Return only valid JSON.' },
        { role: 'user', content: `Extract from this website:

{
  "description": "Company description in 1-2 sentences",
  "emails": ["contact emails found on page"],
  "phones": ["phone numbers found"],
  "products": ["main products or services"],
  "capabilities": ["business capabilities"],
  "socialLinks": { "linkedin": "...", "twitter": "...", "facebook": "..." }
}

Website content:
${content}` },
    ], { temperature: 0.1 });
    try {
        return await parseAIJson(aiResponse.content);
    }
    catch {
        return { description: content.slice(0, 200) };
    }
}
//# sourceMappingURL=firecrawl.js.map