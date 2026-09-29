// FSU externalRequest GET transport, isolated from EA cookies and credentials.
export function createFc27FutbinHttp(gmRequest) {
  return url => new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://www.futbin.org' || !/^\/futbin\/api\/27\/(getFilteredPlayers|fetchPlayerInformationMinimal)$/.test(parsed.pathname)
        || parsed.username || parsed.password || typeof gmRequest !== 'function') {
      reject(Error('FC27_BUY_REFERENCE_PRICE_UNAVAILABLE')); return;
    }
    gmRequest({ method: 'GET', url, anonymous: true, headers: { 'Content-Type': 'application/json' },
      onload: response => {
        if (![200, 201].includes(response.status)) reject(Error(`FC27_BUY_REFERENCE_HTTP_${Number(response.status) || 0}`));
        else resolve(response.responseText);
      },
      onerror: () => reject(Error('FC27_BUY_REFERENCE_PRICE_UNAVAILABLE')),
    });
  });
}
