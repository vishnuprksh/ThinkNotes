
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  groundingUrls?: Array<{ title: string; uri: string }>;
  isEdit?: boolean;
  checkpointIndex?: number;
}

export interface Checkpoint {
  content: string;
  timestamp: number;
  description: string;
}

export interface EditorState {
  content: string;
  isSaving: boolean;
  lastSaved: number | null;
}

export enum SidebarTab {
  CHAT = 'chat',
  HISTORY = 'history',
  SETTINGS = 'settings'
}
