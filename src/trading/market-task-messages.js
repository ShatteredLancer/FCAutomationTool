export const marketTaskMessages = Object.freeze({
  MARKET_BUSY: '另一个交易操作正在处理，请稍后再试。',
  MARKET_USER_STOP: '已取消后续操作。', MARKET_STOPPED: '全局已暂停，请先核对回执，再解除暂停。',
  MARKET_REFERENCE_UNAVAILABLE: '所选来源没有有效报价；固定价格不依赖报价。',
  MARKET_PRICE_LIMIT: '价格不符合 EA 档位或允许范围，请修改任务价格。',
  MARKET_PRICE_INVALID: '价格无效，请检查百分比和固定价格。',
  MARKET_FUNDS_OR_CAPACITY: '可用金币或 Transfer／Unassigned 槽位不足。',
  MARKET_HOLDING_PROTECTED: '这张卡已锁定、在主阵容中，或被其他任务预留。',
  MARKET_HOLDING_UNAVAILABLE: '选中的实体已不在原位置，或当前不可出售。',
  MARKET_ITEM_OCCUPIED: '这张卡已有任务归属，不能重复使用。',
  MARKET_OTHER_SBC_PENDING: '另一个 SBC 保存或提交尚未结清，请到原页面核对。',
  MARKET_OTHER_PURCHASE_PENDING: '其他买卡流程有未决记录，请到原购买页面核对。',
  MARKET_OTHER_CONTRIBUTION_PENDING: '积分 SBC 贡献尚未确认，请先核对贡献结果。',
  MARKET_OTHER_INVESTMENT_PENDING: '原投资流程有未决交易，请展开原投资页面核对。',
  MARKET_OTHER_LISTING_PENDING: 'Gallery 挂牌正在处理，请先完成或核对该批次。',
  MARKET_OTHER_RELIST_ARMED: 'Gallery 的全部卡自动重挂仍启用，请先关闭，避免两个任务修改同一挂单。',
  MARKET_OTHER_RECORD_UNVERIFIED: '其他流程的记录未通过校验，已保留原记录，请导出诊断。',
  MARKET_PROTECTION_UNVERIFIED: '锁卡或完整主阵容尚未就绪，请打开主阵容后重试。',
  MARKET_RUNTIME_UNVERIFIED: 'EA 原生交易接口尚未通过校验，请导出诊断。',
  MARKET_READ_UNCONFIRMED: 'EA 读取未确认，请稍后核对，不会重复发送买卖。',
  MARKET_SESSION_UNVERIFIED: '会话、余额或市场权限尚未确认。',
  MARKET_RECOVERY_REQUIRED: '有未决交易，请先点击“核对交易回执”。',
  MARKET_RESPONSE_UNCONFIRMED: '交易回执未知，请核对，不会重复买卖。',
  MARKET_TASK_SELECTION_INVALID: '该任务当前不能启动；已停止的任务请复制后重新设置。',
  MARKET_AUTHENTICATION: 'EA 会话已失效，请重新登录。',
  MARKET_THROTTLED: 'EA 返回市场限制，已暂停所有任务。',
  MARKET_CAPTCHA: 'EA 要求验证，已暂停所有任务。',
  MARKET_PROVIDER_FAILED: '执行未完成，请检查诊断记录。',
});

export function marketTaskFailureReason(error) {
  const code = error?.message ?? '';
  if (/^(MARKET|TASKS)_[A-Z_]+$/.test(code)) return code;
  if (/^FC27_.*PROTECTION/.test(code)) return 'MARKET_PROTECTION_UNVERIFIED';
  if (/^FC27_.*(METHOD|RUNTIME|FINGERPRINT)/.test(code)) return 'MARKET_RUNTIME_UNVERIFIED';
  if (/^FC27_.*(JOURNAL|RECORD|RECOVERY|RESERVATION|ARCHIVE)/.test(code)) return 'MARKET_OTHER_RECORD_UNVERIFIED';
  return 'MARKET_PROVIDER_FAILED';
}
