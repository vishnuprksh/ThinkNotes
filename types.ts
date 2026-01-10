export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thought?: string;
  timestamp: number;
  groundingUrls?: Array<{ title: string; uri: string }>;
  searchEntryPointHtml?: string;
  isEdit?: boolean;
  checkpointIndex?: number;
}

export interface GlobalState {
  content: string;
  writerScript: string;
  readerScript: string;
  variables: Record<string, string | TableData>;
  description: string;
  timestamp: number;
}

export type ViewMode = 'preview' | 'edit' | 'edit_diff' | 'db' | 'api' | 'api_diff';

export interface TableData {
  columns: string[];
  values: any[][];
}

export interface TableInfo {
  name: string;
  columns: string[];
  rows: any[][];
}

export interface DatabaseState {
  tables: TableInfo[];
  lastQuery?: string;
  error?: string;
  isSyncing?: boolean;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface PipelineState {
  writerScript: string;
  readerScript: string;
}