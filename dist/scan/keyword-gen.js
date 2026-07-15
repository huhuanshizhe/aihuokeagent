/**
 * AI 关键词生成 - 精简版
 * 从 src/lib/radar/keyword-generator.ts 提取，去除 Prisma 依赖
 */
import { chatCompletion, parseAIJson } from '../ai/client.js';
/**
 * 根据企业画像生成搜索关键词
 */
export async function generateKeywords(context, targetCountries, options = { mode: 'initial' }) {
    const maxKeywords = options.maxKeywords || (options.mode === 'initial' ? 15 : 10);
    const systemPrompt = '你是 B2B 获客专家，擅长生成精准的搜索关键词来发现潜在客户。';
    let userPrompt;
    if (options.mode === 'initial') {
        userPrompt = buildInitialPrompt(context, targetCountries);
    }
    else {
        userPrompt = buildExpansionPrompt(context, options.existingKeywords || []);
    }
    try {
        const response = await chatCompletion([{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], { temperature: 0.7 });
        const parsed = await parseAIJson(response.content);
        const arr = Array.isArray(parsed) ? parsed : [];
        const seen = new Set(options.existingKeywords?.map(k => k.toLowerCase()) || []);
        const results = [];
        for (const item of arr) {
            if (!item.keyword || typeof item.keyword !== 'string')
                continue;
            const keyword = item.keyword.trim();
            if (seen.has(keyword.toLowerCase()))
                continue;
            seen.add(keyword.toLowerCase());
            results.push({ keyword, rationale: item.rationale || '' });
            if (results.length >= maxKeywords)
                break;
        }
        console.log(`[keyword-gen] Generated ${results.length} keywords (${options.mode})`);
        return results;
    }
    catch (error) {
        console.error('[keyword-gen] Failed:', error);
        return [];
    }
}
function buildInitialPrompt(context, targetCountries) {
    return `根据以下企业信息，生成 Google Maps / 搜索引擎搜索关键词。

【我方公司】
名称: ${context.companyName}
${context.companyIntro ? `简介: ${context.companyIntro}` : ''}
${context.products?.length ? `产品: ${context.products.join(', ')}` : ''}
${context.targetIndustries?.length ? `行业: ${context.targetIndustries.join(', ')}` : ''}

【目标国家】
${targetCountries.join(', ')}

【要求】
1. 生成 10-15 个搜索关键词（英文）
2. 关键词要能找到潜在客户（经销商、代理商、系统集成商、终端用户）
3. 格式: "{客户类型} {行业/产品} {国家}"
4. 覆盖不同客户类型
5. 关键词要具体，不要太宽泛

示例:
- "agricultural machinery distributor Thailand"
- "farm equipment dealer Vietnam"

返回 JSON 数组: [{"keyword": "...", "rationale": "..."}]`;
}
function buildExpansionPrompt(context, existingKeywords) {
    return `基于已搜索的关键词，生成新的扩展关键词。

【我方公司】${context.companyName}
${context.targetIndustries?.length ? `行业: ${context.targetIndustries.join(', ')}` : ''}

【已搜过的关键词】
${existingKeywords.slice(0, 20).join(', ')}

【要求】
1. 生成 5-10 个新关键词，避免与已搜过的重复
2. 尝试不同的客户类型和场景
3. 英文关键词

返回 JSON 数组: [{"keyword": "...", "rationale": "..."}]`;
}
//# sourceMappingURL=keyword-gen.js.map