const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number.isFinite(value)?value:min));

/** PI discreto con anti-windup por retrocálculo y transferencia sin salto. */
export class PIController {
  constructor({kp,ki,min,max,direction='direct',trackingTime=2}) {
    this.kp=kp;this.ki=ki;this.min=min;this.max=max;this.direction=direction;this.trackingTime=trackingTime;
    this.integral=0;this.mode='manual';this.manualOutput=min;this.output=min;
  }
  error(setpoint,measurement){return (this.direction==='reverse'?-1:1)*(setpoint-measurement)}
  setManual(output){this.manualOutput=clamp(output,this.min,this.max);this.output=this.manualOutput;this.mode='manual';return this.output}
  setAutomatic(setpoint,measurement,trackedOutput=this.output){
    this.mode='automatic';this.track(setpoint,measurement,trackedOutput);return this.output;
  }
  track(setpoint,measurement,output){
    this.integral=clamp(output-this.kp*this.error(setpoint,measurement),-1e12,1e12);
    this.output=clamp(output,this.min,this.max);
  }
  update(setpoint,measurement,dt){
    if(this.mode!=='automatic')return this.output;
    const e=this.error(setpoint,measurement),integrated=this.integral+this.ki*e*dt,raw=this.kp*e+integrated,saturated=clamp(raw,this.min,this.max);
    const tau=Math.max(dt,this.trackingTime);
    this.integral=integrated+(saturated-raw)*dt/tau;
    this.integral=clamp(this.integral,this.min-this.kp*Math.abs(e),this.max+this.kp*Math.abs(e));
    this.output=clamp(this.kp*e+this.integral,this.min,this.max);
    return this.output;
  }
  configure({kp=this.kp,ki=this.ki,trackingTime=this.trackingTime},setpoint,measurement){
    const output=this.output;this.kp=Math.max(0,kp);this.ki=Math.max(0,ki);this.trackingTime=Math.max(.01,trackingTime);
    if(this.mode==='automatic'&&Number.isFinite(setpoint)&&Number.isFinite(measurement))this.track(setpoint,measurement,output);
  }
}

