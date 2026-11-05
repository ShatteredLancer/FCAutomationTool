export const tradingStyle=`
#page-trading{min-width:0;overflow-wrap:anywhere}
#page-trading [hidden]{display:none!important}
.trading-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.trading-grid>*{min-width:0}
.trading-card{margin:14px 0;padding:18px;border:1px solid #435862;border-radius:7px;background:#22323d}
.trading-card h3{margin:0 0 12px}.trading-card h4{margin:0 0 8px}
.trading-card small{display:block;color:#bdcbd3;line-height:1.6}
.trading-card p{line-height:1.65}
.trading-card label{min-width:0;max-width:100%}
.trading-card input,.trading-card select{min-width:0;max-width:100%;width:100%;box-sizing:border-box}
.trading-card input[type=checkbox]{width:18px;flex:0 0 18px}
.trading-card label:has(input[type=checkbox]){display:flex;align-items:center;gap:10px}
.trading-card a{color:#9df3d5;text-decoration:underline}
.trading-card summary{cursor:pointer;line-height:1.6;padding:4px 0}
.trading-card details{margin:12px 0;color:#bdcbd3}
.trading-card article.trading-card{background:#1c2b35;border-color:#3a505c;margin:10px 0}
.trading-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}
.trading-row>*{min-width:0;flex:0 1 auto}
.trading-row button{min-height:42px}
.trading-generate{align-self:end;margin:0 0 8px}.trading-generate>button{width:100%}
.trading-nav{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid #435862;padding:0 0 12px;margin:16px 0}
.trading-nav button{background:transparent;border-color:transparent;color:#bdcbd3;min-height:42px;padding:8px 14px}
.trading-nav button[aria-selected=true]{color:#9df3d5;background:#22323d;border-color:#9df3d5}
#page-trading button:focus-visible,#page-trading summary:focus-visible{outline:2px solid #9df3d5;outline-offset:3px}
#page-trading button.trading-primary{color:#14232b;background:#9df3d5;border-color:#9df3d5;font-weight:700}
#page-trading button.trading-primary:disabled{background:#35494f;border-color:#435862;color:#9eacb4}
#page-trading button.trading-stop{border-color:#da9b76;color:#ffdbb5}
.trading-step{color:#bdcbd3;font-size:13px;margin:0 0 16px}
.trading-status{display:block;margin:12px 0;line-height:1.65;color:#cbd9e0}
.trading-status:empty{display:none}
.trading-status[data-state=error]{border-left:3px solid #e9ba75;background:#332f26;padding:12px;color:#ffdbb5}
.trading-status[data-state=ready]{border-left:3px solid #9df3d5;padding:8px 12px;background:#1c3433}
.trading-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:14px 0}
.trading-metric{padding:12px;background:#182831;border-radius:5px}
.trading-metric strong{display:block;font-size:22px;margin-top:5px;font-variant-numeric:tabular-nums}
.trading-table-wrap{overflow-x:auto;margin:12px 0}
.trading-table{width:100%;border-collapse:collapse;text-align:left;font-variant-numeric:tabular-nums}
.trading-table th{font-size:12px;font-weight:400;color:#bdcbd3;padding:10px 8px;border-bottom:1px solid #526671;white-space:nowrap}
.trading-table td{padding:12px 8px;border-bottom:1px solid #3a505c;vertical-align:top}
.trading-table td:first-child{min-width:130px}
.trading-table td details{margin:4px 0 0}
.trading-table td:not(:first-child){white-space:nowrap}
.trading-table td button{padding:6px 10px;min-height:34px}
.trading-approval{padding:14px 0;border-top:1px solid #435862;line-height:1.6}
.trading-funding{font-size:14px;color:#bdcbd3}.trading-ledger{overflow-wrap:anywhere}
.trading-chart{width:100%;height:100px;background:#17212c}
.trading-warning{color:#ffdb8c}.trading-opportunity{border-color:#9df3d5}
@media(max-width:600px){.trading-card{padding:12px}.trading-nav{gap:2px}.trading-nav button{padding:8px;font-size:12px}.trading-metrics{gap:6px}.trading-metric{padding:8px}.trading-metric strong{font-size:18px}.trading-grid{grid-template-columns:minmax(0,1fr)}.trading-row>*{flex:1 1 140px}
.trading-table thead{display:none}.trading-table,.trading-table tbody{display:block}.trading-table tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:12px 0;border-bottom:1px solid #435862}.trading-table td{display:block;border:0;padding:0;min-width:0!important;white-space:normal!important}.trading-table td:first-child{grid-column:1/-1}.trading-table td[data-label]:before{content:attr(data-label);display:block;font-size:12px;color:#bdcbd3;margin-bottom:4px}}
`;
