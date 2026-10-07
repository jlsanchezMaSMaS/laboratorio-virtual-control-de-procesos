const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number.isFinite(v)?v:min));

/** Instrumentación determinista: lectura directa del estado del modelo, sin ruido artificial. */
export class InstrumentRack {
  measure(model){
    const s=model.observe();
    return {time:s.time,level:s.level,volume:s.volume,temperature:s.temperature,outletTemp:s.outletTemp,
      qIn:s.qIn,qOut:s.qOut,massIn:s.massIn,massOut:s.massOut,feedPressure:s.feedPressure,
      dischargePressure:s.dischargePressure,feedPressureBar:s.feedPressure/100,
      dischargePressureBar:s.dischargePressure/100,
      feedPressureAbsBar:s.feedPressure/100+1.01325,dischargePressureAbsBar:s.dischargePressure/100+1.01325,
      tankPressure:s.tankPressure,steamFlow:s.steamFlow,
      steamPressureKPa:s.steamPressureKPa,steamTemperature:s.steamTemperature,
      feedFrequency:s.feedFrequency,dischargeFrequency:s.dischargeFrequency,valve:s.valve,
      heat:s.heat,inletTemp:s.inletTemp,massRate:s.massRate,agitation:s.agitation};
  }
}

/** Perturbaciones escalón deterministas, especificadas como cambios respecto al valor base. */
export class PerturbationSchedule {
  constructor(base={},steps=[]){this.base={...base};this.steps=steps.map(s=>({...s}));this.fired=new Set()}
  setBase(base){this.base={...base}}
  setSteps(steps){this.steps=steps.map((s,i)=>({...s,id:s.id??`${s.variable}-${i}`}));this.fired.clear()}
  valuesAt(time){
    const result={...this.base};
    for(const step of this.steps)if(step.enabled!==false&&time>=Math.max(0,step.time))result[step.variable]=(result[step.variable]??0)+step.delta;
    result.feedRequest=clamp(result.feedRequest??0,0,3);
    result.inletTemp=clamp(result.inletTemp??20,5,60);
    result.steamPressureKPa=clamp(result.steamPressureKPa??300,101.3,800);
    return result;
  }
  copy(){return new PerturbationSchedule(this.base,this.steps)}
  rebase(time){const base=this.valuesAt(time);const steps=this.steps.filter(s=>s.enabled!==false&&s.time>time).map(s=>({...s,time:s.time-time}));return new PerturbationSchedule(base,steps)}
}
