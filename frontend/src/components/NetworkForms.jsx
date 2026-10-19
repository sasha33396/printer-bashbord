import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, message } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { markerKey, newShapeId } from '../utils/floorPlans'
import { generatePorts, LINK_MEDIA, LINK_STATES, NETWORK_KINDS, occupiedPorts, PORT_KINDS, portKey } from '../utils/mapNetwork'

const options = values => Object.entries(values).map(([value, label]) => ({ value, label }))

export function NetworkNodeModal({ open, node, floor, network, catalog, onClose, onSave }) {
  const [form] = Form.useForm()
  const [count, setCount] = useState(8)
  const [paired, setPaired] = useState(false)
  const attachment = Form.useWatch('attachment', form)
  const kind = Form.useWatch('kind', form)
  const locked = Form.useWatch('locked',form)
  const ports = Form.useWatch('ports', form) || []
  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue(node ? { ...node, attachment: node.entity_type ? `${node.entity_type}:${node.entity_id}` : undefined }
      : { name: '', kind: 'switch', ports: generatePorts(8), x: 2, y: 2, follow_equipment: true })
    setCount(node?.ports?.length || 8); setPaired(false)
  }, [open, node, form])
  const usedCards = new Set(network.nodes.filter(row => row.id !== node?.id && row.entity_type).map(markerKey))
  const equipment = catalog.filter(entity => ['warehouse_item', 'device'].includes(entity.entity_type) && entity.available !== false
    && (!floor.branch_id || !entity.branch_id || floor.branch_id === entity.branch_id) && !usedCards.has(markerKey(entity)))
  const save = async () => {
    let value
    try { value = await form.validateFields() } catch { return }
    const [entity_type, id] = value.attachment?.split(':') || []
    const { attachment: _, ...fields } = value
    const next = { ...node, ...fields, id: node?.id || newShapeId(), entity_type: entity_type || null, entity_id: id ? Number(id) : null,
      hostname: value.hostname || '', ip_address: entity_type ? '' : value.ip_address || '', mac_address: entity_type ? '' : value.mac_address || '', group: value.group || '', notes: value.notes || '',
      ports: value.ports.map(port => ({ ...port, paired_port_id: ['patch_panel','socket'].includes(value.kind) ? port.paired_port_id || null : null, notes: port.notes || '' })) }
    // Floor/global display fields are not part of the editable document.
    for (const key of ['floor_id','floor_name','building_id','building_name','branch_id','entity','unavailable','warning']) delete next[key]
    if (new Set(next.ports.map(port => port.name.trim().toLocaleLowerCase('ru'))).size !== next.ports.length) return message.error('Имена портов должны различаться')
    const portIds = new Set(next.ports.map(port => port.id))
    const usedRemoved = network.links.some(link => (link.source_node === next.id && !portIds.has(link.source_port)) || (link.target_node === next.id && !portIds.has(link.target_port)))
    if (usedRemoved) return message.error('Нельзя удалить используемый порт. Сначала измените его соединения.')
    if (onSave(next) !== false) onClose()
  }
  return <Modal open={open} title={node ? 'Редактировать сетевой узел' : 'Добавить сетевой узел'} onCancel={onClose} onOk={save} okText="Применить к плану" cancelText="Отмена" width={860} destroyOnClose>
    <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
      <div className="network-form-grid">
        <Form.Item name="name" label="Название узла" rules={[{ required: true, whitespace: true }]}><Input aria-label="Название сетевого узла" maxLength={200} /></Form.Item>
        <Form.Item name="kind" label="Тип узла" rules={[{ required: true }]}><Select aria-label="Тип сетевого узла" options={options(NETWORK_KINDS)} /></Form.Item>
      </div>
      <Form.Item name="attachment" label="Карточка оборудования" extra="Названия, IP и MAC привязанного оборудования берутся из учёта. Самостоятельный узел можно оставить без привязки.">
        <Select aria-label="Карточка сетевого узла" allowClear showSearch optionFilterProp="label" placeholder="Самостоятельный сетевой узел" options={equipment.map(entity => ({ value: markerKey(entity), label: [entity.inventory_number,entity.name].filter(Boolean).join(' · ') }))}
          onChange={value => {
            const entity = equipment.find(row => markerKey(row) === value)
            if (entity) form.setFieldsValue({ name: entity.name, ip_address: '', mac_address: '', ...(entity.position?.floor_id === floor.id ? { x: entity.position.x, y: entity.position.y } : {}) })
          }} />
      </Form.Item>
      {attachment && <Form.Item name="follow_equipment" valuePropName="checked"><Checkbox disabled={locked}>Следовать отметке оборудования на этом этаже</Checkbox></Form.Item>}
      <div className="network-form-grid">
        <Form.Item name="x" label="X, м" rules={[{ required: true }]}><InputNumber aria-label="Сетевой узел X" disabled={locked} min={0} max={floor.width} step={0.5} /></Form.Item>
        <Form.Item name="y" label="Y, м" rules={[{ required: true }]}><InputNumber aria-label="Сетевой узел Y" disabled={locked} min={0} max={floor.height} step={0.5} /></Form.Item>
        <Form.Item name="hostname" label="Сетевое имя"><Input maxLength={255} /></Form.Item>
        <Form.Item name="ip_address" label="IP-адрес"><Input disabled={Boolean(attachment)} maxLength={45} /></Form.Item>
        <Form.Item name="mac_address" label="MAC-адрес"><Input disabled={Boolean(attachment)} maxLength={32} /></Form.Item>
        <Form.Item name="group" label="Группа сети / VLAN"><Input aria-label="Группа сетевого узла" maxLength={80} placeholder="Например: Офис / VLAN 10" /></Form.Item>
      </div>
      <Form.Item name="notes" label="Примечание"><Input.TextArea rows={2} maxLength={2000} /></Form.Item>
      <Form.Item name="locked" valuePropName="checked"><Checkbox>Заблокировать перемещение узла</Checkbox></Form.Item>
      <div className="network-port-heading"><strong>Порты</strong><Space wrap>
        <InputNumber aria-label="Количество портов" min={1} max={128} value={count} onChange={setCount} />
        {['patch_panel','socket'].includes(kind) && <Checkbox checked={paired} onChange={event => setPaired(event.target.checked)}>Передний + задний</Checkbox>}
        <Button onClick={() => form.setFieldValue('ports', generatePorts(count || 1, ports, paired && ['patch_panel','socket'].includes(kind)))}>Заполнить порты</Button>
      </Space></div>
      <Form.List name="ports">{(fields, { add, remove }) => <>
        <div className="network-port-list">{fields.map(({ key, name }) => <div key={key} className="network-port-row">
          <Form.Item name={[name,'id']} hidden><Input /></Form.Item>
          <Form.Item name={[name,'name']} rules={[{ required: true, whitespace: true }]}><Input aria-label={`Название порта ${name + 1}`} maxLength={80} placeholder="Порт" /></Form.Item>
          <Form.Item name={[name,'kind']}><Select options={options(PORT_KINDS)} /></Form.Item>
          {['patch_panel','socket'].includes(kind) && <Form.Item name={[name,'paired_port_id']}><Select allowClear placeholder="Парный порт" options={ports.filter(port => port.id !== ports[name]?.id).map(port => ({ value: port.id, label: port.name }))} /></Form.Item>}
          <Button danger icon={<DeleteOutlined />} title="Удалить порт" onClick={() => remove(name)} />
        </div>)}</div>
        <Button icon={<PlusOutlined />} disabled={fields.length >= 256} onClick={() => add({ id: newShapeId(), name: String(fields.length + 1), kind: 'ethernet' })}>Добавить порт</Button>
      </>}</Form.List>
    </Form>
  </Modal>
}

