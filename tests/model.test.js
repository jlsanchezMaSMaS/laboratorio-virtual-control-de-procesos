import test from 'node:test';
import assert from 'node:assert/strict';
import { ProcessModel } from '../model.js';

test('el nivel aumenta cuando Qin supera Qout y balance de volumen cierra', () => {
  const m = new ProcessModel({initialVolume:0.8});
  m.setInputs({feedFrequency:60, dischargeFrequency:0, feedRequest:2, valve:0});
  const before=m.volume, q=m.hydraulics();
  for(let i=0;i<100;i++)m.step(.1);
  assert.ok(q.qIn>q.qOut); assert.ok(m.volume>before);
  assert.ok(Math.abs((m.volume-before) - (q.qIn-q.qOut)*10/3600)<1e-6);
});
test('el nivel disminuye cuando Qout supera Qin', () => {
  const m = new ProcessModel({initialVolume:1.2});
  m.setInputs({feedFrequency:0, dischargeFrequency:60, feedRequest:0, valve:0});
  const before=m.volume; assert.ok(m.hydraulics().qOut>m.hydraulics().qIn);
  for(let i=0;i<100;i++)m.step(.1);
  assert.ok(m.volume<before);
});
test('el vapor calienta y la temperatura se mantiene en límites físicos', () => {
  const m = new ProcessModel({initialVolume:1.0,initialTemp:25});
  m.setInputs({feedFrequency:0,dischargeFrequency:0,feedRequest:0,valve:100});
  for(let i=0;i<3000;i++)m.step(.1);
  assert.ok(m.temperature>25); assert.ok(m.temperature<=99.9);
});
test('la temperatura responde a Tin y al caudal de alimentación', () => {
  const run = (q,tin) => {const m=new ProcessModel({initialVolume:1,initialTemp:25});m.setInputs({feedFrequency:60,dischargeFrequency:0,feedRequest:q,inletTemp:tin,valve:0});for(let i=0;i<400;i++)m.step(.1);return m.temperature};
  assert.ok(run(2,50)>run(2,10));
  assert.ok(run(2,50)>run(.2,50));
});
test('la agitación mezcla y homogeniza, pero no agrega calor por sí misma',()=>{
  const mixed=new ProcessModel({initialVolume:1,initialTemp:25});
  const unagitated=new ProcessModel({initialVolume:1,initialTemp:25});
  for(const m of [mixed,unagitated])m.setInputs({feedFrequency:0,dischargeFrequency:0,feedRequest:0,valve:0});
  unagitated.setInputs({agitation:false});
  const a=mixed.derivatives(mixed.volume,mixed.temperature),b=unagitated.derivatives(unagitated.volume,unagitated.temperature);
  assert.equal(a.heat,0);assert.equal(b.heat,0);assert.ok(Math.abs(a.dTdt-b.dTdt)<1e-12);
  assert.equal(mixed.observe().outletTemp,mixed.temperature);
  assert.equal(unagitated.observe().outletTemp,unagitated.coilTemperature);
});
test('las bombas responden a frecuencia y presión según curva', () => {
  const m=new ProcessModel({initialVolume:1});
  m.setInputs({feedFrequency:20,dischargeFrequency:20,feedRequest:3});const low=m.hydraulics();
  m.setInputs({feedFrequency:55,dischargeFrequency:55,feedRequest:3});const high=m.hydraulics();
  assert.ok(high.qIn>low.qIn);assert.ok(high.qOut>low.qOut);assert.ok(high.feedPressure>low.feedPressure);assert.ok(high.dischargePressure>low.dischargePressure);
});
test('la presión de operación crece al configurar una bomba de mayor presión de cierre',()=>{
  const base=new ProcessModel({initialVolume:1}),higher=new ProcessModel({initialVolume:1,pumpShutoffKPa:300});
  assert.ok(higher.hydraulics().feedPressure>base.hydraulics().feedPressure);
  assert.ok(higher.hydraulics().dischargePressure>base.hydraulics().dischargePressure);
});
test('volumen nunca sale del tanque y evita división por cero', () => {
  const m=new ProcessModel({initialVolume:.1});m.setInputs({feedFrequency:0,dischargeFrequency:60,feedRequest:0});
  for(let i=0;i<10000;i++)m.step(.1);
  assert.equal(m.volume,0);assert.ok(Number.isFinite(m.temperature));assert.ok(m.temperature>=0);
});
test('en modo intercambiador la válvula eleva TIT de descarga y permite superar 72 °C', () => {
  const m=new ProcessModel({initialVolume:1,initialTemp:25});
  m.setInputs({feedFrequency:0,dischargeFrequency:8,feedRequest:0,agitation:false,valve:0});
  const closed=m.observe().outletTemp;
  m.setInputs({valve:100});
  for(let i=0;i<3000;i++)m.step(.1);
  const open=m.observe().outletTemp;
  assert.equal(closed,25);assert.ok(open>closed);assert.ok(open>=72);assert.ok(open<=m.last.steamTemperature);
  assert.ok(m.temperature<open,'la sonda de salida representa la corriente calentada y el volumen del tanque conserva su estado propio');
});
test('el caudal real cambia con VFD y caudal solicitado, y modifica el nivel', () => {
  const m=new ProcessModel({initialVolume:1});m.setInputs({feedFrequency:60,dischargeFrequency:0,feedRequest:3,valve:0});
  const qHigh=m.hydraulics().qIn;
  m.setInputs({feedFrequency:35});const qLow=m.hydraulics().qIn;assert.ok(qHigh>qLow);
  m.setInputs({feedFrequency:60,feedRequest:.25});const qTrim=m.hydraulics().qIn;assert.ok(qTrim<qHigh);
  const initial=m.volume;for(let i=0;i<1000;i++)m.step(.1);assert.ok(m.volume>initial);
  assert.ok(m.history.length>2);
});
test('un cambio de frecuencia altera presión y caudal en el transitorio', () => {
  const m=new ProcessModel({initialVolume:1});m.setInputs({feedFrequency:30,dischargeFrequency:25,feedRequest:3,valve:0});
  const before=m.observe();
  m.setInputs({feedFrequency:55,dischargeFrequency:45});
  const after=m.observe();
  assert.ok(after.qIn>before.qIn);assert.ok(after.qOut>before.qOut);
  assert.ok(after.feedPressure>before.feedPressure);assert.ok(after.dischargePressure>before.dischargePressure);
  const q=after, v0=m.volume;for(let i=0;i<10;i++)m.step(.1);
  const expected=(q.qIn-q.qOut)/3600;
  assert.ok(Math.abs((m.volume-v0)-expected)<1e-7,'ΔV debe coincidir con la integral del caudal neto en 1 s');
});
test('los balances de energía cierran en modo tanque y en modo intercambiador', () => {
  const m=new ProcessModel({initialVolume:1.1,initialTemp:31});
  m.setInputs({feedFrequency:50,dischargeFrequency:30,feedRequest:1.2,inletTemp:48,valve:40,agitation:true});
  let d=m.derivatives(m.volume,m.temperature,m.coilTemperature);
  let lhs=m.p.rho*m.p.cp*m.volume*d.dTdt;
  let rhs=m.p.rho*m.p.cp*d.qIn*(m.inputs.inletTemp-m.temperature)+d.heat-d.loss;
  assert.ok(Math.abs(lhs-rhs)<1e-7*Math.max(1,Math.abs(rhs)));
  m.setInputs({agitation:false});d=m.derivatives(m.volume,m.temperature,m.coilTemperature);
  lhs=m.p.rho*m.p.cp*m.volume*d.dTdt;
  rhs=m.p.rho*m.p.cp*d.qIn*(m.inputs.inletTemp-m.temperature)-m.p.rho*m.p.cp*d.qOut*(d.outletTemp-m.temperature)-d.loss;
  assert.ok(Math.abs(lhs-rhs)<1e-7*Math.max(1,Math.abs(rhs)));
  const coilLhs=m.p.rho*m.p.cp*m.p.coilVolume*d.dCoilTdt;
  const coilRhs=m.p.rho*m.p.cp*d.qOut*(m.temperature-m.coilTemperature)+d.heat;
  assert.ok(Math.abs(coilLhs-coilRhs)<1e-7*Math.max(1,Math.abs(coilRhs)));
});
