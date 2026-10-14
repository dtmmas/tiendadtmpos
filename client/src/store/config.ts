import { create } from 'zustand'
import { api } from '../api'

interface Config {
  name: string
  logoUrl?: string
  currency: string
  enabledProductTypes: string[]
  storeEnabled: boolean
}

interface ConfigState {
  config?: Config
  fetchConfig: () => Promise<void>
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: undefined,
  async fetchConfig() {
    try {
      const { data } = await api.get('/config')
      const logoUrl = data?.logoUrl && String(data.logoUrl).trim() ? data.logoUrl : 'https://placehold.co/64x64?text=LOGO'
      const enabledProductTypes = Array.isArray(data?.enabledProductTypes) && data.enabledProductTypes.length > 0
        ? data.enabledProductTypes.map((value: any) => String(value || '').trim().toUpperCase()).filter(Boolean)
        : ['GENERAL', 'MEDICINAL', 'IMEI', 'SERIAL', 'VARIANT_SERIALIZED']
      const storeEnabled = data?.storeEnabled === undefined ? true : Boolean(data.storeEnabled)
      set({ config: { ...data, logoUrl, enabledProductTypes, storeEnabled } })
    } catch {
      set({ config: { name: 'DTMPos', currency: 'USD', logoUrl: 'https://placehold.co/64x64?text=LOGO', enabledProductTypes: ['GENERAL', 'MEDICINAL', 'IMEI', 'SERIAL', 'VARIANT_SERIALIZED'], storeEnabled: true } })
    }
  },
}))
