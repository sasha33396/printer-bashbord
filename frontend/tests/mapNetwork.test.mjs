import test from 'node:test'
import assert from 'node:assert/strict'
import {floorNetwork,generatePorts,insertRoutePoint,linkPoints,occupiedPorts,portKey,traceNetwork} from '../src/utils/mapNetwork.js'
const node=(id,kind='switch',count=2)=>({id,kind,name:id,x:1,y:1,floor_id:1,ports:generatePorts(count)})
const link=(id,a,ai,b,bi,state='installed')=>({id,source_node:a.id,source_port:a.ports[ai].id,target_node:b.id,target_port:b.ports[bi].id,medium:'copper',state,floor_id:1,route:[]})
test('trace crosses paired passive ports, switches and floors but never unrelated passive ports',()=>{
  const pc=node('pc','computer'),panel=node('panel','patch_panel',4),sw=node('sw'),router=node('router','router')
  panel.ports[0].paired_port_id=panel.ports[1].id
  const network={nodes:[pc,panel,sw,router],links:[link('a',pc,0,panel,0),link('b',panel,1,sw,0),link('c',sw,1,router,0)]}
  assert.deepEqual(traceNetwork(network,'pc').steps.map(row=>row.id),['a','b','c'])
  network.links[1].source_port=panel.ports[2].id
  assert.equal(traceNetwork(network,'pc').found,false)
  network.links[1].source_port=panel.ports[1].id;network.links[1].state='planned'
  assert.equal(traceNetwork(network,'pc').found,false)
})
test('planned links reserve physical ports, disconnected ones release them',()=>{
  const a=node('a'),b=node('b'),wire=link('x',a,0,b,0,'planned')
  assert.ok(occupiedPorts([wire]).has(portKey('a',a.ports[0].id)))
  assert.equal(occupiedPorts([{...wire,state:'disconnected'}]).size,0)
  assert.equal(occupiedPorts([wire],'x').size,0)
})
test('equipment position and live addresses override standalone values without mutating documents',()=>{
  const a={...node('a'),entity_type:'warehouse_item',entity_id:3,follow_equipment:true,ip_address:'old'}
  const doc={width:40,height:25,name:'1',network:{nodes:[a],links:[]}}
  const net=floorNetwork(doc,{nodes:[],links:[]},{id:1},[{entity_type:'warehouse_item',entity_id:3,ip_address:'192.0.2.1',position:{floor_id:1,entity_type:'workplace',entity_id:1,x:5,y:6}}])
  assert.equal(net.nodes[0].x,5.8);assert.equal(net.nodes[0].ip_address,'192.0.2.1');assert.equal(a.x,1)
})
test('cross-floor cable renders a portal and editable bend insertion preserves endpoints',()=>{
  const a=node('a'),b={...node('b'),floor_id:2},wire={...link('x',a,0,b,0),remote_point:{x:20,y:10}}
  const geometry=linkPoints(wire,[a,b],{id:1},{width:40,height:25})
  assert.equal(geometry.remote.id,'b');assert.deepEqual(geometry.points.at(-1),wire.remote_point)
  const route=insertRoutePoint(wire,geometry,{x:10,y:1})
  assert.equal(route[0].x,10);assert.equal(route.length,2)
  const other=linkPoints(wire,[a,b],{id:2},{width:40,height:25})
  assert.equal(other.owner,false);assert.equal(other.remote.id,'a')
})
test('opening a building without floors keeps the global network and ignores the previous local document',()=>{
  const a={...node('a'),follow_equipment:true},doc={width:40,height:25,network:{nodes:[a],links:[]}}
  const net=floorNetwork(doc,{nodes:[a],links:[],revision:3},null,[])
  assert.equal(net.nodes.length,1);assert.equal(net.nodes[0].floor_id,1);assert.equal(net.nodes[0].x,1)
})
