import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { ConfigProvider } from 'antd'
import ruRU from 'antd/locale/ru_RU'
import dayjs from 'dayjs'
import 'dayjs/locale/ru'
import { enterpriseTheme } from './theme'

dayjs.locale('ru')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider locale={ruRU} theme={enterpriseTheme}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
)
