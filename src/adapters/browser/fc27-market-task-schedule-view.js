export const marketScheduleSummary = task => task.schedule
 ? `${task.schedule.repeat==='daily'?'每天':'单次'} · ${task.mode==='sell'?'挂牌':'买入'} ${task.schedule.start}${task.mode==='sell'?'':`–${task.schedule.end??'满仓'} · 挂牌 ${task.schedule.sell??'买后立即'}`} · ${task.schedule.zone}` : '立即执行';

export function mountMarketScheduleEditor({document,parent}){
 const box=document.createElement('details');box.className='box';box.id='market-schedule';
 box.innerHTML='<summary>执行时间</summary><label class="check"><input id="schedule-enabled" type="checkbox">定时执行</label><div id="schedule-fields" hidden><div class="fields two"><label>重复<select id="schedule-repeat"><option value="once">执行一次</option><option value="daily">每天</option></select></label><label><span id="schedule-start-label">买入开始</span><input id="schedule-start" type="datetime-local"></label><label id="schedule-end-label">买入结束<input id="schedule-end" type="datetime-local"><small>留空直到转会列表满</small></label><label id="schedule-sell-label">卖出开始<input id="schedule-sell" type="datetime-local"><small>留空为买入后立即挂牌</small></label></div><p id="schedule-zone" class="hint"></p><p class="hint">满仓后本轮不再补买。每日较早的结束／挂牌时间表示次日。保持本页面运行；暂停、离页或刷新后需手动继续。纯定时等待不计入累计运行上限。</p></div>';
 const style=document.createElement('style');style.textContent='@media(max-width:600px){#market-schedule .fields{grid-template-columns:minmax(0,1fr)}}';box.append(style);
 parent.insertBefore(box,parent.querySelector('#moreRules'));const $=id=>box.querySelector(`#schedule-${id}`);
 let zone=Intl.DateTimeFormat().resolvedOptions().timeZone,previous='once';
 const localDefault=()=>{const d=new Date(Date.now()+3600000);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:00`;};
 const refresh=mode=>{
  const daily=$('repeat').value==='daily';
  if(previous!==$('repeat').value){for(const key of ['start','end','sell']){const n=$(key),value=n.value;n.type=daily?'time':'datetime-local';n.value=value?(daily?value.slice(-5):`${localDefault().slice(0,10)}T${value}`):'';}previous=$('repeat').value;}
  $('fields').hidden=!$('enabled').checked;$('start-label').textContent=mode==='sell'?'卖出开始':'买入开始';
  $('end-label').hidden=$('sell-label').hidden=mode==='sell';$('zone').textContent=`时区：${zone}。定时开始表示最早执行时间，仍遵守请求间隔。`;
 };
 return {open(schedule,mode){
  zone=schedule?.zone??Intl.DateTimeFormat().resolvedOptions().timeZone;previous=schedule?.repeat??'once';$('repeat').value=previous;$('enabled').checked=!!schedule;
  for(const key of ['start','end','sell']){$(key).type=previous==='daily'?'time':'datetime-local';$(key).value=schedule?.[key]??(key==='start'?localDefault():'');}
  box.open=!!schedule;refresh(mode);
 },refresh,read(mode){refresh(mode);return $('enabled').checked?{repeat:$('repeat').value,zone,start:$('start').value,end:mode==='sell'?null:$('end').value||null,sell:mode==='sell'?null:$('sell').value||null}:null;}};
}
