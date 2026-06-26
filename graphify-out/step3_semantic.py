import sys, json
from pathlib import Path
from graphify.llm import extract_corpus_parallel

detect = json.loads(open('graphify-out/.graphify_detect.json', encoding='utf-16').read())
all_files = []
for cat in ('document', 'paper', 'image'):
    all_files.extend(detect['files'].get(cat, []))

print(f'Semantic extraction: {len(all_files)} non-code files')

result = extract_corpus_parallel(all_files, backend="gemini")
Path('graphify-out/.graphify_semantic.json').write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
print(f'Semantic: {len(result.get("nodes", []))} nodes, {len(result.get("edges", []))} edges')
print(f'Tokens: {result.get("input_tokens", 0):,} in / {result.get("output_tokens", 0):,} out')
