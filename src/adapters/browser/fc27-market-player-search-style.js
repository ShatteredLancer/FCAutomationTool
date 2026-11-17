// EA web-app player-search / button-group rules, scoped for FCAT's shadow DOM.
// Native page styles cannot cross the shadow boundary. No global overrides.
export const marketPlayerSearchStyle=`
#picker .dialog-body{min-height:350px}
#picker .ut-player-search-control{position:relative;margin-bottom:16px;font-family:UltimateTeam,sans-serif}
#picker .inline-container{position:relative;white-space:nowrap;text-overflow:ellipsis}
#picker .ut-player-search-control--input-container{position:relative}
#picker .ut-player-search-control input{box-sizing:border-box;width:100%;height:48px;line-height:48px;font-size:18px;color:#fcfcfc;background:#0e141b;border:1px solid #deded826;border-radius:8px;padding:0 48px 0 40px}
#picker .ut-player-search-control input:focus{border-color:#9effc6;outline:none}
#picker .ut-player-search-control .icon_magnifier{position:absolute;left:16px;top:0;height:48px;line-height:48px;font-size:16px;color:#fcfcfc;pointer-events:none}
#picker .ut-player-search-control .fut_icon{font-family:UltimateTeam-Icons}
#picker .ut-player-search-control .icon_magnifier:before{content:'\\e09e'}
#picker .ut-player-search-control .inline-list-btn{position:absolute;right:0;top:0;width:48px;height:48px;padding:0;display:none;border:0;background:transparent;color:#fcfcfc;border-radius:0}
#picker .ut-player-search-control.has-selection .inline-list-btn{display:block}
#picker .ut-player-search-control .exit-btn:before{content:'×';font-family:sans-serif;font-size:24px}
#picker .ut-player-search-control.is-open{z-index:1}
#picker .ut-player-search-control .inline-list{position:absolute;box-sizing:border-box;width:100%;max-height:14rem;overflow:auto;padding:8px;border-radius:10px;background:#233144;border:solid #deded826;border-width:0 1px 1px}
#picker .ut-player-search-control .sectionHeader{display:flex;box-sizing:border-box;padding:8px;width:100%;color:#a6a6a1}
#picker .ut-player-search-control .playerNameTitle,#picker .ut-player-search-control .btn-text{box-sizing:border-box;width:70%;padding-right:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
#picker .ut-player-search-control .ratingTitle,#picker .ut-player-search-control .btn-subtext{box-sizing:border-box;width:30%;padding-right:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#picker .ut-player-search-control .ut-button-group{padding:0;margin:0;list-style:none}
#picker .ut-player-search-control .ut-button-group button{display:flex;align-items:center;flex-direction:row;width:100%;margin:0;padding:12px;text-align:left;border:0;border-radius:0;background:transparent;color:#fcfcfc;font:400 18px/20px UltimateTeam,sans-serif}
#picker .ut-player-search-control .ut-button-group button:not(:first-child){border-top:1px solid #deded826}
#picker .ut-player-search-control .ut-button-group button:hover,#picker .ut-player-search-control .ut-button-group button:focus{background:#151d29}
#picker .ut-player-search-control .btn-subtext{margin-left:auto}
#picker .ut-player-search-control .playerResultsEmpty{padding:12px;color:#a6a6a1}
#picker .player-name-row{width:100%;display:grid;grid-template-columns:minmax(0,7fr) minmax(3em,3fr);text-align:left;border-radius:0;padding:12px}
#picker .player-name-row span:first-child{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
`;
