import { api } from './client';
import type { ImageModel, TextModel } from './types';

export interface StudioPreferences {
  textModelId: string;
  imageModelId: string;
  wechatAccountId: string;
}

export const EMPTY_PREFERENCES: StudioPreferences = {
  textModelId: '',
  imageModelId: '',
  wechatAccountId: '',
};

export async function loadPreferences(
  textModels: TextModel[] = [],
  imageModels: ImageModel[] = [],
  accounts: Array<{ id: string }> = [],
): Promise<StudioPreferences> {
  const [text, image, account] = await Promise.all([
    api.storage.get('text-model-id').catch(() => null),
    api.storage.get('image-model-id').catch(() => null),
    api.storage.get('wechat-account-id').catch(() => null),
  ]);
  const textModelId = String(text || '');
  const imageModelId = String(image || '');
  const wechatAccountId = String(account || '');
  return {
    textModelId: textModels.some(model => model.id === textModelId) ? textModelId : textModels[0]?.id || '',
    imageModelId: imageModels.some(model => model.id === imageModelId) ? imageModelId : imageModels[0]?.id || '',
    wechatAccountId: accounts.some(item => item.id === wechatAccountId) ? wechatAccountId : accounts[0]?.id || '',
  };
}
