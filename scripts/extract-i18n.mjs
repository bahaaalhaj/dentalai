// Mechanical JSX/message extraction only. Never changes clinical enums, saved data or formulas.
import ts from 'typescript';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = path.resolve('apps/web/src'),
  output = path.join(root, 'i18n/generated.ts');
const previous = await readFile(output, 'utf8');
function readCatalog(name) {
  const tree = ts.createSourceFile(output, previous, ts.ScriptTarget.Latest, true);
  const result = {};
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(tree) !== name) continue;
      const value = declaration.initializer;
      const object = value && ts.isAsExpression(value) ? value.expression : value;
      if (!object || !ts.isObjectLiteralExpression(object))
        throw new Error('Catalog must be a literal object');
      for (const property of object.properties) {
        if (!ts.isPropertyAssignment(property)) throw new Error('Invalid catalog field');
        const key = ts.isStringLiteral(property.name)
          ? property.name.text
          : property.name.getText(tree);
        if (ts.isStringLiteral(property.initializer)) result[key] = property.initializer.text;
        else if (ts.isArrayLiteralExpression(property.initializer))
          result[key] = property.initializer.elements.map((value) => {
            if (!ts.isStringLiteral(value)) throw new Error('Invalid catalog source');
            return value.text;
          });
        else throw new Error('Invalid catalog value');
      }
    }
  }
  return result;
}
const english = readCatalog('generatedEnglish'),
  sources = readCatalog('generatedSources');
