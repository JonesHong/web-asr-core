import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 遞迴處理目錄中的所有 .js 文件
function processDirectory(dirPath) {
    const files = fs.readdirSync(dirPath);
    
    files.forEach(file => {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            processDirectory(filePath);
        } else if (file.endsWith('.js')) {
            fixImports(filePath);
        }
    });
}

// 修復單個文件的導入
function fixImports(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    
    // 修復相對路徑導入（添加 .js 擴展名）
    content = content.replace(
        /from\s+['"](\.[^'"]+)(?<!\.js)['"];?/g,
        (match, importPath) => {
            modified = true;
            return `from '${importPath}.js';`;
        }
    );
    
    // 修復動態導入
    content = content.replace(
        /import\(['"](\.[^'"]+)(?<!\.js)['"]\)/g,
        (match, importPath) => {
            modified = true;
            return `import('${importPath}.js')`;
        }
    );
    
    if (modified) {
        fs.writeFileSync(filePath, content);
        console.log(`Fixed imports in: ${filePath}`);
    }
}

// 開始處理
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
    console.log('Fixing imports in dist folder...');
    processDirectory(distPath);
    console.log('Import fixes complete!');
} else {
    console.log('dist folder not found. Run tsc first.');
}