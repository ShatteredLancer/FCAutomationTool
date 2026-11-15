// Task buy responses only. Other market actions keep their existing contracts.
// Preserve both layers; a 403 transport status is not itself a rate-limit code.
export function marketTaskBuyResponse(reply) {
  const numeric = n => Number.isSafeInteger(n) && n >= 100 && n <= 99999 ? n : null;
  const httpStatus = numeric(reply?.status), errorCode = numeric(reply?.error?.code);
  const code = [401,429].includes(httpStatus) ? httpStatus : errorCode ?? httpStatus;
  const ids = reply?.data?.itemIds;
  const contradictory = ids != null && (!Array.isArray(ids) || ids.length > 0);
  const rejected = reply?.success === false && !contradictory
    && [400,401,403,404,409,426,429,461,470,473,478].includes(httpStatus);
  let category = null, stop = null;
  if (httpStatus === 401 || errorCode === 401) { category = 'authentication'; stop = 'authentication'; }
  else if ([458,459].includes(errorCode)) { category = 'captcha'; stop = 'captcha'; }
  else if ([429,512,521,427,494].includes(httpStatus) || [429,512,521,427,494].includes(errorCode)
    || errorCode===null&&httpStatus===426) { category = 'throttle'; stop = 'throttle'; }
  else if (rejected && [426,461,478].includes(errorCode)) category = 'offer-rejected';
  else if (rejected && errorCode === 470) category = 'insufficient-funds';
  else if (rejected && errorCode === 473) category = 'destination-full';
  else if (httpStatus === 403 || errorCode === 403) { category = 'purchase-denied'; stop = 'manual'; }
  return { code, httpStatus, errorCode, category, stop, rejected };
}
