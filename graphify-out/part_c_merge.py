import json
from pathlib import Path

# 1. Save new results to cache
from graphify.cache import save_semantic_cache

new_data = json.loads(Path('graphify-out/.graphify_semantic_new.json').read_text(encoding='utf-8'))
saved = save_semantic_cache(new_data.get('nodes', []), new_data.get('edges', []), new_data.get('hyperedges', []), root='.')
print(f'Cached {saved} files')

# 2. Merge cached + new
cached = json.loads(Path('graphify-out/.graphify_cached.json').read_text(encoding='utf-8')) if Path('graphify-out/.graphify_cached.json').exists() else {'nodes':[],'edges':[],'hyperedges':[]}
new = new_data

all_nodes = cached['nodes'] + new.get('nodes', [])
all_edges = cached['edges'] + new.get('edges', [])
all_hyperedges = cached.get('hyperedges', []) + new.get('hyperedges', [])
seen = set()
deduped = []
for n in all_nodes:
    if n['id'] not in seen:
        seen.add(n['id'])
        deduped.append(n)

merged_sem = {
    'nodes': deduped,
    'edges': all_edges,
    'hyperedges': all_hyperedges,
    'input_tokens': new.get('input_tokens', 0),
    'output_tokens': new.get('output_tokens', 0),
}
Path('graphify-out/.graphify_semantic.json').write_text(json.dumps(merged_sem, indent=2, ensure_ascii=False), encoding='utf-8')
print(f'Extraction complete - {len(deduped)} nodes, {len(all_edges)} edges')

# 3. Merge AST + semantic
ast = json.loads(Path('graphify-out/.graphify_ast.json').read_text(encoding='utf-8'))
sem = merged_sem

seen_ast = {n['id'] for n in ast['nodes']}
merged_nodes = list(ast['nodes'])
for n in sem['nodes']:
    if n['id'] not in seen_ast:
        merged_nodes.append(n)
        seen_ast.add(n['id'])

merged_edges = ast['edges'] + sem['edges']
merged_hyperedges = sem.get('hyperedges', [])
merged = {
    'nodes': merged_nodes,
    'edges': merged_edges,
    'hyperedges': merged_hyperedges,
    'input_tokens': sem.get('input_tokens', 0),
    'output_tokens': sem.get('output_tokens', 0),
}
Path('graphify-out/.graphify_extract.json').write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding='utf-8')
print(f'Merged: {len(merged_nodes)} nodes, {len(merged_edges)} edges ({len(ast["nodes"])} AST + {len(sem["nodes"])} semantic)')
