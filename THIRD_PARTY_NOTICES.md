# Third-Party Notices

## FSU 26.09

`FSU_mod/` contains an immutable copy of FSU 26.09 and a locally maintained
derivative. The upstream userscript identifies the original author as
`Futcd_kcka` and declares the MIT License.

- Upstream version: `26.09`
- Upstream source: <https://update.greasyfork.org/scripts/431044/%E3%80%90FSU%E3%80%91EAFC%20FUT%20WEB%20%E5%A2%9E%E5%BC%BA%E5%99%A8.user.js>
- Local version: `26.09.1`
- Local changes: Club entity caching, scoped payload capture, diagnostics, and
  targeted validation integration documented under `FSU_mod/`

The original author, metadata attribution, and MIT notice are retained. See
[`FSU_mod/LICENSE`](FSU_mod/LICENSE) and
[`FSU_mod/fsu-mod-manifest.json`](FSU_mod/fsu-mod-manifest.json).

FCAT's independent concept-player buyer also adapts the bounded price search
and serial search/buy/move flow from FSU 26.09 `readAuctionPrices` and
`buyConceptPlayer`, plus `futbinId.getId/getPrice/setPrice` and the native loader
and purchase-button behavior. See `src/fc27/fsu-auction-search.js`,
`src/fc27/fsu-reference-price.js`, `src/adapters/browser/fc27-futbin-http.js`,
`src/adapters/browser/fc27-puzzle-buy-button.js`, and
`src/adapters/ea/fc27-puzzle-buy.js`. The MIT attribution and permission notice
are retained in the source and bundled userscript. It does not call FSU's
buttons, functions, settings or loader; FSU installation is not required for
this purchase feature. Puzzle selection/submission keeps its separate policies.

## Runtime Services

FCAutomationTool can request player metadata or prices from FUT.GG, FUTBIN, and
FUTNext, and can optionally send reward messages to ntfy.sh. These services
are not bundled with or operated by this project and remain subject to their
own terms and privacy policies.

EA, EA SPORTS, Ultimate Team, and related marks belong to Electronic Arts.
This project is unofficial and is not endorsed by or affiliated with EA.
