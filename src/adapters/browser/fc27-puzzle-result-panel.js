// Development-only aggregate display. No EA root, entities, transaction handle,
// storage or submit callback enters this panel.
export function mountFc27PuzzleResultPanel({ document, report }) {
  if (!document?.body) return null;
  const hostId = 'fcat-puzzle-readonly';
  document.getElementById(hostId)?.remove();
  const host = document.createElement('aside'); host.id = hostId;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;top:72px;right:12px;z-index:100003;font:13px/1.5 Arial,sans-serif;color:#edf1ef;letter-spacing:0}
    *{box-sizing:border-box;letter-spacing:0}section{width:min(360px,calc(100vw - 24px));max-height:calc(100dvh - 96px);overflow:auto;background:#202724;border:1px solid #67736c;border-radius:6px;padding:12px}
    header{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:bold}button{font:inherit;color:inherit;background:#303b35;border:1px solid #67736c;border-radius:4px;min-width:36px;min-height:36px;cursor:pointer}
    button:focus-visible{outline:2px solid #88dcc2}p{margin:8px 0;overflow-wrap:anywhere}small{display:block;color:#bac9c0;margin-top:8px}
    output{display:block;color:#f3d89a;overflow-wrap:anywhere;margin-top:8px}ol{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));list-style:none;padding:0;gap:6px}li{background:#303b35;padding:6px;border-radius:4px;overflow-wrap:anywhere}
  </style><section aria-label="FCAT Puzzle 只读结果"><header><span>FCAT · Puzzle 只读验证</span><button aria-label="关闭结果">×</button></header><div id="content"></div></section>`;
  const content = shadow.getElementById('content');
  const append = (tag, value, parent = content) => {
    const node = document.createElement(tag); node.textContent = value; parent.append(node); return node;
  };
  const number = value => Number.isSafeInteger(value) && value >= 0 ? value : '?';
  const preview = report?.status === 'preview' && report.reason === 'READ_ONLY_PLAN';
  const plan = report?.plan;
  const exact = preview && plan?.exactValidation?.status === 'verified';
  append('p', `Set ${number(report?.setId)} / Challenge ${number(report?.challengeId)}`);
  const status = append('output', preview ? '已找到本地可行方案 · 不是 EA 提交确认' : '本次验证未通过 · 不可执行');
  status.setAttribute('role', 'status');
  append('p', typeof report?.reason === 'string' && /^[A-Z0-9_]{1,100}$/.test(report.reason) ? report.reason : 'FC27_PUZZLE_REPORT_UNAVAILABLE');
  append('p', `安全候选 ${number(plan?.safeCandidates)} · 已选 ${number(preview ? plan?.selectedCount : 0)} / ${number(plan?.required)}`);
  if (preview) {
    append('p', `本地化学 ${number(plan?.teamFacts?.chemistry)} · 队伍评分 ${number(plan?.teamFacts?.teamRating)}`);
    append('p', exact ? `精确 Club 校验：本次 ${number(plan.exactValidation.presentCount)} 张通过` : '精确 Club 校验：未通过或尚未执行');
    const slots = Array.isArray(plan.slots) ? plan.slots : [];
    const ratings = Array.isArray(plan.ratings) ? plan.ratings : [];
    if (slots.length === ratings.length && slots.length <= 11 && slots.every(slot => Number.isSafeInteger(slot) && slot >= 0 && slot < 11)
        && ratings.every(rating => Number.isSafeInteger(rating) && rating > 0 && rating <= 99)) {
      const list = append('ol', '');
      slots.forEach((slot, index) => append('li', `槽位 ${slot + 1} · ${ratings[index]} OVR`, list));
    }
  }
  const checks = [['评分', report?.eaRatingDifferential], ['化学', report?.eaChemistryDifferential],
    ['条件', report?.eaRequirementDifferential]];
  append('p', checks.map(([name, check]) => `EA ${name}：${check?.status === 'verified' ? '对照一致'
    : check?.status === 'mismatch' ? '不一致' : '待验证'}`).join(' · '));
  append('small', '仅显示本次快照，不是执行许可；填阵、保存前必须重新校验。');
  append('small', '没有买卡、填阵、保存或提交。关闭本面板不改变 EA 阵容。');
  shadow.querySelector('button').addEventListener('click', () => host.remove());
  document.body.append(host);
  return { dispose: () => host.remove() };
}
