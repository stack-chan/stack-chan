import assert from 'node:assert/strict'
import test from 'node:test'
import { createTalkControls, attachTalkButtons } from '../setup-device/talk-controls.js'
const tick = () => new Promise(resolve => setImmediate(resolve))
function setup(overrides = {}) {
  const calls = []
  const controls = createTalkControls({ canTalk: () => true, setMuted: value => { calls.push(value) }, disconnect: () => { calls.push('disconnect') }, onHeld: () => {}, onError: stage => calls.push(stage), ...overrides })
  return { calls, controls }
}
test('A press and release produce one serialized record and submit', async () => {
  const {calls, controls:c}=setup()
  c.press('a'); c.press('a'); await tick(); await c.release('a'); c.release('a')
  assert.deepEqual(calls,[false,true])
})
test('touch and physical source cannot release one another', async () => {
  const {calls, controls:c}=setup();c.press('touch');c.press('a');c.release('a');await tick()
  assert.deepEqual(calls,[false]);await c.release('touch');assert.deepEqual(calls,[false,true])
})
test('disconnect during delayed microphone start never submits', async () => {
  let resolve; const {calls, controls:c}=setup({setMuted:v=>{ calls.push(v); return new Promise(r=>{resolve=r}) }})
  c.press('a');await tick();const disconnected=c.disconnect();c.release('a');resolve();await disconnected;await tick()
  assert.deepEqual(calls,[false,'disconnect'])
})
test('disconnect before pending press does not enable microphone', async () => {
  const {calls,controls:c}=setup();c.press('a');await c.disconnect();await tick();assert.deepEqual(calls,['disconnect'])
})
test('failed start does not submit on release', async () => {
  const {calls,controls:c}=setup({setMuted:()=>Promise.reject(Error())});c.press('a');await tick();c.release('a');await tick();assert.deepEqual(calls,['start'])
})
test('disconnect after release but before mute continuation prevents submission', async () => {
  const {calls,controls:c}=setup();c.press('a');await tick();c.release('a');await c.disconnect();await tick();assert.deepEqual(calls,[false,'disconnect'])
})
test('close fences late releases and presses', async () => {
  const {calls,controls:c}=setup();c.press('a');c.close();c.release('a');c.press('a');await tick();assert.deepEqual(calls,[])
})
test('disconnected session ignores all buttons', async () => {
  const {calls,controls:c}=setup({canTalk:()=>false});c.press('a');c.release('a');await c.disconnect();assert.deepEqual(calls,[])
})
test('driver edges deduplicate and resources close', () => {
  const instances=[];class Button { constructor(o){this.o=o;instances.push(this)} close(){this.closed=true} edge(pressed){this.pressed=pressed;this.o.onPush.call(this)} }
  const calls=[];const binding=attachTalkButtons({A:Button,B:Button},{press:s=>calls.push(['press',s]),release:s=>calls.push(['release',s]),disconnect:()=>calls.push(['disconnect'])})
  instances[0].edge(true);instances[0].edge(true);instances[1].edge(true);instances[1].edge(true);instances[0].edge(false)
  assert.deepEqual(calls,[['press','button-a'],['disconnect'],['release','button-a']]);binding.close();assert(instances.every(x=>x.closed))
})
test('partial button construction releases already-owned GPIO',()=>{
  let closed=false;class A {close(){closed=true}} class B {constructor(){throw Error()}}
  assert.throws(()=>attachTalkButtons({A,B},{}));assert(closed)
})
