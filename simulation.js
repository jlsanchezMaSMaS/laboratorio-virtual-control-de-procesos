import { ProcessModel } from './model.js';
import { ControlSystem } from './controllers.js';
import { InstrumentRack, PerturbationSchedule } from './instrumentation.js';

const DEFAULT_STEPS=[
  {id:'feed',variable:'feedRequest',time:30,delta:.2,enabled:false},
  {id:'inlet',variable:'inletTemp',time:60,delta:-5,enabled:false},
  {id:'steam',variable:'steamPressureKPa',time:90,delta:-50,enabled:false}
];

export class ProcessSimulation {
  constructor({model=new ProcessModel(),controls=new ControlSystem(),buildComparison=true}={}){
    this.model=model;this.controls=controls;this.instruments=new InstrumentRack();this.dt=model.p.dt;
    this.schedule=new PerturbationSchedule(this.baseInputs(),DEFAULT_STEPS);
    this.history=[];this.last=this.snapshot();this.record();this.comparison=null;
    if(buildComparison)this.createComparison();
  }
  baseInputs(){return {feedRequest:this.model.inputs.feedRequest,inletTemp:this.model.inputs.inletTemp,steamPressureKPa:this.model.inputs.steamPressureKPa}}
  snapshot(){const m=this.instruments.measure(this.model),c=this.controls;return {...m,levelSetpoint:c.levelSetpoint,temperatureSetpoint:c.temperatureSetpoint,
    levelOutput:this.model.inputs.dischargeFrequency,valveOutput:this.model.inputs.valve,
    steamFlowSetpoint:c.steamFlowSetpoint,levelMode:c.levelMode,heatMode:c.heatMode}}
  record(){this.last=this.snapshot();this.history.push(this.last);while(this.history.length>2&&this.history[0].time<this.model.time-120)this.history.shift()}
  refresh(){this.last=this.snapshot();if(this.history.at(-1)?.time===this.model.time)this.history[this.history.length-1]=this.last;return this.last}
  step(dt=this.dt,{advanceComparison=true}={}){
    const disturbed=this.schedule.valuesAt(this.model.time);
    this.model.setInputs(disturbed);
    const measurement=this.instruments.measure(this.model);
    const actuators=this.controls.update(measurement,dt);
    this.model.setInputs({feedFrequency:actuators.feedFrequency,dischargeFrequency:actuators.dischargeFrequency,valve:actuators.valve});
    this.model.step(dt);
    if(this.model.time-this.history[this.history.length-1].time>=.5-1e-9)this.record();else this.last=this.snapshot();
    if(advanceComparison)this.comparison?.step(dt);
    return this.last;
  }
  setLevelMode(mode){this.controls.setLevelMode(mode,this.instruments.measure(this.model));if(this.controls.levelMode==='manual')this.model.setInputs({feedFrequency:this.controls.feedManual,dischargeFrequency:this.controls.levelManual});this.comparison?.setLevelMode(mode);this.refresh()}
  setHeatMode(mode){if(mode==='feedback'||mode==='cascade')this.model.setInputs({agitation:false});this.controls.setHeatMode(mode,this.instruments.measure(this.model));if(this.controls.heatMode==='manual')this.model.setInputs({valve:this.controls.valveManual});this.refresh()}
  setLevelManual(value){this.controls.levelManual=value;if(!['discharge','coordinated'].includes(this.controls.levelMode))this.model.setInputs({dischargeFrequency:value});this.comparison?.setLevelManual(value);this.refresh()}
  setFeedFrequency(value){if(!['feed','coordinated'].includes(this.controls.levelMode)){this.controls.feedManual=value;this.model.setInputs({feedFrequency:value})}this.comparison?.setFeedFrequency(value);this.refresh()}
  setValveManual(value){this.controls.valveManual=value;if(this.controls.heatMode==='manual')this.model.setInputs({valve:value});this.refresh()}
  setLevelSetpoint(value){this.controls.setLevelSetpoint(value,this.instruments.measure(this.model));this.comparison?.setLevelSetpoint(value);this.refresh()}
  setTemperatureSetpoint(value){this.controls.setTemperatureSetpoint(value,this.instruments.measure(this.model));this.comparison?.setTemperatureSetpoint(value);this.refresh()}
  setLoopConfig(loop,config){this.controls.configureLoop(loop,config,this.instruments.measure(this.model));this.comparison?.copyTuningFrom(this)}
  setDisturbanceBase(name,value){this.schedule.setBase({...this.schedule.base,[name]:value});this.model.setInputs({[name]:value});this.comparison?.copyScheduleFrom(this);this.refresh()}
  setPerturbations(steps){this.schedule.setSteps(steps);this.comparison?.copyScheduleFrom(this)}
  reset(){
    this.model.reset();this.model.setInputs({feedFrequency:50,dischargeFrequency:35,feedRequest:1.5,inletTemp:20,valve:35,steamPressureKPa:this.model.p.steamPressureKPa,agitation:true});
    this.controls=new ControlSystem();this.schedule=new PerturbationSchedule(this.baseInputs(),DEFAULT_STEPS);
    this.history=[];this.record();this.createComparison();
  }
  createComparison(){this.comparison=new ComparisonStudy(this);return this.comparison}
}