const checking = process.argv.includes('--check');
let count = 0;
const usedKeys = new Set();
async function files(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (/^(i18n|tests|test|test_utils)$/.test(item.name)) continue;
    const full = path.join(directory, item.name);
    if (item.isDirectory()) result.push(...(await files(full)));
    else if (/\.tsx?$/.test(item.name) && !/(\.test\.|vite-env)/.test(item.name)) result.push(full);
  }
  return result;
}
const visibleAttributes = new Set([
  'aria-label',
  'placeholder',
  'title',
  'label',
  'description',
  'subtitle',
]);
function isUiExpression(node) {
  let current = node.parent;
  while (current) {
    if (ts.isJsxAttribute(current)) return visibleAttributes.has(current.name.getText());
    if (ts.isJsxExpression(current))
      return (
        !ts.isJsxAttribute(current.parent) || visibleAttributes.has(current.parent.name.getText())
      );
    // Do not cross event handlers, function calls, object fields or saved data.
    if (
      !ts.isConditionalExpression(current) &&
      !ts.isParenthesizedExpression(current) &&
      !ts.isBinaryExpression(current)
    )
      return false;
    current = current.parent;
  }
  return false;
}
for (const file of await files(root)) {
  const input = await readFile(file, 'utf8'),
    tree = ts.createSourceFile(
      file,
      input,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
    edits = [];
  let imports = false;
  function key(text) {
    const id = `ui.${createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
    if (english[id] && english[id] !== text) throw new Error('Translation key collision');
    english[id] = text;
    usedKeys.add(id);
    const origin = path.relative(root, file).replaceAll('\\', '/');
    sources[id] = [...new Set([...(sources[id] ?? []), origin])].sort();
    return id;
  }
  function replace(node, text, jsx = false) {
    if (!/[\p{L}\p{N}]/u.test(text)) return;
    count++;
    imports = true;
    edits.push({
      start: node.getStart(tree),
      end: node.end,
      value: jsx ? `{t(${JSON.stringify(key(text))})}` : `t(${JSON.stringify(key(text))})`,
    });
  }
  function visit(node) {
    // Interpolation is display-only: never touch enum values, event handlers or saved content.
    if (ts.isTemplateExpression(node) && isUiExpression(node)) {
      const values = node.templateSpans.map((span, i) => `v${i}: ${span.expression.getText(tree)}`);
      const text =
        node.head.text +
        node.templateSpans.map((span, i) => `{v${i}}${span.literal.text}`).join('');
      count++;
      imports = true;
      edits.push({
        start: node.getStart(tree),
        end: node.end,
        value: `t(${JSON.stringify(key(text))}, {${values.join(',')}})`,
      });
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === 't' &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const id = node.arguments[0].text;
      usedKeys.add(id);
      if (
        english[id] &&
        ((ts.isConditionalExpression(node.parent) && !isUiExpression(node)) ||
          (ts.isJsxExpression(node.parent) && !isUiExpression(node)))
      ) {
        edits.push({
          start: node.getStart(tree),
          end: node.end,
          value: JSON.stringify(english[id]),
        });
      }
    }
    if (ts.isJsxText(node)) {
      const raw = node.getText(tree),
        text = raw.includes('\n') ? raw.replace(/\s+/g, ' ').trim() : raw.replace(/\s+/g, ' ');
      if (text.trim()) replace(node, text, true);
    } else if (ts.isStringLiteral(node)) {
      const parent = node.parent;
      if (ts.isJsxAttribute(parent) && visibleAttributes.has(parent.name.getText()))
        replace(node, node.text, true);
      else if (
        (ts.isJsxExpression(parent) && isUiExpression(node)) ||
        (ts.isConditionalExpression(parent) &&
          (parent.whenTrue === node || parent.whenFalse === node) &&
          isUiExpression(node))
      )
        replace(node, node.text);
      else if (
        ts.isCallExpression(parent) &&
        /^set(Message|Error|Notice|Success|Status)$/.test(parent.expression.getText(tree))
      )
        replace(node, node.text);
      else if (ts.isNewExpression(parent) && parent.expression.getText(tree) === 'Error')
        replace(node, node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  // Tailwind's logical utilities preserve the theme while matching document direction.
  let result = input;
  if (!checking) {
    for (const edit of edits.sort((a, b) => b.start - a.start))
      result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
    result = result.replace(
      /\b(ml|mr|pl|pr|left|right|text-left|text-right)-(?=[\w[\]])/g,
      (match) =>
        ({
          'ml-': 'ms-',
          'mr-': 'me-',
          'pl-': 'ps-',
          'pr-': 'pe-',
          'left-': 'start-',
          'right-': 'end-',
          'text-left-': 'text-start-',
          'text-right-': 'text-end-',
        })[match] ?? match,
    );
    result = result.replace(/\btext-left\b/g, 'text-start').replace(/\btext-right\b/g, 'text-end');
    if (imports && !/import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*['"][^'"]*i18n/.test(input)) {
      let relative = path
        .relative(path.dirname(file), path.join(root, 'i18n'))
        .replaceAll('\\', '/');
      if (!relative.startsWith('.')) relative = `./${relative}`;
      result = `import { t } from '${relative}';\n${result}`;
    }
    if (result !== input) await writeFile(file, result);
  }
}
if (checking) {
  if (count)
    throw new Error(
      `${count} unextracted UI literals; run npm run i18n:extract and review the diff.`,
    );
  console.log(
    'UI literal extraction gate passed. Clinical/domain enums intentionally remain source data.',
  );
} else {
  for (const id of Object.keys(english)) {
    if (!usedKeys.has(id)) {
      delete english[id];
      delete sources[id];
    }
  }
  // Exact nonsecret UI strings: the scanner mistakes adjacent translation checksum IDs
  // for a credential. Do not exempt files or authentication/configuration content.
  const catalog = JSON.stringify(english, null, 2)
    .split('\n')
    .map((line) =>
      /Enter your credentials to access your portal|Join DentalAi for smart dental care management|: "Password"|: "Processing\.\.\."/.test(
        line,
      )
        ? `${line} // gitleaks:allow -- Nonsecret translation checksum ID and UI copy.`
        : line,
    )
    .join('\n');
  await writeFile(
    output,
    `// Mechanical English inventory; clinical Arabic remains unapproved. Never auto-translate medical entries.\nexport const generatedEnglish = ${catalog} as const;\nexport const generatedSources = ${JSON.stringify(sources, null, 2)} as const;\n`,
  );
  console.log(
    `Extracted ${count} UI messages. Review terminology and translations before approval.`,
  );
}
