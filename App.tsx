import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { marked } from 'marked';
import ChatPanel from './components/ChatPanel';
import { Message, GlobalState, ViewMode, DatabaseState, TableInfo, Template, TableData } from './types';
import initSqlJs from "sql.js";

marked.setOptions({
  gfm: true,
  breaks: true,
});

interface DiffLine { type: 'added' | 'removed' | 'unchanged'; content: string; }
interface AppTheme { name: string; bgPrimary: string; bgSecondary: string; borderPrimary: string; accentPrimary: string; textPrimary: string; textSecondary: string; textHeaders: string; }

const THEMES: AppTheme[] = [
  { name: 'GitHub Dark', bgPrimary: '#0d1117', bgSecondary: '#161b22', borderPrimary: '#30363d', accentPrimary: '#6366f1', textPrimary: '#c9d1d9', textSecondary: '#8b949e', textHeaders: '#f0f6fc' },
  { name: 'Midnight', bgPrimary: '#0a0b1e', bgSecondary: '#121432', borderPrimary: '#1f2251', accentPrimary: '#8b5cf6', textPrimary: '#e0e7ff', textSecondary: '#a5b4fc', textHeaders: '#ffffff' },
  { name: 'Ghost', bgPrimary: '#000000', bgSecondary: '#111111', borderPrimary: '#222222', accentPrimary: '#ffffff', textPrimary: '#eeeeee', textSecondary: '#888888', textHeaders: '#ffffff' }
];

const TEMPLATES: Template[] = [
  { id: 'fpl_analysis', name: 'FPL Analytics', description: 'Acquires data via external FPL API and reads key metrics.', icon: '🏆' },
  { id: 'student_intelligence', name: 'Student Records', description: 'Local database with grading logic and attendance tracking.', icon: '🎓' },
  { id: 'blank', name: 'Blank Note', description: 'Fresh start with no logic.', icon: '📝' }
];

const DEFAULT_WRITER = `async ({ db, fetchExternalData }) => {
  // Acquires data from external sources and writes to DB
  return "Writer initialized. No external calls performed yet.";
}`;

const DEFAULT_READER = `async ({ db }) => {
  // Reads from DB and returns variables for the document
  return {};
}`;

const getDiff = (oldStr: string, newStr: string): DiffLine[] => {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const diff: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      diff.push({ type: 'unchanged', content: oldLines[i] }); i++; j++;
    } else if (j < newLines.length && (i >= oldLines.length || !oldLines.slice(i).includes(newLines[j]))) {
      diff.push({ type: 'added', content: newLines[j] }); j++;
    } else if (i < oldLines.length) {
      diff.push({ type: 'removed', content: oldLines[i] }); i++;
    }
  }
  return diff;
};

