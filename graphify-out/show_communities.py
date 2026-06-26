import json
from pathlib import Path
analysis = json.loads(Path('graphify-out/.graphify_analysis.json').read_text(encoding='utf-8'))
gods = analysis.get('gods', [])
surprises = analysis.get('surprises', [])
questions = analysis.get('questions', [])

print('Top communities by size:')
for cid, nodes in sorted(analysis['communities'].items(), key=lambda x: len(x[1]), reverse=True)[:15]:
    sample = []
    for n in nodes[:5]:
        if isinstance(n, dict):
            sample.append(n.get('label', n.get('id', '?')))
        else:
            sample.append(str(n))
    print(f'  Community {cid}: {len(nodes)} nodes - {sample}')
print(f'  ... and {max(0, len(analysis["communities"])-15)} more')

print(f'\nGod Nodes ({len(gods)}):')
for g in gods[:10]:
    print(f'  {g}')

print(f'\nSurprising Connections ({len(surprises)}):')
for s in surprises[:5]:
    print(f'  {s}')

print(f'\nSuggested Questions ({len(questions)}):')
for q in questions[:5]:
    print(f'  {q}')
