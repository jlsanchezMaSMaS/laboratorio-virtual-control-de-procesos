import { ProcessSimulation } from './simulation.js';
import { DEFAULTS } from './model.js';

const $=id=>document.getElementById(id);
const simulation=new ProcessSimulation();
let running=false,raf=0,previous=0,accumulator=0,lastDraw=0;
const dt=DEFAULTS.dt;
const fmt=(x,n=2)=>Number.isFinite(x)?x.toFixed(n):'—';
const readings=[
  ['Nivel','level','m','teal'],['Volumen','volume','m³','blue'],['Temperatura tanque','temperature','°C','amber'],['Temperatura descarga','outletTemp','°C','amber'],
  ['Presión alimento (absoluta)','feedPressureAbsBar','bar(a)','teal','feedPressureBar'],['Caudal volumétrico entrada','qIn','m³/h','blue'],['Caudal másico entrada','massIn','kg/s','blue'],
  ['Presión descarga (absoluta)','dischargePressureAbsBar','bar(a)','teal','dischargePressureBar'],['Caudal volumétrico salida','qOut','m³/h','blue'],['Caudal másico salida','massOut','kg/s','blue'],
  ['Frecuencia P-102','dischargeFrequency','Hz','amber'],['Flujo de vapor','steamFlow','kg/s','amber'],['Presión vapor','steamPressureKPa','kPa abs','amber'],
  ['Apertura TV-101','valve','%','amber'],['Acumulación masa','massRate','kg/s','blue']
];

function renderReadings(s){
  $('readings').innerHTML=readings.map(([label,key,unit,color,gaugeKey])=>`<div class="reading"><div class="reading-label">${label.toUpperCase()}</div><div class="reading-value ${color}">${fmt(s[key],key==='massRate'||key==='massIn'||key==='massOut'||key==='steamFlow'?4:2)} <small>${unit}</small></div>${gaugeKey?`<div class="reading-detail">${fmt(s[gaugeKey],2)} bar(g)</div>`:''}</div>`).join('');
  $('clock').textContent=fmt(s.time,1);
  const h=simulation.model.p.maxHeight,liquidY=273-(s.level/h)*(273-111);
  $('liquid').setAttribute('d',`M272 ${liquidY}H480V273Q480 296 456 296H296Q272 296 272 273Z`);
  $('schematic-qin').textContent=`${fmt(s.qIn,2)} m³/h`; $('schematic-qout').textContent=`${fmt(s.qOut,2)} m³/h`;
  $('schematic-pin').textContent=`${fmt(s.feedPressureAbsBar,2)} bar(a)`; $('schematic-pout').textContent=`${fmt(s.dischargePressureAbsBar,2)} bar(a)`;
  $('schematic-tin').textContent=`${fmt(s.inletTemp,1)} °C`; $('schematic-temp').textContent=`${fmt(s.temperature,1)} °C`; $('schematic-tout').textContent=`${fmt(s.outletTemp,1)} °C`; $('schematic-valve').textContent=`${fmt(s.valve,0)} %`;
  $('agitation').checked=s.agitation;$('mode-description').textContent=simulation.controls.heatMode==='manual'?(s.agitation?'Tanque mezclado · T salida = T tanque':'Intercambiador · agitador detenido'):'Intercambiador · agitador detenido · PV = T salida';
  $('agitator-action').textContent=simulation.controls.heatMode==='manual'?(s.agitation?'Detener agitador':'Arrancar agitador'):'Pasar a manual y arrancar agitador';
  $('schematic-state').textContent=`${s.agitation?'AGITADO':'SIN AGITACIÓN'} · ${fmt(s.volume,2)} m³ · ${fmt(s.level,2)} m`;
  $('agitator-symbol').classList.toggle('stopped',!s.agitation);$('pid-valve').classList.toggle('closed',s.valve<=0);
  if(['discharge','coordinated'].includes(simulation.controls.levelMode))$('fout').value=s.dischargeFrequency;
  else $('fout').value=simulation.controls.levelManual;
  if(['feed','coordinated'].includes(simulation.controls.levelMode))$('fin').value=s.feedFrequency;
  else $('fin').value=simulation.controls.feedManual;
  if(simulation.controls.heatMode==='manual')$('valve').value=simulation.controls.valveManual;else $('valve').value=s.valve;
  $('fout-value').innerHTML=`${fmt(+$('fout').value,1)} <small>Hz</small>`;$('valve-value').innerHTML=`${fmt(+$('valve').value,1)} <small>%</small>`;
  $('fin-value').innerHTML=`${fmt(+$('fin').value,1)} <small>Hz</small>`;
  drawCharts();
}

