/**
 * 决策人搜索 - 精简版
 * 从 src/lib/radar/enrich-pipeline.ts 提取
 */
export interface DecisionMaker {
    name: string;
    title: string;
    email?: string;
    phone?: string;
    linkedIn?: string;
    source?: string;
}
/**
 * 通过 Exa + AI 搜索目标公司的决策人
 */
export declare function huntDecisionMakers(companyName: string, roles?: string[]): Promise<DecisionMaker[]>;
