import { bindRooms, clamp, elementKey, expandedSelection, round, roomAt } from './floorPlans.js'

export function bounds(item) {
  const left = Math.min(item.x,item.x2 ?? item.x), top = Math.min(item.y,item.y2 ?? item.y)
  const right = item.width != null ? item.x + item.width : Math.max(item.x,item.x2 ?? item.x)
  const bottom = item.height != null ? item.y + item.height : Math.max(item.y,item.y2 ?? item.y)
  return { left,top,right,bottom,width:right-left,height:bottom-top,cx:(left+right)/2,cy:(top+bottom)/2 }
}
const elements = document => [...document.shapes,...document.markers]
export function marqueeSelection(document, start, end) {
  const box = bounds({ x:start.x,y:start.y,x2:end.x,y2:end.y })
  return elements(document).filter(item => { const b=bounds(item); return b.left>=box.left && b.right<=box.right && b.top>=box.top && b.bottom<=box.bottom }).map(elementKey)
}
function transform(document, changes) {
  const change = item => {
    let next = changes.get(elementKey(item))
    if (!next && item.entity_type) {
      const room = document.shapes.find(room => room.kind === 'room' && (item.room_id ? item.room_id === room.id : roomAt(document,item)?.id === room.id))
      const moved = room && changes.get(elementKey(room))
      if (moved) next={...item,x:round(item.x + moved.x-room.x),y:round(item.y + moved.y-room.y)}
    }
    return item.locked ? item : next || item
  }
  const next=bindRooms({...document,shapes:document.shapes.map(change),markers:document.markers.map(change)})
  // Reject an operation as a whole rather than distorting spacing at the boundary.
  return elements(next).some(item => {const b=bounds(item);return b.left<0||b.top<0||b.right>document.width||b.bottom>document.height}) ? document : next
}
export function alignToReference(document, keys, reference, edge) {
  const anchor=elements(document).find(item => elementKey(item)===reference)
  if(!anchor) return document
  const target=bounds(anchor)[edge], xAxis=['left','right','cx'].includes(edge), changes=new Map()
  for(const item of elements(document).filter(item => keys.includes(elementKey(item)) && elementKey(item)!==reference && !item.locked)) {
    const delta=target-bounds(item)[edge]
    changes.set(elementKey(item),{...item,x:round(item.x+(xAxis?delta:0)),y:round(item.y+(xAxis?0:delta)),...(item.x2!=null?{x2:round(item.x2+(xAxis?delta:0)),y2:round(item.y2+(xAxis?0:delta))}:{})})
  }
  return transform(document,changes)
}
export function distributeSelection(document, keys, axis, explicitGap=null) {
  const horizontal=axis==='x', start=horizontal?'left':'top', end=horizontal?'right':'bottom', size=horizontal?'width':'height'
  const items=elements(document).filter(item=>keys.includes(elementKey(item))).sort((a,b)=>bounds(a)[start]-bounds(b)[start])
  if(items.length<3 || items.some(item=>item.locked)) return document
  // Do not distribute a room independently of marks selected inside that same room.
  if(items.some(item=>item.entity_type && items.some(room=>room.kind==='room'&&(item.room_id===room.id||roomAt(document,item)?.id===room.id)))) return document
  const total=items.reduce((sum,item)=>sum+bounds(item)[size],0)
  const gap=explicitGap == null ? (bounds(items.at(-1))[end]-bounds(items[0])[start]-total)/(items.length-1) : explicitGap
  if(gap<0) return document
  let cursor=bounds(items[0])[start]; const changes=new Map()
  for(const item of items) {
    const delta=cursor-bounds(item)[start]
    changes.set(elementKey(item),{...item,x:round(item.x+(horizontal?delta:0)),y:round(item.y+(horizontal?0:delta)),...(item.x2!=null?{x2:round(item.x2+(horizontal?delta:0)),y2:round(item.y2+(horizontal?0:delta))}:{})})
    cursor+=bounds(item)[size]+gap
  }
  return transform(document,changes)
}
export function equalSize(document,keys,reference,axis) {
  const anchor=document.shapes.find(item=>elementKey(item)===reference && ['room','desk'].includes(item.kind))
  if(!anchor) return document
  return transform(document,new Map(document.shapes.filter(item=>keys.includes(elementKey(item))&&!item.locked&&['room','desk'].includes(item.kind)).map(item=>[elementKey(item),{...item,[axis]:anchor[axis]}])))
}
export function resizeRectangle(item,handle,point,plan,proportions=false) {
  const right=item.x+item.width,bottom=item.y+item.height
  let x=item.x,y=item.y,w=item.width,h=item.height
  if(handle.includes('w')){x=clamp(point.x,0,right-.5);w=right-x}
  if(handle.includes('e'))w=clamp(point.x-item.x,.5,plan.width-item.x)
  if(handle.includes('n')){y=clamp(point.y,0,bottom-.5);h=bottom-y}
  if(handle.includes('s'))h=clamp(point.y-item.y,.5,plan.height-item.y)
  if(proportions){
    const ratio=item.width/item.height
    if(handle==='n'||handle==='s')w=h*ratio
    else h=w/ratio
    const maxWidth=handle.includes('w')?right:plan.width-item.x, maxHeight=handle.includes('n')?bottom:plan.height-item.y
    const scale=Math.min(1,maxWidth/w,maxHeight/h); w*=scale;h*=scale
    if(w<.5||h<.5)return item
    if(handle.includes('w'))x=right-w
    if(handle.includes('n'))y=bottom-h
  }
  return {...item,x:round(x),y:round(y),width:round(w),height:round(h)}
}
export function smartGuides(document,keys,delta,threshold=.2) {
  const selected=new Set(expandedSelection(document,keys)), moving=elements(document).filter(item=>selected.has(elementKey(item))&&!item.locked)
  if(!moving.length)return {delta,guides:[]}
  const others=elements(document).filter(item=>!selected.has(elementKey(item)))
  const guides=[],next={...delta}
  for(const [axis,edges] of [['x',['left','cx','right']],['y',['top','cy','bottom']]]) {
    let best=threshold,candidate=null
    for(const item of moving)for(const other of others)for(const a of edges)for(const b of edges){
      const target=bounds(other)[b], distance=target-(bounds(item)[a]+delta[axis])
      if(Math.abs(distance)<best){best=Math.abs(distance);candidate={axis,value:target,offset:distance}}
    }
    if(candidate){next[axis]=round(next[axis]+candidate.offset);guides.push(candidate)}
  }
  // Avoid showing guides that would be broken by a boundary clamp.
  const legal=moving.every(item=>{const b=bounds(item);return b.left+next.x>=0&&b.right+next.x<=document.width&&b.top+next.y>=0&&b.bottom+next.y<=document.height})
  return legal?{delta:next,guides}:{delta,guides:[]}
}
export function wallDistances(item, shapes) {
  const b=bounds(item), result=[]
  for(const [side,axis,value,positive] of [['left','x',b.left,false],['right','x',b.right,true],['top','y',b.top,false],['bottom','y',b.bottom,true]]) {
    const vertical=axis==='x',center=vertical?b.cy:b.cx
    const walls=shapes.filter(wall=>wall.kind==='wall'&&(vertical?wall.x===wall.x2:wall.y===wall.y2))
      .filter(wall=>center>=Math.min(vertical?wall.y:wall.x,vertical?wall.y2:wall.x2)&&center<=Math.max(vertical?wall.y:wall.x,vertical?wall.y2:wall.x2))
      .map(wall=>vertical?wall.x:wall.y).filter(position=>positive?position>=value:position<=value).sort((a,c)=>Math.abs(a-value)-Math.abs(c-value))
    if(walls.length) result.push({side,distance:round(Math.abs(walls[0]-value)),from:vertical?{x:value,y:center}:{x:center,y:value},to:vertical?{x:walls[0],y:center}:{x:center,y:walls[0]}})
  }
  return result
}