function drawChart(id,series,target=null,data=simulation.history){
  const canvas=$(id),rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
  if(rect.width<1||!data?.length)return;
  const width=rect.width,height=154;
  if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr)}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  const pad={l:34,r:10,t:10,b:19},pw=width-pad.l-pad.r,ph=height-pad.t-pad.b;
  ctx.clearRect(0,0,width,height);ctx.font='8px "DM Mono", monospace';ctx.fillStyle='#70838e';ctx.strokeStyle='#2b3d49';ctx.lineWidth=1;
  for(let i=0;i<4;i++){const y=pad.t+ph*i/3;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(width-pad.r,y);ctx.stroke();ctx.fillText((1-i/3).toFixed(1),3,y+3)}
  const end=data[data.length-1].time,maxX=Math.max(.5,end),minX=Math.max(0,maxX-120),span=Math.max(.5,maxX-minX);
  for(const line of series){ctx.strokeStyle=line.color;ctx.lineWidth=1.8;ctx.beginPath();let started=false,last=null;
    for(const point of data){if(point.time<minX)continue;const value=Number(point[line.key])||0,x=pad.l+(point.time-minX)/span*pw,y=pad.t+ph-(value-line.min)/Math.max(1e-9,line.max-line.min)*ph;if(!started){ctx.moveTo(x,y);started=true}else ctx.lineTo(x,y);last=[x,y]}
    ctx.stroke();if(last){ctx.fillStyle=line.color;ctx.beginPath();ctx.arc(last[0],last[1],2.3,0,Math.PI*2);ctx.fill()}
  }
  if(target){const y=pad.t+ph-(target.value-target.min)/(target.max-target.min)*ph;ctx.save();ctx.setLineDash([4,4]);ctx.strokeStyle=target.color||'#e8eff2';ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(width-pad.r,y);ctx.stroke();ctx.restore()}
  ctx.fillStyle='#70838e';ctx.fillText(`${fmt(minX,0)}s`,pad.l,height-2);ctx.fillText(`${fmt(maxX,1)}s`,width-39,height-2);
}
function drawCharts(){
  const p=simulation.model.p,c=simulation.controls;
  drawChart('chart-state',[{key:'level',min:0,max:p.maxHeight,color:'#43d6b4'},{key:'outletTemp',min:0,max:100,color:'#f5b55d'}],{value:72,min:0,max:100,color:'#f5b55d'});
  const pressureMax=Math.max(2,p.pumpShutoffKPa/100*1.1);
  drawChart('chart-hydraulics',[{key:'qIn',min:0,max:3,color:'#64aaff'},{key:'qOut',min:0,max:3,color:'#43d6b4'},{key:'feedPressureBar',min:0,max:pressureMax,color:'#f5b55d'},{key:'dischargePressureBar',min:0,max:pressureMax+.3,color:'#ff8580'}]);
  drawChart('chart-frequency',[{key:'feedFrequency',min:0,max:60,color:'#43d6b4'},{key:'dischargeFrequency',min:0,max:60,color:'#f5b55d'}]);
  drawChart('chart-level-loop',[{key:'levelSetpoint',min:0,max:p.maxHeight,color:'#d5dee3'},{key:'level',min:0,max:p.maxHeight,color:'#43d6b4'},{key:'feedFrequency',min:0,max:60,color:'#64aaff'},{key:'dischargeFrequency',min:0,max:60,color:'#f5b55d'}]);
  drawChart('chart-temp-loop',[{key:'temperatureSetpoint',min:0,max:100,color:'#d5dee3'},{key:'temperature',min:0,max:100,color:'#43d6b4'},{key:'valveOutput',min:0,max:100,color:'#f5b55d'}],{value:c.temperatureSetpoint,min:0,max:100,color:'#d5dee388'});
  drawChart('chart-cascade',[{key:'temperatureSetpoint',min:0,max:100,color:'#d5dee3'},{key:'temperature',min:0,max:100,color:'#43d6b4'},{key:'steamFlowSetpoint',min:0,max:p.maxSteamFlow,color:'#64aaff'},{key:'steamFlow',min:0,max:p.maxSteamFlow,color:'#ff8580'},{key:'valveOutput',min:0,max:100,color:'#f5b55d'}],{value:c.temperatureSetpoint,min:0,max:100,color:'#d5dee388'});
  const comparison=simulation.comparison?.history||[];
  if(comparison.length)drawChart('chart-comparison',[{key:'setpoint',min:0,max:100,color:'#d5dee3'},{key:'feedback',min:0,max:100,color:'#64aaff'},{key:'cascade',min:0,max:100,color:'#f5b55d'}],{value:c.temperatureSetpoint,min:0,max:100,color:'#d5dee388'},comparison);
}

