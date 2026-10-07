import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');

test('todos los selectores de la interfaz existen en el HTML',()=>{
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
  const selectors=[...app.matchAll(/\$\('([^']+)'\)/g)].map(match=>match[1]);
  const missing=[...new Set(selectors.filter(id=>!ids.has(id)))];
  assert.deepEqual(missing,[]);
});

test('las gráficas integran historia y escalan desde tiempo cero',()=>{
  assert.match(app,/requestAnimationFrame\(frame\)/);
  assert.match(app,/data=simulation\.history/);
  assert.match(app,/simulation\.step\(dt\)/);
  assert.match(html,/id="chart-state"/);
  assert.match(html,/id="chart-hydraulics"/);
  assert.match(html,/id="chart-frequency"/);
});

test('los valores P&ID van sobre el instrumento y presiones de línea se rotulan bar(g)',()=>{
  for(const id of ['schematic-tin','schematic-qin','schematic-pin','schematic-temp','schematic-qout','schematic-pout','schematic-tout']){
    const match=html.match(new RegExp('<text[^>]*id="'+id+'"[^>]*>'));
    assert.ok(match,`${id} existe`);assert.match(match[0],/y="-22"/,`${id} se ubica arriba del indicador`);
  }
  assert.match(html,/P alimentación <small>bar\(g\)<\/small>/);
  assert.match(html,/P descarga <small>bar\(g\)<\/small>/);
  assert.match(html,/<text x="550" y="102" id="schematic-valve">/);
});

test('Iniciar actualiza reloj, variables y lienzos de gráfica',async()=>{
  class Element {
    constructor(id){this.id=id;this.value=({fin:'50',fout:'35',feed:'1.5',tin:'20',valve:'35',area:'1.2',height:'2.5',ua:'0.42',volume:'0.9',temp:'25','pump-head':'1.8',level:'manual',heat:'manual'})[id]||'';this.checked=id==='agitation'||id.startsWith('p-');this.listeners={};this.classList={add(){},remove(){},toggle(){}};this.draws=0}
    addEventListener(type,fn){this.listeners[type]=fn}
    setAttribute(){}
    getBoundingClientRect(){return {width:this.id.startsWith('chart-')?400:0}}
    getContext(){const canvas=this;return {scale(){},setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){canvas.draws++},fillText(){},setLineDash(){},save(){},restore(){},arc(){},fill(){}}}
  }
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
  const elements=new Map([...ids].map(id=>[id,new Element(id)]));
  const scheduled=[];
  globalThis.document={getElementById:id=>elements.get(id)};
  globalThis.window={devicePixelRatio:1,addEventListener(){}};
  globalThis.requestAnimationFrame=fn=>{scheduled.push(fn);return scheduled.length};
  globalThis.cancelAnimationFrame=()=>{};
  await import('../app.js?ui-smoke');
  elements.get('start-btn').listeners.click();
  assert.equal(elements.get('status-text').textContent,'EN MARCHA');
  scheduled.shift()(1000);scheduled.shift()(1100);
  assert.equal(elements.get('clock').textContent,'0.1');
  assert.ok(elements.get('readings').innerHTML.includes('CAUDAL VOLUMÉTRICO ENTRADA'));
  assert.ok(elements.get('readings').innerHTML.includes('bar(a)')&&elements.get('readings').innerHTML.includes('bar(g)'));
  assert.match(elements.get('schematic-pin').textContent,/bar\(a\)/);
  for(const id of ['chart-state','chart-hydraulics','chart-frequency','chart-level-loop','chart-temp-loop','chart-cascade','chart-comparison']){assert.ok(elements.get(id).width>0,`${id} tiene lienzo dimensionado`);assert.ok(elements.get(id).draws>0,`${id} dibuja líneas`)}
  elements.get('tin').value='45';elements.get('tin').listeners.input();
  assert.equal(elements.get('schematic-tin').textContent,'45.0 °C');assert.ok(elements.get('tin-value').innerHTML.includes('45'));
  elements.get('heat-mode').value='feedback';elements.get('heat-mode').listeners.change();
  assert.equal(elements.get('agitation').checked,false,'el control térmico detiene el agitador');
  elements.get('agitator-action').listeners.click();
  assert.equal(elements.get('heat-mode').value,'manual');assert.equal(elements.get('agitation').checked,true,'la acción explícita arranca el agitador y retorna a manual');
  elements.get('reset-btn').listeners.click();
  assert.equal(elements.get('tin').value,20);assert.equal(elements.get('schematic-tin').textContent,'20.0 °C');
  assert.equal(elements.get('p-tin-enable').checked,false,'reiniciar también deja escalones deshabilitados en la interfaz');
  const pressureBefore=Number.parseFloat(elements.get('schematic-pin').textContent);elements.get('pump-head').value='3';elements.get('apply-params').listeners.click();
  assert.ok(Number.parseFloat(elements.get('schematic-pin').textContent)>pressureBefore,'el parámetro de cierre de bomba modifica la presión calculada del P&ID');
});
