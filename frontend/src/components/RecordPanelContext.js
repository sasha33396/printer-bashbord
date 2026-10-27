import { createContext, useCallback, useContext } from 'react'
import { useNavigate } from 'react-router-dom'

export const PanelContext = createContext({ revision: 0, selected: null, open: null })
export const recordPatterns = [
  { pattern: /^\/devices\/(\d+)$/, type: 'device', title: 'Карточка принтера' },
  { pattern: /^\/warehouse\/items\/(\d+)$/, type: 'warehouse', title: 'Карточка оборудования' },
  { pattern: /^\/workplaces\/(\d+)$/, type: 'workplace', title: 'Рабочее место' },
  { pattern: /^\/digital-documents\/(ecp|mchd)\/(\d+)$/, type: 'document', title: 'ЭЦП и МЧД' },
]

export function useRecordNavigation() {
  const navigate = useNavigate()
  const { open } = useContext(PanelContext)
  return useCallback((path, options) => {
    const match = typeof path === 'string' && recordPatterns.find((entry) => entry.pattern.test(path))
    if (match && open && !options) open(path)
    else navigate(path, options)
  }, [navigate, open])
}

export function useRecordPanel() { return useContext(PanelContext) }