function syncModeUI(){const c=simulation.controls;$('level-mode').value=c.levelMode;$('heat-mode').value=c.heatMode;$('fout').disabled=['discharge','coordinated'].includes(c.levelMode);$('fin').disabled=['feed','coordinated'].includes(c.levelMode);$('valve').disabled=c.heatMode!=='manual';$('agitation').disabled=c.heatMode!=='manual';$('valve-caption').textContent=c.heatMode==='manual'?'TV-101 · manual':'TV-101 · '+(c.heatMode==='feedback'?'PI feedback':'lazo esclavo PI');$('mode-description').textContent=c.heatMode==='manual'?($('agitation').checked?'Tanque mezclado · T salida = T tanque':'Intercambiador · agitador detenido'):'Intercambiador · agitador detenido · PV = T salida';$('level-mode-description').textContent=c.levelMode==='coordinated'?'P-101 y P-102 coordinadas':c.levelMode==='feed'?'P-101 automática · P-102 manual':c.levelMode==='discharge'?'P-102 automática · P-101 manual':'Ambas bombas en manual'}
function syncResetControls(){
  $('fin').value=simulation.model.inputs.feedFrequency;$('fout').value=simulation.controls.levelManual;$('feed').value=simulation.model.inputs.feedRequest;$('tin').value=simulation.model.inputs.inletTemp;$('valve').value=simulation.controls.valveManual;$('steam-base').value=simulation.model.inputs.steamPressureKPa;
  $('pump-head').value=(simulation.model.p.pumpShutoffKPa/100).toFixed(1);
  $('fin-value').innerHTML=`${$('fin').value} <small>Hz</small>`;$('feed-value').innerHTML=`${(+$('feed').value).toFixed(2)} <small>m³/h</small>`;$('tin-value').innerHTML=`${$('tin').value} <small>°C</small>`;
  $('level-sp').value=simulation.controls.levelSetpoint;$('temperature-sp').value=simulation.controls.temperatureSetpoint;
  for(const [suffix,time,delta]of [['feed',30,.2],['tin',60,-5],['steam',90,-50]]){$(`p-${suffix}-enable`).checked=false;$(`p-${suffix}-time`).value=time;$(`p-${suffix}-delta`).value=delta}
}
function stateForTransfer(){return simulation.instruments.measure(simulation.model)}
function readManualInputs(){
  simulation.setFeedFrequency(+$('fin').value);simulation.setLevelManual(+$('fout').value);simulation.setValveManual(+$('valve').value);
  simulation.setDisturbanceBase('feedRequest',+$('feed').value);simulation.setDisturbanceBase('inletTemp',+$('tin').value);
  $('fin-value').innerHTML=`${$('fin').value} <small>Hz</small>`;$('feed-value').innerHTML=`${(+$('feed').value).toFixed(2)} <small>m³/h</small>`;$('tin-value').innerHTML=`${$('tin').value} <small>°C</small>`;
  simulation.refresh();renderReadings(simulation.last);
}
for(const id of ['fin','fout','feed','tin','valve'])$(id).addEventListener('input',readManualInputs);
$('level-mode').addEventListener('change',()=>{simulation.setLevelMode($('level-mode').value);syncModeUI();renderReadings(simulation.last)});
$('heat-mode').addEventListener('change',()=>{simulation.setHeatMode($('heat-mode').value);syncModeUI();renderReadings(simulation.last)});
$('agitation').addEventListener('change',()=>{if(simulation.controls.heatMode!=='manual')return;$('mode-description').textContent=$('agitation').checked?'Tanque mezclado · T salida = T tanque':'Intercambiador · agitador detenido';simulation.model.setInputs({agitation:$('agitation').checked});simulation.refresh();renderReadings(simulation.last)});
$('agitator-action').addEventListener('click',()=>{if(simulation.controls.heatMode!=='manual'){simulation.setHeatMode('manual');syncModeUI()}simulation.model.setInputs({agitation:!simulation.model.inputs.agitation});simulation.refresh();renderReadings(simulation.last)});
$('level-sp').addEventListener('change',()=>{simulation.setLevelSetpoint(Math.max(0,Math.min(simulation.model.p.maxHeight,+$('level-sp').value)));renderReadings(simulation.last)});
$('temperature-sp').addEventListener('change',()=>{simulation.setTemperatureSetpoint(Math.max(5,Math.min(95,+$('temperature-sp').value)));renderReadings(simulation.last)});
$('steam-base').addEventListener('change',()=>{const v=Math.max(101.3,Math.min(800,+$('steam-base').value));$('steam-base').value=v;simulation.model.p.steamPressureKPa=v;simulation.setDisturbanceBase('steamPressureKPa',v);renderReadings(simulation.last)});
$('apply-gains').addEventListener('click',()=>{
  const values={level:{kp:+$('level-kp').value,ki:+$('level-ki').value},temperature:{kp:+$('temp-kp').value,ki:+$('temp-ki').value},master:{kp:+$('master-kp').value,ki:+$('master-ki').value},slave:{kp:+$('slave-kp').value,ki:+$('slave-ki').value}};
  if(Object.values(values).some(g=>!Number.isFinite(g.kp)||!Number.isFinite(g.ki)||g.kp<0||g.ki<0)){alert('Las ganancias PI deben ser números mayores o iguales a cero.');return}
  for(const [loop,g]of Object.entries(values))simulation.setLoopConfig(loop,g);renderReadings(simulation.last);
});
$('apply-perturbations').addEventListener('click',()=>{
  const specs=[['feed','feedRequest','feed'],['tin','inletTemp','tin'],['steam','steamPressureKPa','steam']];
  const steps=specs.map(([id,variable,suffix])=>({id:variable,variable,time:+$(`p-${suffix}-time`).value,delta:+$(`p-${suffix}-delta`).value,enabled:$(`p-${suffix}-enable`).checked}));
  if(steps.some(s=>!Number.isFinite(s.time)||s.time<0||!Number.isFinite(s.delta))){alert('Los tiempos y magnitudes de perturbación deben ser válidos.');return}
  simulation.setPerturbations(steps);simulation.refresh();renderReadings(simulation.last);
});
$('apply-params').addEventListener('click',()=>{
  const v={area:+$('area').value,maxHeight:+$('height').value,coilUA:+$('ua').value,pumpShutoffKPa:+$('pump-head').value*100,initialVolume:+$('volume').value,initialTemp:+$('temp').value};
  if(Object.values(v).some(x=>!Number.isFinite(x)||x<=0)){alert('Los parámetros deben ser valores positivos.');return}
  v.pumpShutoffKPa=Math.max(20,Math.min(2000,v.pumpShutoffKPa));$('pump-head').value=(v.pumpShutoffKPa/100).toFixed(1);
  v.initialVolume=Math.min(v.initialVolume,v.area*v.maxHeight);simulation.model.p={...simulation.model.p,...v};simulation.reset();syncResetControls();syncModeUI();renderReadings(simulation.last);
});
function frame(now){if(!running)return;if(!previous)previous=now;const speed=Math.max(1,+$('sim-speed').value||1);accumulator+=Math.min(1.5,(now-previous)/1000*speed);previous=now;let n=0;while(accumulator>=dt&&n<40){simulation.step(dt);accumulator-=dt;n++}if(now-lastDraw>=50){renderReadings(simulation.last);lastDraw=now}raf=requestAnimationFrame(frame)}
$('start-btn').addEventListener('click',()=>{if(running)return;running=true;previous=0;$('status-text').textContent='EN MARCHA';$('sim-status').classList.add('running');raf=requestAnimationFrame(frame)});
$('pause-btn').addEventListener('click',()=>{running=false;cancelAnimationFrame(raf);$('status-text').textContent='PAUSADA';$('sim-status').classList.remove('running')});
$('reset-btn').addEventListener('click',()=>{running=false;cancelAnimationFrame(raf);$('sim-status').classList.remove('running');$('status-text').textContent='DETENIDA';simulation.reset();syncResetControls();syncModeUI();renderReadings(simulation.last)});
window.addEventListener('resize',drawCharts);
syncModeUI();renderReadings(simulation.last);
