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

## Enhancer compatibility evidence

`tests/fixtures/enhancer-listing-price-reference.js` retains a narrow price-tier
helper excerpt from FC27 Enhancer 27.0.0.4 for same-input regression comparison.
The observed bundle fingerprint is recorded in that fixture. The original
authors retain their rights; this excerpt is not relicensed under FCAT's MIT
license and is not included in the production userscript. FCAT does not bundle
Enhancer's application, UI bundle, authentication, or private price service.

## Runtime Services

The optional Gallery Fodder-style dialogs adapt the layout and per-batch
interactions observed in Fodder GG 1.3.3 (`nc/ei/sc`, `AI/PI`, `GC/KC/Dt`,
and `VI/jI`). Fodder GG and its authors retain their code and branding rights.
The inspected client is not bundled, loaded, or called by FCAT. EA account
transactions and public-price policies remain FCAT's independent services;
the style name does not imply affiliation or use of Fodder's private backend.
See `docs/FC27_GALLERY_TRADE_STYLES_ZH.md` for the compatibility boundaries.

FCAutomationTool can request player metadata or prices from FUT.GG, FUTBIN, and
FUTNext, and can optionally send reward messages to ntfy.sh. These services
are not bundled with or operated by this project and remain subject to their
own terms and privacy policies.

EA, EA SPORTS, Ultimate Team, and related marks belong to Electronic Arts.
This project is unofficial and is not endorsed by or affiliated with EA.

`tests/fixtures/fc27-buy-method-observation.json` retains limited public EA Web
App method excerpts solely as compatibility regression evidence. These EA
excerpts remain the property of Electronic Arts and are not relicensed under
this project's MIT license or included in the production userscript.
