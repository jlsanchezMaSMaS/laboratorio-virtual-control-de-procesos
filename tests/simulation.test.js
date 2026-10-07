import test from 'node:test';
import assert from 'node:assert/strict';
import { ProcessSimulation } from '../simulation.js';

test('presiones de línea se convierten de kPa(g) interno a bar(g) en instrumentación',()=>{
  const s=new ProcessSimulation();
  assert.ok(Math.abs(s.last.feedPressureBar-s.model.observe().feedPressure/100)<1e-12);
  assert.ok(Math.abs(s.last.dischargePressureBar-s.model.observe().dischargePressure/100)<1e-12);
  assert.ok(Math.abs(s.last.feedPressureAbsBar-(s.last.feedPressureBar+1.01325))<1e-12);
  assert.ok(s.last.feedPressureAbsBar>1.01325&&s.last.dischargePressureAbsBar>1.01325,'presión absoluta mayor a atmósfera cuando presión manométrica es positiva');
});

test('feedback PI de nivel actúa sobre el variador y la hidráulica real',()=>{
  const s=new ProcessSimulation();s.setPerturbations([]);s.setLevelSetpoint(.75);s.setLevelMode('automatic');
  for(let i=0;i<100;i++)s.step(.1);
  assert.notEqual(s.model.inputs.dischargeFrequency,35);assert.equal(s.last.dischargeFrequency,s.model.inputs.dischargeFrequency);
  assert.ok(s.last.qOut>0);assert.ok(s.last.dischargePressure>=0);
});

test('PI coordinado de nivel ajusta a la vez caudales de alimentación y descarga',()=>{
  const s=new ProcessSimulation();s.setPerturbations([]);s.setDisturbanceBase('feedRequest',3);s.setLevelSetpoint(.9);
  const q0=s.model.hydraulics();s.setLevelMode('coordinated');s.setLoopConfig('level',{kp:45,ki:1});
  for(let i=0;i<200;i++)s.step(.1);
  const q1=s.model.hydraulics();
  assert.ok(s.model.inputs.feedFrequency>50,'el PI aumenta el variador de alimentación si falta nivel');
  assert.ok(s.model.inputs.dischargeFrequency<35,'el PI reduce el variador de descarga si falta nivel');
  assert.ok(q1.qIn>q0.qIn&&q1.qOut<q0.qOut,'cambian los caudales hidráulicos del proceso');
  assert.ok(s.model.volume>.9,'la acumulación de volumen responde a ambas manipulaciones');
  const held={feed:s.model.inputs.feedFrequency,discharge:s.model.inputs.dischargeFrequency};s.setLevelMode('manual');
  assert.equal(s.model.inputs.feedFrequency,held.feed);assert.equal(s.model.inputs.dischargeFrequency,held.discharge,'el retorno a manual no produce salto');
});

test('el PI coordinado atenúa una perturbación escalón de caudal de entrada',()=>{
  const controlled=new ProcessSimulation(),manual=new ProcessSimulation();
  for(const s of [controlled,manual]){s.setDisturbanceBase('feedRequest',1);s.setPerturbations([{id:'feed-step',variable:'feedRequest',time:1,delta:.8,enabled:true}])}
  controlled.setLevelSetpoint(.75);controlled.setLevelMode('coordinated');controlled.setLoopConfig('level',{kp:45,ki:1});
  for(let i=0;i<6000;i++){controlled.step(.1);manual.step(.1)}
  assert.ok(controlled.last.level<manual.last.level,'la respuesta automática reduce la desviación de nivel');
  assert.ok(controlled.last.feedFrequency<50&&controlled.last.dischargeFrequency>35);
  assert.ok(controlled.last.qIn<manual.last.qIn&&controlled.last.qOut>manual.last.qOut);
  assert.ok(controlled.last.feedFrequency>=0&&controlled.last.feedFrequency<=60);
  assert.ok(controlled.last.dischargeFrequency>=0&&controlled.last.dischargeFrequency<=60);
});

test('PI de nivel en modo alimentación corrige una reducción de nivel con P-101',()=>{
  const s=new ProcessSimulation();s.setPerturbations([]);s.setDisturbanceBase('feedRequest',3);s.setLevelSetpoint(.9);
  const q0=s.model.hydraulics().qIn;s.setLevelMode('feed');s.setLoopConfig('level',{kp:45,ki:1});
  for(let i=0;i<200;i++)s.step(.1);
  assert.ok(s.model.inputs.feedFrequency>50);assert.equal(s.model.inputs.dischargeFrequency,35);
  assert.ok(s.model.hydraulics().qIn>q0);
});

