import fs from 'node:fs';
import postcss from 'postcss';

// Remove declarations superseded by the exact same property/selector/condition.
// Never move rules across the cascade, merge selectors, or change specificity.
// Keep value fallbacks that use vendor prefixes or unsupported-value probes.
export function consolidateCSS(source) {
  const root = postcss.parse(source);
  const seen = new Map();
  let removed = 0;
  const replacements = [];
  const rules = [];
  root.walkRules(rule => rules.push(rule));
  for (const rule of rules.reverse()) {
    const ancestry = [];
    for (let parent=rule.parent; parent?.type==='atrule'; parent=parent.parent) {
      ancestry.unshift(`@${parent.name} ${parent.params}`);
    }
    // Keyframes have order semantics unlike ordinary style rules.
    if (ancestry.some(item => /keyframes/.test(item))) continue;
    const key = JSON.stringify([ancestry,rule.selector]);
    const properties = seen.get(key) || new Map();
    seen.set(key,properties);
    for (const declaration of [...rule.nodes].reverse()) {
      if (declaration.type!=='decl') continue;
      const prop = declaration.prop;
      const later = properties.get(prop);
      const specialValue = value => /-(?:webkit|moz|ms)-|env\(|constant\(/.test(value);
      if (later && (later.important || !declaration.important) &&
          !specialValue(later.value) && !specialValue(declaration.value)) {
        replacements.push([prop,later.value]);
        declaration.remove(); removed++;
      } else {
        properties.set(prop,{important:declaration.important,value:declaration.value});
      }
    }
    if (!rule.nodes.some(node=>node.type==='decl')) rule.remove();
  }
  root.walkAtRules(rule=>{if(rule.nodes && !rule.nodes.length)rule.remove();});
  return {css:root.toString(),removed,replacements};
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const file = 'docs/styles.css';
  const result = consolidateCSS(fs.readFileSync(file,'utf8'));
  if(process.argv.includes('--write'))fs.writeFileSync(file,result.css);
  console.log(`${result.removed} superseded declarations ${process.argv.includes('--write')?'removed':'found'}.`);
}
