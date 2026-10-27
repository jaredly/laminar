import { readFileSync, existsSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';

const LCOV_FILE = process.env.LCOV_PATH || 'coverage/lcov.info';
const ROOT_DIR = process.cwd();

interface LineCoverage {
    [lineNum: number]: number; // line number -> hit count
}

interface FileCoverage {
    path: string;
    lines: LineCoverage;
    found: number;
    hit: number;
}

// 1. Parse LCOV file
function parseLcov(lcovPath: string): Record<string, FileCoverage> {
    if (!existsSync(lcovPath)) {
        console.error(`LCOV file not found at: ${lcovPath}`);
        process.exit(1);
    }

    const content = readFileSync(lcovPath, 'utf-8');
    const files: Record<string, FileCoverage> = {};
    let currentFile: FileCoverage | null = null;

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('SF:')) {
            const filePath = relative(ROOT_DIR, trimmed.slice(3));
            currentFile = { path: filePath, lines: {}, found: 0, hit: 0 };
            files[filePath] = currentFile;
        } else if (trimmed.startsWith('DA:') && currentFile) {
            const [lineNum, hitCount] = trimmed.slice(3).split(',').map(Number);
            currentFile.lines[lineNum] = hitCount;
        } else if (trimmed.startsWith('LF:') && currentFile) {
            currentFile.found = parseInt(trimmed.slice(3), 10);
        } else if (trimmed.startsWith('LH:') && currentFile) {
            currentFile.hit = parseInt(trimmed.slice(3), 10);
        } else if (trimmed === 'end_of_record') {
            currentFile = null;
        }
    }

    return files;
}

// 2. Build Directory Tree
interface TreeNode {
    name: string;
    path: string;
    isDir: boolean;
    children?: Record<string, TreeNode>;
    coverage?: FileCoverage;
    totalFound: number;
    totalHit: number;
}

function buildTree(files: Record<string, FileCoverage>): TreeNode {
    const root: TreeNode = {
        name: 'root',
        path: '',
        isDir: true,
        children: {},
        totalFound: 0,
        totalHit: 0,
    };

    for (const [filePath, cov] of Object.entries(files)) {
        const parts = filePath.split('/');
        let current = root;
        current.totalFound += cov.found;
        current.totalHit += cov.hit;

        let currentPath = '';

        parts.forEach((part, index) => {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            const isLast = index === parts.length - 1;

            if (!current.children) current.children = {};

            if (!current.children[part]) {
                current.children[part] = {
                    name: part,
                    path: currentPath,
                    isDir: !isLast,
                    children: isLast ? undefined : {},
                    coverage: isLast ? cov : undefined,
                    totalFound: 0,
                    totalHit: 0,
                };
            }

            const node = current.children[part];
            if (!isLast) {
                node.totalFound += cov.found;
                node.totalHit += cov.hit;
            }
            current = node;
        });
    }

    return root;
}

// Helper: Calculate Coverage Percentage
function getPct(hit: number, found: number): string {
    if (found === 0) return '--%';
    return `${Math.round((hit / found) * 100)}%`;
}

function getBadgeColor(hit: number, found: number): string {
    if (found === 0) return '#10b981';
    const pct = (hit / found) * 100;
    if (pct >= 80) return '#10b981'; // Green
    if (pct >= 50) return '#f59e0b'; // Yellow
    return '#ef4444'; // Red
}

// 3. Render HTML Components
function renderSidebar(
    coverageData: Record<string, FileCoverage>,
    node: TreeNode,
    activePath: string,
): string {
    if (!node.children) return '';

    const sortedKeys = Object.keys(node.children).sort((a, b) => {
        const nodeA = node.children![a];
        const nodeB = node.children![b];
        if (nodeA.isDir && !nodeB.isDir) return -1;
        if (!nodeA.isDir && nodeB.isDir) return 1;
        return a.localeCompare(b);
    });

    let html = `<ul style="list-style: none; padding-left: 14px; margin: 4px 0;">`;
    for (const key of sortedKeys) {
        const child = node.children[key];
        const isActive = child.path === activePath;
        const badgeColor =
            child.totalFound === 0 && coverageData[child.path]
                ? getBadgeColor(coverageData[child.path].hit, coverageData[child.path].found)
                : getBadgeColor(child.totalHit, child.totalFound);
        const pct =
            child.totalFound === 0 && coverageData[child.path]
                ? getPct(coverageData[child.path].hit, coverageData[child.path].found)
                : getPct(child.totalHit, child.totalFound);

        html += `<li style="margin: 3px 0;">`;
        if (child.isDir) {
            html += `
        <details open>
          <summary style="cursor: pointer; font-weight: 600; color: #e2e8f0;">
            📁 ${child.name}
            <span style="float: right; font-size: 11px; background: ${badgeColor}; color: #fff; padding: 1px 6px; border-radius: 10px;">${pct}</span>
          </summary>
          ${renderSidebar(coverageData, child, activePath)}
        </details>`;
        } else {
            html += `
        <a href="/file?path=${encodeURIComponent(child.path)}"
           style="text-decoration: none; color: ${isActive ? '#38bdf8' : '#94a3b8'}; font-weight: ${isActive ? 'bold' : 'normal'}; display: flex; justify-content: space-between; align-items: center; padding: 2px 4px; border-radius: 4px; background: ${isActive ? '#1e293b' : 'transparent'};">
          <span>📄 ${child.name}</span>
          <span style="font-size: 11px; background: ${badgeColor}; color: #fff; padding: 1px 6px; border-radius: 10px;">${pct}</span>
        </a>`;
        }
        html += `</li>`;
    }
    html += `</ul>`;
    return html;
}

