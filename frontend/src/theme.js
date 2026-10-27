export const enterpriseTheme = {
  token: {
    colorPrimary: '#2563EB', colorInfo: '#2563EB', colorSuccess: '#16A34A',
    colorWarning: '#D97706', colorError: '#DC2626', colorText: '#172033',
    colorTextSecondary: '#64748B', colorBorder: '#E2E8F0', colorBorderSecondary: '#E2E8F0',
    colorBgLayout: '#F5F7FA', colorBgContainer: '#FFFFFF',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 13, borderRadius: 6, controlHeight: 32,
    boxShadow: '0 2px 8px rgba(23, 32, 51, 0.06)',
  },
  components: {
    Layout: { siderBg: '#17263C', headerBg: '#FFFFFF', bodyBg: '#F5F7FA' },
    Menu: { darkItemBg: '#17263C', darkSubMenuItemBg: '#17263C', darkItemSelectedBg: '#263B55',
      darkItemColor: '#CBD5E1', darkItemSelectedColor: '#FFFFFF', itemHeight: 40, iconSize: 17 },
    Table: { headerBg: '#F1F5F9', headerColor: '#475569', rowHoverBg: '#F8FAFC',
      rowSelectedBg: '#EFF6FF', cellPaddingBlockSM: 9, cellPaddingInlineSM: 12, fontSize: 12 },
    Card: { headerHeight: 44, headerFontSize: 15, bodyPadding: 16, bodyPaddingSM: 12 },
    Typography: { titleMarginTop: 0, titleMarginBottom: 16, fontSizeHeading3: 24 },
    Form: { itemMarginBottom: 16, labelFontSize: 12 },
    Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' },
    Tabs: { horizontalItemGutter: 24 },
    Statistic: { contentFontSize: 26, titleFontSize: 12 },
  },
}
