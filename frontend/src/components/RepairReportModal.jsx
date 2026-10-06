import { Button, Modal, Space, Typography, message } from 'antd'
import { CopyOutlined, DownloadOutlined, PrinterOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { copyText } from '../utils/network'

const dateText = (value) => (value ? dayjs(value).format('DD.MM.YYYY') : '—')
const moneyText = (value) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value || 0)} руб.`

export function buildRepairReport(repair, device) {
  if (!repair || !device) return ''
  const works = repair.work_items?.length
    ? repair.work_items.map((item) => `${item.description} ${moneyText(item.cost)}`)
    : ['—']
  const lines = [
    `Задача от: ${dateText(repair.task_date)}`,
    `Ссылка на задачу: ${repair.task_url || '—'}`,
    '',
    `Откуда: ${repair.source_location || '—'}`,
    `Ответственное лицо: ${repair.responsible_person || '—'}`,
    '',
    `Забрали в ремонт: ${dateText(repair.date)}`,
    `Вернули из ремонта: ${dateText(repair.returned_date)}`,
    `Подключили: ${dateText(repair.connected_date)}`,
    `На момент возврата из ремонта счётчик печати: ${repair.completion_page_counter ?? '—'}`,
  ]
  if (repair.page_counter_delta != null) {
    lines.push(`Напечатано с предыдущего ремонта: ${repair.page_counter_delta}`)
  }
  lines.push(
    '',
    'Тех. осмотр на неисправность:',
    repair.description || '—',
    '',
    `Модель принтера: ${device.manufacturer} ${device.model}`,
    'Проведённые работы (указано в счёте):',
    ...works,
    `Итого: ${moneyText(repair.cost)}`,
  )
  return lines.join('\n')
}

export default function RepairReportModal({ open, repair, device, onClose }) {
  const report = buildRepairReport(repair, device)

  const copy = async () => {
    try {
      await copyText(report)
      message.success('Отчёт скопирован')
    } catch {
      message.error('Не удалось скопировать отчёт')
    }
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([report], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `repair-${device?.inventory_number || repair?.id}.txt`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const print = () => {
    const popup = window.open('', '_blank', 'width=900,height=700')
    if (!popup) {
      message.error('Браузер заблокировал окно печати')
      return
    }
    popup.document.write('<!doctype html><html><head><title>Отчёт по ремонту</title><style>body{font:16px Arial,sans-serif;padding:32px}pre{white-space:pre-wrap;line-height:1.5}</style></head><body><pre id="report"></pre></body></html>')
    popup.document.getElementById('report').textContent = report
    popup.document.close()
    popup.focus()
    popup.print()
  }

  return (
    <Modal
      title="Отчёт по ремонту"
      open={open}
      onCancel={onClose}
      width={720}
      footer={(
        <Space wrap>
          <Button icon={<CopyOutlined />} onClick={copy}>Скопировать</Button>
          <Button icon={<DownloadOutlined />} onClick={download}>Скачать TXT</Button>
          <Button type="primary" icon={<PrinterOutlined />} onClick={print}>Распечатать</Button>
        </Space>
      )}
    >
      <Typography.Paragraph>
        <pre className="repair-report-preview">{report}</pre>
      </Typography.Paragraph>
    </Modal>
  )
}