/** Tres lazos disponibles: nivel PI, temperatura PI y maestro/esclavo en cascada. */
export class ControlSystem {
  constructor(config={}) {
    this.levelSetpoint=config.levelSetpoint??.75;this.temperatureSetpoint=config.temperatureSetpoint??72;
    this.levelManual=config.levelManual??35;this.feedManual=config.feedManual??50;this.valveManual=config.valveManual??35;
    this.levelFeedBase=this.feedManual;this.levelDischargeBase=this.levelManual;this.steamFlowSetpoint=0;
    this.levelMode='manual';this.heatMode='manual';
    this.levelPI=new PIController({kp:45,ki:.012,min:0,max:60,direction:'reverse',trackingTime:5});
    this.feedLevelPI=new PIController({kp:45,ki:.012,min:0,max:60,direction:'direct',trackingTime:5});
    this.coordinatedLevelPI=new PIController({kp:35,ki:.01,min:-30,max:30,direction:'direct',trackingTime:5});
    this.temperaturePI=new PIController({kp:1.8,ki:.012,min:0,max:100,direction:'direct',trackingTime:5});
    this.masterPI=new PIController({kp:.00038,ki:.0000015,min:0,max:.025,direction:'direct',trackingTime:8});
    this.slavePI=new PIController({kp:3200,ki:260,min:0,max:100,direction:'direct',trackingTime:2});
    if(config.levelPI)this.levelPI.configure(config.levelPI);
    if(config.levelPI){this.feedLevelPI.configure(config.levelPI);this.coordinatedLevelPI.configure(config.levelPI)}
    if(config.temperaturePI)this.temperaturePI.configure(config.temperaturePI);
    if(config.masterPI)this.masterPI.configure(config.masterPI);
    if(config.slavePI)this.slavePI.configure(config.slavePI);
  }
  setLevelMode(mode,state){
    const aliases={automatic:'discharge'};
    const requested=aliases[mode]??mode;
    const next=['manual','discharge','feed','coordinated'].includes(requested)?requested:'manual';
    if(next==='manual'&&this.levelMode!=='manual'){
      this.levelManual=state.dischargeFrequency;this.feedManual=state.feedFrequency;
    }
    if(next!=='manual'&&next!==this.levelMode){
      this.levelFeedBase=state.feedFrequency;this.levelDischargeBase=state.dischargeFrequency;
      this.feedManual=state.feedFrequency;this.levelManual=state.dischargeFrequency;
      if(next==='discharge')this.levelPI.setAutomatic(this.levelSetpoint,state.level,state.dischargeFrequency);
      if(next==='feed')this.feedLevelPI.setAutomatic(this.levelSetpoint,state.level,state.feedFrequency);
      if(next==='coordinated')this.coordinatedLevelPI.setAutomatic(this.levelSetpoint,state.level,0);
    }
    this.levelMode=next;
  }
  setHeatMode(mode,state){
    const next=['feedback','cascade'].includes(mode)?mode:'manual';
    if(next==='feedback')this.temperaturePI.setAutomatic(this.temperatureSetpoint,state.outletTemp,state.valve);
    if(next==='cascade'){
      this.masterPI.setAutomatic(this.temperatureSetpoint,state.outletTemp,state.steamFlow);
      this.steamFlowSetpoint=state.steamFlow;
      this.slavePI.setAutomatic(this.steamFlowSetpoint,state.steamFlow,state.valve);
    }
    if(next==='manual'&&this.heatMode!=='manual')this.valveManual=state.valve;
    this.heatMode=next;
  }
  setLevelSetpoint(value,state){
    this.levelSetpoint=value;
    if(this.levelMode==='discharge')this.levelPI.track(value,state.level,state.dischargeFrequency);
    if(this.levelMode==='feed')this.feedLevelPI.track(value,state.level,state.feedFrequency);
    if(this.levelMode==='coordinated')this.coordinatedLevelPI.track(value,state.level,this.coordinatedLevelPI.output);
  }
  setTemperatureSetpoint(value,state){this.temperatureSetpoint=value;if(this.heatMode==='feedback')this.temperaturePI.track(value,state.outletTemp,state.valve);if(this.heatMode==='cascade')this.masterPI.track(value,state.outletTemp,this.steamFlowSetpoint)}
  configureLoop(name,config,state){
    if(name==='level'){
      for(const [loop,pv,sp]of [[this.levelPI,state?.level,this.levelSetpoint],[this.feedLevelPI,state?.level,this.levelSetpoint],[this.coordinatedLevelPI,state?.level,this.levelSetpoint]])loop.configure(config,sp,pv);
      return;
    }
    const loop=this[`${name}PI`];if(!loop)return;
    const sp=name==='level'?this.levelSetpoint:name==='slave'?this.steamFlowSetpoint:this.temperatureSetpoint;
    const pv=name==='level'?state?.level:name==='slave'?state?.steamFlow:state?.outletTemp;
    loop.configure(config,sp,pv);
  }
  update(measurement,dt){
    let feedFrequency=this.feedManual,dischargeFrequency=this.levelManual;
    if(this.levelMode==='discharge')dischargeFrequency=this.levelPI.update(this.levelSetpoint,measurement.level,dt);
    if(this.levelMode==='feed')feedFrequency=this.feedLevelPI.update(this.levelSetpoint,measurement.level,dt);
    if(this.levelMode==='coordinated'){
      this.coordinatedLevelPI.min=Math.max(-30,-this.levelFeedBase,this.levelDischargeBase-60);
      this.coordinatedLevelPI.max=Math.min(30,60-this.levelFeedBase,this.levelDischargeBase);
      const trim=this.coordinatedLevelPI.update(this.levelSetpoint,measurement.level,dt);
      feedFrequency=clamp(this.levelFeedBase+trim,0,60);
      dischargeFrequency=clamp(this.levelDischargeBase-trim,0,60);
    }
    let valveOutput=this.valveManual;
    if(this.heatMode==='feedback')valveOutput=this.temperaturePI.update(this.temperatureSetpoint,measurement.outletTemp,dt);
    if(this.heatMode==='cascade'){
      this.steamFlowSetpoint=this.masterPI.update(this.temperatureSetpoint,measurement.outletTemp,dt);
      valveOutput=this.slavePI.update(this.steamFlowSetpoint,measurement.steamFlow,dt);
    }
    return {feedFrequency:clamp(feedFrequency,0,60),dischargeFrequency:clamp(dischargeFrequency,0,60),valve:clamp(valveOutput,0,100),steamFlowSetpoint:this.steamFlowSetpoint};
  }
  get outputs(){return {level:this.levelPI.output,temperature:this.temperaturePI.output,master:this.masterPI.output,slave:this.slavePI.output,steamFlowSetpoint:this.steamFlowSetpoint}}
}
