import { expect, it } from 'vitest';
import { streamlinedExecutionMessage } from '../../src/adapters/browser/fc27-streamlined-panel.js';

it('distinguishes unresolved purchases from missing contribution capability', () => {
  const message = streamlinedExecutionMessage('FC27_BUY_RECOVERY_REQUIRED', {
    kind: 'puzzle-purchase', setId: 19, challengeId: 43, phase: 'save-pending' });
  expect(message).toContain('Set 19 / Challenge 43');
  expect(message).toContain('阵容替换保存尚未核对');
  expect(message).toContain('对应 SBC');
  expect(message).not.toContain('接口');
  expect(streamlinedExecutionMessage('FC27_STREAMLINED_WRITE_CONTRACT_UNVERIFIED')).toContain('未启用贡献接口');
  expect(streamlinedExecutionMessage('FC27_STREAMLINED_RECONCILIATION_REQUIRED')).toContain('不要重复投入');
  expect(streamlinedExecutionMessage(null)).not.toContain('接口');
});

it('shows bounded purchase-state counts without claiming local counts prove settlement', () => {
  const message = streamlinedExecutionMessage('FC27_BUY_RECOVERY_REQUIRED', {
    kind: 'puzzle-purchase', setId: 21, challengeId: 48, phase: 'ready',
    states: { waiting: 2, club: 3, 'buy-pending': 1 }, applied: 2 });
  expect(message).toContain('未购买 2');
  expect(message).toContain('成交待核对 1');
  expect(message).toContain('已入库 3');
  expect(message).toContain('已确认替换 2');
  expect(message).toContain('请先回对应 SBC');
});
