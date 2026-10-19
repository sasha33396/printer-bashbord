import test from 'node:test'
import assert from 'node:assert/strict'
import {alignToReference,distributeSelection,equalSize,marqueeSelection,resizeRectangle,smartGuides,wallDistances} from '../src/utils/mapEditing.js'
const desk=(id,x,y=3,width=2,height=1)=>({id,kind:'desk',x,y,width,height})
const plan=shapes=>({width:40,height:25,shapes,markers:[]})
test('alignment keeps reference stationary and aligns actual right edges',()=>{
  const doc=plan([desk('a',2,3,5),desk('b',12)]),next=alignToReference(doc,['s:a','s:b'],'s:a','right')
  assert.equal(next.shapes[0].x,2);assert.equal(next.shapes[1].x,5)
  doc.shapes[0].locked=true
  assert.equal(alignToReference(doc,['s:a','s:b'],'s:a','cx').shapes[1].x,3.5)
})
test('equal spacing uses free gaps rather than centers and rejects boundary overflow',()=>{
  const doc=plan([desk('a',1,3,4),desk('b',7,3,2),desk('c',20,3,3)])
  assert.equal(distributeSelection(doc,['s:a','s:b','s:c'],'x').shapes[1].x,11.5)
  assert.equal(distributeSelection(doc,['s:a','s:b','s:c'],'x',.8).shapes[2].x,8.6)
  assert.equal(distributeSelection(doc,['s:a','s:b','s:c'],'x',100),doc)
})
test('marquee normalizes direction and requires complete containment',()=>{
  const doc=plan([desk('a',2),desk('b',8)])
  assert.deepEqual(marqueeSelection(doc,{x:6,y:6},{x:1,y:1}),['s:a'])
  // SVG DOMPoint exposes coordinates as prototype getters, not own properties.
  assert.deepEqual(marqueeSelection(doc,Object.create({x:6,y:6}),Object.create({x:1,y:1})),['s:a'])
})
test('resize handles preserve opposite corner, bounds and Shift proportions',()=>{
  const item=desk('a',5,5,4,2),doc=plan([])
  assert.deepEqual(resizeRectangle(item,'nw',{x:3,y:4},doc),{...item,x:3,y:4,width:6,height:3})
  const next=resizeRectangle(item,'se',{x:13,y:8},doc,true)
  assert.equal(next.width/next.height,2);assert.equal(next.height,4)
  assert.equal(resizeRectangle(item,'w',{x:-9,y:4},doc).x,0)
})
test('smart guides snap nearby edges and ignore selected group members',()=>{
  const doc=plan([desk('a',1),desk('b',10)])
  const result=smartGuides(doc,['s:a'],{x:6.9,y:0},.2)
  assert.equal(result.delta.x,7);assert.equal(result.guides.find(item=>item.axis==='x').value,10)
  assert.equal(smartGuides(doc,['s:a','s:b'],{x:0,y:0}).guides.length,0)
})
test('equal dimensions preserve locks, and wall offsets use nearest intersecting wall',()=>{
  const doc=plan([desk('a',1,3,4),{...desk('b',10),locked:true},desk('c',20)])
  const next=equalSize(doc,['s:a','s:b','s:c'],'s:a','width')
  assert.equal(next.shapes[1].width,2);assert.equal(next.shapes[2].width,4)
  const gaps=wallDistances(desk('a',3),[{kind:'wall',x:1,y:0,x2:1,y2:9}])
  assert.equal(gaps.find(item=>item.side==='left').distance,2)
})
