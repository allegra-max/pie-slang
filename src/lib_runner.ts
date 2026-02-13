import * as fs from 'fs';
import * as path from 'path';
import { evaluatePie } from './pie_interpreter/main.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIB_FILES = [
    'nat.pie',
    'pair.pie',
    'list.pie',
    'vec.pie'
];

export function getLibraryCode(): string {
    let combinedCode = '';
    // Resolve lib directory relative to CWD or __dirname
    let libDir = path.join(__dirname, 'lib');
    if (!fs.existsSync(libDir)) {
        libDir = path.join(process.cwd(), 'src', 'lib');
    }

    for (const file of LIB_FILES) {
        const filePath = path.join(libDir, file);
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            // Strip #lang lines and append
            const cleanContent = content.split('\n')
                .filter(line => !line.trim().startsWith('#lang'))
                .join('\n');
            combinedCode += `\n;;; --- Begin ${file} ---\n`;
            combinedCode += cleanContent;
            combinedCode += `\n;;; --- End ${file} ---\n`;
        } catch (error) {
            console.error(`Error reading library file ${file}:`, error);
            throw error;
        }
    }
    return combinedCode;
}

export function runWithLib(userCode: string): string {
    const libCode = getLibraryCode();
    // Strip #lang from user code too just in case
    const cleanUserCode = userCode.split('\n')
        .filter(line => !line.trim().startsWith('#lang'))
        .join('\n');

    return evaluatePie(libCode + '\n' + cleanUserCode);
}
