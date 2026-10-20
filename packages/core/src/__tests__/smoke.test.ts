import { describe, expect, it } from 'vitest';
import { CURRENT_PHASE, SPINTH_NAME, SPINTH_VERSION } from '../index';

describe('@spinth/core smoke', () => {
  it('exports package meta', () => {
    expect(SPINTH_NAME).toBe('spinth');
    expect(SPINTH_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(CURRENT_PHASE).toBe(4); // Batch 2 版本对齐（Phase 0-4 完成）
  });
});
