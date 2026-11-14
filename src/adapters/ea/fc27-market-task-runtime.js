import { runFc27MarketRequest, fc27MarketTraffic } from './fc27-market-traffic.js';
import { observeFc27TrafficResult } from './fc27-market-traffic-runtime.js';
// Local facade only: never patch the real EA service or the frozen FC26 trade
// adapter. Each task retains its own market entity cache and one active boundary.
export function marketTaskNativeRuntime(root, requestRoot = root) {
  let boundary = null;
  const wrap = (target, overrides) => new Proxy(target, { get(object, key) {
    if (Object.hasOwn(overrides, key)) return overrides[key];
    const value = Reflect.get(object, key, object);
    return typeof value === 'function' ? value.bind(object) : value;
  } });
  const service = root.services.Item;
  const methods = Object.fromEntries(['searchTransferMarket', 'bid', 'move', 'list'].map(name => [name, (...args) => {
    const permit = boundary;
    if (!permit) throw Error('MARKET_NOT_SENT');
    const invoke=(mark=()=>{})=>{permit.beforeDispatch(args[0]);mark();
    const result = service[name](...args);
    const receive = value => { permit.onResponse(value); return value; };
    if (typeof result?.then === 'function') return result.then(receive);
    if (typeof result?.observe !== 'function') return receive(result);
    return wrap(result, { observe(owner, callback) {
      return result.observe(owner, (sender, value) => callback(sender, receive(value)));
    } });};
    if(!fc27MarketTraffic(requestRoot))return invoke();
    return runFc27MarketRequest(requestRoot,name==='searchTransferMarket'?'search':name==='bid'?'buy':name,()=>{if(boundary!==permit)throw Error('MARKET_NOT_SENT');},
      mark=>observeFc27TrafficResult(invoke(mark)),{wait:false,exactDispatch:true,rawErrors:true}).catch(error=>{permit.onBlocked?.(error);throw error;});
  }]));
  const runtime = wrap(root, { services: wrap(root.services, { Item: wrap(service, methods) }) });
  return { runtime, async dispatch(permit, operation) {
    if (boundary) throw Error('MARKET_BUSY');
    boundary = permit;
    try { return await operation(); } finally { boundary = null; }
  } };
}
