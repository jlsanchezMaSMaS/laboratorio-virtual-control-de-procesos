import test from 'node:test';
import assert from 'node:assert/strict';
import { PIController } from '../controllers.js';

test('PI directo y reverso tienen la acción correcta',()=>{
  const direct=new PIController({kp:2,ki:0,min:0,max:100,direction:'direct'});
  const reverse=new PIController({kp:2,ki:0,min:0,max:100,direction:'reverse'});
  direct.setAutomatic(10,5,50);reverse.setAutomatic(.7,.8,30);
  assert.ok(direct.update(11,5,.1)>50,'temperatura bajo consigna abre vapor');
  assert.ok(reverse.update(.6,.8,.1)>30,'nivel sobre consigna aumenta descarga');
});

test('PI limita salida, contiene integral y transfiere manual-automático sin salto',()=>{
  const pi=new PIController({kp:20,ki:10,min:0,max:100,direction:'direct',trackingTime:1});
  pi.setManual(37);pi.setAutomatic(100,0,37);
  assert.equal(pi.output,37,'la transferencia se realiza sin salto instantáneo');
  for(let i=0;i<10000;i++)pi.update(100,0,.1);
  assert.equal(pi.output,100);assert.ok(Number.isFinite(pi.integral));assert.ok(Math.abs(pi.integral)<1100);
  pi.setManual(42);pi.setAutomatic(20,10,42);assert.equal(pi.output,42);
  assert.ok(Math.abs(pi.update(20,10,.001)-42)<.2,'el primer cambio es continuo y la integral evoluciona gradualmente');
});
