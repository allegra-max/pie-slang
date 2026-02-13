import * as fs from 'fs';
import * as path from 'path';
import { evaluatePie } from './pie_interpreter/main';

const libDir = path.join(process.cwd(), 'src', 'lib');

function checkFile(filePath: string) {
    console.log(`Checking ${path.basename(filePath)}...`);
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        // Remove #lang line if present
        const lines = content.split('\n');
        const cleanContent = lines.filter(line => !line.trim().startsWith('#lang')).join('\n');

        evaluatePie(cleanContent);
        console.log(`✅ ${path.basename(filePath)} passed.`);
    } catch (e: any) {
        console.error(`❌ ${path.basename(filePath)} failed:`);
        console.error(e.message);
        process.exitCode = 1;
    }
}

try {
    if (!fs.existsSync(libDir)) {
        console.error(`Directory not found: ${libDir}`);
        process.exit(1);
    }
    const files = fs.readdirSync(libDir).filter(f => f.endsWith('.pie'));
    if (files.length === 0) {
        console.log("No .pie files found in src/lib");
    } else {
        files.forEach(file => checkFile(path.join(libDir, file)));
    }
} catch (e) {
    console.error("Error reading directory or files:", e);
    process.exit(1);
}
