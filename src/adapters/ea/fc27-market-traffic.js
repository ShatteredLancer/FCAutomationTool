// FC27-only dependency registry, never installed on unsafeWindow or EA objects.
const services=new WeakMap();
export const registerFc27MarketTraffic=(root,service)=>{services.set(root,service);};
export const fc27MarketTraffic=root=>services.get(root)??null;
export async function runFc27MarketRequest(root,kind,check,operation,options){
 try{return await (services.get(root)?.run(kind,check,operation,options)??operation(()=>{}));}
 catch(error){if(!options?.rawErrors&&/^MARKET_TRAFFIC_[A-Z_]+$/.test(error?.message??''))error.message='FC27_'+error.message;throw error;}
}