function renderFileView(coverageData: Record<string, FileCoverage>, filePath: string): string {
    const fileCov = coverageData[filePath];
    const absolutePath = join(ROOT_DIR, filePath);

    if (!existsSync(absolutePath)) {
        return `<div style="padding: 20px; color: #ef4444;">Source file not found on disk: <code>${filePath}</code></div>`;
    }

    const fileContent = readFileSync(absolutePath, 'utf-8');
    const lines = fileContent.split('\n');
    const ext = filePath.split('.').pop() || 'js';

    let linesHtml = '';
    lines.forEach((lineText, index) => {
        const lineNum = index + 1;
        const hitCount = fileCov?.lines[lineNum];
        const isTracked = hitCount !== undefined;
        const isCovered = isTracked && hitCount > 0;
        const isUncovered = isTracked && hitCount === 0;

        let bgColor = 'transparent';
        let statusText = '';

        if (isCovered) {
            bgColor = 'rgba(16, 185, 129, 0.15)';
            statusText = `${hitCount}x`;
        } else if (isUncovered) {
            bgColor = 'rgba(239, 68, 68, 0.25)';
            statusText = '0x';
        }

        const escapedLine = lineText
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        linesHtml += `
      <tr style="background-color: ${bgColor};">
        <td style="width: 40px; text-align: right; color: #64748b; padding-right: 10px; user-select: none; border-right: 1px solid #334155;">${lineNum}</td>
        <td style="width: 40px; text-align: right; color: ${isUncovered ? '#ef4444' : '#10b981'}; font-size: 11px; padding-right: 10px; user-select: none; border-right: 1px solid #334155;">${statusText}</td>
        <td style="padding-left: 10px; white-space: pre; font-family: monospace;"><code class="language-${ext}">${escapedLine}</code></td>
      </tr>`;
    });

    return `
    <div style="padding: 10px; background: #0f172a; border-bottom: 1px solid #334155; color: #f8fafc; font-family: monospace;">
      <strong>${filePath}</strong> —
      Coverage: <span style="color: ${getBadgeColor(fileCov?.hit || 0, fileCov?.found || 0)}">${getPct(fileCov?.hit || 0, fileCov?.found || 0)}</span>
      (${fileCov?.hit || 0}/${fileCov?.found || 0} lines)
    </div>
    <div style="overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse; font-family: Consolas, Monaco, 'Andale Mono', monospace; font-size: 13px; line-height: 1.5;">
        <tbody>
          ${linesHtml}
        </tbody>
      </table>
    </div>`;
}

// 4. Main HTML Template
function layout(sidebarHtml: string, contentHtml: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>LCOV Coverage Viewer</title>
  <!-- PrismJS syntax highlighting theme -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #020617; color: #f8fafc; height: 100vh; display: flex; flex-direction: column; }
    header { background: #0f172a; padding: 12px 20px; border-bottom: 1px solid #1e293b; font-weight: bold; font-size: 18px; }
    .container { display: flex; flex: 1; overflow: hidden; }
    sidebar { width: 320px; background: #0f172a; border-right: 1px solid #1e293b; padding: 15px; overflow-y: auto; font-size: 14px; }
    main { flex: 1; overflow-y: auto; background: #020617; }
    summary::-webkit-details-marker { color: #64748b; }
    td code {
        white-space: pre !important;
        tab-size: 2;
        -moz-tab-size: 2;
        font-family: inherit;
        display: inline-block;
      }
  </style>
</head>
<body>
  <header>📊 LCOV Coverage Explorer</header>
  <div class="container">
    <sidebar>${sidebarHtml}</sidebar>
    <main>${contentHtml}</main>
  </div>
  <!-- PrismJS Library -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>
</body>
</html>`;
}

// 5. Bun HTTP Server
const PORT = Number(process.env.PORT) || 3000;

let cache: null | {
    coverageData: Record<string, FileCoverage>;
    fileTree: TreeNode;
    mtime: number;
} = null;

const getData = () => {
    const mtime = statSync(LCOV_FILE).mtimeMs;
    if (!cache || cache.mtime < mtime) {
        console.log('Reprocessing coverage');
        const coverageData = parseLcov(LCOV_FILE);
        const fileTree = buildTree(coverageData);
        cache = { coverageData, fileTree, mtime };
    }
    return cache!;
};

{
    Bun.serve({
        port: PORT,
        fetch(req) {
            const url = new URL(req.url);
            const { fileTree, coverageData } = getData();

            if (url.pathname === '/') {
                const sidebar = renderSidebar(coverageData, fileTree, '');
                const emptyState = `<div style="padding: 40px; text-align: center; color: #64748b;">Select a file from the sidebar to view code coverage highlights.</div>`;
                return new Response(layout(sidebar, emptyState), {
                    headers: { 'Content-Type': 'text/html' },
                });
            }

            if (url.pathname === '/file') {
                const filePath = url.searchParams.get('path') || '';
                const sidebar = renderSidebar(coverageData, fileTree, filePath);
                const fileView = renderFileView(coverageData, filePath);
                return new Response(layout(sidebar, fileView), {
                    headers: { 'Content-Type': 'text/html' },
                });
            }

            return new Response('Not Found', { status: 404 });
        },
    });
}

console.log(`🚀 Coverage server running at http://localhost:${PORT}`);
