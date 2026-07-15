/**
 * 决策人搜索 - 精简版
 * 从 src/lib/radar/enrich-pipeline.ts 提取
 */
import { chatCompletion, parseAIJson } from '../ai/client.js';
import { config } from '../config.js';
import { EXA_API_URL } from '../lib/exa-constants.js';
/**
 * 通过 Exa + AI 搜索目标公司的决策人
 */
export async function huntDecisionMakers(companyName, roles = ['CEO', 'Founder', 'Procurement Manager']) {
    if (!config.exa.apiKey)
        return [];
    const queries = roles.map(role => `"${companyName}" ${role} LinkedIn profile`);
    const searchPromises = queries.map(query => fetch(EXA_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': config.exa.apiKey },
        body: JSON.stringify({ query, numResults: 2, type: 'neural', useAutoprompt: true, contents: { text: { maxCharacters: 1000 } } }),
    }).then(res => res.json()));
    const results = await Promise.allSettled(searchPromises);
    const allResults = [];
    results.forEach(r => { if (r.status === 'fulfilled')
        allResults.push(...(r.value.results || [])); });
    if (allResults.length === 0)
        return [];
    const aiResponse = await chatCompletion([
        { role: 'system', content: 'You extract B2B decision-maker contacts from search snippets. Return only a JSON array of contacts.' },
        { role: 'user', content: `Target company: ${companyName}\nSearch results: ${JSON.stringify(allResults)}\n\nReturn JSON: [{"name":"...","title":"...","email":"...","phone":"...","linkedIn":"...","source":"..."}]` },
    ], { temperature: 0.1 });
    try {
        const parsed = await parseAIJson(aiResponse.content);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=decision-maker.js.map