const App: React.FC = () => {
  const [content, setContent] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [showWelcome, setShowWelcome] = useState(true);
  const [currentTheme, setCurrentTheme] = useState<AppTheme>(THEMES[0]);
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [isTemplateLoading, setIsTemplateLoading] = useState(false);
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  // Database State
  const [db, setDb] = useState<any>(null);
  const [dbState, setDbState] = useState<DatabaseState>({ tables: [], isSyncing: false });

  // Script and Var State
  const [writerScript, setWriterScript] = useState(DEFAULT_WRITER);
  const [readerScript, setReaderScript] = useState(DEFAULT_READER);
  const [variables, setVariables] = useState<Record<string, string | TableData>>({});

  // Global History for Checkpoints
  const [history, setHistory] = useState<GlobalState[]>([{
    content: '',
    writerScript: DEFAULT_WRITER,
    readerScript: DEFAULT_READER,
    variables: {},
    description: 'Initial State',
    timestamp: Date.now()
  }]);

  const isEmpty = useMemo(() => content.trim() === '', [content]);
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close menus on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (templateMenuRef.current && !templateMenuRef.current.contains(event.target as Node)) {
        setIsTemplateMenuOpen(false);
      }
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Initialize DB on mount
  // Initialize DB on mount
  useEffect(() => {
    const initDatabase = async () => {
      try {
        const SQL = await initSqlJs({
          locateFile: file => `/sql-wasm.wasm`
        });
        const newDb = new SQL.Database();
        setDb(newDb);
        refreshDbState(newDb);
      } catch (err: any) {
        setDbState(prev => ({ ...prev, error: `DB Error: ${err.message}` }));
        console.error("DB Init Error:", err);
      }
    };
    initDatabase();
    if (window.innerWidth >= 1280) setIsSidebarOpen(true);
  }, []);

  const refreshDbState = useCallback((database: any) => {
    if (!database) return;
    try {
      const res = database.exec("SELECT name FROM sqlite_master WHERE type='table';");
      const tables: TableInfo[] = [];
      if (res.length > 0) {
        res[0].values.forEach((row: any) => {
          const tableName = row[0];
          const tableData = database.exec(`SELECT * FROM ${tableName} LIMIT 50;`);
          if (tableData.length > 0) {
            tables.push({ name: tableName, columns: tableData[0].columns, rows: tableData[0].values });
          } else {
            const schema = database.exec(`PRAGMA table_info(${tableName});`);
            tables.push({ name: tableName, columns: schema[0]?.values.map((v: any) => v[1]) || [], rows: [] });
          }
        });
      }
      setDbState(prev => ({ ...prev, tables }));
    } catch (e: any) { setDbState(prev => ({ ...prev, error: e.message })); }
  }, []);

  const executeSql = useCallback((sql: string) => {
    if (!db) return { error: "Database not initialized" };
    try {
      const data = db.exec(sql);
      refreshDbState(db);
      return { data };
    } catch (e: any) {
      return { error: e.message };
    }
  }, [db, refreshDbState]);

  const fetchExternalData = useCallback(async (url: string, method: string = 'GET') => {
    try {
      const response = await fetch(url, { method });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      return { data };
    } catch (e: any) { return { error: e.message }; }
  }, []);

  const recordGlobalState = useCallback((description: string, overrides: Partial<GlobalState> = {}) => {
    const next: GlobalState = {
      content: overrides.content !== undefined ? overrides.content : content,
      writerScript: overrides.writerScript !== undefined ? overrides.writerScript : writerScript,
      readerScript: overrides.readerScript !== undefined ? overrides.readerScript : readerScript,
      variables: overrides.variables !== undefined ? overrides.variables : variables,
      description,
      timestamp: Date.now()
    };

    setHistory(prev => [...prev, next]);
    return history.length;
  }, [content, writerScript, readerScript, variables, history.length]);

  const handleSync = useCallback(async (overridingScripts?: { writer?: string; reader?: string }) => {
    if (!db || dbState.isSyncing) return {};
    setDbState(prev => ({ ...prev, isSyncing: true, error: undefined }));

    try {
      if (overridingScripts?.writer) {
        console.log("Evaluating Writer Override:", overridingScripts.writer.substring(0, 50) + "...");
        if (!overridingScripts.writer.trim()) throw new Error("Writer script is empty");
        const writerRunner = (0, eval)(`(${overridingScripts.writer})`);
        if (typeof writerRunner === 'function') {
          await writerRunner({ db, fetchExternalData });
        } else {
          console.warn("Writer script did not evaluate to a function:", writerRunner);
        }
      } else if (writerScript && writerScript.trim()) {
        console.log("Evaluating Writer Default:", writerScript.substring(0, 50) + "...");
        const writerRunner = (0, eval)(`(${writerScript})`);
        if (typeof writerRunner === 'function') {
          await writerRunner({ db, fetchExternalData });
        }
      }

      const readerToRun = overridingScripts?.reader || readerScript;
      if (readerToRun && readerToRun.trim()) {
        const readerRunner = (0, eval)(`(${readerToRun})`);
        if (typeof readerRunner === 'function') {
          const newVars = await readerRunner({ db });
          if (newVars && typeof newVars === 'object') {
            setVariables(newVars);
          }
        } else {
          console.warn("Reader script did not evaluate to a function:", readerRunner);
        }
      }

      refreshDbState(db);
      return variables; // Return current variables if no update
    } catch (e: any) {
      console.error("Pipeline Error:", e);
      setDbState(prev => ({ ...prev, error: `Pipeline Error: ${e.message}` }));
      throw e;
    } finally {
      setDbState(prev => ({ ...prev, isSyncing: false }));
    }
  }, [db, writerScript, readerScript, fetchExternalData, refreshDbState, dbState.isSyncing]);

  const restoreCheckpoint = useCallback(async (index: number) => {
    if (index < 0 || index >= history.length) return;
    const checkpoint = history[index];

    setContent(checkpoint.content);
    setWriterScript(checkpoint.writerScript);
    setReaderScript(checkpoint.readerScript);
    setVariables(checkpoint.variables);

    setHistory(prev => prev.slice(0, index + 1));

    setMessages(prev => {
      const filtered = prev.filter(m => {
        if (m.role === 'system') return true;
        if (m.checkpointIndex !== undefined && m.checkpointIndex > index) return false;
        return m.timestamp <= checkpoint.timestamp;
      });
      return [...filtered, {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'system',
        content: `⏪ System: Restored workspace to: "${checkpoint.description}"`,
        timestamp: Date.now()
      }];
    });

    if (db) {
      setDbState(prev => ({ ...prev, isSyncing: true }));
      try {
        const writerRunner = (0, eval)(`(${checkpoint.writerScript})`);
        await writerRunner({ db, fetchExternalData });
        const readerRunner = (0, eval)(`(${checkpoint.readerScript})`);
        const newVars = await readerRunner({ db });
        if (newVars) setVariables(newVars);
        refreshDbState(db);
      } catch (e: any) {
        setDbState(prev => ({ ...prev, error: `Restore Sync Error: ${e.message}` }));
      } finally {
        setDbState(prev => ({ ...prev, isSyncing: false }));
      }
    }

    setViewMode('preview');
  }, [history, db, fetchExternalData, refreshDbState]);

  const clearDatabase = useCallback((targetDb: any) => {
    if (!targetDb) return;
    try {
      const res = targetDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';");
      if (res.length > 0) {
        res[0].values.forEach((row: any) => {
          targetDb.run(`DROP TABLE IF EXISTS "${row[0]}";`);
        });
      }
      refreshDbState(targetDb);
    } catch (e) {
      console.error("Failed to clear database:", e);
    }
  }, [refreshDbState]);

  const applyTemplate = async (templateId: string) => {
    setIsTemplateMenuOpen(false);
    if (!db) return;

    if (templateId === 'blank') {
      clearDatabase(db);
      setContent('');
      setVariables({});
      setMessages([]); // Clear chat for fresh start
      setWriterScript(DEFAULT_WRITER);
      setReaderScript(DEFAULT_READER);
      setShowWelcome(false);
      setViewMode('edit');
      recordGlobalState('Start Blank Note', { content: '', variables: {}, writerScript: DEFAULT_WRITER, readerScript: DEFAULT_READER });

      // Trigger sync for blank note to reset DB
      await handleSync({ writer: DEFAULT_WRITER, reader: DEFAULT_READER });
      return;
    }

    setIsTemplateLoading(true);
    setShowWelcome(false);
    setViewMode('preview');
    setMessages([]); // Clear chat for new template context
    clearDatabase(db);

    try {
      if (templateId === 'fpl_analysis') {
        const fWriter = `async ({ db, fetchExternalData }) => {
  // Using local Vite proxy configured in vite.config.ts
  const bootstrapRes = await fetchExternalData('/fpl/bootstrap-static/');
  const fixturesRes = await fetchExternalData('/fpl/fixtures/');
  
  if (!bootstrapRes.data || !fixturesRes.data) {
    const msg = bootstrapRes.error || fixturesRes.error || "Check network connection.";
    throw new Error("FPL API Failed: " + msg);
  }

  // Robust check for data validity - failures often return HTML or empty objects
  if (!bootstrapRes.data.teams || !Array.isArray(bootstrapRes.data.teams)) {
    throw new Error("FPL API returned invalid data (likely CORS or Rate Limit). Response: " + JSON.stringify(bootstrapRes.data).substring(0, 100));
  }

  const { teams, elements, events } = bootstrapRes.data;
  const fixtures = fixturesRes.data;
  const currentGw = events.find(e => e.is_current)?.id || 1;

  // Setup Tables
  db.run("DROP TABLE IF EXISTS fpl_teams;");
  db.run("CREATE TABLE fpl_teams (id INTEGER PRIMARY KEY, name TEXT, short_name TEXT, strength INTEGER);");
  teams.forEach(t => db.run("INSERT INTO fpl_teams VALUES (?, ?, ?, ?);", [t.id, t.name, t.short_name, t.strength]));

  db.run("DROP TABLE IF EXISTS fpl_players;");
  db.run("CREATE TABLE fpl_players (id INTEGER, name TEXT, team_id INTEGER, pos TEXT, cost REAL, points INTEGER, ppg REAL, form REAL, selected TEXT);");
  const posMap = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
  elements.forEach(e => {
    db.run("INSERT INTO fpl_players VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);", 
      [e.id, e.web_name, e.team, posMap[e.element_type], e.now_cost/10, e.total_points, parseFloat(e.points_per_game), parseFloat(e.form), e.selected_by_percent]
    );
  });

  db.run("DROP TABLE IF EXISTS fpl_fixtures;");
  db.run("CREATE TABLE fpl_fixtures (event INTEGER, home_team INTEGER, away_team INTEGER, home_diff INTEGER, away_diff INTEGER);");
  fixtures.filter(f => f.event !== null).forEach(f => {
    db.run("INSERT INTO fpl_fixtures VALUES (?, ?, ?, ?, ?);", [f.event, f.team_h, f.team_a, f.team_h_difficulty, f.team_a_difficulty]);
  });

  db.run("DROP TABLE IF EXISTS fpl_meta;");
  db.run("CREATE TABLE fpl_meta (key TEXT, value INTEGER);");
  db.run("INSERT INTO fpl_meta VALUES (?, ?);", ['current_gw', currentGw]);

  return "FPL Data Fully Hydrated (Players, Teams, Fixtures)";
}`;
        const fReader = `async ({ db }) => {
  const currentGwRes = db.exec("SELECT value FROM fpl_meta WHERE key='current_gw'");
  const currentGw = currentGwRes.length > 0 ? currentGwRes[0].values[0][0] : 1;

  // Analytical queries
  const topPlayers = db.exec(\`
    SELECT p.name, t.short_name as Team, p.pos as Pos, p.points as Pts, p.ppg as PPG, p.form as Form 
    FROM fpl_players p 
    JOIN fpl_teams t ON p.team_id = t.id 
    WHERE p.ppg > 0 
    ORDER BY p.form DESC, p.ppg DESC LIMIT 8;
  \`)[0];

  const difficulty = db.exec(\`
    SELECT t.name as Team, 
           ROUND(AVG(CASE WHEN f.home_team = t.id THEN f.home_diff ELSE f.away_diff END), 2) as "Avg FDR",
           GROUP_CONCAT(
             (CASE WHEN f.home_team = t.id THEN t_away.short_name || '(H)' ELSE t_home.short_name || '(A)' END),
             ' → '
           ) as Fixtures
    FROM fpl_teams t
    JOIN fpl_fixtures f ON f.home_team = t.id OR f.away_team = t.id
    JOIN fpl_teams t_home ON f.home_team = t_home.id
    JOIN fpl_teams t_away ON f.away_team = t_away.id
    WHERE f.event BETWEEN \${currentGw} AND \${currentGw + 2}
    GROUP BY t.id
    ORDER BY "Avg FDR" ASC LIMIT 10;
  \`)[0];

  // Logic for a "Best 11" recommendation
  const best11 = db.exec(\`
    WITH RankedPlayers AS (
      SELECT p.name, p.pos, p.points, p.ppg, p.form, p.cost, t.short_name,
             ROW_NUMBER() OVER(PARTITION BY p.pos ORDER BY (p.form * 0.6 + p.ppg * 0.4) DESC) as rank
      FROM fpl_players p
      JOIN fpl_teams t ON p.team_id = t.id
      WHERE p.ppg > 2.0
    )
    SELECT name as Player, pos as Pos, short_name as Team, cost as "£m", points as Pts, form as Form, ppg as PPG FROM RankedPlayers
    WHERE (pos = 'GKP' AND rank = 1)
       OR (pos = 'DEF' AND rank <= 4)
       OR (pos = 'MID' AND rank <= 4)
       OR (pos = 'FWD' AND rank <= 2)
    ORDER BY CASE WHEN pos='GKP' THEN 1 WHEN pos='DEF' THEN 2 WHEN pos='MID' THEN 3 ELSE 4 END;
  \`)[0];

  return {
    current_gw: String(currentGw),
    top_players_table: { columns: topPlayers.columns, values: topPlayers.values },
    fixture_difficulty: { columns: difficulty.columns, values: difficulty.values },
    best_11_table: { columns: best11.columns, values: best11.values }
  };
}`;
        await handleSync({ writer: fWriter, reader: fReader });
        const newContent = `# FPL Expert Analysis (GW {{current_gw}})

## Recommended Best 11
Selected based on current **Form** (60%) and **PPG** (40%).

{{best_11_table}}

---

## In-Form Players
Highest performing players across all teams.

{{top_players_table}}

---

## Softest Fixtures (Next 3 GWs)
Teams with the lowest average Fixture Difficulty Rating (FDR).

{{fixture_difficulty}}`;
        setContent(newContent);
        setWriterScript(fWriter);
        setReaderScript(fReader);
        recordGlobalState('Applied Improved FPL Template', { content: newContent, writerScript: fWriter, readerScript: fReader });
      }

      if (templateId === 'student_intelligence') {
        const sWriter = `async ({ db }) => {
  db.run("DROP TABLE IF EXISTS students;");
  db.run("CREATE TABLE students (name TEXT, grade INTEGER, major TEXT);");
  const data = [
    ['Alice', 92, 'CS'], ['Bob', 78, 'Physics'], ['Charlie', 88, 'Math'],
    ['Diana', 95, 'History'], ['Edward', 74, 'Psych']
  ];
  data.forEach(d => db.run("INSERT INTO students VALUES (?, ?, ?);", d));
  return "Student records seeded locally.";
}`;
        const sReader = `async ({ db }) => {
  const count = db.exec("SELECT COUNT(*) FROM students;")[0].values[0][0];
  const avg = db.exec("SELECT ROUND(AVG(grade), 1) FROM students;")[0].values[0][0];
  const table = db.exec("SELECT name as Student, grade as Grade, major as Major FROM students ORDER BY grade DESC;")[0];
  return {
    student_count: String(count),
    average_grade: String(avg),
    student_table: { columns: table.columns, values: table.values }
  };
}`;
        await handleSync({ writer: sWriter, reader: sReader });
        const newContent = `# Student Intelligence Report\nTotal Enrolled: **{{student_count}}**\nAverage Grade: **{{average_grade}}%**\n\n### Academic Records\n{{student_table}}`;
        setContent(newContent);
        setWriterScript(sWriter);
        setReaderScript(sReader);
        recordGlobalState('Applied Student Template', { content: newContent, writerScript: sWriter, readerScript: sReader });
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, role: 'system', content: '❌ Template Error: ' + e.message, timestamp: Date.now() }]);
    } finally {
      setIsTemplateLoading(false);
    }
  };

  const processedContent = useMemo(() => {
    let result = content;
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      if (typeof value === 'string') {
        result = result.replace(regex, value);
      } else {
        const table = value as TableData;
        const mdTable = [
          `| ${table.columns.join(' | ')} |`,
          `| ${table.columns.map(() => '---').join(' | ')} |`,
          ...table.values.map(row => `| ${row.map(cell => String(cell)).join(' | ')} |`)
        ].join('\n');
        result = result.replace(regex, mdTable);
      }
    });
    return result;
  }, [content, variables]);

  const dbSchemaString = useMemo(() => {
    if (!db) return "";
    try {
      const res = db.exec("SELECT sql FROM sqlite_master WHERE type='table';");
      return res[0]?.values.map((v: any) => v[0]).join("\n") || "";
    } catch { return ""; }
  }, [db, dbState]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--bg-primary', currentTheme.bgPrimary);
    root.style.setProperty('--bg-secondary', currentTheme.bgSecondary);
    root.style.setProperty('--border-primary', currentTheme.borderPrimary);
    root.style.setProperty('--accent-primary', currentTheme.accentPrimary);
    root.style.setProperty('--text-primary', currentTheme.textPrimary);
    root.style.setProperty('--text-secondary', currentTheme.textSecondary);
    root.style.setProperty('--text-headers', currentTheme.textHeaders);
  }, [currentTheme]);

  const handleUpdateDocument = useCallback((newContent: string, reason: string) => {
    setContent(newContent); setShowWelcome(false); setViewMode('preview');
  }, []);

  const contentDiff = useMemo(() => {
    const old = history.length > 1 ? history[history.length - 2].content : '';
    return getDiff(old, content);
  }, [content, history]);

  const writerDiff = useMemo(() => {
    const old = history.length > 1 ? history[history.length - 2].writerScript : '';
    return getDiff(old, writerScript);
  }, [writerScript, history]);

  const readerDiff = useMemo(() => {
    const old = history.length > 1 ? history[history.length - 2].readerScript : '';
    return getDiff(old, readerScript);
  }, [readerScript, history]);

  const renderedMarkdown = useMemo(() => { try { return marked.parse(processedContent); } catch (e) { return processedContent; } }, [processedContent]);

  const handleExport = useCallback(() => {
    if (!processedContent.trim()) return;
    const blob = new Blob([processedContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setIsExportMenuOpen(false);
  }, [processedContent]);

  const handleExportFull = useCallback(() => {
    const data = {
      version: '1.0',
      content,
      writerScript,
      readerScript,
      timestamp: Date.now()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setIsExportMenuOpen(false);
  }, [content, writerScript, readerScript]);

  const handleImportFull = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (json.content !== undefined && json.writerScript && json.readerScript) {
          clearDatabase(db);
          setContent(json.content);
          setWriterScript(json.writerScript);
          setReaderScript(json.readerScript);
          setShowWelcome(false);
          setViewMode('preview');
          setIsTemplateLoading(true);

          // Force a sync to hydrate DB with new scripts
          try {
            await handleSync({ writer: json.writerScript, reader: json.readerScript });
          } catch (syncErr: any) {
            setMessages(prev => [...prev, { id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, role: 'system', content: '❌ Import Sync Error: ' + syncErr.message, timestamp: Date.now() }]);
          } finally {
            setIsTemplateLoading(false);
          }

          setMessages([]); // Clear chat for imported template
          recordGlobalState('Imported Full Template');
        } else {
          throw new Error("Invalid template format");
        }
      } catch (err: any) {
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: '❌ Import Error: ' + err.message, timestamp: Date.now() }]);
      }
    };
    reader.readAsText(file);
    setIsExportMenuOpen(false);
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handleSync, recordGlobalState]);

  const handleExportPdf = useCallback(() => {
    setIsExportMenuOpen(false);
    window.print();
  }, []);

  return (
    <div className={`flex h-screen w-full text-theme-main overflow-hidden`} style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div id="main-view" className={`flex flex-col flex-1 min-w-0 transition-all duration-300 relative`}>
        <header className="h-14 border-b flex items-center justify-between px-3 sm:px-4 z-20 shrink-0" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="w-8 h-8 border rounded-lg flex items-center justify-center shadow-lg shrink-0" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
                <svg className="w-5 h-5 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
              <span className="font-bold text-sm sm:text-base tracking-tight hidden xs:inline-block">thinkNotes</span>
            </div>

            <div className="relative shrink-0" ref={templateMenuRef}>
              <button onClick={() => setIsTemplateMenuOpen(!isTemplateMenuOpen)} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[10px] sm:text-xs font-bold transition-all hover:bg-white/5" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}>
                <span className="hidden sm:inline">Templates</span>
                <span className="sm:hidden">New</span>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
              {isTemplateMenuOpen && (
                <div className="absolute left-0 mt-2 w-64 rounded-xl border shadow-2xl z-50 overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)', backdropFilter: 'blur(8px)' }}>
                  {TEMPLATES.map(t => (
                    <button key={t.id} onClick={() => applyTemplate(t.id)} className="w-full text-left p-3 hover:bg-white/5 border-b last:border-0" style={{ borderColor: 'var(--border-primary)' }}>
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{t.icon}</span>
                        <div><p className="text-xs font-bold text-white">{t.name}</p><p className="text-[10px] text-theme-muted">{t.description}</p></div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {(!isEmpty || !showWelcome) && (
              <div className="flex gap-1 p-0.5 rounded-lg border overflow-x-auto scrollbar-none whitespace-nowrap hide-scrollbar" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
                {['Preview', 'Edit', 'Edit_Diff', 'DB', 'API', 'API_Diff'].map((m) => {
                  const val = m.toLowerCase() as ViewMode;
                  const active = viewMode === val;
                  if (val === 'api_diff' && history.length < 2) return null;
                  if (val === 'edit_diff' && history.length < 2) return null;

                  const advancedTabs = ['edit_diff', 'db', 'api', 'api_diff'];
                  if (!isAdvancedMode && advancedTabs.includes(val)) return null;

                  return (
                    <button key={m} onClick={() => setViewMode(val)} className={`px-2.5 py-1 rounded-md text-[10px] sm:text-xs font-medium shrink-0 ${active ? 'text-white' : ''}`}
                      style={{ backgroundColor: active ? 'var(--border-primary)' : 'transparent', color: active ? '#ffffff' : 'var(--text-secondary)' }}
                    >{m.replace('_', ' ')}</button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 sm:gap-3 ml-2">
            <button
              onClick={() => handleSync()}
              disabled={dbState.isSyncing}
              title="Sync Data"
              className={`p-1.5 sm:p-2 rounded-lg border transition-all ${dbState.isSyncing ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/5'}`}
              style={{
                borderColor: 'var(--border-primary)',
                backgroundColor: 'var(--bg-primary)',
                color: dbState.isSyncing ? 'var(--accent-primary)' : 'var(--text-secondary)'
              }}
            >
              <svg className={`w-4 h-4 ${dbState.isSyncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              onClick={() => setIsAdvancedMode(!isAdvancedMode)}
              title={isAdvancedMode ? "Disable Advanced Mode" : "Enable Advanced Mode"}
              className={`p-1.5 sm:p-2 rounded-lg border transition-all ${isAdvancedMode ? 'bg-indigo-900/20 border-indigo-500/50' : 'hover:bg-white/5'}`}
              style={{
                borderColor: isAdvancedMode ? 'var(--accent-primary)' : 'var(--border-primary)',
                backgroundColor: isAdvancedMode ? 'transparent' : 'var(--bg-primary)',
                color: isAdvancedMode ? 'var(--accent-primary)' : 'var(--text-secondary)'
              }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </button>
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                title="Export Document"
                className={`p-1.5 sm:p-2 rounded-lg border transition-all ${isExportMenuOpen ? 'bg-indigo-900/20 border-indigo-500/50' : 'hover:bg-white/5'}`}
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}
              >
                <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M7 10l5 5m0 0l5-5m-5 5V3" /></svg>
              </button>
              {isExportMenuOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-xl border shadow-2xl z-50 overflow-hidden no-print" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)', backdropFilter: 'blur(8px)' }}>
                  <button onClick={handleExport} className="w-full text-left p-3 hover:bg-white/5 border-b flex items-center gap-3 transition-colors" style={{ borderColor: 'var(--border-primary)' }}>
                    <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    <span className="text-xs font-bold text-white">Markdown (.md)</span>
                  </button>
                  <button onClick={handleExportFull} className="w-full text-left p-3 hover:bg-white/5 border-b flex items-center gap-3 transition-colors" style={{ borderColor: 'var(--border-primary)' }}>
                    <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                    <span className="text-xs font-bold text-white">Export Full (.json)</span>
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} className="w-full text-left p-3 hover:bg-white/5 border-b flex items-center gap-3 transition-colors" style={{ borderColor: 'var(--border-primary)' }}>
                    <svg className="w-4 h-4 text-fuchsia-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M7 10l5-5m0 0l5 5m-5-5v12" /></svg>
                    <span className="text-xs font-bold text-white">Import Full (.json)</span>
                  </button>
                  <button onClick={handleExportPdf} className="w-full text-left p-3 hover:bg-white/5 flex items-center gap-3 transition-colors">
                    <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                    <span className="text-xs font-bold text-white">PDF (via Print)</span>
                  </button>
                </div>
              )}
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImportFull}
              accept=".json"
              className="hidden"
            />
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className={`p-1.5 sm:p-2 rounded-lg transition-all ${isSidebarOpen ? 'bg-indigo-900/20' : 'hover:bg-white/5'}`} style={{ color: isSidebarOpen ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
            </button>
          </div>
        </header>

        <main className={`flex-1 relative flex overflow-hidden`} style={{ backgroundColor: 'var(--bg-primary)' }}>
          {isTemplateLoading && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="w-12 h-12 border-4 border-t-indigo-500 border-white/10 rounded-full animate-spin"></div>
                <p className="text-xs font-bold text-white uppercase tracking-widest px-4">Orchestrating Assistant...</p>
              </div>
            </div>
          )}

          {isEmpty && showWelcome ? (
            <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 text-center animate-in fade-in zoom-in duration-500 overflow-y-auto">
              <div className="max-w-md w-full space-y-6 sm:space-y-8">
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-indigo-500/10 rounded-3xl flex items-center justify-center mx-auto border border-indigo-500/20">
                  <svg className="w-8 h-8 sm:w-10 sm:h-10 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
                <div className="space-y-2 sm:space-y-3 px-2">
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">thinkNotes</h1>
                  <p className="text-xs sm:text-sm text-theme-muted leading-relaxed">A powerful markdown workspace where an intelligent assistant manages data, research, and document transformation via agentic pipelines.</p>
                </div>
                <div className="grid grid-cols-1 xs:grid-cols-2 gap-3 sm:gap-4 px-2">
                  {TEMPLATES.filter(t => t.id !== 'blank').map(t => (
                    <button key={t.id} onClick={() => applyTemplate(t.id)} className="p-3 sm:p-4 rounded-2xl border text-left hover:border-indigo-500/50 hover:bg-white/5 transition-all group" style={{ borderColor: 'var(--border-primary)' }}>
                      <span className="text-xl sm:text-2xl mb-2 sm:mb-3 block group-hover:scale-110 transition-transform">{t.icon}</span>
                      <p className="text-xs sm:text-sm font-bold text-white mb-0.5 sm:mb-1">{t.name}</p>
                      <p className="text-[9px] sm:text-[10px] text-theme-muted">{t.description}</p>
                    </button>
                  ))}
                </div>
                <button onClick={() => applyTemplate('blank')} className="text-[10px] sm:text-xs font-bold text-indigo-500 hover:text-indigo-400 underline underline-offset-4">Start with a blank note</button>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-hidden relative">
              {viewMode === 'preview' && (
                <div className="h-full overflow-y-auto p-4 xs:p-8 sm:p-12 max-w-4xl mx-auto">
                  <div className="markdown-body animate-in fade-in slide-in-from-bottom-4 duration-500" dangerouslySetInnerHTML={{ __html: renderedMarkdown }} />
                </div>
              )}
              {viewMode === 'edit' && (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onBlur={() => recordGlobalState('Manual Edit')}
                  className="w-full h-full p-4 xs:p-8 sm:p-12 font-mono text-xs sm:text-sm resize-none bg-transparent focus:outline-none leading-relaxed"
                  placeholder="# Start typing your document..."
                  style={{ color: 'var(--text-primary)' }}
                />
              )}
              {viewMode === 'edit_diff' && (
                <div className="h-full overflow-y-auto p-4 xs:p-8 sm:p-12 max-w-4xl mx-auto animate-in fade-in duration-300">
                  <h3 className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-indigo-400 mb-4 sm:mb-6">Transformation Diff</h3>
                  <div className="border rounded-2xl p-4 sm:p-6 font-mono text-[10px] sm:text-sm space-y-0.5 shadow-xl leading-relaxed" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
                    {contentDiff.map((l, idx) => (
                      <div key={idx} className={`whitespace-pre-wrap ${l.type === 'added' ? 'bg-emerald-500/20 text-emerald-400' : l.type === 'removed' ? 'bg-rose-500/20 text-rose-400' : 'text-theme-muted'}`}>
                        <span className="inline-block w-4 mr-2 opacity-50">{l.type === 'added' ? '+' : l.type === 'removed' ? '-' : ' '}</span>
                        {l.content}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {viewMode === 'db' && (
                <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6 sm:space-y-8 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] sm:text-sm font-bold uppercase tracking-widest text-indigo-400">Database Inspector</h3>
                    {dbState.isSyncing && <div className="flex items-center gap-2 text-[8px] sm:text-[10px] font-bold text-indigo-500 animate-pulse uppercase">Syncing...</div>}
                  </div>
                  {dbState.tables.length === 0 ? (
                    <div className="border border-dashed rounded-2xl p-8 sm:p-12 text-center" style={{ borderColor: 'var(--border-primary)' }}>
                      <p className="text-[10px] sm:text-xs text-theme-muted">No tables found. Ask the Assistant to hydrate data.</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {dbState.tables.map(table => (
                        <div key={table.name} className="border rounded-xl overflow-hidden shadow-xl" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
                          <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-primary)' }}>
                            <span className="text-[10px] sm:text-xs font-bold font-mono text-indigo-400">{table.name}</span>
                            <span className="text-[8px] sm:text-[10px] text-theme-muted">{table.rows.length} rows</span>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-[9px] sm:text-[11px] border-collapse">
                              <thead>
                                <tr className="border-b" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}>
                                  {table.columns.map(c => <th key={c} className="px-3 py-2 font-bold text-white whitespace-nowrap">{c}</th>)}
                                </tr>
                              </thead>
                              <tbody>
                                {table.rows.map((row, i) => (
                                  <tr key={i} className="border-b last:border-0 hover:bg-white/5" style={{ borderColor: 'var(--border-primary)' }}>
                                    {row.map((cell, j) => <td key={j} className="px-3 py-2 text-theme-muted whitespace-nowrap">{String(cell)}</td>)}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {viewMode === 'api' && (
                <div className="h-full overflow-hidden flex flex-col p-4 sm:p-6 animate-in fade-in duration-300">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 h-full overflow-y-auto sm:overflow-hidden">
                    <div className="flex flex-col h-[300px] sm:h-full border rounded-2xl overflow-hidden shadow-2xl shrink-0" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
                      <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-primary)' }}>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Writer (Async)</span>
                      </div>
                      <textarea value={writerScript} onChange={(e) => setWriterScript(e.target.value)} onBlur={() => recordGlobalState('Script Update')} className="flex-1 bg-transparent p-4 font-mono text-[10px] sm:text-[11px] text-indigo-300 focus:outline-none leading-relaxed resize-none" />
                    </div>
                    <div className="flex flex-col h-[300px] sm:h-full border rounded-2xl overflow-hidden shadow-2xl shrink-0" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
                      <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-primary)' }}>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Reader (Async)</span>
                      </div>
                      <textarea value={readerScript} onChange={(e) => setReaderScript(e.target.value)} onBlur={() => recordGlobalState('Script Update')} className="flex-1 bg-transparent p-4 font-mono text-[10px] sm:text-[11px] text-emerald-300 focus:outline-none leading-relaxed resize-none" />
                    </div>
                  </div>
                </div>
              )}
              {viewMode === 'api_diff' && (
                <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6 sm:space-y-8 animate-in fade-in duration-300">
                  <div className="space-y-4">
                    <h3 className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-indigo-400">Writer Diff</h3>
                    <div className="border rounded-2xl p-4 font-mono text-[9px] sm:text-[11px] space-y-0.5 shadow-xl" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
                      {writerDiff.map((l, idx) => (
                        <div key={idx} className={`${l.type === 'added' ? 'bg-emerald-500/20 text-emerald-400' : l.type === 'removed' ? 'bg-rose-500/20 text-rose-400' : 'text-theme-muted'}`}>
                          <span className="inline-block w-4 mr-1 sm:mr-2">{l.type === 'added' ? '+' : l.type === 'removed' ? '-' : ' '}</span>
                          {l.content}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-emerald-400">Reader Diff</h3>
                    <div className="border rounded-2xl p-4 font-mono text-[9px] sm:text-[11px] space-y-0.5 shadow-xl" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
                      {readerDiff.map((l, idx) => (
                        <div key={idx} className={`${l.type === 'added' ? 'bg-emerald-500/20 text-emerald-400' : l.type === 'removed' ? 'bg-rose-500/20 text-rose-400' : 'text-theme-muted'}`}>
                          <span className="inline-block w-4 mr-1 sm:mr-2">{l.type === 'added' ? '+' : l.type === 'removed' ? '-' : ' '}</span>
                          {l.content}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      <div
        className={`fixed inset-0 z-40 lg:hidden transition-opacity duration-300 ${isSidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsSidebarOpen(false)}
        style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      />

      <aside
        className={`fixed top-0 right-0 h-full z-50 transition-transform duration-300 transform lg:static lg:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : 'translate-x-full'} flex flex-col shrink-0 overflow-hidden shadow-2xl lg:shadow-none`}
        style={{
          width: 'min(90%, 420px)',
          backgroundColor: 'var(--bg-secondary)',
          borderColor: 'var(--border-primary)',
          borderLeftWidth: '1px'
        }}
      >
        <ChatPanel
          editorContent={content}
          messages={messages}
          setMessages={setMessages}
          onUpdateDocument={handleUpdateDocument}
          restoreCheckpoint={restoreCheckpoint}
          dbSchema={dbSchemaString}
          executeSql={executeSql}
          fetchExternalData={fetchExternalData}
          variables={variables}
          setAllVariables={setVariables}
          writerScript={writerScript}
          setWriterScript={setWriterScript}
          readerScript={readerScript}
          setReaderScript={setReaderScript}
          handleSync={handleSync}
          recordGlobalState={recordGlobalState}
          onCloseMobile={() => setIsSidebarOpen(false)}
        />
      </aside>
    </div>
  );
};

export default App;
