import Constants from 'expo-constants';

type Extra = {
  WS_URL?: string;
  API_URL?: string;
};

// Support both new expoConfig.extra and legacy manifest extra
const extra = (Constants.expoConfig?.extra ?? (Constants as any).manifestExtra ?? {}) as Extra;

export const WS_URL: string = extra.WS_URL || '';
export const API_URL: string = extra.API_URL || '';


