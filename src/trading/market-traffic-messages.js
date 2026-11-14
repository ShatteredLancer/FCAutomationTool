// Shared wording for legacy buying/listing screens. No execution dependencies.
export const marketTrafficMessages = Object.freeze({
  FC27_MARKET_TRAFFIC_WAIT: 'FCAT 共用市场正在等待请求间隔或搜索额度恢复。未发送本次请求；可在市场交易页查看下一次可搜索时间，稍后重新操作。',
  FC27_MARKET_TRAFFIC_STOPPED: 'FCAT 市场请求已暂停。请先处理登录、验证码或限流，在市场交易页点击解除全局暂停；不会自动续买或挂牌。',
  FC27_MARKET_TRAFFIC_INVALID: '共用市场记录无法验证，未继续请求；请保留记录并导出诊断。',
  FC27_MARKET_TRAFFIC_STORAGE_LIMIT: '共用市场记录已达到容量限制，已停止后续请求；原记录保留，请导出诊断。',
  FC27_MARKET_TRAFFIC_SAVE_UNVERIFIED: '共用市场记录保存未确认，已停止后续请求；已有回执仍保留，请先核对结果。',
  FC27_MARKET_TRAFFIC_CONTEXT_CHANGED: '账号或平台已改变，本次市场操作已停止。',
  FC27_MARKET_TRAFFIC_LOCK_UNAVAILABLE: '无法取得共用市场锁，本次请求未发送。',
});