export function NetworkLinkModal({ open, link, initialSource, initialTarget, network, floor, onClose, onSave }) {
  const [form] = Form.useForm()
  const sourceId = Form.useWatch('source_node', form), targetId = Form.useWatch('target_node', form)
  const medium = Form.useWatch('medium', form), state = Form.useWatch('state', form)
  useEffect(() => {
    if (!open) return
    form.resetFields(); form.setFieldsValue(link || { source_node: initialSource, target_node: initialTarget, medium: 'copper', state: 'installed' })
  }, [open, link, initialSource, initialTarget, form])
  const occupied = occupiedPorts(network.links, link?.id)
  const nodeOptions = network.nodes.map(node => ({ value: node.id, label: `${node.name} · ${node.building_name || ''} / ${node.floor_name}` }))
  const ports = id => (network.nodes.find(node => node.id === id)?.ports || []).map(port => ({
    value: port.id, label: port.name + (occupied.has(portKey(id,port.id)) ? ' · занят' : ''),
    disabled: state !== 'disconnected' && ['copper','fiber'].includes(medium) && (occupied.has(portKey(id,port.id)) || port.kind !== (medium === 'copper' ? 'ethernet' : 'fiber')),
  }))
  const save = async () => {
    let value
    try { value = await form.validateFields() } catch { return }
    if (value.source_node === value.target_node) return message.error('Выберите разные узлы')
    if (ports(value.source_node).find(port => port.value === value.source_port)?.disabled || ports(value.target_node).find(port => port.value === value.target_port)?.disabled) return message.error('Выбранный порт занят или не соответствует типу соединения')
    if (![value.source_node,value.target_node].some(id => network.nodes.find(node => node.id === id)?.floor_id === floor.id)) return message.error('Один конец соединения должен находиться на этом этаже')
    const remote = [value.source_node,value.target_node].some(id => network.nodes.find(node => node.id === id)?.floor_id !== floor.id)
    const next = { ...link, ...value, id: link?.id || newShapeId(), route: link?.route || [], remote_point: remote ? link?.remote_point || { x: floor.width - 1, y: floor.height / 2 } : null,
      cable_number: value.cable_number || '', group: value.group || '', notes: value.notes || '' }
    for (const key of ['floor_id','floor_name','building_id','building_name','branch_id']) delete next[key]
    if (onSave(next) !== false) onClose()
  }
  return <Modal open={open} title={link ? 'Редактировать соединение' : 'Соединить узлы'} onCancel={onClose} onOk={save} okText="Применить к плану" cancelText="Отмена" width={720} destroyOnClose>
    <Alert type="info" showIcon message="Соединение описывает схему по учёту. Другие этажи доступны в списке узлов." style={{ margin: '16px 0' }} />
    <Form form={form} layout="vertical">
      {['source','target'].map((side,index) => <div className="network-form-grid" key={side}>
        <Form.Item name={`${side}_node`} label={index ? 'Второй узел' : 'Первый узел'} rules={[{ required: true }]}><Select aria-label={index?'Второй сетевой узел':'Первый сетевой узел'} showSearch optionFilterProp="label" options={nodeOptions} onChange={() => form.setFieldValue(`${side}_port`, undefined)} /></Form.Item>
        <Form.Item name={`${side}_port`} label="Порт" rules={[{ required: true }]}><Select aria-label={index?'Второй порт':'Первый порт'} options={ports(index ? targetId : sourceId)} /></Form.Item>
      </div>)}
      <div className="network-form-grid">
        <Form.Item name="medium" label="Тип соединения" rules={[{ required: true }]}><Select options={options(LINK_MEDIA)} onChange={() => form.setFieldsValue({ source_port: undefined, target_port: undefined })} /></Form.Item>
        <Form.Item name="state" label="Состояние по учёту" rules={[{ required: true }]}><Select options={options(LINK_STATES)} /></Form.Item>
        <Form.Item name="cable_number" label="Номер кабеля"><Input aria-label="Номер кабеля" maxLength={100} /></Form.Item>
        <Form.Item name="group" label="Группа сети / VLAN"><Input maxLength={80} /></Form.Item>
      </div>
      <Form.Item name="notes" label="Примечание"><Input.TextArea maxLength={2000} rows={2} /></Form.Item>
    </Form>
  </Modal>
}
