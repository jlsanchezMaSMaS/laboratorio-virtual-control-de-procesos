/** Modelo dinámico del tanque agitado. Unidades SI; API pública: ProcessModel. */
export const DEFAULTS = Object.freeze({
  area: 1.2, maxHeight: 2.5, initialVolume: 0.9, initialTemp: 25, coilVolume: 0.015,
  rho: 997, cp: 4180, ambientTemp: 20, heatLossUA: 0.018,
  coilUA: 0.42, steamPressureKPa: 300, condensatePressureKPa: 101.3,
  steamNominalPressureKPa: 300, maxSteamFlow: 0.025, latentHeat: 2200000, dt: 0.1,
  feedFrequency: 50, dischargeFrequency: 35, feedRequest: 1.5, inletTemp: 20, valve: 35,
  pumpMaxFlow: 3.0, pumpShutoffKPa: 180, feedResistance: 18,
  dischargeResistance: 48, feedStaticKPa: 8, returnPressureKPa: 0
});
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : lo));
const positive = x => Math.max(0, Number.isFinite(x) ? x : 0);

export class ProcessModel {
  constructor(parameters = {}) {
    this.p = { ...DEFAULTS, ...parameters };
    this.inputs = { feedFrequency: 50, dischargeFrequency: 35, feedRequest: 1.5, inletTemp: 20, valve: 35, steamPressureKPa: this.p.steamPressureKPa, agitation: true };
    this.time = 0;
    this.volume = this.p.initialVolume;
    this.temperature = this.p.initialTemp;
    this.coilTemperature = this.p.initialTemp;
    this.history = [];
    this.last = this.observe();
    this.record();
  }
  setInputs(inputs) {
    if (Object.hasOwn(inputs, 'agitation') && Boolean(inputs.agitation) !== this.inputs.agitation) this.coilTemperature = this.temperature;
    this.inputs = { ...this.inputs, ...inputs };
    this.inputs.feedFrequency = clamp(this.inputs.feedFrequency, 0, 60);
    this.inputs.dischargeFrequency = clamp(this.inputs.dischargeFrequency, 0, 60);
    this.inputs.feedRequest = clamp(this.inputs.feedRequest, 0, 3);
    this.inputs.inletTemp = clamp(this.inputs.inletTemp, 5, 60);
    this.inputs.valve = clamp(this.inputs.valve, 0, 100);
    this.inputs.steamPressureKPa = clamp(this.inputs.steamPressureKPa, this.p.condensatePressureKPa, 800);
  }
  steamSaturationTemperature(pressureKPa = this.inputs.steamPressureKPa) {
    return clamp(100 + 30 * Math.log(Math.max(1, pressureKPa) / 101.325), 100, 180);
  }
  steamFlow(valve = this.inputs.valve, pressureKPa = this.inputs.steamPressureKPa) {
    const p = this.p;
    const available = positive(pressureKPa - p.condensatePressureKPa);
    const nominal = Math.max(1, p.steamNominalPressureKPa - p.condensatePressureKPa);
    return p.maxSteamFlow * clamp(valve, 0, 100) / 100 * Math.sqrt(available / nominal);
  }
  get level() { return this.volume / Math.max(1e-9, this.p.area); }
  /** Bomba + pérdidas: Q²=(H_bomba-H_estática)/(R_bomba+R_línea), Q en m³/h. */
  hydraulics(volume = this.volume) {
    const p = this.p, u = this.inputs;
    const level = clamp(volume / Math.max(1e-9, p.area), 0, p.maxHeight);
    const feedRatio = u.feedFrequency / 60;
    const outRatio = u.dischargeFrequency / 60;
    const feedHead = p.pumpShutoffKPa * feedRatio ** 2;
    const outHead = p.pumpShutoffKPa * outRatio ** 2;
    const pumpCurveResistance = p.pumpShutoffKPa / Math.max(1e-9, p.pumpMaxFlow ** 2);
    const feedCapacity = Math.sqrt(positive((feedHead - p.feedStaticKPa) / Math.max(1e-9, p.feedResistance + p.pumpShutoffKPa / Math.max(1e-9, p.pumpMaxFlow ** 2))));
    const qIn = Math.min(u.feedRequest, feedCapacity);
    const tankKPa = p.rho * 9.80665 * level / 1000;
    const availableOutHead = positive(outHead + tankKPa - p.returnPressureKPa);
    const qOutCandidate = Math.min(p.pumpMaxFlow * outRatio, Math.sqrt(availableOutHead / Math.max(1e-9, p.dischargeResistance + p.pumpShutoffKPa / Math.max(1e-9, p.pumpMaxFlow ** 2))));
    const qOut = level <= 1e-9 ? 0 : qOutCandidate;
    return { qIn, qOut, feedPressure: Math.max(0, feedHead - pumpCurveResistance * qIn ** 2), dischargePressure: Math.max(0, tankKPa + outHead - pumpCurveResistance * qOut ** 2), tankPressure: tankKPa, feedCapacity, outHead };
  }
  /** Dynamic total energy: rho cp V dT/dt; an unagitated coil has its own fluid hold-up state. */
  derivatives(volume, temperature, coilTemperature = this.coilTemperature) {
    const p = this.p, h = this.hydraulics(volume);
    const V = clamp(volume, 0, p.area * p.maxHeight);
    const T = clamp(temperature, 0, 100);
    const qIn = h.qIn / 3600, qOut = h.qOut / 3600;
    const coilT = clamp(coilTemperature, 0, 100);
    const steamFlow = this.steamFlow();
    const steamTemp = this.steamSaturationTemperature();
    const heat = Math.min(steamFlow * p.latentHeat, p.coilUA * 1000 * positive(steamTemp - (this.inputs.agitation ? T : coilT)));
    const outletTemp = this.inputs.agitation ? T : coilT;
    const loss = p.heatLossUA * 1000 * (T - p.ambientTemp);
    const dV = h.qIn - h.qOut; // m³/h, reported in hourly basis below
    const atFull = V >= p.area * p.maxHeight - 1e-9;
    const atEmpty = V <= 1e-9;
    const dVdt = (atFull && dV > 0 || atEmpty && dV < 0 ? 0 : dV / 3600);
    const thermalMass = p.rho * p.cp * Math.max(V, 1e-6);
    const outletEnergy = !this.inputs.agitation ? p.rho * p.cp * qOut * (outletTemp - T) : 0;
    const dTdt = (p.rho * p.cp * qIn * (this.inputs.inletTemp - T) + (this.inputs.agitation ? heat : 0) - outletEnergy - loss) / thermalMass;
    const coilMass = p.rho * Math.max(p.coilVolume, 1e-6);
    const dCoilTdt = this.inputs.agitation ? 0 : (p.rho * p.cp * qOut * (T - coilT) + heat) / (coilMass * p.cp);
    return { dVdt, dTdt, dCoilTdt, qIn, qOut, steamFlow, steamTemp, heat, loss, outletTemp, hydraulics: h };
  }
  /** Discharge sensor follows the well-mixed vessel or the dynamic, unagitated coil hold-up. */
  outletTemperature(temperature = this.temperature, qOut = this.hydraulics().qOut, heat = null) {
    return this.inputs.agitation ? temperature : clamp(this.coilTemperature, 0, Math.min(99.9, this.steamSaturationTemperature()));
  }
  /** Fixed step RK4 with physical bounds and event-aware outlet integration. */
  step(dt = this.p.dt) {
    dt = clamp(dt, 0.001, 2);
    const maxV = this.p.area * this.p.maxHeight;
    const [v0, t0] = [this.volume, this.temperature];
    const c0 = this.coilTemperature;
    const k1 = this.derivatives(v0, t0, c0);
    const k2 = this.derivatives(v0 + k1.dVdt * dt / 2, t0 + k1.dTdt * dt / 2, c0 + k1.dCoilTdt * dt / 2);
    const k3 = this.derivatives(v0 + k2.dVdt * dt / 2, t0 + k2.dTdt * dt / 2, c0 + k2.dCoilTdt * dt / 2);
    const k4 = this.derivatives(v0 + k3.dVdt * dt, t0 + k3.dTdt * dt, c0 + k3.dCoilTdt * dt);
    this.volume = clamp(v0 + dt / 6 * (k1.dVdt + 2*k2.dVdt + 2*k3.dVdt + k4.dVdt), 0, maxV);
    const nextT = t0 + dt / 6 * (k1.dTdt + 2*k2.dTdt + 2*k3.dTdt + k4.dTdt);
    const maxWaterTemperature = Math.min(99.9, this.steamSaturationTemperature());
    this.temperature = clamp(nextT, 0, maxWaterTemperature);
    this.coilTemperature = this.inputs.agitation ? this.temperature : clamp(c0 + dt / 6 * (k1.dCoilTdt + 2*k2.dCoilTdt + 2*k3.dCoilTdt + k4.dCoilTdt), 0, maxWaterTemperature);
    // At empty tank, remove remaining liquid through the energy balance before cooling can occur.
    if (this.volume < 1e-6) this.temperature = this.inputs.inletTemp;
    this.time += dt;
    this.last = this.observe();
    if (this.time - this.history[this.history.length - 1].time >= 0.5) this.record();
    return this.last;
  }
  observe() {
    const h = this.hydraulics(), p = this.p;
    const coilState = this.inputs.agitation ? this.temperature : this.coilTemperature;
    const heat = Math.min(this.steamFlow() * p.latentHeat, p.coilUA * 1000 * positive(this.steamSaturationTemperature() - coilState));
    const outletTemp = this.outletTemperature(this.temperature, h.qOut, heat);
    const loss = p.heatLossUA * 1000 * (this.temperature - p.ambientTemp);
    return { time: this.time, volume: this.volume, level: this.level, temperature: this.temperature,
      qIn: h.qIn, qOut: h.qOut, feedPressure: h.feedPressure, dischargePressure: h.dischargePressure,
      tankPressure: h.tankPressure, outletTemp, feedFrequency: this.inputs.feedFrequency, dischargeFrequency: this.inputs.dischargeFrequency,
      valve: this.inputs.valve, steamFlow: this.steamFlow(), steamPressureKPa: this.inputs.steamPressureKPa,
      steamTemperature: this.steamSaturationTemperature(), inletTemp: this.inputs.inletTemp, agitation: this.inputs.agitation, heat: heat/1000, heatLoss: loss/1000,
      overflow: this.volume >= p.area*p.maxHeight-1e-9 ? positive(h.qIn-h.qOut) : 0,
      massRate: (this.volume >= p.area*p.maxHeight-1e-9 && h.qIn>h.qOut) || (this.volume <= 1e-9 && h.qOut>h.qIn) ? 0 : this.p.rho * (h.qIn - h.qOut) / 3600,
      massIn: p.rho * h.qIn / 3600, massOut: p.rho * h.qOut / 3600,
      energyRate: p.rho * p.cp * (h.qIn / 3600) * (this.inputs.inletTemp - this.temperature) + heat - loss };
  }
  record() {
    this.history.push({ ...this.observe() });
    const cutoff = this.time - 120;
    while (this.history.length > 2 && this.history[0].time < cutoff) this.history.shift();
  }
  reset() {
    this.time = 0; this.volume = clamp(this.p.initialVolume, 0.01, this.p.area * this.p.maxHeight);
    this.temperature = clamp(this.p.initialTemp, 5, 95); this.coilTemperature=this.temperature; this.history = []; this.last = this.observe(); this.record();
  }
}
