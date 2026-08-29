'use strict';

const fs = require('fs');

const routeDir = __dirname;
const excludedModules = new Set(['forest-classification.routes.js']);
const floodModelPattern = /flood|simulation|scenario|trend|model/i;
const declarationPattern = /(router|adminRouter|publicRouter|deviceRouter)\.(get|post|put|patch|delete)\s*\(/;

function declarations(fileName) {
    const source = fs.readFileSync(`${routeDir}/${fileName}`, 'utf8');
    return source.split(/\r?\n/).filter((line) => declarationPattern.test(line));
}

describe('Server route scope inventory', () => {
    test('includes every non-forest route module and marks forest classification excluded', () => {
        const modules = fs.readdirSync(routeDir).filter((name) => name.endsWith('.routes.js'));
        expect(modules).toContain('auth.routes.js');
        expect(modules).toContain('cms.routes.js');
        expect(modules).toContain('forest-classification.routes.js');
        expect(excludedModules.has('forest-classification.routes.js')).toBe(true);
    });

    test('has a declaration inventory and excludes flood model declarations', () => {
        const modules = fs.readdirSync(routeDir).filter((name) => name.endsWith('.routes.js'));
        const rows = modules.flatMap((module) => declarations(module).map((declaration) => ({ module, declaration })));
        const inScope = rows.filter(({ module, declaration }) => module !== 'forest-classification.routes.js' && !floodModelPattern.test(declaration));
        const excluded = rows.filter(({ module, declaration }) => module === 'forest-classification.routes.js' || floodModelPattern.test(declaration));
        expect(rows.length).toBeGreaterThan(150);
        expect(inScope.length).toBeGreaterThan(150);
        expect(excluded.length).toBeGreaterThan(0);
        expect(inScope.some(({ module }) => module === 'user.routes.js')).toBe(true);
        expect(inScope.some(({ module }) => module === 'cms.routes.js')).toBe(true);
        expect(inScope.some(({ module }) => module === 'remote-sensing.routes.js')).toBe(true);
        expect(inScope.some(({ module }) => module === 'forest-classification.routes.js')).toBe(false);
    });
});