/** Corre dos plantas copiadas del mismo estado con idénticas perturbaciones y condiciones. */
export class ComparisonStudy {
  constructor(source){
    this.time=0;this.history=[];
    this.feedback=this.makeBranch(source,'feedback');
    this.cascade=this.makeBranch(source,'cascade');
    this.record();
  }
  makeBranch(source,heatMode){
    const initial={...source.model.p,initialVolume:source.model.volume,initialTemp:source.model.temperature};
    const model=new ProcessModel(initial);model.coilTemperature=source.model.coilTemperature;
    model.setInputs({...source.model.inputs});
    const src=source.controls;
    const controls=new ControlSystem({levelSetpoint:src.levelSetpoint,temperatureSetpoint:src.temperatureSetpoint,levelManual:src.levelManual,feedManual:src.feedManual,valveManual:src.valveManual});
    for(const loop of ['level','temperature','master','slave'])controls.configureLoop(loop,{kp:src[`${loop}PI`].kp,ki:src[`${loop}PI`].ki,trackingTime:src[`${loop}PI`].trackingTime},model.observe());
    controls.setLevelMode(src.levelMode,model.observe());controls.setHeatMode(heatMode,model.observe());
    const branch=new ProcessSimulation({model,controls,buildComparison:false});
    branch.schedule=source.schedule.copy();
    return branch;
  }
  step(dt){this.feedback.step(dt,{advanceComparison:false});this.cascade.step(dt,{advanceComparison:false});this.time+=dt;if(this.time-this.history[this.history.length-1].time>=.5-1e-9)this.record()}
  record(){this.history.push({time:this.time,setpoint:this.feedback.controls.temperatureSetpoint,feedback:this.feedback.model.observe().outletTemp,cascade:this.cascade.model.observe().outletTemp});while(this.history.length>2&&this.history[0].time<this.time-120)this.history.shift()}
  setTemperatureSetpoint(value){for(const branch of [this.feedback,this.cascade])branch.setTemperatureSetpoint(value)}
  setLevelSetpoint(value){for(const branch of [this.feedback,this.cascade])branch.setLevelSetpoint(value)}
  setLevelManual(value){for(const branch of [this.feedback,this.cascade])branch.setLevelManual(value)}
  setFeedFrequency(value){for(const branch of [this.feedback,this.cascade])branch.setFeedFrequency(value)}
  setLevelMode(mode){for(const branch of [this.feedback,this.cascade])branch.setLevelMode(mode)}
  copyScheduleFrom(source){for(const branch of [this.feedback,this.cascade])branch.schedule=source.schedule.copy()}
  copyTuningFrom(source){for(const branch of [this.feedback,this.cascade])for(const loop of ['level','temperature','master','slave'])branch.controls.configureLoop(loop,{kp:source.controls[`${loop}PI`].kp,ki:source.controls[`${loop}PI`].ki,trackingTime:source.controls[`${loop}PI`].trackingTime},branch.model.observe())}
}