test('feedback de temperatura mueve la válvula y calienta el estado físico',()=>{
  const s=new ProcessSimulation();s.setPerturbations([]);s.model.setInputs({valve:20,feedFrequency:0,dischargeFrequency:0,feedRequest:0});s.setTemperatureSetpoint(72);s.setHeatMode('feedback');
  const t0=s.model.temperature,v0=s.model.inputs.valve;
  for(let i=0;i<5000;i++)s.step(.1);
  assert.equal(s.model.inputs.agitation,false,'el lazo térmico opera como intercambiador');
  assert.ok(s.model.inputs.valve>v0);assert.ok(s.model.observe().outletTemp>t0);assert.equal(s.last.valve,s.model.inputs.valve);
});

test('cascada genera consigna de flujo y el esclavo mueve válvula sobre planta',()=>{
  const s=new ProcessSimulation();s.setPerturbations([]);s.model.setInputs({valve:10,feedFrequency:0,dischargeFrequency:0,feedRequest:0});s.setHeatMode('cascade');
  const initialFlow=s.model.steamFlow();
  for(let i=0;i<1000;i++)s.step(.1);
  assert.equal(s.model.inputs.agitation,false);assert.ok(s.controls.steamFlowSetpoint>0);assert.ok(s.model.inputs.valve>10);assert.ok(s.model.steamFlow()>initialFlow);assert.ok(s.model.observe().outletTemp>25);
});

test('escalones de alimentación, Tin y presión de vapor llegan al proceso en el tiempo fijado',()=>{
  const s=new ProcessSimulation();s.setPerturbations([
    {id:'q',variable:'feedRequest',time:.2,delta:.4,enabled:true},
    {id:'t',variable:'inletTemp',time:.3,delta:8,enabled:true},
    {id:'p',variable:'steamPressureKPa',time:.4,delta:-80,enabled:true}
  ]);
  for(let i=0;i<4;i++)s.step(.1);assert.ok(s.model.inputs.feedRequest>=1.9);assert.equal(s.model.inputs.inletTemp,28);
  const before=s.model.steamFlow(),heatBefore=s.model.observe().heat;s.step(.1);assert.equal(s.model.inputs.steamPressureKPa,220);
  assert.ok(s.model.steamFlow()<before);assert.ok(s.model.observe().heat<heatBefore,'la caída de presión reduce el calor disponible');
});

test('comparación feedback-cascada parte del mismo estado y recibe idéntica perturbación',()=>{
  const s=new ProcessSimulation();s.setPerturbations([{id:'feed',variable:'feedRequest',time:.2,delta:.3,enabled:true}]);
  const study=s.comparison;
  assert.equal(study.feedback.model.volume,study.cascade.model.volume);assert.equal(study.feedback.model.temperature,study.cascade.model.temperature);
  for(let i=0;i<20;i++)s.step(.1);
  assert.equal(study.feedback.model.inputs.feedRequest,study.cascade.model.inputs.feedRequest);
  assert.equal(study.feedback.model.inputs.steamPressureKPa,study.cascade.model.inputs.steamPressureKPa);
  assert.ok(Math.abs(study.feedback.model.time-study.cascade.model.time)<1e-9);
  assert.ok(study.history.at(-1).time>0);
  assert.ok(Math.abs(study.feedback.model.observe().outletTemp-study.cascade.model.observe().outletTemp)>1e-6,'los distintos lazos producen evolución física distinta');
});

test('al cambiar ganancias PI se conserva la salida instantánea',()=>{
  const s=new ProcessSimulation();s.setPerturbations([]);s.setHeatMode('feedback');
  const before=s.model.inputs.valve;s.setLoopConfig('temperature',{kp:2.5,ki:.03});
  assert.ok(Math.abs(s.controls.temperaturePI.output-before)<1e-9);
  s.setHeatMode('cascade');const valve=s.model.inputs.valve,steamSP=s.controls.steamFlowSetpoint;
  s.setLoopConfig('slave',{kp:4000,ki:300});
  assert.ok(Math.abs(s.controls.slavePI.output-valve)<1e-9);
  assert.equal(s.controls.steamFlowSetpoint,steamSP);
});

test('feedback y cascada estabilizan la salida cerca de 72 °C en un punto operativo factible',()=>{
  for(const mode of ['feedback','cascade']){
    const s=new ProcessSimulation();s.setDisturbanceBase('feedRequest',.4);s.setPerturbations([]);
    s.setFeedFrequency(60);s.setLevelManual(5);s.setValveManual(20);s.setTemperatureSetpoint(72);s.setHeatMode(mode);
    for(let i=0;i<20000;i++)s.step(.1);
    assert.ok(Math.abs(s.last.outletTemp-72)<1,'temperatura de descarga en banda de 1 °C');
    assert.ok(s.last.valve>0&&s.last.valve<100,'la válvula alcanza un punto estable sin saturarse');
    assert.ok(Number.isFinite(s.last.outletTemp));
  }
});
