import { useState } from 'react'
import { Button, Checkbox, Input, InputNumber, Modal, Popconfirm, Select, Space, Typography, message } from 'antd'
import { alignToReference, distributeSelection, equalSize } from '../utils/mapEditing'
import { copySelection, elementKey, newShapeId, pasteShapes, roomTitle } from '../utils/floorPlans'

const templateKey=()=>{let username='';try{username=JSON.parse(atob(localStorage.getItem('token').split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub||''}catch{/* separate unauthenticated browser storage */}return `map-layout-templates:${username}`}
export default function MapEditingTools({document,selection,selected,disabled,onChange,onSelection,guides,onGuides,measurements,onMeasurements,reference,onReference}) {
  const [gap,setGap]=useState(null),[open,setOpen]=useState(false),[name,setName]=useState(''),[templates,setTemplates]=useState([])
  const options=[...document.shapes,...document.markers].filter(item=>selection.includes(elementKey(item))).map(item=>({value:elementKey(item),label:item.kind==='room'?roomTitle(item):item.label||({desk:'Стол',wall:'Стена',door:'Дверь',text:'Подпись'}[item.kind])||`${item.entity_type} ${item.entity_id}`}))
  const anchor=options.some(item=>item.value===reference)?reference:options.some(item=>item.value===selected)?selected:options[0]?.value
  const apply=next=>{if(next===document)message.info('Операция не выполнена: проверьте блокировки, границы плана и состав выделения.');else onChange(next)}
  const store=next=>{try{localStorage.setItem(templateKey(),JSON.stringify(next));setTemplates(next);return true}catch{message.error('Не удалось сохранить шаблон на этом устройстве');return false}}
  const show=()=>{try{setTemplates(JSON.parse(localStorage.getItem(templateKey())||'[]'));setOpen(true)}catch{message.error('Не удалось прочитать шаблоны')}}
  return <>
    <Space wrap className="map-editing-tools">
      <Checkbox checked={guides} onChange={event=>onGuides(event.target.checked)}>Умные направляющие (Alt — без привязки)</Checkbox>
      <Checkbox checked={measurements} onChange={event=>onMeasurements(event.target.checked)}>Линейки и отступы до стен</Checkbox>
      <Select aria-label="Опорный объект" placeholder="Опорный объект" value={anchor} onChange={onReference} options={options} style={{minWidth:175}} disabled={disabled||!selection.length} />
      <Select aria-label="Выравнивание по опорному объекту" placeholder="Выровнять по опорному" value={undefined} disabled={disabled||selection.length<2} style={{minWidth:200}} options={Object.entries({left:'По левому краю',cx:'По центру горизонтали',right:'По правому краю',top:'По верхнему краю',cy:'По центру вертикали',bottom:'По нижнему краю'}).map(([value,label])=>({value,label}))} onChange={edge=>apply(alignToReference(document,selection,anchor,edge))} />
      <InputNumber aria-label="Промежуток между объектами" min={0} max={500} step={.1} value={gap} placeholder="Авто, м" onChange={setGap} style={{width:115}} />
      <Button size="small" disabled={disabled||selection.length<3} onClick={()=>apply(distributeSelection(document,selection,'x',gap))}>Равные интервалы ↔</Button>
      <Button size="small" disabled={disabled||selection.length<3} onClick={()=>apply(distributeSelection(document,selection,'y',gap))}>Равные интервалы ↕</Button>
      <Button size="small" disabled={disabled||selection.length<2} onClick={()=>apply(equalSize(document,selection,anchor,'width'))}>Одинаковая ширина</Button>
      <Button size="small" disabled={disabled||selection.length<2} onClick={()=>apply(equalSize(document,selection,anchor,'height'))}>Одинаковая высота</Button>
      <Button size="small" disabled={disabled} onClick={show}>Шаблоны расстановки</Button>
      <Typography.Text type="secondary">Стрелки: 0,1 м · Shift: 1 м · Shift при изменении размера: пропорции</Typography.Text>
    </Space>
    <Modal open={open} title="Шаблоны расстановки на этом устройстве" onCancel={()=>setOpen(false)} footer={<Button onClick={()=>setOpen(false)}>Закрыть</Button>} width={650}>
      <p>Сохраняются выделенные кабинеты, столы, стены и подписи. Карточки оборудования и сетевые узлы добавляются отдельно.</p>
      <Space.Compact style={{width:'100%',marginBottom:16}}><Input aria-label="Название шаблона" value={name} maxLength={100} onChange={event=>setName(event.target.value)} placeholder="Название шаблона" /><Button onClick={()=>{
        const shapes=copySelection(document,selection)
        if(!name.trim()||!shapes.length)return message.info('Выделите элементы рисунка и укажите название')
        if(store([...templates,{id:newShapeId(),name:name.trim(),shapes}])){setName('');message.success('Шаблон сохранён')}
      }}>Сохранить выделенное</Button></Space.Compact>
      {templates.map(template=><div className="map-template-row" key={template.id}><strong>{template.name}</strong><span>{template.shapes.length} элементов</span><Space><Button onClick={()=>{
        if(template.shapes.some(item=>(item.x+ (item.width||0))>document.width||(item.y+(item.height||0))>document.height||(item.x2||0)>document.width||(item.y2||0)>document.height))return message.warning('Шаблон не помещается на этом плане')
        const result=pasteShapes(document,template.shapes);onChange(result.document);onSelection(result.keys);setOpen(false)
      }}>Вставить</Button><Popconfirm title="Удалить шаблон?" onConfirm={()=>store(templates.filter(row=>row.id!==template.id))}><Button danger>Удалить</Button></Popconfirm></Space></div>)}
      {!templates.length&&<Typography.Text type="secondary">Сохранённых шаблонов пока нет</Typography.Text>}
    </Modal>
  </>
}
