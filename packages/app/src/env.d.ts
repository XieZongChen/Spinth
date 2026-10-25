/** 构建标记（specs/pwa §11.3）：SPINTH_BUILD_TAG 注入，空串不影响行为。
 * 用途：E2E 更新流程证明「确实换了版本」，兼作线上排障标记。 */
declare const __BUILD_TAG__: string;

/** E2E 探针构建期开关（specs/pwa §17.4 P2-4）：SPINTH_E2E=1 的构建才为 true。 */
declare const __E2E_PROBE__: boolean;
